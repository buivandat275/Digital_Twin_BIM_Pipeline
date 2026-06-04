from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

from rules.classification_rules import classify_ifc_class, normalize_floor
from services.metadata_extractor import extract_property_sets, split_metadata


class IFCReadError(RuntimeError):
    pass


def _first_name(ifc_file: Any, ifc_type: str) -> str:
    try:
        objects = ifc_file.by_type(ifc_type)
        if objects:
            return getattr(objects[0], "Name", "") or ""
    except Exception:
        pass
    return ""


def _container_names(element: Any) -> dict:
    result = {"building": "", "floor": "", "room_zone": "", "location": ""}
    try:
        import ifcopenshell.util.element

        container = ifcopenshell.util.element.get_container(element)
        while container:
            class_name = container.is_a()
            name = getattr(container, "Name", "") or ""
            if class_name == "IfcSpace" and not result["room_zone"]:
                result["room_zone"] = name
            elif class_name == "IfcBuildingStorey" and not result["floor"]:
                result["floor"] = normalize_floor(name)
            elif class_name == "IfcBuilding" and not result["building"]:
                result["building"] = name
            container = ifcopenshell.util.element.get_container(container)
    except Exception:
        pass
    result["location"] = " / ".join(
        value for value in [result["building"], result["floor"], result["room_zone"]] if value
    )
    return result


def _object_type(element: Any) -> str:
    try:
        if getattr(element, "ObjectType", None):
            return element.ObjectType
        if getattr(element, "PredefinedType", None):
            return element.PredefinedType
    except Exception:
        pass
    return ""


def parse_ifc_file(file_path: str | Path, source_file: str) -> tuple[list[dict], dict]:
    try:
        import ifcopenshell
    except ImportError as exc:
        raise IFCReadError(
            "ifcopenshell is not installed. Run `pip install -r requirements.txt` first."
        ) from exc

    try:
        ifc_file = ifcopenshell.open(str(file_path))
    except Exception as exc:
        raise IFCReadError(f"Cannot read IFC file: {exc}") from exc

    project_name = _first_name(ifc_file, "IfcProject")
    building_name = _first_name(ifc_file, "IfcBuilding")
    rows: list[dict] = []

    for element in ifc_file.by_type("IfcProduct"):
        ifc_class = element.is_a()
        if ifc_class in {"IfcOpeningElement", "IfcSite", "IfcBuildingStorey", "IfcBuilding"}:
            continue

        property_sets = extract_property_sets(element)
        technical, quantities, source_reference, raw_metadata = split_metadata(property_sets)
        classification = classify_ifc_class(ifc_class)
        containers = _container_names(element)
        building = containers["building"] or building_name
        location = containers["location"] or building

        rows.append(
            {
                "global_id": getattr(element, "GlobalId", "") or "",
                "name": getattr(element, "Name", "") or "",
                "ifc_class": ifc_class,
                "object_type": _object_type(element),
                "property_sets": property_sets,
                "metadata": raw_metadata,
                "property_count": sum(len(values) for values in property_sets.values()),
                "source_file": source_file,
                "building": building,
                "floor": containers["floor"],
                "room_zone": containers["room_zone"],
                "location": location,
                "asset_type": classification["asset_type"],
                "discipline": classification["discipline"],
                "system": classification["system"],
                "technical_properties": technical,
                "quantity_properties": quantities,
                "source_reference": {"source_file": source_file, **source_reference},
                "raw_metadata": raw_metadata,
                "manufacturer": _lookup_property(property_sets, "Manufacturer"),
                "model": _lookup_property(property_sets, "Model"),
                "serial_number": _lookup_property(property_sets, "SerialNumber")
                or _lookup_property(property_sets, "Serial Number"),
                "warranty": _lookup_property(property_sets, "Warranty"),
                "maintenance_info": _lookup_property(property_sets, "MaintenanceInfo")
                or _lookup_property(property_sets, "Maintenance Info"),
                "status": _lookup_property(property_sets, "Status"),
            }
        )

    summary = {
        "project_name": project_name,
        "building_name": building_name,
        "total_objects": len(rows),
    }
    return rows, summary


def _lookup_property(property_sets: dict, key_name: str) -> Any:
    lowered = key_name.lower()
    for props in property_sets.values():
        for key, value in props.items():
            if key.lower() == lowered:
                return value
    return ""


def save_uploaded_file(uploaded_file: Any) -> Path:
    suffix = Path(uploaded_file.name).suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(uploaded_file.getbuffer())
        return Path(tmp.name)
