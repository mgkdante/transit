"""Resolve vehicle captures against listed, dated instances without database access."""

import re
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime, timedelta
from typing import Literal, NamedTuple

# A vehicle capture is evidence for a reading at most this far from it.
VEHICLE_EVIDENCE_WINDOW_SECONDS = 120
# An instance's window opens this long before its scheduled start
# and closes this long after its scheduled end.
EARLY_START_MAX_LEAD_SECONDS = 900
SANITY_DELAY_SECONDS = 10_800

Resolution = Literal["single_window", "descriptor", "other_instance", "ambiguous_instance"]


class TripInstance(NamedTuple):
    """One dated instance of a trip id, from that date's own list."""

    trip_id: str
    service_date: date
    start_utc: datetime  # scheduled first departure
    end_utc: datetime  # scheduled last arrival
    first_departure_seconds: int  # seconds after the service-day anchor, as the list stores it


class VehicleDescriptor(NamedTuple):
    """What the vehicle itself said in a capture, when the feed carries it."""

    start_date: date | None
    start_time: str  # 'HH:MM:SS' as the feed gave it; '' when it gave none


def _validate(
    captured_at_utc: datetime, instances: Sequence[TripInstance]
) -> tuple[datetime, list[tuple[TripInstance, datetime, datetime]]]:
    if captured_at_utc.utcoffset() is None:
        raise ValueError("captured_at_utc must have a time zone")
    dates: set[date] = set()
    normalized: list[tuple[TripInstance, datetime, datetime]] = []
    for instance in instances:
        for name, value in (("start_utc", instance.start_utc), ("end_utc", instance.end_utc)):
            if value.utcoffset() is None:
                raise ValueError(f"{name} must have a time zone")
        start_utc = instance.start_utc.astimezone(UTC)
        end_utc = instance.end_utc.astimezone(UTC)
        if end_utc < start_utc:
            raise ValueError("end_utc must not be before start_utc")
        if instance.trip_id != instances[0].trip_id:
            raise ValueError("instances must have one trip_id")
        if instance.service_date in dates:
            raise ValueError("instances must have distinct service_date values")
        dates.add(instance.service_date)
        normalized.append((instance, start_utc, end_utc))
    return captured_at_utc.astimezone(UTC), normalized


def _start_seconds(start_time: str) -> int | None:
    if re.fullmatch(r"[0-9]+:[0-5][0-9]:[0-5][0-9]", start_time) is None:
        return None
    try:
        hours, minutes, seconds = map(int, start_time.split(":"))
    except ValueError:
        return None
    return hours * 3600 + minutes * 60 + seconds


def resolve_vehicle_capture(
    captured_at_utc: datetime,
    instances: Sequence[TripInstance],
    descriptor: VehicleDescriptor | None = None,
) -> dict[TripInstance, Resolution]:
    """Resolve listed instances of one trip from each candidate service date's own list.

    The caller has already removed unlisted trips, including duplicated trips;
    this function takes no relationship argument. A descriptor never expands a window.
    The caller must supply the complete set of dated candidates for the trip id,
    derive each instance's start, end and first departure seconds from that service
    date's own list and anchor, and remove trips the list does not hold and
    frequency-based trips.
    Any aware datetime is accepted and judged as its instant.
    """
    captured_at_utc, normalized = _validate(captured_at_utc, instances)
    holding = [
        instance
        for instance, start_utc, end_utc in normalized
        if start_utc - timedelta(seconds=EARLY_START_MAX_LEAD_SECONDS)
        <= captured_at_utc
        <= end_utc + timedelta(seconds=SANITY_DELAY_SECONDS)
    ]
    if not holding:
        return {}
    if len(holding) == 1:
        return {holding[0]: "single_window"}
    seconds = _start_seconds(descriptor.start_time) if descriptor else None
    named = [
        instance
        for instance in holding
        if descriptor is not None
        and descriptor.start_date == instance.service_date
        and seconds == instance.first_departure_seconds
    ]
    if len(named) == 1:
        return {i: "descriptor" if i == named[0] else "other_instance" for i in holding}
    return {i: "ambiguous_instance" for i in holding}


def accepted_instance(resolved: Mapping[TripInstance, Resolution]) -> TripInstance | None:
    """Return the accepted instance, refusing inconsistent multiple acceptances."""
    accepted = [
        i for i, resolution in resolved.items() if resolution in ("single_window", "descriptor")
    ]
    if len(accepted) > 1:
        raise ValueError("more than one accepted instance")
    return accepted[0] if accepted else None
