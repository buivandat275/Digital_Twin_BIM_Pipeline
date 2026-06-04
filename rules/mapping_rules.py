DEFAULT_MAPPING = [
    {
        "Source Field": "IfcProduct.GlobalId",
        "Digital Twin Property": "source_global_id",
        "Target Group": "Core",
    },
    {
        "Source Field": "IfcProduct.Name",
        "Digital Twin Property": "asset_name",
        "Target Group": "Core",
    },
    {
        "Source Field": "IFC entity type",
        "Digital Twin Property": "ifc_class",
        "Target Group": "Core",
    },
    {
        "Source Field": "IfcBuilding.Name",
        "Digital Twin Property": "building",
        "Target Group": "Location",
    },
    {
        "Source Field": "IfcBuildingStorey.Name",
        "Digital Twin Property": "floor",
        "Target Group": "Location",
    },
    {
        "Source Field": "IfcSpace.Name",
        "Digital Twin Property": "room_zone",
        "Target Group": "Location",
    },
    {
        "Source Field": "Pset_*Common",
        "Digital Twin Property": "technical_properties",
        "Target Group": "Property",
    },
    {
        "Source Field": "BaseQuantities",
        "Digital Twin Property": "quantity_properties",
        "Target Group": "Property",
    },
    {
        "Source Field": "ArchiCADProperties",
        "Digital Twin Property": "raw_metadata",
        "Target Group": "Traceability",
    },
]

ASSET_SCHEMA = {
    "asset_id": "",
    "asset_name": "",
    "asset_type": "",
    "ifc_class": "",
    "system": "",
    "location": "",
    "floor": "",
    "room_zone": "",
    "manufacturer": "",
    "model": "",
    "serial_number": "",
    "warranty": "",
    "maintenance_info": "",
    "status": "",
    "source_global_id": "",
    "source_file": "",
    "technical_properties": {},
    "quantity_properties": {},
    "source_reference": {},
    "raw_metadata": {},
}

TECHNICAL_PROPERTY_NAMES = {
    "ThermalTransmittance",
    "LoadBearing",
    "IsExternal",
    "FireRating",
    "AcousticRating",
}

QUANTITY_PROPERTY_NAMES = {"Area", "Volume", "Length", "Count"}

NOISE_KEYWORDS = {
    "2d display",
    "symbol pen",
    "fill",
    "hatch",
    "label",
    "marker",
    "ui setting",
    "archicad",
}
