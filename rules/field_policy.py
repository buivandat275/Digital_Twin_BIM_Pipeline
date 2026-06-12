from __future__ import annotations

FIELD_POLICY_PROFILES = {
    "building_om": {
        "label": "Building O&M",
        "description": "Building operation profile with full Digital Twin asset metadata.",
        "required": [
            "asset_id",
            "asset_name",
            "asset_type",
            "ifc_class",
            "system",
            "location",
            "floor",
            "room_zone",
            "manufacturer",
            "model",
            "serial_number",
            "warranty",
            "maintenance_info",
            "status",
        ],
        "optional": [],
        "ignored": [],
    },
    "tekla_structural": {
        "label": "Tekla Structural",
        "description": "Structural/bridge profile where Room/Zone and O&M commercial fields are not blocking.",
        "required": [
            "asset_id",
            "asset_name",
            "asset_type",
            "ifc_class",
            "system",
            "location",
            "status",
        ],
        "optional": [
            "floor",
            "room_zone",
            "manufacturer",
            "model",
            "serial_number",
            "warranty",
            "maintenance_info",
        ],
        "ignored": [],
    },
    "revit_mep": {
        "label": "Revit MEP",
        "description": "MEP equipment profile with stronger focus on system and maintainable equipment fields.",
        "required": [
            "asset_id",
            "asset_name",
            "asset_type",
            "ifc_class",
            "system",
            "location",
            "floor",
            "manufacturer",
            "model",
            "status",
        ],
        "optional": [
            "room_zone",
            "serial_number",
            "warranty",
            "maintenance_info",
        ],
        "ignored": [],
    },
    "dtp_handover": {
        "label": "DTP Handover",
        "description": "Digital Twin handover profile aligned with BIM PipelineDigital_Twin v2026.06.10.",
        "required": [
            "asset_id",
            "asset_name",
            "asset_type",
            "ifc_class",
            "system",
            "system_code",
            "location",
            "floor",
            "manufacturer",
            "model",
            "criticality",
            "maintainable",
            "maintenance_strategy",
            "cmms_asset_id",
            "status",
            "source_global_id",
        ],
        "optional": [
            "room_zone",
            "serial_number",
            "installation_date",
            "warranty_start_date",
            "warranty_end_date",
            "warranty",
            "maintenance_info",
            "expected_life_years",
            "spare_part_group",
            "manual_url",
            "device_id",
            "gateway_id",
            "protocol",
            "bms_device_id",
            "modbus_slave_id",
            "mqtt_topic",
            "rest_endpoint",
            "onvif_profile_url",
            "polling_interval_sec",
            "realtime_enabled",
            "history_enabled",
            "point_template",
        ],
        "ignored": [],
    },
}


def get_profile_names() -> list[str]:
    return list(FIELD_POLICY_PROFILES.keys())


def get_profile(profile_name: str) -> dict:
    return FIELD_POLICY_PROFILES.get(profile_name, FIELD_POLICY_PROFILES["building_om"])


def get_policy_rows(profile_name: str) -> list[dict]:
    profile = get_profile(profile_name)
    rows = []
    for policy_type in ["required", "optional", "ignored"]:
        for field in profile.get(policy_type, []):
            rows.append({"field": field, "policy": policy_type})
    return rows


def get_validated_fields(profile_name: str) -> list[str]:
    profile = get_profile(profile_name)
    return list(profile.get("required", []))


def get_template_fields(profile_name: str) -> list[str]:
    profile = get_profile(profile_name)
    fields = []
    for field in profile.get("required", []) + profile.get("optional", []):
        if field not in fields:
            fields.append(field)
    return fields
