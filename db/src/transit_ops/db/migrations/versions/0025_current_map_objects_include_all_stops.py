"""Expand gold.current_map_objects to include all stops + transit-app shape categories.

Revision ID: 0025_current_map_objects_include_all_stops
Revises: 0024_gold_current_i3_alerts_synthesized_dedup
Create Date: 2026-05-27

Why this migration exists:
    slice-8.7.2 Phase 2 reframe: the hero map's audience shifted from
    STM dispatcher to citizen-analyst (public accountability tool).
    Transit apps citizens already know (Google Maps Transit, Apple Maps,
    Transit app, STM Bus en direct) all show ALL stops on the map, not
    just stops affected by current disruptions. The previous view
    (migration 0023) hid 8,665 quiet stops because the operator
    framing didn't need them.

What this migration does:
    Rewrites gold.current_map_objects as a 2-leg UNION:

    Leg 1 — vehicles (479 rows):
        Passthrough from gold.current_vehicle_map_with_status. Adds a
        display_category column derived from status_band so ArcGIS
        Symbology can bind it for per-category shape + color (one
        ArcGIS rule per display_category value).

    Leg 2 — all stops (9,164 rows):
        FROM gold.dim_stop LEFT JOIN to the unnest'd
        gold.current_i3_alerts.stop_ids so each stop carries:
          - alert_count (0 for quiet stops, 1+ for alert stops)
          - alert_descriptions (concatenated alert text)
          - routes_serving (routes mentioned in alerts touching this stop)
          - stop_name
        display_category = 'stop_alert' if alert_count > 0 else 'stop_normal'.

    Total ~10K rows. ArcGIS clustering handles density at low zoom.

display_category values (the categorical key ArcGIS uses for shape+color):
    - vehicle_on_time, vehicle_late, vehicle_unknown, vehicle_severe,
      vehicle_early  → circles, colored by delay band
    - stop_normal    → small triangle, neutral color (white/gray)
    - stop_alert     → triangle, RED — visually pops as the problem indicator

Why display_category instead of overloading status_band:
    status_band semantically means "vehicle delay status" (5 bands).
    Adding 'Alerte' and 'Stop' values muddied that. New column keeps
    status_band semantic; display_category is the UI-binding key.

Downgrade:
    Restores the migration-0023 view shape (vehicles + alert-stops only).
"""

from __future__ import annotations

from alembic import op

revision = "0025_current_map_objects_include_all_stops"
down_revision = "0024_gold_current_i3_alerts_synthesized_dedup"
branch_labels = None
depends_on = None


_CREATE_VIEW = """
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


# Migration 0023 view body, restored verbatim on downgrade.
_CREATE_VIEW_FROM_0023 = """
CREATE OR REPLACE VIEW gold.current_map_objects AS
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
    NULL::text AS alert_description
FROM gold.current_vehicle_map_with_status AS cvm
UNION ALL
SELECT
    'alerte'::text AS object_type,
    s.stop_id AS object_id,
    s.stop_lat AS latitude,
    s.stop_lon AS longitude,
    'Alerte'::text AS status_band,
    NULL::text AS route_id,
    NULL::text AS trip_id,
    s.stop_id,
    NULL::numeric(12, 2) AS trip_avg_delay_seconds,
    NULL::integer AS trip_max_delay_seconds,
    a.captured_at_utc,
    a.description_text AS alert_description
FROM gold.current_i3_alerts AS a
JOIN gold.dim_stop AS s
    ON s.provider_id = a.provider_id
   AND s.stop_id = ANY(string_to_array(a.stop_ids, ', '))
WHERE a.stop_ids IS NOT NULL
"""


_DROP_VIEW = """
DROP VIEW IF EXISTS gold.current_map_objects CASCADE
"""


def upgrade() -> None:
    op.execute(_CREATE_VIEW)


def downgrade() -> None:
    op.execute(_DROP_VIEW)
    op.execute(_CREATE_VIEW_FROM_0023)
