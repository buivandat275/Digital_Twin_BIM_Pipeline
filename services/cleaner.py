from __future__ import annotations

from collections import defaultdict

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
        floor = normalize_floor(item.get("floor", ""))
        item["floor"] = floor if not _is_blankish(floor) else "UNK"
        item["status"] = item.get("status") or "Active"
        item["location"] = _clean_location(item)

        if not item.get("asset_id"):
            item["asset_id"] = _generate_asset_id(item, project_code, counters)

        cleaned.append(item)
    return cleaned


def _generate_asset_id(obj: dict, project_code: str, counters: defaultdict) -> str:
    discipline = obj.get("discipline") or "Unknown"
    asset_type = obj.get("asset_type") or "Unknown"
    floor = obj.get("floor") or "UNK"
    key = (discipline, asset_type, floor)
    counters[key] += 1

    discipline_code = DISCIPLINE_CODES.get(discipline, "UNK")
    asset_type_code = ASSET_TYPE_CODES.get(asset_type, "UNK")
    sequence = f"{counters[key]:03d}"
    clean_project = (project_code or "PRJ").upper().replace(" ", "")
    return f"{clean_project}-{discipline_code}-{asset_type_code}-{floor}-{sequence}"


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
