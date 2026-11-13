"""Real reader values with explicit defaults for offline consumer tests."""

import hashlib
from collections.abc import Iterator, Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal

from sqlalchemy import Connection

from transit_ops.history.datasets import IndexFamily
from transit_ops.history.reader import (
    Capture,
    FeedDay,
    NotAvailableReason,
    Poll,
    ProcessingRecord,
    WindowNotAvailable,
)
from transit_ops.ingestion.storage import BronzeStorageResolver

_START = datetime(2026, 1, 2, tzinfo=UTC)
_END = datetime(2026, 1, 2, 0, 0, 4, tzinfo=UTC)


class FakeCaptureWindow:
    def __init__(
        self,
        days,
        polls,
        captures,
        processing,
        unreadable=(),
        *,
        provider_id=None,
        feeds=None,
        start_utc=None,
        end_utc=None,
    ) -> None:
        self.days = tuple(days)
        self.unreadable = list(unreadable)
        self.provider_id = (
            provider_id
            if provider_id is not None
            else (self.days[0].provider_id if self.days else "fake_provider")
        )
        self.feeds = (
            tuple(feeds)
            if feeds is not None
            else tuple(sorted({day.endpoint_key for day in self.days}))
        )
        dates = [day.utc_date for day in self.days] or [_START.date()]
        self.start_utc = (
            start_utc if start_utc is not None else datetime.combine(min(dates), time(), UTC)
        )
        self.end_utc = (
            end_utc
            if end_utc is not None
            else datetime.combine(max(dates) + timedelta(days=1), time(), UTC)
        )
        self._polls, self._captures, self._processing = (
            tuple(polls),
            tuple(captures),
            tuple(processing),
        )

    def require_available(self) -> None:
        missing = tuple(day for day in self.days if day.state == "not_available")
        if missing:
            raise WindowNotAvailable(missing)

    def polls(self) -> Iterator[Poll]:
        yield from self._polls

    def captures(self, *, with_bytes: bool = True) -> Iterator[Capture]:
        for capture in self._captures:
            yield capture if with_bytes else replace(capture, payload=None)

    def processing(self) -> Iterator[ProcessingRecord]:
        yield from self._processing


def fake_open_window(windows):
    windows = iter(windows)
    calls = []

    def open_window(
        provider: str,
        feeds: Sequence[str],
        start_utc: datetime,
        end_utc: datetime,
        *,
        connection: Connection,
        storage: BronzeStorageResolver,
    ) -> FakeCaptureWindow:
        calls.append((provider, tuple(feeds), start_utc, end_utc))
        try:
            return next(windows)
        except StopIteration:
            raise AssertionError("no fake windows remain") from None

    open_window.calls = calls
    return open_window


class _Unset:
    pass


_UNSET = _Unset()


def fake_feed_day(
    *,
    provider_id: str = "fake_provider",
    endpoint_key: str = "trip_updates",
    utc_date: date = date(2026, 1, 2),
    state: Literal["available", "not_available"] = "available",
    reason: NotAvailableReason | None | _Unset = _UNSET,
    form: Literal["objects", "archive_copy"] | None | _Unset = _UNSET,
    content_version: int | None | _Unset = _UNSET,
    poll_count: int | None = 0,
    capture_count: int | None = 0,
    first_time_utc: datetime | None = None,
    last_time_utc: datetime | None = None,
    declared_interval_seconds: int | None = None,
    observed_interval_seconds: float | None = None,
    poll_record_sha256: str | None | _Unset = _UNSET,
    pending_change: bool = False,
    bytes_verified: bool | _Unset = _UNSET,
) -> FeedDay:
    if isinstance(reason, _Unset):
        reason = "no_polls" if state == "not_available" else None
    if isinstance(form, _Unset):
        form = None if state == "not_available" else "objects"
    if isinstance(content_version, _Unset):
        content_version = 1 if form == "archive_copy" else None
    if isinstance(bytes_verified, _Unset):
        bytes_verified = form == "archive_copy"
    if isinstance(poll_record_sha256, _Unset):
        poll_record_sha256 = None if state == "not_available" else "0" * 64
    return FeedDay(
        provider_id=provider_id,
        endpoint_key=endpoint_key,
        utc_date=utc_date,
        state=state,
        reason=reason,
        form=form,
        content_version=content_version,
        poll_count=poll_count,
        capture_count=capture_count,
        first_time_utc=first_time_utc,
        last_time_utc=last_time_utc,
        declared_interval_seconds=declared_interval_seconds,
        observed_interval_seconds=observed_interval_seconds,
        poll_record_sha256=poll_record_sha256,
        pending_change=pending_change,
        bytes_verified=bytes_verified,
    )


def fake_poll(
    *,
    provider_id: str = "fake_provider",
    endpoint_key: str = "trip_updates",
    run_kind: str = "trip_updates",
    index_family: IndexFamily = "realtime_snapshot",
    ingestion_run_id: int = 1,
    status: Literal[
        "stored", "failed", "skipped_identical", "unfinished", "capture_missing"
    ] = "stored",
    started_at_utc: datetime = _START,
    completed_at_utc: datetime | None = _END,
    time_utc: datetime = _END,
    http_status_code: int | None = 200,
    error_message: str | None = None,
    feed_timestamp_utc: datetime | None = _END,
    feed_timestamp_source: Literal["header", "capture_time"] | None = "capture_time",
    entity_count: int | None = 1,
    capture_row_id: int | None = 1,
    duplicate_of_row_id: int | None = None,
    missing_reason: str | None = None,
) -> Poll:
    return Poll(
        provider_id=provider_id,
        endpoint_key=endpoint_key,
        run_kind=run_kind,
        index_family=index_family,
        ingestion_run_id=ingestion_run_id,
        status=status,
        started_at_utc=started_at_utc,
        completed_at_utc=completed_at_utc,
        time_utc=time_utc,
        http_status_code=http_status_code,
        error_message=error_message,
        feed_timestamp_utc=feed_timestamp_utc,
        feed_timestamp_source=feed_timestamp_source,
        entity_count=entity_count,
        capture_row_id=capture_row_id,
        duplicate_of_row_id=duplicate_of_row_id,
        missing_reason=missing_reason,
    )


def fake_capture(
    *,
    provider_id: str = "fake_provider",
    endpoint_key: str = "trip_updates",
    index_family: IndexFamily = "realtime_snapshot",
    capture_row_id: int = 1,
    ingestion_run_id: int = 1,
    ingestion_object_id: int | None = 1,
    started_at_utc: datetime = _START,
    captured_at_utc: datetime = _END,
    feed_timestamp_utc: datetime | None = _END,
    feed_timestamp_source: Literal["header", "capture_time"] | None = "capture_time",
    entity_count: int | None = 1,
    http_status_code: int | None = 200,
    byte_size: int = len(b"payload"),
    checksum_sha256: str = hashlib.sha256(b"payload").hexdigest(),
    storage_path: str = "capture/1",
    object_kind: str = "gtfs_rt_feed",
    source_url: str | None = None,
    payload: bytes | None = b"payload",
) -> Capture:
    return Capture(
        provider_id=provider_id,
        endpoint_key=endpoint_key,
        index_family=index_family,
        capture_row_id=capture_row_id,
        ingestion_run_id=ingestion_run_id,
        ingestion_object_id=ingestion_object_id,
        started_at_utc=started_at_utc,
        captured_at_utc=captured_at_utc,
        feed_timestamp_utc=feed_timestamp_utc,
        feed_timestamp_source=feed_timestamp_source,
        entity_count=entity_count,
        http_status_code=http_status_code,
        byte_size=byte_size,
        checksum_sha256=checksum_sha256,
        storage_path=storage_path,
        object_kind=object_kind,
        source_url=source_url,
        payload=payload,
    )


def fake_processing(
    *,
    provider_id: str = "fake_provider",
    endpoint_key: str = "trip_updates",
    stage: Literal["silver_load", "gold_facts"] = "gold_facts",
    index_family: IndexFamily = "realtime_snapshot",
    capture_row_id: int | None = 1,
    attribution: Literal["recorded", "by_time"] | None = None,
    status: Literal["failed", "observed", "none_observed", "not_observed"] = "observed",
    started_at_utc: datetime | None = None,
    completed_at_utc: datetime | None = None,
    error_message: str | None = None,
    rows: int | None = 1,
) -> ProcessingRecord:
    return ProcessingRecord(
        provider_id=provider_id,
        endpoint_key=endpoint_key,
        stage=stage,
        index_family=index_family,
        capture_row_id=capture_row_id,
        attribution=attribution,
        status=status,
        started_at_utc=started_at_utc,
        completed_at_utc=completed_at_utc,
        error_message=error_message,
        rows=rows,
    )
