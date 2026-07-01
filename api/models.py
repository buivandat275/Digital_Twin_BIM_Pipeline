from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class TwinModel(Base):
    __tablename__ = "models"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    source_file: Mapped[str] = mapped_column(String(500))
    source_checksum: Mapped[str] = mapped_column(String(64), default="")
    aps_urn: Mapped[str] = mapped_column(Text, default="")
    validation_profile: Mapped[str] = mapped_column(String(100), default="vsf_om_10")
    compliance_summary: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    project: Mapped[Project] = relationship()
    __table_args__ = (UniqueConstraint("project_id", "source_file", "source_checksum", name="uq_model_source_version"),)


class IfcObject(Base):
    __tablename__ = "ifc_objects"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    model_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("models.id", ondelete="CASCADE"), index=True)
    ifc_guid: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(500), default="")
    ifc_class: Mapped[str] = mapped_column(String(100), default="")
    object_type: Mapped[str] = mapped_column(String(255), default="")
    floor: Mapped[str] = mapped_column(String(255), default="")
    room: Mapped[str] = mapped_column(String(255), default="")
    location: Mapped[str] = mapped_column(String(500), default="")
    raw_source: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    asset: Mapped["Asset"] = relationship(back_populates="ifc_object", uselist=False, cascade="all, delete-orphan")
    __table_args__ = (UniqueConstraint("model_id", "ifc_guid", name="uq_ifc_object_model_guid"),)


class Asset(Base):
    __tablename__ = "assets"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    ifc_object_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("ifc_objects.id", ondelete="CASCADE"), unique=True, index=True
    )
    operational_scope: Mapped[str] = mapped_column(String(30), default="context", index=True)
    scope_reason: Mapped[str] = mapped_column(Text, default="")
    scope_source: Mapped[str] = mapped_column(String(100), default="")
    row_version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    ifc_object: Mapped[IfcObject] = relationship(back_populates="asset")
    om: Mapped["AssetOm"] = relationship(back_populates="asset", uselist=False, cascade="all, delete-orphan")


class AssetOm(Base):
    __tablename__ = "asset_om"
    asset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assets.id", ondelete="CASCADE"), primary_key=True)
    model_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("models.id", ondelete="CASCADE"), index=True)
    emsd_asset_code: Mapped[str] = mapped_column(String(255), default="")
    emsd_asset_tag_no: Mapped[str] = mapped_column(String(255), default="")
    emsd_manufacturer: Mapped[str] = mapped_column(String(255), default="")
    vsf_asset_code: Mapped[str] = mapped_column(String(255), default="")
    vsf_asset_tag_no: Mapped[str] = mapped_column(String(255), default="")
    vsf_manufacturer: Mapped[str] = mapped_column(String(255), default="")
    vsf_location: Mapped[str] = mapped_column(String(500), default="")
    vsf_link: Mapped[str] = mapped_column(Text, default="")
    vsf_status: Mapped[str] = mapped_column(String(100), default="")
    vsf_document: Mapped[str] = mapped_column(Text, default="")
    field_sources: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    asset: Mapped[Asset] = relationship(back_populates="om")


class ChangeRequest(Base):
    __tablename__ = "change_requests"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    model_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("models.id", ondelete="CASCADE"), index=True)
    entity_type: Mapped[str] = mapped_column(String(50), default="asset")
    entity_id: Mapped[uuid.UUID] = mapped_column(index=True)
    patch: Mapped[dict[str, Any]] = mapped_column(JSON)
    base_version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    created_by: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    decided_by: Mapped[str] = mapped_column(String(255), default="")
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class BmsImportBatch(Base):
    __tablename__ = "bms_import_batches"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    model_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("models.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(500))
    checksum: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(30), default="reconciled")
    counts: Mapped[dict[str, int]] = mapped_column(JSON, default=dict)
    uploaded_by: Mapped[str] = mapped_column(String(255))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (UniqueConstraint("model_id", "checksum", name="uq_bms_import_model_checksum"),)


class BmsImportRow(Base):
    __tablename__ = "bms_import_rows"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bms_import_batches.id", ondelete="CASCADE"), index=True)
    row_number: Mapped[int] = mapped_column(Integer)
    asset_code: Mapped[str] = mapped_column(String(255), default="", index=True)
    bms_device_id: Mapped[str] = mapped_column(String(255), default="")
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    reconciliation_status: Mapped[str] = mapped_column(String(40), index=True)
    candidate_asset_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    error: Mapped[str] = mapped_column(Text, default="")
    __table_args__ = (UniqueConstraint("batch_id", "row_number", name="uq_bms_batch_row"),)


class BmsDevice(Base):
    __tablename__ = "bms_devices"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    model_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("models.id", ondelete="CASCADE"), index=True)
    asset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assets.id", ondelete="CASCADE"), unique=True)
    bms_device_id: Mapped[str] = mapped_column(String(255))
    device_name: Mapped[str] = mapped_column(String(500), default="")
    status: Mapped[str] = mapped_column(String(100), default="")
    floor: Mapped[str] = mapped_column(String(255), default="")
    room: Mapped[str] = mapped_column(String(255), default="")
    location: Mapped[str] = mapped_column(String(500), default="")
    link: Mapped[str] = mapped_column(Text, default="")
    document: Mapped[str] = mapped_column(Text, default="")
    manufacturer: Mapped[str] = mapped_column(String(255), default="")
    source_batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bms_import_batches.id"))
    __table_args__ = (UniqueConstraint("model_id", "bms_device_id", name="uq_bms_device_model_id"),)


class BmsMappingDecision(Base):
    __tablename__ = "bms_mapping_decisions"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    import_row_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bms_import_rows.id", ondelete="CASCADE"), index=True)
    asset_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("assets.id", ondelete="SET NULL"), nullable=True)
    decision: Mapped[str] = mapped_column(String(30))
    decided_by: Mapped[str] = mapped_column(String(255))
    reason: Mapped[str] = mapped_column(Text, default="")
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ValidationRun(Base):
    __tablename__ = "validation_runs"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    model_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("models.id", ondelete="CASCADE"), index=True)
    profile: Mapped[str] = mapped_column(String(100), default="vsf_om_10")
    summary: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    actor: Mapped[str] = mapped_column(String(255))


class ValidationIssue(Base):
    __tablename__ = "validation_issues"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("validation_runs.id", ondelete="CASCADE"), index=True)
    asset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assets.id", ondelete="CASCADE"), index=True)
    field_name: Mapped[str] = mapped_column(String(255))
    severity: Mapped[str] = mapped_column(String(20), default="Medium")
    message: Mapped[str] = mapped_column(Text)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    model_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("models.id", ondelete="SET NULL"), nullable=True, index=True)
    entity_type: Mapped[str] = mapped_column(String(50), index=True)
    entity_id: Mapped[str] = mapped_column(String(64), index=True)
    action: Mapped[str] = mapped_column(String(100), index=True)
    before_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    after_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    changes: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    actor_display_name: Mapped[str] = mapped_column(String(255))
    source: Mapped[str] = mapped_column(String(50))
    request_id: Mapped[str] = mapped_column(String(64), index=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


Index("ix_asset_om_emsd_code", AssetOm.emsd_asset_code)
Index("ix_asset_om_vsf_code", AssetOm.vsf_asset_code)
