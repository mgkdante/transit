from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Literal

from transit_ops.gold.reader.delay_hist import QuantileBin, merge_hist, quantile_bin
from transit_ops.gold.reader.histogram import SqlNumber, round_half_away

# MIN_N_RATE controls display confidence; emit raw counts, rates and Wilson bounds below it.
MIN_N_RATE = 30
WILSON_Z = 1.96

TRIP_FLOOR = 30
WindowKind = Literal["day", "trailing_7", "trailing_30", "calendar_month", "range"]


@dataclass(frozen=True)
class DayCount:
    """One entity/date, selected by the caller from closed full-basis days."""

    service_date: date
    successes: int
    readings: int
    trips: int


@dataclass(frozen=True)
class RateSummary:
    """Numeric floors only; coverage and publication permission belong to callers."""

    pct: float | None
    readings: int
    trips: int
    service_days: int
    evidence: Literal["counts", "tentative"]


def band_pct(count: int | None, known: int | None) -> float | None:
    """Describe supplied counts without suppressing small samples."""
    if count is None or known is None:
        return None
    if count < 0 or known < 0 or count > known:
        raise ValueError("Require 0 <= count <= known")
    if known == 0:
        return None
    return float(round_half_away(Decimal(100 * count) / Decimal(known), 1))


def late_avg_min(sum_late_delay_s: int | None, late: int | None) -> float | None:
    if sum_late_delay_s is None or late is None:
        return None
    if sum_late_delay_s < 0 or late < 0:
        raise ValueError("Late seconds and count must be nonnegative")
    if late == 0:
        return None
    return float(round_half_away(Decimal(sum_late_delay_s) / Decimal(late * 60), 1))


def min_service_days(window_days: int, scheduled_days: int) -> int:
    if window_days <= 0 or not 0 <= scheduled_days <= window_days:
        raise ValueError("Require a positive window and scheduled days within it")
    base = 1 if window_days == 1 else min(window_days, max(5, (window_days + 1) // 2))
    return min(base, max(4, scheduled_days))


def rate_summary(
    days: Sequence[DayCount], *, window: WindowKind, window_days: int, scheduled_days: int
) -> RateSummary:
    """Pool one row per entity/date; callers enforce basis, membership and coverage."""
    floor = min_service_days(window_days, scheduled_days)
    widths = {
        "day": (1,),
        "trailing_7": (7,),
        "trailing_30": (30,),
        "calendar_month": (28, 29, 30, 31),
    }
    if window != "range" and (window not in widths or window_days not in widths[window]):
        raise ValueError("Window kind and width disagree")
    dates = {day.service_date for day in days}
    if len(dates) != len(days) or len(days) > window_days:
        raise ValueError("Require unique dates within the window's capacity")
    for day in days:
        if min(day.successes, day.readings, day.trips) < 0 or day.successes > day.readings:
            raise ValueError("Invalid day counts")
    readings = sum(day.readings for day in days)
    trips = sum(day.trips for day in days)
    service_days = sum(day.readings > 0 for day in days)
    if service_days > scheduled_days:
        raise ValueError("Reading-bearing days exceed scheduled days")
    enough = trips >= TRIP_FLOOR and service_days >= floor
    return RateSummary(
        band_pct(sum(day.successes for day in days), readings),
        readings,
        trips,
        service_days,
        "counts" if enough else "tentative",
    )


def delay_bins(
    parts: Iterable[tuple[int, Sequence[int], Sequence[int]]],
) -> tuple[QuantileBin | None, QuantileBin | None]:
    bins, counts = merge_hist(parts, layout=2)
    return (quantile_bin(bins, counts, 0.5, layout=2), quantile_bin(bins, counts, 0.9, layout=2))


def otp_pct(on_time: SqlNumber | None, known: SqlNumber | None) -> int | None:
    if on_time is None or not known:
        return None
    known_obs = float(known)
    if known_obs <= 0:
        return None
    return int(round_half_away(100.0 * float(on_time) / known_obs, 0))


def otp_pct_severe_proxy(
    observation_count: SqlNumber | None, severe: SqlNumber | None
) -> int | None:
    """Stop OTP proxy: per-stop delay observations not severe over observations."""
    if not observation_count:
        return None
    obs = float(observation_count)
    if obs <= 0:
        return None
    return int(round_half_away(100.0 * (obs - float(severe or 0)) / obs, 0))


def wilson_bounds(
    successes: SqlNumber | None, n: SqlNumber | None, *, z: float = WILSON_Z
) -> tuple[float, float] | None:
    if successes is None or not n:
        return None
    total = float(n)
    if total <= 0:
        return None
    k = min(max(float(successes), 0.0), total)
    p = k / total
    z2 = z * z
    denom = 1.0 + z2 / total
    center = (p + z2 / (2.0 * total)) / denom
    margin = z * ((p * (1.0 - p) / total + z2 / (4.0 * total * total)) ** 0.5) / denom
    lo = max(0.0, (center - margin) * 100.0)
    hi = min(100.0, (center + margin) * 100.0)
    return (float(round_half_away(lo, 1)), float(round_half_away(hi, 1)))


def wilson_lo(
    successes: SqlNumber | None, n: SqlNumber | None, *, z: float = WILSON_Z
) -> float | None:
    b = wilson_bounds(successes, n, z=z)
    return None if b is None else b[0]


def wilson_hi(
    successes: SqlNumber | None, n: SqlNumber | None, *, z: float = WILSON_Z
) -> float | None:
    b = wilson_bounds(successes, n, z=z)
    return None if b is None else b[1]


def avg_delay_min(avg_delay_seconds: SqlNumber | None) -> float | None:
    if avg_delay_seconds is None:
        return None
    return float(round_half_away(float(avg_delay_seconds) / 60.0, 1))


def severe_pct(observation_count: SqlNumber | None, severe: SqlNumber | None) -> float | None:
    if not observation_count:
        return None
    obs = float(observation_count)
    if obs <= 0:
        return None
    return float(round_half_away(100.0 * float(severe or 0) / obs, 1))
