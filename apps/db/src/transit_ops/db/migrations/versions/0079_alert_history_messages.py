"""Expose source FR/EN descriptions on historic alert reporting.

Revision ID: 0079_alert_history_messages
Revises: 0078_publish_state_gate_telemetry
Create Date: 2026-07-12

The Silver alert row has carried description_text and description_text_en since
0037, but the historic reporting view ended at alert_header_text_en. Upgrade
appends both nullable source columns without changing the view grain or content
hash. Downgrade removes the appended columns and restores the exact pre-0079
view. The former public_alert_impact_daily dependent has been absent since 0059.
"""

from __future__ import annotations

from alembic import op

revision = "0079_alert_history_messages"
down_revision = "0078_publish_state_gate_telemetry"
branch_labels = None
depends_on = None


_REPLACE_HISTORY_VIEW = """
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
    ) AS effective_content_hash,
    a.alert_header_text_en,
    a.description_text,
    a.description_text_en
FROM silver.i3_alerts AS a
INNER JOIN gold.dim_provider AS dp
    ON dp.provider_id = a.provider_id
LEFT JOIN silver.i3_alert_informed_entities AS e
    ON e.i3_alert_snapshot_id = a.i3_alert_snapshot_id
   AND e.alert_index = a.alert_index
"""


_DROP_HISTORY_VIEW = """
DROP VIEW IF EXISTS gold.i3_alert_history_reporting
"""


# Exact pre-0079 shape from 0037: ends at alert_header_text_en.
_HISTORY_VIEW_FROM_0037 = """
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
    ) AS effective_content_hash,
    a.alert_header_text_en
FROM silver.i3_alerts AS a
INNER JOIN gold.dim_provider AS dp
    ON dp.provider_id = a.provider_id
LEFT JOIN silver.i3_alert_informed_entities AS e
    ON e.i3_alert_snapshot_id = a.i3_alert_snapshot_id
   AND e.alert_index = a.alert_index
"""


def upgrade() -> None:
    op.execute(_REPLACE_HISTORY_VIEW)


def downgrade() -> None:
    op.execute(_DROP_HISTORY_VIEW)
    op.execute(_HISTORY_VIEW_FROM_0037)
