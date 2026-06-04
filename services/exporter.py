from __future__ import annotations

import json
from pathlib import Path

import pandas as pd


def export_json(preview_tables: dict, output_dir: str | Path, project_id: str) -> Path:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{project_id}_digital_twin_export.json"
    path.write_text(json.dumps(preview_tables, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def export_csv(preview_tables: dict, output_dir: str | Path, project_id: str) -> list[Path]:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for table_name, rows in preview_tables.items():
        path = output_dir / f"{project_id}_{table_name}.csv"
        pd.DataFrame(rows).to_csv(path, index=False)
        paths.append(path)
    return paths


def export_excel(preview_tables: dict, output_dir: str | Path, project_id: str) -> Path:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{project_id}_digital_twin_export.xlsx"
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        for table_name, rows in preview_tables.items():
            df = pd.DataFrame(rows)
            if table_name == "assets":
                df = df.drop(columns=["technical_properties", "quantity_properties", "source_reference", "raw_metadata"], errors="ignore")
            df.to_excel(writer, sheet_name=table_name[:31], index=False)
    return path
