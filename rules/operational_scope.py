from __future__ import annotations

from collections import Counter


CONTEXT_CLASSES = {
    "IfcAnnotation",
    "IfcBeam",
    "IfcBuildingElementPart",
    "IfcColumn",
    "IfcCovering",
    "IfcCurtainWall",
    "IfcFooting",
    "IfcGrid",
    "IfcMember",
    "IfcPile",
    "IfcPlate",
    "IfcRailing",
    "IfcRamp",
    "IfcRoof",
    "IfcSlab",
    "IfcSpace",
    "IfcStair",
    "IfcWall",
    "IfcWallStandardCase",
}

MAINTAINABLE_CLASSES = {
    "IfcAudioVisualAppliance",
    "IfcCommunicationsAppliance",
    "IfcDoor",
    "IfcElectricAppliance",
    "IfcFireSuppressionTerminal",
    "IfcLightFixture",
    "IfcSanitaryTerminal",
    "IfcTransportElement",
    "IfcWindow",
}

REALTIME_CLASSES = {
    "IfcActuator",
    "IfcAirToAirHeatRecovery",
    "IfcAlarm",
    "IfcBoiler",
    "IfcChiller",
    "IfcController",
    "IfcCoolingTower",
    "IfcElectricGenerator",
    "IfcFan",
    "IfcFlowMeter",
    "IfcHeatExchanger",
    "IfcPump",
    "IfcSensor",
    "IfcSwitchingDevice",
    "IfcTransformer",
    "IfcUnitaryEquipment",
    "IfcValve",
}

EQUIPMENT_TOKENS = {
    "ahu",
    "alarm",
    "ats",
    "boiler",
    "camera",
    "chiller",
    "controller",
    "cooling tower",
    "damper",
    "điều hòa",
    "fan",
    "fcu",
    "generator",
    "meter",
    "panel",
    "pump",
    "sensor",
    "transformer",
    "ups",
    "valve",
    "vav",
}


def classify_operational_scope(obj: dict) -> dict:
    """Classify an IFC object without treating every piece of geometry as an O&M asset."""
    ifc_class = str(obj.get("ifc_class") or "").strip()
    maintainable = _yes_no(obj.get("maintainable"))
    realtime = _yes_no(obj.get("realtime_enabled"))
    probe = " ".join(
        str(obj.get(field) or "").lower()
        for field in ("asset_name", "name", "asset_type", "object_type", "system")
    )

    if maintainable == "no":
        return _result("context", "IFC khai báo Maintainable = No", "ifc_property")
    if realtime == "yes":
        return _result("realtime", "IFC khai báo Realtime Enabled = Yes", "ifc_property")
    if maintainable == "yes":
        scope = "realtime" if ifc_class in REALTIME_CLASSES else "maintainable"
        return _result(scope, "IFC khai báo Maintainable = Yes", "ifc_property")
    if ifc_class in CONTEXT_CLASSES:
        return _result("context", f"{ifc_class} được giữ làm bối cảnh 3D", "ifc_class")
    if ifc_class in REALTIME_CLASSES:
        return _result("realtime", f"{ifc_class} là thiết bị có khả năng kết nối dữ liệu", "ifc_class")
    if ifc_class in MAINTAINABLE_CLASSES:
        return _result("maintainable", f"{ifc_class} là tài sản cần quản lý/bảo trì", "ifc_class")
    if ifc_class == "IfcBuildingElementProxy" or any(token in probe for token in EQUIPMENT_TOKENS):
        return _result(
            "scope_review",
            "Object có dấu hiệu là thiết bị nhưng chưa đủ thông tin để tự động đưa vào vận hành",
            "inference",
        )
    return _result("context", f"{ifc_class or 'IFC object'} chưa thuộc danh mục asset vận hành", "default")


def is_operational_scope(scope: str) -> bool:
    return scope in {"maintainable", "realtime"}


def summarize_operational_scope(objects: list[dict]) -> dict:
    counts = Counter(
        str(obj.get("operational_scope") or classify_operational_scope(obj)["operational_scope"])
        for obj in objects
    )
    return {
        "total_objects": len(objects),
        "context_objects": counts["context"],
        "scope_review_objects": counts["scope_review"],
        "maintainable_assets": counts["maintainable"],
        "realtime_assets": counts["realtime"],
        "operational_assets": counts["maintainable"] + counts["realtime"],
    }


def _result(scope: str, reason: str, source: str) -> dict:
    return {
        "operational_scope": scope,
        "operational_scope_reason": reason,
        "operational_scope_source": source,
    }


def _yes_no(value: object) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"yes", "true", "1", "y", "có", "co"}:
        return "yes"
    if normalized in {"no", "false", "0", "n", "không", "khong"}:
        return "no"
    return ""
