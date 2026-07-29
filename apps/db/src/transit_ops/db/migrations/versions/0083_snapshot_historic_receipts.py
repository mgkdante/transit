"""Persist historic entity-map receipts and publish-phase telemetry.

Revision ID: 0083_snapshot_historic_receipts
Revises: 0082_snapshot_historic_gc
Create Date: 2026-07-29
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0083_snapshot_historic_receipts"
down_revision = "0082_snapshot_historic_gc"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "snapshot_historic_receipts",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("family", sa.Text(), nullable=False),
        sa.Column("entity_key", sa.Text(), nullable=False),
        sa.Column("receipt_schema_version", sa.SmallInteger(), nullable=False),
        sa.Column("common_envelope", postgresql.JSONB(), nullable=False),
        sa.Column("common_envelope_sha256", sa.Text(), nullable=False),
        sa.Column("month_receipts", postgresql.JSONB(), nullable=False),
        sa.Column("scope_count", sa.Integer(), nullable=False),
        sa.Column("first_scope_start", sa.Date(), nullable=False),
        sa.Column("last_scope_end", sa.Date(), nullable=False),
        sa.Column("entity_receipt_sha256", sa.Text(), nullable=False),
        sa.Column("origin_publish_generation_id", sa.Text(), nullable=False),
        sa.Column("activated_root_generation_id", sa.Text(), nullable=False),
        sa.Column(
            "created_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "family",
            "entity_key",
            name="pk_core_snapshot_historic_receipts",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_core_snapshot_historic_receipts_provider_id",
        ),
        sa.CheckConstraint(
            "family IN ('network', 'lines', 'stops')",
            name="ck_core_snapshot_historic_receipts_family",
        ),
        sa.CheckConstraint(
            "(family = 'network' AND entity_key = '') "
            "OR (family IN ('lines', 'stops') AND entity_key <> '')",
            name="ck_core_snapshot_historic_receipts_entity",
        ),
        sa.CheckConstraint(
            "receipt_schema_version > 0",
            name="ck_core_snapshot_historic_receipts_schema_version",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(common_envelope) = 'object'",
            name="ck_core_snapshot_historic_receipts_envelope_json",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(month_receipts) = 'object'",
            name="ck_core_snapshot_historic_receipts_months_json",
        ),
        sa.CheckConstraint(
            "scope_count > 0",
            name="ck_core_snapshot_historic_receipts_scope_count",
        ),
        sa.CheckConstraint(
            "first_scope_start <= last_scope_end",
            name="ck_core_snapshot_historic_receipts_coverage",
        ),
        sa.CheckConstraint(
            "common_envelope_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_core_snapshot_historic_receipts_envelope_sha",
        ),
        sa.CheckConstraint(
            "entity_receipt_sha256 ~ '^[0-9a-f]{64}$'",
            name="ck_core_snapshot_historic_receipts_entity_sha",
        ),
        schema="core",
    )
    op.create_index(
        "ix_snapshot_historic_receipts_retention",
        "snapshot_historic_receipts",
        ["provider_id", "family", "last_scope_end"],
        schema="core",
    )

    op.add_column(
        "snapshot_publish_state",
        sa.Column("historic_files_reused", sa.Integer(), nullable=True),
        schema="core",
    )
    op.add_column(
        "snapshot_publish_state",
        sa.Column("historic_scopes_reused", sa.Integer(), nullable=True),
        schema="core",
    )
    op.add_column(
        "snapshot_publish_state",
        sa.Column("historic_scopes_rebuilt", sa.Integer(), nullable=True),
        schema="core",
    )
    op.add_column(
        "snapshot_publish_state",
        sa.Column("historic_source_digest_ms", sa.Float(), nullable=True),
        schema="core",
    )
    op.add_column(
        "snapshot_publish_state",
        sa.Column("historic_build_ms", sa.Float(), nullable=True),
        schema="core",
    )
    op.add_column(
        "snapshot_publish_state",
        sa.Column("historic_gate_ms", sa.Float(), nullable=True),
        schema="core",
    )
    op.add_column(
        "snapshot_publish_state",
        sa.Column("historic_upload_ms", sa.Float(), nullable=True),
        schema="core",
    )
    op.add_column(
        "snapshot_publish_state",
        sa.Column("historic_parent_compose_ms", sa.Float(), nullable=True),
        schema="core",
    )
    op.add_column(
        "snapshot_publish_state",
        sa.Column("historic_compatibility_ms", sa.Float(), nullable=True),
        schema="core",
    )
    op.add_column(
        "snapshot_publish_state",
        sa.Column("historic_receipt_persist_ms", sa.Float(), nullable=True),
        schema="core",
    )
    op.add_column(
        "snapshot_publish_state",
        sa.Column("historic_receipt_rows_attempted", sa.Integer(), nullable=True),
        schema="core",
    )
    op.add_column(
        "snapshot_publish_state",
        sa.Column("historic_receipt_rows_changed", sa.Integer(), nullable=True),
        schema="core",
    )
    op.add_column(
        "snapshot_publish_state",
        sa.Column("historic_phase_detail", postgresql.JSONB(), nullable=True),
        schema="core",
    )
    op.create_check_constraint(
        "ck_core_snapshot_publish_state_files_arithmetic",
        "snapshot_publish_state",
        "files_total = files_written + files_skipped "
        "+ COALESCE(historic_files_reused, 0)",
        schema="core",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_core_snapshot_publish_state_files_arithmetic",
        "snapshot_publish_state",
        schema="core",
        type_="check",
    )
    for column_name in (
        "historic_phase_detail",
        "historic_receipt_rows_changed",
        "historic_receipt_rows_attempted",
        "historic_receipt_persist_ms",
        "historic_compatibility_ms",
        "historic_parent_compose_ms",
        "historic_upload_ms",
        "historic_gate_ms",
        "historic_build_ms",
        "historic_source_digest_ms",
        "historic_scopes_rebuilt",
        "historic_scopes_reused",
        "historic_files_reused",
    ):
        op.drop_column(
            "snapshot_publish_state",
            column_name,
            schema="core",
        )

    op.drop_index(
        "ix_snapshot_historic_receipts_retention",
        table_name="snapshot_historic_receipts",
        schema="core",
    )
    op.drop_table("snapshot_historic_receipts", schema="core")
