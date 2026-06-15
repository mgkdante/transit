"""Persist capped severe-delay counts in the 5-minute delay mart.

Revision ID: 0033_trip_delay_summary_severe_counts
Revises: 0032_alert_counts_by_content_hash
Create Date: 2026-06-12
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0033_trip_delay_summary_severe_counts"
down_revision = "0032_alert_counts_by_content_hash"
branch_labels = None
depends_on = None


_BACKFILL_SEVERE_DELAY_OBSERVATION_COUNTS = """
UPDATE gold.trip_delay_summary_5m AS t
SET severe_delay_observation_count = s.severe_delay_count
FROM (
    SELECT
        provider_id,
        DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01')
            AS period_start_utc,
        COALESCE(route_id, '__unrouted__') AS route_id,
        COUNT(*) FILTER (WHERE delay_seconds > 300 AND ABS(delay_seconds) <= 3600)::integer
            AS severe_delay_count
    FROM gold.fact_trip_delay_snapshot
    WHERE delay_seconds IS NOT NULL
    GROUP BY 1, 2, 3
) AS s
WHERE t.provider_id = s.provider_id
  AND t.period_start_utc = s.period_start_utc
  AND t.route_id = s.route_id
  AND s.severe_delay_count > 0
"""


_CREATE_TRIP_DELAY_SUMMARY_5M_LIVE = """
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
    now() AS built_at_utc,
    COUNT(*) FILTER (WHERE delay_seconds >= -60 AND delay_seconds < 300)::integer
        AS on_time_observation_count,
    MAX(delay_seconds) FILTER (WHERE ABS(delay_seconds) <= 3600)
        AS max_delay_seconds_capped,
    COUNT(*) FILTER (WHERE delay_seconds > 300 AND ABS(delay_seconds) <= 3600)::integer
        AS severe_delay_observation_count
FROM gold.fact_trip_delay_snapshot
WHERE captured_at_utc >= now() - INTERVAL '24 hours'
GROUP BY provider_id,
         DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01'),
         COALESCE(route_id, '__unrouted__')
"""


_RESTORE_0031_TRIP_DELAY_SUMMARY_5M_LIVE = """
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
    now() AS built_at_utc,
    COUNT(*) FILTER (WHERE delay_seconds >= -60 AND delay_seconds < 300)::integer
        AS on_time_observation_count,
    MAX(delay_seconds) FILTER (WHERE ABS(delay_seconds) <= 3600)
        AS max_delay_seconds_capped
FROM gold.fact_trip_delay_snapshot
WHERE captured_at_utc >= now() - INTERVAL '24 hours'
GROUP BY provider_id,
         DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01'),
         COALESCE(route_id, '__unrouted__')
"""


_DROP_TRIP_DELAY_SUMMARY_5M_LIVE = """
DROP VIEW IF EXISTS gold.trip_delay_summary_5m_live
"""


def upgrade() -> None:
    op.add_column(
        "trip_delay_summary_5m",
        sa.Column(
            "severe_delay_observation_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        schema="gold",
    )
    op.execute(_BACKFILL_SEVERE_DELAY_OBSERVATION_COUNTS)
    op.execute(_CREATE_TRIP_DELAY_SUMMARY_5M_LIVE)


def downgrade() -> None:
    op.execute(_DROP_TRIP_DELAY_SUMMARY_5M_LIVE)
    op.execute(_RESTORE_0031_TRIP_DELAY_SUMMARY_5M_LIVE)
    op.drop_column("trip_delay_summary_5m", "severe_delay_observation_count", schema="gold")
