from collections.abc import Collection, Sequence
from datetime import date, datetime, timedelta

from transit_ops.capture_coverage.rules import (
    RULES_VERSION,
    CaptureKey,
    CoverageBuild,
    CoveredInterval,
    Feed,
    PollFacts,
    ReadSource,
)


def make_polls(
    feed: Feed,
    start_utc: datetime,
    end_utc: datetime,
    *,
    every_seconds: int = 30,
    index_family: str = "realtime_snapshot",
    first_row_id: int = 1,
    outages: Sequence[tuple[datetime, datetime]] = (),
) -> list[PollFacts]:
    times = (start_utc, end_utc, *(time for span in outages for time in span))
    if any(time.utcoffset() is None for time in times):
        raise ValueError("poll times must have a time zone")
    if every_seconds <= 0 or end_utc < start_utc:
        raise ValueError("poll spacing must be positive and end must not precede start")
    polls = []
    time = start_utc
    row_id = first_row_id
    while time <= end_utc:
        if any(start <= time <= end for start, end in outages):
            polls.append(PollFacts(feed, time, "failed", None, None, None, None, None))
        else:
            polls.append(
                PollFacts(
                    feed, time, "stored", CaptureKey(index_family, row_id), time, "header", 1, True
                )
            )
            row_id += 1
        time += timedelta(seconds=every_seconds)
    return polls


def make_intervals(
    *spans: tuple[datetime, datetime], every_seconds: int = 30
) -> list[CoveredInterval]:
    if every_seconds <= 0:
        raise ValueError("poll spacing must be positive")
    intervals = []
    for start, end in sorted(spans):
        if end < start:
            raise ValueError("interval end must not precede start")
        if intervals and start <= intervals[-1].end_utc:
            raise ValueError("intervals must not overlap")
        count = (end - start) // timedelta(seconds=every_seconds) + 1
        intervals.append(CoveredInterval(start, end, count))
    return intervals


def consumed_of(polls: Sequence[PollFacts]) -> set[CaptureKey]:
    return {poll.capture for poll in polls if poll.status == "stored" and poll.capture is not None}


class RecordingCoverageBuilder:
    def __init__(self, result: CoverageBuild | None = None) -> None:
        self.result = result
        self.calls: list[dict[str, object]] = []

    def __call__(
        self,
        connection: object,
        *,
        provider_id: str,
        service_date: date,
        read_source: ReadSource = "daily_pass",
        consumed_captures: Collection[tuple[str, int]] | None,
        storage: object = None,
    ) -> CoverageBuild:
        if read_source == "daily_pass" and consumed_captures is None:
            raise ValueError("daily_pass requires consumed_captures")
        self.calls.append(
            {
                "connection": connection,
                "provider_id": provider_id,
                "service_date": service_date,
                "read_source": read_source,
                "consumed_captures": consumed_captures,
                "storage": storage,
            }
        )
        if self.result is not None:
            return self.result
        feeds: tuple[Feed, ...] = ("trip_updates", "vehicle_positions", "alerts")
        return CoverageBuild(
            provider_id,
            service_date,
            read_source,
            RULES_VERSION,
            reader_states=dict.fromkeys(feeds),
            usable_poll_counts=dict.fromkeys(feeds, 0),
        )
