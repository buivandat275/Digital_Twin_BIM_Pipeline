CLASSIFICATION_RULES = {
    "IfcWallStandardCase": {
        "asset_type": "Wall",
        "discipline": "Architecture",
        "system": "Wall System",
    },
    "IfcWall": {
        "asset_type": "Wall",
        "discipline": "Architecture",
        "system": "Wall System",
    },
    "IfcWindow": {
        "asset_type": "Window",
        "discipline": "Architecture",
        "system": "Window System",
    },
    "IfcDoor": {
        "asset_type": "Door",
        "discipline": "Architecture",
        "system": "Door System",
    },
    "IfcSpace": {
        "asset_type": "Room",
        "discipline": "Spatial",
        "system": "Space Management",
    },
    "IfcSlab": {
        "asset_type": "Slab",
        "discipline": "Structure",
        "system": "Slab System",
    },
    "IfcBeam": {
        "asset_type": "Beam",
        "discipline": "Structure",
        "system": "Beam System",
    },
    "IfcColumn": {
        "asset_type": "Column",
        "discipline": "Structure",
        "system": "Column System",
    },
    "IfcMember": {
        "asset_type": "Member",
        "discipline": "Structure",
        "system": "Structural Member",
    },
    "IfcPlate": {
        "asset_type": "Plate",
        "discipline": "Structure",
        "system": "Plate System",
    },
    "IfcCovering": {
        "asset_type": "Covering",
        "discipline": "Architecture",
        "system": "Covering System",
    },
    "IfcElementAssembly": {
        "asset_type": "Assembly",
        "discipline": "Structure",
        "system": "Assembly System",
    },
    "IfcStair": {
        "asset_type": "Stair",
        "discipline": "Architecture",
        "system": "Stair System",
    },
    "IfcRailing": {
        "asset_type": "Railing",
        "discipline": "Architecture",
        "system": "Railing System",
    },
    "IfcBuildingElementProxy": {
        "asset_type": "Unknown",
        "discipline": "Unknown",
        "system": "Needs Review",
    },
    "IfcAudioVisualAppliance": {
        "asset_type": "Camera",
        "discipline": "Electrical",
        "system": "CCTV System",
    },
    "IfcLightFixture": {
        "asset_type": "Light Fixture",
        "discipline": "Electrical",
        "system": "Lighting System",
    },
    "IfcSensor": {
        "asset_type": "Sensor",
        "discipline": "Electrical",
        "system": "BMS Sensor System",
    },
    "IfcAlarm": {
        "asset_type": "Alarm",
        "discipline": "Fire Protection",
        "system": "Fire Alarm System",
    },
    "IfcController": {
        "asset_type": "Controller",
        "discipline": "Electrical",
        "system": "Building Management System",
    },
    "IfcUnitaryEquipment": {
        "asset_type": "Air Handling Unit",
        "discipline": "Mechanical",
        "system": "HVAC System",
    },
    "IfcFan": {
        "asset_type": "Fan",
        "discipline": "Mechanical",
        "system": "Ventilation System",
    },
    "IfcPump": {
        "asset_type": "Pump",
        "discipline": "Mechanical",
        "system": "Hydronic System",
    },
    "IfcAirTerminal": {
        "asset_type": "Air Terminal",
        "discipline": "Mechanical",
        "system": "Ventilation System",
    },
    "IfcFlowTerminal": {
        "asset_type": "Flow Terminal",
        "discipline": "Plumbing",
        "system": "Plumbing System",
    },
}

DISCIPLINE_CODES = {
    "Architecture": "ARC",
    "Structure": "STR",
    "Mechanical": "MEC",
    "Electrical": "ELE",
    "Plumbing": "PLB",
    "Fire Protection": "FIR",
    "Spatial": "SPA",
    "Unknown": "UNK",
}

ASSET_TYPE_CODES = {
    "Wall": "WALL",
    "Window": "WIN",
    "Door": "DOOR",
    "Room": "ROOM",
    "Slab": "SLAB",
    "Beam": "BEAM",
    "Column": "COL",
    "Member": "MEMBER",
    "Plate": "PLATE",
    "Covering": "COV",
    "Assembly": "ASM",
    "Stair": "STAIR",
    "Railing": "RAIL",
    "Camera": "CAM",
    "Light Fixture": "LIGHT",
    "Sensor": "SENSOR",
    "Alarm": "ALARM",
    "Controller": "CTRL",
    "Air Handling Unit": "AHU",
    "Fan": "FAN",
    "Pump": "PUMP",
    "Air Terminal": "AIRTERM",
    "Flow Terminal": "FLOWTERM",
    "Unknown": "UNK",
}

FLOOR_NORMALIZATION_RULES = {
    "Erdgeschoss": "EG",
    "Dachgeschoss": "DG",
    "Level 1": "F01",
    "Level 2": "F02",
}


def classify_ifc_class(ifc_class: str) -> dict:
    return CLASSIFICATION_RULES.get(
        ifc_class,
        {"asset_type": "Unknown", "discipline": "Unknown", "system": "Needs Review"},
    )


def normalize_floor(value: str) -> str:
    if not value:
        return ""
    return FLOOR_NORMALIZATION_RULES.get(value, value)
