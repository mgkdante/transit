"""Contract: slice-8.7.2.routes adds route_id to gold.map_route_lines + export.

Why: the ArcGIS Join Layer on the p01 hero map binds
    GeoJSON.route_id <-> CurrentMapObjects.route_id
but gold.map_route_lines had no route_id, and route_pattern_id is NULL until
STM ships route_patterns.txt (~June 15). route_id is therefore sourced from
shape_id -> silver.trips (verified 1:1 for all 781 STM shapes). Both the Gold
view (migration 0026) and the GeoJSON export must expose route_id.
"""
from __future__ import annotations

from pathlib import Path

MIGRATION = Path(
    "src/transit_ops/db/migrations/versions/0026_map_route_lines_route_id.py"
)
EXPORT = Path("scripts/export_stm_route_lines_geojson.py")


def test_migration_0026_exists_and_chains_from_head() -> None:
    src = MIGRATION.read_text(encoding="utf-8")
    assert 'revision = "0026_map_route_lines_route_id"' in src
    assert 'down_revision = "0025_current_map_objects_include_all_stops"' in src


def test_migration_adds_route_id_sourced_from_trips() -> None:
    src = MIGRATION.read_text(encoding="utf-8")
    assert "CREATE OR REPLACE VIEW gold.map_route_lines" in src
    assert "route_id" in src
    # route_id must come from trips (shape_id -> route_id), NOT route_pattern_id,
    # which is empty until STM ships route_patterns.txt.
    assert "silver.trips" in src
    # downgrade must restore the column-less view via drop+recreate.
    assert "DROP VIEW IF EXISTS gold.map_route_lines" in src


def test_export_selects_and_emits_route_id() -> None:
    src = EXPORT.read_text(encoding="utf-8")
    # selected from the Gold view...
    assert "route_id" in src
    # ...and surfaced as a GeoJSON feature property (the Join Layer key).
    assert '"route_id": row["route_id"]' in src
