"""Add route_id to gold.map_route_lines (sourced from shape_id, not route_pattern).

Revision ID: 0026_map_route_lines_route_id
Revises: 0025_current_map_objects_include_all_stops
Create Date: 2026-05-28

Why this migration exists:
    slice-8.7.2.routes publishes STM route-lines to ArcGIS Location Platform and
    binds them on the p01 hero map via an ArcGIS Join Layer:
        GeoJSON.route_id  <->  CurrentMapObjects.route_id
    But gold.map_route_lines had no route_id. Its only route-ish column,
    route_pattern_id, is NULL for all 781 STM lines because STM does not publish
    route_patterns.txt until the ~June-15 GTFS update (schema is pre-wired; the
    data isn't there yet). So the intended route_pattern_id -> dim_route_pattern
    bridge is dead today.

    silver.trips already maps shape_id -> route_id, and that mapping is clean:
    all 781 distinct shapes in gold.map_route_lines resolve to exactly one route
    (0 multi-route, 0 unmatched). So route_id is sourced from shape_id via trips.

What this migration does:
    CREATE OR REPLACE VIEW gold.map_route_lines, appending a route_id column at
    the END of the existing column list (Postgres CREATE OR REPLACE can only add
    columns at the end). route_id is joined from a per-shape pre-aggregation of
    silver.trips so the join cannot multiply silver.shapes point rows and corrupt
    ST_MakeLine. Keyed on (provider_id, dataset_version_id, shape_id) so it stays
    correct across dataset versions. route_pattern_id is preserved unchanged (it
    will populate on its own once STM ships route_patterns.txt).

Downgrade:
    Restores the migration-0013 view shape (no route_id). Because CREATE OR
    REPLACE cannot drop a column, downgrade drops then recreates the view.
"""

from __future__ import annotations

from alembic import op

revision = "0026_map_route_lines_route_id"
down_revision = "0025_current_map_objects_include_all_stops"
branch_labels = None
depends_on = None


# New view: original columns in original order + route_id appended at the end.
_CREATE_VIEW = """
CREATE OR REPLACE VIEW gold.map_route_lines AS
SELECT
    sh.provider_id,
    sh.dataset_version_id,
    sh.shape_id,
    max(sh.route_pattern_id) AS route_pattern_id,
    ST_MakeLine(
        ST_SetSRID(ST_MakePoint(sh.shape_pt_lon, sh.shape_pt_lat), 4326)
        ORDER BY sh.shape_pt_sequence
    ) AS geom_wgs84,
    ST_AsGeoJSON(
        ST_MakeLine(
            ST_SetSRID(ST_MakePoint(sh.shape_pt_lon, sh.shape_pt_lat), 4326)
            ORDER BY sh.shape_pt_sequence
        )
    )::jsonb AS geojson,
    max(sr.route_id) AS route_id
FROM silver.shapes AS sh
LEFT JOIN (
    SELECT provider_id, dataset_version_id, shape_id, min(route_id) AS route_id
    FROM silver.trips
    WHERE shape_id IS NOT NULL
    GROUP BY provider_id, dataset_version_id, shape_id
) AS sr
    ON sr.provider_id = sh.provider_id
   AND sr.dataset_version_id = sh.dataset_version_id
   AND sr.shape_id = sh.shape_id
WHERE sh.shape_pt_lat BETWEEN -90 AND 90
  AND sh.shape_pt_lon BETWEEN -180 AND 180
GROUP BY sh.provider_id, sh.dataset_version_id, sh.shape_id
"""


# Migration 0013 view body, restored verbatim on downgrade (no route_id).
_CREATE_VIEW_FROM_0013 = """
CREATE OR REPLACE VIEW gold.map_route_lines AS
SELECT
    sh.provider_id,
    sh.dataset_version_id,
    sh.shape_id,
    max(sh.route_pattern_id) AS route_pattern_id,
    ST_MakeLine(
        ST_SetSRID(ST_MakePoint(sh.shape_pt_lon, sh.shape_pt_lat), 4326)
        ORDER BY sh.shape_pt_sequence
    ) AS geom_wgs84,
    ST_AsGeoJSON(
        ST_MakeLine(
            ST_SetSRID(ST_MakePoint(sh.shape_pt_lon, sh.shape_pt_lat), 4326)
            ORDER BY sh.shape_pt_sequence
        )
    )::jsonb AS geojson
FROM silver.shapes AS sh
WHERE sh.shape_pt_lat BETWEEN -90 AND 90
  AND sh.shape_pt_lon BETWEEN -180 AND 180
GROUP BY sh.provider_id, sh.dataset_version_id, sh.shape_id
"""


_DROP_VIEW = """
DROP VIEW IF EXISTS gold.map_route_lines
"""


def upgrade() -> None:
    # Additive (route_id appended at end) -> CREATE OR REPLACE is sufficient.
    op.execute(_CREATE_VIEW)


def downgrade() -> None:
    # Removing a column requires drop + recreate.
    op.execute(_DROP_VIEW)
    op.execute(_CREATE_VIEW_FROM_0013)
