from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from rules.om_field_rules import OM_FIELD_NAMES

OPERATIONAL_FIELDS = OM_FIELD_NAMES


def build_validated_twin_snapshot(
    preview_tables: dict[str, list[dict]],
    validation_df: pd.DataFrame,
    *,
    project_id: str,
    project_name: str,
    source_file: str,
    validation_profile: str,
    validation_summary: dict,
    compliance_summary: dict,
) -> dict:
    issues = _validation_records(validation_df)
    issues_by_guid: dict[str, list[dict]] = {}
    for issue in issues:
        global_id = str(issue.get("global_id") or "").strip()
        if global_id:
            issues_by_guid.setdefault(global_id, []).append(issue)

    assets = []
    for asset in preview_tables.get("assets", []):
        global_id = str(asset.get("source_global_id") or asset.get("ifc_guid") or "").strip()
        asset_issues = issues_by_guid.get(global_id, [])
        assets.append(
            {
                "ifcGuid": global_id,
                "assetId": asset.get("EMSD.Common.Asset Code") or asset.get("VSF.Common.Asset Code", ""),
                "assetCode": asset.get("VSF.Common.Asset Code") or asset.get("EMSD.Common.Asset Code", ""),
                "name": asset.get("asset_name", ""),
                "type": asset.get("asset_type", ""),
                "operationalScope": asset.get("operational_scope", "context"),
                "scopeReason": asset.get("operational_scope_reason", ""),
                "readinessStatus": _readiness_status(asset, asset_issues),
                "normalizedProperties": _operational_properties(asset),
                "fieldSources": {
                    field: (asset.get("om_field_sources") or {}).get(field, "missing")
                    for field in OM_FIELD_NAMES
                },
                "bmsDevice": _clean_mapping(
                    {
                        "device_id": asset.get("bms_device_id") or asset.get("device_id", ""),
                        "device_name": asset.get("bms_device_name", ""),
                        "status": asset.get("status", ""),
                        "floor": asset.get("floor", ""),
                        "room": asset.get("room_zone", ""),
                        "location": asset.get("location", ""),
                        "mapping_status": asset.get("mapping_status", ""),
                    }
                ),
                "technicalProperties": _clean_mapping(asset.get("technical_properties")),
                "quantityProperties": _clean_mapping(asset.get("quantity_properties")),
                "sourceReference": _clean_mapping(asset.get("source_reference")),
                "validationIssues": asset_issues,
            }
        )

    return {
        "schemaVersion": "1.0.0",
        "kind": "validated-digital-twin-snapshot",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "project": {
            "id": project_id,
            "name": project_name,
        },
        "source": {
            "ifcFile": source_file,
            "validationProfile": validation_profile,
        },
        "summary": {
            "assetCount": len(assets),
            "operationalAssetCount": sum(
                asset["operationalScope"] in {"maintainable", "realtime"} for asset in assets
            ),
            "scopeReviewCount": sum(asset["operationalScope"] == "scope_review" for asset in assets),
            "contextCount": sum(asset["operationalScope"] == "context" for asset in assets),
            "complete": sum(asset["readinessStatus"] == "Complete" for asset in assets),
            "incomplete": sum(asset["readinessStatus"] == "Incomplete" for asset in assets),
            "missingFieldCount": sum(len(asset["validationIssues"]) for asset in assets),
            "missingByField": _json_safe(validation_summary.get("missing_by_field", {})),
            "validation": _json_safe(validation_summary),
            "ifcCompliance": _json_safe(compliance_summary),
        },
        "assets": assets,
    }


def write_validated_twin_snapshot(snapshot: dict, output_dir: str | Path, project_id: str) -> Path:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    safe_project_id = "".join(char if char.isalnum() or char in {"-", "_"} else "-" for char in project_id)
    output_path = output_dir / f"{safe_project_id or 'project'}_validated_twin_snapshot.json"
    output_path.write_text(
        json.dumps(snapshot, indent=2, ensure_ascii=False, default=_json_default),
        encoding="utf-8",
    )
    return output_path


def _validation_records(validation_df: pd.DataFrame) -> list[dict]:
    if validation_df is None or validation_df.empty:
        return []
    return json.loads(validation_df.to_json(orient="records", force_ascii=False))


def _readiness_status(asset: dict, issues: list[dict]) -> str:
    scope = str(asset.get("operational_scope") or "context")
    if scope == "context":
        return "Excluded"
    if scope == "scope_review":
        return "Scope Review"
    return "Incomplete" if issues else "Complete"


def _operational_properties(asset: dict) -> dict:
    return {field: _json_safe(asset.get(field, "")) for field in OPERATIONAL_FIELDS}


def _clean_mapping(value: Any) -> dict:
    if not isinstance(value, dict):
        return {}
    return {
        str(key): _json_safe(item)
        for key, item in value.items()
        if not _is_blank(item)
    }


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, dict):
        return not value
    if isinstance(value, list):
        return not value
    return False


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    if hasattr(value, "item"):
        return value.item()
    return value


def _json_default(value: Any) -> Any:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if hasattr(value, "item"):
        return value.item()
    return str(value)
