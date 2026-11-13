import subprocess
import sys
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta

import pytest
from coverage_fixtures import (
    RecordingCoverageBuilder,
    consumed_of,
    make_intervals,
    make_polls,
)

import transit_ops.capture_coverage as package
from transit_ops.capture_coverage import rules
from transit_ops.capture_coverage.rules import (
    CaptureKey,
    CoverageBuild,
    CoverageFloor,
    CoveredInterval,
)

START = datetime(2026, 1, 1, tzinfo=UTC)


def at(seconds):
    return START + timedelta(seconds=seconds)


def test_capture_key_equals_a_plain_pair():
    key = CaptureKey("realtime_snapshot", 42)
    assert key == ("realtime_snapshot", 42)
    assert hash(key) == hash(("realtime_snapshot", 42))
    assert key in {("realtime_snapshot", 42)}
    assert CaptureKey("alert_snapshot", 42) != key


def test_reasons_follow_the_one_order():
    assert rules.NOT_MEASURED_REASONS == (
        "schedule_not_kept",
        "captures_not_available",
        "no_capture_record",
        "capture_gap",
        "window_too_short",
        "applicability_unresolved",
        "schedule_mismatch",
    )
    applicable = {"schedule_not_kept", "captures_not_available"}
    assert next(r for r in rules.NOT_MEASURED_REASONS if r in applicable) == "schedule_not_kept"


def test_constants_and_floors_have_the_specified_values():
    assert package.RULES_VERSION is rules.RULES_VERSION
    assert rules.RULES_VERSION == 1
    assert rules.USABLE_SPACING_MAX_SECONDS == 120
    assert rules.FRESH_FEED_AGE_SECONDS == 120
    assert rules.MIN_MEASURED_TRIP_SHARE == 0.90
    assert rules.ABSENCE_MIN_USABLE_POLLS == 4
    assert rules.ABSENCE_FLOOR == CoverageFloor(0.80, 300)
    assert rules.RATE_FLOOR == CoverageFloor(0.80, None)


def test_package_imports_no_database_code():
    code = (
        "import sys\n"
        "import transit_ops.capture_coverage.rules\n"
        "bad = [m for m in sys.modules if m == 'sqlalchemy' or m == 'psycopg' "
        "or m.startswith(('sqlalchemy.', 'psycopg.', 'transit_ops.history'))]\n"
        "assert not bad, bad\n"
    )
    subprocess.run([sys.executable, "-c", code], check=True)


def test_make_polls_marks_polls_inside_an_outage_as_failed():
    polls = make_polls("trip_updates", START, at(120), outages=[(at(30), at(90))])
    assert [p.time_utc for p in polls] == [at(s) for s in (0, 30, 60, 90, 120)]
    assert [p.status for p in polls] == ["stored", "failed", "failed", "failed", "stored"]
    assert consumed_of(polls) == {
        CaptureKey("realtime_snapshot", 1),
        CaptureKey("realtime_snapshot", 2),
    }
    for poll in polls[1:4]:
        assert (
            poll.capture,
            poll.feed_timestamp_utc,
            poll.feed_timestamp_source,
            poll.entity_count,
            poll.processed,
        ) == (None, None, None, None, None)
    assert polls[0].feed == "trip_updates"
    for poll in (polls[0], polls[-1]):
        assert (
            poll.feed_timestamp_utc,
            poll.feed_timestamp_source,
            poll.entity_count,
            poll.processed,
        ) == (poll.time_utc, "header", 1, True)


def test_make_polls_custom_keys_and_consumption():
    polls = make_polls("alerts", START, at(30), index_family="alert_snapshot", first_row_id=42)
    assert consumed_of(polls) == {
        CaptureKey("alert_snapshot", 42),
        CaptureKey("alert_snapshot", 43),
    }
    assert (
        consumed_of([replace(polls[0], status="failed"), replace(polls[1], capture=None)]) == set()
    )


@pytest.mark.parametrize(
    "kwargs",
    [
        {"every_seconds": 0},
        {"every_seconds": -1},
        {"end_utc": at(-1)},
        {"start_utc": START.replace(tzinfo=None)},
        {"end_utc": START.replace(tzinfo=None)},
        {"outages": [(START.replace(tzinfo=None), at(30))]},
        {"outages": [(START, at(30).replace(tzinfo=None))]},
    ],
)
def test_make_polls_refuses_invalid_inputs(kwargs):
    arguments = {"start_utc": START, "end_utc": at(120), **kwargs}
    with pytest.raises(ValueError):
        make_polls("trip_updates", **arguments)


def test_make_intervals_counts_polls_and_refuses_overlap():
    assert make_intervals((at(120), at(120)), (START, at(61))) == [
        CoveredInterval(START, at(61), 3),
        CoveredInterval(at(120), at(120), 1),
    ]
    assert make_intervals((START, at(60)), every_seconds=60) == [CoveredInterval(START, at(60), 2)]
    assert make_intervals() == []
    for spans in [((at(30), START),), ((START, at(60)), (at(30), at(90)))]:
        with pytest.raises(ValueError):
            make_intervals(*spans)


def test_recording_double_records_calls_and_returns_a_build():
    builder = RecordingCoverageBuilder()
    connection, storage = object(), object()
    captures = consumed_of(make_polls("trip_updates", START, START))
    result = builder(
        connection,
        provider_id="network",
        service_date=date(2026, 1, 1),
        consumed_captures=captures,
        storage=storage,
    )
    assert builder.calls == [
        {
            "connection": connection,
            "provider_id": "network",
            "service_date": date(2026, 1, 1),
            "read_source": "daily_pass",
            "consumed_captures": captures,
            "storage": storage,
        }
    ]
    assert result == CoverageBuild(
        "network",
        date(2026, 1, 1),
        "daily_pass",
        1,
        {"trip_updates": None, "vehicle_positions": None, "alerts": None},
        {"trip_updates": 0, "vehicle_positions": 0, "alerts": 0},
    )


def test_recording_double_returns_supplied_build_for_worker_facts():
    supplied = CoverageBuild(
        "network", date(2026, 1, 1), "worker_facts", 1, {"alerts": "no_polls"}, {"alerts": 0}
    )
    custom = RecordingCoverageBuilder(supplied)
    assert (
        custom(
            None,
            provider_id="network",
            service_date=date(2026, 1, 1),
            read_source="worker_facts",
            consumed_captures=None,
        )
        is supplied
    )
    assert custom.calls[0]["read_source"] == "worker_facts"
    assert custom.calls[0]["storage"] is None


def test_recording_double_accepts_empty_consumed_captures():
    builder = RecordingCoverageBuilder()
    assert (
        builder(
            None, provider_id="network", service_date=date(2026, 1, 1), consumed_captures=set()
        ).usable_poll_counts["alerts"]
        == 0
    )


def test_recording_double_refuses_none_under_daily_pass():
    builder = RecordingCoverageBuilder()
    with pytest.raises(ValueError):
        builder(None, provider_id="network", service_date=date(2026, 1, 1), consumed_captures=None)
    assert builder.calls == []
