from __future__ import annotations

import importlib.util
import re
from pathlib import Path

MIGRATION_PATH = Path(
    "src/transit_ops/db/migrations/versions/0012_source_ledger_gis_rt_abundance.py"
)


def _migration_text() -> str:
    return MIGRATION_PATH.read_text(encoding="utf-8")


def _table_block(migration: str, table_name: str) -> str:
    start_marker = f'op.create_table(\n        "{table_name}",'
    start = migration.index(start_marker)
    end = migration.index("\n    op.create_index(", start)
    return migration[start:end]


def _assert_table_has_columns(block: str, columns: list[str]) -> None:
    for column in columns:
        assert re.search(rf'sa\.Column\(\s*"{column}"', block)


def _load_migration() -> object:
    spec = importlib.util.spec_from_file_location("migration_0012", MIGRATION_PATH)
    assert spec is not None
    assert spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_slice_8_4_migration_defines_source_tables_without_postgis() -> None:
    migration = _migration_text()
    for expected in [
        "gis_static",
        "stm_gis_zip",
        "first_seen_at_utc",
        "last_seen_at_utc",
        "manifest_json",
        "rt_feed_snapshots",
        "rt_trip_update_stop_times",
        "gis_stop_features",
        "gis_line_features",
        "gis_gtfs_matches",
        "source_geometry_wkb",
        "sa.LargeBinary",
    ]:
        assert expected in migration
    lowered = migration.lower()
    assert "create extension" not in lowered
    assert "postgis" not in lowered
    assert "geometry(" not in lowered
    assert "geography(" not in lowered


def test_slice_8_4_migration_revision_chain_is_correct() -> None:
    migration = _load_migration()

    assert migration.revision == "0012_source_ledger_gis_rt_abundance"
    assert migration.down_revision == "0011_beta_gold_contracts"


def test_slice_8_4_migration_represents_old_and_new_constraint_values() -> None:
    migration = _migration_text()

    for constraint_name in [
        "ck_feed_endpoints_feed_kind",
        "ck_feed_endpoints_source_format",
        "ck_ingestion_runs_run_kind",
        "ck_dataset_versions_dataset_kind",
    ]:
        assert constraint_name in migration

    for new_value in [
        "static_schedule",
        "gis_static",
        "trip_updates",
        "vehicle_positions",
        "gtfs_schedule_zip",
        "stm_gis_zip",
        "gtfs_rt_trip_updates",
        "gtfs_rt_vehicle_positions",
    ]:
        assert new_value in migration

    loaded_migration = _load_migration()
    assert loaded_migration.NEW_FEED_KIND_VALUES == (
        "static_schedule",
        "gis_static",
        "trip_updates",
        "vehicle_positions",
    )
    assert loaded_migration.NEW_SOURCE_FORMAT_VALUES == (
        "gtfs_schedule_zip",
        "stm_gis_zip",
        "gtfs_rt_trip_updates",
        "gtfs_rt_vehicle_positions",
    )
    assert loaded_migration.NEW_RUN_KIND_VALUES == loaded_migration.NEW_FEED_KIND_VALUES
    assert loaded_migration.NEW_DATASET_KIND_VALUES == ("static_schedule", "gis_static")
    assert loaded_migration.OLD_FEED_KIND_CONSTRAINT == (
        "feed_kind IN ('static_schedule', 'trip_updates', 'vehicle_positions')"
    )
    assert loaded_migration.OLD_SOURCE_FORMAT_CONSTRAINT == (
        "source_format IN "
        "('gtfs_schedule_zip', 'gtfs_rt_trip_updates', 'gtfs_rt_vehicle_positions')"
    )
    assert loaded_migration.OLD_RUN_KIND_CONSTRAINT == (
        "run_kind IN ('static_schedule', 'trip_updates', 'vehicle_positions')"
    )
    assert loaded_migration.OLD_DATASET_KIND_CONSTRAINT == "dataset_kind = 'static_schedule'"


def test_slice_8_4_migration_defines_rt_source_contract_columns() -> None:
    migration = _migration_text()
    expected_columns_by_table = {
        "rt_feed_snapshots": [
            "rt_feed_snapshot_id",
            "provider_id",
            "feed_endpoint_id",
            "ingestion_run_id",
            "ingestion_object_id",
            "endpoint_key",
            "gtfs_realtime_version",
            "incrementality",
            "feed_timestamp_utc",
            "captured_at_utc",
            "loaded_at_utc",
            "source_url",
            "storage_backend",
            "storage_path",
            "checksum_sha256",
            "byte_size",
            "parser_version",
            "manifest_json",
        ],
        "rt_entities": [
            "rt_feed_snapshot_id",
            "entity_index",
            "provider_id",
            "entity_id",
            "entity_kind",
            "is_deleted",
            "raw_entity_json",
        ],
        "rt_trip_updates": [
            "rt_feed_snapshot_id",
            "entity_index",
            "provider_id",
            "trip_id",
            "route_id",
            "direction_id",
            "start_date",
            "schedule_relationship",
            "trip_update_timestamp_utc",
            "feed_timestamp_utc",
            "captured_at_utc",
        ],
        "rt_trip_update_stop_times": [
            "rt_feed_snapshot_id",
            "entity_index",
            "stop_time_update_index",
            "provider_id",
            "stop_sequence",
            "stop_id",
            "arrival_time_utc",
            "departure_time_utc",
            "schedule_relationship",
        ],
        "rt_vehicle_positions": [
            "rt_feed_snapshot_id",
            "entity_index",
            "provider_id",
            "vehicle_id",
            "trip_id",
            "route_id",
            "direction_id",
            "start_time",
            "start_date",
            "latitude",
            "longitude",
            "bearing",
            "speed",
            "stop_id",
            "current_stop_sequence",
            "current_status",
            "occupancy_status",
            "congestion_level",
            "vehicle_timestamp_utc",
            "position_quality",
            "feed_timestamp_utc",
            "captured_at_utc",
        ],
    }

    for table_name, columns in expected_columns_by_table.items():
        _assert_table_has_columns(_table_block(migration, table_name), columns)


def test_slice_8_4_migration_defines_gis_source_contract_columns() -> None:
    migration = _migration_text()
    expected_columns_by_table = {
        "gis_datasets": [
            "dataset_version_id",
            "provider_id",
            "source_url",
            "storage_backend",
            "storage_path",
            "checksum_sha256",
            "byte_size",
            "source_crs_name",
            "source_crs_epsg",
            "source_crs_wkt",
            "parser_version",
            "manifest_json",
            "parsed_at_utc",
        ],
        "gis_stop_features": [
            "dataset_version_id",
            "provider_id",
            "source_feature_id",
            "stop_code",
            "stop_id",
            "stop_name",
            "stop_url",
            "wheelchair",
            "route_id",
            "loc_type",
            "shelter",
            "service_id",
            "source_attributes_json",
            "source_geometry_wkb",
            "source_geometry_type",
            "source_crs_name",
            "source_crs_epsg",
            "source_crs_wkt",
            "parsed_at_utc",
        ],
        "gis_line_features": [
            "dataset_version_id",
            "provider_id",
            "source_feature_id",
            "route_id",
            "route_name",
            "headsign",
            "shape_id",
            "ct",
            "service_id",
            "source_attributes_json",
            "source_geometry_wkb",
            "source_geometry_type",
            "source_crs_name",
            "source_crs_epsg",
            "source_crs_wkt",
            "parsed_at_utc",
        ],
        "gis_gtfs_matches": [
            "gis_dataset_version_id",
            "static_dataset_version_id",
            "provider_id",
            "feature_kind",
            "source_feature_id",
            "gtfs_id",
            "match_key",
            "match_status",
            "match_notes",
            "matched_at_utc",
        ],
    }

    for table_name, columns in expected_columns_by_table.items():
        _assert_table_has_columns(_table_block(migration, table_name), columns)


def test_slice_8_4_migration_preserves_sparse_static_trip_notes() -> None:
    migration = _migration_text()

    for column in ["note_fr", "note_en"]:
        assert re.search(
            rf'op\.add_column\(\s*"trips",\s*sa\.Column\("{column}"',
            migration,
            re.DOTALL,
        )
        assert f'op.drop_column("trips", "{column}", schema="silver")' in migration


def test_static_abundance_tables_cascade_with_dataset_versions() -> None:
    migration = _migration_text()

    for table_name in ["gtfs_source_members", "gtfs_extra_rows"]:
        table_block = _table_block(migration, table_name)
        assert '["core.dataset_versions.dataset_version_id"]' in table_block
        assert 'ondelete="CASCADE"' in table_block


def test_slice_8_4_migration_does_not_add_delay_columns_to_rt_source_tables() -> None:
    migration = _migration_text()
    rt_blocks = "\n".join(
        _table_block(migration, table_name)
        for table_name in [
            "rt_feed_snapshots",
            "rt_entities",
            "rt_trip_updates",
            "rt_trip_update_stop_times",
            "rt_vehicle_positions",
        ]
    )

    assert "arrival_delay_seconds" not in rt_blocks
    assert "departure_delay_seconds" not in rt_blocks
    assert 'sa.Column("delay_seconds"' not in rt_blocks


def test_slice_8_4_downgrade_preflights_new_contract_rows_before_dropping_tables() -> None:
    migration = _migration_text()

    assert "def _guard_downgrade_has_no_8_4_contract_rows" in migration

    guard_start = migration.index("def _guard_downgrade_has_no_8_4_contract_rows")
    guard_end = migration.index("\n\ndef upgrade()", guard_start)
    guard_block = migration[guard_start:guard_end]

    for expected in [
        "core.feed_endpoints",
        "raw.ingestion_runs",
        "core.dataset_versions",
        "gis_static",
        "stm_gis_zip",
        "Cannot downgrade 0012_source_ledger_gis_rt_abundance",
    ]:
        assert expected in guard_block

    downgrade_block = migration[migration.index("def downgrade()") :]
    assert downgrade_block.index("_guard_downgrade_has_no_8_4_contract_rows()") < (
        downgrade_block.index("op.drop_index(")
    )
