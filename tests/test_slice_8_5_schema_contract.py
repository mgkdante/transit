from __future__ import annotations

import importlib.util
import re
from pathlib import Path

MIGRATION_PATH = Path("src/transit_ops/db/migrations/versions/0013_gold_ops_brain_contract.py")


def _migration_text() -> str:
    return MIGRATION_PATH.read_text(encoding="utf-8")


def _load_migration() -> object:
    spec = importlib.util.spec_from_file_location("migration_0013", MIGRATION_PATH)
    assert spec is not None
    assert spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_slice_8_5_migration_revision_chain_and_contract_values() -> None:
    migration = _load_migration()

    assert migration.revision == "0013_gold_ops_brain_contract"
    assert migration.down_revision == "0012_source_ledger_gis_rt_abundance"
    assert "i3_alerts" in migration.NEW_FEED_KIND_VALUES
    assert "api_i3_json" in migration.NEW_SOURCE_FORMAT_VALUES
    assert "i3_alerts" in migration.NEW_RUN_KIND_VALUES


def test_slice_8_5_postgis_is_gold_serving_only() -> None:
    migration = _migration_text()

    assert "CREATE EXTENSION IF NOT EXISTS postgis" in migration
    assert "ST_AsGeoJSON" in migration
    assert "ST_Transform" in migration
    assert "gold.map_stops" in migration
    assert "gold.map_route_lines" in migration
    assert "gold.current_vehicle_map" in migration
    assert not re.search(
        r'op\.add_column\(\s*"[^"]+",\s*sa\.Column\("[^"]+",\s*Geometry',
        migration,
    )
    assert "source_geometry_wkb" in migration


def test_slice_8_5_delay_views_compute_from_gtfs_rt_predictions_and_static_stop_times() -> None:
    migration = _migration_text()

    assert "gold.fact_stop_time_delay_observation" in migration
    assert "gold.current_trip_delay_computed" in migration
    assert "silver.rt_trip_update_stop_times" in migration
    assert "silver.stop_times" in migration
    assert "arrival_time_utc - scheduled_arrival_utc" in migration
    assert "departure_time_utc - scheduled_departure_utc" in migration
    assert "AT TIME ZONE dp.timezone" in migration
    assert "trip_update.delay" not in migration
    assert "tu.delay_seconds" not in migration


def test_slice_8_5_i3_contract_has_raw_silver_and_gold_surfaces() -> None:
    migration = _migration_text()

    for expected in [
        "raw.i3_alert_snapshots",
        "silver.i3_alerts",
        "silver.i3_alert_informed_entities",
        "gold.current_i3_alerts",
        "gold.i3_alert_history_reporting",
        "raw_payload_json",
        "alert_header_text",
        "route_id",
        "stop_id",
        "area_id",
    ]:
        assert expected in migration


def test_slice_8_5_reporting_surfaces_cover_public_accountability_and_health() -> None:
    migration = _migration_text()

    for expected in [
        "gold.public_route_reliability_daily",
        "gold.public_stop_delay_daily",
        "gold.public_alert_impact_daily",
        "gold.feed_freshness_current",
        "gold.source_lineage_reporting",
        "provider_local_date",
        "hour_bucket_local",
        "week_bucket_local",
        "month_bucket_local",
        "rolling_year_bucket_local",
    ]:
        assert expected in migration
