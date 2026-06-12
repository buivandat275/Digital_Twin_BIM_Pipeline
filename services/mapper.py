from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from rules.mapping_rules import ASSET_SCHEMA, DEFAULT_MAPPING


def default_mapping_dataframe() -> pd.DataFrame:
    return pd.DataFrame(DEFAULT_MAPPING)


def save_mapping(mapping_df: pd.DataFrame, path: str | Path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    mapping_df.to_json(path, orient="records", indent=2)


def load_mapping(path: str | Path) -> pd.DataFrame:
    path = Path(path)
    if not path.exists():
        return default_mapping_dataframe()
    return pd.DataFrame(json.loads(path.read_text(encoding="utf-8")))


def build_asset_master(cleaned_objects: list[dict]) -> list[dict]:
    assets: list[dict] = []
    for obj in cleaned_objects:
        asset = ASSET_SCHEMA.copy()
        asset.update(
            {
                "asset_id": obj.get("asset_id", ""),
                "dt_asset_code": obj.get("dt_asset_code") or obj.get("asset_id", ""),
                "asset_name": obj.get("asset_name") or obj.get("name", ""),
                "asset_type": obj.get("asset_type", ""),
                "ifc_class": obj.get("ifc_class", ""),
                "system": obj.get("system", ""),
                "system_code": obj.get("system_code", ""),
                "discipline": obj.get("discipline", ""),
                "location": obj.get("location", ""),
                "floor": obj.get("floor", ""),
                "room_zone": obj.get("room_zone", ""),
                "manufacturer": obj.get("manufacturer", ""),
                "model": obj.get("model", ""),
                "serial_number": obj.get("serial_number", ""),
                "installation_date": obj.get("installation_date", ""),
                "warranty_start_date": obj.get("warranty_start_date", ""),
                "warranty_end_date": obj.get("warranty_end_date", ""),
                "warranty": obj.get("warranty", ""),
                "maintenance_info": obj.get("maintenance_info", ""),
                "criticality": obj.get("criticality", ""),
                "maintainable": obj.get("maintainable", ""),
                "expected_life_years": obj.get("expected_life_years", ""),
                "maintenance_strategy": obj.get("maintenance_strategy", ""),
                "cmms_asset_id": obj.get("cmms_asset_id", ""),
                "spare_part_group": obj.get("spare_part_group", ""),
                "manual_url": obj.get("manual_url", ""),
                "device_id": obj.get("device_id", ""),
                "gateway_id": obj.get("gateway_id", ""),
                "protocol": obj.get("protocol", ""),
                "bms_device_id": obj.get("bms_device_id", ""),
                "modbus_slave_id": obj.get("modbus_slave_id", ""),
                "mqtt_topic": obj.get("mqtt_topic", ""),
                "rest_endpoint": obj.get("rest_endpoint", ""),
                "onvif_profile_url": obj.get("onvif_profile_url", ""),
                "polling_interval_sec": obj.get("polling_interval_sec", ""),
                "realtime_enabled": obj.get("realtime_enabled", ""),
                "history_enabled": obj.get("history_enabled", ""),
                "point_template": obj.get("point_template", ""),
                "review_status": obj.get("review_status", ""),
                "mapping_status": obj.get("mapping_status", ""),
                "status": obj.get("status", ""),
                "source_global_id": obj.get("global_id", ""),
                "ifc_guid": obj.get("global_id", ""),
                "source_file": obj.get("source_file", ""),
                "technical_properties": obj.get("technical_properties", {}),
                "quantity_properties": obj.get("quantity_properties", {}),
                "source_reference": {
                    "building": obj.get("building", ""),
                    "functional_location": obj.get("functional_location", ""),
                    "asset_tag_no": obj.get("asset_tag_no", ""),
                    "zone_tag_no": obj.get("zone_tag_no", ""),
                    "documentation": obj.get("documentation", ""),
                    **obj.get("source_reference", {}),
                },
                "raw_metadata": obj.get("raw_metadata", {}),
            }
        )
        assets.append(asset)
    return assets


def build_preview_tables(assets: list[dict]) -> dict[str, list[dict]]:
    locations = {}
    systems = {}
    properties = []

    for asset in assets:
        location_key = asset.get("location") or "Unknown"
        locations[location_key] = {
            "location_id": location_key.replace(" ", "_").replace("/", "-"),
            "building": asset.get("source_reference", {}).get("building", ""),
            "location": asset.get("location", ""),
            "floor": asset.get("floor", ""),
            "room_zone": asset.get("room_zone", ""),
        }

        system_key = asset.get("system") or "Unknown"
        systems[system_key] = {
            "system_id": system_key.replace(" ", "_"),
            "system_name": system_key,
            "asset_type": asset.get("asset_type", ""),
        }

        for group_name in ["technical_properties", "quantity_properties", "raw_metadata"]:
            values = asset.get(group_name, {})
            if not isinstance(values, dict):
                continue
            for prop_name, prop_value in _flatten(values).items():
                properties.append(
                    {
                        "asset_id": asset.get("asset_id", ""),
                        "property_group": group_name,
                        "property_name": prop_name,
                        "property_value": prop_value,
                    }
                )

    return {
        "assets": assets,
        "locations": list(locations.values()),
        "systems": list(systems.values()),
        "properties": properties,
    }


def _flatten(values: dict, prefix: str = "") -> dict:
    flattened = {}
    for key, value in values.items():
        full_key = f"{prefix}.{key}" if prefix else str(key)
        if isinstance(value, dict):
            flattened.update(_flatten(value, full_key))
        else:
            flattened[full_key] = value
    return flattened
