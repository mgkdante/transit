import ast
import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest

from transit_ops.gold import vehicle_instance_rule as rule
from transit_ops.gold.vehicle_instance_rule import (
    TripInstance,
    VehicleDescriptor,
    accepted_instance,
    resolve_vehicle_capture,
)

D = date(2026, 1, 2)


def instance(day=D, first=85800, last=87000):
    anchor = datetime.combine(day, datetime.min.time(), UTC)
    return TripInstance(
        "trip", day, anchor + timedelta(seconds=first), anchor + timedelta(seconds=last), first
    )


A = instance()
B = instance(D + timedelta(days=1), 600, 1800)
CAPTURE = A.start_utc + timedelta(minutes=5)


def test_one_window_is_single_window():
    runs = [instance(D - timedelta(days=1)), A, instance(D + timedelta(days=1))]
    resolved = resolve_vehicle_capture(CAPTURE, runs)
    assert resolved == {A: "single_window"}
    assert accepted_instance(resolved) == A


@pytest.mark.parametrize("chosen,time", [(A, "23:50:00"), (B, "00:10:00")])
def test_descriptor_with_date_and_time_decides_between_two_windows(chosen, time):
    resolved = resolve_vehicle_capture(
        CAPTURE, [A, B], VehicleDescriptor(chosen.service_date, time)
    )
    assert resolved == {run: "descriptor" if run == chosen else "other_instance" for run in [A, B]}
    assert accepted_instance(resolved) == chosen


def test_descriptor_with_a_date_and_no_time_is_not_used():
    resolved = resolve_vehicle_capture(CAPTURE, [A, B], VehicleDescriptor(D, ""))
    assert resolved == {A: "ambiguous_instance", B: "ambiguous_instance"}
    assert accepted_instance(resolved) is None


def test_two_windows_and_no_descriptor_are_ambiguous_for_both():
    resolved = resolve_vehicle_capture(CAPTURE, [A, B])
    assert resolved == {A: "ambiguous_instance", B: "ambiguous_instance"}
    assert accepted_instance(resolved) is None


def test_no_window_gives_an_empty_result():
    assert resolve_vehicle_capture(CAPTURE - timedelta(days=3), [A, B]) == {}
    assert resolve_vehicle_capture(CAPTURE, []) == {}
    assert accepted_instance({}) is None


@pytest.mark.parametrize(
    "edge,offset,held",
    [
        (A.start_utc, -900, True),
        (A.start_utc, -901, False),
        (A.end_utc, 10800, True),
        (A.end_utc, 10801, False),
    ],
)
def test_window_edges_are_included(edge, offset, held):
    assert resolve_vehicle_capture(edge + timedelta(seconds=offset), [A]) == (
        {A: "single_window"} if held else {}
    )


def test_single_window_ignores_a_descriptor_that_names_another_date():
    assert resolve_vehicle_capture(CAPTURE, [A], VehicleDescriptor(B.service_date, "00:10:00")) == {
        A: "single_window"
    }


@pytest.mark.parametrize(
    "descriptor",
    [
        VehicleDescriptor(D, "12:00:00"),
        VehicleDescriptor(None, "23:50:00"),
        VehicleDescriptor(D - timedelta(days=1), "23:50:00"),
    ],
)
def test_descriptor_that_names_no_holding_instance_is_ambiguous(descriptor):
    assert resolve_vehicle_capture(CAPTURE, [A, B], descriptor) == {
        A: "ambiguous_instance",
        B: "ambiguous_instance",
    }


def test_yesterdays_vehicle_belongs_to_yesterday():
    yesterday = instance(D - timedelta(days=1))
    assert resolve_vehicle_capture(CAPTURE - timedelta(days=1), [yesterday, A]) == {
        yesterday: "single_window"
    }


def test_a_then_b_then_a_resolves_each_capture_by_its_own_descriptor():
    for minute, chosen, time in [(0, A, "23:50:00"), (1, B, "00:10:00"), (2, A, "23:50:00")]:
        resolved = resolve_vehicle_capture(
            CAPTURE + timedelta(minutes=minute),
            [A, B],
            VehicleDescriptor(chosen.service_date, time),
        )
        assert accepted_instance(resolved) == chosen


def test_start_time_past_midnight_names_the_previous_service_date():
    yesterday = instance(D - timedelta(days=1), 90600, 91200)
    today = instance(D, 3600, 4200)
    resolved = resolve_vehicle_capture(
        today.start_utc, [yesterday, today], VehicleDescriptor(yesterday.service_date, "25:10:00")
    )
    assert resolved == {yesterday: "descriptor", today: "other_instance"}
    assert accepted_instance(resolved) == yesterday


@pytest.mark.parametrize(
    "text",
    [
        "bad",
        "23:5:00",
        "23:60:00",
        "23:50:60",
        "-1:00:00",
        " 23:50:00",
        "23:50:00\n",
        "23:50",
        "23:50:00.0",
        "２３:50:00",
    ],
)
def test_start_time_that_does_not_parse_names_nothing(text):
    assert resolve_vehicle_capture(CAPTURE, [A, B], VehicleDescriptor(D, text)) == {
        A: "ambiguous_instance",
        B: "ambiguous_instance",
    }


@pytest.mark.parametrize(
    "capture,runs,message",
    [
        (CAPTURE.replace(tzinfo=None), [], "captured_at_utc"),
        (CAPTURE, [A._replace(start_utc=A.start_utc.replace(tzinfo=None))], "start_utc"),
        (CAPTURE, [A._replace(end_utc=A.end_utc.replace(tzinfo=None))], "end_utc"),
        (CAPTURE, [A._replace(end_utc=A.start_utc - timedelta(seconds=1))], "end_utc"),
        (CAPTURE, [A, B._replace(trip_id="different")], "trip_id"),
        (CAPTURE, [A, A], "service_date"),
        (CAPTURE, [A, B._replace(service_date=D)], "service_date"),
    ],
)
def test_input_checks(capture, runs, message):
    with pytest.raises(ValueError, match=message):
        resolve_vehicle_capture(capture, runs)


@pytest.mark.parametrize("resolution", ["single_window", "descriptor"])
def test_input_checks_reject_multiple_accepted_instances(resolution):
    with pytest.raises(ValueError, match="accepted"):
        accepted_instance({A: "descriptor", B: resolution})


def test_constants_have_the_specified_values():
    for value, expected in [
        (rule.VEHICLE_EVIDENCE_WINDOW_SECONDS, 120),
        (rule.EARLY_START_MAX_LEAD_SECONDS, 900),
        (rule.SANITY_DELAY_SECONDS, 10800),
    ]:
        assert type(value) is int
        assert value == expected


def test_module_source_imports_only_the_standard_library():
    tree = ast.parse(Path(rule.__file__).read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            assert node.level == 0
            names = [node.module or ""]
        else:
            continue
        for name in names:
            assert name.split(".")[0] in sys.stdlib_module_names
            assert name.split(".")[0] != "transit_ops"
