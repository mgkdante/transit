"""Tier-1 rollups: per-route trip-cancellation rate + historic occupancy-band distribution.

Revision ID: 0048_tier1_cancellation_occupancy_rollups
Revises: 0047_route_granularity_rollups
Create Date: 2026-06-18

Three APPEND-ONLY gold tables built in build_warm_rollups and surfaced as
ADDITIVE-OPTIONAL fields on route_reliability + network_trend (no required-set
change, no new manifest pointer):

  - route_cancellation_daily: one row per CLOSED provider-local day, per route.
    cancellation_rate_pct = 100 * canceled_trip_days / total_trip_days, where a
    trip-day is a DISTINCT (trip_id, start_date) seen in fact_trip_delay_snapshot
    and counts canceled if EVER observed with trip_schedule_relationship=3.
    Observation-based denominator (RT-reported trips only).
  - occupancy_summary_5m: 5-minute band-COUNT mirror of vehicle_summary_5m,
    keyed on GTFS-RT OccupancyStatus bands (empty/many_seats/few_seats/standing/
    full; code 4 folds into standing per _OCCUPANCY_MAP). observation_count =
    band-bearing pings = the band-share denominator.
  - route_occupancy_band_daily: append-only daily reduction of band counts, the
    history source for per-route occupancy distribution past the 14d fact window.

All three are deliberately OUT of REPORTING_AGGREGATE_TABLES (a DELETE+UPSERT
rebuild would wipe accrued history). They accrue forward and prune only at
GOLD_WARM_ROLLUP_RETENTION_DAYS=365 (registered in maintenance/gold.py).

Alembic migration modules are independent — the _built_at_column / _provider_fk
helpers are re-declared here rather than imported from an earlier revision.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0048_tier1_cancellation_occupancy_rollups"
down_revision = "0047_route_granularity_rollups"
branch_labels = None
depends_on = None


def _built_at_column() -> sa.Column:
    return sa.Column(
        "built_at_utc",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


def _provider_fk(table_name: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["provider_id"],
        ["core.providers.provider_id"],
        name=f"fk_gold_{table_name}_provider_id",
    )


def _occupancy_band_columns() -> list[sa.Column]:
    return [
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("empty_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("many_seats_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("few_seats_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("standing_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("full_count", sa.Integer(), nullable=False, server_default="0"),
    ]


def upgrade() -> None:
    # 1) Per-route daily cancellation rate (append-only, clone of the 0046
    #    percentile-daily shape + two count columns).
    op.create_table(
        "route_cancellation_daily",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("provider_local_date", sa.Date(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("total_trip_days", sa.Integer(), nullable=False),
        sa.Column("canceled_trip_days", sa.Integer(), nullable=False),
        sa.Column("cancellation_rate_pct", sa.Numeric(5, 2), nullable=True),
        _built_at_column(),
        _provider_fk("route_cancellation_daily"),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "provider_local_date",
            "route_id",
            name="pk_gold_route_cancellation_daily",
        ),
        schema="gold",
    )
    op.create_index(
        "ix_gold_route_cancellation_daily_provider_route_date",
        "route_cancellation_daily",
        ["provider_id", "route_id", "provider_local_date"],
        schema="gold",
    )

    # 2) 5-minute occupancy band-count mirror of vehicle_summary_5m (migration 0008).
    op.create_table(
        "occupancy_summary_5m",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("period_start_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        *_occupancy_band_columns(),
        _built_at_column(),
        _provider_fk("occupancy_summary_5m"),
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

    # 3) Append-only daily occupancy-band reduction (the 0046 model + count cols).
    op.create_table(
        "route_occupancy_band_daily",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("provider_local_date", sa.Date(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        *_occupancy_band_columns(),
        _built_at_column(),
        _provider_fk("route_occupancy_band_daily"),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "provider_local_date",
            "route_id",
            name="pk_gold_route_occupancy_band_daily",
        ),
        schema="gold",
    )
    op.create_index(
        "ix_gold_route_occupancy_band_daily_provider_entity_date",
        "route_occupancy_band_daily",
        ["provider_id", "route_id", "provider_local_date"],
        schema="gold",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_gold_route_occupancy_band_daily_provider_entity_date",
        table_name="route_occupancy_band_daily",
        schema="gold",
    )
    op.drop_table("route_occupancy_band_daily", schema="gold")

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
        "ix_gold_route_cancellation_daily_provider_route_date",
        table_name="route_cancellation_daily",
        schema="gold",
    )
    op.drop_table("route_cancellation_daily", schema="gold")
