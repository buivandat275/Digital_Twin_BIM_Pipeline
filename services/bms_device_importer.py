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


def merge_bms_devices(
    objects: list[dict],
    bms_df: pd.DataFrame,
) -> tuple[list[dict], pd.DataFrame, dict]:
    normalized_bms = normalize_bms_dataframe(bms_df)
    object_indexes: dict[str, list[int]] = defaultdict(list)
    for index, obj in enumerate(objects):
        for field in ("EMSD.Common.Asset Code", "VSF.Common.Asset Code", "asset_id", "dt_asset_code"):
            code = _normalize_code(obj.get(field))
            if code and index not in object_indexes[code]:
                object_indexes[code].append(index)

    merged = [obj.copy() for obj in objects]
    logs = []
    matched_rows = 0
    matched_objects: set[int] = set()

    for row_number, row in enumerate(normalized_bms.to_dict(orient="records"), start=2):
        asset_code = _clean_value(row.get("AssetCode"))
        matches = object_indexes.get(_normalize_code(asset_code), [])
        if not matches:
            logs.append(
                {
                    "row": row_number,
                    "asset_code": asset_code,
                    "bms_device_id": _clean_value(row.get("BMSDeviceID")),
                    "result": "Không tìm thấy AssetCode",
                    "matched_objects": 0,
                    "changed_fields": "",
                }
            )
            continue

        matched_rows += 1
        row_changed_fields: set[str] = set()
        for object_index in matches:
            matched_objects.add(object_index)
            item = merged[object_index]
            changed_fields = _apply_bms_row(item, row)
            row_changed_fields.update(changed_fields)

        logs.append(
            {
                "row": row_number,
                "asset_code": asset_code,
                "bms_device_id": _clean_value(row.get("BMSDeviceID")),
                "result": "Đã map" if len(matches) == 1 else "Đã map nhiều object - cần kiểm tra AssetCode trùng",
                "matched_objects": len(matches),
                "changed_fields": ", ".join(sorted(row_changed_fields)),
            }
        )

    summary = {
        "bms_rows": len(normalized_bms),
        "matched_rows": matched_rows,
        "unmatched_rows": len(normalized_bms) - matched_rows,
        "matched_objects": len(matched_objects),
        "duplicate_matches": sum(1 for row in logs if row["matched_objects"] > 1),
    }
    return merged, pd.DataFrame(logs), summary


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
