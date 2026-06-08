"""Create gold.trip_delay_summary_5m_live as a SQL view over fact_trip_delay_snapshot.

Revision ID: 0019_trip_delay_summary_5m_live_view
Revises: 0018_current_trip_delay_exclude_stale
Create Date: 2026-05-27

Why this migration exists:
    Power BI's Network Health page (p00_delay_trend line chart) showed a
    fixed ~20-hour window from "yesterday 3:20 PM EDT to yesterday 11 AM
    EDT" because its source `gold.trip_delay_summary_5m` is a batch mart
    built by a once-per-day GitHub Actions workflow (cron 0 7 * * *).

    For "operator-now" dashboards, a batch mart is the wrong source —
    the line chart is permanently stale until the next day's build, and
    permanently broken if a single workflow run is missed (as happened
    when the rollup last built at 2026-05-26 15:27 UTC and the chart
    showed nothing newer than 11 AM EDT yesterday for the next 14+ hours).

What this migration does:
    Creates `gold.trip_delay_summary_5m_live` as a SQL view that aggregates
    `gold.fact_trip_delay_snapshot` (the same source the batch rollup
    uses) into the same 5-minute bucketed shape, but always over the
    last 24 hours of data — recomputed live on every query.

    The view returns the same column shape as `gold.trip_delay_summary_5m`
    so it's a drop-in replacement for the line-chart visual binding.

Architectural split:
    - gold.trip_delay_summary_5m         → batch mart, ~24h delay, cheap
      to query over many days, 365-day retention. Used by History,
      Confiance des données, Habitudes pages where "yesterday vs last
      week" matters and live freshness doesn't.
    - gold.trip_delay_summary_5m_live    → live view, always current,
      bounded to last 24h. Used by Network Health (p00_delay_trend) and
      any other "operator-now" visual.

Performance:
    24h of fact_trip_delay_snapshot is ~100-300k rows (depending on
    realtime cadence). With the existing index on (provider_id,
    captured_at_utc), the aggregation runs sub-second. Power BI
    DirectQuery refreshes every ~30s = ~2880 view executions/day,
    well within DB budget.

Downgrade:
    Drops the view. Safe — no downstream code reads from it yet at
    migration time.
"""

from __future__ import annotations

from alembic import op

revision = "0019_trip_delay_summary_5m_live_view"
down_revision = "0018_current_trip_delay_exclude_stale"
branch_labels = None
depends_on = None


_CREATE_LIVE_VIEW = """
CREATE OR REPLACE VIEW gold.trip_delay_summary_5m_live AS
SELECT
    provider_id,
    DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01') AS period_start_utc,
    COALESCE(route_id, '__unrouted__') AS route_id,
    COUNT(DISTINCT trip_id)::integer AS trip_count,
    COUNT(*)::integer AS observation_count,
    COUNT(delay_seconds)::integer AS delay_observation_count,
    AVG(delay_seconds::numeric) AS avg_delay_seconds,
    AVG(delay_seconds::numeric) FILTER (WHERE ABS(delay_seconds) <= 3600)
        AS avg_delay_seconds_capped,
    MAX(delay_seconds) AS max_delay_seconds,
    MIN(delay_seconds) AS min_delay_seconds,
    COUNT(DISTINCT trip_id) FILTER (WHERE delay_seconds > 0)::integer
        AS delayed_trip_count,
    COUNT(*) FILTER (WHERE ABS(delay_seconds) > 3600)::integer AS outlier_count,
    now() AS built_at_utc
FROM gold.fact_trip_delay_snapshot
WHERE captured_at_utc >= now() - INTERVAL '24 hours'
GROUP BY provider_id,
         DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01'),
         COALESCE(route_id, '__unrouted__')
"""


_DROP_LIVE_VIEW = """
DROP VIEW IF EXISTS gold.trip_delay_summary_5m_live
"""


def upgrade() -> None:
    op.execute(_CREATE_LIVE_VIEW)


def downgrade() -> None:
    op.execute(_DROP_LIVE_VIEW)
