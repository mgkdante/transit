"""Retain exact usable delay sums through daily reporting."""

from alembic import op

revision = "0087_exact_daily_delay_means"
down_revision = "0086_daily_warm_retention_indexes"
branch_labels = None
depends_on = None

_DAILY_VIEW = """
CREATE OR REPLACE VIEW gold.public_route_reliability_daily AS
SELECT
    rd.provider_id,
    rd.route_id,
    (rd.period_start_utc AT TIME ZONE dp.timezone)::date AS provider_local_date,
    SUM(rd.observation_count)::integer AS stop_time_observation_count,
    {mean} AS avg_delay_seconds,
    SUM(rd.severe_delay_count)::integer AS severe_delay_observation_count,
    SUM(rd.delay_observation_count)::integer AS delay_observation_count,
    CASE WHEN COUNT(*) = COUNT(rd.on_time_observation_count)
        THEN SUM(rd.on_time_observation_count)::integer
    END AS on_time_observation_count
FROM gold.route_delay_hourly AS rd
JOIN gold.dim_provider AS dp ON dp.provider_id = rd.provider_id
GROUP BY rd.provider_id, rd.route_id, provider_local_date
"""

_EXACT_MEAN = """
CASE WHEN BOOL_AND(
    rd.usable_delay_observation_count IS NOT NULL
    AND (rd.usable_delay_observation_count = 0 OR rd.usable_delay_sum_seconds IS NOT NULL)
) THEN
    SUM(rd.usable_delay_sum_seconds)::numeric
    / NULLIF(SUM(rd.usable_delay_observation_count), 0)
END
"""

_LEGACY_MEAN = """
ROUND(
    SUM(rd.avg_delay_seconds * NULLIF(rd.delay_observation_count, 0))
    / NULLIF(SUM(rd.delay_observation_count), 0), 2
)
"""


def upgrade() -> None:
    op.execute("""
        ALTER TABLE gold.trip_delay_summary_5m
        ADD COLUMN usable_delay_sum_seconds bigint,
        ADD CONSTRAINT ck_trip_delay_5m_usable_sum CHECK (
            usable_delay_sum_seconds IS NULL OR (
                delay_observation_count >= outlier_count
                AND usable_delay_sum_seconds::numeric BETWEEN
                    -3600::numeric * (delay_observation_count - outlier_count)
                    AND 3600::numeric * (delay_observation_count - outlier_count)
            )
        ) NOT VALID
    """)
    op.execute("""
        ALTER TABLE gold.route_delay_hourly
        ADD COLUMN usable_delay_observation_count bigint,
        ADD COLUMN usable_delay_sum_seconds bigint,
        ADD CONSTRAINT ck_route_delay_hourly_usable_count CHECK (
            usable_delay_observation_count IS NULL
            OR usable_delay_observation_count BETWEEN 0 AND delay_observation_count
        ) NOT VALID,
        ADD CONSTRAINT ck_route_delay_hourly_usable_sum CHECK (
            usable_delay_sum_seconds IS NULL OR (
                usable_delay_observation_count IS NOT NULL
                AND usable_delay_sum_seconds::numeric BETWEEN
                    -3600::numeric * usable_delay_observation_count
                    AND 3600::numeric * usable_delay_observation_count
            )
        ) NOT VALID
    """)
    op.execute(_DAILY_VIEW.format(mean=_EXACT_MEAN))


def downgrade() -> None:
    op.execute(_DAILY_VIEW.format(mean=_LEGACY_MEAN))
    op.execute("ALTER TABLE gold.route_delay_hourly DROP COLUMN usable_delay_sum_seconds")
    op.execute("ALTER TABLE gold.route_delay_hourly DROP COLUMN usable_delay_observation_count")
    op.execute("ALTER TABLE gold.trip_delay_summary_5m DROP COLUMN usable_delay_sum_seconds")
