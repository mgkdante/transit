"""Migration 0042: core.snapshot_publish_state — per-tier publish bookkeeping.

slice-9.1.1r — the /v1 daily publish becomes hash-gated (static/historic PUTs
skip unchanged objects against a bucket-stored hash-state). This tiny table
records, per (provider_id, tier), the DATA-time stamp of the last publish plus
written/skipped/total counts, so the live manifest can fill its
files.static / files.historic ``generated_utc`` inventories transactionally
(the row commits only if that tier's uploads succeeded).

At most 3 rows per provider (live/static/historic). Plain transactional DDL —
no batching, no big-table scan, no reclaim. downgrade drops the table.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0042_snapshot_publish_state"
down_revision = "0041_silver_load_run_kind"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "snapshot_publish_state",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("tier", sa.Text(), nullable=False),
        sa.Column("generated_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("files_written", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("files_skipped", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("files_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "updated_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint(
            "provider_id", "tier", name="pk_core_snapshot_publish_state"
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_core_snapshot_publish_state_provider_id",
        ),
        sa.CheckConstraint(
            "tier IN ('live', 'static', 'historic')",
            name="ck_core_snapshot_publish_state_tier",
        ),
        schema="core",
    )


def downgrade() -> None:
    op.drop_table("snapshot_publish_state", schema="core")
