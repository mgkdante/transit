from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from fractions import Fraction
from typing import Literal

from .rules import MeasureSpec, RankingRules

RankState = Literal[
    "ranked",
    "too_few_trips",
    "too_few_service_days",
    "too_few_units",
    "not_defined",
    "not_measured",
    "no_live_data",
]


_STATE_ORDER = (
    "too_few_trips",
    "too_few_service_days",
    "too_few_units",
    "not_defined",
    "not_measured",
    "no_live_data",
)


@dataclass(frozen=True)
class EntityWindow:
    entity_id: str
    service_class: str | None
    live_data: Literal["live", "no_live_data", "unresolved"]
    counts: Mapping[str, int]
    scheduled_days: int
    reading_days: int
    measured_days: Mapping[str, int]
    not_measured_reason: Mapping[str, str | None]
    groups: tuple[str, ...] = ()


@dataclass(frozen=True)
class RankedEntity:
    entity_id: str
    state: RankState
    reason: str | None
    rank: int | None
    numerator: int | None
    denominator: int | None
    shown_units: int | None


def shown_units(
    numerator: int, denominator: int, spec: MeasureSpec, *, precision: int | None = None
) -> int:
    """Return exact half-away-from-zero units at the requested display precision."""
    p = spec.precision if precision is None else precision
    if denominator <= 0 or p < 0 or min(spec.scale) <= 0:
        raise ValueError("positive denominator/scale and nonnegative precision required")
    n: int = numerator * spec.scale[0] * 10**p
    d = denominator * spec.scale[1]
    return (-1 if n < 0 else 1) * ((2 * abs(n) + d) // (2 * d))


def measure_state(
    row: EntityWindow,
    spec: MeasureSpec,
    *,
    window_days: int,
    rules: RankingRules,
    network: Mapping[str, int] | None = None,
) -> RankState:
    if spec.precision < 0 or min(spec.scale) <= 0:
        raise ValueError("positive scale and nonnegative precision required")
    if (
        window_days <= 0
        or min(row.scheduled_days, row.reading_days, *row.measured_days.values()) < 0
    ):
        raise ValueError("positive window and nonnegative days required")
    if row.live_data == "no_live_data":
        return "no_live_data"
    if row.live_data == "unresolved" or row.scheduled_days == 0:
        return "not_measured"
    if row.measured_days[spec.series] * rules.measured_share[1] < (
        row.scheduled_days * rules.measured_share[0]
    ):
        return "not_measured"
    if spec.floor_trips is not None and row.counts[spec.floor_trips_of] < spec.floor_trips:
        return "too_few_trips"
    days = row.measured_days[spec.series] if spec.series == "service" else row.reading_days
    if spec.floor_service_days and days < _day_floor(window_days, row.scheduled_days, rules):
        return "too_few_service_days"
    if spec.floor_units is not None:
        if spec.floor_units_of is None:
            raise ValueError("a named units floor is required")
        if row.counts[spec.floor_units_of] < spec.floor_units:
            return "too_few_units"
    if _denominator(row, spec, network) == 0:
        return "not_defined"
    return "ranked"


def _denominator(row: EntityWindow, spec: MeasureSpec, network: Mapping[str, int] | None) -> int:
    if spec.denominator is None:
        return 1
    source = network if spec.denominator_from == "network" else row.counts
    if source is None:
        raise ValueError("network counts are required")
    d = source[spec.denominator]
    if d < 0:
        raise ValueError("negative denominator")
    return d


def _day_floor(window: int, scheduled: int, rules: RankingRules) -> int:
    if window <= 3:
        return window
    minimum, (n, d) = rules.service_day_range
    base = rules.service_day_base.get(
        {7: "trailing_7", 30: "trailing_30"}.get(window, ""),
        min(window, max(minimum, (window * n + d - 1) // d)),
    )
    return min(base, max(rules.service_day_never_below, scheduled))


def rank_entities(
    rows: Sequence[EntityWindow],
    *,
    spec: MeasureSpec,
    window_days: int,
    rules: RankingRules,
    network: Mapping[str, int] | None = None,
) -> list[RankedEntity]:
    """Rank eligible entities, retaining every other row in state/id order."""
    if spec.pair is not None:
        raise NotImplementedError("paired tie-breaking is not implemented")
    if rules.rounding != "half_away_from_zero" or rules.tie_order != (
        "exact_value",
        "pair",
        "trips_desc",
        "id_code_point",
    ):
        raise ValueError("unsupported rounding or tie order")
    if spec.numerator is None:
        raise ValueError("a named numerator is required")
    ordered = []
    unranked = []
    for row in rows:
        state = measure_state(row, spec, window_days=window_days, rules=rules, network=network)
        item = _result(row, spec, state, network)
        if state != "ranked":
            unranked.append(item)
            continue
        n, d = row.counts[spec.numerator], _denominator(row, spec, network)
        value = Fraction(n * spec.scale[0], d * spec.scale[1])
        key = value if spec.worse == "lower" else -value
        ordered.append((key, -row.counts[spec.floor_trips_of], row.entity_id, item))
    result = []
    previous = None
    rank = 0
    for position, (_, _, _, item) in enumerate(sorted(ordered), 1):
        if item.shown_units != previous:
            rank = position
        result.append(replace(item, rank=rank))
        previous = item.shown_units
    return result + sorted(
        unranked, key=lambda item: (_STATE_ORDER.index(item.state), item.entity_id)
    )


def _result(
    row: EntityWindow, spec: MeasureSpec, state: RankState, network: Mapping[str, int] | None
) -> RankedEntity:
    reason = None
    n = d = units = None
    if state == "not_measured":
        reason = (
            "applicability_unresolved"
            if row.live_data == "unresolved"
            else row.not_measured_reason.get(spec.series)
        )
    elif state != "no_live_data":
        if spec.numerator is None:
            raise ValueError("a named numerator is required")
        n = row.counts[spec.numerator]
        divisor = _denominator(row, spec, network)
        d = None if spec.denominator is None else divisor
        units = shown_units(n, divisor, spec) if divisor else None
    return RankedEntity(row.entity_id, state, reason, None, n, d, units)
