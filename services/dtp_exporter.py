from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd


DTP_SCHEMA_VERSION = "1.0.0"
DTP_SCHEMA_NAME = "BIM_to_DigitalTwin_Handover_JSON"


def build_dtp_handover(
    preview_tables: dict,
    project_id: str,
    project_name: str,
) -> dict[str, list[dict]]:
    assets = preview_tables.get("assets", [])
    locations = preview_tables.get("locations", [])
    systems = preview_tables.get("systems", [])
    properties = preview_tables.get("properties", [])
    devices = _device_rows(assets)
    points = _point_rows(assets, devices)
    gateways = _gateway_rows(devices)
    bms_mapping = _bms_mapping_rows(devices, points)

    return {
        "01_Project_Facility": [_project_facility_row(project_id, project_name)],
        "02_SourceModels": _source_model_rows(assets),
        "03_Floors": _floor_rows(locations),
        "04_Spaces": _space_rows(locations),
        "05_Zones": _zone_rows(assets),
        "06_IFC_Objects": _ifc_object_rows(assets),
        "07_IFC_Metadata_EAV": _metadata_eav_rows(assets, properties),
        "08_Asset_IFC_Mapping": _asset_ifc_mapping_rows(assets),
        "09_Assets": _dtp_asset_rows(assets),
        "10_Devices": devices,
        "11_Points": points,
        "12_Gateways": gateways,
        "13_BMS_Mapping": bms_mapping,
        "14_CMMS_O&M": _cmms_rows(assets),
        "15_Documents": _document_rows(assets),
        "16_FieldDictionary": _field_dictionary_rows(),
        "17_NamingRules": _naming_rule_rows(),
        "18_Standards_Assessment": _assessment_rows(assets),
        "19_Checklist": _checklist_rows(),
    }


def export_dtp_excel(dtp_tables: dict[str, list[dict]], output_dir: str | Path, project_id: str) -> Path:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{project_id}_DTP_handover.xlsx"
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        for sheet_name, rows in dtp_tables.items():
            pd.DataFrame(rows).to_excel(writer, sheet_name=sheet_name[:31], index=False)
    return path


def export_dtp_json(
    dtp_tables: dict[str, list[dict]],
    output_dir: str | Path,
    project_id: str,
    project_name: str,
) -> Path:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": DTP_SCHEMA_VERSION,
        "schema_name": DTP_SCHEMA_NAME,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "language": "vi-VN",
        "purpose": "Chuyển giao dữ liệu BIM/IFC sang Digital Twin Platform phục vụ vận hành.",
        "standards_reference": [
            "IFC / ISO 16739",
            "COBie handover",
            "ISO 19650 / TCVN 14177",
            "BIM PipeLineDigital_Twin_v2026.06.10",
        ],
        "project": {
            "project_id": project_id,
            "project_name": project_name,
            "handover_stage": "As-built / Handover to Operations",
        },
        "facility": dtp_tables.get("01_Project_Facility", [{}])[0],
        "floors": dtp_tables.get("03_Floors", []),
        "spaces": dtp_tables.get("04_Spaces", []),
        "zones": dtp_tables.get("05_Zones", []),
        "ifc_objects": dtp_tables.get("06_IFC_Objects", []),
        "ifc_metadata_eav": dtp_tables.get("07_IFC_Metadata_EAV", []),
        "asset_ifc_mapping": dtp_tables.get("08_Asset_IFC_Mapping", []),
        "assets": dtp_tables.get("09_Assets", []),
        "devices": dtp_tables.get("10_Devices", []),
        "points": dtp_tables.get("11_Points", []),
        "integrations": {
            "gateways": dtp_tables.get("12_Gateways", []),
            "bms_mapping": dtp_tables.get("13_BMS_Mapping", []),
            "data_flow": _data_flow_rows(),
            "cmms_om": dtp_tables.get("14_CMMS_O&M", []),
        },
        "validation_rules": dtp_tables.get("16_FieldDictionary", []),
        "handover_checklist": dtp_tables.get("19_Checklist", []),
    }
    path = output_dir / f"{project_id}_DTP_handover.json"
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def _project_facility_row(project_id: str, project_name: str) -> dict:
    return {
        "schema_version": DTP_SCHEMA_VERSION,
        "schema_name": DTP_SCHEMA_NAME,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "language": "vi-VN",
        "project_id": project_id,
        "project_name": project_name,
        "owner": "Chủ đầu tư (CĐT)",
        "handover_stage": "As-built / Handover to Operations",
        "coordinate_reference_system": "",
        "facility_id": f"FAC-{project_id}",
        "facility_name": project_name,
        "facility_type": "",
        "unit_length": "m",
        "unit_area": "m2",
        "unit_volume": "m3",
    }


def _source_model_rows(assets: list[dict]) -> list[dict]:
    rows = {}
    for asset in assets:
        source_file = asset.get("source_file", "")
        if not source_file:
            continue
        rows[source_file] = {
            "model_id": f"IFC-{len(rows) + 1:03d}",
            "discipline": asset.get("system_code") or asset.get("system") or "",
            "file_name": source_file,
            "ifc_version": "",
            "model_revision": "",
            "checksum_sha256": "",
            "source_location": "CDE/IFC",
            "review_status": "Pending",
        }
    return list(rows.values())


def _floor_rows(locations: list[dict]) -> list[dict]:
    rows = {}
    for location in locations:
        floor = location.get("floor", "") or "UNK"
        rows[floor] = {
            "floor_id": f"FL-{floor}",
            "name": floor,
            "level_code": floor,
            "elevation_m": "",
            "area_m2": "",
            "ifc_building_storey_guid": "",
            "dtp_layer_id": f"LAYER-3D-{floor}",
            "status": "active",
            "review_status": "Pending",
        }
    return list(rows.values())


def _space_rows(locations: list[dict]) -> list[dict]:
    rows = {}
    for location in locations:
        room = location.get("room_zone", "")
        if not room:
            continue
        floor = location.get("floor", "") or "UNK"
        key = f"{floor}-{room}"
        rows[key] = {
            "space_id": f"SP-{_safe_code(key)}",
            "name": room,
            "floor_id": f"FL-{floor}",
            "space_type": "",
            "area_m2": "",
            "ifc_space_guid": "",
            "cobie_space_name": room,
            "occupancy_capacity": "",
            "dtp_zone_ids": "",
            "review_status": "Pending",
        }
    return list(rows.values())


def _zone_rows(assets: list[dict]) -> list[dict]:
    rows = {}
    for asset in assets:
        system_code = asset.get("system_code") or "UNK"
        floor = asset.get("floor") or "UNK"
        zone_id = f"ZONE-{system_code}-{floor}"
        rows[zone_id] = {
            "zone_id": zone_id,
            "name": f"{asset.get('system') or system_code} {floor}",
            "zone_type": asset.get("system") or "",
            "floor_id": f"FL-{floor}",
            "space_ids": "",
            "default_color": "#808080",
            "realtime_color_rule_id": f"RULE-COLOR-{zone_id}",
            "review_status": "Pending",
        }
    return list(rows.values())


def _ifc_object_rows(assets: list[dict]) -> list[dict]:
    return [
        {
            "ifc_guid": asset.get("source_global_id") or asset.get("ifc_guid", ""),
            "ifc_entity": asset.get("ifc_class", ""),
            "ifc_name": asset.get("asset_name", ""),
            "ifc_object_type": asset.get("asset_type", ""),
            "ifc_description": "",
            "ifc_tag": asset.get("dt_asset_code") or asset.get("asset_id", ""),
            "predefined_type": "",
            "source_model_id": asset.get("source_file", ""),
            "facility_id": "",
            "floor_id": f"FL-{asset.get('floor', '')}" if asset.get("floor") else "",
            "space_id": asset.get("room_zone", ""),
            "zone_id": f"ZONE-{asset.get('system_code', 'UNK')}-{asset.get('floor', 'UNK')}",
            "review_status": asset.get("review_status", "Pending"),
        }
        for asset in assets
    ]


def _metadata_eav_rows(assets: list[dict], properties: list[dict]) -> list[dict]:
    rows = []
    asset_index = {asset.get("asset_id"): asset for asset in assets}
    for asset in assets:
        core = {
            "asset_id": asset.get("asset_id", ""),
            "asset_name": asset.get("asset_name", ""),
            "asset_type": asset.get("asset_type", ""),
            "system": asset.get("system", ""),
            "system_code": asset.get("system_code", ""),
            "floor": asset.get("floor", ""),
            "room_zone": asset.get("room_zone", ""),
            "criticality": asset.get("criticality", ""),
            "maintainable": asset.get("maintainable", ""),
        }
        for key, value in core.items():
            rows.append(_eav_row(asset, "DTP_Core", key, value, "Yes"))
    for prop in properties:
        asset = asset_index.get(prop.get("asset_id", ""), {})
        rows.append(
            _eav_row(
                asset,
                prop.get("property_group", ""),
                prop.get("property_name", ""),
                prop.get("property_value", ""),
                "Conditional",
            )
        )
    return rows


def _eav_row(asset: dict, group: str, key: str, value: Any, required: str) -> dict:
    return {
        "object_guid": asset.get("source_global_id") or asset.get("ifc_guid", ""),
        "object_name": asset.get("asset_name", ""),
        "object_entity": asset.get("ifc_class", ""),
        "metadata_group": group,
        "metadata_key": key,
        "metadata_value": value,
        "data_type": _data_type(value),
        "unit": "",
        "source": "IFC/DTP",
        "loi_required": required,
        "mapped_to_json_path": "",
        "responsible_party": "BIM Contractor",
        "review_status": asset.get("review_status", "Pending"),
    }


def _asset_ifc_mapping_rows(assets: list[dict]) -> list[dict]:
    return [
        {
            "asset_id": asset.get("asset_id", ""),
            "ifc_guid": asset.get("source_global_id") or asset.get("ifc_guid", ""),
            "ifc_entity": asset.get("ifc_class", ""),
            "mapping_key": "asset_id|ifc_guid",
            "mapping_status": asset.get("mapping_status", "Pending"),
            "mapping_owner": "BIM Contractor",
            "source_file": asset.get("source_file", ""),
        }
        for asset in assets
    ]


def _dtp_asset_rows(assets: list[dict]) -> list[dict]:
    return [
        {
            "asset_id": asset.get("asset_id", ""),
            "dt_asset_code": asset.get("dt_asset_code") or asset.get("asset_id", ""),
            "asset_name": asset.get("asset_name", ""),
            "asset_type": asset.get("asset_type", ""),
            "system_code": asset.get("system_code", ""),
            "system_name": asset.get("system", ""),
            "floor_id": f"FL-{asset.get('floor', '')}" if asset.get("floor") else "",
            "space_id": asset.get("room_zone", ""),
            "ifc_guid": asset.get("source_global_id") or asset.get("ifc_guid", ""),
            "manufacturer": asset.get("manufacturer", ""),
            "model_number": asset.get("model", ""),
            "serial_number": asset.get("serial_number", ""),
            "installation_date": asset.get("installation_date", ""),
            "warranty_start_date": asset.get("warranty_start_date", ""),
            "warranty_end_date": asset.get("warranty_end_date", ""),
            "criticality": asset.get("criticality", ""),
            "maintainable": asset.get("maintainable", ""),
            "expected_life_years": asset.get("expected_life_years", ""),
            "maintenance_strategy": asset.get("maintenance_strategy", ""),
            "cmms_asset_id": asset.get("cmms_asset_id", ""),
            "device_id": asset.get("device_id", ""),
            "realtime_enabled": asset.get("realtime_enabled", ""),
            "history_enabled": asset.get("history_enabled", ""),
            "status": asset.get("status", ""),
            "review_status": asset.get("review_status", "Pending"),
        }
        for asset in assets
    ]


def _cmms_rows(assets: list[dict]) -> list[dict]:
    return [
        {
            "asset_id": asset.get("asset_id", ""),
            "cmms_asset_id": asset.get("cmms_asset_id") or f"CMMS-{asset.get('asset_id', '')}",
            "maintenance_plan_code": asset.get("maintenance_info", ""),
            "maintenance_strategy": asset.get("maintenance_strategy", ""),
            "criticality": asset.get("criticality", ""),
            "expected_life_years": asset.get("expected_life_years", ""),
            "spare_part_group": asset.get("spare_part_group", ""),
            "manual_url": asset.get("manual_url", ""),
            "installation_date": asset.get("installation_date", ""),
            "warranty_start_date": asset.get("warranty_start_date", ""),
            "warranty_end_date": asset.get("warranty_end_date", ""),
            "warranty": asset.get("warranty", ""),
            "review_status": asset.get("review_status", "Pending"),
        }
        for asset in assets
        if _is_maintainable(asset)
    ]


def _document_rows(assets: list[dict]) -> list[dict]:
    rows = []
    for asset in assets:
        documentation = asset.get("source_reference", {}).get("documentation", "")
        if documentation:
            rows.append(
                {
                    "document_id": f"DOC-{asset.get('asset_id', '')}",
                    "asset_id": asset.get("asset_id", ""),
                    "document_type": "Documentation",
                    "url": documentation,
                    "review_status": "Pending",
                }
            )
    return rows


def _device_rows(assets: list[dict]) -> list[dict]:
    rows = []
    for asset in assets:
        if not _is_realtime_asset(asset):
            continue
        protocol = asset.get("protocol") or _default_protocol(asset)
        gateway_id = asset.get("gateway_id") or _default_gateway_id(protocol)
        safe_asset_id = _safe_code(asset.get("asset_id", ""))
        device_id = asset.get("device_id") or f"DEV-{safe_asset_id}"
        rows.append(
            {
                "device_id": device_id,
                "asset_id": asset.get("asset_id", ""),
                "device_name": f"Controller / Interface for {asset.get('asset_name') or asset.get('asset_id', '')}",
                "gateway_id": gateway_id,
                "protocol": protocol,
                "connection_status": "mapped_pending_live_test",
                "bms_object_mapping": {
                    "bacnet_device_id": asset.get("bms_device_id", "") if protocol == "BACnet/IP" else "",
                    "modbus_slave_id": asset.get("modbus_slave_id", "") if protocol == "Modbus TCP" else "",
                    "mqtt_topic": asset.get("mqtt_topic", ""),
                    "rest_endpoint": asset.get("rest_endpoint", ""),
                    "onvif_profile_url": asset.get("onvif_profile_url", ""),
                },
                "data_quality": {
                    "mapping_verified": asset.get("mapping_status") == "Mapped",
                    "last_commissioning_test": "",
                    "expected_polling_interval_sec": _to_int(asset.get("polling_interval_sec"), 60),
                },
                "review_status": asset.get("review_status", "Pending"),
            }
        )
    return rows


def _point_rows(assets: list[dict], devices: list[dict]) -> list[dict]:
    device_by_asset = {device["asset_id"]: device for device in devices}
    rows = []
    for asset in assets:
        device = device_by_asset.get(asset.get("asset_id", ""))
        if not device:
            continue
        safe_asset_id = _safe_code(asset.get("asset_id", ""))
        for template in _point_templates(asset):
            point_code = template["code"]
            point_id = f"PT-{safe_asset_id}-{point_code}"
            rows.append(
                {
                    "point_id": point_id,
                    "asset_id": asset.get("asset_id", ""),
                    "device_id": device["device_id"],
                    "point_name": template["name"],
                    "point_type": template["point_type"],
                    "kind": template["kind"],
                    "unit": template["unit"],
                    "writable": template["writable"],
                    "sample_value": template["sample_value"],
                    "normal_range": template["normal_range"],
                    "alarm_rule_id": f"ALARM-{point_id}" if template["alarm"] else "",
                    "history_retention_days": 1095 if asset.get("history_enabled") == "Yes" else 0,
                    "tags": template["tags"],
                    "review_status": asset.get("review_status", "Pending"),
                }
            )
    return rows


def _gateway_rows(devices: list[dict]) -> list[dict]:
    rows = {}
    for device in devices:
        gateway_id = device.get("gateway_id", "")
        if not gateway_id:
            continue
        protocol = device.get("protocol", "")
        rows[gateway_id] = {
            "gateway_id": gateway_id,
            "system_name": _gateway_system_name(protocol),
            "vendor": "BMS Vendor",
            "protocol": protocol,
            "host": "",
            "port": _gateway_port(protocol),
            "auth_method": "network_acl_vpn",
            "data_direction": "read_write_for_allowed_command_points",
            "review_status": "Pending",
        }
    return list(rows.values())


def _bms_mapping_rows(devices: list[dict], points: list[dict]) -> list[dict]:
    device_by_id = {device["device_id"]: device for device in devices}
    rows = []
    for point in points:
        device = device_by_id.get(point.get("device_id", ""), {})
        rows.append(
            {
                "asset_id": point.get("asset_id", ""),
                "device_id": point.get("device_id", ""),
                "point_id": point.get("point_id", ""),
                "gateway_id": device.get("gateway_id", ""),
                "protocol": device.get("protocol", ""),
                "bms_native_address": _native_point_address(device, point),
                "mapping_status": "Pending live test",
                "read_write": "write" if point.get("writable") else "read",
                "review_status": point.get("review_status", "Pending"),
            }
        )
    return rows


def _data_flow_rows() -> list[dict]:
    return [
        {
            "from": "IFC/COBie",
            "to": "DTP Asset Registry",
            "method": "ETL import",
            "key_mapping": "ifc_guid + asset_id",
        },
        {
            "from": "BMS/IoT/DMP",
            "to": "DTP Twin State Engine",
            "method": "BACnet/Modbus/MQTT/REST ingestion",
            "key_mapping": "device_id + point_id -> asset_id state",
        },
        {
            "from": "DTP Twin State Engine",
            "to": "3D Viewer",
            "method": "object selection + live state overlay",
            "key_mapping": "asset_id + ifc_guid",
        },
        {
            "from": "DTP Asset Registry",
            "to": "CMMS",
            "method": "API/File sync",
            "key_mapping": "asset_id -> cmms_asset_id",
        },
    ]


def _is_realtime_asset(asset: dict) -> bool:
    if asset.get("realtime_enabled") == "Yes":
        return True
    if asset.get("realtime_enabled") == "No":
        return False
    if not _is_maintainable(asset):
        return False
    ifc_class = str(asset.get("ifc_class") or "")
    asset_type = str(asset.get("asset_type") or "").lower()
    system = str(asset.get("system") or "").upper()
    realtime_classes = (
        "IfcEnergyConversionDevice",
        "IfcFlowController",
        "IfcFlowMovingDevice",
        "IfcFlowTerminal",
        "IfcFlowTreatmentDevice",
        "IfcElectricAppliance",
        "IfcElectricDistributionBoard",
        "IfcElectricFlowStorageDevice",
        "IfcController",
        "IfcSensor",
        "IfcActuator",
    )
    tokens = [
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
        or any(token in asset_type for token in tokens)
        or any(token in system for token in ["HVAC", "BMS", "FIRE", "ELECTRICAL", "PLUMBING"])
    )


def _is_maintainable(asset: dict) -> bool:
    value = str(asset.get("maintainable") or "").strip().lower()
    if value in {"yes", "true", "1"}:
        return True
    if value in {"no", "false", "0"}:
        return False
    if asset.get("ifc_class") in {"IfcSpace", "IfcGrid"}:
        return False
    return True


def _point_templates(asset: dict) -> list[dict]:
    template_name = str(asset.get("point_template") or "").lower()
    asset_type = str(asset.get("asset_type") or "").lower()
    if not template_name or template_name == "generic":
        if "meter" in asset_type:
            template_name = "meter"
        elif "sensor" in asset_type:
            template_name = "sensor"
        elif "valve" in asset_type or "damper" in asset_type:
            template_name = "actuator"
        elif any(token in asset_type for token in ["pump", "fan", "chiller", "ahu", "unit"]):
            template_name = "equipment"
        else:
            template_name = "generic"

    common_status = [
        _point("RUN_STATUS", "Run Status", "sensor", "status", "boolean", False, False, None, None, ["run", "status"]),
        _point("FAULT_STATUS", "Fault Status", "sensor", "fault", "boolean", False, True, None, None, ["fault", "alarm"]),
    ]
    if template_name == "meter":
        return [
            _point("ENERGY_TOTAL", "Energy Total", "sensor", "meter", "kWh", False, False, 0, None, ["energy", "total"]),
            _point("POWER_DEMAND", "Power Demand", "sensor", "measurement", "kW", False, False, 0, None, ["power", "demand"]),
            _point("COMM_STATUS", "Communication Status", "sensor", "status", "boolean", False, True, None, None, ["communication"]),
        ]
    if template_name == "sensor":
        return [
            _point("PRESENT_VALUE", "Present Value", "sensor", "measurement", "", False, False, None, None, ["sensor"]),
            _point("FAULT_STATUS", "Fault Status", "sensor", "fault", "boolean", False, True, None, None, ["fault", "alarm"]),
        ]
    if template_name == "actuator":
        return common_status + [
            _point("POSITION_FEEDBACK", "Position Feedback", "sensor", "measurement", "%", False, False, 0, 100, ["position"]),
            _point("POSITION_COMMAND", "Position Command", "command", "setpoint", "%", True, 0, 0, 100, ["command", "position"]),
        ]
    if template_name == "equipment":
        return common_status + [
            _point("COMMAND", "Start Stop Command", "command", "command", "boolean", True, False, None, None, ["command"]),
            _point("SPEED_FEEDBACK", "Speed Feedback", "sensor", "measurement", "%", False, 0, 0, 100, ["speed"]),
            _point("POWER", "Power", "sensor", "measurement", "kW", False, 0, 0, None, ["power"]),
        ]
    return [
        _point("STATUS", "Status", "sensor", "status", "boolean", False, True, None, None, ["status"]),
        _point("FAULT_STATUS", "Fault Status", "sensor", "fault", "boolean", False, False, None, None, ["fault", "alarm"]),
    ]


def _point(
    code: str,
    name: str,
    point_type: str,
    kind: str,
    unit: str,
    writable: bool,
    sample_value: object,
    range_min: object,
    range_max: object,
    tags: list[str],
) -> dict:
    return {
        "code": code,
        "name": name,
        "point_type": point_type,
        "kind": kind,
        "unit": unit,
        "writable": writable,
        "sample_value": sample_value,
        "normal_range": {"min": range_min, "max": range_max},
        "alarm": kind in {"fault", "status"},
        "tags": tags,
    }


def _default_protocol(asset: dict) -> str:
    system_code = str(asset.get("system_code") or "").upper()
    asset_type = str(asset.get("asset_type") or "").lower()
    if "meter" in asset_type or system_code in {"LVS", "ELV", "PLB"}:
        return "Modbus TCP"
    return "BACnet/IP"


def _default_gateway_id(protocol: str) -> str:
    if protocol == "Modbus TCP":
        return "BMS-MODBUS-TCP-01"
    if protocol == "MQTT":
        return "IOT-MQTT-01"
    if protocol == "REST":
        return "API-REST-01"
    if protocol == "ONVIF":
        return "VMS-ONVIF-01"
    return "BMS-BACNET-IP-01"


def _gateway_system_name(protocol: str) -> str:
    if protocol == "Modbus TCP":
        return "Electrical/Water Meter Gateway"
    if protocol == "MQTT":
        return "IoT MQTT Broker"
    if protocol == "REST":
        return "REST API Gateway"
    if protocol == "ONVIF":
        return "Video Management System"
    return "Building Management System"


def _gateway_port(protocol: str) -> int | str:
    if protocol == "BACnet/IP":
        return 47808
    if protocol == "Modbus TCP":
        return 502
    if protocol == "MQTT":
        return 1883
    if protocol == "ONVIF":
        return 80
    return ""


def _native_point_address(device: dict, point: dict) -> str:
    mapping = device.get("bms_object_mapping", {})
    protocol = device.get("protocol", "")
    point_code = str(point.get("point_id", "")).rsplit("-", 1)[-1]
    if protocol == "BACnet/IP":
        device_id = mapping.get("bacnet_device_id") or device.get("device_id", "")
        return f"bacnet://{device_id}/{point_code}"
    if protocol == "Modbus TCP":
        slave_id = mapping.get("modbus_slave_id") or device.get("device_id", "")
        return f"modbus://{slave_id}/{point_code}"
    if protocol == "MQTT":
        topic = mapping.get("mqtt_topic") or f"dtp/{point.get('asset_id', '')}"
        return f"{topic}/{point_code.lower()}"
    if protocol == "REST":
        endpoint = mapping.get("rest_endpoint") or ""
        return f"{endpoint}/{point_code.lower()}".strip("/")
    return point_code


def _to_int(value: object, fallback: int) -> int:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return fallback


def _field_dictionary_rows() -> list[dict]:
    required = [
        "asset_id",
        "asset_name",
        "asset_type",
        "system_code",
        "floor_id",
        "ifc_guid",
        "manufacturer",
        "model_number",
        "criticality",
        "maintainable",
        "maintenance_strategy",
        "cmms_asset_id",
        "device_id",
        "gateway_id",
        "protocol",
        "point_id",
    ]
    return [
        {
            "field_name": field,
            "object_type": "Asset",
            "loi_required": "Yes",
            "source": "BIM PipelineDigital_Twin_v2026.06.10",
        }
        for field in required
    ]


def _naming_rule_rows() -> list[dict]:
    return [
        {
            "rule_id": "DT-ASSET-7-PART",
            "description": "Area-Building-Block-Floor-System-Equipment-Sequence",
            "example": "KT-DTHQ-NA-1F-HVAC-FCU-01",
            "status": "active",
        }
    ]


def _assessment_rows(assets: list[dict]) -> list[dict]:
    return [
        {
            "check_group": "Asset LOI",
            "total_assets": len(assets),
            "missing_asset_id": sum(1 for asset in assets if not asset.get("asset_id")),
            "missing_ifc_guid": sum(1 for asset in assets if not asset.get("source_global_id")),
            "missing_manufacturer": sum(1 for asset in assets if not asset.get("manufacturer")),
            "missing_model": sum(1 for asset in assets if not asset.get("model")),
            "missing_cmms_asset_id": sum(
                1 for asset in assets if asset.get("maintainable") == "Yes" and not asset.get("cmms_asset_id")
            ),
            "realtime_assets": sum(1 for asset in assets if _is_realtime_asset(asset)),
            "status": "Pending Review",
        }
    ]


def _checklist_rows() -> list[dict]:
    return [
        {"item": "IFC objects extracted to 06_IFC_Objects", "status": "Generated"},
        {"item": "IFC metadata stored as EAV in 07_IFC_Metadata_EAV", "status": "Generated"},
        {"item": "Asset to IFC mapping uses asset_id and ifc_guid", "status": "Generated"},
        {"item": "Device rows generated for realtime-capable assets", "status": "Generated"},
        {"item": "Point rows generated from asset point templates", "status": "Generated"},
        {"item": "BMS mapping requires commissioning/live point test before go-live", "status": "Pending"},
        {"item": "CMMS IDs generated and require O&M system confirmation", "status": "Pending"},
    ]


def _data_type(value: Any) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    return "text"


def _safe_code(value: object) -> str:
    return "".join(char if char.isalnum() else "-" for char in str(value or "").upper()).strip("-")
