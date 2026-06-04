from __future__ import annotations

from typing import Any

from rules.mapping_rules import NOISE_KEYWORDS, QUANTITY_PROPERTY_NAMES, TECHNICAL_PROPERTY_NAMES


def safe_value(value: Any) -> Any:
    if hasattr(value, "wrappedValue"):
        return value.wrappedValue
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def extract_property_sets(element: Any) -> dict:
    property_sets: dict[str, dict] = {}
    try:
        import ifcopenshell.util.element

        try:
            psets = ifcopenshell.util.element.get_psets(element, qtos=True)
        except TypeError:
            psets = ifcopenshell.util.element.get_psets(element)
        for pset_name, values in psets.items():
            property_sets[pset_name] = {
                key: safe_value(value)
                for key, value in values.items()
                if key not in {"id", "type"}
            }
    except Exception:
        return {}
    return property_sets


def split_metadata(property_sets: dict) -> tuple[dict, dict, dict, dict]:
    technical: dict[str, Any] = {}
    quantities: dict[str, Any] = {}
    source_reference: dict[str, Any] = {}
    raw_metadata: dict[str, Any] = {}

    for pset_name, props in property_sets.items():
        for key, value in props.items():
            normalized_key = key.lower()
            is_noise = any(keyword in normalized_key for keyword in NOISE_KEYWORDS)
            if key in TECHNICAL_PROPERTY_NAMES or pset_name.endswith("Common"):
                technical[key] = value
            elif key in QUANTITY_PROPERTY_NAMES or "quantity" in pset_name.lower():
                quantities[key] = value
            elif key in {"ARCHICAD IFC ID", "External IFC ID"}:
                source_reference[key] = value
            elif is_noise:
                raw_metadata.setdefault(pset_name, {})[key] = value
            else:
                raw_metadata.setdefault(pset_name, {})[key] = value

    return technical, quantities, source_reference, raw_metadata
