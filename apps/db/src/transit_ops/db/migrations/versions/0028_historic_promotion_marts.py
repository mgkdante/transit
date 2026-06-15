"""Migration 0028: Historic promotion mart tables for Phase 3 (HISTORIC tier).

Creates two gold tables:
  - gold.route_headway_daily   (P2 — scheduled vs observed headway per route/shift)
  - gold.repeat_offender_daily (P3 — 14-day rolling repeat-offender window per entity)

These are written by the HISTORIC tier snapshot publisher and queried by the
citizen web-app's history / hotspot views.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0028_historic_promotion_marts"
down_revision = "0027_live_promotion_views"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- gold.route_headway_daily -------------------------------------------
    op.create_table(
        "route_headway_daily",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("shift", sa.Text(), nullable=False),
        sa.Column("scheduled_headway_min", sa.Numeric(), nullable=True),
        sa.Column("observed_headway_min", sa.Numeric(), nullable=True),
        sa.Column("excess_wait_min", sa.Numeric(), nullable=True),
        sa.Column("sample_count", sa.Integer(), nullable=True),
        sa.Column(
            "built_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_route_headway_daily_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "route_id",
            "shift",
            name="pk_gold_route_headway_daily",
        ),
        schema="gold",
    )

    # --- gold.repeat_offender_daily ------------------------------------------
    op.create_table(
        "repeat_offender_daily",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("entity_kind", sa.Text(), nullable=False),
        sa.Column("entity_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("recurrence_days", sa.Integer(), nullable=True),
        sa.Column("window_days", sa.Integer(), nullable=True),
        sa.Column("avg_delay_seconds", sa.Numeric(), nullable=True),
        sa.Column("severity_label", sa.Text(), nullable=True),
        sa.Column(
            "built_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_repeat_offender_daily_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "entity_kind",
            "entity_id",
            "route_id",
            name="pk_gold_repeat_offender_daily",
        ),
        schema="gold",
    )
    op.create_index(
        "ix_gold_repeat_offender_daily_route",
        "repeat_offender_daily",
        ["provider_id", "route_id"],
        schema="gold",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_gold_repeat_offender_daily_route",
        table_name="repeat_offender_daily",
        schema="gold",
    )
    op.drop_table("repeat_offender_daily", schema="gold")
    op.drop_table("route_headway_daily", schema="gold")
