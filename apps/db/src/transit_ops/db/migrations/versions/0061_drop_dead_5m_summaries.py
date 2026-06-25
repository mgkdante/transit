"""Drop the dead 5-minute warm rollups gold.vehicle_summary_5m + gold.occupancy_summary_5m.

S7 pipeline-consolidation cleanup (Gold Relation Catalog, 2026-06-25). Both were upserted
every warm-rollup cycle but are WRITE-ONLY SINKS with NO reader:
* vehicle_summary_5m — no snapshot/rollup consumer; the live vehicle map + counts come from
  fact_vehicle_snapshot → latest_vehicle_snapshot.
* occupancy_summary_5m — superseded by the daily band tables route_occupancy_band_daily /
  stop_occupancy_band_daily, which serve all /v1 crowding. No reader.
The kept trip_delay_summary_5m (the live feeder to route_delay_hourly) is untouched.

The companion code change removes their rollups.py builders (the SELECT_MISSING_* +
UPSERT_*_5M constants, the two build blocks in build_warm_rollups, the
WarmRollupBuildResult.built_vehicle_periods / built_occupancy_periods fields + counters),
their maintenance prune/vacuum list entries, and their source-factory catalog entries.

downgrade recreates both tables + indexes (structure from 0008 + 0048) for reversibility;
the builder no longer repopulates them.

Revision ID: 0061_drop_dead_5m_summaries
Revises: 0060_drop_dead_dim_direction
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0061_drop_dead_5m_summaries"
down_revision = "0060_drop_dead_dim_direction"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index(
        "ix_gold_occupancy_summary_5m_provider_route_period",
        table_name="occupancy_summary_5m",
        schema="gold",
    )
    op.drop_index(
        "ix_gold_occupancy_summary_5m_provider_period",
        table_name="occupancy_summary_5m",
        schema="gold",
    )
    op.drop_table("occupancy_summary_5m", schema="gold")

    op.drop_index(
        "ix_gold_vehicle_summary_5m_provider_route_period",
        table_name="vehicle_summary_5m",
        schema="gold",
    )
    op.drop_index(
        "ix_gold_vehicle_summary_5m_provider_period",
        table_name="vehicle_summary_5m",
        schema="gold",
    )
    op.drop_table("vehicle_summary_5m", schema="gold")


def downgrade() -> None:
    op.create_table(
        "vehicle_summary_5m",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("period_start_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("vehicle_count", sa.Integer(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False),
        sa.Column("snapshot_count", sa.Integer(), nullable=False),
        sa.Column("built_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_vehicle_summary_5m_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "period_start_utc",
            "route_id",
            name="pk_gold_vehicle_summary_5m",
        ),
        schema="gold",
    )
    op.create_index(
        "ix_gold_vehicle_summary_5m_provider_period",
        "vehicle_summary_5m",
        ["provider_id", "period_start_utc"],
        schema="gold",
    )
    op.create_index(
        "ix_gold_vehicle_summary_5m_provider_route_period",
        "vehicle_summary_5m",
        ["provider_id", "route_id", "period_start_utc"],
        schema="gold",
    )

    op.create_table(
        "occupancy_summary_5m",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("period_start_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False),
        sa.Column("empty_count", sa.Integer(), nullable=False),
        sa.Column("many_seats_count", sa.Integer(), nullable=False),
        sa.Column("few_seats_count", sa.Integer(), nullable=False),
        sa.Column("standing_count", sa.Integer(), nullable=False),
        sa.Column("full_count", sa.Integer(), nullable=False),
        sa.Column("built_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_occupancy_summary_5m_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "period_start_utc",
            "route_id",
            name="pk_gold_occupancy_summary_5m",
        ),
        schema="gold",
    )
    op.create_index(
        "ix_gold_occupancy_summary_5m_provider_period",
        "occupancy_summary_5m",
        ["provider_id", "period_start_utc"],
        schema="gold",
    )
    op.create_index(
        "ix_gold_occupancy_summary_5m_provider_route_period",
        "occupancy_summary_5m",
        ["provider_id", "route_id", "period_start_utc"],
        schema="gold",
    )
