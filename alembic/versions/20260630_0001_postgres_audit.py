"""PostgreSQL source of truth and immutable audit.

Revision ID: 20260630_0001
Revises:
"""
from alembic import op

from api.database import Base
from api import models  # noqa: F401

revision = "20260630_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)
    if bind.dialect.name != "postgresql":
        return
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_om_model_emsd_code
        ON asset_om (model_id, upper(emsd_asset_code))
        WHERE btrim(emsd_asset_code) <> ''
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_om_model_vsf_code
        ON asset_om (model_id, upper(vsf_asset_code))
        WHERE btrim(vsf_asset_code) <> ''
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION prevent_audit_mutation()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'audit_events is append-only';
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER audit_events_immutable
        BEFORE UPDATE OR DELETE ON audit_events
        FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation()
        """
    )
    op.execute(
        """
        CREATE VIEW vw_asset_readiness AS
        SELECT
          a.id AS asset_id,
          io.model_id,
          io.ifc_guid,
          io.name,
          io.ifc_class,
          a.operational_scope,
          a.row_version,
          om.emsd_asset_code,
          om.emsd_asset_tag_no,
          om.emsd_manufacturer,
          om.vsf_asset_code,
          om.vsf_asset_tag_no,
          om.vsf_manufacturer,
          om.vsf_location,
          om.vsf_link,
          om.vsf_status,
          om.vsf_document,
          CASE
            WHEN a.operational_scope = 'context' THEN 'Excluded'
            WHEN a.operational_scope = 'scope_review' THEN 'Scope Review'
            WHEN num_nonnulls(
              nullif(btrim(om.emsd_asset_code), ''),
              nullif(btrim(om.emsd_asset_tag_no), ''),
              nullif(btrim(om.emsd_manufacturer), ''),
              nullif(btrim(om.vsf_asset_code), ''),
              nullif(btrim(om.vsf_asset_tag_no), ''),
              nullif(btrim(om.vsf_manufacturer), ''),
              nullif(btrim(om.vsf_location), ''),
              nullif(btrim(om.vsf_link), ''),
              nullif(btrim(om.vsf_status), ''),
              nullif(btrim(om.vsf_document), '')
            ) = 10 THEN 'Complete'
            ELSE 'Incomplete'
          END AS readiness_status
        FROM assets a
        JOIN ifc_objects io ON io.id = a.ifc_object_id
        JOIN asset_om om ON om.asset_id = a.id
        """
    )
    op.execute(
        """
        CREATE VIEW vw_bms_reconciliation AS
        SELECT
          b.id AS batch_id,
          b.model_id,
          b.filename,
          r.id AS import_row_id,
          r.row_number,
          r.asset_code,
          r.bms_device_id,
          r.reconciliation_status,
          r.error,
          d.asset_id,
          d.decision,
          d.decided_by,
          d.decided_at
        FROM bms_import_batches b
        JOIN bms_import_rows r ON r.batch_id = b.id
        LEFT JOIN bms_mapping_decisions d ON d.import_row_id = r.id
        """
    )
    op.execute(
        """
        CREATE VIEW vw_asset_audit AS
        SELECT
          id,
          model_id,
          entity_id AS asset_id,
          action,
          actor_display_name,
          source,
          changes,
          occurred_at
        FROM audit_events
        WHERE entity_type = 'asset'
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP VIEW IF EXISTS vw_asset_audit")
        op.execute("DROP VIEW IF EXISTS vw_bms_reconciliation")
        op.execute("DROP VIEW IF EXISTS vw_asset_readiness")
        op.execute("DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events")
        op.execute("DROP FUNCTION IF EXISTS prevent_audit_mutation")
    Base.metadata.drop_all(bind=bind)
