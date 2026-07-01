from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote

import pandas as pd
import requests

from rules.om_field_rules import OM_FIELD_NAMES


class DigitalTwinApiError(RuntimeError):
    pass


def api_base_url() -> str:
    return os.getenv("DIGITAL_TWIN_API_URL", "http://127.0.0.1:8010").rstrip("/")


def list_saved_models() -> list[dict[str, Any]]:
    payload = _request("GET", "/api/v1/models", timeout=30)
    return list(payload.get("items") or [])


def sync_validated_model(
    objects: list[dict],
    *,
    project_code: str,
    project_name: str,
    source_file: str,
    source_path: str | Path,
    aps_urn: str,
    validation_profile: str,
    compliance_summary: dict[str, Any],
    actor: str,
    batch_size: int = 500,
) -> dict[str, Any]:
    duplicate_codes = _duplicate_asset_codes(objects)
    headers = _headers(actor, "streamlit")
    project = _request(
        "POST",
        "/api/v1/projects",
        headers=headers,
        json={"code": project_code, "name": project_name},
    )
    model = _request(
        "POST",
        f"/api/v1/projects/{project['id']}/models",
        headers=headers,
        json={
            "source_file": source_file,
            "source_checksum": _sha256_file(source_path),
            "aps_urn": aps_urn,
            "validation_profile": validation_profile,
            "compliance_summary": _json_safe(compliance_summary),
        },
    )
    rows = [_object_payload(obj, duplicate_codes) for obj in objects]
    totals = {"created": 0, "updated": 0, "processed": 0}
    for batch in _chunks(rows, batch_size):
        result = _request(
            "POST",
            f"/api/v1/models/{model['id']}/objects:batch-upsert",
            headers=headers,
            json={"objects": batch},
            timeout=120,
        )
        for key in totals:
            totals[key] += int(result.get(key, 0))
    validation = _request(
        "POST",
        f"/api/v1/models/{model['id']}/validation-runs",
        headers=headers,
        json={"profile": validation_profile},
        timeout=120,
    )
    return {
        "project": project,
        "model": model,
        "objects": totals,
        "validation": validation,
        "blockedDuplicates": {
            field: {
                code: owners
                for code, owners in duplicates.items()
            }
            for field, duplicates in duplicate_codes.items()
        },
    }


def import_bms_register(
    model_id: str,
    frame: pd.DataFrame,
    filename: str,
    actor: str,
    manual_mapping_log: pd.DataFrame | None = None,
) -> dict[str, Any]:
    content = frame.to_csv(index=False).encode("utf-8-sig")
    result = _request(
        "POST",
        f"/api/v1/models/{model_id}/bms-imports",
        headers={"X-Actor-Name": quote(actor.strip(), safe=""), "X-Request-ID": _request_id("bms-import")},
        files={"file": (filename or "bms-device-register.csv", content, "text/csv")},
        timeout=120,
    )
    auto = _request(
        "POST",
        f"/api/v1/bms-imports/{result['id']}/auto-apply",
        headers=_headers(actor, "bms-auto"),
        json={},
        timeout=120,
    )
    manual_applied = 0
    if manual_mapping_log is not None and not manual_mapping_log.empty:
        reconciliation = _request("GET", f"/api/v1/bms-imports/{result['id']}/reconciliation")
        rows_by_number = {int(item["row"]): item for item in reconciliation.get("items", [])}
        for decision in manual_mapping_log.to_dict(orient="records"):
            if str(decision.get("result") or "") != "Đã map":
                continue
            guid = str(decision.get("target_global_id") or "").strip()
            row_number = int(decision.get("row") or 0)
            import_row = rows_by_number.get(row_number)
            if not guid or not import_row or import_row.get("status") in {"applied", "rejected"}:
                continue
            asset = _request(
                "GET",
                f"/api/v1/models/{model_id}/assets/by-ifc-guid/{guid}",
            )
            _request(
                "POST",
                f"/api/v1/bms-import-rows/{import_row['id']}/confirm",
                headers=_headers(actor, "bms-confirm"),
                json={
                    "target_asset_id": asset["id"],
                    "reason": "Quyết định đối soát được xác nhận trong Streamlit",
                    "source": "streamlit",
                },
                timeout=120,
            )
            manual_applied += 1
    return {**result, "autoApply": auto, "manualApplied": manual_applied}


def _object_payload(obj: dict, duplicate_codes: dict[str, dict[str, list[str]]]) -> dict[str, Any]:
    guid = str(obj.get("global_id") or obj.get("source_global_id") or obj.get("ifc_guid") or "").strip()
    if not guid:
        raise DigitalTwinApiError(f"Object không có IFC GlobalId: {obj.get('name', '(không tên)')}")
    blocked = {}
    om_values = {}
    for field in OM_FIELD_NAMES:
        value = _text(obj.get(field))
        normalized = value.upper()
        if field in duplicate_codes and normalized in duplicate_codes[field]:
            blocked[field] = value
            value = ""
        om_values[field] = value
    return {
        "ifc_guid": guid,
        "name": _text(obj.get("asset_name") or obj.get("name")),
        "ifc_class": _text(obj.get("ifc_class")),
        "object_type": _text(obj.get("asset_type") or obj.get("object_type") or obj.get("type")),
        "floor": _text(obj.get("floor") or obj.get("storey")),
        "room": _text(obj.get("room_zone") or obj.get("room")),
        "location": _text(obj.get("location")),
        "operational_scope": _text(obj.get("operational_scope")) or "context",
        "scope_reason": _text(obj.get("operational_scope_reason")),
        "scope_source": _text(obj.get("operational_scope_source")),
        "om_values": om_values,
        "field_sources": _json_safe(obj.get("om_field_sources") or {}),
        "raw_source": _json_safe(
            {
                "technical_properties": obj.get("technical_properties") or {},
                "quantity_properties": obj.get("quantity_properties") or {},
                "source_reference": obj.get("source_reference") or {},
                "blocked_duplicate_asset_codes": blocked,
            }
        ),
    }


def _duplicate_asset_codes(objects: list[dict]) -> dict[str, dict[str, list[str]]]:
    result: dict[str, dict[str, list[str]]] = {}
    for field in ("EMSD.Common.Asset Code", "VSF.Common.Asset Code"):
        owners: dict[str, list[str]] = {}
        for obj in objects:
            code = _text(obj.get(field)).upper()
            if not code:
                continue
            guid = _text(obj.get("global_id") or obj.get("source_global_id") or obj.get("ifc_guid"))
            owners.setdefault(code, []).append(guid or _text(obj.get("name")) or "(không có GlobalId)")
        result[field] = {code: values for code, values in owners.items() if len(values) > 1}
    return result


def _request(method: str, path: str, **kwargs: Any) -> dict[str, Any]:
    kwargs.setdefault("timeout", 30)
    try:
        response = requests.request(method, f"{api_base_url()}{path}", **kwargs)
    except requests.RequestException as exc:
        raise DigitalTwinApiError(
            f"Không kết nối được FastAPI tại {api_base_url()}. Hãy chạy scripts/run-api.ps1 và kiểm tra Docker."
        ) from exc
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    if not response.ok:
        message = payload.get("detail") or payload.get("error") or response.text
        raise DigitalTwinApiError(f"API HTTP {response.status_code}: {message}")
    return payload


def _headers(actor: str, action: str) -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "X-Actor-Name": quote(actor.strip(), safe=""),
        "X-Request-ID": _request_id(action),
    }


def _request_id(action: str) -> str:
    import uuid

    return f"{action}-{uuid.uuid4()}"


def _sha256_file(path: str | Path) -> str:
    source = Path(path)
    if not source.is_file():
        return ""
    digest = hashlib.sha256()
    with source.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _chunks(values: list[dict], size: int) -> Iterable[list[dict]]:
    for start in range(0, len(values), size):
        yield values[start : start + size]


def _text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    if hasattr(value, "item"):
        return value.item()
    if pd.isna(value) if not isinstance(value, (dict, list, tuple, set, str)) else False:
        return None
    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)
