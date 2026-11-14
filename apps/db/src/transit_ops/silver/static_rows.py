"""Public door over the schedule loader's existing row builders.
The loader is unchanged and does not import this module.
Moving the builders is deferred to the closing consolidation (R4.33)."""

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from zipfile import ZipFile

from transit_ops.gtfs.types import parse_gtfs_service_time
from transit_ops.silver.static_gtfs import (
    REQUIRED_COLUMNS_BY_MEMBER,
    _build_agency_record,
    _build_calendar_date_record,
    _build_calendar_record,
    _build_direction_record,
    _build_feed_info_record,
    _build_route_pattern_record,
    _build_route_record,
    _build_shape_record,
    _build_stop_record,
    _build_stop_time_record,
    _build_translation_record,
    _build_trip_record,
    _discover_gtfs_members_from_zip,
    _iter_gtfs_rows,
    _parse_optional_int,
    _require_value,
    validate_required_static_members,
)

FREQUENCIES_MEMBER = "frequencies.txt"
_FREQUENCY_REQUIRED_COLUMNS = {"trip_id", "start_time", "end_time", "headway_secs"}


def _build_frequency_record(
    row: dict[str, str], *, provider_id: str, dataset_version_id: int | None
) -> dict[str, object]:
    trip_id = _require_value(row, "trip_id", FREQUENCIES_MEMBER)
    start = _require_value(row, "start_time", FREQUENCIES_MEMBER)
    end = _require_value(row, "end_time", FREQUENCIES_MEMBER)
    start_s = parse_gtfs_service_time(start, field_name="frequencies.start_time").total_seconds
    end_s = parse_gtfs_service_time(end, field_name="frequencies.end_time").total_seconds
    if end_s <= start_s:
        raise ValueError("frequencies.end_time must be after start_time.")
    headway = int(_require_value(row, "headway_secs", FREQUENCIES_MEMBER))
    if headway <= 0:
        raise ValueError("frequencies.headway_secs must be positive.")
    exact = _parse_optional_int(row.get("exact_times"))
    if exact is not None and exact not in (0, 1):
        raise ValueError("frequencies.exact_times must be 0 or 1.")
    return {
        "provider_id": provider_id,
        "dataset_version_id": dataset_version_id,
        "trip_id": trip_id,
        "start_time": start,
        "end_time": end,
        "headway_secs": headway,
        "exact_times": exact,
    }


_BUILDERS: dict[str, Callable[..., dict[str, object]]] = {
    FREQUENCIES_MEMBER: _build_frequency_record,
    "agency.txt": _build_agency_record,
    "feed_info.txt": _build_feed_info_record,
    "routes.txt": _build_route_record,
    "trips.txt": _build_trip_record,
    "stops.txt": _build_stop_record,
    "stop_times.txt": _build_stop_time_record,
    "calendar.txt": _build_calendar_record,
    "calendar_dates.txt": _build_calendar_date_record,
    "directions.txt": _build_direction_record,
    "route_patterns.txt": _build_route_pattern_record,
    "shapes.txt": _build_shape_record,
    "translations.txt": _build_translation_record,
}


@dataclass(frozen=True)
class RowRejection:
    row_number: int
    reason: str


def iter_member_rows(
    archive: ZipFile,
    member: str,
    *,
    provider_id: str,
    dataset_version_id: int | None = None,
) -> Iterator[dict[str, object] | RowRejection]:
    if member not in _BUILDERS:
        raise ValueError(
            f"Unknown GTFS member '{member}'; known keys: {', '.join(sorted(_BUILDERS))}"
        )
    member_name = _discover_gtfs_members_from_zip(archive).get(member)
    if member_name is None:
        return
    rows = _iter_gtfs_rows(
        archive,
        member_name=member_name,
        required_columns=(
            _FREQUENCY_REQUIRED_COLUMNS
            if member == FREQUENCIES_MEMBER
            else REQUIRED_COLUMNS_BY_MEMBER[member]
        ),
    )
    for row_number, row in enumerate(rows, start=1):
        try:
            extra = {"translation_row_number": row_number} if member == "translations.txt" else {}
            yield _BUILDERS[member](
                row, provider_id=provider_id, dataset_version_id=dataset_version_id, **extra
            )
        except ValueError as exc:
            yield RowRejection(row_number, str(exc))


def required_members(archive: ZipFile, *, strict_gtfs: bool = True) -> None:
    validate_required_static_members(
        _discover_gtfs_members_from_zip(archive), strict_gtfs=strict_gtfs
    )
