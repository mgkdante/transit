"""Full-retention per-Line daily metrics partitioned by entity and local month."""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from transit_ops.settings import get_settings
from transit_ops.snapshots.builders.historic.history_common import (
    HistoryBatchLoader,
    HistoryEntityMetricPlan,
    HistoryMetricRows,
    build_history_entity_metric_plans,
    clean_history_entity_ids,
    encode_history_entity_id,
    group_history_entity_date_rows,
    history_coverage,
    history_entity_directory_generation_id,
    history_index_generation_id,
    history_metric_coverage,
    history_optional_sum,
    history_row_float,
    history_row_int,
    history_utc_timestamp,
    latest_history_timestamp,
    prepare_history_row_batch_loader,
    prepare_history_sql_batch_loader,
    put_history_entity_metric,
    put_history_entity_timestamps,
)
from transit_ops.snapshots.contract import (
    HistoricCancellationMetric,
    HistoricCollectionIndex,
    HistoricDelayMetric,
    HistoricDelayPercentiles,
    HistoricEntityDirectoryIndex,
    HistoricEntityIndexRef,
    HistoricOccupancyMetric,
    HistoricPartitionRef,
    HistoricServiceSpanMetric,
    HistoricSkippedStopMetric,
    LineHistoryDay,
    LineHistoryPartition,
)
from transit_ops.sql_registry import named_query

if TYPE_CHECKING:  # pragma: no cover - typing only
    from sqlalchemy.engine import Connection

_group_rows = group_history_entity_date_rows


LINE_HISTORY_ENTITY_BATCH_SIZE = 25
LINE_HISTORY_METRICS = (
    ("delay", "additive"),
    ("delay_percentiles", "daily_only"),
    ("cancellation", "additive"),
    ("occupancy", "additive"),
    ("service_span", "daily_only"),
    ("skipped_stops", "additive"),
)

_LINE_HISTORY_IDS_SQL = named_query(
    "history.lines.ids",
    """
    WITH retained_ids AS (
        SELECT sp.route_id
        FROM gold.route_delay_spine AS sp
        JOIN gold.dim_provider AS dp ON dp.provider_id = sp.provider_id
        WHERE sp.provider_id = :provider_id
          AND sp.provider_local_date >= timezone(dp.timezone, now())::date - :warm_retention_days
          AND sp.provider_local_date < timezone(dp.timezone, now())::date
        UNION
        SELECT pct.route_id
        FROM gold.route_delay_percentile_daily AS pct
        JOIN gold.dim_provider AS dp ON dp.provider_id = pct.provider_id
        WHERE pct.provider_id = :provider_id
          AND pct.provider_local_date >= timezone(dp.timezone, now())::date - :warm_retention_days
          AND pct.provider_local_date < timezone(dp.timezone, now())::date
        UNION
        SELECT can.route_id
        FROM gold.route_cancellation_daily AS can
        JOIN gold.dim_provider AS dp ON dp.provider_id = can.provider_id
        WHERE can.provider_id = :provider_id
          AND can.provider_local_date >= timezone(dp.timezone, now())::date - :warm_retention_days
          AND can.provider_local_date < timezone(dp.timezone, now())::date
        UNION
        SELECT occ.route_id
        FROM gold.route_occupancy_band_daily AS occ
        JOIN gold.dim_provider AS dp ON dp.provider_id = occ.provider_id
        WHERE occ.provider_id = :provider_id
          AND occ.provider_local_date >= timezone(dp.timezone, now())::date - :warm_retention_days
          AND occ.provider_local_date < timezone(dp.timezone, now())::date
        UNION
        SELECT span.route_id
        FROM gold.route_service_span_daily AS span
        JOIN gold.dim_provider AS dp ON dp.provider_id = span.provider_id
        WHERE span.provider_id = :provider_id
          AND span.provider_local_date >= timezone(dp.timezone, now())::date - :warm_retention_days
          AND span.provider_local_date < timezone(dp.timezone, now())::date
        UNION
        SELECT skip.route_id
        FROM gold.route_skipped_stop_daily AS skip
        JOIN gold.dim_provider AS dp ON dp.provider_id = skip.provider_id
        WHERE skip.provider_id = :provider_id
          AND skip.provider_local_date >= timezone(dp.timezone, now())::date - :warm_retention_days
          AND skip.provider_local_date < timezone(dp.timezone, now())::date
    )
    SELECT route_id
    FROM retained_ids
    WHERE route_id IS NOT NULL AND route_id <> '' AND route_id <> '__unrouted__'
    ORDER BY route_id
    """,
)

_LINE_HISTORY_DELAY_SQL = named_query(
    "history.lines.delay",
    """
    SELECT sp.route_id,
           sp.provider_local_date AS local_date,
           SUM(sp.delay_observation_count) AS observation_count,
           SUM(COALESCE((SELECT SUM(x)::bigint FROM unnest(sp.delay_histogram) AS x), 0))
               AS in_clamp_observation_count,
           SUM(sp.on_time_observation_count) AS on_time_count,
           SUM(sp.severe_delay_count) AS severe_count,
           SUM(sp.sum_delay_seconds) AS sum_delay_seconds,
           MAX(sp.built_at_utc) FILTER (WHERE sp.delay_observation_count > 0)
               AS source_generated_utc
    FROM gold.route_delay_spine AS sp
    JOIN gold.dim_provider AS dp ON dp.provider_id = sp.provider_id
    WHERE sp.provider_id = :provider_id
      AND sp.route_id = ANY(:entity_ids)
      AND sp.route_id <> '__unrouted__'
      AND sp.provider_local_date >= timezone(dp.timezone, now())::date - :warm_retention_days
      AND sp.provider_local_date < timezone(dp.timezone, now())::date
    GROUP BY sp.route_id, sp.provider_local_date
    ORDER BY sp.route_id, sp.provider_local_date
    """,
)

_LINE_HISTORY_PERCENTILES_SQL = named_query(
    "history.lines.percentiles",
    """
    SELECT pct.route_id,
           pct.provider_local_date AS local_date,
           pct.delay_observation_count AS observation_count,
           pct.p50_delay_seconds,
           pct.p90_delay_seconds,
           pct.built_at_utc AS source_generated_utc
    FROM gold.route_delay_percentile_daily AS pct
    JOIN gold.dim_provider AS dp ON dp.provider_id = pct.provider_id
    WHERE pct.provider_id = :provider_id
      AND pct.route_id = ANY(:entity_ids)
      AND pct.route_id <> '__unrouted__'
      AND pct.provider_local_date >= timezone(dp.timezone, now())::date - :warm_retention_days
      AND pct.provider_local_date < timezone(dp.timezone, now())::date
    ORDER BY pct.route_id, pct.provider_local_date
    """,
)

_LINE_HISTORY_CANCELLATION_SQL = named_query(
    "history.lines.cancellation",
    """
    SELECT can.route_id,
           can.provider_local_date AS local_date,
           SUM(can.canceled_trip_days) AS canceled_trip_days,
           SUM(can.total_trip_days) AS total_trip_days,
           SUM(can.scheduled_trip_days) AS scheduled_trip_days,
           SUM(can.delivered_trip_days) FILTER (WHERE can.scheduled_trip_days IS NOT NULL)
               AS delivered_trip_days,
           SUM(can.silent_trip_days) FILTER (WHERE can.scheduled_trip_days IS NOT NULL)
               AS silent_trip_days,
           MAX(can.built_at_utc) FILTER (
               WHERE can.total_trip_days > 0 OR can.scheduled_trip_days > 0
           ) AS source_generated_utc
    FROM gold.route_cancellation_daily AS can
    JOIN gold.dim_provider AS dp ON dp.provider_id = can.provider_id
    WHERE can.provider_id = :provider_id
      AND can.route_id = ANY(:entity_ids)
      AND can.route_id <> '__unrouted__'
      AND can.provider_local_date >= timezone(dp.timezone, now())::date - :warm_retention_days
      AND can.provider_local_date < timezone(dp.timezone, now())::date
    GROUP BY can.route_id, can.provider_local_date
    ORDER BY can.route_id, can.provider_local_date
    """,
)

_LINE_HISTORY_OCCUPANCY_SQL = named_query(
    "history.lines.occupancy",
    """
    SELECT occ.route_id,
           occ.provider_local_date AS local_date,
           SUM(occ.observation_count) AS observation_count,
           SUM(occ.empty_count) AS empty,
           SUM(occ.many_seats_count) AS many_seats,
           SUM(occ.few_seats_count) AS few_seats,
           SUM(occ.standing_count) AS standing,
           SUM(occ.full_count) AS full,
           MAX(occ.built_at_utc) FILTER (WHERE occ.observation_count > 0)
               AS source_generated_utc
    FROM gold.route_occupancy_band_daily AS occ
    JOIN gold.dim_provider AS dp ON dp.provider_id = occ.provider_id
    WHERE occ.provider_id = :provider_id
      AND occ.route_id = ANY(:entity_ids)
      AND occ.route_id <> '__unrouted__'
      AND occ.provider_local_date >= timezone(dp.timezone, now())::date - :warm_retention_days
      AND occ.provider_local_date < timezone(dp.timezone, now())::date
    GROUP BY occ.route_id, occ.provider_local_date
    ORDER BY occ.route_id, occ.provider_local_date
    """,
)

_LINE_HISTORY_SERVICE_SPAN_SQL = named_query(
    "history.lines.service_span",
    """
    SELECT span.route_id,
           span.provider_local_date AS local_date,
           span.trip_count,
           span.first_trip_start_utc,
           span.last_trip_start_utc,
           span.first_trip_delay_seconds,
           span.last_trip_delay_seconds,
           span.built_at_utc AS source_generated_utc
    FROM gold.route_service_span_daily AS span
    JOIN gold.dim_provider AS dp ON dp.provider_id = span.provider_id
    WHERE span.provider_id = :provider_id
      AND span.route_id = ANY(:entity_ids)
      AND span.route_id <> '__unrouted__'
      AND span.provider_local_date >= timezone(dp.timezone, now())::date - :warm_retention_days
      AND span.provider_local_date < timezone(dp.timezone, now())::date
    ORDER BY span.route_id, span.provider_local_date
    """,
)

_LINE_HISTORY_SKIPPED_STOPS_SQL = named_query(
    "history.lines.skipped_stops",
    """
    SELECT skip.route_id,
           skip.provider_local_date AS local_date,
           SUM(skip.skipped_stop_count) AS skipped_stop_count,
           SUM(skip.stop_time_update_count) AS stop_time_update_count,
           MAX(skip.built_at_utc) FILTER (WHERE skip.stop_time_update_count > 0)
               AS source_generated_utc
    FROM gold.route_skipped_stop_daily AS skip
    JOIN gold.dim_provider AS dp ON dp.provider_id = skip.provider_id
    WHERE skip.provider_id = :provider_id
      AND skip.route_id = ANY(:entity_ids)
      AND skip.route_id <> '__unrouted__'
      AND skip.provider_local_date >= timezone(dp.timezone, now())::date - :warm_retention_days
      AND skip.provider_local_date < timezone(dp.timezone, now())::date
    GROUP BY skip.route_id, skip.provider_local_date
    ORDER BY skip.route_id, skip.provider_local_date
    """,
)


def _entity_id(row: Mapping[str, Any]) -> str:
    value = row.get("route_id")
    if not isinstance(value, str) or not value or value == "__unrouted__":
        raise ValueError("Line history route_id must be nonempty and routed")
    return value


def _delay_metrics(
    rows: Iterable[Mapping[str, Any]],
) -> tuple[dict[str, dict[str, HistoricDelayMetric]], dict[str, dict[str, list[str]]]]:
    metrics: dict[str, dict[str, HistoricDelayMetric]] = {}
    timestamps: dict[str, dict[str, list[str]]] = {}
    for (entity_id, local_date), grouped in _group_rows(rows, entity_id_of=_entity_id).items():
        observation_count = sum(history_row_int(row, "observation_count") or 0 for row in grouped)
        if observation_count <= 0:
            continue
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
        put_history_entity_metric(
            metrics,
            entity_id,
            local_date,
            HistoricDelayMetric(
                observation_count=observation_count,
                in_clamp_observation_count=in_clamp if in_clamp > 0 else None,
                on_time_count=on_time,
                severe_count=severe,
                sum_delay_seconds=delay_sum if in_clamp > 0 else None,
            ),
        )
        put_history_entity_timestamps(
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
    for (entity_id, local_date), grouped in _group_rows(rows, entity_id_of=_entity_id).items():
        if len(grouped) != 1:
            raise ValueError(f"duplicate Line percentile day {entity_id}/{local_date}")
        row = grouped[0]
        observation_count = history_row_int(row, "observation_count") or 0
        if observation_count <= 0:
            raise ValueError("Line percentile observation_count must be positive")
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


def _cancellation_metrics(
    rows: Iterable[Mapping[str, Any]],
) -> tuple[
    dict[str, dict[str, HistoricCancellationMetric]],
    dict[str, dict[str, list[str]]],
]:
    metrics: dict[str, dict[str, HistoricCancellationMetric]] = {}
    timestamps: dict[str, dict[str, list[str]]] = {}
    for (entity_id, local_date), grouped in _group_rows(rows, entity_id_of=_entity_id).items():
        canceled = sum(history_row_int(row, "canceled_trip_days") or 0 for row in grouped)
        total = sum(history_row_int(row, "total_trip_days") or 0 for row in grouped)
        scheduled = history_optional_sum(
            history_row_int(row, "scheduled_trip_days", optional=True) for row in grouped
        )
        known = [row for row in grouped if row.get("scheduled_trip_days") is not None]
        if total <= 0 and (scheduled is None or scheduled <= 0):
            continue
        delivered = history_optional_sum(
            history_row_int(row, "delivered_trip_days", optional=True) for row in known
        )
        silent = history_optional_sum(
            history_row_int(row, "silent_trip_days", optional=True) for row in known
        )
        put_history_entity_metric(
            metrics,
            entity_id,
            local_date,
            HistoricCancellationMetric(
                canceled_trip_days=canceled,
                total_trip_days=total,
                scheduled_trip_days=scheduled,
                delivered_trip_days=delivered,
                silent_trip_days=silent,
            ),
        )
        put_history_entity_timestamps(
            timestamps,
            entity_id,
            local_date,
            (
                row
                for row in grouped
                if (history_row_int(row, "total_trip_days") or 0) > 0
                or (history_row_int(row, "scheduled_trip_days", optional=True) or 0) > 0
            ),
        )
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
    for (entity_id, local_date), grouped in _group_rows(rows, entity_id_of=_entity_id).items():
        observation_count = sum(history_row_int(row, "observation_count") or 0 for row in grouped)
        counts = {band: sum(history_row_int(row, band) or 0 for row in grouped) for band in bands}
        if observation_count != sum(counts.values()):
            raise ValueError("Line occupancy observation_count must equal the sum of bands")
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


def _optional_utc(row: Mapping[str, Any], field_name: str) -> str | None:
    value = row.get(field_name)
    return None if value is None else history_utc_timestamp(value, field=field_name)


def _service_span_metrics(
    rows: Iterable[Mapping[str, Any]],
) -> tuple[
    dict[str, dict[str, HistoricServiceSpanMetric]],
    dict[str, dict[str, list[str]]],
]:
    metrics: dict[str, dict[str, HistoricServiceSpanMetric]] = {}
    timestamps: dict[str, dict[str, list[str]]] = {}
    for (entity_id, local_date), grouped in _group_rows(rows, entity_id_of=_entity_id).items():
        if len(grouped) != 1:
            raise ValueError(f"duplicate Line service-span day {entity_id}/{local_date}")
        row = grouped[0]
        trip_count = history_row_int(row, "trip_count") or 0
        if trip_count <= 0:
            continue
        put_history_entity_metric(
            metrics,
            entity_id,
            local_date,
            HistoricServiceSpanMetric(
                trip_count=trip_count,
                first_trip_utc=_optional_utc(row, "first_trip_start_utc"),
                last_trip_utc=_optional_utc(row, "last_trip_start_utc"),
                first_trip_delay_seconds=history_row_int(
                    row,
                    "first_trip_delay_seconds",
                    optional=True,
                    minimum=None,
                ),
                last_trip_delay_seconds=history_row_int(
                    row,
                    "last_trip_delay_seconds",
                    optional=True,
                    minimum=None,
                ),
            ),
        )
        put_history_entity_timestamps(timestamps, entity_id, local_date, grouped)
    return metrics, timestamps


def _skipped_stop_metrics(
    rows: Iterable[Mapping[str, Any]],
) -> tuple[
    dict[str, dict[str, HistoricSkippedStopMetric]],
    dict[str, dict[str, list[str]]],
]:
    metrics: dict[str, dict[str, HistoricSkippedStopMetric]] = {}
    timestamps: dict[str, dict[str, list[str]]] = {}
    for (entity_id, local_date), grouped in _group_rows(rows, entity_id_of=_entity_id).items():
        skipped = sum(history_row_int(row, "skipped_stop_count") or 0 for row in grouped)
        updates = sum(history_row_int(row, "stop_time_update_count") or 0 for row in grouped)
        if updates <= 0:
            continue
        put_history_entity_metric(
            metrics,
            entity_id,
            local_date,
            HistoricSkippedStopMetric(
                skipped_stop_count=skipped,
                stop_time_update_count=updates,
            ),
        )
        put_history_entity_timestamps(
            timestamps,
            entity_id,
            local_date,
            (row for row in grouped if (history_row_int(row, "stop_time_update_count") or 0) > 0),
        )
    return metrics, timestamps


def _entity_plans_from_rows(
    entity_ids: Sequence[str],
    rows: HistoryMetricRows,
) -> list[HistoryEntityMetricPlan]:
    sources = (
        _delay_metrics(rows[0]),
        _percentile_metrics(rows[1]),
        _cancellation_metrics(rows[2]),
        _occupancy_metrics(rows[3]),
        _service_span_metrics(rows[4]),
        _skipped_stop_metrics(rows[5]),
    )
    return build_history_entity_metric_plans(
        entity_ids=entity_ids,
        metric_sources=tuple(metrics for metrics, _timestamps in sources),
        timestamp_sources=tuple(timestamps for _metrics, timestamps in sources),
    )


@dataclass
class LineHistoryStreamSummary:
    """Compact streamed Line truth used to build and cross-check mutable pointers."""

    refs: dict[str, list[HistoricPartitionRef]] = field(default_factory=dict)
    available_dates: dict[str, list[str]] = field(default_factory=dict)
    metric_dates: dict[str, dict[str, list[str]]] = field(default_factory=dict)
    timestamps: dict[str, list[str]] = field(default_factory=dict)

    def observe(self, ref: HistoricPartitionRef, partition: LineHistoryPartition) -> None:
        entity_id = partition.entity_id
        self.refs.setdefault(entity_id, []).append(ref.model_copy(deep=True))
        self.timestamps.setdefault(entity_id, []).append(partition.generated_utc)
        metric_dates = self.metric_dates.setdefault(
            entity_id,
            {metric: [] for metric, _aggregation in LINE_HISTORY_METRICS},
        )
        dates = self.available_dates.setdefault(entity_id, [])
        for day in partition.days:
            dates.append(day.date)
            for metric in metric_dates:
                if getattr(day, metric) is not None:
                    metric_dates[metric].append(day.date)

    def build_indexes(self, *, fallback_generated_utc: str) -> list[HistoricCollectionIndex]:
        indexes: list[HistoricCollectionIndex] = []
        for entity_id in sorted(self.refs):
            dates = sorted(self.available_dates.get(entity_id, []))
            if not dates:
                continue
            first, last, gaps = history_coverage(dates)
            index = HistoricCollectionIndex(
                generated_utc=latest_history_timestamp(
                    self.timestamps.get(entity_id, []),
                    fallback=fallback_generated_utc,
                ),
                methodology_version="history-1",
                family="lines",
                selection_mode="range",
                entity_id=entity_id,
                first_available_date=first,
                last_available_date=last,
                available_dates=dates,
                gaps=gaps,
                partitions=[ref.model_copy(deep=True) for ref in self.refs[entity_id]],
                metrics=[
                    history_metric_coverage(
                        metric,
                        aggregation,
                        self.metric_dates[entity_id][metric],
                    )
                    for metric, aggregation in LINE_HISTORY_METRICS
                ],
            )
            index.collection_generation_id = history_index_generation_id(index)
            indexes.append(index)
        return indexes

    def build_directory(
        self,
        indexes: Sequence[HistoricCollectionIndex],
        *,
        fallback_generated_utc: str,
    ) -> HistoricEntityDirectoryIndex:
        ordered = sorted(indexes, key=lambda index: index.entity_id or "")
        all_dates = sorted(
            {local_date for index in ordered for local_date in index.available_dates}
        )
        first, last, _gaps = history_coverage(all_dates)
        directory = HistoricEntityDirectoryIndex(
            generated_utc=latest_history_timestamp(
                (index.generated_utc for index in ordered),
                fallback=fallback_generated_utc,
            ),
            methodology_version="history-1",
            family="lines",
            selection_mode="range",
            collection_generation_id="pending",
            first_available_date=first,
            last_available_date=last,
            entities=[
                HistoricEntityIndexRef(
                    entity_id=index.entity_id or "",
                    encoded_id=encode_history_entity_id(index.entity_id or ""),
                    index_path=(
                        f"historic/history/lines/"
                        f"{encode_history_entity_id(index.entity_id or '')}/index.json"
                    ),
                    collection_generation_id=index.collection_generation_id or "",
                    first_available_date=index.first_available_date,
                    last_available_date=index.last_available_date,
                )
                for index in ordered
            ],
        )
        directory.collection_generation_id = history_entity_directory_generation_id(directory)
        return directory


@dataclass(frozen=True)
class LineHistoryBundle:
    partitions: list[LineHistoryPartition]
    indexes: list[HistoricCollectionIndex]
    directory: HistoricEntityDirectoryIndex

    @property
    def partition_items(self) -> list[tuple[str, LineHistoryPartition]]:
        refs = [ref for index in self.indexes for ref in index.partitions]
        return [(ref.path, partition) for ref, partition in zip(refs, self.partitions, strict=True)]


@dataclass(frozen=True)
class LineHistoryPlan:
    entity_ids: tuple[str, ...]
    generated_utc: str
    entity_batch_size: int
    batch_loader: HistoryBatchLoader

    def iter_partition_items(self) -> Iterator[tuple[HistoricPartitionRef, LineHistoryPartition]]:
        for start in range(0, len(self.entity_ids), self.entity_batch_size):
            batch = list(self.entity_ids[start : start + self.entity_batch_size])
            for entity_plan in _entity_plans_from_rows(batch, self.batch_loader(batch)):
                yield from entity_plan.iter_partition_items(
                    family="lines",
                    metric_names=tuple(metric for metric, _aggregation in LINE_HISTORY_METRICS),
                    day_model=LineHistoryDay,
                    partition_model=LineHistoryPartition,
                )

    def materialize(self) -> LineHistoryBundle:
        summary = LineHistoryStreamSummary()
        partitions: list[LineHistoryPartition] = []
        for ref, partition in self.iter_partition_items():
            summary.observe(ref, partition)
            partitions.append(partition)
        indexes = summary.build_indexes(fallback_generated_utc=self.generated_utc)
        return LineHistoryBundle(
            partitions=partitions,
            indexes=indexes,
            directory=summary.build_directory(indexes, fallback_generated_utc=self.generated_utc),
        )


def build_line_history_plan_from_rows(
    *,
    delay_rows: Iterable[Mapping[str, Any]],
    percentile_rows: Iterable[Mapping[str, Any]],
    cancellation_rows: Iterable[Mapping[str, Any]],
    occupancy_rows: Iterable[Mapping[str, Any]],
    service_span_rows: Iterable[Mapping[str, Any]],
    skipped_stop_rows: Iterable[Mapping[str, Any]],
    generated_utc: str,
    entity_ids: Iterable[str] | None = None,
    entity_batch_size: int = LINE_HISTORY_ENTITY_BATCH_SIZE,
) -> LineHistoryPlan:
    if entity_batch_size <= 0:
        raise ValueError("Line history entity_batch_size must be positive")
    sources = tuple(
        tuple(rows)
        for rows in (
            delay_rows,
            percentile_rows,
            cancellation_rows,
            occupancy_rows,
            service_span_rows,
            skipped_stop_rows,
        )
    )
    discovered = clean_history_entity_ids(
        [*(entity_ids or []), *(row.get("route_id") for source in sources for row in source)],
        excluded=("__unrouted__",),
    )

    return LineHistoryPlan(
        entity_ids=discovered,
        generated_utc=history_utc_timestamp(generated_utc, field="generated_utc"),
        entity_batch_size=entity_batch_size,
        batch_loader=prepare_history_row_batch_loader(sources, entity_field="route_id"),
    )


def build_line_history_from_rows(**kwargs: Any) -> LineHistoryBundle:
    return build_line_history_plan_from_rows(**kwargs).materialize()


def build_line_history_plan(
    conn: Connection,
    *,
    provider_id: str = "stm",
    generated_utc: str,
    entity_batch_size: int = LINE_HISTORY_ENTITY_BATCH_SIZE,
) -> LineHistoryPlan:
    if entity_batch_size <= 0:
        raise ValueError("Line history entity_batch_size must be positive")
    settings = get_settings()
    base_params = {
        "provider_id": provider_id,
        "warm_retention_days": settings.GOLD_WARM_ROLLUP_RETENTION_DAYS,
    }
    id_rows = conn.execute(_LINE_HISTORY_IDS_SQL, base_params).mappings()
    entity_ids = clean_history_entity_ids(
        (row.get("route_id") for row in id_rows),
        excluded=("__unrouted__",),
    )
    queries = (
        _LINE_HISTORY_DELAY_SQL,
        _LINE_HISTORY_PERCENTILES_SQL,
        _LINE_HISTORY_CANCELLATION_SQL,
        _LINE_HISTORY_OCCUPANCY_SQL,
        _LINE_HISTORY_SERVICE_SPAN_SQL,
        _LINE_HISTORY_SKIPPED_STOPS_SQL,
    )

    return LineHistoryPlan(
        entity_ids=entity_ids,
        generated_utc=history_utc_timestamp(generated_utc, field="generated_utc"),
        entity_batch_size=entity_batch_size,
        batch_loader=prepare_history_sql_batch_loader(conn, queries, base_params=base_params),
    )


def build_line_history(
    conn: Connection,
    *,
    provider_id: str = "stm",
    generated_utc: str,
    entity_batch_size: int = LINE_HISTORY_ENTITY_BATCH_SIZE,
) -> LineHistoryBundle:
    return build_line_history_plan(
        conn,
        provider_id=provider_id,
        generated_utc=generated_utc,
        entity_batch_size=entity_batch_size,
    ).materialize()


__all__ = [
    "LINE_HISTORY_ENTITY_BATCH_SIZE",
    "LINE_HISTORY_METRICS",
    "LineHistoryBundle",
    "LineHistoryPlan",
    "LineHistoryStreamSummary",
    "build_line_history",
    "build_line_history_from_rows",
    "build_line_history_plan",
    "build_line_history_plan_from_rows",
]
