from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal, NamedTuple

Feed = Literal["trip_updates", "vehicle_positions", "alerts"]
ReadSource = Literal["worker_facts", "daily_pass"]  # the source a consumer reads

RULES_VERSION = 1
USABLE_SPACING_MAX_SECONDS = 120  # usable polls further apart than this leave an uncovered gap
FRESH_FEED_AGE_SECONDS = 120  # plus the provider's declared source lag (live_source_lag_seconds)
# Share of a line's or a network's scheduled trips that must be measured.
MIN_MEASURED_TRIP_SHARE = 0.90
# Usable polls that must lie inside a window before absence is judged.
ABSENCE_MIN_USABLE_POLLS = 4


@dataclass(frozen=True)
class CoverageFloor:
    min_share: float  # share of the window's seconds inside covered intervals
    max_gap_seconds: int | None  # longest uncovered stretch allowed; None for no limit


ABSENCE_FLOOR = CoverageFloor(
    min_share=0.80, max_gap_seconds=300
)  # to say something did not appear
# To publish a rate over captured minutes.
RATE_FLOOR = CoverageFloor(min_share=0.80, max_gap_seconds=None)


# A capture is named by its index family and its row id, never by a bare id.
class CaptureKey(NamedTuple):
    index_family: str  # "realtime_snapshot" or "alert_snapshot"
    # A plain pair (index family, row id) is equal to it, so a caller may pass tuples.
    capture_row_id: int


@dataclass(frozen=True)
class PollFacts:  # one poll attempt, mapped from S0.6's Poll, Capture and ProcessingRecord
    feed: Feed
    time_utc: datetime  # Poll.time_utc
    status: Literal["stored", "failed", "skipped_identical", "unfinished", "capture_missing"]
    capture: CaptureKey | None  # None when nothing was stored
    feed_timestamp_utc: datetime | None
    # capture_time: the feed gave no timestamp of its own
    feed_timestamp_source: Literal["header", "capture_time"] | None
    entity_count: int | None
    processed: bool | None  # into the source the consumer reads; None when it cannot be known


@dataclass(frozen=True)
class CoveredInterval:
    start_utc: datetime
    end_utc: datetime
    usable_poll_count: int


@dataclass(frozen=True)
class WindowCoverage:
    window_seconds: int
    covered_seconds: int
    covered_share: float | None  # None when window_seconds is 0: never 0% and never 100%
    longest_gap_seconds: int | None
    # Usable polls inside the window; a guaranteed lower bound when only intervals are given.
    usable_poll_count: int | None
    verdict: Literal["covered", "not_covered", "too_short", "no_window"]
    basis: Literal["polls", "summary_5m"]


@dataclass(frozen=True)
class CoverageBuild:
    provider_id: str
    service_date: date
    read_source: ReadSource
    rules_version: int  # RULES_VERSION when the rows were written
    # Per feed: S0.6's reason when its window is not available, else None.
    reader_states: Mapping[Feed, str | None]
    usable_poll_counts: Mapping[Feed, int]


NOT_MEASURED_REASONS: tuple[str, ...] = (
    "schedule_not_kept",
    "captures_not_available",
    "no_capture_record",
    "capture_gap",
    "window_too_short",
    "applicability_unresolved",
    "schedule_mismatch",
)
