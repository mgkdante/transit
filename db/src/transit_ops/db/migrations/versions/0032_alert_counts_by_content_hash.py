"""Count historic alert surfaces by synthesized content hash.

Revision ID: 0032_alert_counts_by_content_hash
Revises: 0031_capped_max_delay_5m
Create Date: 2026-06-12

STM's i3 feed leaves alert_id NULL, so COUNT(DISTINCT alert_id) made historic
alert counts read as zero. Migration 0024 fixed the live surface by always
synthesizing a four-field content identity instead of mixing upstream
content_hash with fallback hashes. This migration applies the same identity to
the historic reporting view.

alert_id stays exposed for legacy consumers. effective_content_hash is appended
last so existing view consumers keep their column order, and the persisted
citizen daily mart is backfilled immediately instead of waiting for the next
warm-rollup rebuild.
"""

from __future__ import annotations

from alembic import op

revision = "0032_alert_counts_by_content_hash"
down_revision = "0031_capped_max_delay_5m"
branch_labels = None
depends_on = None


_HISTORY_VIEW = """
CREATE OR REPLACE VIEW gold.i3_alert_history_reporting AS
SELECT
    a.provider_id,
    a.alert_id,
    a.alert_header_text,
    a.severity,
    a.cause,
    a.effect,
    e.route_id,
    e.stop_id,
    e.area_id,
    (a.captured_at_utc AT TIME ZONE dp.timezone)::date AS provider_local_date,
    date_trunc('hour', a.captured_at_utc AT TIME ZONE dp.timezone) AS hour_bucket_local,
    date_trunc('week', a.captured_at_utc AT TIME ZONE dp.timezone) AS week_bucket_local,
    date_trunc('month', a.captured_at_utc AT TIME ZONE dp.timezone) AS month_bucket_local,
    date_trunc('year', a.captured_at_utc AT TIME ZONE dp.timezone)
        AS rolling_year_bucket_local,
    a.active_period_start_utc,
    a.active_period_end_utc,
    a.captured_at_utc,
    md5(
        COALESCE(a.description_text, '') ||
        COALESCE(a.severity, '') ||
        COALESCE(a.cause, '') ||
        COALESCE(a.effect, '')
    ) AS effective_content_hash
FROM silver.i3_alerts AS a
INNER JOIN gold.dim_provider AS dp
    ON dp.provider_id = a.provider_id
LEFT JOIN silver.i3_alert_informed_entities AS e
    ON e.i3_alert_snapshot_id = a.i3_alert_snapshot_id
   AND e.alert_index = a.alert_index
"""


_IMPACT_VIEW = """
CREATE OR REPLACE VIEW gold.public_alert_impact_daily AS
SELECT
    provider_id,
    route_id,
    stop_id,
    area_id,
    provider_local_date,
    count(DISTINCT effective_content_hash)::integer AS alert_count
FROM gold.i3_alert_history_reporting
GROUP BY provider_id, route_id, stop_id, area_id, provider_local_date
"""


_BACKFILL_CITIZEN_ACCOUNTABILITY_DAILY = """
UPDATE gold.citizen_accountability_daily AS cad
SET
    alert_count = COALESCE(a.alert_count, 0),
    rider_impact_score = LEAST(
        ROUND(
            (
                COALESCE(cad.affected_route_count, 0)::numeric * 2
                + COALESCE(cad.affected_stop_count, 0)::numeric
                + COALESCE(cad.delayed_trip_count, 0)::numeric
                + COALESCE(cad.severe_delay_count, 0)::numeric * 3
                + COALESCE(a.alert_count, 0)::numeric * 2
            ),
            4
        ),
        9999.9999
    )
FROM (
    SELECT
        provider_id,
        provider_local_date,
        COUNT(DISTINCT effective_content_hash)::integer AS alert_count
    FROM gold.i3_alert_history_reporting
    GROUP BY 1, 2
) AS a
WHERE cad.provider_id = a.provider_id
  AND cad.provider_local_date = a.provider_local_date
"""


_DROP_IMPACT_VIEW = """
DROP VIEW IF EXISTS gold.public_alert_impact_daily
"""


_DROP_HISTORY_VIEW = """
DROP VIEW IF EXISTS gold.i3_alert_history_reporting
"""


_HISTORY_VIEW_FROM_0013 = """
CREATE OR REPLACE VIEW gold.i3_alert_history_reporting AS
SELECT
    a.provider_id,
    a.alert_id,
    a.alert_header_text,
    a.severity,
    a.cause,
    a.effect,
    e.route_id,
    e.stop_id,
    e.area_id,
    (a.captured_at_utc AT TIME ZONE dp.timezone)::date AS provider_local_date,
    date_trunc('hour', a.captured_at_utc AT TIME ZONE dp.timezone) AS hour_bucket_local,
    date_trunc('week', a.captured_at_utc AT TIME ZONE dp.timezone) AS week_bucket_local,
    date_trunc('month', a.captured_at_utc AT TIME ZONE dp.timezone) AS month_bucket_local,
    date_trunc('year', a.captured_at_utc AT TIME ZONE dp.timezone)
        AS rolling_year_bucket_local,
    a.active_period_start_utc,
    a.active_period_end_utc,
    a.captured_at_utc
FROM silver.i3_alerts AS a
INNER JOIN gold.dim_provider AS dp
    ON dp.provider_id = a.provider_id
LEFT JOIN silver.i3_alert_informed_entities AS e
    ON e.i3_alert_snapshot_id = a.i3_alert_snapshot_id
   AND e.alert_index = a.alert_index
"""


_IMPACT_VIEW_FROM_0013 = """
CREATE OR REPLACE VIEW gold.public_alert_impact_daily AS
SELECT
    provider_id,
    route_id,
    stop_id,
    area_id,
    provider_local_date,
    count(DISTINCT alert_id)::integer AS alert_count
FROM gold.i3_alert_history_reporting
GROUP BY provider_id, route_id, stop_id, area_id, provider_local_date
"""


def upgrade() -> None:
    op.execute(_HISTORY_VIEW)
    op.execute(_IMPACT_VIEW)
    op.execute(_BACKFILL_CITIZEN_ACCOUNTABILITY_DAILY)


def downgrade() -> None:
    op.execute(_DROP_IMPACT_VIEW)
    op.execute(_DROP_HISTORY_VIEW)
    op.execute(_HISTORY_VIEW_FROM_0013)
    op.execute(_IMPACT_VIEW_FROM_0013)
