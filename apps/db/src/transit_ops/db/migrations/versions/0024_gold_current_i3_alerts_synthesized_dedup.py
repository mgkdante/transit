"""Rewrite gold.current_i3_alerts with synthesized-hash dedup for old-ingestion-code rows.

Revision ID: 0024_gold_current_i3_alerts_synthesized_dedup
Revises: 0023_current_map_objects_union_view
Create Date: 2026-05-27

Why this migration exists:
    Discovered during slice-8.7.2 Phase 2 verification (after the
    current_map_objects view in migration 0023 produced 17,583 alert-stop
    rows where ~777 were expected):

      silver.i3_alerts has 23,459 rows; 22,739 have content_hash=NULL.

    These are the "currently still writing some NULL rows under old code
    path" rows flagged in the slice-8.7 cross-cutting follow-ups (worker
    redeploy + SET NOT NULL on content_hash is deferred).

    Migration 0021's SCD2 dedup keys on content_hash to close valid_to,
    so NULL-content_hash rows never collapse. Every realtime cycle stamps
    new ones and gold.current_i3_alerts (migration 0022) GROUP BYs by
    (alert_id, ...) — but the STM i3 feed leaves alert_id NULL, so the
    GROUP BY can't collapse those near-duplicates either. Result: 15K+
    gold rows from 704 unique alerts (by content).

What this migration does:
    Wraps the GROUP BY in a DISTINCT ON CTE keyed on a synthesized hash
    computed over the alert's stable content fields:

      effective_hash = md5(
          COALESCE(description_text, '') ||
          COALESCE(severity, '') ||
          COALESCE(cause, '') ||
          COALESCE(effect, '')
      )

    DISTINCT ON (provider_id, effective_hash) picks the latest-seen silver
    row per dedup group (ORDER BY last_seen_at DESC, snapshot id DESC for
    deterministic tiebreak). The post-dedup CTE feeds the existing 0022
    aggregation pipeline (entity LEFT JOIN + string_agg + GROUP BY).

    Why ignore the upstream content_hash:
        First implementation tried COALESCE(content_hash, md5(...)). That
        produced 1,347 hash groups (720 from new-path real hashes + 627
        from synthesized hashes on old-path rows) — the SAME operational
        alert appears in BOTH the new-path and old-path silver rows but
        the two hashes differ, so dedup misses them. Always synthesizing
        unifies both paths against the same key. content_hash stays in
        silver for debugging / future provenance — just not used for
        dedup here.

Live impact at migration time:
    Before: 15,215+ gold rows (growing every realtime cycle)
    After:  ~704 gold rows (one per distinct alert content)

Downgrade:
    Restores the migration-0022 view shape verbatim. Note: that shape
    returns 15K+ near-duplicates as long as the silver NULL-content_hash
    rows exist — downgrade is for rollback testing, not a production path.
"""

from __future__ import annotations

from alembic import op

revision = "0024_gold_current_i3_alerts_synthesized_dedup"
down_revision = "0023_current_map_objects_union_view"
branch_labels = None
depends_on = None


_CREATE_VIEW = """
CREATE OR REPLACE VIEW gold.current_i3_alerts AS
WITH deduped AS (
    SELECT DISTINCT ON (
        a.provider_id,
        md5(
            COALESCE(a.description_text, '') ||
            COALESCE(a.severity, '') ||
            COALESCE(a.cause, '') ||
            COALESCE(a.effect, '')
        )
    )
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
        a.captured_at_utc,
        a.i3_alert_snapshot_id,
        a.alert_index
    FROM silver.i3_alerts AS a
    WHERE a.valid_to IS NULL
    ORDER BY
        a.provider_id,
        md5(
            COALESCE(a.description_text, '') ||
            COALESCE(a.severity, '') ||
            COALESCE(a.cause, '') ||
            COALESCE(a.effect, '')
        ),
        a.last_seen_at DESC NULLS LAST,
        a.i3_alert_snapshot_id DESC
)
SELECT
    d.provider_id,
    d.alert_id,
    d.alert_header_text,
    d.description_text,
    d.severity,
    d.cause,
    d.effect,
    string_agg(DISTINCT e.route_id, ', ' ORDER BY e.route_id)
        FILTER (WHERE e.route_id IS NOT NULL) AS route_ids,
    string_agg(DISTINCT e.stop_id,  ', ' ORDER BY e.stop_id)
        FILTER (WHERE e.stop_id  IS NOT NULL) AS stop_ids,
    count(DISTINCT e.route_id) FILTER (WHERE e.route_id IS NOT NULL) AS route_count,
    count(DISTINCT e.stop_id)  FILTER (WHERE e.stop_id  IS NOT NULL) AS stop_count,
    count(e.*) AS entity_count,
    d.active_period_start_utc,
    d.active_period_end_utc,
    d.first_seen_at,
    d.last_seen_at,
    d.captured_at_utc
FROM deduped AS d
LEFT JOIN silver.i3_alert_informed_entities AS e
    ON e.i3_alert_snapshot_id = d.i3_alert_snapshot_id
   AND e.alert_index = d.alert_index
WHERE COALESCE(d.active_period_start_utc, d.captured_at_utc) <= now()
  AND COALESCE(d.active_period_end_utc,   now() + INTERVAL '100 years') >= now()
GROUP BY
    d.provider_id,
    d.alert_id,
    d.alert_header_text,
    d.description_text,
    d.severity,
    d.cause,
    d.effect,
    d.active_period_start_utc,
    d.active_period_end_utc,
    d.first_seen_at,
    d.last_seen_at,
    d.captured_at_utc
"""


# Migration 0022 view body, restored verbatim on downgrade. Note: returns
# 15K+ near-duplicates until the worker redeploy lands content_hash NOT
# NULL — downgrade is for rollback testing, not a production path.
_CREATE_VIEW_FROM_0022 = """
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


_DROP_VIEW = """
DROP VIEW IF EXISTS gold.current_i3_alerts CASCADE
"""


def upgrade() -> None:
    op.execute(_CREATE_VIEW)


def downgrade() -> None:
    # CASCADE: gold.current_map_objects (migration 0023) depends on this view.
    # Downgrade re-creates the 0022-shape view and the cascade drops + we let
    # 0023's downgrade rebuild current_map_objects on the way down.
    op.execute(_DROP_VIEW)
    op.execute(_CREATE_VIEW_FROM_0022)
