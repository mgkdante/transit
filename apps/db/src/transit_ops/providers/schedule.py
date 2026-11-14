"""Shared, immutable schedule records and provider-scoped context contracts."""

import json
from collections.abc import Collection, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from hashlib import sha256
from typing import Protocol
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class ScheduledStopTime:
    stop_sequence: int
    stop_id: str
    arrival_s: int | None
    departure_s: int | None
    timepoint: int | None
    shape_dist_traveled: float | None


@dataclass(frozen=True)
class ScheduledStop:
    stop_id: str
    lat: float | None
    lon: float | None
    wheelchair_boarding: int | None
    parent_station: str | None


@dataclass(frozen=True)
class ScheduledTrip:
    trip_id: str
    route_id: str
    direction_id: int | None
    service_id: str
    first_stop_sequence: int
    first_departure_s: int
    last_arrival_s: int
    stop_time_count: int
    frequency_based: bool
    block_id: str | None
    shape_id: str | None
    wheelchair_accessible: int | None


@dataclass(frozen=True)
class ScheduleDay:
    service_date: date
    edition_sha256: str
    list_sha256: str | None
    trip_ids: frozenset[str]
    route_ids: frozenset[str]


class ScheduleContext(Protocol):
    """Fixed dated reads, with usable days separate from unavailable reasons.

    Unrequested dates raise KeyError. An absent/inactive trip on a usable date
    returns None or (); stops belong to the edition even on an empty day.
    Implementations copy caller containers and expose immutable records/maps.
    """

    context_id: str
    timezone: ZoneInfo
    days: Mapping[date, ScheduleDay]
    unavailable: Mapping[date, str]

    def trip(self, service_date: date, trip_id: str) -> ScheduledTrip | None: ...
    def stop_times(self, service_date: date, trip_id: str) -> tuple[ScheduledStopTime, ...]: ...
    def stop(self, service_date: date, stop_id: str) -> ScheduledStop | None: ...
    def service_day_start(self, service_date: date) -> datetime: ...


class EditionNotAvailable(LookupError):
    def __init__(self, dataset_version_id: int) -> None:
        self.dataset_version_id = dataset_version_id
        super().__init__(dataset_version_id)


class ScheduleByEdition(Protocol):
    """Reads within an already provider-scoped context, independent of dates.

    An unreadable edition raises EditionNotAvailable; a readable edition with
    no matching trip/stop returns None or (). Never substitute another edition.
    """

    def trip_in_edition(self, dataset_version_id: int, trip_id: str) -> ScheduledTrip | None: ...
    def stop_times_in_edition(
        self, dataset_version_id: int, trip_id: str
    ) -> tuple[ScheduledStopTime, ...]: ...
    def stop_in_edition(self, dataset_version_id: int, stop_id: str) -> ScheduledStop | None: ...


class ScheduleMembersUnknown(ValueError):
    """The archive inventory is unknown; no frequency flag can be established."""

    reason = "schedule_members_unknown"


class InvalidScheduleEdition(ValueError):
    def __init__(self, dataset_version_id: int, reason: str) -> None:
        self.dataset_version_id = dataset_version_id
        self.reason = reason
        super().__init__(f"{reason}: edition {dataset_version_id}")


def service_day_start(service_date: date, timezone: ZoneInfo) -> datetime:
    """Anchor service seconds at local noon minus twelve elapsed hours in UTC."""
    noon = datetime.combine(service_date, time(12), timezone)
    return noon.astimezone(UTC) - timedelta(hours=12)


def context_id(
    *,
    provider_id: str,
    dataset_version_id: int,
    edition_sha256: str,
    service_dates: Collection[date],
    timezone: ZoneInfo,
) -> str:
    """Hash [provider, zone key, edition id, checksum, sorted dated edition entries].

    Entries are [ISO date, edition id, checksum], with each date appearing once.
    Compact ASCII JSON encoded as UTF-8 makes boundaries unambiguous. The edition
    is included even for an empty date set. The caller supplies provider-scoped
    identity; this helper neither selects an edition nor verifies archive bytes.
    """
    if not provider_id.strip() or dataset_version_id <= 0:
        raise InvalidScheduleEdition(dataset_version_id, "invalid_identity")
    if len(edition_sha256) != 64 or any(c not in "0123456789abcdef" for c in edition_sha256):
        raise InvalidScheduleEdition(dataset_version_id, "invalid_checksum")
    identity = [
        provider_id,
        timezone.key,
        dataset_version_id,
        edition_sha256,
        [(d.isoformat(), dataset_version_id, edition_sha256) for d in sorted(set(service_dates))],
    ]
    return sha256(
        json.dumps(identity, separators=(",", ":"), ensure_ascii=True).encode()
    ).hexdigest()
