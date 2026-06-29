from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from rules.om_field_rules import OM_FIELD_NAMES, missing_om_fields
from rules.operational_scope import classify_operational_scope


IDENTITY_COLUMNS = [
    "source_global_id",
    "object_name",
    "source_ifc_class",
    "source_file",
    "missing_required_fields",
]


def build_correction_template(objects: list[dict], profile_name: str = "vsf_om_10") -> pd.DataFrame:
    rows = []
    for obj in objects:
        scope = str(obj.get("operational_scope") or classify_operational_scope(obj)["operational_scope"])
        if scope == "context":
            continue
        missing = missing_om_fields(obj)
        if not missing:
            continue
        row = {
            "source_global_id": obj.get("global_id") or obj.get("source_global_id", ""),
            "object_name": obj.get("asset_name") or obj.get("name", ""),
            "source_ifc_class": obj.get("ifc_class", ""),
            "operational_scope": scope,
            "source_file": obj.get("source_file", ""),
            "missing_required_fields": ", ".join(missing),
        }
        row.update({field: obj.get(field, "") for field in OM_FIELD_NAMES})
        rows.append(row)
    return pd.DataFrame(rows, columns=IDENTITY_COLUMNS + ["operational_scope"] + OM_FIELD_NAMES)


def export_correction_template(
    template_df: pd.DataFrame,
    output_dir: str | Path,
    project_id: str,
) -> tuple[Path, Path]:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / f"{project_id}_correction_template.csv"
    excel_path = output_dir / f"{project_id}_correction_template.xlsx"
    template_df.to_csv(csv_path, index=False)
    with pd.ExcelWriter(excel_path, engine="openpyxl") as writer:
        template_df.to_excel(writer, sheet_name="correction_template", index=False)
    return csv_path, excel_path


def load_correction_file(uploaded_file: Any) -> pd.DataFrame:
    file_name = uploaded_file.name.lower()
    if file_name.endswith(".csv"):
        return pd.read_csv(uploaded_file).fillna("")
    if file_name.endswith((".xlsx", ".xls")):
        return pd.read_excel(uploaded_file).fillna("")
    raise ValueError("File bổ sung phải là CSV hoặc Excel.")


def merge_correction_template(
    objects: list[dict],
    correction_df: pd.DataFrame,
    profile_name: str = "vsf_om_10",
) -> tuple[list[dict], pd.DataFrame]:
    editable_fields = [field for field in OM_FIELD_NAMES if field in correction_df.columns]
    corrections = _index_corrections(correction_df)
    merged = []
    logs = []

    for obj in objects:
        item = obj.copy()
        key = str(item.get("global_id") or item.get("source_global_id") or "").strip()
        correction = corrections.get(key)
        if not correction:
            merged.append(item)
            continue

        changed_fields = []
        field_sources = dict(item.get("om_field_sources") or {})
        requested_scope = str(correction.get("operational_scope") or "").strip()
        if requested_scope in {"context", "maintainable", "realtime", "scope_review"}:
            if requested_scope != item.get("operational_scope"):
                item["operational_scope"] = requested_scope
                item["operational_scope_source"] = "manual_correction"
                item["operational_scope_reason"] = "Phạm vi do người dùng xác nhận qua correction template"
                changed_fields.append("operational_scope")
        for field in editable_fields:
            value = correction.get(field, "")
            if _has_value(value) and item.get(field) != value:
                item[field] = value
                field_sources[field] = "manual_correction"
                changed_fields.append(field)
        item["om_field_sources"] = field_sources

        if changed_fields:
            logs.append(
                {
                    "source_global_id": key,
                    "object_name": item.get("asset_name") or item.get("name", ""),
                    "changed_fields": ", ".join(changed_fields),
                    "changed_count": len(changed_fields),
                }
            )
        merged.append(item)

    return merged, pd.DataFrame(logs)


def _index_corrections(correction_df: pd.DataFrame) -> dict[str, dict]:
    indexed = {}
    for row in correction_df.to_dict(orient="records"):
        value = str(row.get("source_global_id", "")).strip()
        if value:
            indexed[value] = row
    return indexed


def _has_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, float) and pd.isna(value):
        return False
    return bool(str(value).strip())
