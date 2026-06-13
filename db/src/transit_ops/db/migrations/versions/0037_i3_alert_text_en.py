"""Add bilingual EN text to silver.i3_alerts and expose it in the gold views.

Revision ID: 0037_i3_alert_text_en
Revises: 0036_dst_safe_observation_view
Create Date: 2026-06-13

slice-9.1.1s — citizens can read what an alert says in English where STM
publishes it. Two nullable EN columns join silver.i3_alerts; the live worker
INSERT (silver/i3.py) carries them and self-heals EN-only edits onto the
surviving SCD-2 row. EN is NON-identity payload: it is excluded from
compute_alert_content_hash, the 0021 dedup md5, and the 0024 synthesized hash
(slice-9.1.1h invariant), so adding it re-keys nothing.

What this migration does (catalog-light, no big-table scan):
  1. ADD COLUMN IF NOT EXISTS x2 — nullable, no DEFAULT. On the 2.8GB table
     this is a catalog-only change (no rewrite, no autocommit_block needed).
  2. Backfill EN from raw_alert_json over ALL HASHED rows
     (content_hash IS NOT NULL — active AND superseded). The work-set is
     low-thousands: hashed rows only exist since the 2026-06-09 worker redeploy
     (0021 collapsed everything on 2026-05-27 and the old worker wrote NULL-hash
     rows until the redeploy). The 2.7M legacy NULL-hash rows are deliberately
     NOT touched — that is slice-9.1.1l's cleanup territory. A single inline
     UPDATE bounded to the hashed work-set stays small; no batching and no
     explicit table reclaim (the deliberate deviation from the 0017/0021
     batching precedent, justified by the low-thousands count).

     Why superseded rows too (REVIEW FIX): gold.i3_alert_history_reporting has
     NO valid_to filter and build_alert_history windows 30 days, so superseded
     hashed rows feed alert_history.json. The ON CONFLICT self-heal in
     silver/i3.py can only reach ACTIVE rows (the partial unique index is
     WHERE valid_to IS NULL), so for superseded rows this backfill is the ONLY
     EN source for their ~30-day stay in the history window.

  3. CREATE OR REPLACE both gold views, appending the EN columns at the END of
     the select lists. Append-at-end keeps CREATE OR REPLACE legal with the
     dependent views (gold.current_map_objects, gold.public_alert_impact_daily)
     live — no drops on upgrade. The 0024 synthesized-hash dedup key and the
     wave-2 slice-d effective_content_hash (0032) are preserved verbatim.

Residual honest-NULL tail (documented, by design): history entries built solely
from legacy NULL-hash rows captured <= 2026-06-09 carry header_text_en NULL
until they age out of the 30-day window (~2026-07-09). MAX(alert_header_text_en)
in build_alert_history picks the non-NULL value within any mixed legacy+hashed
group. slice-9.1.1l's legacy cleanup shortens this tail.
"""

from __future__ import annotations

from alembic import op

revision = "0037_i3_alert_text_en"
down_revision = "0036_dst_safe_observation_view"
branch_labels = None
depends_on = None


_ADD_COLUMNS = """
ALTER TABLE silver.i3_alerts
    ADD COLUMN IF NOT EXISTS alert_header_text_en TEXT,
    ADD COLUMN IF NOT EXISTS description_text_en TEXT
"""


# Inline backfill bounded to the hashed work-set (low-thousands per the T1
# census). lower(language) IN ('en','eng'); NULLIF(btrim(text),'') keeps blanks
# honest-NULL; jsonb_typeof guards a non-array header_texts/description_texts.
_BACKFILL_EN = """
UPDATE silver.i3_alerts
SET
    alert_header_text_en = (
        SELECT NULLIF(btrim(e->>'text'), '')
        FROM jsonb_array_elements(
            CASE
                WHEN jsonb_typeof(raw_alert_json->'header_texts') = 'array'
                THEN raw_alert_json->'header_texts'
                ELSE '[]'::jsonb
            END
        ) AS e
        WHERE lower(e->>'language') IN ('en', 'eng')
        LIMIT 1
    ),
    description_text_en = (
        SELECT NULLIF(btrim(e->>'text'), '')
        FROM jsonb_array_elements(
            CASE
                WHEN jsonb_typeof(raw_alert_json->'description_texts') = 'array'
                THEN raw_alert_json->'description_texts'
                ELSE '[]'::jsonb
            END
        ) AS e
        WHERE lower(e->>'language') IN ('en', 'eng')
        LIMIT 1
    )
WHERE content_hash IS NOT NULL
"""


# 0024 body + d.alert_header_text_en, d.description_text_en appended at the end
# of the deduped CTE select, the outer SELECT (after d.captured_at_utc) and the
# GROUP BY. The DISTINCT ON md5 dedup key is UNCHANGED (no _en in it).
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


# 0032 body (wave-2 slice-d, with effective_content_hash) + a.alert_header_text_en
# appended at the end of the select list.
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
    a.alert_header_text_en
FROM silver.i3_alerts AS a
INNER JOIN gold.dim_provider AS dp
    ON dp.provider_id = a.provider_id
LEFT JOIN silver.i3_alert_informed_entities AS e
    ON e.i3_alert_snapshot_id = a.i3_alert_snapshot_id
   AND e.alert_index = a.alert_index
"""


# ---------------------------------------------------------------------------
# Downgrade bodies — restore the pre-0037 view shapes verbatim and rebuild the
# cascaded dependents (current_map_objects from 0025, public_alert_impact_daily
# from 0032), then drop the columns.
# ---------------------------------------------------------------------------

_DROP_CURRENT_VIEW = """
DROP VIEW IF EXISTS gold.current_i3_alerts CASCADE
"""


# 0024 body verbatim.
_CURRENT_VIEW_FROM_0024 = """
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


# 0025 body verbatim (current_map_objects depends on current_i3_alerts; the
# CASCADE drop above removed it, so rebuild it on the way down).
_CURRENT_MAP_OBJECTS_FROM_0025 = """
CREATE OR REPLACE VIEW gold.current_map_objects AS
-- vehicles leg
SELECT
    'vehicle'::text AS object_type,
    cvm.vehicle_id AS object_id,
    cvm.latitude,
    cvm.longitude,
    cvm.status_band,
    cvm.route_id,
    cvm.trip_id,
    cvm.stop_id,
    cvm.trip_avg_delay_seconds,
    cvm.trip_max_delay_seconds,
    cvm.captured_at_utc,
    NULL::text AS alert_description,
    0::integer AS alert_count,
    NULL::text AS stop_name,
    NULL::text AS routes_serving,
    CASE cvm.status_band
        WHEN 'À l''heure / On time'  THEN 'vehicle_on_time'
        WHEN 'En retard / Late'      THEN 'vehicle_late'
        WHEN 'Inconnu / Unknown'     THEN 'vehicle_unknown'
        WHEN 'Critique / Severe'     THEN 'vehicle_severe'
        WHEN 'En avance / Early'     THEN 'vehicle_early'
        ELSE                              'vehicle_other'
    END AS display_category
FROM gold.current_vehicle_map_with_status AS cvm
UNION ALL
-- all-stops leg (every stop with valid lat/lon, alert or not)
SELECT
    'stop'::text AS object_type,
    s.stop_id AS object_id,
    s.stop_lat AS latitude,
    s.stop_lon AS longitude,
    NULL::text AS status_band,
    NULL::text AS route_id,
    NULL::text AS trip_id,
    s.stop_id,
    NULL::numeric(12, 2) AS trip_avg_delay_seconds,
    NULL::integer AS trip_max_delay_seconds,
    cnt.last_captured_at AS captured_at_utc,
    cnt.alert_descriptions AS alert_description,
    COALESCE(cnt.alert_count, 0)::integer AS alert_count,
    s.stop_name AS stop_name,
    cnt.routes_serving AS routes_serving,
    CASE
        WHEN COALESCE(cnt.alert_count, 0) > 0 THEN 'stop_alert'
        ELSE 'stop_normal'
    END AS display_category
FROM gold.dim_stop AS s
LEFT JOIN (
    SELECT
        a.provider_id,
        unnest(string_to_array(a.stop_ids, ', ')) AS stop_id,
        count(*) AS alert_count,
        string_agg(DISTINCT a.description_text, ' | ' ORDER BY a.description_text)
            AS alert_descriptions,
        string_agg(DISTINCT a.route_ids, ', ' ORDER BY a.route_ids)
            FILTER (WHERE a.route_ids IS NOT NULL)
            AS routes_serving,
        max(a.captured_at_utc) AS last_captured_at
    FROM gold.current_i3_alerts AS a
    WHERE a.stop_ids IS NOT NULL
    GROUP BY a.provider_id, unnest(string_to_array(a.stop_ids, ', '))
) AS cnt
    ON cnt.provider_id = s.provider_id
   AND cnt.stop_id = s.stop_id
WHERE s.stop_lat IS NOT NULL
  AND s.stop_lon IS NOT NULL
"""


_DROP_HISTORY_VIEW = """
DROP VIEW IF EXISTS gold.i3_alert_history_reporting CASCADE
"""


# 0032 body verbatim (with effective_content_hash, no EN).
_HISTORY_VIEW_FROM_0032 = """
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


# 0032 body verbatim (public_alert_impact_daily depends on the history view; the
# CASCADE drop above removed it, so rebuild it on the way down).
_IMPACT_VIEW_FROM_0032 = """
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


_DROP_COLUMNS = """
ALTER TABLE silver.i3_alerts
    DROP COLUMN IF EXISTS alert_header_text_en,
    DROP COLUMN IF EXISTS description_text_en
"""


def upgrade() -> None:
    op.execute(_ADD_COLUMNS)
    op.execute(_BACKFILL_EN)
    op.execute(_REPLACE_CURRENT_VIEW)
    op.execute(_REPLACE_HISTORY_VIEW)


def downgrade() -> None:
    # current_i3_alerts -> rebuild 0024 shape + its cascaded current_map_objects.
    op.execute(_DROP_CURRENT_VIEW)
    op.execute(_CURRENT_VIEW_FROM_0024)
    op.execute(_CURRENT_MAP_OBJECTS_FROM_0025)
    # history view -> rebuild 0032 shape + its cascaded public_alert_impact_daily.
    op.execute(_DROP_HISTORY_VIEW)
    op.execute(_HISTORY_VIEW_FROM_0032)
    op.execute(_IMPACT_VIEW_FROM_0032)
    op.execute(_DROP_COLUMNS)
