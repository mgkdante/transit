"""Rewrite gold.current_i3_alerts: SCD2-aware + 1 row per alert with aggregated entities.

Revision ID: 0022_gold_current_i3_alerts_scd2_aggregated
Revises: 0021_i3_alerts_scd2_dedup
Create Date: 2026-05-27

Why this migration exists:
    Two bugs in gold.current_i3_alerts after migration 0021 (SCD2 dedup):

    1. The old `latest_snapshot` CTE (from migration 0017) picked
       max(i3_alert_snapshot_id) per provider, then JOINed alerts on that
       snapshot. Post-SCD2 each alert is stored ONCE at its FIRST snapshot,
       so max(snapshot_id) is now just the most-recently-discovered alert's
       snapshot — and only THAT alert + its entities survive the JOIN.
       Result: 720 alerts in silver, 5 rows in gold. Wrong.

    2. The old view spread each alert across its informed_entities (one
       row per route_id OR stop_id). An alert affecting 3 routes + 2 stops
       produced 5 rows. Operators reading the alerts table saw the same
       description repeated with different (route_id, stop_id) cells where
       one of them was always NULL. Confusing.

What this migration does:
    Replaces the view with:
      - SCD2 filter: WHERE valid_to IS NULL (the only filter we need now)
      - One row per alert (the LEFT JOIN with entities is now a GROUP BY
        with string_agg)
      - route_ids: comma-separated, distinct, NULL when no route entities
      - stop_ids:  comma-separated, distinct, NULL when no stop entities
      - Plus counts: route_count, stop_count, entity_count
      - Active-window filter preserved (start <= now <= end)

    The visual layer (p01_alerts table) will need its column projections
    updated to use the new field names (route_ids instead of route_id,
    stop_ids instead of stop_id) — handled in the same commit as the
    visual.json updates.

Downgrade:
    Restores the post-0017 view shape. Note: that shape returns broken
    data after SCD2 (only 5 rows) — downgrade is a "you understand the
    consequences" gesture for rollback testing, not a production path.
"""

from __future__ import annotations

from alembic import op

revision = "0022_gold_current_i3_alerts_scd2_aggregated"
down_revision = "0021_i3_alerts_scd2_dedup"
branch_labels = None
depends_on = None


_REWRITE_GOLD_VIEW = """
CREATE OR REPLACE VIEW gold.current_i3_alerts AS
SELECT
    a.provider_id,
    a.alert_id,
    a.alert_header_text,
    a.description_text,
    a.severity,
    a.cause,
    a.effect,
    string_agg(DISTINCT e.route_id, ', ' ORDER BY e.route_id)
        FILTER (WHERE e.route_id IS NOT NULL) AS route_ids,
    string_agg(DISTINCT e.stop_id,  ', ' ORDER BY e.stop_id)
        FILTER (WHERE e.stop_id  IS NOT NULL) AS stop_ids,
    count(DISTINCT e.route_id) FILTER (WHERE e.route_id IS NOT NULL) AS route_count,
    count(DISTINCT e.stop_id)  FILTER (WHERE e.stop_id  IS NOT NULL) AS stop_count,
    count(e.*) AS entity_count,
    a.active_period_start_utc,
    a.active_period_end_utc,
    a.first_seen_at,
    a.last_seen_at,
    a.captured_at_utc
FROM silver.i3_alerts AS a
LEFT JOIN silver.i3_alert_informed_entities AS e
    ON e.i3_alert_snapshot_id = a.i3_alert_snapshot_id
   AND e.alert_index = a.alert_index
WHERE a.valid_to IS NULL
  AND COALESCE(a.active_period_start_utc, a.captured_at_utc) <= now()
  AND COALESCE(a.active_period_end_utc,   now() + INTERVAL '100 years') >= now()
GROUP BY
    a.provider_id,
    a.alert_id,
    a.alert_header_text,
    a.description_text,
    a.severity,
    a.cause,
    a.effect,
    a.active_period_start_utc,
    a.active_period_end_utc,
    a.first_seen_at,
    a.last_seen_at,
    a.captured_at_utc
"""


# Same shape migration 0021 installed (post-SCD2 but pre-aggregation).
# Restored on downgrade for migration-history parity.
_LEGACY_GOLD_VIEW_FROM_0021 = """
CREATE OR REPLACE VIEW gold.current_i3_alerts AS
WITH latest_snapshot AS (
    SELECT provider_id, max(i3_alert_snapshot_id) AS i3_alert_snapshot_id
    FROM silver.i3_alerts
    WHERE valid_to IS NULL
    GROUP BY provider_id
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
FROM silver.i3_alerts AS a
INNER JOIN latest_snapshot AS ls
    ON ls.provider_id = a.provider_id
   AND ls.i3_alert_snapshot_id = a.i3_alert_snapshot_id
LEFT JOIN silver.i3_alert_informed_entities AS e
    ON e.i3_alert_snapshot_id = a.i3_alert_snapshot_id
   AND e.alert_index = a.alert_index
WHERE a.valid_to IS NULL
  AND COALESCE(a.active_period_start_utc, a.captured_at_utc) <= now()
  AND COALESCE(a.active_period_end_utc, now() + interval '100 years') >= now()
"""


def upgrade() -> None:
    # PG can't rename view columns via CREATE OR REPLACE — must drop first.
    op.execute("DROP VIEW IF EXISTS gold.current_i3_alerts")
    op.execute(_REWRITE_GOLD_VIEW)


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS gold.current_i3_alerts")
    op.execute(_LEGACY_GOLD_VIEW_FROM_0021)
