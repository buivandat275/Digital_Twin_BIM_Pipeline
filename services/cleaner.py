from __future__ import annotations

from collections import defaultdict
import os

from rules.classification_rules import (
    ASSET_TYPE_CODES,
    DISCIPLINE_CODES,
    classify_ifc_class,
    normalize_floor,
)


def apply_basic_clean(objects: list[dict], project_code: str) -> list[dict]:
    counters = defaultdict(int)
    cleaned = []

    for obj in objects:
        item = obj.copy()
        classification = classify_ifc_class(item.get("ifc_class", ""))
        item["asset_name"] = item.get("asset_name") or item.get("name") or "Unnamed Asset"
        item["asset_type"] = item.get("asset_type") or classification["asset_type"]
        item["discipline"] = item.get("discipline") or classification["discipline"]
        item["system"] = item.get("system") or classification["system"]
        item["system_code"] = item.get("system_code") or _system_code(item)
        floor = normalize_floor(item.get("floor", ""))
        item["floor"] = floor if not _is_blankish(floor) else "UNK"
        item["status"] = item.get("status") or "Active"
        item["criticality"] = item.get("criticality") or "Medium"
        item["maintainable"] = item.get("maintainable") or _default_maintainable(item)
        item["maintenance_strategy"] = item.get("maintenance_strategy") or _default_maintenance_strategy(item)
        item["expected_life_years"] = item.get("expected_life_years") or _default_expected_life(item)
        item["review_status"] = item.get("review_status") or "Pending"
        item["mapping_status"] = item.get("mapping_status") or "Pending"
        item["source_global_id"] = item.get("source_global_id") or item.get("global_id", "")
        item["ifc_guid"] = item.get("ifc_guid") or item.get("global_id", "")
        item["location"] = _clean_location(item)

        if not item.get("asset_id"):
            item["asset_id"] = _generate_asset_id(item, project_code, counters)
        item["dt_asset_code"] = item.get("dt_asset_code") or item.get("asset_id", "")
        item["cmms_asset_id"] = item.get("cmms_asset_id") or (
            f"CMMS-{item['asset_id']}" if item.get("maintainable") == "Yes" else ""
        )
        item["spare_part_group"] = item.get("spare_part_group") or _default_spare_part_group(item)
        if _default_realtime_enabled(item):
            item["realtime_enabled"] = item.get("realtime_enabled") or "Yes"
            item["history_enabled"] = item.get("history_enabled") or "Yes"
            item["protocol"] = item.get("protocol") or _default_protocol(item)
            item["gateway_id"] = item.get("gateway_id") or _default_gateway_id(item)
            item["device_id"] = item.get("device_id") or f"DEV-{item['asset_id']}"
            item["polling_interval_sec"] = item.get("polling_interval_sec") or "60"
            item["point_template"] = item.get("point_template") or _default_point_template(item)
        else:
            item["realtime_enabled"] = item.get("realtime_enabled") or "No"
            item["history_enabled"] = item.get("history_enabled") or "No"

        cleaned.append(item)
    return cleaned


def _generate_asset_id(obj: dict, project_code: str, counters: defaultdict) -> str:
    system_code = _system_code(obj)
    asset_type = obj.get("asset_type") or "Unknown"
    floor = obj.get("floor") or "UNK"
    key = (system_code, asset_type, floor)
    counters[key] += 1

    asset_type_code = ASSET_TYPE_CODES.get(asset_type, "UNK")
    sequence = f"{counters[key]:02d}"
    area_code = _clean_code(os.getenv("DT_AREA_CODE", "KT"), "KT")
    building_code = _clean_code(os.getenv("DT_BUILDING_CODE", project_code or "DTHQ"), "DTHQ")
    block_code = _clean_code(os.getenv("DT_BLOCK_CODE", "NA"), "NA")
    floor_code = _clean_code(floor, "UNK")
    return f"{area_code}-{building_code}-{block_code}-{floor_code}-{system_code}-{asset_type_code}-{sequence}"


def _system_code(obj: dict) -> str:
    discipline = obj.get("discipline") or "Unknown"
    system = str(obj.get("system") or "")
    if "HVAC" in system.upper():
        return "HVAC"
    if "FIRE" in system.upper() or discipline == "Fire Protection":
        return "FS"
    if discipline == "Electrical":
        return "LVS"
    if discipline == "Plumbing":
        return "PLB"
    if discipline == "Mechanical":
        return "MEC"
    return DISCIPLINE_CODES.get(discipline, "UNK")


def _clean_code(value: object, fallback: str) -> str:
    text = str(value or "").strip().upper().replace(" ", "")
    allowed = "".join(char for char in text if char.isalnum())
    return allowed or fallback


def _default_maintainable(obj: dict) -> str:
    if obj.get("ifc_class") in {"IfcSpace", "IfcGrid"}:
        return "No"
    return "Yes"


def _default_maintenance_strategy(obj: dict) -> str:
    if _default_maintainable(obj) != "Yes":
        return ""
    if _default_realtime_enabled(obj):
        return "preventive_and_condition_based"
    return "preventive"


def _default_expected_life(obj: dict) -> str:
    asset_type = str(obj.get("asset_type") or "").lower()
    if any(token in asset_type for token in ["chiller", "pump", "fan", "ahu", "unit"]):
        return "15"
    if any(token in asset_type for token in ["panel", "switch", "transformer", "generator"]):
        return "20"
    return "10" if _default_maintainable(obj) == "Yes" else ""


def _default_spare_part_group(obj: dict) -> str:
    if obj.get("maintainable") != "Yes":
        return ""
    return f"SPARE-{_system_code(obj)}-{_clean_code(obj.get('asset_type'), 'ASSET')}"


def _default_realtime_enabled(obj: dict) -> bool:
    if obj.get("maintainable") != "Yes":
        return False
    if str(obj.get("realtime_enabled", "")).strip().lower() in {"yes", "true", "1"}:
        return True
    if str(obj.get("realtime_enabled", "")).strip().lower() in {"no", "false", "0"}:
        return False
    ifc_class = str(obj.get("ifc_class") or "")
    asset_type = str(obj.get("asset_type") or "").lower()
    system = str(obj.get("system") or "").upper()
    realtime_classes = (
        "IfcDistribution",
        "IfcFlow",
        "IfcEnergyConversionDevice",
        "IfcElectric",
        "IfcController",
        "IfcSensor",
        "IfcActuator",
    )
    realtime_tokens = [
        "ahu",
        "chiller",
        "pump",
        "fan",
        "meter",
        "sensor",
        "damper",
        "valve",
        "panel",
        "generator",
        "ups",
        "elevator",
        "lift",
    ]
    return (
        ifc_class.startswith(realtime_classes)
        or any(token in asset_type for token in realtime_tokens)
        or any(token in system for token in ["HVAC", "BMS", "FIRE", "ELECTRICAL", "PLUMBING"])
    )


def _default_protocol(obj: dict) -> str:
    system_code = _system_code(obj)
    asset_type = str(obj.get("asset_type") or "").lower()
    if "meter" in asset_type or system_code in {"LVS", "ELV", "PLB"}:
        return "Modbus TCP"
    return "BACnet/IP"


def _default_gateway_id(obj: dict) -> str:
    protocol = _default_protocol(obj)
    if protocol == "Modbus TCP":
        return "BMS-MODBUS-TCP-01"
    return "BMS-BACNET-IP-01"


def _default_point_template(obj: dict) -> str:
    asset_type = str(obj.get("asset_type") or "").lower()
    if "meter" in asset_type:
        return "meter"
    if any(token in asset_type for token in ["pump", "fan", "chiller", "ahu", "unit"]):
        return "equipment"
    if any(token in asset_type for token in ["sensor"]):
        return "sensor"
    if any(token in asset_type for token in ["valve", "damper"]):
        return "actuator"
    return "generic"


def _clean_location(obj: dict) -> str:
    for value in [obj.get("location", ""), obj.get("building", "")]:
        if not _is_blankish(value):
            return value

    derived = _derive_structural_location(obj)
    if derived:
        return derived

    floor = obj.get("floor", "")
    return floor if not _is_blankish(floor) else "UNK"


def _derive_structural_location(obj: dict) -> str:
    property_sets = obj.get("property_sets", {})
    tekla_common = property_sets.get("Tekla Common", {})
    tekla_assembly = property_sets.get("Tekla Assembly", {})

    phase = tekla_common.get("Phase")
    bottom = tekla_common.get("Bottom elevation") or tekla_assembly.get("Assembly/Cast unit bottom elevation")
    top = tekla_common.get("Top elevation") or tekla_assembly.get("Assembly/Cast unit top elevation")
    position = tekla_assembly.get("Assembly/Cast unit position code")

    parts = []
    if not _is_blankish(phase):
        parts.append(f"Phase {phase}")
    if not _is_blankish(position):
        parts.append(f"Position {position}")
    if not _is_blankish(bottom) or not _is_blankish(top):
        parts.append(f"Elevation {bottom or '?'} to {top or '?'}")
    return " / ".join(parts)


def _is_blankish(value: object) -> bool:
    text = str(value or "").strip()
    return text == "" or text.lower() in {"undefined", "unknown", "unk", "n/a", "none", "null", "-"}
