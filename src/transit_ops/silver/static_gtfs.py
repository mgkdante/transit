from __future__ import annotations

import csv
import hashlib
from collections.abc import Callable, Iterable, Iterator, Mapping
from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from io import BytesIO, TextIOWrapper
from itertools import islice
from pathlib import Path
from zipfile import ZipFile

from sqlalchemy import bindparam, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Connection, Engine

from transit_ops.db.connection import make_engine
from transit_ops.ingestion.common import project_root, utc_now
from transit_ops.ingestion.static_gtfs import build_static_ingestion_config
from transit_ops.ingestion.storage import get_bronze_storage
from transit_ops.maintenance import prune_static_silver_datasets
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings, get_settings

CHUNK_SIZE = 5_000
REQUIRED_STATIC_MEMBERS = {
    "routes.txt",
    "trips.txt",
    "stops.txt",
    "stop_times.txt",
}
OPTIONAL_SERVICE_MEMBERS = {
    "calendar.txt",
    "calendar_dates.txt",
}
BETA_STATIC_CONTRACT_MEMBERS = {
    "directions.txt",
    "route_patterns.txt",
}
BETA_STATIC_CONTRACT_COLUMNS_BY_MEMBER = {
    "directions.txt": {
        "route_direction_id",
        "route_id",
        "direction_id",
        "direction",
        "direction_legacy",
    },
    "route_patterns.txt": {
        "route_pattern_id",
        "route_id",
        "direction_id",
        "route_pattern_typicality",
    },
    "routes.txt": {"route_desc", "route_desc_detail"},
    "shapes.txt": {"route_pattern_id"},
    "trips.txt": {"route_pattern_id"},
}
REQUIRED_COLUMNS_BY_MEMBER: dict[str, set[str]] = {
    "agency.txt": {
        "agency_id",
        "agency_name",
        "agency_url",
        "agency_timezone",
    },
    "routes.txt": {"route_id", "route_type"},
    "trips.txt": {"route_id", "service_id", "trip_id"},
    "stops.txt": {"stop_id", "stop_name"},
    "stop_times.txt": {"trip_id", "stop_id", "stop_sequence"},
    "calendar.txt": {
        "service_id",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
        "start_date",
        "end_date",
    },
    "calendar_dates.txt": {"service_id", "date", "exception_type"},
    "directions.txt": {
        "route_direction_id",
        "route_id",
        "direction_id",
        "direction",
        "direction_legacy",
    },
    "feed_info.txt": {
        "feed_publisher_name",
        "feed_publisher_url",
        "feed_lang",
        "feed_start_date",
        "feed_end_date",
        "feed_version",
    },
    "route_patterns.txt": {
        "route_pattern_id",
        "route_id",
        "direction_id",
        "route_pattern_typicality",
    },
    "shapes.txt": {
        "shape_id",
        "shape_pt_lat",
        "shape_pt_lon",
        "shape_pt_sequence",
    },
    "translations.txt": {
        "table_name",
        "field_name",
        "language",
        "record_id",
        "translation",
    },
}
SUPPORTED_STATIC_MEMBER_KEYS = set(REQUIRED_COLUMNS_BY_MEMBER)

GTFS_SOURCE_MEMBER_INSERT = text(
    """
    INSERT INTO silver.gtfs_source_members (
        dataset_version_id,
        provider_id,
        source_file_name,
        member_path,
        row_count,
        checksum_sha256,
        byte_size,
        first_seen_at_utc,
        last_seen_at_utc,
        manifest_json
    )
    VALUES (
        :dataset_version_id,
        :provider_id,
        :source_file_name,
        :member_path,
        :row_count,
        :checksum_sha256,
        :byte_size,
        :first_seen_at_utc,
        :last_seen_at_utc,
        :manifest_json
    )
    """
).bindparams(bindparam("manifest_json", type_=postgresql.JSONB))

GTFS_EXTRA_ROW_INSERT = text(
    """
    INSERT INTO silver.gtfs_extra_rows (
        dataset_version_id,
        provider_id,
        source_file_name,
        source_row_number,
        row_json
    )
    VALUES (
        :dataset_version_id,
        :provider_id,
        :source_file_name,
        :source_row_number,
        :row_json
    )
    """
).bindparams(bindparam("row_json", type_=postgresql.JSONB))

AGENCY_INSERT = text(
    """
    INSERT INTO silver.agency (
        dataset_version_id,
        provider_id,
        agency_id,
        agency_name,
        agency_url,
        agency_timezone,
        agency_lang,
        agency_phone,
        agency_fare_url
    )
    VALUES (
        :dataset_version_id,
        :provider_id,
        :agency_id,
        :agency_name,
        :agency_url,
        :agency_timezone,
        :agency_lang,
        :agency_phone,
        :agency_fare_url
    )
    """
)

FEED_INFO_INSERT = text(
    """
    INSERT INTO silver.feed_info (
        dataset_version_id,
        provider_id,
        feed_publisher_name,
        feed_publisher_url,
        feed_lang,
        feed_start_date,
        feed_end_date,
        feed_version
    )
    VALUES (
        :dataset_version_id,
        :provider_id,
        :feed_publisher_name,
        :feed_publisher_url,
        :feed_lang,
        :feed_start_date,
        :feed_end_date,
        :feed_version
    )
    """
)

ROUTES_INSERT = text(
    """
    INSERT INTO silver.routes (
        dataset_version_id,
        provider_id,
        route_id,
        agency_id,
        route_short_name,
        route_long_name,
        route_desc,
        route_type,
        route_url,
        route_color,
        route_text_color,
        route_desc_detail,
        route_sort_order,
        continuous_pickup,
        continuous_drop_off,
        network_id
    )
    VALUES (
        :dataset_version_id,
        :provider_id,
        :route_id,
        :agency_id,
        :route_short_name,
        :route_long_name,
        :route_desc,
        :route_type,
        :route_url,
        :route_color,
        :route_text_color,
        :route_desc_detail,
        :route_sort_order,
        :continuous_pickup,
        :continuous_drop_off,
        :network_id
    )
    """
)

TRIPS_INSERT = text(
    """
    INSERT INTO silver.trips (
        dataset_version_id,
        provider_id,
        trip_id,
        route_id,
        service_id,
        trip_headsign,
        trip_short_name,
        direction_id,
        block_id,
        shape_id,
        route_pattern_id,
        note_fr,
        note_en,
        wheelchair_accessible,
        bikes_allowed
    )
    VALUES (
        :dataset_version_id,
        :provider_id,
        :trip_id,
        :route_id,
        :service_id,
        :trip_headsign,
        :trip_short_name,
        :direction_id,
        :block_id,
        :shape_id,
        :route_pattern_id,
        :note_fr,
        :note_en,
        :wheelchair_accessible,
        :bikes_allowed
    )
    """
)

DIRECTIONS_INSERT = text(
    """
    INSERT INTO silver.directions (
        dataset_version_id,
        provider_id,
        route_direction_id,
        route_id,
        direction_id,
        direction,
        direction_legacy
    )
    VALUES (
        :dataset_version_id,
        :provider_id,
        :route_direction_id,
        :route_id,
        :direction_id,
        :direction,
        :direction_legacy
    )
    """
)

ROUTE_PATTERNS_INSERT = text(
    """
    INSERT INTO silver.route_patterns (
        dataset_version_id,
        provider_id,
        route_pattern_id,
        route_id,
        direction_id,
        route_pattern_typicality
    )
    VALUES (
        :dataset_version_id,
        :provider_id,
        :route_pattern_id,
        :route_id,
        :direction_id,
        :route_pattern_typicality
    )
    """
)

SHAPES_INSERT = text(
    """
    INSERT INTO silver.shapes (
        dataset_version_id,
        provider_id,
        shape_id,
        shape_pt_sequence,
        shape_pt_lat,
        shape_pt_lon,
        route_pattern_id
    )
    VALUES (
        :dataset_version_id,
        :provider_id,
        :shape_id,
        :shape_pt_sequence,
        :shape_pt_lat,
        :shape_pt_lon,
        :route_pattern_id
    )
    """
)

TRANSLATIONS_INSERT = text(
    """
    INSERT INTO silver.translations (
        dataset_version_id,
        provider_id,
        translation_row_number,
        table_name,
        field_name,
        language,
        record_id,
        translation
    )
    VALUES (
        :dataset_version_id,
        :provider_id,
        :translation_row_number,
        :table_name,
        :field_name,
        :language,
        :record_id,
        :translation
    )
    """
)

STOPS_INSERT = text(
    """
    INSERT INTO silver.stops (
        dataset_version_id,
        provider_id,
        stop_id,
        stop_code,
        stop_name,
        stop_desc,
        stop_lat,
        stop_lon,
        zone_id,
        stop_url,
        location_type,
        parent_station,
        stop_timezone,
        wheelchair_boarding,
        platform_code
    )
    VALUES (
        :dataset_version_id,
        :provider_id,
        :stop_id,
        :stop_code,
        :stop_name,
        :stop_desc,
        :stop_lat,
        :stop_lon,
        :zone_id,
        :stop_url,
        :location_type,
        :parent_station,
        :stop_timezone,
        :wheelchair_boarding,
        :platform_code
    )
    """
)

STOP_TIMES_INSERT = text(
    """
    INSERT INTO silver.stop_times (
        dataset_version_id,
        provider_id,
        trip_id,
        stop_sequence,
        stop_id,
        arrival_time,
        departure_time,
        stop_headsign,
        pickup_type,
        drop_off_type,
        continuous_pickup,
        continuous_drop_off,
        shape_dist_traveled,
        timepoint
    )
    VALUES (
        :dataset_version_id,
        :provider_id,
        :trip_id,
        :stop_sequence,
        :stop_id,
        :arrival_time,
        :departure_time,
        :stop_headsign,
        :pickup_type,
        :drop_off_type,
        :continuous_pickup,
        :continuous_drop_off,
        :shape_dist_traveled,
        :timepoint
    )
    """
)

CALENDAR_INSERT = text(
    """
    INSERT INTO silver.calendar (
        dataset_version_id,
        provider_id,
        service_id,
        monday,
        tuesday,
        wednesday,
        thursday,
        friday,
        saturday,
        sunday,
        start_date,
        end_date
    )
    VALUES (
        :dataset_version_id,
        :provider_id,
        :service_id,
        :monday,
        :tuesday,
        :wednesday,
        :thursday,
        :friday,
        :saturday,
        :sunday,
        :start_date,
        :end_date
    )
    """
)

CALENDAR_DATES_INSERT = text(
    """
    INSERT INTO silver.calendar_dates (
        dataset_version_id,
        provider_id,
        service_id,
        service_date,
        exception_type
    )
    VALUES (
        :dataset_version_id,
        :provider_id,
        :service_id,
        :service_date,
        :exception_type
    )
    """
)


@dataclass(frozen=True)
class BronzeStaticArchive:
    provider_id: str
    storage_backend: str
    feed_endpoint_id: int
    source_ingestion_run_id: int
    source_ingestion_object_id: int
    storage_path: str
    archive_full_path: str
    source_url: str | None
    checksum_sha256: str
    byte_size: int | None
    source_completed_at_utc: datetime | None


@dataclass(frozen=True)
class StaticSilverLoadResult:
    provider_id: str
    dataset_version_id: int
    source_ingestion_run_id: int
    source_ingestion_object_id: int
    storage_path: str
    archive_full_path: str
    content_hash: str
    source_version: str
    loaded_at_utc: datetime
    row_counts: dict[str, int]
    member_count: int = 0
    unsupported_members: list[str] = field(default_factory=list)
    typed_row_counts: dict[str, int] = field(default_factory=dict)
    extra_row_counts: dict[str, int] = field(default_factory=dict)

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["loaded_at_utc"] = self.loaded_at_utc.isoformat()
        return payload


def _project_root() -> Path:
    return project_root()


def _normalize_row(row: dict[str, str | None]) -> dict[str, str]:
    normalized: dict[str, str] = {}
    for key, value in row.items():
        if key is None:
            continue
        normalized[key] = value.strip() if isinstance(value, str) else ""
    return normalized


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _require_value(row: Mapping[str, str], column_name: str, member_name: str) -> str:
    value = _blank_to_none(row.get(column_name))
    if value is None:
        raise ValueError(f"{member_name} requires non-empty column '{column_name}'.")
    return value


def _parse_optional_int(value: str | None) -> int | None:
    normalized = _blank_to_none(value)
    return int(normalized) if normalized is not None else None


def _parse_required_int(row: Mapping[str, str], column_name: str, member_name: str) -> int:
    return int(_require_value(row, column_name, member_name))


def _parse_optional_float(value: str | None) -> float | None:
    normalized = _blank_to_none(value)
    return float(normalized) if normalized is not None else None


def _parse_gtfs_date(value: str, member_name: str, column_name: str) -> date:
    try:
        return datetime.strptime(value, "%Y%m%d").date()
    except ValueError as exc:
        raise ValueError(
            f"{member_name} column '{column_name}' must be in YYYYMMDD format."
        ) from exc


def _parse_gtfs_bool(row: Mapping[str, str], column_name: str, member_name: str) -> bool:
    value = _require_value(row, column_name, member_name)
    if value not in {"0", "1"}:
        raise ValueError(f"{member_name} column '{column_name}' must be 0 or 1.")
    return value == "1"


def _build_agency_record(
    row: Mapping[str, str],
    *,
    provider_id: str,
    dataset_version_id: int,
) -> dict[str, object]:
    return {
        "dataset_version_id": dataset_version_id,
        "provider_id": provider_id,
        "agency_id": _require_value(row, "agency_id", "agency.txt"),
        "agency_name": _require_value(row, "agency_name", "agency.txt"),
        "agency_url": _require_value(row, "agency_url", "agency.txt"),
        "agency_timezone": _require_value(row, "agency_timezone", "agency.txt"),
        "agency_lang": _blank_to_none(row.get("agency_lang")),
        "agency_phone": _blank_to_none(row.get("agency_phone")),
        "agency_fare_url": _blank_to_none(row.get("agency_fare_url")),
    }


def _build_feed_info_record(
    row: Mapping[str, str],
    *,
    provider_id: str,
    dataset_version_id: int,
) -> dict[str, object]:
    return {
        "dataset_version_id": dataset_version_id,
        "provider_id": provider_id,
        "feed_publisher_name": _require_value(
            row,
            "feed_publisher_name",
            "feed_info.txt",
        ),
        "feed_publisher_url": _require_value(
            row,
            "feed_publisher_url",
            "feed_info.txt",
        ),
        "feed_lang": _require_value(row, "feed_lang", "feed_info.txt"),
        "feed_start_date": _parse_gtfs_date(
            _require_value(row, "feed_start_date", "feed_info.txt"),
            "feed_info.txt",
            "feed_start_date",
        ),
        "feed_end_date": _parse_gtfs_date(
            _require_value(row, "feed_end_date", "feed_info.txt"),
            "feed_info.txt",
            "feed_end_date",
        ),
        "feed_version": _require_value(row, "feed_version", "feed_info.txt"),
    }


def _chunked(
    rows: Iterable[dict[str, object]],
    chunk_size: int,
) -> Iterator[list[dict[str, object]]]:
    iterator = iter(rows)
    while chunk := list(islice(iterator, chunk_size)):
        yield chunk


def _discover_gtfs_members_from_zip(zip_file: ZipFile) -> dict[str, str]:
    member_map: dict[str, str] = {}
    for member_name in zip_file.namelist():
        if member_name.endswith("/"):
            continue
        member_key = Path(member_name).name.lower()
        if not member_key:
            continue
        if member_key in member_map:
            raise ValueError(
                f"Duplicate GTFS member basename '{member_key}' found in archive."
            )
        member_map[member_key] = member_name
    return member_map


def discover_gtfs_members(archive_path: Path) -> dict[str, str]:
    with ZipFile(archive_path) as zip_file:
        return _discover_gtfs_members_from_zip(zip_file)


def validate_required_static_members(member_map: Mapping[str, str]) -> None:
    missing_members = sorted(REQUIRED_STATIC_MEMBERS - set(member_map))
    if missing_members:
        missing_display = ", ".join(missing_members)
        raise ValueError(f"Missing required GTFS members: {missing_display}")
    if not (OPTIONAL_SERVICE_MEMBERS & set(member_map)):
        raise ValueError(
            "At least one of calendar.txt or calendar_dates.txt must be present."
        )


def _read_member_header(zip_file: ZipFile, member_name: str) -> set[str]:
    with zip_file.open(member_name, "r") as raw_handle, TextIOWrapper(
        raw_handle,
        encoding="utf-8-sig",
        newline="",
    ) as text_handle:
        reader = csv.DictReader(text_handle)
        return set(reader.fieldnames or [])


def _read_member_columns_and_row_count(
    zip_file: ZipFile,
    member_name: str,
) -> tuple[list[str], int]:
    with zip_file.open(member_name, "r") as raw_handle, TextIOWrapper(
        raw_handle,
        encoding="utf-8-sig",
        newline="",
    ) as text_handle:
        reader = csv.DictReader(text_handle)
        columns = list(reader.fieldnames or [])
        row_count = sum(1 for _ in reader)
        return columns, row_count


def _hash_zip_member(zip_file: ZipFile, member_name: str) -> str:
    digest = hashlib.sha256()
    with zip_file.open(member_name, "r") as raw_handle:
        for chunk in iter(lambda: raw_handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_beta_static_contract(member_map: Mapping[str, str], zip_file: ZipFile) -> None:
    missing_members = sorted(BETA_STATIC_CONTRACT_MEMBERS - set(member_map))
    if missing_members:
        raise ValueError(
            "Missing beta GTFS contract members: " + ", ".join(missing_members)
        )

    missing_columns: dict[str, list[str]] = {}
    for member_key, required_columns in BETA_STATIC_CONTRACT_COLUMNS_BY_MEMBER.items():
        member_name = member_map.get(member_key)
        if member_name is None:
            missing_columns[member_key] = sorted(required_columns)
            continue
        header = _read_member_header(zip_file, member_name)
        missing = sorted(required_columns - header)
        if missing:
            missing_columns[member_key] = missing

    if missing_columns:
        details = "; ".join(
            f"{member_key}: {', '.join(columns)}"
            for member_key, columns in sorted(missing_columns.items())
        )
        raise ValueError("Missing beta GTFS contract columns: " + details)


def _iter_gtfs_rows(
    zip_file: ZipFile,
    *,
    member_name: str,
    required_columns: set[str],
) -> Iterator[dict[str, str]]:
    with zip_file.open(member_name, "r") as raw_handle, TextIOWrapper(
        raw_handle,
        encoding="utf-8-sig",
        newline="",
    ) as text_handle:
        reader = csv.DictReader(text_handle)
        fieldnames = set(reader.fieldnames or [])
        if not fieldnames:
            raise ValueError(f"{member_name} is missing a header row.")

        missing_columns = sorted(required_columns - fieldnames)
        if missing_columns:
            missing_display = ", ".join(missing_columns)
            raise ValueError(f"{member_name} is missing required columns: {missing_display}")

        for row in reader:
            yield _normalize_row(row)


def _build_route_record(
    row: Mapping[str, str],
    *,
    provider_id: str,
    dataset_version_id: int,
) -> dict[str, object]:
    return {
        "dataset_version_id": dataset_version_id,
        "provider_id": provider_id,
        "route_id": _require_value(row, "route_id", "routes.txt"),
        "agency_id": _blank_to_none(row.get("agency_id")),
        "route_short_name": _blank_to_none(row.get("route_short_name")),
        "route_long_name": _blank_to_none(row.get("route_long_name")),
        "route_desc": _blank_to_none(row.get("route_desc")),
        "route_type": _parse_required_int(row, "route_type", "routes.txt"),
        "route_url": _blank_to_none(row.get("route_url")),
        "route_color": _blank_to_none(row.get("route_color")),
        "route_text_color": _blank_to_none(row.get("route_text_color")),
        "route_desc_detail": _blank_to_none(row.get("route_desc_detail")),
        "route_sort_order": _parse_optional_int(row.get("route_sort_order")),
        "continuous_pickup": _parse_optional_int(row.get("continuous_pickup")),
        "continuous_drop_off": _parse_optional_int(row.get("continuous_drop_off")),
        "network_id": _blank_to_none(row.get("network_id")),
    }


def _build_trip_record(
    row: Mapping[str, str],
    *,
    provider_id: str,
    dataset_version_id: int,
) -> dict[str, object]:
    return {
        "dataset_version_id": dataset_version_id,
        "provider_id": provider_id,
        "trip_id": _require_value(row, "trip_id", "trips.txt"),
        "route_id": _require_value(row, "route_id", "trips.txt"),
        "service_id": _require_value(row, "service_id", "trips.txt"),
        "trip_headsign": _blank_to_none(row.get("trip_headsign")),
        "trip_short_name": _blank_to_none(row.get("trip_short_name")),
        "direction_id": _parse_optional_int(row.get("direction_id")),
        "block_id": _blank_to_none(row.get("block_id")),
        "shape_id": _blank_to_none(row.get("shape_id")),
        "route_pattern_id": _blank_to_none(row.get("route_pattern_id")),
        "note_fr": _blank_to_none(row.get("note_fr")),
        "note_en": _blank_to_none(row.get("note_en")),
        "wheelchair_accessible": _parse_optional_int(row.get("wheelchair_accessible")),
        "bikes_allowed": _parse_optional_int(row.get("bikes_allowed")),
    }


def _build_stop_record(
    row: Mapping[str, str],
    *,
    provider_id: str,
    dataset_version_id: int,
) -> dict[str, object]:
    return {
        "dataset_version_id": dataset_version_id,
        "provider_id": provider_id,
        "stop_id": _require_value(row, "stop_id", "stops.txt"),
        "stop_code": _blank_to_none(row.get("stop_code")),
        "stop_name": _require_value(row, "stop_name", "stops.txt"),
        "stop_desc": _blank_to_none(row.get("stop_desc")),
        "stop_lat": _parse_optional_float(row.get("stop_lat")),
        "stop_lon": _parse_optional_float(row.get("stop_lon")),
        "zone_id": _blank_to_none(row.get("zone_id")),
        "stop_url": _blank_to_none(row.get("stop_url")),
        "location_type": _parse_optional_int(row.get("location_type")),
        "parent_station": _blank_to_none(row.get("parent_station")),
        "stop_timezone": _blank_to_none(row.get("stop_timezone")),
        "wheelchair_boarding": _parse_optional_int(row.get("wheelchair_boarding")),
        "platform_code": _blank_to_none(row.get("platform_code")),
    }


def _build_stop_time_record(
    row: Mapping[str, str],
    *,
    provider_id: str,
    dataset_version_id: int,
) -> dict[str, object]:
    return {
        "dataset_version_id": dataset_version_id,
        "provider_id": provider_id,
        "trip_id": _require_value(row, "trip_id", "stop_times.txt"),
        "stop_sequence": _parse_required_int(row, "stop_sequence", "stop_times.txt"),
        "stop_id": _require_value(row, "stop_id", "stop_times.txt"),
        "arrival_time": _blank_to_none(row.get("arrival_time")),
        "departure_time": _blank_to_none(row.get("departure_time")),
        "stop_headsign": _blank_to_none(row.get("stop_headsign")),
        "pickup_type": _parse_optional_int(row.get("pickup_type")),
        "drop_off_type": _parse_optional_int(row.get("drop_off_type")),
        "continuous_pickup": _parse_optional_int(row.get("continuous_pickup")),
        "continuous_drop_off": _parse_optional_int(row.get("continuous_drop_off")),
        "shape_dist_traveled": _parse_optional_float(row.get("shape_dist_traveled")),
        "timepoint": _parse_optional_int(row.get("timepoint")),
    }


def _build_calendar_record(
    row: Mapping[str, str],
    *,
    provider_id: str,
    dataset_version_id: int,
) -> dict[str, object]:
    return {
        "dataset_version_id": dataset_version_id,
        "provider_id": provider_id,
        "service_id": _require_value(row, "service_id", "calendar.txt"),
        "monday": _parse_gtfs_bool(row, "monday", "calendar.txt"),
        "tuesday": _parse_gtfs_bool(row, "tuesday", "calendar.txt"),
        "wednesday": _parse_gtfs_bool(row, "wednesday", "calendar.txt"),
        "thursday": _parse_gtfs_bool(row, "thursday", "calendar.txt"),
        "friday": _parse_gtfs_bool(row, "friday", "calendar.txt"),
        "saturday": _parse_gtfs_bool(row, "saturday", "calendar.txt"),
        "sunday": _parse_gtfs_bool(row, "sunday", "calendar.txt"),
        "start_date": _parse_gtfs_date(
            _require_value(row, "start_date", "calendar.txt"),
            "calendar.txt",
            "start_date",
        ),
        "end_date": _parse_gtfs_date(
            _require_value(row, "end_date", "calendar.txt"),
            "calendar.txt",
            "end_date",
        ),
    }


def _build_calendar_date_record(
    row: Mapping[str, str],
    *,
    provider_id: str,
    dataset_version_id: int,
) -> dict[str, object]:
    return {
        "dataset_version_id": dataset_version_id,
        "provider_id": provider_id,
        "service_id": _require_value(row, "service_id", "calendar_dates.txt"),
        "service_date": _parse_gtfs_date(
            _require_value(row, "date", "calendar_dates.txt"),
            "calendar_dates.txt",
            "date",
        ),
        "exception_type": _parse_required_int(row, "exception_type", "calendar_dates.txt"),
    }


def _build_direction_record(
    row: Mapping[str, str],
    *,
    provider_id: str,
    dataset_version_id: int,
) -> dict[str, object]:
    return {
        "dataset_version_id": dataset_version_id,
        "provider_id": provider_id,
        "route_direction_id": _require_value(row, "route_direction_id", "directions.txt"),
        "route_id": _require_value(row, "route_id", "directions.txt"),
        "direction_id": _parse_required_int(row, "direction_id", "directions.txt"),
        "direction": _require_value(row, "direction", "directions.txt"),
        "direction_legacy": _require_value(row, "direction_legacy", "directions.txt"),
    }


def _build_route_pattern_record(
    row: Mapping[str, str],
    *,
    provider_id: str,
    dataset_version_id: int,
) -> dict[str, object]:
    return {
        "dataset_version_id": dataset_version_id,
        "provider_id": provider_id,
        "route_pattern_id": _require_value(
            row,
            "route_pattern_id",
            "route_patterns.txt",
        ),
        "route_id": _require_value(row, "route_id", "route_patterns.txt"),
        "direction_id": _parse_required_int(row, "direction_id", "route_patterns.txt"),
        "route_pattern_typicality": _parse_required_int(
            row,
            "route_pattern_typicality",
            "route_patterns.txt",
        ),
    }


def _build_shape_record(
    row: Mapping[str, str],
    *,
    provider_id: str,
    dataset_version_id: int,
) -> dict[str, object]:
    return {
        "dataset_version_id": dataset_version_id,
        "provider_id": provider_id,
        "shape_id": _require_value(row, "shape_id", "shapes.txt"),
        "shape_pt_sequence": _parse_required_int(
            row,
            "shape_pt_sequence",
            "shapes.txt",
        ),
        "shape_pt_lat": _parse_optional_float(row.get("shape_pt_lat")),
        "shape_pt_lon": _parse_optional_float(row.get("shape_pt_lon")),
        "route_pattern_id": _blank_to_none(row.get("route_pattern_id")),
    }


def _build_translation_record(
    row: Mapping[str, str],
    *,
    provider_id: str,
    dataset_version_id: int,
    translation_row_number: int,
) -> dict[str, object]:
    return {
        "dataset_version_id": dataset_version_id,
        "provider_id": provider_id,
        "translation_row_number": translation_row_number,
        "table_name": _require_value(row, "table_name", "translations.txt"),
        "field_name": _require_value(row, "field_name", "translations.txt"),
        "language": _require_value(row, "language", "translations.txt"),
        "record_id": _require_value(row, "record_id", "translations.txt"),
        "translation": _require_value(row, "translation", "translations.txt"),
    }


def _execute_batched_insert(
    connection: Connection,
    *,
    statement,
    rows: Iterable[dict[str, object]],
) -> int:
    row_count = 0
    for chunk in _chunked(rows, CHUNK_SIZE):
        connection.execute(statement, chunk)
        row_count += len(chunk)
    return row_count


def _load_member_rows(
    connection: Connection,
    *,
    zip_file: ZipFile,
    member_map: Mapping[str, str],
    member_key: str,
    provider_id: str,
    dataset_version_id: int,
    builder: Callable[..., dict[str, object]],
    statement,
) -> int:
    if member_key not in member_map:
        return 0
    member_name = member_map[member_key]
    required_columns = REQUIRED_COLUMNS_BY_MEMBER[member_key]
    rows = (
        builder(
            row,
            provider_id=provider_id,
            dataset_version_id=dataset_version_id,
        )
        for row in _iter_gtfs_rows(
            zip_file,
            member_name=member_name,
            required_columns=required_columns,
        )
    )
    return _execute_batched_insert(connection, statement=statement, rows=rows)


def _load_translation_rows(
    connection: Connection,
    *,
    zip_file: ZipFile,
    member_map: Mapping[str, str],
    provider_id: str,
    dataset_version_id: int,
) -> int:
    member_key = "translations.txt"
    if member_key not in member_map:
        return 0
    member_name = member_map[member_key]
    required_columns = REQUIRED_COLUMNS_BY_MEMBER[member_key]
    rows = (
        _build_translation_record(
            row,
            provider_id=provider_id,
            dataset_version_id=dataset_version_id,
            translation_row_number=translation_row_number,
        )
        for translation_row_number, row in enumerate(
            _iter_gtfs_rows(
                zip_file,
                member_name=member_name,
                required_columns=required_columns,
            ),
            start=1,
        )
    )
    return _execute_batched_insert(connection, statement=TRANSLATIONS_INSERT, rows=rows)


def _txt_member_items(member_map: Mapping[str, str]) -> list[tuple[str, str]]:
    return sorted(
        (
            (source_file_name, member_path)
            for source_file_name, member_path in member_map.items()
            if source_file_name.endswith(".txt")
        ),
        key=lambda item: item[0],
    )


def _record_gtfs_source_members(
    connection: Connection,
    *,
    zip_file: ZipFile,
    member_map: Mapping[str, str],
    provider_id: str,
    dataset_version_id: int,
    loaded_at_utc: datetime,
) -> int:
    rows: list[dict[str, object]] = []
    for source_file_name, member_path in _txt_member_items(member_map):
        columns, row_count = _read_member_columns_and_row_count(zip_file, member_path)
        rows.append(
            {
                "dataset_version_id": dataset_version_id,
                "provider_id": provider_id,
                "source_file_name": source_file_name,
                "member_path": member_path,
                "row_count": row_count,
                "checksum_sha256": _hash_zip_member(zip_file, member_path),
                "byte_size": zip_file.getinfo(member_path).file_size,
                "first_seen_at_utc": loaded_at_utc,
                "last_seen_at_utc": loaded_at_utc,
                "manifest_json": {
                    "columns": columns,
                    "column_count": len(columns),
                },
            }
        )
    return _execute_batched_insert(
        connection,
        statement=GTFS_SOURCE_MEMBER_INSERT,
        rows=rows,
    )


def _load_extra_member_rows(
    connection: Connection,
    *,
    zip_file: ZipFile,
    member_map: Mapping[str, str],
    provider_id: str,
    dataset_version_id: int,
) -> dict[str, int]:
    extra_row_counts: dict[str, int] = {}
    for source_file_name, member_path in _txt_member_items(member_map):
        if source_file_name in SUPPORTED_STATIC_MEMBER_KEYS:
            continue
        rows = (
            {
                "dataset_version_id": dataset_version_id,
                "provider_id": provider_id,
                "source_file_name": source_file_name,
                "source_row_number": source_row_number,
                "row_json": row,
            }
            for source_row_number, row in enumerate(
                _iter_gtfs_rows(
                    zip_file,
                    member_name=member_path,
                    required_columns=set(),
                ),
                start=1,
            )
        )
        extra_row_counts[source_file_name] = _execute_batched_insert(
            connection,
            statement=GTFS_EXTRA_ROW_INSERT,
            rows=rows,
        )
    return extra_row_counts


def find_latest_static_bronze_archive(
    connection: Connection,
    *,
    provider_id: str,
    endpoint_key: str,
    settings: Settings,
    project_root: Path,
) -> BronzeStaticArchive:
    archive_row = connection.execute(
        text(
            """
            SELECT
                io.provider_id,
                io.storage_backend,
                ir.feed_endpoint_id,
                io.ingestion_run_id AS source_ingestion_run_id,
                io.ingestion_object_id AS source_ingestion_object_id,
                io.storage_path,
                io.source_url,
                io.checksum_sha256,
                io.byte_size,
                ir.completed_at_utc AS source_completed_at_utc
            FROM raw.ingestion_objects AS io
            INNER JOIN raw.ingestion_runs AS ir
                ON ir.ingestion_run_id = io.ingestion_run_id
            INNER JOIN core.feed_endpoints AS fe
                ON fe.feed_endpoint_id = ir.feed_endpoint_id
            WHERE io.provider_id = :provider_id
              AND ir.status = 'succeeded'
              AND ir.run_kind = 'static_schedule'
              AND fe.endpoint_key = :endpoint_key
            ORDER BY ir.started_at_utc DESC, io.ingestion_object_id DESC
            LIMIT 1
            """
        ),
        {
            "provider_id": provider_id,
            "endpoint_key": endpoint_key,
        },
    ).mappings().one_or_none()

    if archive_row is None:
        raise ValueError(
            "No successful Bronze static GTFS archive was found for this provider. "
            "Run ingest-static before load-static-silver."
        )
    bronze_storage = get_bronze_storage(
        settings,
        project_root=project_root,
        storage_backend=str(archive_row["storage_backend"]),
    )

    return BronzeStaticArchive(
        provider_id=str(archive_row["provider_id"]),
        storage_backend=str(archive_row["storage_backend"]),
        feed_endpoint_id=int(archive_row["feed_endpoint_id"]),
        source_ingestion_run_id=int(archive_row["source_ingestion_run_id"]),
        source_ingestion_object_id=int(archive_row["source_ingestion_object_id"]),
        storage_path=str(archive_row["storage_path"]),
        archive_full_path=bronze_storage.describe_location(str(archive_row["storage_path"])),
        source_url=str(archive_row["source_url"]) if archive_row["source_url"] else None,
        checksum_sha256=str(archive_row["checksum_sha256"]),
        byte_size=int(archive_row["byte_size"]) if archive_row["byte_size"] is not None else None,
        source_completed_at_utc=archive_row["source_completed_at_utc"],
    )


def get_current_static_content_hash(
    connection: Connection,
    *,
    provider_id: str,
) -> str | None:
    """Return the content_hash of the current active static dataset version, or None."""
    row = connection.execute(
        text(
            """
            SELECT content_hash
            FROM core.dataset_versions
            WHERE provider_id = :provider_id
              AND dataset_kind = 'static_schedule'
              AND is_current = true
            ORDER BY loaded_at_utc DESC
            LIMIT 1
            """
        ),
        {"provider_id": provider_id},
    ).scalar_one_or_none()
    return str(row) if row is not None else None


def _mark_previous_dataset_versions_not_current(
    connection: Connection,
    *,
    provider_id: str,
    feed_endpoint_id: int,
) -> None:
    connection.execute(
        text(
            """
            UPDATE core.dataset_versions
            SET is_current = false
            WHERE provider_id = :provider_id
              AND feed_endpoint_id = :feed_endpoint_id
              AND dataset_kind = 'static_schedule'
              AND is_current = true
            """
        ),
        {
            "provider_id": provider_id,
            "feed_endpoint_id": feed_endpoint_id,
        },
    )


def _insert_dataset_version(
    connection: Connection,
    *,
    archive: BronzeStaticArchive,
    loaded_at_utc: datetime,
) -> int:
    result = connection.execute(
        text(
            """
            INSERT INTO core.dataset_versions (
                provider_id,
                feed_endpoint_id,
                source_ingestion_run_id,
                source_ingestion_object_id,
                dataset_kind,
                source_version,
                content_hash,
                loaded_at_utc,
                effective_at_utc,
                is_current
            )
            VALUES (
                :provider_id,
                :feed_endpoint_id,
                :source_ingestion_run_id,
                :source_ingestion_object_id,
                'static_schedule',
                :source_version,
                :content_hash,
                :loaded_at_utc,
                :effective_at_utc,
                true
            )
            RETURNING dataset_version_id
            """
        ),
        {
            "provider_id": archive.provider_id,
            "feed_endpoint_id": archive.feed_endpoint_id,
            "source_ingestion_run_id": archive.source_ingestion_run_id,
            "source_ingestion_object_id": archive.source_ingestion_object_id,
            "source_version": archive.storage_path,
            "content_hash": archive.checksum_sha256,
            "loaded_at_utc": loaded_at_utc,
            "effective_at_utc": archive.source_completed_at_utc,
        },
    )
    return int(result.scalar_one())


def register_dataset_version(
    connection: Connection,
    *,
    archive: BronzeStaticArchive,
    loaded_at_utc: datetime | None = None,
) -> tuple[int, datetime]:
    version_loaded_at_utc = loaded_at_utc or utc_now()
    _mark_previous_dataset_versions_not_current(
        connection,
        provider_id=archive.provider_id,
        feed_endpoint_id=archive.feed_endpoint_id,
    )
    dataset_version_id = _insert_dataset_version(
        connection,
        archive=archive,
        loaded_at_utc=version_loaded_at_utc,
    )
    return dataset_version_id, version_loaded_at_utc


def load_static_zip_to_silver(
    connection: Connection,
    *,
    archive: BronzeStaticArchive,
    bronze_storage,
    require_beta_static_contract: bool = False,
) -> StaticSilverLoadResult:
    if not bronze_storage.exists(archive.storage_path):
        archive_location = bronze_storage.describe_location(archive.storage_path)
        raise FileNotFoundError(
            f"Bronze archive file not found: {archive_location}"
        )

    archive_bytes = bronze_storage.read_bytes(archive.storage_path)

    dataset_version_id, loaded_at_utc = register_dataset_version(
        connection,
        archive=archive,
    )

    with ZipFile(BytesIO(archive_bytes)) as zip_file:
        member_map = _discover_gtfs_members_from_zip(zip_file)
        validate_required_static_members(member_map)
        if require_beta_static_contract:
            validate_beta_static_contract(member_map, zip_file)
        row_counts = {
            "routes": _load_member_rows(
                connection,
                zip_file=zip_file,
                member_map=member_map,
                member_key="routes.txt",
                provider_id=archive.provider_id,
                dataset_version_id=dataset_version_id,
                builder=_build_route_record,
                statement=ROUTES_INSERT,
            ),
            "stops": _load_member_rows(
                connection,
                zip_file=zip_file,
                member_map=member_map,
                member_key="stops.txt",
                provider_id=archive.provider_id,
                dataset_version_id=dataset_version_id,
                builder=_build_stop_record,
                statement=STOPS_INSERT,
            ),
            "trips": _load_member_rows(
                connection,
                zip_file=zip_file,
                member_map=member_map,
                member_key="trips.txt",
                provider_id=archive.provider_id,
                dataset_version_id=dataset_version_id,
                builder=_build_trip_record,
                statement=TRIPS_INSERT,
            ),
            "stop_times": _load_member_rows(
                connection,
                zip_file=zip_file,
                member_map=member_map,
                member_key="stop_times.txt",
                provider_id=archive.provider_id,
                dataset_version_id=dataset_version_id,
                builder=_build_stop_time_record,
                statement=STOP_TIMES_INSERT,
            ),
            "calendar": _load_member_rows(
                connection,
                zip_file=zip_file,
                member_map=member_map,
                member_key="calendar.txt",
                provider_id=archive.provider_id,
                dataset_version_id=dataset_version_id,
                builder=_build_calendar_record,
                statement=CALENDAR_INSERT,
            ),
            "calendar_dates": _load_member_rows(
                connection,
                zip_file=zip_file,
                member_map=member_map,
                member_key="calendar_dates.txt",
                provider_id=archive.provider_id,
                dataset_version_id=dataset_version_id,
                builder=_build_calendar_date_record,
                statement=CALENDAR_DATES_INSERT,
            ),
        }
        optional_row_counts = {
            "agency": _load_member_rows(
                connection,
                zip_file=zip_file,
                member_map=member_map,
                member_key="agency.txt",
                provider_id=archive.provider_id,
                dataset_version_id=dataset_version_id,
                builder=_build_agency_record,
                statement=AGENCY_INSERT,
            ),
            "feed_info": _load_member_rows(
                connection,
                zip_file=zip_file,
                member_map=member_map,
                member_key="feed_info.txt",
                provider_id=archive.provider_id,
                dataset_version_id=dataset_version_id,
                builder=_build_feed_info_record,
                statement=FEED_INFO_INSERT,
            ),
            "directions": _load_member_rows(
                connection,
                zip_file=zip_file,
                member_map=member_map,
                member_key="directions.txt",
                provider_id=archive.provider_id,
                dataset_version_id=dataset_version_id,
                builder=_build_direction_record,
                statement=DIRECTIONS_INSERT,
            ),
            "route_patterns": _load_member_rows(
                connection,
                zip_file=zip_file,
                member_map=member_map,
                member_key="route_patterns.txt",
                provider_id=archive.provider_id,
                dataset_version_id=dataset_version_id,
                builder=_build_route_pattern_record,
                statement=ROUTE_PATTERNS_INSERT,
            ),
            "shapes": _load_member_rows(
                connection,
                zip_file=zip_file,
                member_map=member_map,
                member_key="shapes.txt",
                provider_id=archive.provider_id,
                dataset_version_id=dataset_version_id,
                builder=_build_shape_record,
                statement=SHAPES_INSERT,
            ),
            "translations": _load_translation_rows(
                connection,
                zip_file=zip_file,
                member_map=member_map,
                provider_id=archive.provider_id,
                dataset_version_id=dataset_version_id,
            ),
        }
        row_counts.update(
            {
                member_name: row_count
                for member_name, row_count in optional_row_counts.items()
                if row_count
            }
        )
        member_count = _record_gtfs_source_members(
            connection,
            zip_file=zip_file,
            member_map=member_map,
            provider_id=archive.provider_id,
            dataset_version_id=dataset_version_id,
            loaded_at_utc=loaded_at_utc,
        )
        extra_row_counts = _load_extra_member_rows(
            connection,
            zip_file=zip_file,
            member_map=member_map,
            provider_id=archive.provider_id,
            dataset_version_id=dataset_version_id,
        )
        unsupported_members = sorted(extra_row_counts)

    return StaticSilverLoadResult(
        provider_id=archive.provider_id,
        dataset_version_id=dataset_version_id,
        source_ingestion_run_id=archive.source_ingestion_run_id,
        source_ingestion_object_id=archive.source_ingestion_object_id,
        storage_path=archive.storage_path,
        archive_full_path=archive.archive_full_path,
        content_hash=archive.checksum_sha256,
        source_version=archive.storage_path,
        loaded_at_utc=loaded_at_utc,
        row_counts=row_counts,
        member_count=member_count,
        unsupported_members=unsupported_members,
        typed_row_counts=dict(row_counts),
        extra_row_counts=extra_row_counts,
    )


def load_latest_static_to_silver(
    provider_id: str,
    *,
    settings: Settings | None = None,
    registry: ProviderRegistry | None = None,
    engine: Engine | None = None,
) -> StaticSilverLoadResult:
    settings = settings or get_settings()
    registry = registry or ProviderRegistry.from_project_root(
        project_root=_project_root(),
        settings=settings,
    )
    manifest = registry.get_provider(provider_id)
    static_config = build_static_ingestion_config(manifest, settings)
    engine = engine or make_engine(settings)

    with engine.connect() as connection:
        archive = find_latest_static_bronze_archive(
            connection,
            provider_id=manifest.provider.provider_id,
            endpoint_key=static_config.endpoint_key,
            settings=settings,
            project_root=_project_root(),
        )
    bronze_storage = get_bronze_storage(
        settings,
        project_root=_project_root(),
        storage_backend=archive.storage_backend,
    )

    with engine.begin() as connection:
        result = load_static_zip_to_silver(
            connection,
            archive=archive,
            bronze_storage=bronze_storage,
            require_beta_static_contract=True,
        )
        prune_static_silver_datasets(
            connection,
            provider_id=manifest.provider.provider_id,
            retention_count=settings.STATIC_DATASET_RETENTION_COUNT,
        )
        return result
