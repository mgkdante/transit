"""Archive reader values shared by history consumers."""

from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal

from transit_ops.history.datasets import IndexFamily

NotAvailableReason = Literal["never_collected", "pruned_before_archive", "no_polls", "still_open"]


@dataclass(frozen=True)
class FeedDay:
    provider_id: str
    endpoint_key: str
    utc_date: date
    state: Literal["available", "not_available"]
    reason: NotAvailableReason | None
    form: Literal["objects", "archive_copy"] | None
    content_version: int | None
    poll_count: int | None
    capture_count: int | None
    first_time_utc: datetime | None
    last_time_utc: datetime | None
    declared_interval_seconds: int | None
    observed_interval_seconds: float | None
    poll_record_sha256: str | None
    pending_change: bool
    bytes_verified: bool

    def __post_init__(self) -> None:
        if (self.reason is not None) != (self.state == "not_available"):
            raise ValueError("reason must be set exactly when state is not_available")
        if (self.form is not None) != (self.state == "available"):
            raise ValueError("form must be set exactly when state is available")
        if (self.content_version is not None) != (self.form == "archive_copy"):
            raise ValueError("content_version must be set exactly when form is archive_copy")
        if self.bytes_verified and self.form != "archive_copy":
            raise ValueError("bytes_verified requires form archive_copy")
        if self.pending_change and self.form != "archive_copy":
            raise ValueError("pending_change requires form archive_copy")


@dataclass(frozen=True)
class Poll:
    provider_id: str
    endpoint_key: str
    run_kind: str
    index_family: IndexFamily
    ingestion_run_id: int
    status: Literal["stored", "failed", "skipped_identical", "unfinished", "capture_missing"]
    started_at_utc: datetime
    completed_at_utc: datetime | None
    time_utc: datetime
    http_status_code: int | None
    error_message: str | None
    feed_timestamp_utc: datetime | None
    feed_timestamp_source: Literal["header", "capture_time"] | None
    entity_count: int | None
    capture_row_id: int | None
    duplicate_of_row_id: int | None
    missing_reason: str | None


@dataclass(frozen=True)
class Capture:
    provider_id: str
    endpoint_key: str
    index_family: IndexFamily
    capture_row_id: int
    ingestion_run_id: int
    ingestion_object_id: int | None
    started_at_utc: datetime
    captured_at_utc: datetime
    feed_timestamp_utc: datetime | None
    feed_timestamp_source: Literal["header", "capture_time"] | None
    entity_count: int | None
    http_status_code: int | None
    byte_size: int
    checksum_sha256: str
    storage_path: str
    object_kind: str
    source_url: str | None
    payload: bytes | None


@dataclass(frozen=True)
class ProcessingRecord:
    provider_id: str
    endpoint_key: str
    stage: Literal["silver_load", "gold_facts"]
    index_family: IndexFamily
    capture_row_id: int | None
    attribution: Literal["recorded", "by_time"] | None
    status: Literal["failed", "observed", "none_observed", "not_observed"]
    started_at_utc: datetime | None
    completed_at_utc: datetime | None
    error_message: str | None
    rows: int | None


class WindowNotAvailable(Exception):
    def __init__(self, days: tuple[FeedDay, ...]) -> None:
        self.days = days
        super().__init__(
            "; ".join(f"{day.endpoint_key} {day.utc_date} {day.reason}" for day in days)
        )


class ArchiveNotVerified(RuntimeError):
    """A day's only archive copy has not been verified after a ledger rebuild."""
