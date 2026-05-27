"""Dedupe gold.current_i3_alerts: keep only the latest snapshot per alert.

Revision ID: 0016_fix_current_i3_alerts_dedup
Revises: 0015_reporting_view_performance
Create Date: 2026-05-26

Bug:
    `gold.current_i3_alerts` returned ~9.6M rows for a single active alert in
    production. Two stacked multipliers were responsible:

    1. `silver.i3_alerts` is snapshot-based — every realtime cycle (~30s)
       captures the entire current alert set as a fresh snapshot row. One
       alert active for a day produced ~2,800 snapshot rows.
    2. The LEFT JOIN to `silver.i3_alert_informed_entities` multiplied each
       snapshot row by the entities the alert touched (routes, stops, trips,
       areas). One alert touching 887 entities × 2,800 snapshots ≈ 2.5M rows
       per alert. With longer active windows the count exploded further.

    DirectQuery from Power BI failed because the result set exceeded
    Postgres' 1M-row external-data-source max.

Fix:
    Pick the latest `captured_at_utc` per `(provider_id, alert_id)` BEFORE
    joining to informed entities. The view then yields one row per
    (current alert × informed entity), which is the correct grain — an
    alert touching 10 stops still yields 10 rows, but only once.

    Expected row count after fix: tens to low hundreds, not millions.

Downgrade restores the legacy snapshot-fanout shape for rollback parity.
"""

from __future__ import annotations

from alembic import op

revision = "0016_fix_current_i3_alerts_dedup"
down_revision = "0015_reporting_view_performance"
branch_labels = None
depends_on = None


_CURRENT_I3_ALERTS_DEDUPED = """
CREATE OR REPLACE VIEW gold.current_i3_alerts AS
WITH latest_alert_snapshot AS (
    SELECT DISTINCT ON (provider_id, alert_id)
        provider_id,
        alert_id,
        alert_header_text,
        description_text,
        severity,
        cause,
        effect,
        active_period_start_utc,
        active_period_end_utc,
        captured_at_utc,
        i3_alert_snapshot_id,
        alert_index
    FROM silver.i3_alerts
    WHERE COALESCE(active_period_start_utc, captured_at_utc) <= now()
      AND COALESCE(active_period_end_utc, now() + interval '100 years') >= now()
    ORDER BY provider_id, alert_id, captured_at_utc DESC
)
SELECT
    a.provider_id,
    a.alert_id,
    a.alert_header_text,
    a.description_text,
    a.severity,
    a.cause,
    a.effect,
    e.route_id,
    e.stop_id,
    e.trip_id,
    e.area_id,
    a.active_period_start_utc,
    a.active_period_end_utc,
    a.captured_at_utc
FROM latest_alert_snapshot AS a
LEFT JOIN silver.i3_alert_informed_entities AS e
    ON e.i3_alert_snapshot_id = a.i3_alert_snapshot_id
   AND e.alert_index = a.alert_index
"""


_CURRENT_I3_ALERTS_LEGACY = """
CREATE OR REPLACE VIEW gold.current_i3_alerts AS
SELECT
    a.provider_id,
    a.alert_id,
    a.alert_header_text,
    a.description_text,
    a.severity,
    a.cause,
    a.effect,
    e.route_id,
    e.stop_id,
    e.trip_id,
    e.area_id,
    a.active_period_start_utc,
    a.active_period_end_utc,
    a.captured_at_utc
FROM silver.i3_alerts AS a
LEFT JOIN silver.i3_alert_informed_entities AS e
    ON e.i3_alert_snapshot_id = a.i3_alert_snapshot_id
   AND e.alert_index = a.alert_index
WHERE COALESCE(a.active_period_start_utc, a.captured_at_utc) <= now()
  AND COALESCE(a.active_period_end_utc, now() + interval '100 years') >= now()
"""


def upgrade() -> None:
    op.execute(_CURRENT_I3_ALERTS_DEDUPED)


def downgrade() -> None:
    op.execute(_CURRENT_I3_ALERTS_LEGACY)
