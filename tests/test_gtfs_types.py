from __future__ import annotations

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import pytest

from transit_ops.gtfs.types import (
    ProviderBounds,
    parse_gtfs_binary,
    parse_gtfs_date,
    parse_gtfs_realtime_timestamp,
    parse_gtfs_service_time,
    provider_local_time_bucket,
    validate_wgs84_position,
)


def test_parse_gtfs_date_keeps_schedule_dates_as_service_dates() -> None:
    assert parse_gtfs_date("20260524", field_name="calendar_dates.date") == date(
        2026,
        5,
        24,
    )


def test_parse_gtfs_date_rejects_non_reference_shape() -> None:
    with pytest.raises(ValueError, match="YYYYMMDD"):
        parse_gtfs_date("2026-05-24", field_name="calendar_dates.date")


def test_parse_gtfs_service_time_allows_times_after_midnight() -> None:
    parsed = parse_gtfs_service_time("25:35:00", field_name="stop_times.arrival_time")

    assert parsed.total_seconds == 92_100
    assert parsed.day_offset == 1
    assert parsed.clock_time == "01:35:00"


def test_parse_gtfs_binary_accepts_only_zero_or_one() -> None:
    assert parse_gtfs_binary("1", field_name="calendar.monday") is True
    assert parse_gtfs_binary("0", field_name="calendar.sunday") is False

    with pytest.raises(ValueError, match="must be 0 or 1"):
        parse_gtfs_binary("2", field_name="calendar.monday")


def test_parse_gtfs_realtime_timestamp_is_utc_posix_seconds() -> None:
    assert parse_gtfs_realtime_timestamp(0, field_name="feed.header.timestamp") == datetime(
        1970,
        1,
        1,
        tzinfo=UTC,
    )


def test_provider_local_time_bucket_uses_provider_timezone() -> None:
    bucket = provider_local_time_bucket(
        datetime(2026, 5, 24, 3, 10, tzinfo=UTC),
        provider_timezone="America/Toronto",
        granularity_minutes=15,
    )

    assert bucket == datetime(2026, 5, 23, 23, 0, tzinfo=ZoneInfo("America/Toronto"))


def test_validate_wgs84_position_returns_provider_bbox_quality() -> None:
    bounds = ProviderBounds(
        min_latitude=45.25,
        max_latitude=45.75,
        min_longitude=-74.1,
        max_longitude=-73.2,
    )

    assert validate_wgs84_position(45.501, -73.567, bounds=bounds) == "valid_provider_bbox"
    assert validate_wgs84_position(43.653, -79.383, bounds=bounds) == "outside_provider_bbox"
    assert validate_wgs84_position(None, -73.567, bounds=bounds) == "missing_position"
    assert validate_wgs84_position(100.0, -73.567, bounds=bounds) == "invalid_wgs84"
