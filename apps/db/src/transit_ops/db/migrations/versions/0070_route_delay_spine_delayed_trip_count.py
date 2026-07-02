"""route_delay_spine.delayed_trip_count — additive count column (GC1 / DB-A+ Step G1).

Adds ONE column to gold.route_delay_spine so the citizen_accountability_daily +
network trend/receipts/habit reads can re-point off gold.route_delay_hourly onto the
spine. The hourly table itself is KEPT for now: the public_route_reliability_daily
view (receipts worst-route ranking, an exact-parity field) still reads it — its drop
is GC1.5 scope, gated on the view re-point.

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

Additive + append-only: NOT NULL DEFAULT 0. The daily spine builder only builds
days ABSENT from gold.warm_rollup_periods, so a plain column-add would freeze 0 into
every already-built day forever. upgrade() therefore also DELETEs the spine's
watermarks for the trailing 14 closed days (= GOLD_FACT_RETENTION_DAYS default): the
next warm-rollup build re-enumerates those days and the UPSERT rewrites their rows
with real delayed_trip_count from the retained facts. Days older than fact retention
keep 0 honestly (their facts are gone; nothing reads them for this column —
citizen_accountability's window is open_window_days + 2 << 14, and it is a full
DELETE+UPSERT mart rebuilt every run). No index / constraint change — the column
rides the existing PK + provider_route_date index.
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
    # Invalidate the trailing fact-retention window of spine watermarks so the next
    # warm-rollup build recomputes those days with real delayed_trip_count (the daily
    # builder only builds watermark-absent days). 14 = GOLD_FACT_RETENTION_DAYS
    # default; days beyond it are unrecomputable (facts pruned) and keep 0.
    op.execute(
        "DELETE FROM gold.warm_rollup_periods "
        "WHERE rollup_kind = 'route_delay_spine' "
        "AND period_start_utc >= now() - interval '14 days'"
    )


def downgrade() -> None:
    op.drop_column("route_delay_spine", "delayed_trip_count", schema="gold")
