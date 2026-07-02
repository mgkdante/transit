"""route_delay_spine — finest-grain additive DELAY metric family (rollup_kind="route_delay_spine").

Append-only, closed-day rollup of gold.fact_trip_delay_snapshot at the finest hour-grain
(provider_id, route_id, service_local_date, hour_of_day_local, direction_id). Every route
delay-cube breakdown (by_shift / by_daytype / day_of_week / weekly / monthly) derives at READ
time from this one table via the publisher projector — no one-table-per-breakdown.

Stores EXACT additive count columns (observation_count, delay_observation_count,
on_time_observation_count NULL-guarded, severe_delay_count) that the builder computes with the
SAME predicates as the live 5m/hourly path — on-time = delay_seconds in [-60, 300); severe =
delay_seconds > 300 AND ABS(delay_seconds) <= 3600. otp_pct / severe_pct are byte-identical
ratios of these stored counts, NEVER derived from histogram bins (a left-closed edge at 300
cannot split delay=300 on-time from delay=301 severe). The 21-bin delay_histogram is stored
separately and used ONLY for p50/p90 (CDF interpolation) and the section-01 signed-delay
distribution chart. sum_delay_seconds carries the pooled numerator for the rebaselined avg.

delayed_trip_count (= COUNT(DISTINCT trip_id)) is intentionally ABSENT: it is non-additive
across the hour grain (a trip spans hours), so the publisher reads it from route_delay_hourly
(kept transitionally) instead of summing per-hour distinct counts.

The fact's route_id + direction_id are nullable; every spine PK column is NOT NULL. The builder
filters to rows with a non-null route_id (the route grain) and COALESCEs an unknown direction to
0 — matching the existing directional builder (route_headway_by_direction_shift) so the
sum-across-direction folds stay byte-identical. NOT in REPORTING_AGGREGATE_TABLES — accrued history is
never DELETE+UPSERT wiped; pruned at GOLD_WARM_ROLLUP_RETENTION_DAYS (730d) via the append-only
retention lists in maintenance/gold.py (730d fully covers the 371d week/month trend window).
Clones the append-only lifecycle of 0046 (percentile) + 0048 (band rollup).

Revision ID: 0063_route_delay_spine
Revises: 0062_rename_misnamed_rolling_tables
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0063_route_delay_spine"
down_revision = "0062_rename_misnamed_rolling_tables"
branch_labels = None
depends_on = None


def _built_at_column() -> sa.Column:
    # Mirrors 0048_tier1_cancellation_occupancy_rollups.py.
    return sa.Column(
        "built_at_utc",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


def _provider_fk() -> sa.ForeignKeyConstraint:
    # gold.fk_gold_<table>_provider_id convention, references the base core.providers table.
    return sa.ForeignKeyConstraint(
        ["provider_id"],
        ["core.providers.provider_id"],
        name="fk_gold_route_delay_spine_provider_id",
    )


def upgrade() -> None:
    op.create_table(
        "route_delay_spine",
        # finest-grain hour-grain PK (D1).
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("service_local_date", sa.Date(), nullable=False),
        sa.Column("hour_of_day_local", sa.SmallInteger(), nullable=False),
        sa.Column("direction_id", sa.Integer(), nullable=False),
        # additive count columns (each metric's exact numerator/denominator).
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "delay_observation_count", sa.Integer(), nullable=False, server_default="0"
        ),
        # NULL = on-time band not computable (no usable delay) — honest absence, distinct from 0.
        sa.Column("on_time_observation_count", sa.Integer(), nullable=True),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sum_delay_seconds", sa.BigInteger(), nullable=False, server_default="0"),
        # 21-bin smallint[] (native — no extension); for p50/p90 + the section-01 chart only.
        sa.Column("delay_histogram", postgresql.ARRAY(sa.SmallInteger()), nullable=True),
        _built_at_column(),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "route_id",
            "service_local_date",
            "hour_of_day_local",
            "direction_id",
            name="pk_gold_route_delay_spine",
        ),
        _provider_fk(),
        schema="gold",
    )
    op.create_index(
        "ix_gold_route_delay_spine_provider_route_date",
        "route_delay_spine",
        ["provider_id", "route_id", "service_local_date"],
        schema="gold",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_gold_route_delay_spine_provider_route_date",
        table_name="route_delay_spine",
        schema="gold",
    )
    op.drop_table("route_delay_spine", schema="gold")
