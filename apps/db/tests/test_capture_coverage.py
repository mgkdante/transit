import subprocess
import sys
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

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


def judge(polls, **kwargs):
    return rules.judge_polls(
        polls,
        **{
            "read_source": "worker_facts",
            "consumed_captures": None,
            "service_spans": [],
            "source_lag_seconds": 0,
            **kwargs,
        },
    )


def usable(polls, **kwargs):
    return rules.usable_polls(
        polls,
        **{
            "read_source": "worker_facts",
            "consumed_captures": None,
            "service_spans": [],
            "source_lag_seconds": 0,
            **kwargs,
        },
    )


def assert_rejected(polls, reason, **kwargs):
    assert usable(polls, **kwargs) == []
    assert [v.reason for v in judge(polls, **kwargs)].count(reason) == 1


@pytest.mark.parametrize("status", ["failed", "skipped_identical", "unfinished", "capture_missing"])
def test_poll_is_unusable_when_not_stored(status):
    poll = replace(make_polls("trip_updates", START, START)[0], status=status)
    assert_rejected([poll], "not_stored")


def test_poll_is_unusable_when_not_decoded():
    poll = make_polls("trip_updates", START, START)[0]
    assert_rejected([replace(poll, status="failed")], "not_stored")
    assert_rejected(
        [poll], "unusable_not_processed", read_source="daily_pass", consumed_captures=[]
    )


def test_poll_is_unusable_when_not_processed():
    poll = replace(make_polls("trip_updates", START, START)[0], processed=False)
    assert_rejected([poll], "unusable_not_processed")
    assert usable([poll], consumed_captures=consumed_of([poll])) == [poll]


def test_poll_is_unusable_when_feed_timestamp_did_not_advance():
    first, second = make_polls("trip_updates", START, at(30))
    second = replace(second, feed_timestamp_utc=START)
    assert usable([second, first]) == [first]
    assert [v.reason for v in judge([second, first])] == [None, "unusable_not_advanced"]


def test_poll_is_unusable_when_stale():
    poll = make_polls("vehicle_positions", START, START)[0]
    assert_rejected(
        [replace(poll, feed_timestamp_utc=at(-181))], "unusable_stale", source_lag_seconds=60
    )
    for seconds in (-180, 30):
        fresh = replace(poll, feed_timestamp_utc=at(seconds))
        assert usable([fresh], source_lag_seconds=60) == [fresh]


@pytest.mark.parametrize("seconds", [0, 30, 60])
def test_poll_is_unusable_when_empty_during_scheduled_service(seconds):
    poll = replace(make_polls("trip_updates", at(seconds), at(seconds))[0], entity_count=0)
    assert_rejected([poll], "unusable_empty", service_spans=[(START, at(60))])


def test_empty_message_outside_service_is_usable():
    poll = replace(make_polls("trip_updates", START, START)[0], entity_count=0)
    assert usable([poll], service_spans=[(at(1), at(60))]) == [poll]
    assert usable([poll]) == [poll]


def test_alert_message_with_no_alert_is_usable():
    poll = replace(make_polls("alerts", START, START)[0], entity_count=0)
    assert usable([poll], service_spans=[(START, at(60))]) == [poll]


def test_two_repeats_in_three_leave_one_usable_poll_a_minute():
    polls = [
        replace(p, feed_timestamp_utc=at(i // 3 * 60))
        for i, p in enumerate(make_polls("trip_updates", START, at(3580), every_seconds=20))
    ]
    result = usable(polls)
    assert len(polls) == 180
    assert result == polls[::3]
    assert rules.covered_intervals(result) == [CoveredInterval(START, at(3540), 60)]


def test_one_missed_slot_in_three_keeps_coverage_and_lowers_the_fill():
    polls = [
        p
        for i, p in enumerate(make_polls("vehicle_positions", START, at(3580), every_seconds=20))
        if i % 3 != 2
    ]
    result = usable(polls)
    assert len(result) / 180 == 2 / 3
    assert rules.covered_intervals(result) == [CoveredInterval(START, at(3560), 120)]


@pytest.mark.parametrize("spacing", [120, 121])
def test_spacing_above_the_limit_opens_a_gap(spacing):
    polls = make_polls("trip_updates", START, at(spacing), every_seconds=spacing)
    expected = (
        [CoveredInterval(START, at(120), 2)]
        if spacing == 120
        else [CoveredInterval(START, START, 1), CoveredInterval(at(121), at(121), 1)]
    )
    assert rules.covered_intervals(list(reversed(usable(polls)))) == expected
    assert rules.covered_intervals([]) == []


def test_same_row_id_in_both_index_families_is_two_captures():
    first = make_polls("trip_updates", START, START, first_row_id=42)[0]
    second = make_polls("alerts", START, START, index_family="alert_snapshot", first_row_id=42)[0]
    assert usable(
        [first, second], read_source="daily_pass", consumed_captures={("realtime_snapshot", 42)}
    ) == [first]


def test_not_observed_processing_never_counts_as_processed():
    poll = replace(make_polls("trip_updates", START, START)[0], processed=None)
    assert_rejected([poll], "unusable_not_processed")


@pytest.mark.parametrize("feed", ["trip_updates", "vehicle_positions", "alerts"])
def test_capture_time_source_fails_advance_for_trip_updates_and_is_exempt_for_alerts(feed):
    poll = replace(
        make_polls(feed, START, START)[0],
        feed_timestamp_source="capture_time",
        feed_timestamp_utc=at(-300),
    )
    if feed == "alerts":
        assert usable([poll]) == [poll]
    else:
        assert_rejected([poll], "unusable_not_advanced")


@pytest.mark.parametrize("status", ["stored", "failed", "skipped_identical"])
def test_advance_is_judged_against_every_earlier_poll(status):
    first, second = make_polls("trip_updates", START, at(30))
    first = replace(first, status=status, processed=False)
    second = replace(second, feed_timestamp_utc=START)
    assert usable([second, first]) == []
    assert judge([second, first])[1].reason == "unusable_not_advanced"


def test_no_list_means_an_empty_message_is_never_usable():
    poll = replace(make_polls("trip_updates", START, START)[0], entity_count=0)
    assert_rejected([poll], "unusable_empty", service_spans=[(at(-60), at(60))])


def test_unknown_entity_count_and_missing_timestamp_are_unusable():
    poll = make_polls("alerts", START, START)[0]
    assert_rejected([replace(poll, entity_count=None)], "unusable_empty")
    assert_rejected([replace(poll, feed_timestamp_utc=None)], "unusable_not_advanced")


def test_first_failing_reason_and_equal_time_stability():
    poll = make_polls("trip_updates", START, START)[0]
    bad = replace(poll, processed=False, entity_count=None, feed_timestamp_utc=at(-300))
    assert_rejected([bad], "unusable_not_processed")
    assert_rejected([replace(bad, processed=True)], "unusable_stale")
    other = replace(poll, capture=CaptureKey("realtime_snapshot", 2))
    assert usable([other, poll]) == [other, poll]
    assert rules.covered_intervals([other, poll]) == [CoveredInterval(START, START, 2)]


@pytest.mark.parametrize(
    "kwargs, message",
    [
        ({"read_source": "daily_pass"}, "consumed_captures"),
        ({"source_lag_seconds": -1}, "source_lag_seconds"),
        ({"service_spans": [(at(1), START)]}, "span"),
        ({"service_spans": [(START.replace(tzinfo=None), START)]}, "time zone"),
    ],
)
def test_usable_polls_input_checks(kwargs, message):
    for function in (usable, judge):
        with pytest.raises(ValueError, match=message):
            function([], **kwargs)


@pytest.mark.parametrize("field", ["time_utc", "feed_timestamp_utc"])
def test_naive_poll_times_are_rejected(field):
    poll = replace(
        make_polls("trip_updates", START, START)[0], **{field: START.replace(tzinfo=None)}
    )
    with pytest.raises(ValueError, match="time zone"):
        usable([poll])
    with pytest.raises(ValueError, match="time zone"):
        rules.covered_intervals([poll])


def test_covered_intervals_refuses_mixed_feeds():
    with pytest.raises(ValueError, match="feed"):
        rules.covered_intervals(
            make_polls("alerts", START, START) + make_polls("trip_updates", START, START)
        )


def test_newest_timestamp_history_is_per_feed_and_header_alerts_are_tested():
    first, second, third = make_polls("alerts", START, at(60))
    second = replace(second, feed_timestamp_utc=at(-1))
    third = replace(third, feed_timestamp_utc=START)
    vehicle = make_polls("vehicle_positions", at(30), at(30))[0]
    assert usable([third, vehicle, second, first]) == [first, vehicle]
    assert [v.reason for v in judge([third, second, first])] == [
        None,
        "unusable_not_advanced",
        "unusable_not_advanced",
    ]


def window(spans, start=0, end=600, floor=rules.ABSENCE_FLOOR, **kwargs):
    return rules.judge_window(
        make_intervals(*[(at(a), at(b)) for a, b in spans]),
        at(start),
        at(end),
        floor=floor,
        **kwargs,
    )


def test_window_of_zero_length_is_no_window_with_null_share():
    for result in (
        window([], end=0),
        rules.judge_absence([], START, START, declared_interval_seconds=30),
    ):
        assert result == rules.WindowCoverage(0, 0, None, None, 0, "no_window", "polls")


def test_trip_between_two_usable_polls_is_not_judged_missing():
    polls = make_polls("trip_updates", START, at(120), outages=[(at(30), at(90))])
    result = rules.judge_absence(
        rules.covered_intervals(usable(polls)), at(20), at(100), declared_interval_seconds=30
    )
    assert result.verdict == "too_short"
    assert (result.covered_share, result.usable_poll_count) == (1, 0)


def test_absence_needs_four_usable_polls_inside_the_window():
    for times, expected in [
        ([-1, 0, 300, 600, 601], "not_covered"),
        ([0, 120, 300, 600], "covered"),
    ]:
        result = rules.judge_absence(
            make_intervals((at(-60), at(660))),
            START,
            at(600),
            declared_interval_seconds=30,
            usable_times=[at(t) for t in times],
        )
        assert result.verdict == expected
        assert result.usable_poll_count == (3 if expected == "not_covered" else 4)


def test_twenty_minute_trip_with_a_four_minute_outage_is_still_judged():
    polls = usable(make_polls("trip_updates", START, at(1200), outages=[(at(510), at(690))]))
    result = rules.judge_absence(
        rules.covered_intervals(polls),
        START,
        at(1200),
        declared_interval_seconds=30,
        usable_times=[p.time_utc for p in polls],
    )
    assert result == rules.WindowCoverage(
        1200, 960, 0.8, 240, sum(START <= p.time_utc <= at(1200) for p in polls), "covered", "polls"
    )


def test_share_of_exactly_eighty_percent_passes():
    assert window([(0, 480)]).verdict == "covered"
    assert window([(0, 479.999999)]).verdict == "not_covered"


def test_gap_of_exactly_three_hundred_seconds_passes():
    assert window([(0, 600), (900, 1800)], end=1800).verdict == "covered"
    assert window([(0, 600), (900.000001, 1800)], end=1800).verdict == "not_covered"
    assert window([(0, 600), (901, 1800)], end=1800).verdict == "not_covered"


def test_rate_floor_has_no_gap_limit():
    spans = [(0, 3000), (4200, 7200)]
    assert window(spans, end=7200, floor=rules.RATE_FLOOR).verdict == "covered"
    assert window(spans, end=7200).verdict == "not_covered"


def test_window_exactly_four_intervals_long_is_judged():
    for seconds, expected in [(120, "covered"), (119, "too_short"), (119.999999, "too_short")]:
        result = rules.judge_absence(
            make_intervals((START, at(seconds))),
            START,
            at(seconds),
            declared_interval_seconds=30,
            usable_times=[START] * 4,
        )
        assert result.verdict == expected
        assert result.covered_seconds == int(seconds)


def test_guaranteed_count_from_intervals_only():
    assert window([(0, 600)]).usable_poll_count == 5
    assert window([(0, 119), (200, 319)]).usable_poll_count == 0
    result = rules.judge_absence(
        make_intervals((START, at(600))), START, at(600), declared_interval_seconds=30
    )
    assert (result.usable_poll_count, result.verdict) == (5, "covered")


def test_longest_gap_counts_the_window_edges():
    assert window([(60, 480)]).longest_gap_seconds == 120
    assert window([(120, 540)]).longest_gap_seconds == 120
    assert window([]).longest_gap_seconds == 600
    assert window([(-100, -1), (601, 700)]).covered_seconds == 0


def test_intervals_past_the_window_are_clipped():
    assert window([(500, 800), (-100, 300)], basis="summary_5m") == rules.WindowCoverage(
        600, 400, 2 / 3, 200, 2, "not_covered", "summary_5m"
    )


def test_coverage_cases_give_their_expected_verdicts():
    from coverage_fixtures import CASES

    assert set(CASES) == {
        "ten_minute_gap_holds_a_short_line",
        "trip_between_two_usable_polls",
        "cancel_flag_then_outage",
        "fully_covered_day",
    }
    for case in CASES.values():
        polls = rules.usable_polls(
            case.polls,
            read_source=case.read_source,
            consumed_captures=case.consumed_captures,
            service_spans=case.service_spans,
            source_lag_seconds=case.source_lag_seconds,
        )
        intervals = rules.covered_intervals(polls)
        result = (
            rules.judge_window(intervals, case.start_utc, case.end_utc, floor=case.floor)
            if case.judge == "window"
            else rules.judge_absence(
                intervals,
                case.start_utc,
                case.end_utc,
                declared_interval_seconds=case.declared_interval_seconds,
                usable_times=[p.time_utc for p in polls],
            )
        )
        assert result.verdict == case.expected_verdict


def test_judge_input_checks():
    bad_inputs = [
        ([], at(1), START),
        ([CoveredInterval(START, at(60), 3), CoveredInterval(at(30), at(90), 3)], at(100), at(200)),
        ([CoveredInterval(at(1), START, 1)], START, at(600)),
        ([], START.replace(tzinfo=None), at(600)),
        ([CoveredInterval(START, at(60).replace(tzinfo=None), 3)], START, at(600)),
    ]
    for intervals, start, end in bad_inputs:
        with pytest.raises(ValueError):
            rules.judge_window(intervals, start, end, floor=rules.RATE_FLOOR)
        with pytest.raises(ValueError):
            rules.judge_absence(intervals, start, end, declared_interval_seconds=30)
    with pytest.raises(ValueError):
        rules.judge_absence([], START, at(600), declared_interval_seconds=0)
    with pytest.raises(ValueError):
        rules.judge_absence(
            [],
            START,
            at(600),
            declared_interval_seconds=30,
            usable_times=[START.replace(tzinfo=None)],
        )


def test_repeated_hour_polls_are_judged_as_instants():
    start = datetime(2026, 11, 1, 5, 59, tzinfo=UTC)
    polls = make_polls("trip_updates", start, start + timedelta(seconds=180))
    zone = ZoneInfo("America/Toronto")
    local = [
        replace(
            p,
            time_utc=p.time_utc.astimezone(zone),
            feed_timestamp_utc=p.feed_timestamp_utc.astimezone(zone),
        )
        for p in polls
    ]
    result = usable(list(reversed(local)))
    assert all(a is b for a, b in zip(result, local, strict=True))
    assert all(v.reason is None for v in judge(local))
    assert rules.covered_intervals(result) == rules.covered_intervals(polls)
    assert rules.covered_intervals(result) == [CoveredInterval(start, polls[-1].time_utc, 7)]
    empty = [replace(p, entity_count=0) for p in local]
    assert usable(empty, service_spans=[(local[0].time_utc, local[-1].time_utc)]) == []


def test_spring_window_measures_elapsed_seconds():
    zone = ZoneInfo("America/Toronto")
    result = rules.judge_window(
        [],
        datetime(2026, 3, 8, 1, 30, tzinfo=zone),
        datetime(2026, 3, 8, 3, 30, tzinfo=zone),
        floor=rules.RATE_FLOOR,
    )
    assert result.window_seconds == 3600


def test_window_judgments_match_for_local_and_utc_instants():
    zone = ZoneInfo("America/Toronto")
    start = datetime(2026, 11, 1, 5, 58, tzinfo=UTC)
    end = start + timedelta(seconds=600)
    for tz in (UTC, zone):
        a, b = start.astimezone(tz), end.astimezone(tz)
        intervals = [CoveredInterval(a, b, 21)]
        times = [(start + timedelta(seconds=s)).astimezone(tz) for s in (0, 120, 300, 600)]
        expected = rules.WindowCoverage(600, 600, 1, 0, 5, "covered", "polls")
        assert rules.judge_window(intervals, a, b, floor=rules.ABSENCE_FLOOR) == expected
        assert rules.judge_absence(
            intervals, a, b, declared_interval_seconds=30, usable_times=times
        ) == replace(expected, usable_poll_count=4)
