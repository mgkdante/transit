"""Full-retention per-Stop daily metrics partitioned by entity and local month."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, TypeVar

from transit_ops.settings import get_settings
from transit_ops.snapshots.builders.historic.history_common import (
    HistoryDateMask,
    encode_history_entity_id,
    history_coverage,
    history_date,
    history_entity_directory_generation_id,
    history_index_generation_id,
    history_metric_coverage,
    history_month,
    history_partition_ref,
    history_row_int,
    history_row_timestamp,
    history_utc_timestamp,
    latest_history_timestamp,
)
from transit_ops.snapshots.contract import (
    HistoricCollectionIndex,
    HistoricDelayMetric,
    HistoricDelayPercentiles,
    HistoricEntityDirectoryIndex,
    HistoricEntityIndexRef,
    HistoricFamilyAvailability,
    HistoricOccupancyMetric,
    HistoricPartitionRef,
    StopHistoryDay,
    StopHistoryPartition,
)
from transit_ops.snapshots.serialization import snapshot_sha256
from transit_ops.sql_registry import named_query

if TYPE_CHECKING:  # pragma: no cover
    from sqlalchemy.engine import Connection


STOP_HISTORY_ENTITY_BATCH_SIZE = 100
STOP_HISTORY_METRICS = (
    ("delay", "additive"),
    ("delay_percentiles", "daily_only"),
    ("occupancy", "additive"),
)

_STOP_HISTORY_IDS_SQL = named_query(
    "history.stops.ids",
    """
    WITH retained_ids AS (
        SELECT spine.stop_id
        FROM gold.stop_delay_spine AS spine
        JOIN gold.dim_provider AS dp ON dp.provider_id = spine.provider_id
        WHERE spine.provider_id = :provider_id
          AND spine.provider_local_date >= timezone(dp.timezone, now())::date - :warm_retention_days
          AND spine.provider_local_date < timezone(dp.timezone, now())::date
        UNION
        SELECT pct.stop_id
        FROM gold.stop_delay_percentile_daily AS pct
        JOIN gold.dim_provider AS dp ON dp.provider_id = pct.provider_id
        WHERE pct.provider_id = :provider_id
          AND pct.provider_local_date >= timezone(dp.timezone, now())::date - :warm_retention_days
          AND pct.provider_local_date < timezone(dp.timezone, now())::date
        UNION
        SELECT occ.stop_id
        FROM gold.stop_occupancy_band_daily AS occ
        JOIN gold.dim_provider AS dp ON dp.provider_id = occ.provider_id
        WHERE occ.provider_id = :provider_id
          AND occ.provider_local_date >= timezone(dp.timezone, now())::date - :warm_retention_days
          AND occ.provider_local_date < timezone(dp.timezone, now())::date
    )
    SELECT stop_id
    FROM retained_ids
    WHERE stop_id IS NOT NULL AND stop_id <> ''
    ORDER BY stop_id
    """,
)

_STOP_HISTORY_DELAY_SQL = named_query(
    "history.stops.delay",
    """
    SELECT spine.stop_id,
           spine.provider_local_date AS local_date,
           SUM(spine.observation_count) AS observation_count,
           SUM(spine.severe_delay_count) AS severe_count,
           SUM(spine.sum_delay_seconds) AS sum_delay_seconds,
           MAX(spine.built_at_utc) FILTER (WHERE spine.observation_count > 0)
               AS source_generated_utc
    FROM gold.stop_delay_spine AS spine
    JOIN gold.dim_provider AS dp ON dp.provider_id = spine.provider_id
    WHERE spine.provider_id = :provider_id
      AND spine.stop_id = ANY(:entity_ids)
      AND spine.provider_local_date >= timezone(dp.timezone, now())::date - :warm_retention_days
      AND spine.provider_local_date < timezone(dp.timezone, now())::date
    GROUP BY spine.stop_id, spine.provider_local_date
    ORDER BY spine.stop_id, spine.provider_local_date
    """,
)

_STOP_HISTORY_PERCENTILES_SQL = named_query(
    "history.stops.percentiles",
    """
    SELECT pct.stop_id,
           pct.provider_local_date AS local_date,
           pct.delay_observation_count AS observation_count,
           pct.p50_delay_seconds,
           pct.p90_delay_seconds,
           pct.built_at_utc AS source_generated_utc
    FROM gold.stop_delay_percentile_daily AS pct
    JOIN gold.dim_provider AS dp ON dp.provider_id = pct.provider_id
    WHERE pct.provider_id = :provider_id
      AND pct.stop_id = ANY(:entity_ids)
      AND pct.provider_local_date >= timezone(dp.timezone, now())::date - :warm_retention_days
      AND pct.provider_local_date < timezone(dp.timezone, now())::date
    ORDER BY pct.stop_id, pct.provider_local_date
    """,
)

_STOP_HISTORY_OCCUPANCY_SQL = named_query(
    "history.stops.occupancy",
    """
    SELECT occ.stop_id,
           occ.provider_local_date AS local_date,
           SUM(occ.observation_count) AS observation_count,
           SUM(occ.empty_count) AS empty,
           SUM(occ.many_seats_count) AS many_seats,
           SUM(occ.few_seats_count) AS few_seats,
           SUM(occ.standing_count) AS standing,
           SUM(occ.full_count) AS full,
           MAX(occ.built_at_utc) FILTER (WHERE occ.observation_count > 0)
               AS source_generated_utc
    FROM gold.stop_occupancy_band_daily AS occ
    JOIN gold.dim_provider AS dp ON dp.provider_id = occ.provider_id
    WHERE occ.provider_id = :provider_id
      AND occ.stop_id = ANY(:entity_ids)
      AND occ.provider_local_date >= timezone(dp.timezone, now())::date - :warm_retention_days
      AND occ.provider_local_date < timezone(dp.timezone, now())::date
    GROUP BY occ.stop_id, occ.provider_local_date
    ORDER BY occ.stop_id, occ.provider_local_date
    """,
)


MetricRows = tuple[list[Mapping[str, Any]], ...]
MetricType = TypeVar("MetricType")


def _entity_id(row: Mapping[str, Any]) -> str:
    value = row.get("stop_id")
    if not isinstance(value, str) or not value:
        raise ValueError("Stop history stop_id must be nonempty")
    return value


def _group_rows(
    rows: Iterable[Mapping[str, Any]],
) -> dict[tuple[str, str], list[Mapping[str, Any]]]:
    grouped: dict[tuple[str, str], list[Mapping[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[(_entity_id(row), history_date(row.get("local_date")))].append(row)
    return dict(grouped)


def _float_value(row: Mapping[str, Any], field_name: str) -> float | None:
    value = row.get(field_name)
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(f"history row {field_name} must be numeric")
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"history row {field_name} must be numeric") from exc


def _put_metric(
    target: dict[str, dict[str, MetricType]],
    entity_id: str,
    local_date: str,
    value: MetricType,
) -> None:
    target.setdefault(entity_id, {})[local_date] = value


def _put_timestamps(
    target: dict[str, dict[str, list[str]]],
    entity_id: str,
    local_date: str,
    rows: Iterable[Mapping[str, Any]],
) -> None:
    target.setdefault(entity_id, {})[local_date] = [history_row_timestamp(row) for row in rows]


def _delay_metrics(
    rows: Iterable[Mapping[str, Any]],
) -> tuple[dict[str, dict[str, HistoricDelayMetric]], dict[str, dict[str, list[str]]]]:
    metrics: dict[str, dict[str, HistoricDelayMetric]] = {}
    timestamps: dict[str, dict[str, list[str]]] = {}
    for (entity_id, local_date), grouped in _group_rows(rows).items():
        observation_count = sum(history_row_int(row, "observation_count") or 0 for row in grouped)
        if observation_count <= 0:
            continue
        severe_count = sum(history_row_int(row, "severe_count") or 0 for row in grouped)
        delay_sum = sum(
            history_row_int(row, "sum_delay_seconds", minimum=None) or 0 for row in grouped
        )
        _put_metric(
            metrics,
            entity_id,
            local_date,
            HistoricDelayMetric(
                observation_count=observation_count,
                in_clamp_observation_count=observation_count,
                severe_count=severe_count,
                sum_delay_seconds=delay_sum,
            ),
        )
        _put_timestamps(
            timestamps,
            entity_id,
            local_date,
            (row for row in grouped if (history_row_int(row, "observation_count") or 0) > 0),
        )
    return metrics, timestamps


def _percentile_metrics(
    rows: Iterable[Mapping[str, Any]],
) -> tuple[
    dict[str, dict[str, HistoricDelayPercentiles]],
    dict[str, dict[str, list[str]]],
]:
    metrics: dict[str, dict[str, HistoricDelayPercentiles]] = {}
    timestamps: dict[str, dict[str, list[str]]] = {}
    for (entity_id, local_date), grouped in _group_rows(rows).items():
        if len(grouped) != 1:
            raise ValueError(f"duplicate Stop percentile day {entity_id}/{local_date}")
        row = grouped[0]
        observation_count = history_row_int(row, "observation_count") or 0
        if observation_count <= 0:
            raise ValueError("Stop percentile observation_count must be positive")
        _put_metric(
            metrics,
            entity_id,
            local_date,
            HistoricDelayPercentiles(
                observation_count=observation_count,
                p50_delay_seconds=_float_value(row, "p50_delay_seconds"),
                p90_delay_seconds=_float_value(row, "p90_delay_seconds"),
            ),
        )
        _put_timestamps(timestamps, entity_id, local_date, grouped)
    return metrics, timestamps


def _occupancy_metrics(
    rows: Iterable[Mapping[str, Any]],
) -> tuple[
    dict[str, dict[str, HistoricOccupancyMetric]],
    dict[str, dict[str, list[str]]],
]:
    metrics: dict[str, dict[str, HistoricOccupancyMetric]] = {}
    timestamps: dict[str, dict[str, list[str]]] = {}
    bands = ("empty", "many_seats", "few_seats", "standing", "full")
    for (entity_id, local_date), grouped in _group_rows(rows).items():
        observation_count = sum(history_row_int(row, "observation_count") or 0 for row in grouped)
        counts = {band: sum(history_row_int(row, band) or 0 for row in grouped) for band in bands}
        if observation_count != sum(counts.values()):
            raise ValueError("Stop occupancy observation_count must equal the sum of bands")
        if observation_count <= 0:
            continue
        _put_metric(metrics, entity_id, local_date, HistoricOccupancyMetric(**counts))
        _put_timestamps(
            timestamps,
            entity_id,
            local_date,
            (row for row in grouped if (history_row_int(row, "observation_count") or 0) > 0),
        )
    return metrics, timestamps


@dataclass(frozen=True)
class _StopEntityPlan:
    entity_id: str
    metrics: tuple[dict[str, Any], ...]
    timestamps: tuple[dict[str, list[str]], ...]
    available_dates: tuple[str, ...]

    def iter_partition_items(self) -> Iterator[tuple[HistoricPartitionRef, StopHistoryPartition]]:
        encoded_id = encode_history_entity_id(self.entity_id)
        for month in sorted({history_month(value) for value in self.available_dates}):
            dates = [value for value in self.available_dates if history_month(value) == month]
            days = [
                StopHistoryDay(
                    date=local_date,
                    delay=self.metrics[0].get(local_date),
                    delay_percentiles=self.metrics[1].get(local_date),
                    occupancy=self.metrics[2].get(local_date),
                )
                for local_date in dates
            ]
            partition = StopHistoryPartition(
                generated_utc=latest_history_timestamp(
                    timestamp
                    for local_date in dates
                    for source in self.timestamps
                    for timestamp in source.get(local_date, [])
                ),
                methodology_version="history-1",
                entity_id=self.entity_id,
                month=month,
                days=days,
            )
            digest = snapshot_sha256(partition)
            path = f"historic/history/stops/{encoded_id}/generations/{digest}/{month}.json"
            yield history_partition_ref(path, partition), partition


def _entity_plans_from_rows(
    *,
    entity_ids: Sequence[str],
    delay_rows: Iterable[Mapping[str, Any]],
    percentile_rows: Iterable[Mapping[str, Any]],
    occupancy_rows: Iterable[Mapping[str, Any]],
) -> list[_StopEntityPlan]:
    delay, delay_ts = _delay_metrics(delay_rows)
    percentiles, percentile_ts = _percentile_metrics(percentile_rows)
    occupancy, occupancy_ts = _occupancy_metrics(occupancy_rows)
    metric_sources = (delay, percentiles, occupancy)
    timestamp_sources = (delay_ts, percentile_ts, occupancy_ts)
    plans: list[_StopEntityPlan] = []
    for entity_id in sorted(set(entity_ids)):
        entity_metrics = tuple(source.get(entity_id, {}) for source in metric_sources)
        dates = tuple(sorted({date for source in entity_metrics for date in source}))
        if dates:
            plans.append(
                _StopEntityPlan(
                    entity_id=entity_id,
                    metrics=entity_metrics,
                    timestamps=tuple(source.get(entity_id, {}) for source in timestamp_sources),
                    available_dates=dates,
                )
            )
    return plans


@dataclass
class _StopEntityStream:
    refs: list[HistoricPartitionRef] = field(default_factory=list)
    available_dates: HistoryDateMask = field(default_factory=HistoryDateMask)
    metric_dates: dict[str, HistoryDateMask] = field(
        default_factory=lambda: {
            metric: HistoryDateMask() for metric, _aggregation in STOP_HISTORY_METRICS
        }
    )
    generated_utc: str | None = None


@dataclass
class StopHistoryPointerSummary:
    """Directory edges and family-wide coverage without retaining child indexes."""

    entities: list[HistoricEntityIndexRef] = field(default_factory=list)
    available_dates: HistoryDateMask = field(default_factory=HistoryDateMask)
    metric_dates: dict[str, HistoryDateMask] = field(
        default_factory=lambda: {
            metric: HistoryDateMask() for metric, _aggregation in STOP_HISTORY_METRICS
        }
    )
    generated_utc: str | None = None

    def observe(
        self,
        index: HistoricCollectionIndex,
        *,
        index_path: str | None = None,
    ) -> None:
        entity_id = index.entity_id
        if not entity_id:
            return
        encoded_id = encode_history_entity_id(entity_id)
        self.entities.append(
            HistoricEntityIndexRef(
                entity_id=entity_id,
                encoded_id=encoded_id,
                index_path=index_path or f"historic/history/stops/{encoded_id}/index.json",
                collection_generation_id=index.collection_generation_id or "",
                first_available_date=index.first_available_date,
                last_available_date=index.last_available_date,
            )
        )
        valid_dates: list[str] = []
        for local_date in index.available_dates:
            if not isinstance(local_date, str):
                continue
            try:
                self.available_dates.add(local_date)
            except ValueError:
                continue
            valid_dates.append(local_date)
        coverages = {coverage.metric.value: coverage for coverage in index.metrics}
        for metric, mask in self.metric_dates.items():
            coverage = coverages.get(metric)
            if coverage is None:
                continue
            mask.update(
                local_date
                for local_date in valid_dates
                if coverage.first_available_date is not None
                and coverage.last_available_date is not None
                and coverage.first_available_date <= local_date <= coverage.last_available_date
                and not any(gap.start_date <= local_date <= gap.end_date for gap in coverage.gaps)
            )
        self.generated_utc = latest_history_timestamp(
            value for value in (self.generated_utc, index.generated_utc) if value is not None
        )

    def build_directory(self, *, fallback_generated_utc: str) -> HistoricEntityDirectoryIndex:
        first, last, _gaps = history_coverage(self.available_dates)
        directory = HistoricEntityDirectoryIndex(
            generated_utc=latest_history_timestamp(
                (() if self.generated_utc is None else (self.generated_utc,)),
                fallback=fallback_generated_utc,
            ),
            methodology_version="history-1",
            family="stops",
            selection_mode="range",
            collection_generation_id="pending",
            first_available_date=first,
            last_available_date=last,
            entities=sorted(self.entities, key=lambda item: item.entity_id),
        )
        directory.collection_generation_id = history_entity_directory_generation_id(directory)
        return directory

    def build_family(
        self,
        directory: HistoricEntityDirectoryIndex,
        *,
        index_path: str = "historic/history/stops/index.json",
    ) -> HistoricFamilyAvailability:
        first, last, gaps = history_coverage(self.available_dates)
        return HistoricFamilyAvailability(
            family="stops",
            selection_mode="range",
            index_path=index_path,
            collection_generation_id=directory.collection_generation_id,
            first_available_date=first,
            last_available_date=last,
            gaps=gaps,
            metrics=[
                history_metric_coverage(metric, aggregation, self.metric_dates[metric])
                for metric, aggregation in STOP_HISTORY_METRICS
            ],
        )


@dataclass
class StopHistoryStreamSummary:
    """Compact streamed Stop truth used to reconstruct one index at a time."""

    entities: dict[str, _StopEntityStream] = field(default_factory=dict)

    def observe(self, ref: object, partition: object) -> None:
        if isinstance(partition, StopHistoryPartition):
            value = partition.model_dump(mode="python")
        elif isinstance(partition, Mapping):
            value = dict(partition)
        else:
            return
        entity_id = value.get("entity_id")
        if not isinstance(entity_id, str) or not entity_id:
            return
        summary = self.entities.setdefault(entity_id, _StopEntityStream())
        try:
            retained_ref = (
                ref.model_copy(deep=True)
                if isinstance(ref, HistoricPartitionRef)
                else HistoricPartitionRef.model_validate(ref)
            )
        except (TypeError, ValueError):
            retained_ref = None
        if retained_ref is not None:
            summary.refs.append(retained_ref)
        generated_utc = value.get("generated_utc")
        if isinstance(generated_utc, str):
            try:
                summary.generated_utc = latest_history_timestamp(
                    candidate
                    for candidate in (summary.generated_utc, generated_utc)
                    if candidate is not None
                )
            except ValueError:
                pass
        days = value.get("days") if isinstance(value.get("days"), list) else []
        for day in days:
            if not isinstance(day, Mapping):
                continue
            local_date = day.get("date")
            try:
                summary.available_dates.add(local_date)
            except ValueError:
                continue
            for metric, dates in summary.metric_dates.items():
                if day.get(metric) is not None:
                    dates.add(local_date)

    def iter_indexes(
        self,
        *,
        fallback_generated_utc: str,
    ) -> Iterator[HistoricCollectionIndex]:
        for entity_id in sorted(self.entities):
            summary = self.entities[entity_id]
            dates = list(summary.available_dates)
            if not dates:
                continue
            first, last, gaps = history_coverage(summary.available_dates)
            index = HistoricCollectionIndex(
                generated_utc=latest_history_timestamp(
                    (() if summary.generated_utc is None else (summary.generated_utc,)),
                    fallback=fallback_generated_utc,
                ),
                methodology_version="history-1",
                family="stops",
                selection_mode="range",
                entity_id=entity_id,
                first_available_date=first,
                last_available_date=last,
                available_dates=dates,
                gaps=gaps,
                partitions=[ref.model_copy(deep=True) for ref in summary.refs],
                metrics=[
                    history_metric_coverage(
                        metric,
                        aggregation,
                        summary.metric_dates[metric],
                    )
                    for metric, aggregation in STOP_HISTORY_METRICS
                ],
            )
            index.collection_generation_id = history_index_generation_id(index)
            yield index

    def build_indexes(self, *, fallback_generated_utc: str) -> list[HistoricCollectionIndex]:
        """Compatibility materializer; publisher and validator must use ``iter_indexes``."""

        return list(self.iter_indexes(fallback_generated_utc=fallback_generated_utc))

    def build_directory(
        self,
        indexes: Sequence[HistoricCollectionIndex],
        *,
        fallback_generated_utc: str,
    ) -> HistoricEntityDirectoryIndex:
        summary = StopHistoryPointerSummary()
        for index in indexes:
            summary.observe(index)
        return summary.build_directory(fallback_generated_utc=fallback_generated_utc)


@dataclass(frozen=True)
class StopHistoryBundle:
    partitions: list[StopHistoryPartition]
    indexes: list[HistoricCollectionIndex]
    directory: HistoricEntityDirectoryIndex

    @property
    def partition_items(self) -> list[tuple[str, StopHistoryPartition]]:
        refs = [ref for index in self.indexes for ref in index.partitions]
        return [(ref.path, partition) for ref, partition in zip(refs, self.partitions, strict=True)]


@dataclass(frozen=True)
class StopHistoryPlan:
    entity_ids: tuple[str, ...]
    generated_utc: str
    entity_batch_size: int
    batch_loader: Callable[[list[str]], MetricRows]

    def iter_partition_items(self) -> Iterator[tuple[HistoricPartitionRef, StopHistoryPartition]]:
        for start in range(0, len(self.entity_ids), self.entity_batch_size):
            batch = list(self.entity_ids[start : start + self.entity_batch_size])
            rows = self.batch_loader(batch)
            for entity_plan in _entity_plans_from_rows(
                entity_ids=batch,
                delay_rows=rows[0],
                percentile_rows=rows[1],
                occupancy_rows=rows[2],
            ):
                yield from entity_plan.iter_partition_items()

    def materialize(self) -> StopHistoryBundle:
        summary = StopHistoryStreamSummary()
        partitions: list[StopHistoryPartition] = []
        for ref, partition in self.iter_partition_items():
            summary.observe(ref, partition)
            partitions.append(partition)
        indexes = summary.build_indexes(fallback_generated_utc=self.generated_utc)
        return StopHistoryBundle(
            partitions=partitions,
            indexes=indexes,
            directory=summary.build_directory(
                indexes,
                fallback_generated_utc=self.generated_utc,
            ),
        )


def _clean_entity_ids(values: Iterable[object]) -> tuple[str, ...]:
    return tuple(sorted({value for value in values if isinstance(value, str) and value}))


def build_stop_history_plan_from_rows(
    *,
    delay_rows: Iterable[Mapping[str, Any]],
    percentile_rows: Iterable[Mapping[str, Any]],
    occupancy_rows: Iterable[Mapping[str, Any]],
    generated_utc: str,
    entity_ids: Iterable[str] | None = None,
    entity_batch_size: int = STOP_HISTORY_ENTITY_BATCH_SIZE,
) -> StopHistoryPlan:
    if entity_batch_size <= 0:
        raise ValueError("Stop history entity_batch_size must be positive")
    sources = tuple(tuple(rows) for rows in (delay_rows, percentile_rows, occupancy_rows))
    discovered = _clean_entity_ids(
        [*(entity_ids or []), *(row.get("stop_id") for source in sources for row in source)]
    )

    def load(batch: list[str]) -> MetricRows:
        allowed = set(batch)
        return tuple([row for row in source if row.get("stop_id") in allowed] for source in sources)

    return StopHistoryPlan(
        entity_ids=discovered,
        generated_utc=history_utc_timestamp(generated_utc, field="generated_utc"),
        entity_batch_size=entity_batch_size,
        batch_loader=load,
    )


def build_stop_history_from_rows(**kwargs: Any) -> StopHistoryBundle:
    return build_stop_history_plan_from_rows(**kwargs).materialize()


def build_stop_history_plan(
    conn: Connection,
    *,
    provider_id: str = "stm",
    generated_utc: str,
    entity_batch_size: int = STOP_HISTORY_ENTITY_BATCH_SIZE,
) -> StopHistoryPlan:
    if entity_batch_size <= 0:
        raise ValueError("Stop history entity_batch_size must be positive")
    settings = get_settings()
    base_params = {
        "provider_id": provider_id,
        "warm_retention_days": settings.GOLD_WARM_ROLLUP_RETENTION_DAYS,
    }
    id_rows = conn.execute(_STOP_HISTORY_IDS_SQL, base_params).mappings()
    entity_ids = _clean_entity_ids(row.get("stop_id") for row in id_rows)
    queries = (
        _STOP_HISTORY_DELAY_SQL,
        _STOP_HISTORY_PERCENTILES_SQL,
        _STOP_HISTORY_OCCUPANCY_SQL,
    )

    def load(batch: list[str]) -> MetricRows:
        params = {**base_params, "entity_ids": batch}
        return tuple(list(conn.execute(query, params).mappings()) for query in queries)

    return StopHistoryPlan(
        entity_ids=entity_ids,
        generated_utc=history_utc_timestamp(generated_utc, field="generated_utc"),
        entity_batch_size=entity_batch_size,
        batch_loader=load,
    )


def build_stop_history(
    conn: Connection,
    *,
    provider_id: str = "stm",
    generated_utc: str,
    entity_batch_size: int = STOP_HISTORY_ENTITY_BATCH_SIZE,
) -> StopHistoryBundle:
    return build_stop_history_plan(
        conn,
        provider_id=provider_id,
        generated_utc=generated_utc,
        entity_batch_size=entity_batch_size,
    ).materialize()


__all__ = [
    "STOP_HISTORY_ENTITY_BATCH_SIZE",
    "STOP_HISTORY_METRICS",
    "StopHistoryBundle",
    "StopHistoryPlan",
    "StopHistoryPointerSummary",
    "StopHistoryStreamSummary",
    "build_stop_history",
    "build_stop_history_from_rows",
    "build_stop_history_plan",
    "build_stop_history_plan_from_rows",
]
