from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

MAX_PUBLISHED_COUNT = 9007199254740991


@dataclass(frozen=True)
class MeasureSpec:
    id: str
    numerator: str | None
    denominator: str | None
    denominator_from: Literal["entity", "network"]
    scale: tuple[int, int]
    precision: int
    worse: Literal["lower", "higher"]
    series: str
    floor_trips: int | None
    floor_trips_of: str
    floor_units: int | None
    floor_units_of: str | None
    floor_service_days: bool
    pair: "MeasureSpec | None"


@dataclass(frozen=True)
class RankingRules:
    version: int
    default_measure: str
    measures: tuple[str, ...]
    windows: tuple[str, ...]
    rounding: Literal["half_away_from_zero"]
    badge_precision: int
    measured_share: tuple[int, int]
    service_day_base: Mapping[str, int]
    service_day_range: tuple[int, tuple[int, int]]
    service_day_never_below: int
    tie_order: tuple[str, ...]
    daytime_first_hour: int
    daytime_hours: int
    frequent_gap_seconds: int
    frequent_min_share: tuple[int, int]
    all_day_min_share: tuple[int, int]
    headline_patterns: tuple[str, ...]
    min_class_ranked: int
    relative_filter_share: tuple[int, int]
    relative_filter_small_class: int


RULES = RankingRules(
    version=1,
    default_measure="on_time_rate",
    measures=(
        "on_time_rate",
        "late_rate",
        "late_share",
        "late_avg",
        "early_rate",
        "avg_delay",
        "missing_trips",
        "cancellation_rate",
    ),
    windows=("day", "trailing_7", "trailing_30", "calendar_month", "range"),
    rounding="half_away_from_zero",
    badge_precision=0,
    measured_share=(4, 5),
    service_day_base={"day": 1, "trailing_7": 5, "trailing_30": 15},
    service_day_range=(5, (1, 2)),
    service_day_never_below=4,
    tie_order=("exact_value", "pair", "trips_desc", "id_code_point"),
    daytime_first_hour=6,
    daytime_hours=13,
    frequent_gap_seconds=600,
    frequent_min_share=(1, 2),
    all_day_min_share=(3, 4),
    headline_patterns=("frequent", "all_day"),
    min_class_ranked=3,
    relative_filter_share=(1, 4),
    relative_filter_small_class=4,
)
