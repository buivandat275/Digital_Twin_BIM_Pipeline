from __future__ import annotations

from collections import Counter

import pandas as pd

from rules.om_field_rules import OM_FIELD_GUIDANCE, OM_FIELD_NAMES, missing_om_fields
from rules.operational_scope import classify_operational_scope


ISSUE_COLUMNS = [
    "global_id",
    "object_name",
    "ifc_class",
    "operational_scope",
    "field",
    "error_type",
    "severity",
    "suggested_fix",
    "profile",
]


def validate_assets(objects: list[dict], profile_name: str = "vsf_om_10") -> tuple[pd.DataFrame, dict]:
    issues: list[dict] = []
    missing_by_field: Counter[str] = Counter()
    incomplete_objects = 0
    incomplete_operational_assets = 0
    context_objects = 0
    scope_review_objects = 0
    maintainable_assets = 0
    realtime_assets = 0

    for obj in objects:
        scope = str(obj.get("operational_scope") or classify_operational_scope(obj)["operational_scope"])
        if scope == "context":
            context_objects += 1
            continue
        if scope == "scope_review":
            scope_review_objects += 1
        elif scope == "maintainable":
            maintainable_assets += 1
        elif scope == "realtime":
            realtime_assets += 1
        missing = missing_om_fields(obj)
        if missing:
            incomplete_objects += 1
            if scope in {"maintainable", "realtime"}:
                incomplete_operational_assets += 1
        for field in missing:
            missing_by_field[field] += 1
            issues.append(
                {
                    "global_id": obj.get("global_id", ""),
                    "object_name": obj.get("asset_name") or obj.get("name") or obj.get("global_id", ""),
                    "ifc_class": obj.get("ifc_class", ""),
                    "operational_scope": scope,
                    "field": field,
                    "error_type": f"Thiếu {field}",
                    "severity": "Medium",
                    "suggested_fix": OM_FIELD_GUIDANCE[field],
                    "profile": "vsf_om_10",
                }
            )

    df = pd.DataFrame(issues, columns=ISSUE_COLUMNS)
    total_objects = len(objects)
    checked_objects = scope_review_objects + maintainable_assets + realtime_assets
    return df, {
        "total_errors": len(issues),
        "High": 0,
        "Medium": len(issues),
        "Low": 0,
        "total_objects": total_objects,
        "checked_objects": checked_objects,
        "context_objects": context_objects,
        "scope_review_objects": scope_review_objects,
        "maintainable_assets": maintainable_assets,
        "realtime_assets": realtime_assets,
        "complete_objects": maintainable_assets + realtime_assets - incomplete_operational_assets,
        "incomplete_objects": incomplete_objects,
        "missing_by_field": {field: missing_by_field[field] for field in OM_FIELD_NAMES},
    }
