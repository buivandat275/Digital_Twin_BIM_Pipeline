from __future__ import annotations

import pandas as pd

from rules.mapping_rules import NOISE_KEYWORDS
from rules.field_policy import get_validated_fields
from rules.validation_rules import FIELD_LABELS, SEVERITY_BY_FIELD


def validate_assets(objects: list[dict], profile_name: str = "building_om") -> tuple[pd.DataFrame, dict]:
    errors = []
    required_fields = get_validated_fields(profile_name)
    for obj in objects:
        object_name = obj.get("asset_name") or obj.get("name") or obj.get("global_id")
        for field in required_fields:
            if not obj.get(field):
                label = FIELD_LABELS.get(field, field)
                errors.append(
                    {
                        "object_name": object_name,
                        "ifc_class": obj.get("ifc_class", ""),
                        "field": label,
                        "error_type": f"Missing {label}",
                        "severity": SEVERITY_BY_FIELD.get(field, "Medium"),
                        "suggested_fix": _suggested_fix(field, obj),
                        "detail": "",
                        "profile": profile_name,
                    }
                )

        if obj.get("ifc_class") == "IfcBuildingElementProxy":
            errors.append(
                {
                    "object_name": object_name,
                    "ifc_class": obj.get("ifc_class", ""),
                    "field": "IFC Class",
                    "error_type": "Bad Classification",
                    "severity": "High",
                    "suggested_fix": "Review object classification before import.",
                    "detail": "",
                    "profile": profile_name,
                }
            )

        noise_fields = _find_noise_metadata(obj.get("raw_metadata", {}))
        if noise_fields:
            errors.append(
                {
                    "object_name": object_name,
                    "ifc_class": obj.get("ifc_class", ""),
                    "field": "raw_metadata",
                    "error_type": "Software-specific metadata",
                    "severity": "Low",
                    "suggested_fix": "Keep this value in raw_metadata/source_reference, not core asset fields.",
                    "detail": _summarize_noise_fields(noise_fields),
                    "profile": profile_name,
                }
            )

    df = pd.DataFrame(errors)
    summary = {
        "total_errors": len(errors),
        "High": int((df["severity"] == "High").sum()) if not df.empty else 0,
        "Medium": int((df["severity"] == "Medium").sum()) if not df.empty else 0,
        "Low": int((df["severity"] == "Low").sum()) if not df.empty else 0,
    }
    return df, summary


def _suggested_fix(field: str, obj: dict) -> str:
    if field == "asset_id":
        return "Click Apply Basic Clean to generate Asset ID."
    if field in {"asset_type", "system"}:
        return "Derive from IFC Class classification rules."
    if field == "status":
        return "Set default status to Active."
    if field == "floor":
        return "Normalize from IfcBuildingStorey.Name if available."
    if field == "room_zone":
        return "Map from IfcSpace.Name or manually assign."
    return "Add or map this field before import."


def _find_noise_metadata(raw_metadata: dict) -> list[str]:
    found = []
    for pset_name, props in raw_metadata.items():
        if not isinstance(props, dict):
            continue
        for key in props:
            probe = f"{pset_name} {key}".lower()
            if any(keyword in probe for keyword in NOISE_KEYWORDS):
                found.append(f"{pset_name}.{key}")
    return found


def _summarize_noise_fields(noise_fields: list[str]) -> str:
    examples = ", ".join(noise_fields[:5])
    remaining = len(noise_fields) - 5
    if remaining > 0:
        return f"{len(noise_fields)} metadata fields flagged. Examples: {examples}, +{remaining} more."
    return f"{len(noise_fields)} metadata fields flagged. Examples: {examples}."
