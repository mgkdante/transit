"""route_occupancy_band_hourly — hour-grain crowding spine (rollup_kind="route_occupancy_band_hourly").

Append-only, closed-day reduction of gold.fact_vehicle_snapshot occupancy bands at the
finest hour-grain the vehicle fact supports: (provider_id, route_id, provider_local_date,
hour_of_day_local). NO direction_id — fact_vehicle_snapshot carries NO direction (unlike
the trip-delay/silver side that feeds route_delay_spine, migration 0063); inventing one
would make the builder fail. The read-time time-of-day crowding projection
(occupancy_by_hour on RouteReliability) derives from this one table, mirroring how the
grain-aware §04 crowding surfaces derive from route_occupancy_band_daily.

Band predicates are IDENTICAL to gold.route_occupancy_band_daily (migration 0048):
GTFS-RT OccupancyStatus codes 0-5 (obs=IN(0,1,2,3,4,5), empty=0, many_seats=1,
few_seats=2, standing=IN(3,4) [CRUSHED_STANDING code 4 folded], full=5), COALESCE a NULL
route_id to '__unrouted__'. The ONLY grouping difference vs the daily table is the added
hour_of_day_local = EXTRACT(HOUR FROM timezone(dp.timezone, captured_at_utc)) key.

daily == Σ hourly BY CONSTRUCTION: both group the SAME closed-day fact partition
(snapshot_date_key = :date_key) with the SAME band predicates; the hourly builder only
adds hour_of_day_local to the GROUP BY, so summing the 6 band counts over the hourly rows
of one (provider, route, date) reproduces the daily row's 6 band counts exactly. That is
the parity invariant asserted by the real-DB test (test_occupancy_hourly_parity_real_db).

Volume: route_occupancy_band_daily is ~1 row per (route, day) — STM has ~220 routes with
occupancy telemetry. Hourly multiplies by populated service hours (~20/day, 05:00-01:00),
so ~220 x 20 = ~4,400 rows/day (~20x the daily table). At 730d retention that is ~3.2M
rows x ~80 bytes/row ≈ ~260 MB + ~30% for the (provider,route,date) index ≈ ~340 MB —
well within the append-only budget (route_delay_spine is already larger at
route x hour x direction).

Lifecycle: NOT in REPORTING_AGGREGATE_TABLES — accrued history is never DELETE+UPSERT
wiped; pruned at GOLD_WARM_ROLLUP_RETENTION_DAYS (730d) via the append-only retention
lists in maintenance/gold.py (GOLD_APPEND_ONLY_DAILY_TABLES +
GOLD_AGGREGATE_RETENTION_COLUMNS). Clones the append-only lifecycle of 0048 (band rollup)
+ 0063 (spine). Reversible: downgrade drops the index then the table.

DST note: hour_of_day_local uses timezone(dp.timezone, captured_at_utc), so a fall-back
day can repeat a local hour (two captured_at bucket to the same hour_of_day_local); the PK
tolerates 0-23 and ON CONFLICT DO UPDATE merges the repeated hour's counts (correct — the
merge is a re-reduction of the same closed-day partition, not double counting).

Alembic migration modules are independent — the _built_at_column / _provider_fk /
_occupancy_band_columns helpers are re-declared here rather than imported from 0056/0063.

Revision ID: 0074_route_occupancy_band_hourly
Revises: 0073_route_scheduled_trips_daily
Create Date: 2026-07-02
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0074_route_occupancy_band_hourly"
down_revision = "0073_route_scheduled_trips_daily"
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
    # Copied verbatim from 0056_stop_occupancy_band_daily.py (route sibling 0048).
    return [
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("empty_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("many_seats_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("few_seats_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("standing_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("full_count", sa.Integer(), nullable=False, server_default="0"),
    ]


def upgrade() -> None:
    op.create_table(
        "route_occupancy_band_hourly",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("provider_local_date", sa.Date(), nullable=False),
        sa.Column("hour_of_day_local", sa.SmallInteger(), nullable=False),
        *_occupancy_band_columns(),
        _built_at_column(),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "route_id",
            "provider_local_date",
            "hour_of_day_local",
            name="pk_gold_route_occupancy_band_hourly",
        ),
        _provider_fk("route_occupancy_band_hourly"),
        schema="gold",
    )
    # Secondary index for the per-route point+range read (occupancy_by_hour), matching
    # gold.route_occupancy_band_daily which carries the same index (the route read is a
    # POINT scan, unlike the BATCHED stop mirror that needs none).
    op.create_index(
        "ix_gold_route_occupancy_band_hourly_provider_route_date",
        "route_occupancy_band_hourly",
        ["provider_id", "route_id", "provider_local_date"],
        schema="gold",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_gold_route_occupancy_band_hourly_provider_route_date",
        table_name="route_occupancy_band_hourly",
        schema="gold",
    )
    op.drop_table("route_occupancy_band_hourly", schema="gold")
