import json
from collections import UserDict
from dataclasses import asdict, replace
from datetime import UTC, date, datetime, timedelta
from types import MappingProxyType

import pytest

from transit_ops.history.poll_record import CaptureEntry, FeedDayKey, PollEntry, PollRecord
from transit_ops.live.oracle.window import CycleSpec, EditionInput, ReplayWindow, WindowInvalid


def entries(number: int, family: str, at: datetime) -> tuple[CaptureEntry, PollEntry]:
    capture = CaptureEntry(
        family,
        number,
        number + 10,
        number + 20,
        False,
        None,
        None,
        4,
        "a" * 64,
        "local",
        f"capture/{number}",
        "realtime",
        None,
        at,
        at,
        at,
        at,
        "header",
        None,
        200,
        None,
        None,
    )
    poll = PollEntry(
        number + 10,
        "capture",
        "stored",
        "succeeded",
        None,
        at,
        at,
        at,
        200,
        None,
        at,
        "header",
        None,
        family,
        number,
        None,
        None,
    )
    return capture, poll


def window() -> ReplayWindow:
    at = datetime(2026, 1, 2, 12, 0, 0, 123456, tzinfo=UTC)
    records = []
    for number, family in enumerate(("realtime_snapshot", "alert_snapshot"), 1):
        capture, poll = entries(number, family, at)
        records.append(
            PollRecord(
                FeedDayKey("network", f"feed-{number}", family, at.date()),
                (poll,),
                (capture,),
                (),
                None,
                None,
            )
        )
    edition = EditionInput(3, 30, 40, "local", "schedule.zip", "b" * 64, 5, None, at, at, at, at)
    return ReplayWindow(
        "network",
        {"feed-1": 1, "feed-2": 2, "static": 3},
        tuple(records),
        edition,
        at - timedelta(seconds=1),
        (
            CycleSpec(
                at.replace(microsecond=0) + timedelta(seconds=1),
                (("realtime_snapshot", 1), ("alert_snapshot", 2)),
            ),
        ),
    )


def test_window_json_round_trips_byte_for_byte() -> None:
    original = window()
    data = original.to_json()
    restored = ReplayWindow.from_json(data)
    assert restored == original
    assert restored.to_json() == data
    assert b"2026-01-02T12:00:00.123456Z" in data
    assert restored.poll_records[0].polls[0].requested_at_utc is None
    assert restored.edition.source_url is None


@pytest.mark.parametrize("mapping", [UserDict, MappingProxyType])
def test_window_accepts_endpoint_mappings(mapping) -> None:
    original = window()
    endpoints = dict(original.feed_endpoints)
    restored = replace(original, feed_endpoints=mapping(endpoints))
    endpoints.clear()
    assert restored.to_json() == original.to_json()


def test_capture_lookup_finds_the_entry_and_its_record() -> None:
    original = window()
    record = original.poll_records[1]
    assert original.capture("alert_snapshot", 2) == (record, record.captures[0])
    with pytest.raises(WindowInvalid, match="realtime_snapshot.*999"):
        original.capture("realtime_snapshot", 999)


@pytest.mark.parametrize(
    "rule,reason",
    [
        ("order", "cycle.*strictly increasing"),
        ("fraction", "cycle.*whole seconds"),
        ("missing", "capture.*999.*missing"),
        ("failed", "capture.*1.*poll did not succeed"),
        ("no_poll", "capture.*1.*poll.*missing"),
        ("duplicate", "capture.*1.*listed twice"),
        ("provider", "provider.*other"),
        ("initialized", "serving_initialized_at_utc.*capture"),
        ("naive", "naive datetime"),
        ("naive_poll", "naive datetime"),
    ],
)
def test_invalid_windows_are_refused_with_their_reason(rule: str, reason: str) -> None:
    original = window()
    cycle, record = original.cycles[0], original.poll_records[0]
    changes: dict[str, object] = {}
    if rule == "order":
        changes["cycles"] = (cycle, replace(cycle, captures=()))
    elif rule == "fraction":
        changes["cycles"] = (
            replace(cycle, generated_utc=cycle.generated_utc.replace(microsecond=1)),
        )
    elif rule == "missing":
        changes["cycles"] = (replace(cycle, captures=(("realtime_snapshot", 999),)),)
    elif rule in ("failed", "no_poll"):
        polls = (replace(record.polls[0], run_status="failed"),) if rule == "failed" else ()
        changes["poll_records"] = (replace(record, polls=polls), original.poll_records[1])
    elif rule == "duplicate":
        changes["cycles"] = (
            cycle,
            replace(cycle, generated_utc=cycle.generated_utc + timedelta(seconds=1)),
        )
    elif rule == "provider":
        changes["provider_id"] = "other"
        reason = "provider.*network"
    elif rule == "initialized":
        changes["serving_initialized_at_utc"] = record.captures[0].captured_at_utc
    elif rule == "naive_poll":
        poll = replace(record.polls[0], requested_at_utc=datetime(2026, 1, 1))
        changes["poll_records"] = (replace(record, polls=(poll,)), original.poll_records[1])
    else:
        changes["edition"] = replace(original.edition, requested_at_utc=datetime(2026, 1, 1))
    with pytest.raises(WindowInvalid, match=reason):
        replace(original, **changes)
    value = asdict(original)
    value.update({key: asdict(item) if key == "edition" else item for key, item in changes.items()})
    data = json.dumps(
        value, default=lambda item: item.isoformat() if isinstance(item, date) else asdict(item)
    ).encode()
    with pytest.raises(WindowInvalid, match=reason):
        ReplayWindow.from_json(data)
