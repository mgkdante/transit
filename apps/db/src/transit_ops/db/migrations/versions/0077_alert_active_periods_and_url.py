"""alert multi-period capture + url passthrough (S15).

Revision ID: 0077_alert_active_periods_and_url
Revises: 0076_drop_route_habit_score
Create Date: 2026-07-02

WHY THIS MIGRATION EXISTS
    Two long-standing truncations dropped alert data at ingest:

    1. ingestion/service_alerts.py _active_period took only alert.active_period[0]
       (the GTFS-RT protobuf carries a LIST of TimeRanges). A genuinely
       multi-window alert (e.g. a weekend closure repeated over three weekends)
       collapsed to its first window.
    2. silver/i3.py _active_period returned only period[0] as the scalar
       (active_period_start_utc, active_period_end_utc) pair. Extra windows were
       never persisted.

    Neither path ever extracted alert.url (GTFS-RT TranslatedString), so the
    live/historic alert contracts carried no citizen-facing link.

WHAT THIS MIGRATION DOES (additive-only)
    * New child table silver.i3_alert_active_periods, one row per (alert,
      period_index). It mirrors the informed_entities child-table pattern
      (0013:231-266): PK (i3_alert_snapshot_id, alert_index, period_index),
      FK -> silver.i3_alerts (i3_alert_snapshot_id, alert_index) ON DELETE
      CASCADE. period_index 0 duplicates the scalar pair (kept for backward-
      compat: the scalar columns STILL mean period[0], the primary window);
      indices >= 1 are the newly-captured extra windows. start_utc / end_utc are
      nullable (an open-ended window omits one bound).
    * Additive nullable url TEXT + url_en TEXT on silver.i3_alerts (honest-NULL
      where the feed omits a link, e.g. STM's i3 which carries no url key).

    GRAIN: one active-period row per (snapshot, alert, period_index). Rows ride
    the parent silver.i3_alerts SCD-2 lifecycle via the ON DELETE CASCADE — a new
    SCD-2 row inserts its own period set, and a pruned parent (retention sweep,
    maintenance/i3.py) cascades its periods away. There are no orphan periods.

HASH-CUTOVER LAW (compute_alert_content_hash, silver/i3.py)
    The content hash gains a digest of periods with index >= 1 that contributes
    the EMPTY STRING when the alert is single-period. Every existing single-period
    row therefore hashes IDENTICALLY to the pre-S15 formula (no SCD-2 re-row
    churn on deploy). A genuinely multi-period alert re-rows ONCE when its extra
    windows first get captured — correct, because its content identity honestly
    changed. url is NOT hashed (consistent with the EN-text exclusion: it is
    non-identity display payload, refreshed in place on the surviving row). There
    is NO live SQL twin of the hash to move in lockstep: migration 0021's md5()
    was a one-time backfill; the SCD-2 write path hashes in Python only.

HONEST BOUNDARY
    History captured before 0077 has ONLY period[0] and a NULL url — the extra
    windows were dropped at ingest and are NOT recoverable. The alert_history
    builder serves such rows as a 1-element active_periods list (the scalar pair)
    and a NULL url. New captures carry the full list.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0077_alert_active_periods_and_url"
down_revision = "0076_drop_route_habit_score"
branch_labels = None
depends_on = None


# gold.current_i3_alerts: the 0037 body + url / url_en / active_periods APPENDED at
# the END of the select list (append-at-end keeps CREATE OR REPLACE legal; the view
# has NO dependent views at head — 0059 dropped gold.current_map_objects). The
# DISTINCT ON dedup key and every other column are UNCHANGED. active_periods is a
# jsonb_agg of the winning silver row's child periods (ordered by period_index),
# NULL when the row predates the 0077 child table (the live builder falls back to
# the scalar pair then).
_REPLACE_CURRENT_VIEW = """
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
        a.alert_index,
        a.alert_header_text_en,
        a.description_text_en,
        a.url,
        a.url_en
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
    d.captured_at_utc,
    d.alert_header_text_en,
    d.description_text_en,
    d.url,
    d.url_en,
    ap.active_periods
FROM deduped AS d
LEFT JOIN silver.i3_alert_informed_entities AS e
    ON e.i3_alert_snapshot_id = d.i3_alert_snapshot_id
   AND e.alert_index = d.alert_index
LEFT JOIN LATERAL (
    -- jsonb (not json): the outer GROUP BY includes this column, and json has no
    -- equality operator (found by the first real-DB run of this migration).
    SELECT jsonb_agg(
               jsonb_build_object('start_utc', p.start_utc, 'end_utc', p.end_utc)
               ORDER BY p.period_index
           ) AS active_periods
    FROM silver.i3_alert_active_periods AS p
    WHERE p.i3_alert_snapshot_id = d.i3_alert_snapshot_id
      AND p.alert_index = d.alert_index
) AS ap ON true
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
    d.captured_at_utc,
    d.alert_header_text_en,
    d.description_text_en,
    d.url,
    d.url_en,
    ap.active_periods
"""


# 0037 body verbatim — restored on downgrade AFTER the CASCADE drop below rebuilds
# current_map_objects too.
_CURRENT_VIEW_FROM_0037 = """
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
        a.alert_index,
        a.alert_header_text_en,
        a.description_text_en
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
    d.captured_at_utc,
    d.alert_header_text_en,
    d.description_text_en
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
    d.captured_at_utc,
    d.alert_header_text_en,
    d.description_text_en
"""




def upgrade() -> None:
    # Additive url passthrough on the SCD-2 alert row (honest-NULL upstream).
    op.add_column(
        "i3_alerts",
        sa.Column("url", sa.Text(), nullable=True),
        schema="silver",
    )
    op.add_column(
        "i3_alerts",
        sa.Column("url_en", sa.Text(), nullable=True),
        schema="silver",
    )

    # Child table: full active-period list per alert (period_index 0 = the scalar
    # primary window; >=1 = the extra windows the old path truncated).
    op.create_table(
        "i3_alert_active_periods",
        sa.Column("i3_alert_snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("alert_index", sa.Integer(), nullable=False),
        sa.Column("period_index", sa.Integer(), nullable=False),
        sa.Column("start_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_utc", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["i3_alert_snapshot_id", "alert_index"],
            ["silver.i3_alerts.i3_alert_snapshot_id", "silver.i3_alerts.alert_index"],
            name="fk_silver_i3_alert_active_periods_alert",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "i3_alert_snapshot_id",
            "alert_index",
            "period_index",
            name="pk_silver_i3_alert_active_periods",
        ),
        schema="silver",
    )
    # Read shape: the alert_history builder aggregates periods per parent alert
    # row (join on the alert PK, order by period_index). The leading PK columns
    # already serve that read; an explicit index on (snapshot, alert) supports the
    # per-parent aggregation without scanning the PK's period_index tail.
    op.create_index(
        "ix_silver_i3_alert_active_periods_alert",
        "i3_alert_active_periods",
        ["i3_alert_snapshot_id", "alert_index"],
        schema="silver",
    )

    # Expose url / url_en / active_periods on the live view (append-at-end keeps
    # CREATE OR REPLACE legal with the dependent current_map_objects live).
    op.execute(_REPLACE_CURRENT_VIEW)


def downgrade() -> None:
    # Restore the 0037 view shape. CREATE OR REPLACE cannot REMOVE the trailing
    # S15 columns, so plain-drop then recreate. No CASCADE: the view has no
    # dependent views at this point in the chain (0059 dropped current_map_objects),
    # and a plain DROP fails loudly if that ever changes instead of silently
    # cascading a dependent away.
    op.execute("DROP VIEW IF EXISTS gold.current_i3_alerts")
    op.execute(_CURRENT_VIEW_FROM_0037)
    op.drop_index(
        "ix_silver_i3_alert_active_periods_alert",
        table_name="i3_alert_active_periods",
        schema="silver",
    )
    op.drop_table("i3_alert_active_periods", schema="silver")
    op.drop_column("i3_alerts", "url_en", schema="silver")
    op.drop_column("i3_alerts", "url", schema="silver")
