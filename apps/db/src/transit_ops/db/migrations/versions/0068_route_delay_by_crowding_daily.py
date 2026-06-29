"""route_delay_by_crowding_daily — co-observed delay x occupancy (FIX-3, rollup_kind="route_delay_by_crowding_daily").

The old delay_by_crowding metric joined TWO independent per-day rollups (occupancy band counts +
delay) at the route x day grain and attributed the whole day's delay to that day's DOMINANT band,
which CENSORS the full/standing tail (a band that is never a day's argmax never receives any delay).

This migration enables a TRUE per-observation co-observation: it carries occupancy_status onto the
delay fact (gold.fact_trip_delay_snapshot, forward-filled by the vpm LATERAL match the delay-fact
build already runs to populate vehicle_id) and adds an append-only per-route x day x BAND rollup of
the delay distribution. occupancy_status is also added to latest_trip_delay_snapshot because both
tables share _trip_delay_snapshot_statement. RAMP-IN: occupancy_status is NULL on historical fact
rows (forward-fill only), so the new rollup accrues from deploy + the ~14d fact-retention window.

NOT in REPORTING_AGGREGATE_TABLES — append-only, pruned at GOLD_WARM_ROLLUP_RETENTION_DAYS.

Revision ID: 0068_route_delay_by_crowding_daily
Revises: 0067_drop_stop_delay_folds
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0068_route_delay_by_crowding_daily"
down_revision = "0067_drop_stop_delay_folds"
branch_labels = None
depends_on = None


def _built_at_column() -> sa.Column:
    return sa.Column(
        "built_at_utc",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


def upgrade() -> None:
    # Co-observed crowding band on each delay observation. NULL when the vpm LATERAL found no
    # vehicle position within +/-10min (honest absence; those rows are excluded from the rollup).
    op.add_column(
        "fact_trip_delay_snapshot",
        sa.Column("occupancy_status", sa.Integer(), nullable=True),
        schema="gold",
    )
    op.add_column(
        "latest_trip_delay_snapshot",
        sa.Column("occupancy_status", sa.Integer(), nullable=True),
        schema="gold",
    )

    # Per-route x closed-day x crowding-band delay distribution, co-observed at the
    # vehicle x timestamp x trip grain (occupancy_status carried on the delay fact). band uses the
    # same vocabulary as route_occupancy_band_daily (empty/many_seats/few_seats/standing/full;
    # codes 3 and 4 fold to standing). delay_observation_count + sum_delay_seconds give an
    # additively-composable obs-weighted mean over a trailing window; p50_delay_seconds is a
    # best-effort daily median (obs-weighted across days at read time, an approximation).
    op.create_table(
        "route_delay_by_crowding_daily",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("provider_local_date", sa.Date(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("band", sa.Text(), nullable=False),
        sa.Column("delay_observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sum_delay_seconds", sa.Numeric(), nullable=False, server_default="0"),
        sa.Column("p50_delay_seconds", sa.Numeric(), nullable=True),
        _built_at_column(),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "provider_local_date",
            "route_id",
            "band",
            name="pk_gold_route_delay_by_crowding_daily",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_route_delay_by_crowding_daily_provider_id",
        ),
        schema="gold",
    )
    op.create_index(
        "ix_gold_route_delay_by_crowding_daily_provider_route_date",
        "route_delay_by_crowding_daily",
        ["provider_id", "route_id", "provider_local_date"],
        schema="gold",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_gold_route_delay_by_crowding_daily_provider_route_date",
        table_name="route_delay_by_crowding_daily",
        schema="gold",
    )
    op.drop_table("route_delay_by_crowding_daily", schema="gold")
    op.drop_column("latest_trip_delay_snapshot", "occupancy_status", schema="gold")
    op.drop_column("fact_trip_delay_snapshot", "occupancy_status", schema="gold")
