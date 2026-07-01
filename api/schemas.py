from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    code: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=255)


class ModelCreate(BaseModel):
    source_file: str
    source_checksum: str = ""
    aps_urn: str = ""
    validation_profile: str = "vsf_om_10"
    compliance_summary: dict[str, Any] = Field(default_factory=dict)


class ObjectUpsert(BaseModel):
    ifc_guid: str
    name: str = ""
    ifc_class: str = ""
    object_type: str = ""
    floor: str = ""
    room: str = ""
    location: str = ""
    operational_scope: Literal["context", "maintainable", "realtime", "scope_review"] = "context"
    scope_reason: str = ""
    scope_source: str = ""
    om_values: dict[str, Any] = Field(default_factory=dict)
    field_sources: dict[str, str] = Field(default_factory=dict)
    raw_source: dict[str, Any] = Field(default_factory=dict)


class ObjectBatch(BaseModel):
    objects: list[ObjectUpsert] = Field(max_length=1000)


class ChangeCreate(BaseModel):
    base_version: int = Field(ge=1)
    patch: dict[str, Any]
    source: str = "aps_viewer"


class DecisionRequest(BaseModel):
    source: str = "aps_viewer"
    reason: str = ""


class BmsConfirmRequest(BaseModel):
    target_asset_id: uuid.UUID
    reason: str = ""
    source: str = "streamlit"


class ValidationRunCreate(BaseModel):
    profile: str = "vsf_om_10"
