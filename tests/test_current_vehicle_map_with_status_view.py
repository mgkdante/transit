"""Static contract test for migration 0020: gold.current_vehicle_map_with_status view."""
from __future__ import annotations

import re
from pathlib import Path

MIGRATION = Path(
    "src/transit_ops/db/migrations/versions/0020_current_vehicle_map_with_status_view.py"
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

    assert 'revision = "0020_current_vehicle_map_with_status_view"' in text
    assert 'down_revision = "0019_trip_delay_summary_5m_live_view"' in text


def test_upgrade_creates_view_at_expected_name() -> None:
    sql = _sql_block("_CREATE_VIEW")

    assert "CREATE OR REPLACE VIEW gold.current_vehicle_map_with_status" in sql


def test_view_left_joins_vehicle_map_with_trip_delay() -> None:
    """LEFT JOIN so vehicles without delay data still show on the map
    (with status_band = 'Inconnu')."""
    sql = _sql_block("_CREATE_VIEW")

    assert "FROM gold.current_vehicle_map AS cvm" in sql
    assert "LEFT JOIN gold.current_trip_delay_computed AS ctc" in sql
    assert "ctc.provider_id = cvm.provider_id" in sql
    assert "ctc.trip_id     = cvm.trip_id" in sql


def test_view_emits_all_five_status_bands() -> None:
    """The categorical column the map's Legend role binds to. Must include
    the 'Inconnu' / 'Unknown' fallback so vehicles without delay data don't
    silently drop off the map."""
    sql = _sql_block("_CREATE_VIEW")

    for band in (
        "'Inconnu / Unknown'",
        "'En avance / Early'",
        "'À l''heure / On time'",
        "'En retard / Late'",
        "'Critique / Severe'",
    ):
        assert band in sql, f"missing status band: {band}"


def test_view_status_thresholds_match_operator_buckets() -> None:
    """Thresholds: <-60s early, -60..60s on-time, 60..300s late, ≥300s severe.
    Matches what an operator considers operationally meaningful."""
    sql = _sql_block("_CREATE_VIEW")

    assert "ctc.avg_delay_seconds IS NULL" in sql
    assert "ctc.avg_delay_seconds < -60" in sql
    assert "ctc.avg_delay_seconds <  60" in sql
    assert "ctc.avg_delay_seconds < 300" in sql


def test_view_preserves_original_vehicle_map_columns() -> None:
    """Drop-in replacement for gold.current_vehicle_map — all original
    columns must still be present so existing Power BI bindings keep working."""
    sql = _sql_block("_CREATE_VIEW")

    for col in (
        "cvm.provider_id",
        "cvm.vehicle_id",
        "cvm.trip_id",
        "cvm.route_id",
        "cvm.stop_id",
        "cvm.captured_at_utc",
        "cvm.latitude",
        "cvm.longitude",
        "cvm.geom_wgs84",
        "cvm.geojson",
    ):
        assert col in sql, f"missing original column: {col}"


def test_view_adds_delay_passthrough_columns() -> None:
    """trip_avg_delay_seconds + trip_max_delay_seconds added as Tooltip
    fields so hover shows the exact delay number, not just the band."""
    sql = _sql_block("_CREATE_VIEW")

    assert "ctc.avg_delay_seconds AS trip_avg_delay_seconds" in sql
    assert "ctc.max_delay_seconds AS trip_max_delay_seconds" in sql


def test_downgrade_drops_view() -> None:
    text = _read()
    sql = _sql_block("_DROP_VIEW")

    assert "DROP VIEW IF EXISTS gold.current_vehicle_map_with_status" in sql
    assert "def downgrade()" in text
    assert "op.execute(_DROP_VIEW)" in text
