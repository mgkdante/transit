"""Contract: gold.map_route_lines carries route_id, and the export emits it.

route_pattern_id is NULL until STM ships route_patterns.txt (~June 15), so
route_id is sourced from shape_id -> silver.trips (verified 1:1 for all 781 STM
shapes) by migration 0026. route_id feeds the slice-9 citizen web map (per-route
styling / cross-filter), and the GeoJSON export must expose it.
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
    assert "DROP VIEW IF EXISTS gold.map_route_lines" in src


def test_export_selects_and_emits_route_id() -> None:
    src = EXPORT.read_text(encoding="utf-8")
    assert "route_id" in src
    assert '"route_id": row["route_id"]' in src
