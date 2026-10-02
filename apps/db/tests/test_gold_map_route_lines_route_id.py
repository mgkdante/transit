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
    assert "silver.trips" in src
    assert "DROP VIEW IF EXISTS gold.map_route_lines" in src


def test_export_selects_and_emits_route_id() -> None:
    src = EXPORT.read_text(encoding="utf-8")
    assert "route_id" in src
    assert '"route_id": row["route_id"]' in src
