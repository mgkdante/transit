"""Full-retention Repeat Offenders payloads as of each closed local day."""

from __future__ import annotations

from collections import deque
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING, Any

from transit_ops.snapshots.builders.historic.history_common import (
    HistoryNameIndex,
    history_row_int,
    history_row_timestamp,
    iter_history_date_groups,
    latest_history_timestamp,
)
from transit_ops.snapshots.builders.historic.ranking_kernel import (
    OFFENDER_SEVERITY_CRITICAL_AVG_SECONDS,
    OFFENDER_SEVERITY_CRITICAL_RECURRENCE,
    OFFENDER_SEVERITY_HIGH_RECURRENCE,
    OFFENDERS_TRAY_CAP,
    build_offender_kind_ladder,
)
from transit_ops.snapshots.contract import (
    REPEAT_OFFENDERS_BYTE_CEILING,
    HistoricRepeatOffenderGrain,
    HistoricRepeatOffendersDay,
    Offender,
)
from transit_ops.snapshots.serialization import snapshot_json_bytes
from transit_ops.sql_registry import named_query

if TYPE_CHECKING:  # pragma: no cover - typing only
    from sqlalchemy.engine import Connection


_REPEAT_OFFENDERS_HISTORY_TIMEZONE_SQL = named_query(
    "history.repeat_offenders.timezone",
    """
    SELECT dp.timezone
    FROM gold.dim_provider AS dp
    WHERE dp.provider_id = :provider_id
    """,
)

_REPEAT_OFFENDERS_HISTORY_NAMES_SQL = named_query(
    "history.repeat_offenders.names",
    """
    SELECT 'route'::text AS entity_kind,
           h.route_id AS entity_id,
           COALESCE(h.route_long_name, h.route_short_name) AS name,
           h.valid_from_utc,
           h.valid_to_utc
    FROM gold.dim_route_history AS h
    WHERE h.provider_id = :provider_id
    ORDER BY entity_id, valid_from_utc, valid_to_utc NULLS LAST
    """,
)

_REPEAT_OFFENDERS_HISTORY_DAILY_SQL = named_query(
    "history.repeat_offenders.daily",
    """
    SELECT sp.provider_local_date AS local_date,
           sp.entity_kind,
           sp.entity_id,
           sp.route_id,
           sp.observation_count::bigint AS observation_count,
           sp.severe_delay_count::bigint AS severe_count,
           sp.sum_delay_seconds::bigint AS sum_delay_seconds,
           sp.built_at_utc AS source_generated_utc
    FROM gold.repeat_offender_daily_spine AS sp
    JOIN gold.dim_provider AS dp ON dp.provider_id = sp.provider_id
    WHERE sp.provider_id = :provider_id
      AND sp.provider_local_date < timezone(dp.timezone, now())::date
    ORDER BY sp.provider_local_date, sp.entity_kind, sp.entity_id, sp.route_id
    """,
)


_EntityKey = tuple[str, str, str]
_SCALAR_WINDOW_DAYS = 14
_SCALAR_MIN_RECURRENCE = 3


@dataclass(frozen=True)
class _Counts:
    present: int = 0
    recurrence_days: int = 0
    observation_count: int = 0
    severe_count: int = 0
    sum_delay_seconds: int = 0

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


class _CountsWindow:
    """Bounded additive calendar window; every daily key enters and leaves once."""

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
        raise ValueError(f"Repeat Offenders history {field} must be nonempty")
    return value


def _daily_counts(
    rows: Iterable[Mapping[str, Any]],
) -> tuple[dict[_EntityKey, _Counts], list[str]]:
    counts: dict[_EntityKey, _Counts] = {}
    timestamps: list[str] = []
    for row in rows:
        kind = row.get("entity_kind")
        if kind not in {"trip", "vehicle"}:
            raise ValueError("Repeat Offenders history entity_kind must be trip or vehicle")
        entity_id = _required_id(row, "entity_id")
        route_id = _required_id(row, "route_id")
        key = (kind, entity_id, route_id)
        if key in counts:
            raise ValueError("Repeat Offenders history source contains a duplicate daily identity")
        observation_count = history_row_int(row, "observation_count") or 0
        severe_count = history_row_int(row, "severe_count") or 0
        sum_delay_seconds = history_row_int(row, "sum_delay_seconds", minimum=None) or 0
        if severe_count > observation_count:
            raise ValueError(
                "Repeat Offenders history severe_count cannot exceed observation_count"
            )
        counts[key] = _Counts(
            present=1,
            recurrence_days=int(severe_count > 0),
            observation_count=observation_count,
            severe_count=severe_count,
            sum_delay_seconds=sum_delay_seconds,
        )
        timestamps.append(history_row_timestamp(row))
    return counts, timestamps


def _postgres_avg_seconds(counts: _Counts) -> Decimal | None:
    """Mirror ``ROUND(AVG(delay_seconds)::numeric, 1)`` from the fixed mart."""

    if counts.observation_count <= 0:
        return None
    return (Decimal(counts.sum_delay_seconds) / Decimal(counts.observation_count)).quantize(
        Decimal("0.1"), rounding=ROUND_HALF_UP
    )


def _scalar_severity(recurrence_days: int, average_seconds: Decimal) -> str:
    """Apply the mutable mart's CASE to its already rounded seconds value."""

    if (
        recurrence_days >= OFFENDER_SEVERITY_CRITICAL_RECURRENCE
        or average_seconds > OFFENDER_SEVERITY_CRITICAL_AVG_SECONDS
    ):
        return "critical"
    if recurrence_days >= OFFENDER_SEVERITY_HIGH_RECURRENCE:
        return "high"
    return "watch"


def _scalar_offenders(
    counts: Mapping[_EntityKey, _Counts],
    *,
    local_date: str,
    names: HistoryNameIndex,
) -> list[Offender]:
    """Recompose the fixed scalar doctrine over 14 closed provider-local dates.

    The fixed mutable mart uses an instant ``now()-14d`` fact window, which can
    include an open local day and a partial oldest day. Exact newest scalar
    parity therefore applies only when that mutable source window is aligned to
    these same closed dates; immutable history never relaxes its closed-day rule.
    """

    ranked: list[tuple[int, Decimal, str, str, str, Offender]] = []
    for (kind, entity_id, route_id), value in counts.items():
        recurrence_days = value.recurrence_days
        if recurrence_days < _SCALAR_MIN_RECURRENCE:
            continue
        average_seconds = _postgres_avg_seconds(value)
        if average_seconds is None:
            continue
        # The scalar mart applies its CASE after rounding avg seconds to 1 dp.
        # By-grain severity deliberately remains on the unrounded pooled mean.
        severity = _scalar_severity(recurrence_days, average_seconds)
        ranked.append(
            (
                recurrence_days,
                average_seconds,
                kind,
                entity_id,
                route_id,
                Offender(
                    type=kind,
                    id=entity_id,
                    route=route_id,
                    route_name=names.name_at("route", route_id, local_date),
                    recurrence=f"{recurrence_days}/{_SCALAR_WINDOW_DAYS}d",
                    recurrence_days=recurrence_days,
                    window_days=_SCALAR_WINDOW_DAYS,
                    # Keep the fixed compatibility builder's Python-round display
                    # behavior after applying the mart's numeric seconds rounding.
                    avg_delay_min=round(float(average_seconds) / 60.0, 1),
                    severity=severity,
                ),
            )
        )
    ranked.sort(key=lambda value: (-value[0], -value[1], value[2], value[3], value[4]))
    return [value[5] for value in ranked[:50]]


def _grain(
    counts: Mapping[_EntityKey, _Counts],
    *,
    grain: str,
    width_days: int,
    local_date: str,
    names: HistoryNameIndex,
) -> HistoricRepeatOffenderGrain | None:
    route_names = names.names_at(
        "route",
        (route_id for _kind, _entity_id, route_id in counts),
        local_date,
    )
    rows = [
        {
            "entity_kind": kind,
            "entity_id": entity_id,
            "route_id": route_id,
            "obs": value.observation_count,
            "severe": value.severe_count,
            "sum_delay_sec": value.sum_delay_seconds,
            "recurrence_days": value.recurrence_days,
            "observed_days": value.present,
            "window_days": width_days,
        }
        for (kind, entity_id, route_id), value in sorted(counts.items())
    ]
    trip_rows = [row for row in rows if row["entity_kind"] == "trip"]
    vehicle_rows = [row for row in rows if row["entity_kind"] == "vehicle"]
    trip_entries, trip_total, trip_tray = build_offender_kind_ladder(trip_rows, "trip", route_names)
    vehicle_entries, vehicle_total, vehicle_tray = build_offender_kind_ladder(
        vehicle_rows, "vehicle", route_names
    )
    entries = trip_entries + vehicle_entries
    union = trip_tray + vehicle_tray
    tray_total = len(union)
    if not entries and tray_total == 0:
        return None
    union.sort(
        key=lambda entry: (
            -(entry.severe_pct or 0.0),
            entry.id,
            entry.type,
            str(entry.route or ""),
        )
    )
    parsed = date.fromisoformat(local_date)
    return HistoricRepeatOffenderGrain(
        grain=grain,
        date=(parsed - timedelta(days=width_days - 1)).isoformat(),
        window_end=local_date,
        window_days=width_days,
        entries=entries,
        tray=union[:OFFENDERS_TRAY_CAP],
        total_ranked_trips=trip_total,
        total_ranked_vehicles=vehicle_total,
        tray_total=tray_total,
    )


def _iter_repeat_offender_days(
    *,
    daily_rows: Iterable[Mapping[str, Any]],
    names: HistoryNameIndex,
) -> Iterator[HistoricRepeatOffendersDay]:
    windows = {width: _CountsWindow(width) for width in (7, 14, 30)}
    for rendered_date, source_rows in iter_history_date_groups(daily_rows):
        parsed = date.fromisoformat(rendered_date)
        counts, timestamps = _daily_counts(source_rows)
        for window in windows.values():
            window.add_day(parsed, counts)
        grains = [
            value
            for grain, width in (("week", 7), ("month", 30))
            if (
                value := _grain(
                    windows[width].totals,
                    grain=grain,
                    width_days=width,
                    local_date=rendered_date,
                    names=names,
                )
            )
            is not None
        ]
        payload = HistoricRepeatOffendersDay(
            generated_utc=latest_history_timestamp(timestamps),
            methodology_version="reliability-1",
            publish_generation_id=None,
            date=rendered_date,
            offenders=_scalar_offenders(
                windows[_SCALAR_WINDOW_DAYS].totals,
                local_date=rendered_date,
                names=names,
            ),
            by_grain=grains,
        )
        size = len(snapshot_json_bytes(payload))
        if size > REPEAT_OFFENDERS_BYTE_CEILING:
            raise ValueError(
                "Repeat Offenders history payload exceeds the 256 KiB byte ceiling "
                f"({size} > {REPEAT_OFFENDERS_BYTE_CEILING})"
            )
        yield payload


@dataclass(frozen=True)
class RepeatOffendersHistoryPlan:
    """One ordered daily source stream yielding bounded as-of payloads."""

    daily_rows: Iterable[Mapping[str, Any]]
    names: HistoryNameIndex

    def iter_days(self) -> Iterator[HistoricRepeatOffendersDay]:
        return _iter_repeat_offender_days(daily_rows=self.daily_rows, names=self.names)

    def materialize(self) -> list[HistoricRepeatOffendersDay]:
        """Compatibility helper for bounded pure-test callers."""

        return list(self.iter_days())


def build_repeat_offenders_history_plan_from_rows(
    *,
    daily_rows: Iterable[Mapping[str, Any]],
    name_rows: Iterable[Mapping[str, Any]],
    provider_timezone: str,
) -> RepeatOffendersHistoryPlan:
    """Build the streaming plan from an already ordered retained source."""

    return RepeatOffendersHistoryPlan(
        daily_rows=daily_rows,
        names=HistoryNameIndex(name_rows, provider_timezone=provider_timezone),
    )


def build_repeat_offenders_history_plan(
    conn: Connection,
    provider_id: str = "stm",
) -> RepeatOffendersHistoryPlan:
    """Read the three fixed production inputs exactly once."""

    params = {"provider_id": provider_id}
    timezone_row = (
        conn.execute(_REPEAT_OFFENDERS_HISTORY_TIMEZONE_SQL, params).mappings().fetchone()
    )
    if timezone_row is None or not isinstance(timezone_row.get("timezone"), str):
        raise ValueError(f"Repeat Offenders history provider {provider_id!r} has no timezone")
    name_rows = conn.execute(_REPEAT_OFFENDERS_HISTORY_NAMES_SQL, params).mappings()
    names = HistoryNameIndex(name_rows, provider_timezone=timezone_row["timezone"])
    daily_rows = conn.execute(_REPEAT_OFFENDERS_HISTORY_DAILY_SQL, params).mappings()
    return RepeatOffendersHistoryPlan(daily_rows=daily_rows, names=names)


__all__ = [
    "RepeatOffendersHistoryPlan",
    "build_repeat_offenders_history_plan",
    "build_repeat_offenders_history_plan_from_rows",
]
