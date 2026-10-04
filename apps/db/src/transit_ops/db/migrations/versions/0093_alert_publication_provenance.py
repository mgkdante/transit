"""Keep published alert messages associated with their source observation."""

from importlib import import_module

from alembic import op

revision = "0093_alert_publication_provenance"
down_revision = "0092_alert_message_observation"
branch_labels = None
depends_on = None


_CURRENT_VIEW = """
CREATE OR REPLACE VIEW gold.current_i3_alerts AS
WITH keyed AS (
    SELECT a.*,
           COALESCE('upstream:' || NULLIF(BTRIM(a.alert_id), ''),
               'synthetic:' || MD5(JSONB_BUILD_ARRAY(
                   COALESCE(a.alert_header_text, ''), COALESCE(a.description_text, ''),
                   EXTRACT(EPOCH FROM a.active_period_start_utc),
                   EXTRACT(EPOCH FROM a.active_period_end_utc)
               )::text)) AS message_key
    FROM silver.i3_alerts a
    WHERE a.valid_to IS NULL
), latest AS (
    SELECT DISTINCT ON (provider_id, message_key) *
    FROM keyed
    ORDER BY provider_id, message_key,
             COALESCE(last_seen_at, captured_at_utc) DESC,
             COALESCE(message_snapshot_id, i3_alert_snapshot_id) DESC,
             COALESCE(message_alert_index, alert_index) DESC,
             i3_alert_snapshot_id DESC, alert_index DESC
)
SELECT d.provider_id, d.alert_id, d.alert_header_text, d.description_text,
       d.severity, d.cause, d.effect,
       e.route_ids, e.stop_ids, e.route_count, e.stop_count, e.entity_count,
       d.active_period_start_utc, d.active_period_end_utc,
       d.first_seen_at, d.last_seen_at, d.captured_at_utc,
       d.alert_header_text_en, d.description_text_en, d.url, d.url_en,
       p.active_periods,
       d.raw_alert_json, d.message_snapshot_id, d.message_alert_index,
       COALESCE(NULLIF(BTRIM(d.alert_id), ''),
           d.provider_id || '-alert-' || SUBSTRING(d.message_key FROM 11 FOR 12))
           AS resolved_alert_id
FROM latest d
LEFT JOIN LATERAL (
    SELECT STRING_AGG(DISTINCT route_id, ', ' ORDER BY route_id) AS route_ids,
           STRING_AGG(DISTINCT stop_id, ', ' ORDER BY stop_id) AS stop_ids,
           COUNT(DISTINCT route_id) AS route_count,
           COUNT(DISTINCT stop_id) AS stop_count, COUNT(*) AS entity_count
    FROM silver.i3_alert_informed_entities
    WHERE i3_alert_snapshot_id = d.i3_alert_snapshot_id AND alert_index = d.alert_index
) e ON true
LEFT JOIN LATERAL (
    SELECT JSONB_AGG(JSONB_BUILD_OBJECT('start_utc', start_utc, 'end_utc', end_utc)
                     ORDER BY period_index) AS active_periods
    FROM silver.i3_alert_active_periods
    WHERE i3_alert_snapshot_id = d.i3_alert_snapshot_id AND alert_index = d.alert_index
) p ON true
WHERE COALESCE(d.active_period_start_utc, d.captured_at_utc) <= now()
  AND COALESCE(d.active_period_end_utc, now() + INTERVAL '100 years') >= now()
"""


def upgrade() -> None:
    op.execute("""
        ALTER TABLE gold.alert_archive_entry
        ADD COLUMN url_en text,
        ADD COLUMN message jsonb
    """)
    op.execute(_CURRENT_VIEW)


def downgrade() -> None:
    op.execute("DROP VIEW gold.current_i3_alerts")
    previous = import_module("transit_ops.db.migrations.versions.0077_alert_active_periods_and_url")
    op.execute(previous._REPLACE_CURRENT_VIEW)
    op.execute("""
        ALTER TABLE gold.alert_archive_entry DROP COLUMN url_en, DROP COLUMN message
    """)
