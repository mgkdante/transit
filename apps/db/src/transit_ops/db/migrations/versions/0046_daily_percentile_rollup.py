"""Append-only daily percentile rollups (route + stop).

Revision ID: 0046_daily_percentile_rollup
Revises: 0045_hot_realtime_autovacuum
Create Date: 2026-06-18

Why this migration exists:
    Per-route and per-stop schedule-deviation percentiles (p50/p90) were shipped
    as deferred-None on the reliability surfaces because gold facts retain only
    GOLD_FACT_RETENTION_DAYS=14 and percentiles are NOT additively composable, so
    they cannot be re-derived from the 5-minute warm rollups. These two tables are
    APPEND-ONLY daily aggregates: build_warm_rollups computes each CLOSED local
    day's percentile_cont(0.5)/(0.9) once from that day's facts and never rewrites
    it, so percentile history accrues FORWARD past the 14-day fact window and is
    pruned only at GOLD_WARM_ROLLUP_RETENTION_DAYS=365 (registered in
    maintenance/gold.py). They are deliberately kept OUT of the DELETE+UPSERT
    REPORTING_AGGREGATE_TABLES registry, which would wipe accrued history.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0046_daily_percentile_rollup"
down_revision = "0045_hot_realtime_autovacuum"
branch_labels = None
depends_on = None


def _create_percentile_table(name: str, entity_col: str) -> None:
    op.create_table(
        name,
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("provider_local_date", sa.Date(), nullable=False),
        sa.Column(entity_col, sa.Text(), nullable=False),
        sa.Column("delay_observation_count", sa.Integer(), nullable=False),
        sa.Column("p50_delay_seconds", sa.Numeric(12, 2), nullable=True),
        sa.Column("p90_delay_seconds", sa.Numeric(12, 2), nullable=True),
        sa.Column("built_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name=f"fk_gold_{name}_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "provider_local_date",
            entity_col,
            name=f"pk_gold_{name}",
        ),
        schema="gold",
    )
    op.create_index(
        f"ix_gold_{name}_provider_entity_date",
        name,
        ["provider_id", entity_col, "provider_local_date"],
        schema="gold",
    )


def upgrade() -> None:
    _create_percentile_table("route_delay_percentile_daily", "route_id")
    _create_percentile_table("stop_delay_percentile_daily", "stop_id")


def downgrade() -> None:
    op.drop_index(
        "ix_gold_stop_delay_percentile_daily_provider_entity_date",
        table_name="stop_delay_percentile_daily",
        schema="gold",
    )
    op.drop_table("stop_delay_percentile_daily", schema="gold")

    op.drop_index(
        "ix_gold_route_delay_percentile_daily_provider_entity_date",
        table_name="route_delay_percentile_daily",
        schema="gold",
    )
    op.drop_table("route_delay_percentile_daily", schema="gold")
