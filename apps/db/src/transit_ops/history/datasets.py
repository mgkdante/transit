"""Declarations for kept records and intentionally working-only tables."""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from types import MappingProxyType
from typing import Literal

ArchiveGrain = Literal["utc_day", "service_day", "month", "edition"]
IndexFamily = Literal["realtime_snapshot", "alert_snapshot"]


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
WORKING_ONLY: Mapping[str, WorkingOnly] = MappingProxyType({})

validate_declarations(HISTORY_DATASETS, WORKING_ONLY)
