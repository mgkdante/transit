from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from itertools import groupby
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


PollFailure = Literal[
    "not_stored",
    "unusable_not_processed",
    "unusable_not_advanced",
    "unusable_stale",
    "unusable_empty",
]


class PollVerdict(NamedTuple):
    """One poll and its first failing test; reason=None means usable.

    not_stored belongs to attempted-minus-stored, not a stored-poll counter.
    Decoding is unknown here: C3 must obtain unusable_not_decoded from the reader
    or leave that counter null.
    """

    poll: PollFacts
    reason: PollFailure | None


def _validate_times(polls: Sequence[PollFacts], spans: Sequence[tuple[datetime, datetime]]) -> None:
    times = [time for p in polls for time in (p.time_utc, p.feed_timestamp_utc) if time is not None]
    times.extend(time for span in spans for time in span)
    if any(time.utcoffset() is None for time in times):
        raise ValueError("poll and service span times must have a time zone")
    if any(end < start for start, end in spans):
        raise ValueError("service span ends before it starts")


def _poll_failure(
    poll: PollFacts,
    previous: datetime | None,
    consumed: Collection[CaptureKey] | None,
    spans: Sequence[tuple[datetime, datetime]],
    lag: int,
) -> PollFailure | None:
    if poll.status != "stored":
        return "not_stored"  # Undecoded payloads already have failed status.
    processed = poll.capture in consumed if consumed is not None else poll.processed is True
    if not processed:
        return "unusable_not_processed"
    exempt = poll.feed == "alerts" and poll.feed_timestamp_source == "capture_time"
    if not exempt:
        timestamp = poll.feed_timestamp_utc
        if (
            poll.feed_timestamp_source != "header"
            or timestamp is None
            or (previous is not None and timestamp <= previous)
        ):
            return "unusable_not_advanced"
        if (poll.time_utc - timestamp).total_seconds() > FRESH_FEED_AGE_SECONDS + lag:
            return "unusable_stale"
    if poll.entity_count is None or (
        poll.entity_count == 0
        and poll.feed != "alerts"
        and any(start <= poll.time_utc <= end for start, end in spans)
    ):
        return "unusable_empty"
    return None


def judge_polls(
    polls: Sequence[PollFacts],
    *,
    read_source: ReadSource,
    consumed_captures: Collection[CaptureKey] | None,
    service_spans: Sequence[tuple[datetime, datetime]],
    source_lag_seconds: int,
) -> list[PollVerdict]:
    """Judge once, in stable time order, returning the first failed test per poll.

    Callers count stored failures by reason. No list means the caller supplies a
    span covering the whole window; no service means an empty span sequence.
    Equal-time polls share earlier history, independently of their input order.
    """
    if read_source == "daily_pass" and consumed_captures is None:
        raise ValueError("daily_pass requires consumed_captures")
    if source_lag_seconds < 0:
        raise ValueError("source_lag_seconds must not be negative")
    _validate_times(polls, service_spans)
    newest: dict[Feed, datetime] = {}
    verdicts: list[PollVerdict] = []
    for _, group in groupby(sorted(polls, key=lambda p: p.time_utc), key=lambda p: p.time_utc):
        batch = list(group)
        verdicts.extend(
            PollVerdict(
                p,
                _poll_failure(
                    p,
                    newest.get(p.feed),
                    consumed_captures,
                    service_spans,
                    source_lag_seconds,
                ),
            )
            for p in batch
        )
        for poll in batch:
            timestamp = poll.feed_timestamp_utc
            if timestamp is not None:
                newest[poll.feed] = max(timestamp, newest.get(poll.feed, timestamp))
    return verdicts


def usable_polls(
    polls: Sequence[PollFacts],
    *,
    read_source: ReadSource,
    consumed_captures: Collection[CaptureKey] | None,
    service_spans: Sequence[tuple[datetime, datetime]],
    source_lag_seconds: int,
) -> list[PollFacts]:
    """Return usable polls unchanged, in stable ascending time order.

    With no list, pass a span covering the window; with no service, pass [].
    """
    return [
        v.poll
        for v in judge_polls(
            polls,
            read_source=read_source,
            consumed_captures=consumed_captures,
            service_spans=service_spans,
            source_lag_seconds=source_lag_seconds,
        )
        if v.reason is None
    ]


def covered_intervals(usable: Sequence[PollFacts]) -> list[CoveredInterval]:
    """Join usable polls of one feed at spacings up to and including the limit."""
    _validate_times(usable, ())
    if len({poll.feed for poll in usable}) > 1:
        raise ValueError("covered_intervals requires a single feed")
    intervals: list[CoveredInterval] = []
    for poll in sorted(usable, key=lambda p: p.time_utc):
        if (
            intervals
            and (poll.time_utc - intervals[-1].end_utc).total_seconds()
            <= USABLE_SPACING_MAX_SECONDS
        ):
            last = intervals[-1]
            intervals[-1] = CoveredInterval(
                last.start_utc, poll.time_utc, last.usable_poll_count + 1
            )
        else:
            intervals.append(CoveredInterval(poll.time_utc, poll.time_utc, 1))
    return intervals
