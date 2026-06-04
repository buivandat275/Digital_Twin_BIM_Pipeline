from __future__ import annotations

import json
from pathlib import Path


STORE_FILES = {
    "assets": "assets.json",
    "locations": "locations.json",
    "systems": "systems.json",
    "properties": "properties.json",
}


def import_to_mock_store(preview_tables: dict, store_dir: str | Path) -> dict:
    store_dir = Path(store_dir)
    store_dir.mkdir(parents=True, exist_ok=True)
    counts = {}

    for table_name, file_name in STORE_FILES.items():
        rows = preview_tables.get(table_name, [])
        path = store_dir / file_name
        existing = _read_json(path)
        merged = _upsert_rows(table_name, existing, rows)
        path.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")
        counts[f"{table_name}_imported"] = len(rows)

    return counts


def load_store(store_dir: str | Path) -> dict:
    store_dir = Path(store_dir)
    return {
        table_name: _read_json(store_dir / file_name)
        for table_name, file_name in STORE_FILES.items()
    }


def _read_json(path: Path) -> list:
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []


def _upsert_rows(table_name: str, existing: list, incoming: list) -> list:
    key_fields = {
        "assets": ["asset_id", "source_global_id"],
        "locations": ["location_id"],
        "systems": ["system_id"],
        "properties": ["asset_id", "property_group", "property_name"],
    }
    keys = key_fields.get(table_name, [])
    if not keys:
        return existing + incoming

    indexed = {_row_key(row, keys): row for row in existing if _row_key(row, keys)}
    passthrough = [row for row in existing if not _row_key(row, keys)]
    for row in incoming:
        key = _row_key(row, keys)
        if key:
            indexed[key] = row
        else:
            passthrough.append(row)
    return passthrough + list(indexed.values())


def _row_key(row: dict, key_fields: list[str]) -> str:
    values = [str(row.get(field, "")).strip() for field in key_fields]
    if not all(values):
        return ""
    return "|".join(values)
