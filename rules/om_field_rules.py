from __future__ import annotations


OM_FIELD_NAMES = [
    "EMSD.Common.Asset Code",
    "EMSD.Common.Asset Tag No.",
    "EMSD.Common.Manufacturer",
    "VSF.Common.Asset Code",
    "VSF.Common.Asset Tag No.",
    "VSF.Common.Manufacturer",
    "VSF.Location",
    "VSF.Link",
    "VSF.Status",
    "VSF.Document",
]

OM_FIELD_GUIDANCE = {
    "EMSD.Common.Asset Code": "Nhập mã asset theo quy ước EMSD.",
    "EMSD.Common.Asset Tag No.": "Nhập số tag EMSD gắn với object/thiết bị.",
    "EMSD.Common.Manufacturer": "Nhập nhà sản xuất theo hồ sơ hoặc nameplate.",
    "VSF.Common.Asset Code": "Nhập mã asset theo quy ước VSF.",
    "VSF.Common.Asset Tag No.": "Nhập số tag VSF gắn với object/thiết bị.",
    "VSF.Common.Manufacturer": "Nhập nhà sản xuất theo hồ sơ hoặc nameplate.",
    "VSF.Location": "Lấy từ vị trí IFC; kiểm tra và sửa nếu vị trí thực tế khác.",
    "VSF.Link": "Nhập URL hoặc mã liên kết tới hệ thống/hồ sơ liên quan.",
    "VSF.Status": "Nhập trạng thái sử dụng, ví dụ Active, Inactive hoặc Pending.",
    "VSF.Document": "Nhập URL/mã tài liệu, manual, submittal hoặc hồ sơ bàn giao.",
}


def extract_om_fields(property_sets: dict, ifc_location: str = "") -> tuple[dict, dict]:
    """Read the ten requested fields by exact property name, then derive VSF.Location."""
    values = {field: "" for field in OM_FIELD_NAMES}
    sources = {field: "missing" for field in OM_FIELD_NAMES}

    for properties in property_sets.values():
        if not isinstance(properties, dict):
            continue
        for field in OM_FIELD_NAMES:
            value = properties.get(field)
            if _has_value(value):
                values[field] = value
                sources[field] = "ifc_property"

    if not _has_value(values["VSF.Location"]) and _has_value(ifc_location):
        values["VSF.Location"] = ifc_location
        sources["VSF.Location"] = "ifc_spatial"

    return values, sources


def missing_om_fields(obj: dict) -> list[str]:
    return [field for field in OM_FIELD_NAMES if not _has_value(obj.get(field))]


def _has_value(value: object) -> bool:
    return value is not None and bool(str(value).strip())
