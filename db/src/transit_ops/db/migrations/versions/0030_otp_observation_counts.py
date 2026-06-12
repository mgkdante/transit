"""Add observation-based OTP counters to gold rollups.

Revision ID: 0030_otp_observation_counts
Revises: 0029_dim_name_history
Create Date: 2026-06-12
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0030_otp_observation_counts"
down_revision = "0029_dim_name_history"
branch_labels = None
depends_on = None


_BACKFILL_5M_ON_TIME = """
UPDATE gold.trip_delay_summary_5m AS s
SET on_time_observation_count = f.on_time_count
FROM (
    SELECT
        provider_id,
        DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01')
            AS period_start_utc,
        COALESCE(route_id, '__unrouted__') AS route_id,
        COUNT(*) FILTER (WHERE delay_seconds >= -60 AND delay_seconds < 300)::integer
            AS on_time_count
    FROM gold.fact_trip_delay_snapshot
    GROUP BY 1, 2, 3
) AS f
WHERE s.provider_id = f.provider_id
  AND s.period_start_utc = f.period_start_utc
  AND s.route_id = f.route_id
"""


_CREATE_PUBLIC_ROUTE_RELIABILITY_DAILY = """
CREATE OR REPLACE VIEW gold.public_route_reliability_daily AS
SELECT
    rd.provider_id,
    rd.route_id,
    (rd.period_start_utc AT TIME ZONE dp.timezone)::date AS provider_local_date,
    SUM(rd.observation_count)::integer AS stop_time_observation_count,
    ROUND(
        SUM(rd.avg_delay_seconds * NULLIF(rd.delay_observation_count, 0))
        / NULLIF(SUM(rd.delay_observation_count), 0),
        2
    ) AS avg_delay_seconds,
    SUM(rd.severe_delay_count)::integer AS severe_delay_observation_count,
    SUM(rd.delay_observation_count)::integer AS delay_observation_count,
    CASE WHEN COUNT(*) = COUNT(rd.on_time_observation_count)
        THEN SUM(rd.on_time_observation_count)::integer
    END AS on_time_observation_count
FROM gold.route_delay_hourly AS rd
INNER JOIN gold.dim_provider AS dp
    ON dp.provider_id = rd.provider_id
GROUP BY rd.provider_id, rd.route_id, provider_local_date
"""


_CREATE_PUBLIC_ROUTE_RELIABILITY_DAILY_LEGACY = """
CREATE OR REPLACE VIEW gold.public_route_reliability_daily AS
SELECT
    rd.provider_id,
    rd.route_id,
    (rd.period_start_utc AT TIME ZONE dp.timezone)::date AS provider_local_date,
    SUM(rd.observation_count)::integer AS stop_time_observation_count,
    ROUND(
        SUM(rd.avg_delay_seconds * NULLIF(rd.observation_count, 0))
        / NULLIF(SUM(rd.observation_count), 0),
        2
    ) AS avg_delay_seconds,
    SUM(rd.severe_delay_count)::integer AS severe_delay_observation_count
FROM gold.route_delay_hourly AS rd
INNER JOIN gold.dim_provider AS dp
    ON dp.provider_id = rd.provider_id
GROUP BY rd.provider_id, rd.route_id, provider_local_date
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
        AS on_time_observation_count
FROM gold.fact_trip_delay_snapshot
WHERE captured_at_utc >= now() - INTERVAL '24 hours'
GROUP BY provider_id,
         DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01'),
         COALESCE(route_id, '__unrouted__')
"""


_CREATE_TRIP_DELAY_SUMMARY_5M_LIVE_LEGACY = """
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


_DROP_PUBLIC_ROUTE_RELIABILITY_DAILY = """
DROP VIEW IF EXISTS gold.public_route_reliability_daily
"""


_DROP_TRIP_DELAY_SUMMARY_5M_LIVE = """
DROP VIEW IF EXISTS gold.trip_delay_summary_5m_live
"""


def upgrade() -> None:
    op.add_column(
        "trip_delay_summary_5m",
        sa.Column("on_time_observation_count", sa.Integer(), nullable=True),
        schema="gold",
    )

    for table_name in (
        "route_delay_hourly",
        "route_reliability_weekly",
        "route_reliability_monthly",
    ):
        op.add_column(
            table_name,
            sa.Column(
                "delay_observation_count",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            ),
            schema="gold",
        )
        op.add_column(
            table_name,
            sa.Column("on_time_observation_count", sa.Integer(), nullable=True),
            schema="gold",
        )

    op.execute(_BACKFILL_5M_ON_TIME)
    op.execute(_CREATE_PUBLIC_ROUTE_RELIABILITY_DAILY)
    op.execute(_CREATE_TRIP_DELAY_SUMMARY_5M_LIVE)


def downgrade() -> None:
    op.execute(_DROP_PUBLIC_ROUTE_RELIABILITY_DAILY)
    op.execute(_CREATE_PUBLIC_ROUTE_RELIABILITY_DAILY_LEGACY)
    op.execute(_DROP_TRIP_DELAY_SUMMARY_5M_LIVE)
    op.execute(_CREATE_TRIP_DELAY_SUMMARY_5M_LIVE_LEGACY)

    op.drop_column("route_reliability_monthly", "on_time_observation_count", schema="gold")
    op.drop_column("route_reliability_monthly", "delay_observation_count", schema="gold")
    op.drop_column("route_reliability_weekly", "on_time_observation_count", schema="gold")
    op.drop_column("route_reliability_weekly", "delay_observation_count", schema="gold")
    op.drop_column("route_delay_hourly", "on_time_observation_count", schema="gold")
    op.drop_column("route_delay_hourly", "delay_observation_count", schema="gold")
    op.drop_column("trip_delay_summary_5m", "on_time_observation_count", schema="gold")
