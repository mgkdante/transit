"""Export gold.map_route_lines as a single GeoJSON FeatureCollection.

Produces stm-route-lines.geojson (route polylines, each carrying route_id) for
the slice-9 citizen web map (MapLibre), published to Cloudflare R2 as part of the
~30s snapshot set. GTFS shape data updates ~weekly, so regenerate after each STM
GTFS refresh.

Output file:
    data/exports/stm-route-lines.geojson

Geometry is simplified via PostGIS ST_Simplify(0.0001) — about 11m tolerance
on Earth's surface, which removes ~80% of coordinate noise while preserving
the visual shape at every zoom level an operator would use.

Usage:
    set -a && source .env && set +a
    uv run python scripts/export_stm_route_lines_geojson.py
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from sqlalchemy import create_engine, text

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_PATH = REPO_ROOT / "data" / "exports" / "stm-route-lines.geojson"

# 0.0001 degrees ~= 11m. Tight enough that simplified lines look identical
# to raw at city/neighbourhood zoom; permissive enough to drop ~80% of
# redundant vertices.
SIMPLIFY_TOLERANCE_DEG = 0.0001


def main() -> None:
    db_url_raw = os.environ.get("DATABASE_URL")
    if not db_url_raw:
        raise SystemExit(
            "DATABASE_URL not set. Run: set -a && source .env && set +a"
        )
    db_url = db_url_raw.replace("postgresql://", "postgresql+psycopg://")
    engine = create_engine(db_url)

    features: list[dict] = []
    skipped = 0
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT shape_id,
                       route_id,
                       route_pattern_id,
                       ST_AsGeoJSON(
                           ST_Simplify(geom_wgs84, :tolerance)
                       )::jsonb AS simplified
                FROM gold.map_route_lines
                WHERE provider_id = 'stm'
                """
            ),
            {"tolerance": SIMPLIFY_TOLERANCE_DEG},
        ).mappings().all()

    for row in rows:
        try:
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "route_id": row["route_id"] or "",
                        "shape_id": row["shape_id"],
                        "route_pattern_id": row["route_pattern_id"] or "",
                    },
                    "geometry": row["simplified"],
                }
            )
        except Exception as exc:  # noqa: BLE001
            skipped += 1
            print(f"  skip shape_id={row['shape_id']!r}: {exc}")

    fc = {"type": "FeatureCollection", "features": features}
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as fh:
        json.dump(fc, fh, separators=(",", ":"))  # compact, no whitespace

    size_kb = OUTPUT_PATH.stat().st_size / 1024
    print(f"Wrote {len(features):,} features to {OUTPUT_PATH}")
    print(f"Size: {size_kb:.1f} KB  (skipped {skipped})")
    print(f"Simplify tolerance: {SIMPLIFY_TOLERANCE_DEG} degrees (~11m)")


if __name__ == "__main__":
    main()
