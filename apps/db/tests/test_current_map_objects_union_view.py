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
    sql = _sql_block("_CREATE_VIEW")

    assert "UNION ALL" in sql
    assert "UNION\n" not in sql.replace("UNION ALL", "")


def test_vehicles_leg_pulls_from_current_vehicle_map_with_status() -> None:
    sql = _sql_block("_CREATE_VIEW")

    assert "FROM gold.current_vehicle_map_with_status" in sql


def test_alert_stops_leg_joins_alerts_with_dim_stop_on_exploded_stop_ids() -> None:
    sql = _sql_block("_CREATE_VIEW")

    assert "FROM gold.current_i3_alerts" in sql
    assert "JOIN gold.dim_stop" in sql
    assert "string_to_array(a.stop_ids, ', ')" in sql
    assert "= ANY(string_to_array(a.stop_ids, ', '))" in sql


def test_alert_stops_leg_skips_alerts_without_stops() -> None:
    sql = _sql_block("_CREATE_VIEW")

    assert "WHERE a.stop_ids IS NOT NULL" in sql


def test_view_emits_object_type_discriminator() -> None:
    sql = _sql_block("_CREATE_VIEW")

    assert "'vehicle'::text AS object_type" in sql
    assert "'alerte'::text AS object_type" in sql


def test_alert_stops_use_dedicated_alerte_status_band() -> None:
    sql = _sql_block("_CREATE_VIEW")

    assert "'Alerte'::text AS status_band" in sql


def test_view_carries_alert_description_for_tooltips() -> None:
    sql = _sql_block("_CREATE_VIEW")

    assert "a.description_text AS alert_description" in sql
    assert "NULL::text AS alert_description" in sql


def test_vehicles_leg_preserves_delay_passthrough_columns() -> None:
    sql = _sql_block("_CREATE_VIEW")

    assert "cvm.trip_avg_delay_seconds" in sql
    assert "cvm.trip_max_delay_seconds" in sql


def test_alert_stops_leg_nulls_delay_and_trip_columns() -> None:
    sql = _sql_block("_CREATE_VIEW")

    assert "NULL::text AS route_id" in sql
    assert "NULL::text AS trip_id" in sql
    assert "NULL::numeric" in sql and "AS trip_avg_delay_seconds" in sql
    assert "NULL::integer AS trip_max_delay_seconds" in sql


def test_view_uses_object_id_unified_key() -> None:
    sql = _sql_block("_CREATE_VIEW")

    assert "cvm.vehicle_id AS object_id" in sql
    assert "s.stop_id AS object_id" in sql


def test_downgrade_drops_view() -> None:
    text = _read()
    sql = _sql_block("_DROP_VIEW")

    assert "DROP VIEW IF EXISTS gold.current_map_objects" in sql
    assert "def downgrade()" in text
    assert "op.execute(_DROP_VIEW)" in text
