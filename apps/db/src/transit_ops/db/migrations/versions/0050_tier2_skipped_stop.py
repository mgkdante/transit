"""Tier-2 (skipped-stop): per-route skipped-stop rate, accrued forward from the fact ETL.

Revision ID: 0050_tier2_skipped_stop
Revises: 0049_tier2_headway_cov_service_span
Create Date: 2026-06-18

silver.rt_trip_update_stop_times is ~738M rows, so the skip count is NOT scanned
historically. Instead the fact ETL's existing per-snapshot stop_time_counts CTE
gains a skipped count (GTFS-RT StopTimeUpdate.ScheduleRelationship SKIPPED=1) that
rides onto fact_trip_delay_snapshot — zero extra scan. A normal append-only daily
rollup (route_skipped_stop_daily) then sums it over the 14d-retained fact, exactly
like the cancellation rollup. RAMP-IN: history accrues forward only from this
migration; there is no backfill (the per-stop flag was never persisted on the fact
before now).

skipped_stop_count is added to BOTH fact_trip_delay_snapshot AND
latest_trip_delay_snapshot, appended last in each, because the latest table is
populated by `INSERT ... SELECT * FROM fact` (positional) — both must keep the
same column count and order.

Alembic migration modules are independent — _built_at_column / _provider_fk are
re-declared here rather than imported from an earlier revision.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0050_tier2_skipped_stop"
down_revision = "0049_tier2_headway_cov_service_span"
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


def upgrade() -> None:
    # Fact column (PG11+ fast-default — metadata-only, no table rewrite). Appended
    # last in BOTH tables so the `SELECT * FROM fact` latest-refresh stays aligned.
    op.add_column(
        "fact_trip_delay_snapshot",
        sa.Column("skipped_stop_count", sa.Integer(), nullable=False, server_default="0"),
        schema="gold",
    )
    op.add_column(
        "latest_trip_delay_snapshot",
        sa.Column("skipped_stop_count", sa.Integer(), nullable=False, server_default="0"),
        schema="gold",
    )

    # Append-only daily rollup (the 0046 model). Counts are BigInteger — a busy
    # route accrues many stop-time updates per day across a year.
    op.create_table(
        "route_skipped_stop_daily",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("provider_local_date", sa.Date(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("stop_time_update_count", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("skipped_stop_count", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("skipped_stop_rate_pct", sa.Numeric(5, 2), nullable=True),
        _built_at_column(),
        _provider_fk("route_skipped_stop_daily"),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "provider_local_date",
            "route_id",
            name="pk_gold_route_skipped_stop_daily",
        ),
        schema="gold",
    )
    op.create_index(
        "ix_gold_route_skipped_stop_daily_provider_route_date",
        "route_skipped_stop_daily",
        ["provider_id", "route_id", "provider_local_date"],
        schema="gold",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_gold_route_skipped_stop_daily_provider_route_date",
        table_name="route_skipped_stop_daily",
        schema="gold",
    )
    op.drop_table("route_skipped_stop_daily", schema="gold")

    op.drop_column("latest_trip_delay_snapshot", "skipped_stop_count", schema="gold")
    op.drop_column("fact_trip_delay_snapshot", "skipped_stop_count", schema="gold")
