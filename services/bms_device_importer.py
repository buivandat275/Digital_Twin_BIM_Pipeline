from __future__ import annotations

from collections import defaultdict
from typing import Any

import pandas as pd


BMS_COLUMNS = [
    "AssetCode",
    "BMSDeviceID",
    "DeviceName",
    "Status",
    "Floor",
    "Room",
    "Location",
    "Link",
    "Document",
    "Manufacturer",
]

COLUMN_ALIASES = {
    "AssetCode": {"assetcode", "asset_code", "asset code"},
    "BMSDeviceID": {"bmsdeviceid", "bms_device_id", "bms device id", "deviceid", "device_id"},
    "DeviceName": {"devicename", "device_name", "device name", "name"},
    "Status": {"status", "device_status", "device status"},
    "Floor": {"floor", "level", "storey"},
    "Room": {"room", "room_zone", "room zone", "zone"},
    "Location": {"location", "vsf.location"},
    "Link": {"link", "vsf.link", "bms_link"},
    "Document": {"document", "vsf.document", "manual", "documentation"},
    "Manufacturer": {"manufacturer", "vendor", "make"},
}


def load_bms_device_file(uploaded_file: Any) -> pd.DataFrame:
    file_name = uploaded_file.name.lower()
    if file_name.endswith(".csv"):
        raw = pd.read_csv(uploaded_file).fillna("")
    elif file_name.endswith((".xlsx", ".xls")):
        raw = pd.read_excel(uploaded_file).fillna("")
    else:
        raise ValueError("File BMS phải là CSV hoặc Excel.")
    return normalize_bms_dataframe(raw)


def normalize_bms_dataframe(raw: pd.DataFrame) -> pd.DataFrame:
    normalized_headers = {_normalize_header(column): column for column in raw.columns}
    result = pd.DataFrame(index=raw.index)

    for canonical in BMS_COLUMNS:
        source_column = next(
            (
                normalized_headers[alias]
                for alias in COLUMN_ALIASES[canonical]
                if alias in normalized_headers
            ),
            None,
        )
        result[canonical] = raw[source_column] if source_column else ""

    result = result.fillna("")
    result["AssetCode"] = result["AssetCode"].map(_clean_value)
    if not result["AssetCode"].astype(str).str.strip().any():
        raise ValueError("File BMS phải có cột AssetCode và ít nhất một mã asset.")
    return result[BMS_COLUMNS]


def reconcile_bms_devices(objects: list[dict], bms_df: pd.DataFrame) -> dict:
    normalized_bms = normalize_bms_dataframe(bms_df)
    object_indexes: dict[str, list[int]] = defaultdict(list)
    for index, obj in enumerate(objects):
        for field in ("EMSD.Common.Asset Code", "VSF.Common.Asset Code", "asset_id", "dt_asset_code"):
            code = _normalize_code(obj.get(field))
            if code and index not in object_indexes[code]:
                object_indexes[code].append(index)

    bms_code_counts = normalized_bms["AssetCode"].map(_normalize_code).value_counts().to_dict()
    auto_mappings = []
    problems = []
    rows = []

    for row_index, row in enumerate(normalized_bms.to_dict(orient="records")):
        row_number = row_index + 2
        asset_code = _clean_value(row.get("AssetCode"))
        normalized_code = _normalize_code(asset_code)
        matches = object_indexes.get(normalized_code, [])
        candidates = [_candidate(objects[index]) for index in matches]
        problem_type = ""
        problem_message = ""

        if bms_code_counts.get(normalized_code, 0) > 1:
            problem_type = "duplicate_bms"
            problem_message = "AssetCode xuất hiện nhiều dòng trong file BMS."
        elif not matches:
            problem_type = "unmatched"
            problem_message = "Không tìm thấy AssetCode tương ứng trong IFC."
        elif len(matches) > 1:
            problem_type = "duplicate_ifc"
            problem_message = "AssetCode đang thuộc nhiều object IFC; phải chọn đúng object."

        if problem_type:
            problem = {
                "problem_id": f"bms-row-{row_index}",
                "bms_row_index": row_index,
                "row": row_number,
                "asset_code": asset_code,
                "bms_device_id": _clean_value(row.get("BMSDeviceID")),
                "device_name": _clean_value(row.get("DeviceName")),
                "problem_type": problem_type,
                "message": problem_message,
                "candidates": candidates,
            }
            problems.append(problem)
            rows.append(
                {
                    "row": row_number,
                    "asset_code": asset_code,
                    "bms_device_id": problem["bms_device_id"],
                    "result": f"Chờ xác nhận - {problem_message}",
                    "candidate_count": len(candidates),
                }
            )
            continue

        target = candidates[0]
        auto_mappings.append(
            {
                "bms_row_index": row_index,
                "target_global_id": target["global_id"],
                "decision": "auto",
            }
        )
        rows.append(
            {
                "row": row_number,
                "asset_code": asset_code,
                "bms_device_id": _clean_value(row.get("BMSDeviceID")),
                "result": "Sẵn sàng tự động map",
                "candidate_count": 1,
            }
        )

    return {
        "bms_df": normalized_bms,
        "auto_mappings": auto_mappings,
        "problems": problems,
        "reconciliation_df": pd.DataFrame(rows),
        "summary": {
            "bms_rows": len(normalized_bms),
            "auto_ready": len(auto_mappings),
            "problems": len(problems),
            "duplicate_ifc": sum(problem["problem_type"] == "duplicate_ifc" for problem in problems),
            "duplicate_bms": sum(problem["problem_type"] == "duplicate_bms" for problem in problems),
            "unmatched": sum(problem["problem_type"] == "unmatched" for problem in problems),
        },
    }


def apply_bms_mappings(
    objects: list[dict],
    bms_df: pd.DataFrame,
    mappings: list[dict],
    *,
    mapping_source: str,
) -> tuple[list[dict], pd.DataFrame, dict]:
    normalized_bms = normalize_bms_dataframe(bms_df)
    merged = [obj.copy() for obj in objects]
    guid_indexes = {
        str(obj.get("global_id") or obj.get("source_global_id") or "").strip(): index
        for index, obj in enumerate(merged)
        if str(obj.get("global_id") or obj.get("source_global_id") or "").strip()
    }
    claimed_targets: set[str] = set()
    logs = []
    applied = 0

    for mapping in mappings:
        row_index = int(mapping.get("bms_row_index", -1))
        target_global_id = str(mapping.get("target_global_id") or "").strip()
        if row_index < 0 or row_index >= len(normalized_bms):
            logs.append(_decision_log(mapping, "", "", "Không áp dụng - dòng BMS không hợp lệ"))
            continue
        row = normalized_bms.iloc[row_index].to_dict()
        asset_code = _clean_value(row.get("AssetCode"))
        bms_device_id = _clean_value(row.get("BMSDeviceID"))
        if not target_global_id or target_global_id not in guid_indexes:
            logs.append(
                _decision_log(
                    mapping,
                    asset_code,
                    bms_device_id,
                    "Không áp dụng - IFC GlobalId không tồn tại",
                )
            )
            continue
        if target_global_id in claimed_targets:
            logs.append(
                _decision_log(
                    mapping,
                    asset_code,
                    bms_device_id,
                    "Không áp dụng - object đã được chọn cho một dòng BMS khác",
                )
            )
            continue

        claimed_targets.add(target_global_id)
        item = merged[guid_indexes[target_global_id]]
        changed_fields = _apply_bms_row(item, row)
        applied += 1
        logs.append(
            {
                "row": row_index + 2,
                "asset_code": asset_code,
                "bms_device_id": bms_device_id,
                "target_global_id": target_global_id,
                "mapping_source": mapping_source,
                "result": "Đã map",
                "changed_fields": ", ".join(sorted(changed_fields)),
            }
        )

    return merged, pd.DataFrame(logs), {"requested": len(mappings), "applied": applied}


def merge_bms_devices(
    objects: list[dict],
    bms_df: pd.DataFrame,
) -> tuple[list[dict], pd.DataFrame, dict]:
    """Backward-compatible auto-map: ambiguous rows are blocked and left untouched."""
    reconciliation = reconcile_bms_devices(objects, bms_df)
    merged, applied_log, apply_summary = apply_bms_mappings(
        objects,
        reconciliation["bms_df"],
        reconciliation["auto_mappings"],
        mapping_source="auto_unique_asset_code",
    )
    summary = {
        **reconciliation["summary"],
        "matched_rows": apply_summary["applied"],
        "unmatched_rows": reconciliation["summary"]["unmatched"],
        "matched_objects": apply_summary["applied"],
        "duplicate_matches": (
            reconciliation["summary"]["duplicate_ifc"] + reconciliation["summary"]["duplicate_bms"]
        ),
    }
    return merged, applied_log, summary


def _candidate(obj: dict) -> dict:
    return {
        "global_id": str(obj.get("global_id") or obj.get("source_global_id") or "").strip(),
        "name": obj.get("asset_name") or obj.get("name", ""),
        "ifc_class": obj.get("ifc_class", ""),
        "floor": obj.get("floor", ""),
        "room": obj.get("room_zone", ""),
        "location": obj.get("location", ""),
    }


def _decision_log(mapping: dict, asset_code: str, bms_device_id: str, result: str) -> dict:
    return {
        "row": int(mapping.get("bms_row_index", -1)) + 2,
        "asset_code": asset_code,
        "bms_device_id": bms_device_id,
        "target_global_id": str(mapping.get("target_global_id") or ""),
        "mapping_source": str(mapping.get("decision") or "manual_confirmation"),
        "result": result,
        "changed_fields": "",
    }


def _apply_bms_row(item: dict, row: dict) -> list[str]:
    changed = []
    field_sources = dict(item.get("om_field_sources") or {})

    def set_value(field: str, value: object, *, source_field: bool = False) -> None:
        cleaned = _clean_value(value)
        if not cleaned or item.get(field) == cleaned:
            return
        item[field] = cleaned
        changed.append(field)
        if source_field:
            field_sources[field] = "bms_device_register"

    set_value("bms_device_id", row.get("BMSDeviceID"))
    set_value("device_id", row.get("BMSDeviceID"))
    set_value("bms_device_name", row.get("DeviceName"))
    set_value("asset_name", row.get("DeviceName"))
    set_value("status", row.get("Status"))
    set_value("VSF.Status", row.get("Status"), source_field=True)
    set_value("floor", row.get("Floor"))
    set_value("room_zone", row.get("Room"))

    location = _clean_value(row.get("Location"))
    if not location:
        location = " / ".join(
            value
            for value in [_clean_value(row.get("Floor")), _clean_value(row.get("Room"))]
            if value
        )
    set_value("location", location)
    set_value("VSF.Location", location, source_field=True)
    set_value("VSF.Link", row.get("Link"), source_field=True)
    set_value("VSF.Document", row.get("Document"), source_field=True)
    set_value("manufacturer", row.get("Manufacturer"))
    set_value("EMSD.Common.Manufacturer", row.get("Manufacturer"), source_field=True)
    set_value("VSF.Common.Manufacturer", row.get("Manufacturer"), source_field=True)

    item["om_field_sources"] = field_sources
    item["bms_import_source"] = "BMS Device Register"
    item["operational_scope"] = "realtime"
    item["operational_scope_source"] = "bms_device_register"
    item["operational_scope_reason"] = "AssetCode khớp với BMS Device Register"
    item["maintainable"] = "Yes"
    item["realtime_enabled"] = "Yes"
    item["mapping_status"] = "Mapped from BMS register"
    return changed


def _normalize_header(value: object) -> str:
    return str(value or "").strip().lower()


def _normalize_code(value: object) -> str:
    return _clean_value(value).upper()


def _clean_value(value: object) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return str(value).strip()
