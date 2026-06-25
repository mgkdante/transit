"""Drop dead Gold views: current_map_objects, public_alert_impact_daily, map_stops,
map_gis_line_features.

S7 pipeline-consolidation cleanup (Gold Relation Catalog, 2026-06-25). All four are
VIEWS with NO production reader — verified against the live code: their only references
were validation COUNT(*) probes, the source-factory catalog, and (for map_stops) a stale
module docstring. None feeds a ``/v1`` document:

* ``current_map_objects`` — orphaned p01-hero UNION view; the live map is assembled from
  ``current_vehicle_map_with_status`` + ``current_stop_next_departures`` instead.
* ``public_alert_impact_daily`` — alert impact in ``/v1`` comes from
  ``i3_alert_history_reporting``; this view was probe-only.
* ``map_stops`` — ``/v1`` stop coordinates come from ``dim_stop`` / silver directly.
* ``map_gis_line_features`` — no builder consumes GIS line features.

The companion code change removes the matching validation probes + catalog entries.
``downgrade`` restores each view from its head definition for full reversibility.

(The 5 legacy ``kpi_*_latest`` views the catalog also flagged were ALREADY dropped by
migration 0014, so they are intentionally absent here.)

Revision ID: 0059_drop_dead_map_alert_views
Revises: 0058_route_delay_by_shift_daytype_crosstab
"""

from __future__ import annotations

from alembic import op

revision = "0059_drop_dead_map_alert_views"
down_revision = "0058_route_delay_by_shift_daytype_crosstab"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # All four are leaf views (nothing depends on them); plain DROP, no CASCADE, so an
    # unexpected dependent would fail loudly rather than cascade silently.
    op.execute("DROP VIEW IF EXISTS gold.current_map_objects")
    op.execute("DROP VIEW IF EXISTS gold.public_alert_impact_daily")
    op.execute("DROP VIEW IF EXISTS gold.map_stops")
    op.execute("DROP VIEW IF EXISTS gold.map_gis_line_features")


def downgrade() -> None:
    op.execute(
        """
        CREATE VIEW gold.map_gis_line_features AS
        SELECT provider_id,
            dataset_version_id,
            source_feature_id,
            route_id,
            route_name,
            headsign,
            shape_id,
            CASE
                WHEN source_crs_epsg IS NULL THEN NULL::geometry
                ELSE st_transform(st_geomfromwkb(source_geometry_wkb, source_crs_epsg), 4326)
            END AS geom_wgs84,
            CASE
                WHEN source_crs_epsg IS NULL THEN NULL::jsonb
                ELSE st_asgeojson(
                    st_transform(st_geomfromwkb(source_geometry_wkb, source_crs_epsg), 4326)
                )::jsonb
            END AS geojson
        FROM silver.gis_line_features
        """
    )
    op.execute(
        """
        CREATE VIEW gold.map_stops AS
        SELECT s.provider_id,
            s.dataset_version_id,
            s.stop_id,
            s.stop_code,
            s.stop_name,
            s.parent_station,
            s.location_type,
            s.stop_lat,
            s.stop_lon,
            st_setsrid(st_makepoint(s.stop_lon, s.stop_lat), 4326) AS geom_wgs84,
            st_asgeojson(st_setsrid(st_makepoint(s.stop_lon, s.stop_lat), 4326))::jsonb AS geojson
        FROM silver.stops s
            JOIN gold.dim_provider dp ON dp.provider_id = s.provider_id
        WHERE s.stop_lat >= '-90'::integer::double precision
            AND s.stop_lat <= 90::double precision
            AND s.stop_lon >= '-180'::integer::double precision
            AND s.stop_lon <= 180::double precision
            AND (dp.min_latitude IS NULL
                OR s.stop_lat >= dp.min_latitude AND s.stop_lat <= dp.max_latitude
                AND s.stop_lon >= dp.min_longitude AND s.stop_lon <= dp.max_longitude)
        """
    )
    op.execute(
        """
        CREATE VIEW gold.public_alert_impact_daily AS
        SELECT provider_id,
            route_id,
            stop_id,
            area_id,
            provider_local_date,
            count(DISTINCT effective_content_hash)::integer AS alert_count
        FROM gold.i3_alert_history_reporting
        GROUP BY provider_id, route_id, stop_id, area_id, provider_local_date
        """
    )
    op.execute(
        """
        CREATE VIEW gold.current_map_objects AS
        SELECT 'vehicle'::text AS object_type,
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
            0 AS alert_count,
            NULL::text AS stop_name,
            NULL::text AS routes_serving,
            CASE cvm.status_band
                WHEN 'À l''heure / On time'::text THEN 'vehicle_on_time'::text
                WHEN 'En retard / Late'::text THEN 'vehicle_late'::text
                WHEN 'Inconnu / Unknown'::text THEN 'vehicle_unknown'::text
                WHEN 'Critique / Severe'::text THEN 'vehicle_severe'::text
                WHEN 'En avance / Early'::text THEN 'vehicle_early'::text
                ELSE 'vehicle_other'::text
            END AS display_category
        FROM gold.current_vehicle_map_with_status cvm
        UNION ALL
        SELECT 'stop'::text AS object_type,
            s.stop_id AS object_id,
            s.stop_lat AS latitude,
            s.stop_lon AS longitude,
            NULL::text AS status_band,
            NULL::text AS route_id,
            NULL::text AS trip_id,
            s.stop_id,
            NULL::numeric(12,2) AS trip_avg_delay_seconds,
            NULL::integer AS trip_max_delay_seconds,
            cnt.last_captured_at AS captured_at_utc,
            cnt.alert_descriptions AS alert_description,
            COALESCE(cnt.alert_count, 0::bigint)::integer AS alert_count,
            s.stop_name,
            cnt.routes_serving,
            CASE
                WHEN COALESCE(cnt.alert_count, 0::bigint) > 0 THEN 'stop_alert'::text
                ELSE 'stop_normal'::text
            END AS display_category
        FROM gold.dim_stop s
            LEFT JOIN ( SELECT a.provider_id,
                    unnest(string_to_array(a.stop_ids, ', '::text)) AS stop_id,
                    count(*) AS alert_count,
                    string_agg(DISTINCT a.description_text, ' | '::text
                        ORDER BY a.description_text) AS alert_descriptions,
                    string_agg(DISTINCT a.route_ids, ', '::text ORDER BY a.route_ids)
                        FILTER (WHERE a.route_ids IS NOT NULL) AS routes_serving,
                    max(a.captured_at_utc) AS last_captured_at
                FROM gold.current_i3_alerts a
                WHERE a.stop_ids IS NOT NULL
                GROUP BY a.provider_id, (unnest(string_to_array(a.stop_ids, ', '::text)))) cnt
                ON cnt.provider_id = s.provider_id AND cnt.stop_id = s.stop_id
        WHERE s.stop_lat IS NOT NULL AND s.stop_lon IS NOT NULL
        """
    )
