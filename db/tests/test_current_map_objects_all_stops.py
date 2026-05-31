"""Contract test for migration 0025: current_map_objects expanded with all stops.

slice-8.7.2 Phase 2 — citizen-analyst UX expansion. The hero map should
follow transit-app conventions: buses (circles), all stops (small white
triangles), alert stops (red triangles), route lines (separate layer).
"""
from __future__ import annotations

import re
from pathlib import Path

MIGRATION = Path(
    "src/transit_ops/db/migrations/versions/0025_current_map_objects_include_all_stops.py"
)


def _read() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def _sql_block(constant_name: str) -> str:
    text = _read()
    match = re.search(
        rf'^{re.escape(constant_name)} = """(?P<sql>.*?)"""',
        text,
        flags=re.DOTALL | re.MULTILINE,
    )
    assert match is not None, f"could not find SQL constant {constant_name}"
    return match.group("sql")


def test_migration_revision_metadata() -> None:
    text = _read()

    assert 'revision = "0025_current_map_objects_include_all_stops"' in text
    assert 'down_revision = "0024_gold_current_i3_alerts_synthesized_dedup"' in text


def test_view_unions_vehicles_with_all_stops() -> None:
    """Two-leg UNION ALL: vehicles + all stops (not just alert ones).
    Citizen-analyst UX requires all stops visible so citizens can see the
    full network even when no disruptions affect a given route."""
    sql = _sql_block("_CREATE_VIEW")

    assert "UNION ALL" in sql
    assert "FROM gold.current_vehicle_map_with_status" in sql
    assert "FROM gold.dim_stop" in sql


def test_stops_leg_left_joins_alert_counts() -> None:
    """Each stop carries alert_count + concatenated alert_descriptions
    + routes_serving (computed from alerts that touch the stop). LEFT
    JOIN so quiet stops still appear with alert_count=0."""
    sql = _sql_block("_CREATE_VIEW")

    assert "LEFT JOIN" in sql
    assert "alert_count" in sql
    assert "string_agg" in sql
    assert "unnest(string_to_array(a.stop_ids, ', '))" in sql


def test_view_emits_display_category_for_arcgis_symbology() -> None:
    """display_category is the categorical field ArcGIS Symbology binds
    Color to so each gets its own shape+color. 5 vehicle bands +
    stop_normal + stop_alert = 7 categories."""
    sql = _sql_block("_CREATE_VIEW")

    assert "display_category" in sql
    # All 7 expected categories
    for cat in (
        "'vehicle_on_time'",
        "'vehicle_late'",
        "'vehicle_unknown'",
        "'vehicle_severe'",
        "'vehicle_early'",
        "'stop_normal'",
        "'stop_alert'",
    ):
        assert cat in sql, f"missing category: {cat}"


def test_view_filters_stops_without_coordinates() -> None:
    """A stop with NULL lat/lon can't render on the map. Skip them at
    the view level to avoid ArcGIS warnings and reduce row count."""
    sql = _sql_block("_CREATE_VIEW")

    assert "stop_lat IS NOT NULL" in sql
    assert "stop_lon IS NOT NULL" in sql


def test_stops_carry_name_and_routes_serving() -> None:
    """Tooltip on a stop dot should show: stop_name + routes_serving.
    Without these the citizen can't tell what stop they're hovering."""
    sql = _sql_block("_CREATE_VIEW")

    assert "s.stop_name AS stop_name" in sql
    assert "routes_serving" in sql


def test_vehicles_leg_carries_object_type_vehicle() -> None:
    sql = _sql_block("_CREATE_VIEW")

    assert "'vehicle'::text AS object_type" in sql


def test_stops_leg_carries_object_type_stop() -> None:
    """object_type='stop' for both alert and non-alert stops.
    display_category distinguishes alert vs normal."""
    sql = _sql_block("_CREATE_VIEW")

    assert "'stop'::text AS object_type" in sql


def test_downgrade_restores_post_0023_shape() -> None:
    """Downgrade restores the migration-0023 view (vehicles + alert-stops
    only, no all-stops UNION)."""
    text = _read()
    drop_sql = _sql_block("_DROP_VIEW")

    assert "DROP VIEW IF EXISTS gold.current_map_objects" in drop_sql
    assert "def downgrade()" in text
    assert "_CREATE_VIEW_FROM_0023" in text
