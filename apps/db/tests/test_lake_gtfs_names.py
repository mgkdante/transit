import pytest

from transit_ops.history.datasets import HISTORY_DATASETS, TableSource
from transit_ops.lake.gtfs_names import GTFS_FILES


def test_every_edition_table_has_a_gtfs_entry():
    tables = {
        dataset.source.table
        for dataset in HISTORY_DATASETS.values()
        if dataset.archive_grain == "edition" and isinstance(dataset.source, TableSource)
    }
    assert tables <= GTFS_FILES.keys()


def test_calendar_dates_service_date_is_gtfs_date():
    entry = GTFS_FILES["silver.calendar_dates"]
    assert entry.file_name == "calendar_dates.txt"
    assert dict(entry.fields) == {
        "dataset_version_id": None,
        "provider_id": None,
        "service_id": "service_id",
        "service_date": "date",
        "exception_type": "exception_type",
    }


def test_internal_columns_map_to_none():
    for entry in GTFS_FILES.values():
        assert entry.fields["provider_id"] is None
        assert entry.fields["dataset_version_id"] is None
    assert GTFS_FILES["silver.translations"].fields["translation_row_number"] is None


# Literal expectations from the DDL and GTFS reference, independent of the registry builder.
@pytest.mark.parametrize(
    "table,file_name,fields",
    [
        (
            "silver.agency",
            "agency.txt",
            {
                "agency_id": "agency_id",
                "agency_name": "agency_name",
                "agency_url": "agency_url",
                "agency_timezone": "agency_timezone",
                "agency_lang": "agency_lang",
                "agency_phone": "agency_phone",
                "agency_fare_url": "agency_fare_url",
            },
        ),
        (
            "silver.calendar",
            "calendar.txt",
            {
                "service_id": "service_id",
                "monday": "monday",
                "tuesday": "tuesday",
                "wednesday": "wednesday",
                "thursday": "thursday",
                "friday": "friday",
                "saturday": "saturday",
                "sunday": "sunday",
                "start_date": "start_date",
                "end_date": "end_date",
            },
        ),
        (
            "silver.calendar_dates",
            "calendar_dates.txt",
            {
                "service_id": "service_id",
                "service_date": "date",
                "exception_type": "exception_type",
            },
        ),
        (
            "silver.directions",
            None,
            {
                "route_direction_id": None,
                "route_id": None,
                "direction_id": None,
                "direction": None,
                "direction_legacy": None,
            },
        ),
        (
            "silver.feed_info",
            "feed_info.txt",
            {
                "feed_publisher_name": "feed_publisher_name",
                "feed_publisher_url": "feed_publisher_url",
                "feed_lang": "feed_lang",
                "feed_start_date": "feed_start_date",
                "feed_end_date": "feed_end_date",
                "feed_version": "feed_version",
            },
        ),
        (
            "silver.gtfs_extra_rows",
            None,
            {
                "source_file_name": None,
                "source_row_number": None,
                "row_json": None,
                "captured_at_utc": None,
            },
        ),
        (
            "silver.gtfs_source_members",
            None,
            {
                "source_file_name": None,
                "member_path": None,
                "row_count": None,
                "checksum_sha256": None,
                "byte_size": None,
                "first_seen_at_utc": None,
                "last_seen_at_utc": None,
                "manifest_json": None,
            },
        ),
        (
            "silver.route_patterns",
            None,
            {
                "route_pattern_id": None,
                "route_id": None,
                "direction_id": None,
                "route_pattern_typicality": None,
            },
        ),
        (
            "silver.routes",
            "routes.txt",
            {
                "route_id": "route_id",
                "agency_id": "agency_id",
                "route_short_name": "route_short_name",
                "route_long_name": "route_long_name",
                "route_desc": "route_desc",
                "route_type": "route_type",
                "route_url": "route_url",
                "route_color": "route_color",
                "route_text_color": "route_text_color",
                "route_sort_order": "route_sort_order",
                "continuous_pickup": "continuous_pickup",
                "continuous_drop_off": "continuous_drop_off",
                "network_id": "network_id",
                "route_desc_detail": None,
            },
        ),
        (
            "silver.shapes",
            "shapes.txt",
            {
                "shape_id": "shape_id",
                "shape_pt_sequence": "shape_pt_sequence",
                "shape_pt_lat": "shape_pt_lat",
                "shape_pt_lon": "shape_pt_lon",
                "route_pattern_id": None,
            },
        ),
        (
            "silver.stops",
            "stops.txt",
            {
                "stop_id": "stop_id",
                "stop_code": "stop_code",
                "stop_name": "stop_name",
                "stop_desc": "stop_desc",
                "stop_lat": "stop_lat",
                "stop_lon": "stop_lon",
                "zone_id": "zone_id",
                "stop_url": "stop_url",
                "location_type": "location_type",
                "parent_station": "parent_station",
                "stop_timezone": "stop_timezone",
                "wheelchair_boarding": "wheelchair_boarding",
                "platform_code": "platform_code",
            },
        ),
        (
            "silver.stop_times",
            "stop_times.txt",
            {
                "trip_id": "trip_id",
                "stop_sequence": "stop_sequence",
                "stop_id": "stop_id",
                "arrival_time": "arrival_time",
                "departure_time": "departure_time",
                "stop_headsign": "stop_headsign",
                "pickup_type": "pickup_type",
                "drop_off_type": "drop_off_type",
                "continuous_pickup": "continuous_pickup",
                "continuous_drop_off": "continuous_drop_off",
                "shape_dist_traveled": "shape_dist_traveled",
                "timepoint": "timepoint",
            },
        ),
        (
            "silver.translations",
            "translations.txt",
            {
                "translation_row_number": None,
                "table_name": "table_name",
                "field_name": "field_name",
                "language": "language",
                "record_id": "record_id",
                "translation": "translation",
            },
        ),
        (
            "silver.trips",
            "trips.txt",
            {
                "trip_id": "trip_id",
                "route_id": "route_id",
                "service_id": "service_id",
                "trip_headsign": "trip_headsign",
                "trip_short_name": "trip_short_name",
                "direction_id": "direction_id",
                "block_id": "block_id",
                "shape_id": "shape_id",
                "wheelchair_accessible": "wheelchair_accessible",
                "bikes_allowed": "bikes_allowed",
                "route_pattern_id": None,
                "note_fr": None,
                "note_en": None,
            },
        ),
        (
            "gold.trip_service_span",
            None,
            {
                "trip_id": None,
                "route_id": None,
                "service_id": None,
                "first_seconds": None,
                "last_seconds": None,
            },
        ),
    ],
)
def test_gtfs_file_and_every_field_are_pinned(table, file_name, fields):
    entry = GTFS_FILES[table]
    assert entry.file_name == file_name
    assert dict(entry.fields) == {"dataset_version_id": None, "provider_id": None, **fields}
