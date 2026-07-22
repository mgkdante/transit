"""Full-retention Network daily metrics partitioned into provider-local months."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from transit_ops.settings import get_settings
from transit_ops.snapshots.builders.historic.history_common import (
    history_coverage,
    history_date,
    history_index_generation_id,
    history_metric_coverage,
    history_month_partition_ref,
    history_optional_sum,
    history_row_float,
    history_row_int,
    history_row_timestamp,
    iter_history_month_groups,
    latest_history_timestamp,
)
from transit_ops.snapshots.contract import (
    HistoricCancellationMetric,
    HistoricCollectionIndex,
    HistoricDelayMetric,
    HistoricDelayPercentiles,
    HistoricOccupancyMetric,
    HistoricPartitionRef,
    NetworkHistoryDay,
    NetworkHistoryPartition,
)
from transit_ops.sql_registry import named_query

if TYPE_CHECKING:  # pragma: no cover - typing only
    from sqlalchemy.engine import Connection


_NETWORK_HISTORY_DELAY_SQL = named_query(
    "history.network.delay",
    """
    SELECT sp.provider_local_date AS local_date,
           SUM(sp.delay_observation_count) AS observation_count,
           SUM(sp.on_time_observation_count) AS on_time_count,
           SUM(sp.severe_delay_count) AS severe_count,
           SUM(sp.sum_delay_seconds) AS sum_delay_seconds,
           SUM(COALESCE((
               SELECT SUM(x)::bigint FROM unnest(sp.delay_histogram) AS x
           ), 0)) AS in_clamp_observation_count,
           MAX(sp.built_at_utc) FILTER (WHERE sp.delay_observation_count > 0)
               AS source_generated_utc
    FROM gold.route_delay_spine AS sp
    JOIN gold.dim_provider AS dp ON dp.provider_id = sp.provider_id
    WHERE sp.provider_id = :provider_id
      AND sp.provider_local_date >=
          timezone(dp.timezone, now())::date - :warm_retention_days
      AND sp.provider_local_date < timezone(dp.timezone, now())::date
    GROUP BY sp.provider_local_date
    ORDER BY sp.provider_local_date
    """,
)


_NETWORK_HISTORY_FACT_SQL = named_query(
    "history.network.fact",
    """
    WITH source_bounds AS (
        SELECT now() - make_interval(days => :fact_retention_days) AS retention_floor_utc
    )
    SELECT timezone(dp.timezone, fts.captured_at_utc)::date AS local_date,
           COUNT(*) AS observation_count,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY fts.delay_seconds)
               AS p90_delay_seconds,
           COUNT(DISTINCT fts.vehicle_id) AS vehicles,
           MAX(fts.captured_at_utc) AS source_generated_utc
    FROM gold.fact_trip_delay_snapshot AS fts
    JOIN gold.dim_provider AS dp ON dp.provider_id = fts.provider_id
    CROSS JOIN source_bounds AS bounds
    WHERE fts.provider_id = :provider_id
      AND fts.delay_seconds IS NOT NULL
      AND ABS(fts.delay_seconds) <= 3600
      AND fts.captured_at_utc >= bounds.retention_floor_utc
      AND timezone(dp.timezone, fts.captured_at_utc)::date >
          timezone(dp.timezone, bounds.retention_floor_utc)::date
      AND timezone(dp.timezone, fts.captured_at_utc)::date <
          timezone(dp.timezone, now())::date
    GROUP BY timezone(dp.timezone, fts.captured_at_utc)::date
    ORDER BY local_date
    """,
)


_NETWORK_HISTORY_CANCELLATION_SQL = named_query(
    "history.network.cancellation",
    """
    SELECT rcd.provider_local_date AS local_date,
           SUM(rcd.canceled_trip_days) AS canceled_trip_days,
           SUM(rcd.total_trip_days) AS total_trip_days,
           SUM(rcd.scheduled_trip_days) AS scheduled_trip_days,
           SUM(rcd.delivered_trip_days) FILTER (WHERE rcd.scheduled_trip_days IS NOT NULL)
               AS delivered_trip_days,
           SUM(rcd.silent_trip_days) FILTER (WHERE rcd.scheduled_trip_days IS NOT NULL)
               AS silent_trip_days,
           MAX(rcd.built_at_utc) FILTER (
               WHERE rcd.total_trip_days > 0 OR rcd.scheduled_trip_days > 0
           ) AS source_generated_utc
    FROM gold.route_cancellation_daily AS rcd
    JOIN gold.dim_provider AS dp ON dp.provider_id = rcd.provider_id
    WHERE rcd.provider_id = :provider_id
      AND rcd.provider_local_date >=
          timezone(dp.timezone, now())::date - :warm_retention_days
      AND rcd.provider_local_date < timezone(dp.timezone, now())::date
    GROUP BY rcd.provider_local_date
    ORDER BY rcd.provider_local_date
    """,
)


_NETWORK_HISTORY_OCCUPANCY_SQL = named_query(
    "history.network.occupancy",
    """
    SELECT rob.provider_local_date AS local_date,
           SUM(rob.observation_count) AS observation_count,
           SUM(rob.empty_count) AS empty,
           SUM(rob.many_seats_count) AS many_seats,
           SUM(rob.few_seats_count) AS few_seats,
           SUM(rob.standing_count) AS standing,
           SUM(rob.full_count) AS full,
           MAX(rob.built_at_utc) FILTER (WHERE rob.observation_count > 0)
               AS source_generated_utc
    FROM gold.route_occupancy_band_daily AS rob
    JOIN gold.dim_provider AS dp ON dp.provider_id = rob.provider_id
    WHERE rob.provider_id = :provider_id
      AND rob.provider_local_date >=
          timezone(dp.timezone, now())::date - :warm_retention_days
      AND rob.provider_local_date < timezone(dp.timezone, now())::date
    GROUP BY rob.provider_local_date
    ORDER BY rob.provider_local_date
    """,
)


@dataclass(frozen=True)
class NetworkHistoryBundle:
    """Bounded immutable month payloads plus their one stable collection pointer."""

    partitions: list[NetworkHistoryPartition]
    index: HistoricCollectionIndex

    @property
    def partition_items(self) -> list[tuple[str, NetworkHistoryPartition]]:
        return [
            (ref.path, partition)
            for ref, partition in zip(self.index.partitions, self.partitions, strict=True)
        ]


@dataclass(frozen=True)
class NetworkHistoryPlan:
    """Full-retention daily inputs that materialize one immutable month at a time."""

    delay: dict[str, HistoricDelayMetric]
    delay_percentiles: dict[str, HistoricDelayPercentiles]
    vehicles: dict[str, int]
    cancellation: dict[str, HistoricCancellationMetric]
    occupancy: dict[str, HistoricOccupancyMetric]
    source_timestamps: tuple[dict[str, list[str]], ...]
    available_dates: list[str]
    metric_dates: dict[str, set[str]]
    fallback_generated_utc: str

    def iter_partition_items(
        self,
    ) -> Iterator[tuple[HistoricPartitionRef, NetworkHistoryPartition]]:
        """Yield one content-addressed month, releasing it before building the next."""

        for month, dates in iter_history_month_groups(self.available_dates):
            yield history_month_partition_ref(
                lambda local_date: NetworkHistoryDay(
                    date=local_date,
                    delay=self.delay.get(local_date),
                    delay_percentiles=self.delay_percentiles.get(local_date),
                    vehicles=self.vehicles.get(local_date),
                    cancellation=self.cancellation.get(local_date),
                    occupancy=self.occupancy.get(local_date),
                ),
                lambda generated_utc, partition_month, days: NetworkHistoryPartition(
                    generated_utc=generated_utc,
                    methodology_version="history-1",
                    month=partition_month,
                    days=days,
                ),
                lambda digest, partition_month: (
                    f"historic/history/network/generations/{digest}/{partition_month}.json"
                ),
                month=month,
                dates=dates,
                source_timestamps=self.source_timestamps,
            )

    def build_index(self, refs: Iterable[HistoricPartitionRef]) -> HistoricCollectionIndex:
        """Build the stable pointer from compact refs after every month has succeeded."""

        first, last, gaps = history_coverage(self.available_dates)
        metrics = [
            history_metric_coverage("delay", "additive", self.metric_dates["delay"]),
            history_metric_coverage(
                "delay_percentiles",
                "daily_only",
                self.metric_dates["delay_percentiles"],
            ),
            history_metric_coverage("vehicles", "daily_only", self.metric_dates["vehicles"]),
            history_metric_coverage(
                "cancellation",
                "additive",
                self.metric_dates["cancellation"],
            ),
            history_metric_coverage("occupancy", "additive", self.metric_dates["occupancy"]),
        ]
        index = HistoricCollectionIndex(
            generated_utc=latest_history_timestamp(
                (
                    timestamp
                    for local_date in self.available_dates
                    for source in self.source_timestamps
                    for timestamp in source.get(local_date, [])
                ),
                fallback=self.fallback_generated_utc,
            ),
            methodology_version="history-1",
            family="network",
            selection_mode="range",
            first_available_date=first,
            last_available_date=last,
            available_dates=self.available_dates,
            gaps=gaps,
            partitions=list(refs),
            metrics=metrics,
        )
        index.collection_generation_id = history_index_generation_id(index)
        return index

    def materialize(self) -> NetworkHistoryBundle:
        """Compatibility helper for pure tests and direct analytical callers."""

        items = list(self.iter_partition_items())
        refs = [ref for ref, _partition in items]
        return NetworkHistoryBundle(
            partitions=[partition for _ref, partition in items],
            index=self.build_index(refs),
        )


def _group_rows(rows: Iterable[Mapping[str, Any]]) -> dict[str, list[Mapping[str, Any]]]:
    grouped: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[history_date(row.get("local_date"))].append(row)
    return dict(grouped)


def _delay_metrics(
    rows: Iterable[Mapping[str, Any]],
) -> tuple[dict[str, HistoricDelayMetric], dict[str, list[str]]]:
    metrics: dict[str, HistoricDelayMetric] = {}
    timestamps: dict[str, list[str]] = {}
    for local_date, grouped in _group_rows(rows).items():
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
        metrics[local_date] = HistoricDelayMetric(
            observation_count=observation_count,
            in_clamp_observation_count=in_clamp if in_clamp > 0 else None,
            on_time_count=on_time,
            severe_count=severe,
            sum_delay_seconds=delay_sum if in_clamp > 0 else None,
        )
        timestamps[local_date] = [
            history_row_timestamp(row)
            for row in grouped
            if (history_row_int(row, "observation_count") or 0) > 0
        ]
    return metrics, timestamps


def _fact_metrics(
    rows: Iterable[Mapping[str, Any]],
) -> tuple[
    dict[str, HistoricDelayPercentiles],
    dict[str, int],
    dict[str, list[str]],
]:
    percentiles: dict[str, HistoricDelayPercentiles] = {}
    vehicles: dict[str, int] = {}
    timestamps: dict[str, list[str]] = {}
    seen: set[str] = set()
    for row in rows:
        local_date = history_date(row.get("local_date"))
        if local_date in seen:
            raise ValueError(f"duplicate raw fact day {local_date}; percentiles cannot be pooled")
        seen.add(local_date)
        observation_count = history_row_int(row, "observation_count") or 0
        vehicle_count = history_row_int(row, "vehicles") or 0
        p90 = history_row_float(row, "p90_delay_seconds")
        if vehicle_count > observation_count:
            raise ValueError("history row vehicles cannot exceed observation_count")
        if observation_count > 0 and p90 is not None:
            percentiles[local_date] = HistoricDelayPercentiles(
                observation_count=observation_count,
                p90_delay_seconds=p90,
            )
        if vehicle_count > 0:
            vehicles[local_date] = vehicle_count
        if local_date in percentiles or local_date in vehicles:
            timestamps[local_date] = [history_row_timestamp(row)]
    return percentiles, vehicles, timestamps


def _cancellation_metrics(
    rows: Iterable[Mapping[str, Any]],
) -> tuple[dict[str, HistoricCancellationMetric], dict[str, list[str]]]:
    metrics: dict[str, HistoricCancellationMetric] = {}
    timestamps: dict[str, list[str]] = {}
    for local_date, grouped in _group_rows(rows).items():
        canceled = sum(history_row_int(row, "canceled_trip_days") or 0 for row in grouped)
        total = sum(history_row_int(row, "total_trip_days") or 0 for row in grouped)
        scheduled = history_optional_sum(
            history_row_int(row, "scheduled_trip_days", optional=True) for row in grouped
        )
        known_schedule_rows = [row for row in grouped if row.get("scheduled_trip_days") is not None]
        delivered = history_optional_sum(
            history_row_int(row, "delivered_trip_days", optional=True)
            for row in known_schedule_rows
        )
        silent = history_optional_sum(
            history_row_int(row, "silent_trip_days", optional=True) for row in known_schedule_rows
        )
        if total <= 0 and (scheduled is None or scheduled <= 0):
            continue
        metrics[local_date] = HistoricCancellationMetric(
            canceled_trip_days=canceled,
            total_trip_days=total,
            scheduled_trip_days=scheduled,
            delivered_trip_days=delivered,
            silent_trip_days=silent,
        )
        timestamps[local_date] = [
            history_row_timestamp(row)
            for row in grouped
            if (history_row_int(row, "total_trip_days") or 0) > 0
            or (history_row_int(row, "scheduled_trip_days", optional=True) or 0) > 0
        ]
    return metrics, timestamps


def _occupancy_metrics(
    rows: Iterable[Mapping[str, Any]],
) -> tuple[dict[str, HistoricOccupancyMetric], dict[str, list[str]]]:
    metrics: dict[str, HistoricOccupancyMetric] = {}
    timestamps: dict[str, list[str]] = {}
    bands = ("empty", "many_seats", "few_seats", "standing", "full")
    for local_date, grouped in _group_rows(rows).items():
        counts = {band: sum(history_row_int(row, band) or 0 for row in grouped) for band in bands}
        observation_count = sum(history_row_int(row, "observation_count") or 0 for row in grouped)
        band_total = sum(counts.values())
        if observation_count != band_total:
            raise ValueError(
                f"occupancy observation_count {observation_count} does not match bands {band_total}"
            )
        if band_total <= 0:
            continue
        metrics[local_date] = HistoricOccupancyMetric(**counts)
        timestamps[local_date] = [
            history_row_timestamp(row)
            for row in grouped
            if (history_row_int(row, "observation_count") or 0) > 0
            or any((history_row_int(row, band) or 0) > 0 for band in bands)
        ]
    return metrics, timestamps


def build_network_history_plan_from_rows(
    *,
    delay_rows: Iterable[Mapping[str, Any]],
    fact_rows: Iterable[Mapping[str, Any]],
    cancellation_rows: Iterable[Mapping[str, Any]],
    occupancy_rows: Iterable[Mapping[str, Any]],
    generated_utc: str,
) -> NetworkHistoryPlan:
    """Merge retained daily sources into a plan that yields one month at a time."""

    delay, delay_timestamps = _delay_metrics(delay_rows)
    percentiles, vehicles, fact_timestamps = _fact_metrics(fact_rows)
    cancellation, cancellation_timestamps = _cancellation_metrics(cancellation_rows)
    occupancy, occupancy_timestamps = _occupancy_metrics(occupancy_rows)

    all_dates = sorted(
        set(delay) | set(percentiles) | set(vehicles) | set(cancellation) | set(occupancy)
    )
    metric_dates: dict[str, set[str]] = {
        "delay": set(delay),
        "delay_percentiles": set(percentiles),
        "vehicles": set(vehicles),
        "cancellation": set(cancellation),
        "occupancy": set(occupancy),
    }
    return NetworkHistoryPlan(
        delay=delay,
        delay_percentiles=percentiles,
        vehicles=vehicles,
        cancellation=cancellation,
        occupancy=occupancy,
        source_timestamps=(
            delay_timestamps,
            fact_timestamps,
            cancellation_timestamps,
            occupancy_timestamps,
        ),
        available_dates=all_dates,
        metric_dates=metric_dates,
        fallback_generated_utc=generated_utc,
    )


def build_network_history_from_rows(
    *,
    delay_rows: Iterable[Mapping[str, Any]],
    fact_rows: Iterable[Mapping[str, Any]],
    cancellation_rows: Iterable[Mapping[str, Any]],
    occupancy_rows: Iterable[Mapping[str, Any]],
    generated_utc: str,
) -> NetworkHistoryBundle:
    """Materialize retained Network history for pure analytical callers."""

    return build_network_history_plan_from_rows(
        delay_rows=delay_rows,
        fact_rows=fact_rows,
        cancellation_rows=cancellation_rows,
        occupancy_rows=occupancy_rows,
        generated_utc=generated_utc,
    ).materialize()


def build_network_history_plan(
    conn: Connection,
    *,
    provider_id: str = "stm",
    generated_utc: str,
) -> NetworkHistoryPlan:
    """Read each retained source once and return a bounded month publication plan."""

    settings = get_settings()
    warm_params = {
        "provider_id": provider_id,
        "warm_retention_days": settings.GOLD_WARM_ROLLUP_RETENTION_DAYS,
    }
    fact_params = {
        "provider_id": provider_id,
        "fact_retention_days": settings.GOLD_FACT_RETENTION_DAYS,
    }
    delay_rows = list(conn.execute(_NETWORK_HISTORY_DELAY_SQL, warm_params).mappings())
    fact_rows = list(conn.execute(_NETWORK_HISTORY_FACT_SQL, fact_params).mappings())
    cancellation_rows = list(
        conn.execute(_NETWORK_HISTORY_CANCELLATION_SQL, warm_params).mappings()
    )
    occupancy_rows = list(conn.execute(_NETWORK_HISTORY_OCCUPANCY_SQL, warm_params).mappings())
    return build_network_history_plan_from_rows(
        delay_rows=delay_rows,
        fact_rows=fact_rows,
        cancellation_rows=cancellation_rows,
        occupancy_rows=occupancy_rows,
        generated_utc=generated_utc,
    )


def build_network_history(
    conn: Connection,
    *,
    provider_id: str = "stm",
    generated_utc: str,
) -> NetworkHistoryBundle:
    """Materialize retained Network history for direct analytical callers."""

    return build_network_history_plan(
        conn,
        provider_id=provider_id,
        generated_utc=generated_utc,
    ).materialize()


__all__ = [
    "NetworkHistoryBundle",
    "NetworkHistoryPlan",
    "build_network_history",
    "build_network_history_from_rows",
    "build_network_history_plan",
    "build_network_history_plan_from_rows",
]
