"""Full-retention Hotspots payloads recomposed as of each closed local day."""

from __future__ import annotations

from collections import deque
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING, Any

from transit_ops.gold.reader import shift_case_sql
from transit_ops.snapshots.builders._helpers import _otp_pct, _otp_pct_severe_proxy
from transit_ops.snapshots.builders.historic.history_common import (
    HistoryNameIndex,
    history_row_int,
    history_row_timestamp,
    iter_history_date_groups,
    latest_history_timestamp,
)
from transit_ops.snapshots.builders.historic.small_surfaces import (
    _HOTSPOT_PEAK_SHIFTS,
    _SENTINEL_ENTITY_IDS,
    _hotspot_kind_ladder,
    _merge_grain,
    _otp_delta_pts,
)
from transit_ops.snapshots.contract import (
    HOTSPOTS_BYTE_CEILING,
    HistoricHotspotsDay,
    Hotspot,
    HotspotGrain,
)
from transit_ops.snapshots.serialization import snapshot_json_bytes
from transit_ops.sql_registry import named_query

if TYPE_CHECKING:  # pragma: no cover - typing only
    from sqlalchemy.engine import Connection


_PEAK_SHIFT_IN_LITERAL = ", ".join(f"'{value}'" for value in _HOTSPOT_PEAK_SHIFTS)

_HOTSPOTS_HISTORY_TIMEZONE_SQL = named_query(
    "history.hotspots.timezone",
    """
    SELECT dp.timezone
    FROM gold.dim_provider AS dp
    WHERE dp.provider_id = :provider_id
    """,
)

_HOTSPOTS_HISTORY_NAMES_SQL = named_query(
    "history.hotspots.names",
    """
    SELECT 'route'::text AS entity_kind,
           h.route_id AS entity_id,
           COALESCE(h.route_long_name, h.route_short_name) AS name,
           h.valid_from_utc,
           h.valid_to_utc
    FROM gold.dim_route_history AS h
    WHERE h.provider_id = :provider_id
    UNION ALL
    SELECT 'stop'::text AS entity_kind,
           h.stop_id AS entity_id,
           h.stop_name AS name,
           h.valid_from_utc,
           h.valid_to_utc
    FROM gold.dim_stop_history AS h
    WHERE h.provider_id = :provider_id
    ORDER BY entity_kind, entity_id, valid_from_utc, valid_to_utc NULLS LAST
    """,
)

_HOTSPOTS_HISTORY_ROUTE_DAILY_SQL = named_query(
    "history.hotspots.route_daily",
    f"""
    SELECT sp.provider_local_date AS local_date,
           sp.route_id,
           1::bigint AS daily_present,
           SUM(sp.delay_observation_count)::bigint AS observation_count,
           SUM(sp.on_time_observation_count)::bigint AS on_time_count,
           COALESCE(SUM(sp.delay_observation_count) FILTER (
               WHERE sp.on_time_observation_count IS NOT NULL
           ), 0)::bigint AS known_observation_count,
           SUM(sp.severe_delay_count)::bigint AS severe_count,
           SUM(sp.sum_delay_seconds)::bigint AS sum_delay_seconds,
           SUM(COALESCE((
               SELECT SUM(value)::bigint FROM unnest(sp.delay_histogram) AS value
           ), 0))::bigint AS in_clamp_observation_count,
           COALESCE(SUM(sp.delay_observation_count) FILTER (
               WHERE ({shift_case_sql("sp.hour_of_day_local", indent=14)})
                     IN ({_PEAK_SHIFT_IN_LITERAL})
           ), 0)::bigint AS peak_observation_count,
           COALESCE(SUM(sp.severe_delay_count) FILTER (
               WHERE ({shift_case_sql("sp.hour_of_day_local", indent=14)})
                     IN ({_PEAK_SHIFT_IN_LITERAL})
           ), 0)::bigint AS peak_severe_count,
           COALESCE(SUM(sp.sum_delay_seconds) FILTER (
               WHERE ({shift_case_sql("sp.hour_of_day_local", indent=14)})
                     IN ({_PEAK_SHIFT_IN_LITERAL})
           ), 0)::bigint AS peak_sum_delay_seconds,
           COUNT(*) FILTER (
               WHERE ({shift_case_sql("sp.hour_of_day_local", indent=14)})
                     IN ({_PEAK_SHIFT_IN_LITERAL})
           )::bigint AS peak_present,
           MAX(sp.built_at_utc) AS source_generated_utc
    FROM gold.route_delay_spine AS sp
    JOIN gold.dim_provider AS dp ON dp.provider_id = sp.provider_id
    WHERE sp.provider_id = :provider_id
      AND sp.provider_local_date < timezone(dp.timezone, now())::date
    GROUP BY sp.provider_local_date, sp.route_id
    ORDER BY sp.provider_local_date, sp.route_id
    """,
)

_HOTSPOTS_HISTORY_STOP_DAILY_SQL = named_query(
    "history.hotspots.stop_daily",
    f"""
    WITH daily AS (
        SELECT sp.provider_local_date AS local_date,
               sp.stop_id,
               sp.route_id,
               SUM(sp.observation_count)::bigint AS observation_count,
               SUM(sp.severe_delay_count)::bigint AS severe_count,
               SUM(sp.sum_delay_seconds)::bigint AS sum_delay_seconds,
               MAX(sp.built_at_utc) AS source_generated_utc
        FROM gold.stop_delay_spine AS sp
        JOIN gold.dim_provider AS dp ON dp.provider_id = sp.provider_id
        WHERE sp.provider_id = :provider_id
          AND sp.provider_local_date < timezone(dp.timezone, now())::date
        GROUP BY sp.provider_local_date, sp.stop_id, sp.route_id
    ),
    peak AS (
        SELECT shift.provider_local_date AS local_date,
               shift.stop_id,
               shift.route_id,
               SUM(shift.observation_count)::bigint AS peak_observation_count,
               SUM(shift.severe_delay_count)::bigint AS peak_severe_count,
               SUM(shift.sum_delay_seconds)::bigint AS peak_sum_delay_seconds,
               COUNT(*)::bigint AS peak_present,
               MAX(shift.built_at_utc) AS source_generated_utc
        FROM gold.stop_delay_shift_daily AS shift
        JOIN gold.dim_provider AS dp ON dp.provider_id = shift.provider_id
        WHERE shift.provider_id = :provider_id
          AND shift.provider_local_date < timezone(dp.timezone, now())::date
          AND shift.shift IN ({_PEAK_SHIFT_IN_LITERAL})
        GROUP BY shift.provider_local_date, shift.stop_id, shift.route_id
    )
    SELECT COALESCE(daily.local_date, peak.local_date) AS local_date,
           COALESCE(daily.stop_id, peak.stop_id) AS stop_id,
           COALESCE(daily.route_id, peak.route_id) AS route_id,
           CASE WHEN daily.local_date IS NULL THEN 0 ELSE 1 END::bigint AS daily_present,
           COALESCE(daily.observation_count, 0)::bigint AS observation_count,
           COALESCE(daily.severe_count, 0)::bigint AS severe_count,
           COALESCE(daily.sum_delay_seconds, 0)::bigint AS sum_delay_seconds,
           COALESCE(peak.peak_observation_count, 0)::bigint AS peak_observation_count,
           COALESCE(peak.peak_severe_count, 0)::bigint AS peak_severe_count,
           COALESCE(peak.peak_sum_delay_seconds, 0)::bigint AS peak_sum_delay_seconds,
           COALESCE(peak.peak_present, 0)::bigint AS peak_present,
           GREATEST(daily.source_generated_utc, peak.source_generated_utc)
               AS source_generated_utc
    FROM daily
    FULL OUTER JOIN peak
      ON peak.local_date = daily.local_date
     AND peak.stop_id = daily.stop_id
     AND peak.route_id = daily.route_id
    ORDER BY local_date, stop_id, route_id
    """,
)


_EntityKey = tuple[str, str, str]


@dataclass(frozen=True)
class _Counts:
    present: int = 0
    observation_count: int = 0
    severe_count: int = 0
    sum_delay_seconds: int = 0
    in_clamp_observation_count: int = 0
    on_time_count: int = 0
    known_observation_count: int = 0
    on_time_known: int = 0
    peak_present: int = 0
    peak_observation_count: int = 0
    peak_severe_count: int = 0
    peak_sum_delay_seconds: int = 0

    def __add__(self, other: _Counts) -> _Counts:
        return _Counts(
            **{
                field: getattr(self, field) + getattr(other, field)
                for field in self.__dataclass_fields__
            }
        )

    def __sub__(self, other: _Counts) -> _Counts:
        return _Counts(
            **{
                field: getattr(self, field) - getattr(other, field)
                for field in self.__dataclass_fields__
            }
        )

    def peak(self) -> _Counts | None:
        if self.peak_present <= 0:
            return None
        return _Counts(
            present=self.peak_present,
            observation_count=self.peak_observation_count,
            severe_count=self.peak_severe_count,
            sum_delay_seconds=self.peak_sum_delay_seconds,
            in_clamp_observation_count=self.peak_observation_count,
        )


class _CountsWindow:
    """Bounded additive date window; each daily row enters and leaves once."""

    def __init__(self, width_days: int) -> None:
        self._width_days = width_days
        self._days: deque[tuple[date, dict[_EntityKey, _Counts]]] = deque()
        self.totals: dict[_EntityKey, _Counts] = {}

    def add_day(self, local_date: date, values: dict[_EntityKey, _Counts]) -> None:
        self._days.append((local_date, values))
        for key, counts in values.items():
            self.totals[key] = self.totals.get(key, _Counts()) + counts
        cutoff = local_date - timedelta(days=self._width_days - 1)
        while self._days and self._days[0][0] < cutoff:
            _expired_date, expired = self._days.popleft()
            for key, counts in expired.items():
                remaining = self.totals[key] - counts
                if remaining.present <= 0:
                    del self.totals[key]
                else:
                    self.totals[key] = remaining


def _required_id(row: Mapping[str, Any], field: str) -> str:
    value = row.get(field)
    if not isinstance(value, str) or not value:
        raise ValueError(f"Hotspots history {field} must be nonempty")
    return value


def _counts_from_row(row: Mapping[str, Any], *, route: bool) -> _Counts:
    daily_present = history_row_int(row, "daily_present") or 0
    observation_count = history_row_int(row, "observation_count") or 0
    severe_count = history_row_int(row, "severe_count") or 0
    sum_delay_seconds = history_row_int(row, "sum_delay_seconds", minimum=None) or 0
    in_clamp = (
        history_row_int(row, "in_clamp_observation_count") if route else observation_count
    ) or 0
    on_time = history_row_int(row, "on_time_count", optional=True) if route else None
    known_observation_count = (history_row_int(row, "known_observation_count") if route else 0) or 0
    peak_observation_count = history_row_int(row, "peak_observation_count") or 0
    peak_severe_count = history_row_int(row, "peak_severe_count") or 0
    peak_sum_delay_seconds = (
        history_row_int(
            row,
            "peak_sum_delay_seconds",
            minimum=None,
        )
        or 0
    )
    peak_present = history_row_int(row, "peak_present") or 0
    if severe_count > observation_count:
        raise ValueError("Hotspots history severe_count cannot exceed observation_count")
    if in_clamp > observation_count:
        raise ValueError("Hotspots history in-clamp count cannot exceed observation_count")
    if known_observation_count > observation_count:
        raise ValueError("Hotspots history known count cannot exceed observation_count")
    if on_time is not None and on_time > known_observation_count:
        raise ValueError("Hotspots history on_time_count cannot exceed known count")
    if peak_severe_count > peak_observation_count:
        raise ValueError("Hotspots history peak severe count cannot exceed its observations")
    return _Counts(
        present=daily_present,
        observation_count=observation_count,
        severe_count=severe_count,
        sum_delay_seconds=sum_delay_seconds,
        in_clamp_observation_count=in_clamp,
        on_time_count=on_time or 0,
        known_observation_count=known_observation_count,
        on_time_known=int(on_time is not None),
        peak_present=peak_present,
        peak_observation_count=peak_observation_count,
        peak_severe_count=peak_severe_count,
        peak_sum_delay_seconds=peak_sum_delay_seconds,
    )


def _daily_counts(
    route_rows: Iterable[Mapping[str, Any]],
    stop_rows: Iterable[Mapping[str, Any]],
) -> tuple[dict[_EntityKey, _Counts], dict[_EntityKey, _Counts], list[str]]:
    all_counts: dict[_EntityKey, _Counts] = {}
    timestamps: list[str] = []
    for row in route_rows:
        route_id = _required_id(row, "route_id")
        key = ("route", route_id, route_id)
        all_counts[key] = all_counts.get(key, _Counts()) + _counts_from_row(row, route=True)
        timestamps.append(history_row_timestamp(row))
    for row in stop_rows:
        stop_id = _required_id(row, "stop_id")
        route_id = _required_id(row, "route_id")
        key = ("stop", stop_id, route_id)
        all_counts[key] = all_counts.get(key, _Counts()) + _counts_from_row(row, route=False)
        timestamps.append(history_row_timestamp(row))
    base = {key: counts for key, counts in all_counts.items() if counts.present > 0}
    peak = {
        key: peak_counts
        for key, counts in all_counts.items()
        if (peak_counts := counts.peak()) is not None
    }
    return base, peak, timestamps


def _merge_date_groups(
    route_rows: Iterable[Mapping[str, Any]],
    stop_rows: Iterable[Mapping[str, Any]],
) -> Iterator[tuple[str, list[Mapping[str, Any]], list[Mapping[str, Any]]]]:
    route_groups = iter(iter_history_date_groups(route_rows))
    stop_groups = iter(iter_history_date_groups(stop_rows))
    route = next(route_groups, None)
    stop = next(stop_groups, None)
    while route is not None or stop is not None:
        local_date = min(value[0] for value in (route, stop) if value is not None)
        current_route = route[1] if route is not None and route[0] == local_date else []
        current_stop = stop[1] if stop is not None and stop[0] == local_date else []
        yield local_date, current_route, current_stop
        if route is not None and route[0] == local_date:
            route = next(route_groups, None)
        if stop is not None and stop[0] == local_date:
            stop = next(stop_groups, None)


def _postgres_numeric_round(value: int, denominator: int) -> Decimal | None:
    if denominator <= 0:
        return None
    return (Decimal(value) / Decimal(denominator)).quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP,
    )


def _scalar_hotspots(
    counts: Mapping[_EntityKey, _Counts],
    *,
    local_date: str,
    names: HistoryNameIndex,
) -> list[Hotspot]:
    route_counts = {key: value for key, value in counts.items() if key[0] == "route"}
    stop_counts = {key: value for key, value in counts.items() if key[0] == "stop"}
    net_route_on_time = sum(value.on_time_count for value in route_counts.values())
    net_route_known = sum(value.known_observation_count for value in route_counts.values())
    net_route_otp = _otp_pct(net_route_on_time, net_route_known)
    net_stop_obs = sum(value.observation_count for value in stop_counts.values())
    net_stop_severe = sum(value.severe_count for value in stop_counts.values())
    net_stop_otp = _otp_pct_severe_proxy(net_stop_obs, net_stop_severe)
    stop_totals: dict[str, _Counts] = {}
    for (_kind, stop_id, _route_id), value in stop_counts.items():
        stop_totals[stop_id] = stop_totals.get(stop_id, _Counts()) + value

    candidates: list[tuple[int, str, str, str, str, float | None]] = []
    for (kind, entity_id, route_id), value in counts.items():
        if entity_id in _SENTINEL_ENTITY_IDS:
            continue
        denominator = (
            value.in_clamp_observation_count if kind == "route" else value.observation_count
        )
        average = _postgres_numeric_round(value.sum_delay_seconds, denominator)
        issue_count = value.severe_count
        if issue_count <= 0 and (average is None or average <= Decimal(300)):
            continue
        severity = (
            "critical"
            if issue_count >= 10 or (average is not None and average > Decimal(600))
            else "high"
        )
        if kind == "route":
            cell = _otp_pct(
                value.on_time_count if value.on_time_known else None,
                value.known_observation_count,
            )
            delta = _otp_delta_pts(cell, net_route_otp)
        else:
            stop_value = stop_totals[entity_id]
            cell = _otp_pct_severe_proxy(
                stop_value.observation_count,
                stop_value.severe_count,
            )
            delta = _otp_delta_pts(cell, net_stop_otp)
        candidates.append((issue_count, kind, entity_id, route_id, severity, delta))
    candidates.sort(key=lambda value: (-value[0], value[1], value[2], value[3]))
    return [
        Hotspot(
            rank=rank,
            type=kind,
            id=entity_id,
            name=names.name_at(kind, entity_id, local_date),
            severity=severity,
            otp_delta_pts=delta,
        )
        for rank, (_issues, kind, entity_id, _route, severity, delta) in enumerate(
            candidates[:20],
            start=1,
        )
    ]


def _ladder_rows(
    counts: Mapping[_EntityKey, _Counts],
    *,
    kind: str,
) -> list[dict[str, object]]:
    grouped: dict[str, _Counts] = {}
    for (entity_kind, entity_id, _route_id), value in counts.items():
        if entity_kind != kind or entity_id in _SENTINEL_ENTITY_IDS:
            continue
        grouped[entity_id] = grouped.get(entity_id, _Counts()) + value
    id_field = "route_id" if kind == "route" else "stop_id"
    return [
        {
            id_field: entity_id,
            "obs": value.observation_count,
            "severe": value.severe_count,
            "sum_delay_sec": value.sum_delay_seconds,
        }
        for entity_id, value in sorted(grouped.items())
    ]


def _grain(
    counts: Mapping[_EntityKey, _Counts],
    *,
    grain: str,
    local_date: str,
    names: HistoryNameIndex,
) -> HotspotGrain | None:
    route_rows = _ladder_rows(counts, kind="route")
    stop_rows = _ladder_rows(counts, kind="stop")
    route_names = names.names_at("route", (row["route_id"] for row in route_rows), local_date)
    stop_names = names.names_at("stop", (row["stop_id"] for row in stop_rows), local_date)
    route_ladder = _hotspot_kind_ladder(route_rows, "route", route_names)
    stop_ladder = _hotspot_kind_ladder(stop_rows, "stop", stop_names)
    parsed = date.fromisoformat(local_date)
    width = {"day": 1, "week": 7, "month": 30}.get(grain)
    return _merge_grain(
        route_ladder,
        stop_ladder,
        grain=grain,
        win_start=None if width is None else parsed - timedelta(days=width - 1),
        win_end=None if width is None else parsed,
    )


def _iter_hotspots_days(
    *,
    route_rows: Iterable[Mapping[str, Any]],
    stop_rows: Iterable[Mapping[str, Any]],
    names: HistoryNameIndex,
) -> Iterator[HistoricHotspotsDay]:
    windows = {
        grain: _CountsWindow(width) for grain, width in (("day", 1), ("week", 7), ("month", 30))
    }
    peak_week = _CountsWindow(7)
    iso_week: _CountsWindow | None = None
    iso_key: tuple[int, int] | None = None
    for rendered_date, route_day, stop_day in _merge_date_groups(route_rows, stop_rows):
        parsed = date.fromisoformat(rendered_date)
        counts, peak_counts, timestamps = _daily_counts(route_day, stop_day)
        for window in windows.values():
            window.add_day(parsed, counts)
        peak_week.add_day(parsed, peak_counts)
        current_iso = (parsed.isocalendar().year, parsed.isocalendar().week)
        if current_iso != iso_key:
            iso_key = current_iso
            iso_week = _CountsWindow(7)
        assert iso_week is not None
        iso_week.add_day(parsed, counts)

        grains = [
            value
            for grain, window in windows.items()
            if (
                value := _grain(
                    window.totals,
                    grain=grain,
                    local_date=rendered_date,
                    names=names,
                )
            )
            is not None
        ]
        shift = _grain(
            peak_week.totals,
            grain="shift",
            local_date=rendered_date,
            names=names,
        )
        if shift is not None:
            grains.append(shift)
        payload = HistoricHotspotsDay(
            generated_utc=latest_history_timestamp(timestamps),
            methodology_version="reliability-1",
            publish_generation_id=None,
            date=rendered_date,
            hotspots=_scalar_hotspots(
                iso_week.totals,
                local_date=rendered_date,
                names=names,
            ),
            by_grain=grains,
        )
        size = len(snapshot_json_bytes(payload))
        if size > HOTSPOTS_BYTE_CEILING:
            raise ValueError(
                "Hotspots history payload exceeds the 256 KiB byte ceiling "
                f"({size} > {HOTSPOTS_BYTE_CEILING})"
            )
        yield payload


@dataclass(frozen=True)
class HotspotsHistoryPlan:
    """One-shot ordered inputs that yield one bounded as-of payload at a time."""

    route_rows: Iterable[Mapping[str, Any]]
    stop_rows: Iterable[Mapping[str, Any]]
    names: HistoryNameIndex

    def iter_days(self) -> Iterator[HistoricHotspotsDay]:
        return _iter_hotspots_days(
            route_rows=self.route_rows,
            stop_rows=self.stop_rows,
            names=self.names,
        )

    def materialize(self) -> list[HistoricHotspotsDay]:
        """Compatibility helper for bounded pure-test callers."""

        return list(self.iter_days())


def build_hotspots_history_plan_from_rows(
    *,
    route_rows: Iterable[Mapping[str, Any]],
    stop_rows: Iterable[Mapping[str, Any]],
    name_rows: Iterable[Mapping[str, Any]],
    provider_timezone: str,
) -> HotspotsHistoryPlan:
    """Build the streaming plan from already ordered source rows."""

    return HotspotsHistoryPlan(
        route_rows=route_rows,
        stop_rows=stop_rows,
        names=HistoryNameIndex(name_rows, provider_timezone=provider_timezone),
    )


def build_hotspots_history_plan(
    conn: Connection,
    provider_id: str = "stm",
) -> HotspotsHistoryPlan:
    """Read the four fixed production streams exactly once."""

    params = {"provider_id": provider_id}
    timezone_row = conn.execute(_HOTSPOTS_HISTORY_TIMEZONE_SQL, params).mappings().fetchone()
    if timezone_row is None or not isinstance(timezone_row.get("timezone"), str):
        raise ValueError(f"Hotspots history provider {provider_id!r} has no timezone")
    name_rows = conn.execute(_HOTSPOTS_HISTORY_NAMES_SQL, params).mappings()
    names = HistoryNameIndex(name_rows, provider_timezone=timezone_row["timezone"])
    route_rows = conn.execute(_HOTSPOTS_HISTORY_ROUTE_DAILY_SQL, params).mappings()
    stop_rows = conn.execute(_HOTSPOTS_HISTORY_STOP_DAILY_SQL, params).mappings()
    return HotspotsHistoryPlan(route_rows=route_rows, stop_rows=stop_rows, names=names)


__all__ = [
    "HotspotsHistoryPlan",
    "build_hotspots_history_plan",
    "build_hotspots_history_plan_from_rows",
]
