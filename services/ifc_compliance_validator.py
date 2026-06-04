from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd


class IFCComplianceValidationError(RuntimeError):
    pass


def validate_ifc_compliance(
    file_path: str | Path,
    *,
    express_rules: bool = False,
) -> tuple[pd.DataFrame, dict]:
    """Run IFC syntax/schema validation using IfcOpenShell's validator.

    buildingSMART/validate is a Docker-based validation service, not a small
    importable package. This local check covers the same first layer for a PoC:
    IFC syntax/schema compliance before Digital Twin data-quality validation.
    """
    try:
        import ifcopenshell
        import ifcopenshell.validate
    except ImportError as exc:
        raise IFCComplianceValidationError(
            "ifcopenshell is not installed. Run `pip install -r requirements.txt` first."
        ) from exc

    try:
        ifc_file = ifcopenshell.open(str(file_path))
    except Exception as exc:
        raise IFCComplianceValidationError(f"Cannot open IFC for compliance validation: {exc}") from exc

    logger = ifcopenshell.validate.json_logger()
    try:
        ifcopenshell.validate.validate(ifc_file, logger, express_rules=express_rules)
    except Exception as exc:
        raise IFCComplianceValidationError(f"IFC compliance validation failed: {exc}") from exc

    rows = [_statement_to_row(statement) for statement in logger.statements]
    df = pd.DataFrame(rows)
    summary = {
        "total_issues": len(rows),
        "errors": _count_level(rows, "error"),
        "warnings": _count_level(rows, "warning"),
        "infos": _count_level(rows, "info"),
        "status": "Pass" if not rows else "Issues Found",
        "engine": "IfcOpenShell validate",
        "express_rules": express_rules,
    }
    return df, summary


def _statement_to_row(statement: dict[str, Any]) -> dict:
    instance = statement.get("instance", "")
    return {
        "level": statement.get("level", ""),
        "type": statement.get("type", ""),
        "attribute": statement.get("attribute", ""),
        "instance": str(instance) if instance else "",
        "message": _compact_message(statement.get("message", "")),
    }


def _compact_message(message: Any) -> str:
    text = str(message or "")
    return " ".join(text.split())


def _count_level(rows: list[dict], level: str) -> int:
    return sum(1 for row in rows if row.get("level") == level)
