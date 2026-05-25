from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class GtfsServiceTime:
    total_seconds: int
    day_offset: int

    @property
    def clock_time(self) -> str:
        seconds = self.total_seconds % 86_400
        hours, remainder = divmod(seconds, 3_600)
        minutes, secs = divmod(remainder, 60)
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"


@dataclass(frozen=True)
class ProviderBounds:
    min_latitude: float
    max_latitude: float
    min_longitude: float
    max_longitude: float


def parse_gtfs_date(value: str, *, field_name: str) -> date:
    normalized = value.strip()
    try:
        return datetime.strptime(normalized, "%Y%m%d").date()
    except ValueError as exc:
        raise ValueError(f"{field_name} must be in YYYYMMDD format.") from exc


def parse_gtfs_binary(value: str, *, field_name: str) -> bool:
    normalized = value.strip()
    if normalized not in {"0", "1"}:
        raise ValueError(f"{field_name} must be 0 or 1.")
    return normalized == "1"


def parse_gtfs_service_time(value: str, *, field_name: str) -> GtfsServiceTime:
    normalized = value.strip()
    parts = normalized.split(":")
    if len(parts) != 3:
        raise ValueError(f"{field_name} must be in HH:MM:SS format.")

    try:
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = int(parts[2])
    except ValueError as exc:
        raise ValueError(f"{field_name} must contain numeric HH:MM:SS components.") from exc

    if hours < 0 or minutes not in range(60) or seconds not in range(60):
        raise ValueError(f"{field_name} has an invalid HH:MM:SS value.")

    total_seconds = hours * 3_600 + minutes * 60 + seconds
    return GtfsServiceTime(
        total_seconds=total_seconds,
        day_offset=total_seconds // 86_400,
    )


def parse_gtfs_realtime_timestamp(value: int | str, *, field_name: str) -> datetime:
    try:
        return datetime.fromtimestamp(int(value), tz=UTC)
    except (OverflowError, OSError, ValueError) as exc:
        raise ValueError(f"{field_name} must be POSIX seconds in UTC.") from exc


def provider_local_time_bucket(
    value: datetime,
    *,
    provider_timezone: str,
    granularity_minutes: int,
) -> datetime:
    if granularity_minutes <= 0:
        raise ValueError("granularity_minutes must be positive.")

    localized = value.astimezone(ZoneInfo(provider_timezone))
    bucket_seconds = granularity_minutes * 60
    seconds_since_midnight = (
        localized.hour * 3_600
        + localized.minute * 60
        + localized.second
    )
    floored_seconds = seconds_since_midnight - (seconds_since_midnight % bucket_seconds)
    midnight = localized.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight + timedelta(seconds=floored_seconds)


def validate_wgs84_position(
    latitude: float | None,
    longitude: float | None,
    *,
    bounds: ProviderBounds | None = None,
) -> str:
    if latitude is None or longitude is None:
        return "missing_position"
    if not (-90.0 <= latitude <= 90.0 and -180.0 <= longitude <= 180.0):
        return "invalid_wgs84"
    if bounds is None:
        return "valid_wgs84"
    if (
        bounds.min_latitude <= latitude <= bounds.max_latitude
        and bounds.min_longitude <= longitude <= bounds.max_longitude
    ):
        return "valid_provider_bbox"
    return "outside_provider_bbox"
