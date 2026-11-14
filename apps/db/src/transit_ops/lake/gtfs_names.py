"""GTFS names for edition copies; stored columns keep their canonical names.

Read against the silver DDL and https://gtfs.org/documentation/schedule/reference/.
None means no standard GTFS file or field, including retained extension columns.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType


@dataclass(frozen=True)
class GtfsFile:
    file_name: str | None
    fields: Mapping[str, str | None]


def _file(
    file_name: str | None,
    standard: str = "",
    internal: str = "",
    **renamed: str,
) -> GtfsFile:
    fields: dict[str, str | None] = {"dataset_version_id": None, "provider_id": None}
    fields.update((name, name) for name in standard.split())
    fields.update((name, None) for name in internal.split())
    fields.update(renamed)
    return GtfsFile(file_name, MappingProxyType(fields))


GTFS_FILES: Mapping[str, GtfsFile] = MappingProxyType(
    {
        "silver.agency": _file(
            "agency.txt",
            "agency_id agency_name agency_url agency_timezone agency_lang agency_phone "
            "agency_fare_url",
        ),
        "silver.calendar": _file(
            "calendar.txt",
            "service_id monday tuesday wednesday thursday friday saturday sunday "
            "start_date end_date",
        ),
        "silver.calendar_dates": _file(
            "calendar_dates.txt", "service_id exception_type", service_date="date"
        ),
        "silver.directions": _file(
            None, internal="route_direction_id route_id direction_id direction direction_legacy"
        ),
        "silver.feed_info": _file(
            "feed_info.txt",
            "feed_publisher_name feed_publisher_url feed_lang feed_start_date feed_end_date "
            "feed_version",
        ),
        "silver.gtfs_extra_rows": _file(
            None, internal="source_file_name source_row_number row_json captured_at_utc"
        ),
        "silver.gtfs_source_members": _file(
            None,
            internal="source_file_name member_path row_count checksum_sha256 byte_size "
            "first_seen_at_utc last_seen_at_utc manifest_json",
        ),
        "silver.route_patterns": _file(
            None, internal="route_pattern_id route_id direction_id route_pattern_typicality"
        ),
        "silver.routes": _file(
            "routes.txt",
            "route_id agency_id route_short_name route_long_name route_desc route_type route_url "
            "route_color route_text_color route_sort_order continuous_pickup continuous_drop_off "
            "network_id",
            "route_desc_detail",
        ),
        "silver.shapes": _file(
            "shapes.txt", "shape_id shape_pt_sequence shape_pt_lat shape_pt_lon", "route_pattern_id"
        ),
        "silver.stops": _file(
            "stops.txt",
            "stop_id stop_code stop_name stop_desc stop_lat stop_lon zone_id stop_url "
            "location_type parent_station stop_timezone wheelchair_boarding platform_code",
        ),
        "silver.stop_times": _file(
            "stop_times.txt",
            "trip_id stop_sequence stop_id arrival_time departure_time stop_headsign pickup_type "
            "drop_off_type continuous_pickup continuous_drop_off shape_dist_traveled timepoint",
        ),
        "silver.translations": _file(
            "translations.txt",
            "table_name field_name language record_id translation",
            "translation_row_number",
        ),
        "silver.trips": _file(
            "trips.txt",
            "trip_id route_id service_id trip_headsign trip_short_name direction_id block_id "
            "shape_id wheelchair_accessible bikes_allowed",
            "route_pattern_id note_fr note_en",
        ),
        # Derived edition rows are copied too, but do not represent a GTFS file.
        "gold.trip_service_span": _file(
            None, internal="trip_id route_id service_id first_seconds last_seconds"
        ),
    }
)
