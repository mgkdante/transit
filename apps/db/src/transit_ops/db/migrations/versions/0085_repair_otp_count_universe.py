"""Repair split OTP numerator and denominator universes.

Revision 0030 backfilled ``on_time_observation_count`` from the then-current
trip-delay fact while retaining the 5-minute summary's earlier
``delay_observation_count``. Late-arriving fact rows could therefore make the
on-time subset larger than its delay-known universe. The invalid 5-minute
counts were then summed into ``route_delay_hourly`` and surfaced through the
public daily reliability view.

The original fact rows may already be outside retention, so their complete
delay distribution cannot be reconstructed. The honest repair is to mark the
split on-time numerator unknown while preserving the earlier denominator and
delay statistics. Every affected hourly parent is then rebuilt from its
five-minute children with the existing NULL-propagation rule. Current rollup SQL
computes both counts from one fact read and cannot create this mismatch.

Revision ID: 0085_repair_otp_count_universe
Revises: 0084_alert_language_coverage
Create Date: 2026-08-28
"""

from __future__ import annotations

from alembic import op

revision = "0085_repair_otp_count_universe"
down_revision = "0084_alert_language_coverage"
branch_labels = None
depends_on = None


_CAPTURE_INVALID_5M_KEYS = """
CREATE TEMP TABLE otp_observation_universe_repair_keys ON COMMIT DROP AS
SELECT provider_id, period_start_utc, route_id
FROM gold.trip_delay_summary_5m
WHERE on_time_observation_count > delay_observation_count
"""


_INDEX_INVALID_5M_KEYS = """
CREATE UNIQUE INDEX ON otp_observation_universe_repair_keys
    (provider_id, period_start_utc, route_id)
"""


_MARK_INVALID_5M_ON_TIME_UNKNOWN = """
UPDATE gold.trip_delay_summary_5m AS summary
SET on_time_observation_count = NULL
FROM otp_observation_universe_repair_keys AS repair
WHERE summary.provider_id = repair.provider_id
  AND summary.period_start_utc = repair.period_start_utc
  AND summary.route_id = repair.route_id
"""


_REBUILD_AFFECTED_HOURLY_COUNTS = """
WITH affected_hours AS (
    SELECT DISTINCT
        provider_id,
        date_trunc('hour', period_start_utc) AS period_start_utc,
        route_id
    FROM otp_observation_universe_repair_keys
),
rebuilt AS (
    SELECT
        summary.provider_id,
        date_trunc('hour', summary.period_start_utc) AS period_start_utc,
        summary.route_id,
        SUM(summary.delay_observation_count)::integer AS delay_observation_count,
        CASE WHEN COUNT(*) = COUNT(summary.on_time_observation_count)
            THEN SUM(summary.on_time_observation_count)::integer
        END AS on_time_observation_count
    FROM gold.trip_delay_summary_5m AS summary
    INNER JOIN affected_hours AS affected
        ON affected.provider_id = summary.provider_id
       AND affected.route_id = summary.route_id
       AND summary.period_start_utc >= affected.period_start_utc
       AND summary.period_start_utc < affected.period_start_utc + INTERVAL '1 hour'
    GROUP BY 1, 2, 3
)
UPDATE gold.route_delay_hourly AS hourly
SET
    delay_observation_count = rebuilt.delay_observation_count,
    on_time_observation_count = rebuilt.on_time_observation_count
FROM rebuilt
WHERE hourly.provider_id = rebuilt.provider_id
  AND hourly.period_start_utc = rebuilt.period_start_utc
  AND hourly.route_id = rebuilt.route_id
"""


def upgrade() -> None:
    op.execute(_CAPTURE_INVALID_5M_KEYS)
    op.execute(_INDEX_INVALID_5M_KEYS)
    op.execute(_MARK_INVALID_5M_ON_TIME_UNKNOWN)
    op.execute(_REBUILD_AFFECTED_HOURLY_COUNTS)


def downgrade() -> None:
    raise NotImplementedError(
        "0085 replaces inconsistent on-time counts with honest unknowns and is "
        "intentionally forward-only; the discarded counts are not valid rollback data"
    )
