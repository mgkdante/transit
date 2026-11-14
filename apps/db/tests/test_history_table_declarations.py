from dataclasses import replace
from datetime import UTC, date, datetime
from unittest.mock import Mock

import pytest

from transit_ops.history import datasets as d
from transit_ops.history.close_runs import close_unfinished_runs
from transit_ops.history.daily_selection import capture_providers
from transit_ops.maintenance.gold import GOLD_AGGREGATE_RETENTION_COLUMNS


def test_retained_edition_summaries_need_no_prunable_edition_metadata():
    dataset = d.get_dataset("gold.schedule_version_service_summary")
    assert dataset.archive_grain == "month"
    assert dataset.source == d.TableSource(
        "gold.schedule_version_service_summary",
        None,
        ("provider_id", "dataset_version_id", "route_id", "day_type"),
        None,
        0,
    )
    assert d.window_start(dataset, "2026-11") == date(2026, 11, 1)


@pytest.mark.parametrize("name", ["gold.route_delay_spine", "capture.trip_updates"])
def test_declaration_assembly_refuses_reclassification_and_capture_collisions(name):
    original = d.get_dataset(name)
    replacement = replace(
        original,
        source=d.TableSource(
            "gold.route_delay_spine", "dataset_version_id", ("provider_id",), None, 0
        ),
        archive_grain="edition",
    )
    with pytest.raises(d.InvalidDeclaration, match=name):
        d.declare_datasets([original, replacement])


@pytest.mark.parametrize("table,column,_local_date", GOLD_AGGREGATE_RETENTION_COLUMNS)
def test_rollup_archive_windows_match_the_retention_owner(table, column, _local_date):
    dataset = d.get_dataset(table)
    assert dataset.archive_grain == "month"
    assert dataset.source.window_column == column


@pytest.mark.parametrize(
    "name,grain,window,keys",
    [
        (
            "gold.route_delay_spine",
            "month",
            "provider_local_date",
            ("provider_id", "route_id", "provider_local_date", "hour_of_day_local", "direction_id"),
        ),
        (
            "silver.stop_times",
            "edition",
            "dataset_version_id",
            ("dataset_version_id", "trip_id", "stop_sequence"),
        ),
        ("core.pipeline_switches", "month", None, ("switch_key",)),
    ],
)
def test_every_declared_table_dataset_has_its_primary_key_and_a_valid_grain(
    name, grain, window, keys
):
    d.validate_declarations(d.HISTORY_DATASETS, d.WORKING_ONLY)
    dataset = d.get_dataset(name)
    assert dataset.source == d.TableSource(name, window, keys, None, 0)
    assert dataset.archive_grain == grain
    assert dataset.hot_days is None
    assert dataset.rebuild_needs == ()
    assert dataset.schema_version == 1


def test_copied_tables_cover_each_declared_class():
    expected = """
        core.providers core.feed_endpoints core.dataset_versions
        core.snapshot_publish_state core.snapshot_historic_receipts
        core.snapshot_historic_gc_marks core.pipeline_switches core.history_window
        core.history_archive_copy core.history_event core.worker_starts
        core.route_live_observations core.alert_language_coverage_samples
        raw.alert_feed_observations raw.alert_language_observations raw.ingestion_runs
        raw.ingestion_objects raw.realtime_snapshot_index raw.i3_alert_snapshots
        silver.agency silver.calendar silver.calendar_dates silver.directions silver.feed_info
        silver.route_patterns silver.routes silver.shapes silver.stop_times silver.stops
        silver.translations silver.trips silver.gtfs_extra_rows silver.gtfs_source_members
        gold.schedule_version_service_summary gold.trip_service_span
        gold.alert_archive_entry gold.dim_date gold.dim_route gold.dim_route_history
        gold.dim_route_pattern gold.dim_stop gold.dim_stop_history gold.report_labels
        gold.repeat_offender gold.route_headway_by_shift gold.route_headway_by_direction_shift
        gold.trip_delay_summary_5m gold.warm_rollup_periods gold.route_delay_hourly
        gold.stop_delay_hourly gold.repeated_problem_route_stop gold.citizen_accountability_daily
        gold.route_delay_percentile_daily gold.stop_delay_percentile_daily
        gold.route_cancellation_daily gold.route_occupancy_band_daily
        gold.route_occupancy_band_hourly
        gold.stop_occupancy_band_daily gold.route_service_span_daily gold.route_skipped_stop_daily
        gold.route_delay_by_crowding_daily gold.route_delay_spine gold.route_headway_shift_daily
        gold.stop_delay_spine gold.stop_delay_shift_daily gold.repeat_offender_daily_spine
        gold.route_scheduled_trips_daily gold.alert_cell_day gold.network_vehicle_day
        gold.fact_trip_delay_snapshot gold.fact_vehicle_snapshot gold.realtime_serving_state
    """.split()
    tables = {
        name: entry
        for name, entry in d.HISTORY_DATASETS.items()
        if isinstance(entry.source, d.TableSource)
    }
    assert set(tables) == set(expected)
    for name, entry in tables.items():
        assert entry.source.table == name
        assert entry.source.key_columns
        assert entry.archive_grain in {"month", "edition", "utc_day"}
        assert entry.schema_version == 1
        assert entry.rebuild_needs == ()
        assert all(entry.source.key_columns)
        if name not in {"gold.fact_trip_delay_snapshot", "gold.fact_vehicle_snapshot"}:
            assert entry.hot_days is None


@pytest.mark.parametrize(
    "name,window",
    [
        ("core.alert_language_coverage_samples", "measurement_date"),
        ("raw.alert_feed_observations", "observation_date"),
        ("raw.alert_language_observations", "observation_date"),
        ("raw.ingestion_runs", "started_at_utc"),
        ("raw.ingestion_objects", "created_at_utc"),
        ("raw.realtime_snapshot_index", "captured_at_utc"),
        ("raw.i3_alert_snapshots", "captured_at_utc"),
    ],
)
def test_observations_and_capture_indexes_use_their_ddl_window(name, window):
    dataset = d.get_dataset(name)
    assert dataset.archive_grain == "month"
    assert dataset.source.window_column == window


@pytest.mark.parametrize("name", ["gold.fact_trip_delay_snapshot", "gold.fact_vehicle_snapshot"])
def test_facts_are_utc_day_datasets_with_fourteen_hot_days(name):
    dataset = d.get_dataset(name)
    assert dataset.archive_grain == "utc_day"
    assert dataset.hot_days == 14
    assert dataset.source == d.TableSource(
        name, "captured_at_utc", ("provider_id", "realtime_snapshot_id", "entity_index"), None, 0
    )


@pytest.mark.parametrize(
    "name,keys",
    [
        (
            "gold.alert_cell_day",
            ("provider_id", "revision", "scope", "entity_id", "service_date", "cause", "effect"),
        ),
        ("gold.network_vehicle_day", ("provider_id", "revision", "service_date")),
    ],
)
def test_revision_tables_declare_their_revision_column(name, keys):
    dataset = d.get_dataset(name)
    assert dataset.archive_grain == "month"
    assert dataset.source == d.TableSource(name, "service_date", keys, "revision", 0)


def test_no_consumer_selects_table_datasets_for_daily_capture_work():
    discovery = Mock()
    discovery.execute.return_value.scalars.return_value = ["network"]
    assert capture_providers(discovery, now=datetime(2026, 11, 14, tzinfo=UTC)) == ["network"]
    params = discovery.execute.call_args.args[1]
    assert params["capture_ids"] == [
        "capture.trip_updates",
        "capture.vehicle_positions",
        "capture.i3_alerts",
        "capture.service_alerts",
    ]
    assert params["capture_feeds"] == [
        "trip_updates",
        "vehicle_positions",
        "i3_alerts",
        "service_alerts",
    ]
    closing = Mock()
    closing.execute.return_value.mappings.return_value.all.return_value = []
    assert close_unfinished_runs(closing, provider_id="network") == 0
    assert closing.execute.call_args.args[1]["endpoint_keys"] == [
        "i3_alerts",
        "service_alerts",
        "trip_updates",
        "vehicle_positions",
    ]


def test_working_only_tables_declare_their_rebuild_sources():
    expected = {
        "silver.rt_feed_snapshots": ("capture.trip_updates", "capture.vehicle_positions"),
        "silver.rt_entities": ("capture.trip_updates", "capture.vehicle_positions"),
        "silver.rt_trip_updates": ("capture.trip_updates", "capture.vehicle_positions"),
        "silver.rt_trip_update_stop_times": ("capture.trip_updates", "capture.vehicle_positions"),
        "silver.rt_vehicle_positions": ("capture.trip_updates", "capture.vehicle_positions"),
        "gold.latest_trip_delay_snapshot": (
            "gold.fact_trip_delay_snapshot",
            "capture.trip_updates",
            "gold.realtime_serving_state",
        ),
        "gold.latest_vehicle_snapshot": (
            "gold.fact_vehicle_snapshot",
            "capture.vehicle_positions",
            "gold.realtime_serving_state",
        ),
        "silver.i3_alerts": ("capture.i3_alerts", "capture.service_alerts"),
        "silver.i3_alert_active_periods": ("capture.i3_alerts", "capture.service_alerts"),
        "silver.i3_alert_informed_entities": ("capture.i3_alerts", "capture.service_alerts"),
        "silver.gis_datasets": (),
        "silver.gis_gtfs_matches": (),
        "silver.gis_line_features": (),
        "silver.gis_stop_features": (),
    }
    claims = {table: entry for entry in d.WORKING_ONLY.values() for table in entry.tables}
    assert {name: entry.rebuilt_from for name, entry in claims.items()} == expected
    assert all(entry.reason for entry in claims.values())
    assert claims["silver.gis_datasets"].reason == "static lane LS3.12c copies GIS editions"
    assert "gold.alert_archive_entry" in claims["silver.i3_alerts"].reason
    d.validate_declarations(d.HISTORY_DATASETS, d.WORKING_ONLY)


def relation(name, kind="table", columns=(), key=()):
    from transit_ops.lake.catalog import CatalogTable, Column

    return CatalogTable(name, kind, tuple(Column(*column) for column in columns), key)


def test_inventory_flags_an_unclaimed_table_and_a_key_mismatch():
    from transit_ops.lake.inventory import take_inventory

    result = take_inventory(
        [
            relation("new.z_table"),
            relation("new.a_table"),
            relation("core.pipeline_switches", key=("wrong",)),
        ]
    )
    assert result.copied == ("core.pipeline_switches",)
    assert result.unclaimed == ("new.a_table", "new.z_table")
    assert result.key_mismatch == ("core.pipeline_switches",)
    assert "gold.fact_vehicle_snapshot" in result.missing
    assert "silver.rt_entities" in result.missing
    assert "core.pipeline_switches" not in result.missing
    assert result.missing == tuple(sorted(result.missing))
    assert not result.complete


def test_inventory_lists_views_without_requiring_declarations():
    from transit_ops.lake.inventory import take_inventory

    result = take_inventory([relation("gold.z_view", "view"), relation("gold.a_view", "view")])
    assert result.views == ("gold.a_view", "gold.z_view")
    assert result.unclaimed == result.unsupported == ()


def test_inventory_refuses_materialized_views_and_foreign_tables_as_unsupported():
    from transit_ops.lake.inventory import take_inventory

    result = take_inventory(
        [
            relation("gold.z_mv", "materialized_view"),
            relation("external.foreign", "foreign"),
            relation("external.other", "other"),
            relation("core.providers", "view"),
        ]
    )
    assert result.unsupported == ("external.foreign", "external.other", "gold.z_mv")
    assert "core.providers" in result.missing
    assert result.copied == result.unclaimed == ()
    assert not result.complete


@pytest.mark.parametrize("pg_type", [None, "text", "integer", "timestamp without time zone"])
def test_inventory_flags_missing_or_invalid_window_columns(pg_type):
    from transit_ops.lake.inventory import take_inventory

    columns = () if pg_type is None else (("captured_at_utc", pg_type),)
    result = take_inventory(
        [
            relation(
                "gold.fact_vehicle_snapshot",
                columns=columns,
                key=("provider_id", "realtime_snapshot_id", "entity_index"),
            )
        ]
    )
    assert result.window_mismatch == ("gold.fact_vehicle_snapshot",)
    assert result.key_mismatch == ()


@pytest.mark.parametrize("pg_type", ["date", "timestamp with time zone", "bigint"])
def test_inventory_accepts_window_types_and_partitioned_tables(pg_type):
    from transit_ops.lake.inventory import take_inventory

    result = take_inventory(
        [
            relation(
                "gold.fact_vehicle_snapshot",
                "partitioned",
                (("captured_at_utc", pg_type),),
                ("provider_id", "realtime_snapshot_id", "entity_index"),
            )
        ]
    )
    assert result.copied == ("gold.fact_vehicle_snapshot",)
    assert result.window_mismatch == result.key_mismatch == result.unsupported == ()


def test_inventory_compares_primary_keys_in_order():
    from transit_ops.lake.inventory import take_inventory

    result = take_inventory(
        [
            relation(
                "gold.fact_vehicle_snapshot",
                columns=(("captured_at_utc", "date"),),
                key=("realtime_snapshot_id", "provider_id", "entity_index"),
            )
        ]
    )
    assert result.key_mismatch == ("gold.fact_vehicle_snapshot",)


def test_complete_inventory_requires_all_declared_tables():
    from transit_ops.lake.inventory import take_inventory

    catalog = []
    for dataset in d.HISTORY_DATASETS.values():
        source = dataset.source
        if isinstance(source, d.TableSource):
            columns = () if source.window_column is None else ((source.window_column, "bigint"),)
            catalog.append(relation(source.table, columns=columns, key=source.key_columns))
    catalog.extend(relation(table) for entry in d.WORKING_ONLY.values() for table in entry.tables)
    result = take_inventory(tuple(reversed(catalog)))
    assert result.complete
    assert result.working_only == (
        "gold.latest_trip_delay_snapshot",
        "gold.latest_vehicle_snapshot",
        "silver.gis_datasets",
        "silver.gis_gtfs_matches",
        "silver.gis_line_features",
        "silver.gis_stop_features",
        "silver.i3_alert_active_periods",
        "silver.i3_alert_informed_entities",
        "silver.i3_alerts",
        "silver.rt_entities",
        "silver.rt_feed_snapshots",
        "silver.rt_trip_update_stop_times",
        "silver.rt_trip_updates",
        "silver.rt_vehicle_positions",
    )
    assert result.copied == tuple(sorted(result.copied))
    assert result.views == result.unclaimed == result.missing == ()
    assert result.key_mismatch == result.window_mismatch == result.unsupported == ()


@pytest.mark.parametrize(
    "problem", ["unclaimed", "missing", "key_mismatch", "window_mismatch", "unsupported"]
)
def test_each_inventory_problem_prevents_completeness(problem):
    from dataclasses import replace

    from transit_ops.lake.inventory import Inventory

    clean = Inventory(
        ("core.providers",), ("silver.rt_entities",), ("gold.view",), (), (), (), (), ()
    )
    assert clean.complete
    assert not replace(clean, **{problem: ("gold.problem",)}).complete


def test_accepted_empty_identity_and_fixed_cutoff_require_a_whole_state_copy():
    from transit_ops.lake.inventory import take_inventory

    # No fact/cache rows prove acceptance; even NULL identity has a durable cutoff.
    dataset = d.get_dataset("gold.realtime_serving_state")
    assert dataset.source == d.TableSource(
        "gold.realtime_serving_state", None, ("provider_id", "endpoint_key"), None, 0
    )
    assert dataset.archive_grain == "month"
    assert dataset.hot_days is None
    assert dataset.rebuild_needs == ()
    result = take_inventory(
        [
            relation(
                "gold.realtime_serving_state",
                columns=(
                    ("provider_id", "text"),
                    ("endpoint_key", "text"),
                    ("realtime_snapshot_id", "bigint"),
                    ("captured_at_utc", "timestamp with time zone"),
                    ("initialized_at_utc", "timestamp with time zone"),
                ),
                key=("provider_id", "endpoint_key"),
            )
        ]
    )
    assert result.copied == ("gold.realtime_serving_state",)
    assert result.working_only == result.key_mismatch == result.window_mismatch == ()


@pytest.mark.parametrize("feed", ["i3_alerts", "service_alerts"])
def test_alert_rebuild_sources_cover_both_normalized_feed_paths(feed):
    from google.transit import gtfs_realtime_pb2

    from transit_ops.ingestion.service_alerts import convert_gtfs_rt_alerts_to_i3_payload
    from transit_ops.silver.i3 import RawI3AlertSnapshot, normalize_i3_alert_payload

    stamp = datetime(2026, 11, 14, tzinfo=UTC)
    payload = {
        "alerts": [
            {
                "id": "notice",
                "informedEntities": [{"routeId": "route-1"}],
                "activePeriod": [{"start": int(stamp.timestamp())}],
            }
        ]
    }
    if feed == "service_alerts":
        message = gtfs_realtime_pb2.FeedMessage()
        message.header.gtfs_realtime_version = "2.0"
        alert = message.entity.add(id="notice").alert
        alert.informed_entity.add(route_id="route-1")
        alert.active_period.add(start=int(stamp.timestamp()))
        payload = convert_gtfs_rt_alerts_to_i3_payload(message.SerializeToString())
    snapshot = RawI3AlertSnapshot(42, "network", "UTC", stamp, payload)
    alerts, entities, periods = normalize_i3_alert_payload(snapshot)
    assert alerts[0]["alert_id"] == "notice"
    assert entities[0]["route_id"] == "route-1"
    assert periods[0]["start_utc"] == stamp
    for table in (
        "silver.i3_alerts",
        "silver.i3_alert_active_periods",
        "silver.i3_alert_informed_entities",
    ):
        assert "capture." + feed in d.WORKING_ONLY[table].rebuilt_from
