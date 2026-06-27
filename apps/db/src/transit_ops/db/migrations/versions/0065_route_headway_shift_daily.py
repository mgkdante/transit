"""route_headway_shift_daily — finest-grain additive HEADWAY family (rollup_kind="route_headway_shift_daily").

Append-only, closed-day rollup of gold.fact_trip_delay_snapshot. A "trip start" = MIN(captured_at_utc)
per (route, direction, service_date, trip_id); the headway random variable = consecutive trip-start
gaps within a (direction, service_date, shift) partition, clamped 0 < gap_min < 240. Per
(provider_id, route_id, service_local_date, shift, direction_id) it stores a fixed-edge MINUTES gap
histogram + additive moment sums (gap_count, sum_gap_min, sum_gap_sq_min) + a per-DAY bunched count
(day-grain fast path / parity x-check ONLY — never summed across a window) + trip_count (the
read-time busiest-direction argmax basis, matching the legacy trip-COUNT argmax).

EVERY direction is stored (NO busiest_direction collapse — argmax deferred to read time, per window).
service_local_date = the snapshot calendar day (:local_date); a documented rebaseline vs the legacy
COALESCE(start_date, snapshot_local_date) attribution. NOT in REPORTING_AGGREGATE_TABLES — accrued
history is never DELETE+UPSERT wiped; pruned at GOLD_WARM_ROLLUP_RETENTION_DAYS (730d). Clones 0063.

Revision ID: 0065_route_headway_shift_daily
Revises: 0064_drop_route_delay_cube_folds
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0065_route_headway_shift_daily"
down_revision = "0064_drop_route_delay_cube_folds"
branch_labels = None
depends_on = None


def _built_at_column() -> sa.Column:
    return sa.Column(
        "built_at_utc",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


def _provider_fk() -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["provider_id"],
        ["core.providers.provider_id"],
        name="fk_gold_route_headway_shift_daily_provider_id",
    )


def upgrade() -> None:
    op.create_table(
        "route_headway_shift_daily",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("service_local_date", sa.Date(), nullable=False),
        sa.Column("shift", sa.Text(), nullable=False),
        sa.Column("direction_id", sa.Integer(), nullable=False),
        # additive moment sums — MINUTES, unrounded numeric (D1). CoV is recomposed from
        # these via Bessel n-1; storing minutes makes that arithmetically identical to the
        # legacy stddev_samp(gap_min)/avg(gap_min).
        sa.Column("gap_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sum_gap_min", sa.Numeric(), nullable=False, server_default="0"),
        sa.Column("sum_gap_sq_min", sa.Numeric(), nullable=False, server_default="0"),
        # per-DAY bunched (against the per-day median): day-grain fast path + parity x-check
        # ONLY. The WINDOWED %bunched is re-derived from the pooled histogram vs the pooled
        # median — NEVER summed (D4).
        sa.Column("bunched_gap_count", sa.Integer(), nullable=False, server_default="0"),
        # read-time busiest-direction argmax basis (matches the legacy trip-COUNT argmax, D5).
        sa.Column("trip_count", sa.Integer(), nullable=False, server_default="0"),
        # fixed-edge MINUTES gap histogram (20 finite bins) for the windowed median + %bunched
        # recompose. NULL = no in-clamp gaps (honest absence). smallint[] native.
        sa.Column("gap_histogram", postgresql.ARRAY(sa.SmallInteger()), nullable=True),
        _built_at_column(),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "route_id",
            "service_local_date",
            "shift",
            "direction_id",
            name="pk_gold_route_headway_shift_daily",
        ),
        _provider_fk(),
        schema="gold",
    )
    op.create_index(
        "ix_gold_route_headway_shift_daily_provider_route_date",
        "route_headway_shift_daily",
        ["provider_id", "route_id", "service_local_date"],
        schema="gold",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_gold_route_headway_shift_daily_provider_route_date",
        table_name="route_headway_shift_daily",
        schema="gold",
    )
    op.drop_table("route_headway_shift_daily", schema="gold")
