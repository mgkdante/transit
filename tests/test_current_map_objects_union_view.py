"""Static contract test for migration 0023: gold.current_map_objects UNION view.

slice-8.7.2 Phase 2 — single map data source via UNION ALL of vehicles +
alert-stops. The hero azureMap visual rebinds to this view so an operator
can click an alert-stop dot and cross-filter the alerts table to that
stop's alerts. Same azureMap canonical PBIR shape (Y/X projections,
Legend + Series, dataPoint selectors).
"""
from __future__ import annotations

import re
from pathlib import Path

MIGRATION = Path(
    "src/transit_ops/db/migrations/versions/0023_current_map_objects_union_view.py"
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

    assert 'revision = "0023_current_map_objects_union_view"' in text
    assert 'down_revision = "0022_gold_current_i3_alerts_scd2_aggregated"' in text


def test_upgrade_creates_view_at_expected_name() -> None:
    sql = _sql_block("_CREATE_VIEW")

    assert "CREATE OR REPLACE VIEW gold.current_map_objects" in sql


def test_view_is_union_all_of_two_legs() -> None:
    """UNION ALL — keep duplicates if any; vehicles and alert-stops are
    distinct domains so duplicates can't happen anyway, but UNION (deduped)
    would force an unnecessary sort/hash. ALL stays cheap."""
    sql = _sql_block("_CREATE_VIEW")

    assert "UNION ALL" in sql
    assert "UNION\n" not in sql.replace("UNION ALL", "")  # no plain UNION


def test_vehicles_leg_pulls_from_current_vehicle_map_with_status() -> None:
    """Vehicles leg reuses the slice-8.7.2 round 2 view (with status_band)
    so color-by-delay still works on the UNION."""
    sql = _sql_block("_CREATE_VIEW")

    assert "FROM gold.current_vehicle_map_with_status" in sql


def test_alert_stops_leg_joins_alerts_with_dim_stop_on_exploded_stop_ids() -> None:
    """Each alert has stop_ids as a comma-separated string (post-0022
    aggregation). Explode via string_to_array + ANY to get one row per
    (alert, affected stop) pair joined to dim_stop for lat/lon."""
    sql = _sql_block("_CREATE_VIEW")

    assert "FROM gold.current_i3_alerts" in sql
    assert "JOIN gold.dim_stop" in sql
    assert "string_to_array(a.stop_ids, ', ')" in sql
    assert "= ANY(string_to_array(a.stop_ids, ', '))" in sql


def test_alert_stops_leg_skips_alerts_without_stops() -> None:
    """An alert may have only route_ids (route-level notice with no stop
    impact). Such rows can't be plotted on a map; filter them out."""
    sql = _sql_block("_CREATE_VIEW")

    assert "WHERE a.stop_ids IS NOT NULL" in sql


def test_view_emits_object_type_discriminator() -> None:
    """The categorical column the map's Series role binds to so vehicle
    dots vs alert-pin dots get different glyph treatments."""
    sql = _sql_block("_CREATE_VIEW")

    assert "'vehicle'::text AS object_type" in sql
    assert "'alerte'::text AS object_type" in sql


def test_alert_stops_use_dedicated_alerte_status_band() -> None:
    """Map's Legend role colors by status_band. Alert-stops get a new 6th
    band ('Alerte') distinct from the 5 vehicle bands so dataPoint selectors
    can pin them to a bright red distinguishable from 'Critique / Severe'."""
    sql = _sql_block("_CREATE_VIEW")

    assert "'Alerte'::text AS status_band" in sql


def test_view_carries_alert_description_for_tooltips() -> None:
    """Alert-stop dots need their alert description in the Tooltip role so
    hovering shows what the operator should know."""
    sql = _sql_block("_CREATE_VIEW")

    assert "a.description_text AS alert_description" in sql
    # Vehicles leg: NULL passthrough (no alert associated)
    assert "NULL::text AS alert_description" in sql


def test_vehicles_leg_preserves_delay_passthrough_columns() -> None:
    """trip_avg_delay_seconds + trip_max_delay_seconds still flow through
    from the vehicles leg so existing Tooltip / DAX bindings on the map
    visual keep working after the rebind."""
    sql = _sql_block("_CREATE_VIEW")

    assert "cvm.trip_avg_delay_seconds" in sql
    assert "cvm.trip_max_delay_seconds" in sql


def test_alert_stops_leg_nulls_delay_and_trip_columns() -> None:
    """Alert-stops have no delay / trip / route association in this view.
    Explicit NULL casts ensure both legs of the UNION agree on column
    types: numeric(12,2) for avg, integer for max, text for trip/route."""
    sql = _sql_block("_CREATE_VIEW")

    assert "NULL::text AS route_id" in sql
    assert "NULL::text AS trip_id" in sql
    assert "NULL::numeric" in sql and "AS trip_avg_delay_seconds" in sql
    assert "NULL::integer AS trip_max_delay_seconds" in sql


def test_view_uses_object_id_unified_key() -> None:
    """object_id = vehicle_id for vehicles, stop_id for alert-stops. Single
    column the map visual can key on for cross-filter selection."""
    sql = _sql_block("_CREATE_VIEW")

    assert "cvm.vehicle_id AS object_id" in sql
    assert "s.stop_id AS object_id" in sql


def test_downgrade_drops_view() -> None:
    text = _read()
    sql = _sql_block("_DROP_VIEW")

    assert "DROP VIEW IF EXISTS gold.current_map_objects" in sql
    assert "def downgrade()" in text
    assert "op.execute(_DROP_VIEW)" in text
