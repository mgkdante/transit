from dataclasses import FrozenInstanceError
from datetime import date

import pytest

from transit_ops.providers.schedule import (
    EditionNotAvailable,
    InvalidScheduleEdition,
    ScheduleDay,
    ScheduledStop,
    ScheduledStopTime,
    ScheduledTrip,
    ScheduleMembersUnknown,
)

DAY = date(2026, 3, 8)
CHECKSUM = "a" * 64


@pytest.mark.parametrize(
    "record,field,value",
    [
        (ScheduledStopTime(0, "a", None, 90060, None, None), "departure_s", 0),
        (ScheduledStop("a", 45.0, -75.0, 1, "parent"), "lat", None),
        (
            ScheduledTrip("t", "r", None, "s", 5, 90060, 93600, 3, True, None, "shape", 2),
            "frequency_based",
            False,
        ),
        (
            ScheduleDay(DAY, CHECKSUM, None, frozenset({"t"}), frozenset({"r"})),
            "edition_sha256",
            "b" * 64,
        ),
    ],
)
def test_schedule_records_are_frozen(record, field, value):
    with pytest.raises(FrozenInstanceError):
        setattr(record, field, value)


def test_optional_fields_and_service_seconds_are_preserved():
    stop_time = ScheduledStopTime(5, "a", None, 90060, None, 12.5)
    assert (stop_time.arrival_s, stop_time.departure_s) == (None, 90060)
    assert (stop_time.timepoint, stop_time.shape_dist_traveled) == (None, 12.5)
    assert ScheduledStop("a", None, None, None, None).lat is None
    day = ScheduleDay(DAY, CHECKSUM, None, frozenset({"t"}), frozenset({"r"}))
    assert day.list_sha256 is None
    with pytest.raises(AttributeError):
        day.trip_ids.add("other")


def test_named_failures_keep_the_edition_and_reason():
    unavailable = EditionNotAvailable(17)
    assert isinstance(unavailable, LookupError)
    assert unavailable.dataset_version_id == 17
    invalid = InvalidScheduleEdition(17, "duplicate_trip_ids")
    assert isinstance(invalid, ValueError)
    assert (invalid.dataset_version_id, invalid.reason) == (17, "duplicate_trip_ids")
    assert ScheduleMembersUnknown.reason == "schedule_members_unknown"


@pytest.mark.parametrize(
    "day,expected",
    [
        (date(2026, 3, 8), "2026-03-08T04:00:00+00:00"),
        (date(2026, 11, 1), "2026-11-01T05:00:00+00:00"),
    ],
)
def test_service_day_start_uses_elapsed_hours_after_utc_conversion(day, expected):
    from zoneinfo import ZoneInfo

    from transit_ops.providers.schedule import service_day_start

    anchor = service_day_start(day, ZoneInfo("America/Toronto"))
    assert anchor.isoformat() == expected
    assert anchor.utcoffset().total_seconds() == 0


def test_context_identity_has_a_canonical_encoding_and_copies_the_date_set():
    from zoneinfo import ZoneInfo

    from transit_ops.providers.schedule import context_id

    dates = [date(2026, 11, 1), DAY, DAY]
    identity = context_id(
        provider_id="p",
        dataset_version_id=17,
        edition_sha256=CHECKSUM,
        service_dates=dates,
        timezone=ZoneInfo("America/Toronto"),
    )
    # SHA-256 of the literal JSON tuple documented by the helper, independently calculated.
    assert identity == "07da4e73809870ae34756adbdc923acf34a7b95f1acce968ff95d58879fddc20"
    dates.clear()
    assert identity == context_id(
        provider_id="p",
        dataset_version_id=17,
        edition_sha256=CHECKSUM,
        service_dates=(DAY, date(2026, 11, 1)),
        timezone=ZoneInfo("America/Toronto"),
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"provider_id": "q"},
        {"dataset_version_id": 18},
        {"edition_sha256": "b" * 64},
        {"timezone": "UTC"},
        {"timezone": "US/Eastern"},
        {"service_dates": (date(2026, 3, 9),)},
    ],
)
@pytest.mark.parametrize("dates", [(), (DAY,)])
def test_context_identity_isolates_every_identity_dimension(changes, dates):
    from zoneinfo import ZoneInfo

    from transit_ops.providers.schedule import context_id

    options = dict(
        provider_id="p",
        dataset_version_id=17,
        edition_sha256=CHECKSUM,
        service_dates=dates,
        timezone=ZoneInfo("America/Toronto"),
    )
    original = context_id(**options)
    if "timezone" in changes:
        changes = {**changes, "timezone": ZoneInfo(changes["timezone"])}
    assert context_id(**{**options, **changes}) != original


@pytest.mark.parametrize(
    "changes,reason",
    [
        ({"provider_id": ""}, "invalid_identity"),
        ({"provider_id": "  "}, "invalid_identity"),
        ({"dataset_version_id": 0}, "invalid_identity"),
        ({"dataset_version_id": -1}, "invalid_identity"),
        ({"edition_sha256": "a" * 63}, "invalid_checksum"),
        ({"edition_sha256": "g" * 64}, "invalid_checksum"),
        ({"edition_sha256": "A" * 64}, "invalid_checksum"),
    ],
)
def test_context_identity_refuses_invalid_caller_identity(changes, reason):
    from zoneinfo import ZoneInfo

    from transit_ops.providers.schedule import context_id

    options = dict(
        provider_id="p",
        dataset_version_id=17,
        edition_sha256=CHECKSUM,
        service_dates=(),
        timezone=ZoneInfo("America/Toronto"),
    )
    with pytest.raises(InvalidScheduleEdition) as error:
        context_id(**{**options, **changes})
    assert error.value.reason == reason
    assert error.value.dataset_version_id == changes.get("dataset_version_id", 17)
