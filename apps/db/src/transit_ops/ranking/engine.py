from collections.abc import Mapping, Sequence
from dataclasses import dataclass
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


@dataclass(frozen=True)
class EntityWindow:
    entity_id: str
    counts: Mapping[str, int]


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


def rank_entities(
    rows: Sequence[EntityWindow],
    *,
    spec: MeasureSpec,
    window_days: int,
    rules: RankingRules,
    network: Mapping[str, int] | None = None,
) -> list[RankedEntity]:
    """Rank unique, already-eligible entities over positive window_days; no floors evaluated."""
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
    source = network if spec.denominator_from == "network" else None
    if spec.denominator is not None and spec.denominator_from == "network" and source is None:
        raise ValueError("network counts are required")
    ordered = []
    for row in rows:
        n = row.counts[spec.numerator]
        counts = row.counts if source is None else source
        d = 1 if spec.denominator is None else counts[spec.denominator]
        units = shown_units(n, d, spec)
        value = Fraction(n * spec.scale[0], d * spec.scale[1])
        key = value if spec.worse == "lower" else -value
        ordered.append((key, -row.counts[spec.floor_trips_of], row.entity_id, n, d, units))
    ordered.sort()
    result = []
    previous = None
    rank = 0
    for position, (_, _, entity_id, n, d, units) in enumerate(ordered, 1):
        if units != previous:
            rank = position
        result.append(
            RankedEntity(
                entity_id, "ranked", None, rank, n, None if spec.denominator is None else d, units
            )
        )
        previous = units
    return result
