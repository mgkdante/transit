"""Declarations for kept records and intentionally working-only tables."""

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from types import MappingProxyType
from typing import Literal

ArchiveGrain = Literal["utc_day", "service_day", "month", "edition"]
IndexFamily = Literal["realtime_snapshot", "alert_snapshot"]
UTC_DAY_CLOSE_DELAY = timedelta(hours=6)


def utc_day_closes_at(utc_date: date) -> datetime:
    return datetime.combine(utc_date, time(), UTC) + timedelta(days=1) + UTC_DAY_CLOSE_DELAY


@dataclass(frozen=True)
class CaptureSource:
    endpoint_key: str
    index_family: IndexFamily
    fact_table: str | None


@dataclass(frozen=True)
class TableSource:
    table: str
    window_column: str | None
    key_columns: tuple[str, ...]
    revision_column: str | None
    fixed_revision: int


@dataclass(frozen=True)
class ObjectSource:
    run_kind: str


@dataclass(frozen=True)
class Fold:
    name: str
    period: Literal["month", "year"]


@dataclass(frozen=True)
class HistoryDataset:
    dataset_id: str
    source: CaptureSource | TableSource | ObjectSource
    archive_grain: ArchiveGrain
    hot_days: int | None
    rebuild_needs: tuple[str, ...]
    schema_version: int
    folds: tuple[Fold, ...] = ()


@dataclass(frozen=True)
class WorkingOnly:
    dataset_id: str
    tables: tuple[str, ...]
    reason: str
    rebuilt_from: tuple[str, ...]


class UndeclaredDataset(LookupError):
    """A requested dataset has no history declaration."""


class InvalidDeclaration(ValueError):
    """The declarations disagree or cannot describe valid windows."""


def get_dataset(dataset_id: str) -> HistoryDataset:
    try:
        return HISTORY_DATASETS[dataset_id]
    except KeyError:
        raise UndeclaredDataset(dataset_id) from None


def _validate_dataset(dataset: HistoryDataset, known: set[str]) -> None:
    source, grain = dataset.source, dataset.archive_grain
    problem = None
    if isinstance(source, CaptureSource):
        if dataset.dataset_id != "capture." + source.endpoint_key or grain != "utc_day":
            problem = "capture id or grain"
    elif isinstance(source, ObjectSource):
        if grain != "edition":
            problem = "object grain"
    elif isinstance(source, TableSource):
        if not source.key_columns or source.fixed_revision < 0:
            problem = "table keys or revision"
        if source.window_column is None and grain != "month":
            problem = "whole-table grain"
    if dataset.hot_days is not None and (
        type(dataset.hot_days) is not int or dataset.hot_days <= 0
    ):
        problem = "hot_days"
    if dataset.schema_version < 1:
        problem = "schema_version"
    names = [fold.name for fold in dataset.folds]
    if len(set(names)) != len(names):
        problem = "duplicate fold name"
    for dependency in dataset.rebuild_needs:
        if dependency not in known or dependency == dataset.dataset_id:
            problem = f"rebuild dependency {dependency}"
    if problem:
        raise InvalidDeclaration(f"{dataset.dataset_id}: {problem}")


def validate_declarations(
    datasets: Mapping[str, HistoryDataset], working_only: Mapping[str, WorkingOnly]
) -> None:
    for registry in (datasets, working_only):
        for key, entry in registry.items():
            if key != entry.dataset_id:
                raise InvalidDeclaration(f"key {key} differs from {entry.dataset_id}")
    overlap = datasets.keys() & working_only.keys()
    if overlap:
        raise InvalidDeclaration(f"history and working-only ids overlap: {sorted(overlap)}")
    tables: dict[str, str] = {}

    def claim(table: str, dataset_id: str) -> None:
        if table in tables:
            raise InvalidDeclaration(f"table {table}: {tables[table]} and {dataset_id}")
        tables[table] = dataset_id

    for dataset in datasets.values():
        _validate_dataset(dataset, set(datasets) | set(working_only))
        if isinstance(dataset.source, TableSource):
            claim(dataset.source.table, dataset.dataset_id)
    for entry in working_only.values():
        for table in entry.tables:
            claim(table, entry.dataset_id)


def window_start(dataset: HistoryDataset, window_key: str) -> date | None:
    grain = dataset.archive_grain
    if grain == "edition":
        if re.fullmatch(r"[0-9a-f]{64}", window_key):
            return None
    else:
        pattern = r"[0-9]{4}-[0-9]{2}" if grain == "month" else r"[0-9]{4}-[0-9]{2}-[0-9]{2}"
        if re.fullmatch(pattern, window_key):
            try:
                return date.fromisoformat(window_key + "-01" if grain == "month" else window_key)
            except ValueError:
                pass
    raise ValueError(f"window key {window_key} does not fit {grain}")


def declare_datasets(entries: Iterable[HistoryDataset]) -> Mapping[str, HistoryDataset]:
    """Keep repeated declarations visible until they can be refused."""
    registry: dict[str, HistoryDataset] = {}
    for entry in entries:
        if entry.dataset_id in registry:
            raise InvalidDeclaration(f"duplicate dataset: {entry.dataset_id}")
        registry[entry.dataset_id] = entry
    return MappingProxyType(registry)


# Rows keep the DDL primary-key order; - means a whole-state copy.
# Whole-state months label replacement snapshots, not disjoint row partitions.
_TABLE_ROWS: tuple[tuple[ArchiveGrain, int | None, str | None, tuple[str, ...]], ...] = (
    (
        "month",
        None,
        None,
        (
            "core.alert_language_coverage_samples/measurement_date/provider_id,measurement_date,window_days",
            "core.dataset_versions/-/dataset_version_id",
            "core.feed_endpoints/-/feed_endpoint_id",
            "core.history_archive_copy/-/dataset_id,provider_id,revision,window_key,content_version",
            "core.history_event/-/event_id",
            "core.history_window/-/dataset_id,provider_id,revision,window_key",
            "core.pipeline_switches/-/switch_key",
            "core.providers/-/provider_id",
            "core.route_live_observations/-/provider_id,route_id",
            "core.snapshot_historic_gc_marks/-/provider_id,object_key",
            "core.snapshot_historic_receipts/-/provider_id,family,entity_key",
            "core.snapshot_publish_state/-/provider_id,tier",
            "core.worker_starts/-/provider_id",
            "gold.alert_archive_entry/-/provider_id,alert_id",
            "gold.citizen_accountability_daily/provider_local_date/provider_id,provider_local_date",
            "gold.dim_date/-/provider_id,service_date",
            "gold.dim_route/-/provider_id,route_id",
            "gold.dim_route_history/-/provider_id,route_id,valid_from_utc",
            "gold.dim_route_pattern/-/provider_id,route_pattern_id",
            "gold.dim_stop/-/provider_id,stop_id",
            "gold.dim_stop_history/-/provider_id,stop_id,valid_from_utc",
            "gold.repeat_offender/-/provider_id,entity_kind,entity_id,route_id",
            "gold.repeat_offender_daily_spine/provider_local_date/provider_id,entity_kind,entity_id,route_id,provider_local_date",
            "gold.repeated_problem_route_stop/period_start_local/provider_id,entity_kind,entity_id,route_id,period_grain,period_start_local",
            "gold.report_labels/-/label_key",
            "gold.route_cancellation_daily/provider_local_date/provider_id,provider_local_date,route_id",
            "gold.route_delay_by_crowding_daily/provider_local_date/provider_id,provider_local_date,route_id,band",
            "gold.route_delay_hourly/period_start_utc/provider_id,period_start_utc,route_id",
            "gold.route_delay_percentile_daily/provider_local_date/provider_id,provider_local_date,route_id",
            "gold.route_delay_spine/provider_local_date/provider_id,route_id,provider_local_date,hour_of_day_local,direction_id",
            "gold.route_headway_by_direction_shift/-/provider_id,route_id,direction_id,shift,service_day_kind",
            "gold.route_headway_by_shift/-/provider_id,route_id,shift",
            "gold.route_headway_shift_daily/provider_local_date/provider_id,route_id,provider_local_date,shift,direction_id",
            "gold.route_occupancy_band_daily/provider_local_date/provider_id,provider_local_date,route_id",
            "gold.route_occupancy_band_hourly/provider_local_date/provider_id,route_id,provider_local_date,hour_of_day_local",
            "gold.route_scheduled_trips_daily/provider_local_date/provider_id,provider_local_date,route_id",
            "gold.route_service_span_daily/provider_local_date/provider_id,provider_local_date,route_id",
            "gold.route_skipped_stop_daily/provider_local_date/provider_id,provider_local_date,route_id",
            # Summary rows outlive their edition metadata, so no checksum join is safe.
            "gold.schedule_version_service_summary/-/provider_id,dataset_version_id,route_id,day_type",
            "gold.stop_delay_hourly/period_start_utc/provider_id,period_start_utc,stop_id,route_id",
            "gold.stop_delay_percentile_daily/provider_local_date/provider_id,provider_local_date,stop_id",
            "gold.stop_delay_shift_daily/provider_local_date/provider_id,stop_id,route_id,provider_local_date,shift",
            "gold.stop_delay_spine/provider_local_date/provider_id,stop_id,route_id,provider_local_date",
            "gold.stop_occupancy_band_daily/provider_local_date/provider_id,provider_local_date,stop_id",
            "gold.trip_delay_summary_5m/period_start_utc/provider_id,period_start_utc,route_id",
            "gold.warm_rollup_periods/period_start_utc/provider_id,rollup_kind,period_start_utc",
            "raw.alert_feed_observations/observation_date/provider_id,observation_date",
            "raw.alert_language_observations/observation_date/provider_id,alert_logical_id,observation_date",
            "raw.i3_alert_snapshots/captured_at_utc/i3_alert_snapshot_id",
            "raw.ingestion_runs/started_at_utc/ingestion_run_id",
            "raw.ingestion_objects/created_at_utc/ingestion_object_id",
            "raw.realtime_snapshot_index/captured_at_utc/realtime_snapshot_id",
        ),
    ),
    (
        "month",
        None,
        "revision",
        (
            "gold.alert_cell_day/service_date/provider_id,revision,scope,entity_id,service_date,cause,effect",
            "gold.network_vehicle_day/service_date/provider_id,revision,service_date",
        ),
    ),
    (
        "utc_day",
        14,
        None,
        (
            "gold.fact_vehicle_snapshot/captured_at_utc/provider_id,realtime_snapshot_id,entity_index",
            "gold.fact_trip_delay_snapshot/captured_at_utc/provider_id,realtime_snapshot_id,entity_index",
        ),
    ),
    (
        "edition",
        None,
        None,
        (
            "gold.trip_service_span/dataset_version_id/provider_id,dataset_version_id,trip_id",
            "silver.agency/dataset_version_id/dataset_version_id,agency_id",
            "silver.calendar/dataset_version_id/dataset_version_id,service_id",
            "silver.calendar_dates/dataset_version_id/dataset_version_id,service_id,service_date",
            "silver.directions/dataset_version_id/dataset_version_id,route_direction_id",
            "silver.feed_info/dataset_version_id/dataset_version_id",
            "silver.gtfs_extra_rows/dataset_version_id/dataset_version_id,source_file_name,source_row_number",
            "silver.gtfs_source_members/dataset_version_id/dataset_version_id,source_file_name,member_path",
            "silver.route_patterns/dataset_version_id/dataset_version_id,route_pattern_id",
            "silver.routes/dataset_version_id/dataset_version_id,route_id",
            "silver.shapes/dataset_version_id/dataset_version_id,shape_id,shape_pt_sequence",
            "silver.stops/dataset_version_id/dataset_version_id,stop_id",
            "silver.stop_times/dataset_version_id/dataset_version_id,trip_id,stop_sequence",
            "silver.translations/dataset_version_id/dataset_version_id,translation_row_number",
            "silver.trips/dataset_version_id/dataset_version_id,trip_id",
        ),
    ),
)

_TABLE_DATASETS = (
    HistoryDataset(
        table,
        TableSource(table, None if window == "-" else window, tuple(keys.split(",")), revision, 0),
        grain,
        hot_days,
        (),
        1,
    )
    for grain, hot_days, revision, rows in _TABLE_ROWS
    for row in rows
    for table, window, keys in (row.split("/"),)
)

HISTORY_DATASETS: Mapping[str, HistoryDataset] = MappingProxyType(
    {
        "capture." + source.endpoint_key: HistoryDataset(
            "capture." + source.endpoint_key,
            source,
            "utc_day",
            16,
            (),
            1,  # Capture pack format 1.
        )
        for source in (
            CaptureSource("trip_updates", "realtime_snapshot", "gold.fact_trip_delay_snapshot"),
            CaptureSource("vehicle_positions", "realtime_snapshot", "gold.fact_vehicle_snapshot"),
            CaptureSource("i3_alerts", "alert_snapshot", None),
            CaptureSource("service_alerts", "alert_snapshot", None),
        )
    }
)
HISTORY_DATASETS = declare_datasets((*HISTORY_DATASETS.values(), *_TABLE_DATASETS))
WORKING_ONLY: Mapping[str, WorkingOnly] = MappingProxyType({})

validate_declarations(HISTORY_DATASETS, WORKING_ONLY)
