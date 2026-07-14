"""Shared ranking doctrine for current and immutable point-in-time surfaces."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date
from typing import Any, Literal, NamedTuple

from transit_ops.snapshots.builders._helpers import (
    MIN_N_RATE,
    _avg_delay_min,
    _iso_date,
    _opt_int,
    _otp_pct_severe_proxy,
    _severe_pct,
    _wilson_hi,
    _wilson_lo,
)
from transit_ops.snapshots.contract import HotspotEntry, HotspotGrain, RepeatOffenderEntry

type RankingRow = Mapping[str, Any]
type EntityNameMap = Mapping[str, str | None]
type HotspotKind = Literal["route", "stop"]
type OffenderKind = Literal["trip", "vehicle"]

SENTINEL_ENTITY_IDS = frozenset({"__unrouted__", "__unknown_stop__"})

MIN_N_HOTSPOT = MIN_N_RATE
HOTSPOTS_BY_GRAIN_CAP = 50
HOTSPOTS_TRAY_CAP = 60
HOTSPOT_PEAK_SHIFTS = ("am_peak", "pm_peak")

MIN_N_OFFENDER = MIN_N_RATE
OFFENDERS_BY_GRAIN_CAP = 50
OFFENDERS_TRAY_CAP = 60
OFFENDERS_GRAINS = ("week", "month")
OFFENDER_TRAY_MIN_RECURRENCE = 2
OFFENDER_SEVERITY_CRITICAL_RECURRENCE = 10
OFFENDER_SEVERITY_CRITICAL_AVG_SECONDS = 600
OFFENDER_SEVERITY_HIGH_RECURRENCE = 5


def otp_delta_points(cell_otp: int | None, network_otp: int | None) -> float | None:
    """Return entity OTP minus network OTP in percentage points, or honest ``None``."""

    if cell_otp is None or network_otp is None:
        return None
    return round(float(cell_otp) - float(network_otp), 1)


def _hotspot_ranked_entry(
    row: RankingRow,
    kind: HotspotKind,
    names: EntityNameMap,
    *,
    network_severe_pct: float | None,
) -> tuple[float, float, str, HotspotEntry] | None:
    observation_count = int(row["obs"] or 0)
    severe_count = int(row["severe"] or 0)
    id_column = "route_id" if kind == "route" else "stop_id"
    entity_id = str(row[id_column])
    if observation_count < MIN_N_HOTSPOT:
        return None
    not_severe_count = observation_count - severe_count
    wilson_lo = _wilson_lo(not_severe_count, observation_count)
    wilson_hi = _wilson_hi(not_severe_count, observation_count)
    if wilson_lo is None:
        return None
    sum_seconds = row["sum_delay_sec"]
    average_minutes = (
        _avg_delay_min(float(sum_seconds) / observation_count) if sum_seconds is not None else None
    )
    cell_otp = _otp_pct_severe_proxy(observation_count, severe_count)
    network_otp = None if network_severe_pct is None else 100.0 - network_severe_pct
    entry = HotspotEntry(
        rank=None,
        type=kind,
        id=entity_id,
        name=names.get(entity_id),
        otp_delta_pts=otp_delta_points(cell_otp, network_otp),
        observation_count=_opt_int(observation_count),
        severe_count=_opt_int(severe_count),
        severe_pct=_severe_pct(observation_count, severe_count),
        wilson_lo=wilson_lo,
        wilson_hi=wilson_hi,
        avg_delay_min=average_minutes,
    )
    return (wilson_lo, -(average_minutes or 0.0), entity_id, entry)


def _hotspot_tray_entry(
    row: RankingRow,
    kind: HotspotKind,
    names: EntityNameMap,
) -> HotspotEntry:
    observation_count = int(row["obs"] or 0)
    severe_count = int(row["severe"] or 0)
    id_column = "route_id" if kind == "route" else "stop_id"
    entity_id = str(row[id_column])
    sum_seconds = row["sum_delay_sec"]
    average_minutes = (
        _avg_delay_min(float(sum_seconds) / observation_count)
        if sum_seconds is not None and observation_count
        else None
    )
    return HotspotEntry(
        rank=None,
        type=kind,
        id=entity_id,
        name=names.get(entity_id),
        observation_count=_opt_int(observation_count),
        severe_count=_opt_int(severe_count),
        severe_pct=_severe_pct(observation_count, severe_count),
        avg_delay_min=average_minutes,
    )


def _network_severe_pct(rows: list[RankingRow], kind: HotspotKind) -> float | None:
    id_column = "route_id" if kind == "route" else "stop_id"
    total_observations = sum(int(row["obs"] or 0) for row in rows if str(row[id_column]))
    total_severe = sum(int(row["severe"] or 0) for row in rows if str(row[id_column]))
    return _severe_pct(total_observations, total_severe) if total_observations else None


@dataclass(slots=True)
class HotspotKindLadder:
    """One kind's ranked entries plus raw below-floor rows for the shared tray."""

    kind: HotspotKind
    entries: list[HotspotEntry]
    total_ranked: int
    tray_rows: list[RankingRow]
    names: EntityNameMap


def build_hotspot_kind_ladder(
    rows: Iterable[RankingRow],
    kind: HotspotKind,
    names: EntityNameMap,
) -> HotspotKindLadder | None:
    """Rank one route or stop ladder while preserving the established doctrine."""

    materialized_rows: list[RankingRow] = list(rows)
    if not materialized_rows:
        return None
    network_severe_pct = _network_severe_pct(materialized_rows, kind)
    ranked: list[tuple[float, float, str, HotspotEntry]] = []
    tray_rows: list[RankingRow] = []
    for row in materialized_rows:
        entry = _hotspot_ranked_entry(
            row,
            kind,
            names,
            network_severe_pct=network_severe_pct,
        )
        if entry is None:
            tray_rows.append(row)
        else:
            ranked.append(entry)
    ranked.sort(key=lambda item: (item[0], item[1], item[2]))
    total_ranked = len(ranked)
    entries: list[HotspotEntry] = []
    for rank, item in enumerate(ranked[:HOTSPOTS_BY_GRAIN_CAP], start=1):
        entry = item[3]
        entry.rank = rank
        entries.append(entry)
    return HotspotKindLadder(kind, entries, total_ranked, tray_rows, names)


def _tray_severe(row: RankingRow) -> float:
    return _severe_pct(int(row["obs"] or 0), int(row["severe"] or 0)) or 0.0


def merge_hotspot_grain(
    route_ladder: HotspotKindLadder | None,
    stop_ladder: HotspotKindLadder | None,
    *,
    grain: str,
    window_start: date | None,
    window_end: date | None,
) -> HotspotGrain | None:
    """Assemble the two per-kind hotspot ladders and their shared below-floor tray."""

    route_entries = route_ladder.entries if route_ladder else []
    stop_entries = stop_ladder.entries if stop_ladder else []
    route_tray_rows = route_ladder.tray_rows if route_ladder else []
    stop_tray_rows = stop_ladder.tray_rows if stop_ladder else []
    entries = list(route_entries) + list(stop_entries)
    route_names = route_ladder.names if route_ladder else {}
    stop_names = stop_ladder.names if stop_ladder else {}
    union: list[tuple[float, str, RankingRow, HotspotKind, EntityNameMap]] = [
        (_tray_severe(row), str(row["route_id"]), row, "route", route_names)
        for row in route_tray_rows
    ]
    union += [
        (_tray_severe(row), str(row["stop_id"]), row, "stop", stop_names) for row in stop_tray_rows
    ]
    tray_total = len(union)
    if not entries and tray_total == 0:
        return None
    union.sort(key=lambda item: (-item[0], item[1]))
    tray = [
        _hotspot_tray_entry(row, kind, names)
        for _, _, row, kind, names in union[:HOTSPOTS_TRAY_CAP]
    ]
    return HotspotGrain(
        grain=grain,
        date=_iso_date(window_start) if window_start is not None else None,
        window_end=_iso_date(window_end) if window_end is not None else None,
        entries=entries,
        tray=tray,
        total_ranked_routes=(route_ladder.total_ranked if route_ladder else None),
        total_ranked_stops=(stop_ladder.total_ranked if stop_ladder else None),
        tray_total=tray_total,
    )


def offender_severity(recurrence_days: int | None, average_seconds: float | None) -> str | None:
    """Apply the established repeat-offender severity vocabulary."""

    if recurrence_days is None and average_seconds is None:
        return None
    recurrence = recurrence_days or 0
    if (
        recurrence >= OFFENDER_SEVERITY_CRITICAL_RECURRENCE
        or (average_seconds or 0.0) > OFFENDER_SEVERITY_CRITICAL_AVG_SECONDS
    ):
        return "critical"
    if recurrence >= OFFENDER_SEVERITY_HIGH_RECURRENCE:
        return "high"
    return "watch"


def _offender_pooled_average_seconds(sum_seconds: object, observation_count: int) -> float | None:
    return (
        float(sum_seconds) / observation_count
        if sum_seconds is not None and observation_count
        else None
    )


def _offender_window_value(sum_seconds: object, observation_count: int) -> float | None:
    return (
        _avg_delay_min(float(sum_seconds) / observation_count)
        if sum_seconds is not None and observation_count
        else None
    )


def _offender_ranked_entry(
    row: RankingRow,
    kind: OffenderKind,
    route_names: EntityNameMap,
) -> tuple[float, float, str, RepeatOffenderEntry] | None:
    observation_count = int(row["obs"] or 0)
    severe_count = int(row["severe"] or 0)
    entity_id = str(row["entity_id"])
    if observation_count < MIN_N_OFFENDER:
        return None
    not_severe_count = observation_count - severe_count
    wilson_lo = _wilson_lo(not_severe_count, observation_count)
    wilson_hi = _wilson_hi(not_severe_count, observation_count)
    if wilson_lo is None:
        return None
    recurrence_days = _opt_int(row["recurrence_days"])
    average_minutes = _offender_window_value(row["sum_delay_sec"], observation_count)
    route_id = row["route_id"]
    entry = RepeatOffenderEntry(
        rank=None,
        type=kind,
        id=entity_id,
        route=route_id,
        route_name=(route_names.get(str(route_id)) if route_id is not None else None),
        severity=offender_severity(
            recurrence_days,
            _offender_pooled_average_seconds(row["sum_delay_sec"], observation_count),
        ),
        observation_count=_opt_int(observation_count),
        severe_count=_opt_int(severe_count),
        severe_pct=_severe_pct(observation_count, severe_count),
        wilson_lo=wilson_lo,
        wilson_hi=wilson_hi,
        recurrence_days=recurrence_days,
        observed_days=_opt_int(row["observed_days"]),
        window_days=int(row["window_days"]),
        avg_delay_min=average_minutes,
    )
    return (wilson_lo, -(average_minutes or 0.0), entity_id, entry)


def _offender_tray_entry(
    row: RankingRow,
    kind: OffenderKind,
    route_names: EntityNameMap,
) -> RepeatOffenderEntry:
    observation_count = int(row["obs"] or 0)
    severe_count = int(row["severe"] or 0)
    route_id = row["route_id"]
    average_minutes = _offender_window_value(row["sum_delay_sec"], observation_count)
    recurrence_days = _opt_int(row["recurrence_days"])
    return RepeatOffenderEntry(
        rank=None,
        type=kind,
        id=str(row["entity_id"]),
        route=route_id,
        route_name=(route_names.get(str(route_id)) if route_id is not None else None),
        severity=offender_severity(
            recurrence_days,
            _offender_pooled_average_seconds(row["sum_delay_sec"], observation_count),
        ),
        observation_count=_opt_int(observation_count),
        severe_count=_opt_int(severe_count),
        severe_pct=_severe_pct(observation_count, severe_count),
        recurrence_days=recurrence_days,
        observed_days=_opt_int(row["observed_days"]),
        window_days=int(row["window_days"]),
        avg_delay_min=average_minutes,
    )


class OffenderKindLadder(NamedTuple):
    entries: list[RepeatOffenderEntry]
    total_ranked: int
    tray: list[RepeatOffenderEntry]


def build_offender_kind_ladder(
    rows: Iterable[RankingRow],
    kind: OffenderKind,
    route_names: EntityNameMap,
) -> OffenderKindLadder:
    """Rank one trip or vehicle ladder with stable input-order tie behavior."""

    ranked: list[tuple[float, float, str, RepeatOffenderEntry]] = []
    tray: list[RepeatOffenderEntry] = []
    for row in rows:
        entry = _offender_ranked_entry(row, kind, route_names)
        if entry is None:
            if (row["recurrence_days"] or 0) >= OFFENDER_TRAY_MIN_RECURRENCE:
                tray.append(_offender_tray_entry(row, kind, route_names))
        else:
            ranked.append(entry)
    ranked.sort(key=lambda item: (item[0], item[1], item[2]))
    total_ranked = len(ranked)
    entries: list[RepeatOffenderEntry] = []
    for rank, item in enumerate(ranked[:OFFENDERS_BY_GRAIN_CAP], start=1):
        entry = item[3]
        entry.rank = rank
        entries.append(entry)
    return OffenderKindLadder(entries, total_ranked, tray)
