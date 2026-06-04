from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from rules.field_policy import get_template_fields, get_validated_fields

IDENTITY_COLUMNS = [
    "source_global_id",
    "object_name",
    "source_ifc_class",
    "object_type",
    "source_file",
    "missing_required_fields",
]


def build_correction_template(objects: list[dict], profile_name: str) -> pd.DataFrame:
    required_fields = get_validated_fields(profile_name)
    template_fields = get_template_fields(profile_name)
    rows = []

    for obj in objects:
        missing = [field for field in required_fields if not obj.get(field)]
        if not missing:
            continue

        row = {
            "source_global_id": obj.get("global_id") or obj.get("source_global_id", ""),
            "object_name": obj.get("asset_name") or obj.get("name", ""),
            "source_ifc_class": obj.get("ifc_class", ""),
            "object_type": obj.get("object_type", ""),
            "source_file": obj.get("source_file", ""),
            "missing_required_fields": ", ".join(missing),
        }
        for field in template_fields:
            row[field] = obj.get(field, "")
        rows.append(row)

    return pd.DataFrame(rows, columns=IDENTITY_COLUMNS + template_fields)


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
    raise ValueError("Correction template must be a CSV or Excel file.")


def merge_correction_template(
    objects: list[dict],
    correction_df: pd.DataFrame,
    profile_name: str,
) -> tuple[list[dict], pd.DataFrame]:
    template_fields = set(get_template_fields(profile_name))
    editable_fields = [field for field in correction_df.columns if field in template_fields]
    corrections = _index_corrections(correction_df)

    merged = []
    log_rows = []
    for obj in objects:
        item = obj.copy()
        keys = [
            item.get("global_id", ""),
            item.get("source_global_id", ""),
            item.get("asset_id", ""),
        ]
        correction = next((corrections[key] for key in keys if key in corrections), None)
        if correction is None:
            merged.append(item)
            continue

        changed_fields = []
        for field in editable_fields:
            value = correction.get(field, "")
            if _has_value(value):
                old_value = item.get(field, "")
                item[field] = value
                if old_value != value:
                    changed_fields.append(field)

        if changed_fields:
            log_rows.append(
                {
                    "source_global_id": item.get("global_id") or item.get("source_global_id", ""),
                    "asset_id": item.get("asset_id", ""),
                    "object_name": item.get("asset_name") or item.get("name", ""),
                    "changed_fields": ", ".join(changed_fields),
                    "changed_count": len(changed_fields),
                }
            )
        merged.append(item)

    return merged, pd.DataFrame(log_rows)


def _index_corrections(correction_df: pd.DataFrame) -> dict[str, dict]:
    indexed = {}
    for row in correction_df.to_dict(orient="records"):
        for key_field in ["source_global_id", "asset_id"]:
            value = str(row.get(key_field, "")).strip()
            if value:
                indexed[value] = row
    return indexed


def _has_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, float) and pd.isna(value):
        return False
    return str(value).strip() != ""
