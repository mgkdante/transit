from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from contextlib import AbstractContextManager, nullcontext
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel

from transit_ops.snapshots.contract import (
    HistoricCollectionIndex,
    HistoricCoverageGap,
    HistoricDelayMetric,
    HistoricDelayPercentiles,
    HistoricEntityDirectoryIndex,
    HistoricHotspotsDay,
    HistoricMetricCoverage,
    HistoricOccupancyMetric,
    HistoricPartitionRef,
    HistoricRepeatOffendersDay,
    HistoryMetricAggregation,
    HistoryMetricName,
)
from transit_ops.snapshots.serialization import snapshot_json_bytes, snapshot_sha256

_CANONICAL_ENTITY_ID = re.compile(r"(?:[0-9a-f]{2})+")
HistoryRow = Mapping[str, Any]
HistoryMetricRows = tuple[list[HistoryRow], ...]
HistoryBatchLoader = Callable[[list[str]], HistoryMetricRows]
HistoryPhaseContext = Callable[[str], AbstractContextManager[None]]
HistoricScopeClass = str


class HistoricPartitionError(ValueError):
    """A fatal same-pass history invariant, independent of gate force mode."""


def _source_scope(row: HistoryRow, entity_field: str | None) -> tuple[str, str, date]:
    entity = "" if entity_field is None else row.get(entity_field)
    if not isinstance(entity, str) or (entity_field is not None and not entity):
        raise HistoricPartitionError("history source entity ID must be nonempty text")
    local_date = date.fromisoformat(history_date(row["local_date"], field="local_date"))
    return entity, local_date.isoformat()[:7], local_date


def consume_history_source_rows(
    rows: Iterable[HistoryRow], *, entity_field: str | None,
) -> list[HistoryRow]:
    """Check SQL window counts against consumed rows, then discard the count column."""
    plain: list[HistoryRow] = []
    expected: dict[tuple[str, str], int] = {}
    consumed: dict[tuple[str, str], int] = defaultdict(int)
    for raw in rows:
        row = dict(raw)
        count = row.pop("__history_scope_count", None)
        entity, month, _local_date = _source_scope(row, entity_field)
        key = (entity, month)
        if not isinstance(count, int) or isinstance(count, bool) or count <= 0:
            raise HistoricPartitionError("history source scope count is invalid or missing")
        if key in expected and expected[key] != count:
            raise HistoricPartitionError("history source scope counts conflict")
        expected[key] = count
        consumed[key] += 1
        plain.append(row)
    if dict(consumed) != expected:
        raise HistoricPartitionError("history source scope row count mismatch")
    return plain


def consume_history_inventory_rows(
    rows: Iterable[HistoryRow], *, entity_field: str,
) -> tuple[str, ...]:
    """Validate the independent SQL total and IDs before any normalization/filtering."""
    values: list[str] = []
    expected: int | None = None
    row_count = 0
    for row in rows:
        row_count += 1
        count = row.get("__history_inventory_count")
        if not isinstance(count, int) or isinstance(count, bool) or count < 0:
            raise HistoricPartitionError("history inventory total is invalid or missing")
        if expected is not None and count != expected:
            raise HistoricPartitionError("history inventory totals conflict")
        expected = count
        entity = row.get(entity_field)
        if count == 0 and entity is None:
            continue  # SQL emits one sentinel even when its inventory is empty.
        if not isinstance(entity, str) or not entity:
            raise HistoricPartitionError("history inventory ID must be nonempty text")
        values.append(entity)
    if expected is None or expected != len(values) or (expected == 0 and row_count != 1):
        raise HistoricPartitionError("history inventory row count mismatch")
    if len(set(values)) != len(values):
        raise HistoricPartitionError("history inventory contains duplicate entity ids")
    return tuple(values)


@dataclass
class HistorySourceScopes:
    """Same-pass source identity and date bounds, with no digests or persistence."""

    entity_ids: tuple[str, ...]
    provider_id: str
    family: str
    scopes: list[tuple[str, str]] = field(default_factory=list)
    bounds: dict[tuple[str, str], tuple[date, date]] = field(default_factory=dict)
    _loaded: set[tuple[int, str, str]] = field(default_factory=set)

    def observe_rows(
        self, rows: Sequence[HistoryRow], *, source: int, entity_field: str | None,
    ) -> None:
        bounds: dict[tuple[str, str], tuple[date, date]] = {}
        for row in rows:
            entity, month, local_date = _source_scope(row, entity_field)
            key = (entity, month)
            start, end = bounds.get(key, (local_date, local_date))
            bounds[key] = min(start, local_date), max(end, local_date)
        for (entity, month), (start, end) in sorted(bounds.items()):
            key = (entity, month)
            if (source, entity, month) in self._loaded:
                raise HistoricPartitionError("duplicate source entity-month scope")
            self._loaded.add((source, entity, month))
            if key not in self.bounds:
                self.scopes.append(key)
                self.bounds[key] = start, end
            else:
                previous_start, previous_end = self.bounds[key]
                self.bounds[key] = min(previous_start, start), max(previous_end, end)


def history_phase(
    phase_context: HistoryPhaseContext | None,
    phase_name: str,
) -> AbstractContextManager[None]:
    return nullcontext() if phase_context is None else phase_context(phase_name)


def classify_historic_scope(
    *,
    family: str,
    scope_start: date,
    scope_end: date,
    today_local: date,
    open_window_days: int,
    fact_retention_days: int,
    retention_days: int,
) -> HistoricScopeClass:
    if family not in {"network", "lines", "stops"}:
        raise ValueError(f"unsupported historic family: {family!r}")
    if scope_start > scope_end:
        raise ValueError("historic scope start must not exceed scope end")
    month_start = scope_start.replace(day=1)
    if scope_end.replace(day=1) != month_start:
        raise ValueError("historic scope classification requires one calendar month")
    next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    month_end = next_month - timedelta(days=1)
    if min(open_window_days, fact_retention_days, retention_days) <= 0:
        raise ValueError("historic scope classification windows must be positive")
    retention_floor = today_local - timedelta(days=retention_days)
    mutable_days = (
        max(open_window_days, fact_retention_days)
        if family == "network"
        else open_window_days
    )
    mutable_floor = today_local - timedelta(days=mutable_days)
    if month_start <= retention_floor:
        return "retention_edge"
    if month_end >= mutable_floor:
        return "mutable_edge"
    return "settled_candidate"


def history_collection_generation_id(canonical: dict) -> str:  # type: ignore[type-arg]

    return snapshot_sha256(canonical)


def history_collection_generation_basis(index: BaseModel | Mapping[str, Any]) -> dict[str, Any]:

    if isinstance(index, BaseModel):
        payload = index.model_dump(mode="json")
    else:
        payload = dict(index)
    fields = (
        "family",
        "selection_mode",
        "entity_id",
        "first_available_date",
        "last_available_date",
        "available_dates",
        "gaps",
        "partitions",
        "metrics",
    )
    return {field: payload.get(field) for field in fields}


def history_index_generation_id(index: BaseModel | Mapping[str, Any]) -> str:

    return history_collection_generation_id(history_collection_generation_basis(index))


def history_entity_directory_generation_id(
    directory: BaseModel | Mapping[str, Any],
) -> str:

    if isinstance(directory, BaseModel):
        payload = directory.model_dump(mode="json")
    else:
        payload = dict(directory)
    return history_collection_generation_id(
        {
            "family": payload.get("family"),
            "selection_mode": payload.get("selection_mode"),
            "first_available_date": payload.get("first_available_date"),
            "last_available_date": payload.get("last_available_date"),
            "entities": payload.get("entities"),
        }
    )


def history_pointer_path(prefix: str, payload: BaseModel | Mapping[str, Any]) -> str:

    return f"{prefix.rstrip('/')}/generations/{snapshot_sha256(payload)}/index.json"


def readdress_history_directory(
    directory: HistoricEntityDirectoryIndex,
    index_paths: Mapping[str, str],
) -> HistoricEntityDirectoryIndex:

    result = directory.model_copy(deep=True)
    for entity in result.entities:
        entity.index_path = index_paths[entity.entity_id]
    result.collection_generation_id = history_entity_directory_generation_id(result)
    return result


def history_date(value: object, *, field: str = "local_date") -> str:

    if isinstance(value, datetime):
        value = value.date()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        try:
            parsed = date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError(f"{field} must be a valid local calendar date") from exc
        if parsed.isoformat() == value:
            return value
    raise ValueError(f"{field} must be a valid local calendar date")


def iter_history_date_groups(
    rows: Iterable[Mapping[str, Any]],
    *,
    field: str = "local_date",
):  # type: ignore[no-untyped-def]

    current: str | None = None
    grouped: list[Mapping[str, Any]] = []
    for row in rows:
        local_date = history_date(row.get(field), field=field)
        if current is not None and local_date < current:
            raise ValueError(f"history rows must be ordered by {field}")
        if current is not None and local_date != current:
            yield current, grouped
            grouped = []
        current = local_date
        grouped.append(row)
    if current is not None:
        yield current, grouped


@dataclass(frozen=True)
class _HistoryNameInterval:
    name: str | None
    valid_from_utc: datetime
    valid_to_utc: datetime | None


class HistoryNameIndex:
    """Provider-local closing-instant lookup over append-only name intervals."""

    def __init__(
        self,
        rows: Iterable[Mapping[str, Any]],
        *,
        provider_timezone: str,
    ) -> None:
        try:
            self._timezone = ZoneInfo(provider_timezone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"unknown provider timezone {provider_timezone!r}") from exc
        intervals: dict[tuple[str, str], list[_HistoryNameInterval]] = defaultdict(list)
        for row in rows:
            kind = row.get("entity_kind")
            entity_id = row.get("entity_id")
            if kind not in {"route", "stop"}:
                raise ValueError("history name entity_kind must be route or stop")
            if not isinstance(entity_id, str) or not entity_id:
                raise ValueError("history name entity_id must be nonempty")
            name = row.get("name")
            if name is not None and not isinstance(name, str):
                raise ValueError("history name must be a string or null")
            valid_from = _history_datetime(row.get("valid_from_utc"), field="valid_from_utc")
            valid_to_value = row.get("valid_to_utc")
            valid_to = (
                None
                if valid_to_value is None
                else _history_datetime(valid_to_value, field="valid_to_utc")
            )
            intervals[(kind, entity_id)].append(_HistoryNameInterval(name, valid_from, valid_to))
        self._intervals = {
            key: tuple(sorted(values, key=lambda value: value.valid_from_utc))
            for key, values in intervals.items()
        }
        # Grains revisit the same entities on one date. Retain only that date's lookups.
        self._name_lookup: tuple[str, datetime, dict[tuple[str, str], str | None]] | None = None

    def name_at(self, kind: str, entity_id: str, local_date: str) -> str | None:

        lookup = self._name_lookup
        if lookup is None or local_date != lookup[0]:
            parsed = date.fromisoformat(history_date(local_date, field="date"))
            closing_utc = datetime.combine(
                parsed + timedelta(days=1),
                time.min,
                tzinfo=self._timezone,
            ).astimezone(UTC)
            lookup = (local_date, closing_utc, {})
            self._name_lookup = lookup
        _, closing_utc, resolved_names = lookup
        key = (kind, entity_id)
        if key in resolved_names:
            return resolved_names[key]
        candidates = [
            interval
            for interval in self._intervals.get(key, ())
            if interval.valid_from_utc < closing_utc
            and (interval.valid_to_utc is None or interval.valid_to_utc >= closing_utc)
        ]
        name = max(candidates, key=lambda value: value.valid_from_utc).name if candidates else None
        resolved_names[key] = name
        return name

    def names_at(
        self,
        kind: str,
        entity_ids: Iterable[str],
        local_date: str,
    ) -> dict[str, str | None]:

        return {
            entity_id: self.name_at(kind, entity_id, local_date)
            for entity_id in sorted(set(entity_ids))
        }


@dataclass
class HistoryDateMask:
    """Compact relative-date set for bounded retained-history summaries."""

    _first_ordinal: int | None = None
    _bits: int = 0

    def add(self, value: object) -> None:
        ordinal = date.fromisoformat(history_date(value, field="date")).toordinal()
        if self._first_ordinal is None:
            self._first_ordinal = ordinal
            self._bits = 1
            return
        if ordinal < self._first_ordinal:
            self._bits <<= self._first_ordinal - ordinal
            self._first_ordinal = ordinal
        self._bits |= 1 << (ordinal - self._first_ordinal)

    def update(self, values: Iterable[object]) -> None:
        for value in values:
            self.add(value)

    def merge(self, other: HistoryDateMask) -> None:
        if other._first_ordinal is None:
            return
        if self._first_ordinal is None:
            self._first_ordinal = other._first_ordinal
            self._bits = other._bits
            return
        first = min(self._first_ordinal, other._first_ordinal)
        self._bits = (self._bits << (self._first_ordinal - first)) | (
            other._bits << (other._first_ordinal - first)
        )
        self._first_ordinal = first

    def copy(self) -> HistoryDateMask:
        return HistoryDateMask(self._first_ordinal, self._bits)

    def __bool__(self) -> bool:
        return self._first_ordinal is not None

    def __len__(self) -> int:
        return self._bits.bit_count()

    def __iter__(self):  # type: ignore[no-untyped-def]
        if self._first_ordinal is None:
            return
        remaining = self._bits
        while remaining:
            lowest = remaining & -remaining
            offset = lowest.bit_length() - 1
            yield date.fromordinal(self._first_ordinal + offset).isoformat()
            remaining ^= lowest


def history_month(local_date: str) -> str:

    return history_date(local_date)[:7]


def _history_datetime(value: object, *, field: str) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError(f"{field} must be an ISO timestamp with timezone") from exc
    else:
        raise ValueError(f"{field} must be an ISO timestamp with timezone")
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{field} must include a timezone")
    return parsed.astimezone(UTC)


def history_utc_timestamp(value: object, *, field: str = "source_generated_utc") -> str:

    parsed = _history_datetime(value, field=field)
    rendered = parsed.isoformat(timespec="microseconds" if parsed.microsecond else "seconds")
    return rendered.replace("+00:00", "Z")


def latest_history_timestamp(
    values: Iterable[object],
    *,
    fallback: object | None = None,
) -> str:

    parsed = [_history_datetime(value, field="source_generated_utc") for value in values]
    if not parsed:
        if fallback is None:
            raise ValueError("history timestamp set cannot be empty without a fallback")
        parsed.append(_history_datetime(fallback, field="generated_utc"))
    return history_utc_timestamp(max(parsed), field="source_generated_utc")


def history_row_int(
    row: Mapping[str, Any],
    field: str,
    *,
    optional: bool = False,
    minimum: int | None = 0,
) -> int | None:

    value = row.get(field)
    if value is None:
        if optional:
            return None
        raise ValueError(f"history row {field} cannot be null")
    if isinstance(value, bool):
        raise ValueError(f"history row {field} must be an integer")
    try:
        result = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"history row {field} must be an integer") from exc
    if result != value:
        raise ValueError(f"history row {field} must be an exact integer")
    if minimum is not None and result < minimum:
        raise ValueError(f"history row {field} must be >= {minimum}")
    return result


def history_row_timestamp(row: Mapping[str, Any]) -> str:

    return history_utc_timestamp(row.get("source_generated_utc"))


def history_optional_sum(values: Iterable[int | None]) -> int | None:
    present = [value for value in values if value is not None]
    return sum(present) if present else None


def history_row_float(row: HistoryRow, field: str) -> float | None:
    value = row.get(field)
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(f"history row {field} must be numeric")
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"history row {field} must be numeric") from exc


def history_entity_percentile_metrics(
    rows: Iterable[Mapping[str, Any]],
    *,
    entity_id_of: Callable[[HistoryRow], str],
    label: str,
) -> tuple[
    dict[str, dict[str, HistoricDelayPercentiles]],
    dict[str, dict[str, list[str]]],
]:
    metrics: dict[str, dict[str, HistoricDelayPercentiles]] = {}
    timestamps: dict[str, dict[str, list[str]]] = {}
    groups = group_history_entity_date_rows(rows, entity_id_of=entity_id_of)
    for (entity_id, local_date), grouped in groups.items():
        if len(grouped) != 1:
            raise ValueError(f"duplicate {label} percentile day {entity_id}/{local_date}")
        row = grouped[0]
        observation_count = history_row_int(row, "observation_count") or 0
        if observation_count <= 0:
            raise ValueError(f"{label} percentile observation_count must be positive")
        put_history_entity_metric(
            metrics,
            entity_id,
            local_date,
            HistoricDelayPercentiles(
                observation_count=observation_count,
                p50_delay_seconds=history_row_float(row, "p50_delay_seconds"),
                p90_delay_seconds=history_row_float(row, "p90_delay_seconds"),
            ),
        )
        put_history_entity_timestamps(timestamps, entity_id, local_date, grouped)
    return metrics, timestamps


def history_entity_occupancy_metrics(
    rows: Iterable[Mapping[str, Any]],
    *,
    entity_id_of: Callable[[HistoryRow], str],
    label: str,
) -> tuple[
    dict[str, dict[str, HistoricOccupancyMetric]],
    dict[str, dict[str, list[str]]],
]:
    metrics: dict[str, dict[str, HistoricOccupancyMetric]] = {}
    timestamps: dict[str, dict[str, list[str]]] = {}
    bands = ("empty", "many_seats", "few_seats", "standing", "full")
    groups = group_history_entity_date_rows(rows, entity_id_of=entity_id_of)
    for (entity_id, local_date), grouped in groups.items():
        observation_count = sum(history_row_int(row, "observation_count") or 0 for row in grouped)
        counts = {band: sum(history_row_int(row, band) or 0 for row in grouped) for band in bands}
        if observation_count != sum(counts.values()):
            raise ValueError(f"{label} occupancy observation_count must equal the sum of bands")
        if observation_count <= 0:
            continue
        put_history_entity_metric(metrics, entity_id, local_date, HistoricOccupancyMetric(**counts))
        put_history_entity_timestamps(
            timestamps,
            entity_id,
            local_date,
            (row for row in grouped if (history_row_int(row, "observation_count") or 0) > 0),
        )
    return metrics, timestamps


def history_delay_metric(grouped: Sequence[HistoryRow]) -> HistoricDelayMetric | None:
    observation_count = sum(history_row_int(row, "observation_count") or 0 for row in grouped)
    if observation_count <= 0:
        return None
    in_clamp = sum(history_row_int(row, "in_clamp_observation_count") or 0 for row in grouped)
    on_time = history_optional_sum(
        history_row_int(row, "on_time_count", optional=True) for row in grouped
    )
    severe = history_optional_sum(
        history_row_int(row, "severe_count", optional=True) for row in grouped
    )
    delay_sum = sum(
        history_row_int(row, "sum_delay_seconds", minimum=None) or 0 for row in grouped
    )
    return HistoricDelayMetric(
        observation_count=observation_count,
        in_clamp_observation_count=in_clamp if in_clamp > 0 else None,
        on_time_count=on_time,
        severe_count=severe,
        sum_delay_seconds=delay_sum if in_clamp > 0 else None,
    )


def group_history_entity_date_rows(
    rows: Iterable[HistoryRow], *, entity_id_of: Callable[[HistoryRow], str]
) -> dict[tuple[str, str], list[HistoryRow]]:
    grouped: dict[tuple[str, str], list[HistoryRow]] = defaultdict(list)
    for row in rows:
        grouped[(entity_id_of(row), history_date(row.get("local_date")))].append(row)
    return dict(grouped)


def put_history_entity_metric[Metric](
    target: dict[str, dict[str, Metric]],
    entity_id: str,
    local_date: str,
    value: Metric,
) -> None:
    target.setdefault(entity_id, {})[local_date] = value


def put_history_entity_timestamps(
    target: dict[str, dict[str, list[str]]],
    entity_id: str,
    local_date: str,
    rows: Iterable[HistoryRow],
) -> None:
    target.setdefault(entity_id, {})[local_date] = [history_row_timestamp(row) for row in rows]


def clean_history_entity_ids(
    values: Iterable[object], *, excluded: Iterable[str] = ()
) -> tuple[str, ...]:
    excluded_ids = set(excluded)
    valid_ids = {
        value for value in values if isinstance(value, str) and value and value not in excluded_ids
    }
    return tuple(sorted(valid_ids))


@dataclass(frozen=True)
class HistoryEntityMetricPlan:
    entity_id: str
    metrics: tuple[dict[str, Any], ...]
    timestamps: tuple[dict[str, list[str]], ...]
    available_dates: tuple[str, ...]

    def iter_partition_items[Day, Partition: BaseModel](
        self,
        *,
        family: str,
        metric_names: Sequence[str],
        day_model: Callable[..., Day],
        partition_model: Callable[..., Partition],
    ) -> Iterator[tuple[HistoricPartitionRef, Partition]]:
        if len(metric_names) != len(self.metrics):
            raise ValueError("history metric names and sources must have equal lengths")
        metric_sources = tuple(zip(metric_names, self.metrics, strict=True))
        path_prefix = f"historic/history/{family}/{encode_history_entity_id(self.entity_id)}"
        for month, dates in iter_history_month_groups(self.available_dates):
            yield history_month_partition_ref(
                lambda local_date: day_model(
                    date=local_date,
                    **{name: source.get(local_date) for name, source in metric_sources},
                ),
                lambda generated_utc, partition_month, days: partition_model(
                    generated_utc=generated_utc,
                    methodology_version="history-1",
                    entity_id=self.entity_id,
                    month=partition_month,
                    days=days,
                ),
                lambda digest, partition_month: (
                    f"{path_prefix}/generations/{digest}/{partition_month}.json"
                ),
                month=month,
                dates=dates,
                source_timestamps=self.timestamps,
            )


def build_history_entity_metric_plans(
    *,
    entity_ids: Iterable[str],
    metric_sources: Sequence[Mapping[str, dict[str, Any]]],
    timestamp_sources: Sequence[Mapping[str, dict[str, list[str]]]],
) -> list[HistoryEntityMetricPlan]:
    if len(metric_sources) != len(timestamp_sources):
        raise ValueError("history metric and timestamp sources must have equal lengths")
    plans: list[HistoryEntityMetricPlan] = []
    for entity_id in sorted(set(entity_ids)):
        metrics = tuple(source.get(entity_id, {}) for source in metric_sources)
        available_dates = tuple(sorted({value for source in metrics for value in source}))
        if not available_dates:
            continue
        timestamps = tuple(source.get(entity_id, {}) for source in timestamp_sources)
        plans.append(HistoryEntityMetricPlan(entity_id, metrics, timestamps, available_dates))
    return plans


def iter_history_month_groups(dates: Iterable[str]):  # type: ignore[no-untyped-def]
    ordered = tuple(sorted(history_date(value, field="date") for value in dates))
    for month in sorted({history_month(value) for value in ordered}):
        yield month, tuple(value for value in ordered if history_month(value) == month)


def history_month_partition_ref[Day, Partition: BaseModel](
    day_builder: Callable[[str], Day],
    partition_builder: Callable[[str, str, list[Day]], Partition],
    path_builder: Callable[[str, str], str],
    *,
    month: str,
    dates: Sequence[str],
    source_timestamps: Sequence[Mapping[str, list[str]]],
) -> tuple[HistoricPartitionRef, Partition]:
    partition = partition_builder(
        latest_history_timestamp(
            timestamp
            for local_date in dates
            for source in source_timestamps
            for timestamp in source.get(local_date, [])
        ),
        month,
        [day_builder(local_date) for local_date in dates],
    )
    ref = _history_partition_ref(partition, lambda digest: path_builder(digest, month))
    return ref, partition


def prepare_history_row_batch_loader(
    sources: Sequence[Sequence[HistoryRow]], *, entity_field: str
) -> HistoryBatchLoader:
    def load(batch: list[str]) -> HistoryMetricRows:
        allowed = set(batch)
        return tuple(
            [row for row in source if row.get(entity_field) in allowed] for source in sources
        )

    return load


def prepare_history_sql_batch_loader(
    conn: Any,
    queries: Sequence[Any],
    *,
    base_params: Mapping[str, Any],
    source_scopes: HistorySourceScopes | None = None,
    entity_field: str | None = None,
    phase_context: HistoryPhaseContext | None = None,
) -> HistoryBatchLoader:
    def load(batch: list[str]) -> HistoryMetricRows:
        params = {**base_params, "entity_ids": batch}
        with history_phase(phase_context, "source_digest"):
            sources = tuple(
                consume_history_source_rows(
                    conn.execute(query, params).mappings(), entity_field=entity_field,
                )
                for query in queries
            )
            if source_scopes is not None:
                for index, rows in enumerate(sources):
                    source_scopes.observe_rows(rows, source=index, entity_field=entity_field)
            return sources

    return load


def history_gaps(dates: Iterable[str]) -> list[HistoricCoverageGap]:

    ordered = sorted({history_date(value, field="date") for value in dates})
    gaps: list[HistoricCoverageGap] = []
    for previous, current in zip(ordered, ordered[1:], strict=False):
        start = date.fromisoformat(previous) + timedelta(days=1)
        end = date.fromisoformat(current) - timedelta(days=1)
        if start <= end:
            gaps.append(HistoricCoverageGap(start_date=start.isoformat(), end_date=end.isoformat()))
    return gaps


def history_coverage(
    dates: Iterable[str],
) -> tuple[str | None, str | None, list[HistoricCoverageGap]]:

    ordered = sorted({history_date(value, field="date") for value in dates})
    if not ordered:
        return (None, None, [])
    return (ordered[0], ordered[-1], history_gaps(ordered))


def history_metric_coverage(
    metric: HistoryMetricName | str,
    aggregation: HistoryMetricAggregation | str,
    dates: Iterable[str],
) -> HistoricMetricCoverage:

    first, last, gaps = history_coverage(dates)
    return HistoricMetricCoverage(
        metric=metric,
        aggregation=aggregation,
        first_available_date=first,
        last_available_date=last,
        gaps=gaps,
    )


def history_partition_ref(path: str, partition: BaseModel) -> HistoricPartitionRef:

    return _history_partition_ref(partition, lambda _digest: path)


def _history_partition_ref(
    partition: BaseModel, path_builder: Callable[[str], str]
) -> HistoricPartitionRef:
    days = getattr(partition, "days", None)
    if not isinstance(days, list) or not days:
        raise ValueError("history partition ref requires a nonempty days list")
    body = snapshot_json_bytes(partition)
    digest = hashlib.sha256(body).hexdigest()
    return HistoricPartitionRef(
        path=path_builder(digest),
        coverage_start=days[0].date,
        coverage_end=days[-1].date,
        count=len(days),
        sha256=digest,
        byte_size=len(body),
    )


_POINT_HISTORY_MODELS = {
    "hotspots": HistoricHotspotsDay,
    "repeat_offenders": HistoricRepeatOffendersDay,
}


def history_point_ref(family: str, payload: BaseModel) -> HistoricPartitionRef:

    model = _POINT_HISTORY_MODELS.get(family)
    if model is None:
        raise ValueError(f"unsupported point history family {family!r}")
    if not isinstance(payload, model):
        raise ValueError(f"point history payload does not match family {family!r}")
    local_date = history_date(getattr(payload, "date", None), field="date")
    if getattr(payload, "methodology_version", None) not in {"reliability-1", "reliability-2"}:
        raise ValueError("unsupported point history payload methodology")
    if getattr(payload, "publish_generation_id", None) is not None:
        raise ValueError("point history payloads cannot carry a publish generation")
    body = snapshot_json_bytes(payload)
    digest = hashlib.sha256(body).hexdigest()
    return HistoricPartitionRef(
        path=f"historic/history/{family}/generations/{digest}/{local_date}.json",
        coverage_start=local_date,
        coverage_end=local_date,
        count=1,
        sha256=digest,
        byte_size=len(body),
    )


@dataclass
class PointHistorySummary:
    """Compact exact-ref truth retained while point-day payloads stream away."""

    family: str
    refs: list[HistoricPartitionRef] = field(default_factory=list)
    generated_utc: str | None = None

    def __post_init__(self) -> None:
        if self.family not in _POINT_HISTORY_MODELS:
            raise ValueError(f"unsupported point history family {self.family!r}")

    def observe(self, payload: BaseModel) -> HistoricPartitionRef:
        ref = history_point_ref(self.family, payload)
        local_date = ref.coverage_start
        if self.refs and local_date <= self.refs[-1].coverage_start:
            problem = "duplicate" if local_date == self.refs[-1].coverage_start else "ordered"
            raise ValueError(f"point history dates must be unique and ordered ({problem})")
        self.refs.append(ref)
        self.generated_utc = latest_history_timestamp(
            candidate
            for candidate in (self.generated_utc, getattr(payload, "generated_utc", None))
            if candidate is not None
        )
        return ref

    @property
    def available_dates(self) -> list[str]:
        return [ref.coverage_start for ref in self.refs]

    def build_index(self, *, fallback_generated_utc: str) -> HistoricCollectionIndex:
        first, last, gaps = history_coverage(self.available_dates)
        index = HistoricCollectionIndex(
            generated_utc=latest_history_timestamp(
                (() if self.generated_utc is None else (self.generated_utc,)),
                fallback=fallback_generated_utc,
            ),
            methodology_version="history-1",
            publish_generation_id=None,
            family=self.family,
            selection_mode="date",
            first_available_date=first,
            last_available_date=last,
            available_dates=self.available_dates,
            gaps=gaps,
            partitions=[ref.model_copy(deep=True) for ref in self.refs],
            metrics=[],
        )
        index.collection_generation_id = history_index_generation_id(index)
        return index


def encode_history_entity_id(entity_id: str) -> str:

    if not entity_id:
        raise ValueError("history entity ID cannot be empty")
    return entity_id.encode("utf-8").hex()


def decode_history_entity_id(encoded_id: str) -> str:

    if _CANONICAL_ENTITY_ID.fullmatch(encoded_id) is None:
        raise ValueError("encoded history entity ID must be non-empty lowercase UTF-8 hex")
    try:
        return bytes.fromhex(encoded_id).decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("encoded history entity ID is not valid UTF-8") from exc
