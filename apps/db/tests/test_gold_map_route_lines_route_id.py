from __future__ import annotations

from pathlib import Path

EXPORT = Path("scripts/export_stm_route_lines_geojson.py")


def test_export_selects_and_emits_route_id() -> None:
    src = EXPORT.read_text(encoding="utf-8")
    assert "route_id" in src
    assert '"route_id": row["route_id"]' in src
