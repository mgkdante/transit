"""Persist fail-closed reachability marks for immutable historic generations.

Revision ID: 0082_snapshot_historic_gc
Revises: 0081_publish_stable_files
Create Date: 2026-07-14
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0082_snapshot_historic_gc"
down_revision = "0081_publish_stable_files"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "snapshot_historic_gc_marks",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("etag", sa.Text(), nullable=False),
        sa.Column("content_length", sa.BigInteger(), nullable=False),
        sa.Column("object_last_modified_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("first_unreachable_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_confirmed_unreachable_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_scan_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "object_key",
            name="pk_core_snapshot_historic_gc_marks",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_core_snapshot_historic_gc_marks_provider_id",
        ),
        sa.CheckConstraint(
            "object_key ~ '^historic/.+/generations/'",
            name="ck_core_snapshot_historic_gc_marks_generation_key",
        ),
        sa.CheckConstraint(
            "content_length >= 0",
            name="ck_core_snapshot_historic_gc_marks_size",
        ),
        sa.CheckConstraint(
            "last_confirmed_unreachable_utc >= first_unreachable_utc",
            name="ck_core_snapshot_historic_gc_marks_ordered_time",
        ),
        schema="core",
    )


def downgrade() -> None:
    op.drop_table("snapshot_historic_gc_marks", schema="core")
