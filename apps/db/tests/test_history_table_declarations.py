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
        gold.fact_trip_delay_snapshot gold.fact_vehicle_snapshot
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
