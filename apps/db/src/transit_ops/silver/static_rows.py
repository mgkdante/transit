"""Public door over the schedule loader's existing row builders.
The loader is unchanged and does not import this module.
Moving the builders is deferred to the closing consolidation (R4.33)."""

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from zipfile import ZipFile

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
    validate_required_static_members,
)

_BUILDERS: dict[str, Callable[..., dict[str, object]]] = {
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
        archive, member_name=member_name, required_columns=REQUIRED_COLUMNS_BY_MEMBER[member]
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
