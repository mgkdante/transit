"""Add capped max delay for historic ghost-trip resistant rollups.

Revision ID: 0031_capped_max_delay_5m
Revises: 0030_otp_observation_counts
Create Date: 2026-06-12
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0031_capped_max_delay_5m"
down_revision = "0030_otp_observation_counts"
branch_labels = None
depends_on = None


_BACKFILL_COPY_SQL = """
UPDATE gold.trip_delay_summary_5m
SET max_delay_seconds_capped = max_delay_seconds
WHERE max_delay_seconds IS NOT NULL
  AND ABS(max_delay_seconds) <= 3600
"""


_BACKFILL_RECOMPUTE_SQL = """
UPDATE gold.trip_delay_summary_5m AS s
SET max_delay_seconds_capped = f.capped_max
FROM (
    SELECT
        provider_id,
        DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01')
            AS period_start_utc,
        COALESCE(route_id, '__unrouted__') AS route_id,
        MAX(delay_seconds) FILTER (WHERE ABS(delay_seconds) <= 3600) AS capped_max
    FROM gold.fact_trip_delay_snapshot
    GROUP BY 1, 2, 3
) AS f
WHERE s.provider_id = f.provider_id
  AND s.period_start_utc = f.period_start_utc
  AND s.route_id = f.route_id
  AND ABS(s.max_delay_seconds) > 3600
"""


_BACKFILL_HOURLY_CAPPED_AVG_MAX = """
UPDATE gold.route_delay_hourly AS rd
SET
    avg_delay_seconds = h.avg_delay_seconds,
    max_delay_seconds = h.max_delay_seconds
FROM (
    SELECT
        provider_id,
        date_trunc('hour', period_start_utc) AS period_start_utc,
        route_id,
        ROUND(
            SUM(avg_delay_seconds_capped * NULLIF(delay_observation_count - outlier_count, 0))
            / NULLIF(SUM(delay_observation_count - outlier_count), 0),
            2
        ) AS avg_delay_seconds,
        MAX(max_delay_seconds_capped) AS max_delay_seconds
    FROM gold.trip_delay_summary_5m
    GROUP BY 1, 2, 3
) AS h
WHERE rd.provider_id = h.provider_id
  AND rd.period_start_utc = h.period_start_utc
  AND rd.route_id = h.route_id
"""


_BACKFILL_HOURLY_CAPPED_SEVERE_FACT_WINDOW = """
UPDATE gold.route_delay_hourly AS rd
SET severe_delay_count = s.severe_delay_count
FROM (
    SELECT
        provider_id,
        date_trunc('hour', captured_at_utc) AS period_start_utc,
        COALESCE(route_id, '__unrouted__') AS route_id,
        COUNT(*) FILTER (
            WHERE delay_seconds > 300 AND ABS(delay_seconds) <= 3600
        )::integer AS severe_delay_count
    FROM gold.fact_trip_delay_snapshot
    WHERE delay_seconds IS NOT NULL
    GROUP BY 1, 2, 3
) AS s
WHERE rd.provider_id = s.provider_id
  AND rd.period_start_utc = s.period_start_utc
  AND rd.route_id = s.route_id
"""


_BACKFILL_WEEKLY_CAPPED_DELAY_STATS = """
UPDATE gold.route_reliability_weekly AS rr
SET
    avg_delay_seconds = CASE
        WHEN b.delay_observation_count > 0 THEN b.avg_delay_seconds
        ELSE rr.avg_delay_seconds
    END,
    severe_delay_count = b.severe_delay_count
FROM (
    SELECT
        rd.provider_id,
        date_trunc('week', timezone(dp.timezone, rd.period_start_utc))::date
            AS week_start_local,
        rd.route_id,
        SUM(rd.delay_observation_count)::integer AS delay_observation_count,
        ROUND(
            SUM(rd.avg_delay_seconds * NULLIF(rd.delay_observation_count, 0))
            / NULLIF(SUM(rd.delay_observation_count), 0),
            2
        ) AS avg_delay_seconds,
        SUM(rd.severe_delay_count)::integer AS severe_delay_count
    FROM gold.route_delay_hourly AS rd
    INNER JOIN gold.dim_provider AS dp
        ON dp.provider_id = rd.provider_id
    GROUP BY 1, 2, 3
) AS b
WHERE rr.provider_id = b.provider_id
  AND rr.week_start_local = b.week_start_local
  AND rr.route_id = b.route_id
"""


_BACKFILL_MONTHLY_CAPPED_DELAY_STATS = """
UPDATE gold.route_reliability_monthly AS rr
SET
    avg_delay_seconds = CASE
        WHEN b.delay_observation_count > 0 THEN b.avg_delay_seconds
        ELSE rr.avg_delay_seconds
    END,
    severe_delay_count = b.severe_delay_count
FROM (
    SELECT
        rd.provider_id,
        date_trunc('month', timezone(dp.timezone, rd.period_start_utc))::date
            AS month_start_local,
        rd.route_id,
        SUM(rd.delay_observation_count)::integer AS delay_observation_count,
        ROUND(
            SUM(rd.avg_delay_seconds * NULLIF(rd.delay_observation_count, 0))
            / NULLIF(SUM(rd.delay_observation_count), 0),
            2
        ) AS avg_delay_seconds,
        SUM(rd.severe_delay_count)::integer AS severe_delay_count
    FROM gold.route_delay_hourly AS rd
    INNER JOIN gold.dim_provider AS dp
        ON dp.provider_id = rd.provider_id
    GROUP BY 1, 2, 3
) AS b
WHERE rr.provider_id = b.provider_id
  AND rr.month_start_local = b.month_start_local
  AND rr.route_id = b.route_id
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
        AS max_delay_seconds_capped
FROM gold.fact_trip_delay_snapshot
WHERE captured_at_utc >= now() - INTERVAL '24 hours'
GROUP BY provider_id,
         DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01'),
         COALESCE(route_id, '__unrouted__')
"""


_RESTORE_0030_TRIP_DELAY_SUMMARY_5M_LIVE = """
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
        AS on_time_observation_count
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
        sa.Column("max_delay_seconds_capped", sa.Integer(), nullable=True),
        schema="gold",
    )

    op.execute(_BACKFILL_COPY_SQL)
    op.execute(_BACKFILL_RECOMPUTE_SQL)
    op.execute(_BACKFILL_HOURLY_CAPPED_AVG_MAX)
    op.execute(_BACKFILL_HOURLY_CAPPED_SEVERE_FACT_WINDOW)
    op.execute(_BACKFILL_WEEKLY_CAPPED_DELAY_STATS)
    op.execute(_BACKFILL_MONTHLY_CAPPED_DELAY_STATS)
    op.execute(_CREATE_TRIP_DELAY_SUMMARY_5M_LIVE)


def downgrade() -> None:
    op.execute(_DROP_TRIP_DELAY_SUMMARY_5M_LIVE)
    op.execute(_RESTORE_0030_TRIP_DELAY_SUMMARY_5M_LIVE)
    op.drop_column("trip_delay_summary_5m", "max_delay_seconds_capped", schema="gold")
