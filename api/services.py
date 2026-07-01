from __future__ import annotations

import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session, selectinload

from api import models
from rules.om_field_rules import OM_FIELD_NAMES

OM_COLUMN_MAP = {
    "EMSD.Common.Asset Code": "emsd_asset_code",
    "EMSD.Common.Asset Tag No.": "emsd_asset_tag_no",
    "EMSD.Common.Manufacturer": "emsd_manufacturer",
    "VSF.Common.Asset Code": "vsf_asset_code",
    "VSF.Common.Asset Tag No.": "vsf_asset_tag_no",
    "VSF.Common.Manufacturer": "vsf_manufacturer",
    "VSF.Location": "vsf_location",
    "VSF.Link": "vsf_link",
    "VSF.Status": "vsf_status",
    "VSF.Document": "vsf_document",
}
ALLOWED_SCOPES = {"context", "maintainable", "realtime", "scope_review"}


def om_values(om: models.AssetOm | None) -> dict[str, str]:
    return {field: str(getattr(om, column, "") or "") for field, column in OM_COLUMN_MAP.items()}


def missing_fields(asset: models.Asset) -> list[str]:
    if asset.operational_scope not in {"maintainable", "realtime"}:
        return []
    values = om_values(asset.om)
    return [field for field in OM_FIELD_NAMES if not values[field].strip()]


def readiness(asset: models.Asset) -> str:
    if asset.operational_scope == "context":
        return "Excluded"
    if asset.operational_scope == "scope_review":
        return "Scope Review"
    return "Incomplete" if missing_fields(asset) else "Complete"


def serialize_asset(
    session: Session,
    asset: models.Asset,
    *,
    include_audit: bool = False,
    include_bms: bool = True,
) -> dict[str, Any]:
    obj = asset.ifc_object
    missing = missing_fields(asset)
    bms = (
        session.scalar(select(models.BmsDevice).where(models.BmsDevice.asset_id == asset.id))
        if include_bms
        else None
    )
    payload = {
        "id": str(asset.id),
        "ifcGuid": obj.ifc_guid,
        "assetId": (asset.om.emsd_asset_code if asset.om else "") or (asset.om.vsf_asset_code if asset.om else ""),
        "assetCode": (asset.om.vsf_asset_code if asset.om else "") or (asset.om.emsd_asset_code if asset.om else ""),
        "name": obj.name,
        "type": obj.object_type or obj.ifc_class,
        "floor": obj.floor,
        "room": obj.room,
        "operationalScope": asset.operational_scope,
        "scopeReason": asset.scope_reason,
        "scopeSource": asset.scope_source,
        "rowVersion": asset.row_version,
        "readinessStatus": readiness(asset),
        "normalizedProperties": om_values(asset.om),
        "fieldSources": dict(asset.om.field_sources or {}) if asset.om else {},
        "validationIssues": [
            {
                "field": field,
                "error_type": f"Thiếu {field}",
                "severity": "Medium",
                "suggested_fix": f"Nhập {field}, lưu bản nháp và xác nhận áp dụng.",
            }
            for field in missing
        ],
        "bmsDevice": (
            {
                "device_id": bms.bms_device_id,
                "device_name": bms.device_name,
                "status": bms.status,
                "floor": bms.floor,
                "room": bms.room,
                "location": bms.location,
                "link": bms.link,
                "document": bms.document,
                "manufacturer": bms.manufacturer,
                "mapping_status": "Applied",
            }
            if bms
            else {}
        ),
        "sourceReference": {"ifc_class": obj.ifc_class, "ifc_guid": obj.ifc_guid},
    }
    if include_audit:
        payload["audit"] = audit_for_entity(session, "asset", str(asset.id), 50)
    return payload


def model_summary(session: Session, model_id: uuid.UUID) -> dict[str, Any]:
    assets = session.scalars(
        select(models.Asset)
        .join(models.IfcObject)
        .options(selectinload(models.Asset.ifc_object), selectinload(models.Asset.om))
        .where(models.IfcObject.model_id == model_id)
    ).all()
    statuses = Counter(readiness(asset) for asset in assets)
    scopes = Counter(asset.operational_scope for asset in assets)
    missing_by_field = Counter(field for asset in assets for field in missing_fields(asset))
    return {
        "assetCount": len(assets),
        "operationalAssetCount": scopes["maintainable"] + scopes["realtime"],
        "scopeReviewCount": scopes["scope_review"],
        "contextCount": scopes["context"],
        "complete": statuses["Complete"],
        "incomplete": statuses["Incomplete"],
        "missingFieldCount": sum(missing_by_field.values()),
        "missingByField": {field: missing_by_field[field] for field in OM_FIELD_NAMES},
    }


def write_audit(
    session: Session,
    *,
    model_id: uuid.UUID | None,
    entity_type: str,
    entity_id: str,
    action: str,
    actor: str,
    source: str,
    request_id: str,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> models.AuditEvent:
    before = before or {}
    after = after or {}
    changes = {
        key: {"before": before.get(key), "after": after.get(key)}
        for key in sorted(set(before) | set(after))
        if before.get(key) != after.get(key)
    }
    event = models.AuditEvent(
        model_id=model_id,
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        before_data=before,
        after_data=after,
        changes=changes,
        actor_display_name=actor,
        source=source,
        request_id=request_id,
    )
    session.add(event)
    return event


def audit_for_entity(session: Session, entity_type: str, entity_id: str, limit: int) -> list[dict[str, Any]]:
    events = session.scalars(
        select(models.AuditEvent)
        .where(models.AuditEvent.entity_type == entity_type, models.AuditEvent.entity_id == entity_id)
        .order_by(models.AuditEvent.occurred_at.desc())
        .limit(limit)
    ).all()
    return [
        {
            "id": event.id,
            "action": event.action,
            "before": event.before_data,
            "after": event.after_data,
            "changes": event.changes,
            "actor": event.actor_display_name,
            "source": event.source,
            "requestId": event.request_id,
            "occurredAt": event.occurred_at.isoformat(),
        }
        for event in events
    ]


def apply_patch_to_asset(asset: models.Asset, patch: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    before = {"operationalScope": asset.operational_scope, **om_values(asset.om)}
    scope = patch.get("operationalScope")
    if scope is not None:
        if scope not in ALLOWED_SCOPES:
            raise ValueError("Phạm vi vận hành không hợp lệ.")
        asset.operational_scope = scope
        asset.scope_reason = str(patch.get("scopeReason") or "Người dùng xác nhận trên giao diện")
        asset.scope_source = "manual_approval"
    values = patch.get("values", {})
    if not isinstance(values, dict):
        raise ValueError("values phải là object.")
    for field, value in values.items():
        column = OM_COLUMN_MAP.get(field)
        if not column:
            raise ValueError(f"Không hỗ trợ trường O&M: {field}")
        setattr(asset.om, column, str(value or "").strip())
        sources = dict(asset.om.field_sources or {})
        sources[field] = "manual_approval"
        asset.om.field_sources = sources
    asset.row_version += 1
    after = {"operationalScope": asset.operational_scope, **om_values(asset.om)}
    return before, after


def run_validation(session: Session, model_id: uuid.UUID, actor: str, profile: str) -> models.ValidationRun:
    assets = session.scalars(
        select(models.Asset).join(models.IfcObject).where(models.IfcObject.model_id == model_id)
    ).all()
    summary = model_summary(session, model_id)
    run = models.ValidationRun(model_id=model_id, profile=profile, summary=summary, actor=actor)
    session.add(run)
    session.flush()
    for asset in assets:
        for field in missing_fields(asset):
            session.add(
                models.ValidationIssue(
                    run_id=run.id,
                    asset_id=asset.id,
                    field_name=field,
                    message=f"Thiếu {field}",
                )
            )
    return run


def asset_code_index(session: Session, model_id: uuid.UUID) -> dict[str, list[uuid.UUID]]:
    assets = session.scalars(
        select(models.Asset)
        .join(models.IfcObject)
        .options(selectinload(models.Asset.ifc_object), selectinload(models.Asset.om))
        .where(models.IfcObject.model_id == model_id)
    ).all()
    result: dict[str, list[uuid.UUID]] = defaultdict(list)
    for asset in assets:
        blocked = (asset.ifc_object.raw_source or {}).get("blocked_duplicate_asset_codes") or {}
        for code in (
            asset.om.emsd_asset_code,
            asset.om.vsf_asset_code,
            blocked.get("EMSD.Common.Asset Code", ""),
            blocked.get("VSF.Common.Asset Code", ""),
        ):
            normalized = str(code or "").strip().upper()
            if normalized and asset.id not in result[normalized]:
                result[normalized].append(asset.id)
    return result
