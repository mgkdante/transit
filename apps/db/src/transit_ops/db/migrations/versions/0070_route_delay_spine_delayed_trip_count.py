"""route_delay_spine.delayed_trip_count — additive count column (GC1 / DB-A+ Step G1).

Adds ONE column to gold.route_delay_spine so the citizen_accountability_daily +
network trend/receipts/habit reads can re-point off gold.route_delay_hourly (dropped
in 0071) onto the spine, retiring the last delay-cube fold table.

Grain: the spine PK (provider_id, route_id, service_local_date, hour_of_day_local,
direction_id). delayed_trip_count is the per-grain count of DISTINCT delayed trips
computed to reproduce the legacy route_delay_hourly.delayed_trip_count SUM chain
BYTE-FOR-BYTE. That legacy value is SUM(trip_delay_summary_5m.delayed_trip_count),
i.e. a SUM over 5-minute sub-buckets of COUNT(DISTINCT trip_id) FILTER
(WHERE delay_seconds > 0) — NOT a single hour-grain distinct count. A trip observed
in two 5-minute buckets of the same hour is counted twice by the legacy chain, so the
spine builder likewise SUMs the per-5m distinct counts within each (route, hour,
direction) grain (verified against a multi-5m-bucket adversarial seed). The predicate
mirrors the 5m builder exactly: delay_seconds > 0 with NO ghost clamp (the 5m
delayed_trip_count has no |delay|<=3600 guard, unlike on_time/severe), so ghost-large
positive delays count identically on both paths.

Additive + append-only: NOT NULL DEFAULT 0 (a pre-existing spine row backfills to 0
until the next warm-rollup build recomputes it from the retained fact window; only
citizen_accountability SUMs it, and that is a full DELETE+UPSERT mart rebuilt every
run, so the 0 default never leaks a stale value into a published payload). No index /
constraint change — the column rides the existing PK + provider_route_date index.
Lifecycle append-only (never DELETE+UPSERT wiped), pruned at 730d via the
GOLD_APPEND_ONLY_DAILY_TABLES retention lists in maintenance/gold.py.

Revision ID: 0070_route_delay_spine_delayed_trip_count
Revises: 0069_schedule_version_service_summary
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0070_route_delay_spine_delayed_trip_count"
down_revision = "0069_schedule_version_service_summary"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "route_delay_spine",
        sa.Column(
            "delayed_trip_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        schema="gold",
    )


def downgrade() -> None:
    op.drop_column("route_delay_spine", "delayed_trip_count", schema="gold")
