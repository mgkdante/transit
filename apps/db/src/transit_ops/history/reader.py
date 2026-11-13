"""Archive reader values shared by history consumers."""

import hashlib
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import Connection, text

from transit_ops.history import ledger
from transit_ops.history.datasets import CaptureSource, IndexFamily, get_dataset, utc_day_closes_at
from transit_ops.history.manifest import read_copy_manifest
from transit_ops.history.poll_record import PollRecord, poll_record_sha256
from transit_ops.history.working_captures import _INDEX, read_working_day, rows_fingerprint
from transit_ops.ingestion.storage import BronzeStorageResolver

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


class CaptureWindow:
    def __init__(
        self,
        *,
        provider_id: str,
        feeds: tuple[str, ...],
        start_utc: datetime,
        end_utc: datetime,
        days: tuple[FeedDay, ...],
        connection: Connection,
        storage: BronzeStorageResolver,
        records: dict[tuple[str, date], PollRecord],
        copies: dict[tuple[str, date], ledger.ArchiveCopy] | None = None,
    ) -> None:
        self.provider_id = provider_id
        self.feeds = feeds
        self.start_utc = start_utc
        self.end_utc = end_utc
        self.days = days
        self.unreadable: list[Poll] = []
        self._connection = connection
        self._storage = storage
        self._records = records
        self._copies = copies if copies is not None else {}

    def require_available(self) -> None:
        missing = tuple(day for day in self.days if day.state == "not_available")
        if missing:
            raise WindowNotAvailable(missing)

    def polls(self) -> Iterator[Poll]:
        raise NotImplementedError("H06a4 implements polls")

    def captures(self, *, with_bytes: bool = True) -> Iterator[Capture]:
        raise NotImplementedError("H06a4 implements captures")

    def processing(self) -> Iterator[ProcessingRecord]:
        raise NotImplementedError("H06b implements processing")


def _unavailable(provider: str, feed: str, day: date, reason: NotAvailableReason) -> FeedDay:
    return FeedDay(
        provider,
        feed,
        day,
        "not_available",
        reason,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        False,
        False,
    )


def _object_day(record: PollRecord) -> FeedDay:
    key = record.feed_day
    return FeedDay(
        key.provider_id,
        key.endpoint_key,
        key.utc_date,
        "available",
        None,
        "objects",
        None,
        len(record.polls),
        len(record.captures),
        record.polls[0].time_utc if record.polls else None,
        record.polls[-1].time_utc if record.polls else None,
        record.declared_interval_seconds,
        record.observed_interval_ms / 1000 if record.observed_interval_ms is not None else None,
        poll_record_sha256(record),
        False,
        False,
    )


def _poll_days(connection: Connection, source: CaptureSource, params: dict[str, Any]) -> set[date]:
    table, _ = _INDEX[source.index_family]
    return set(
        connection.execute(
            text(f"""
        SELECT (r.started_at_utc AT TIME ZONE 'UTC')::date AS utc_date
        FROM raw.ingestion_runs r LEFT JOIN {table} i ON i.ingestion_run_id = r.ingestion_run_id
        WHERE r.provider_id = :provider_id AND r.feed_endpoint_id = :feed_endpoint_id
          AND r.run_kind <> 'silver_load' AND r.started_at_utc < :end_utc
        GROUP BY 1
        HAVING max(COALESCE(i.captured_at_utc, r.completed_at_utc, r.started_at_utc)) >= :start_utc
            OR (r.started_at_utc AT TIME ZONE 'UTC')::date >= :first_date
    """),
            params,
        ).scalars()
    )


def _archive_days(connection: Connection, params: dict[str, Any]) -> set[date]:
    return {
        date.fromisoformat(key)
        for key in connection.execute(
            text("""
            SELECT w.window_key FROM core.history_window w
            JOIN core.history_archive_copy c
              USING (dataset_id, provider_id, revision, window_key)
            WHERE w.dataset_id=:dataset_id AND w.provider_id=:provider_id AND w.revision=0
              AND c.content_version=w.current_version
              AND c.first_time_utc < :end_utc AND c.last_time_utc >= :start_utc
        """),
            params,
        ).scalars()
    }


def _copy_details(copy: ledger.ArchiveCopy) -> tuple[int | None, float | None]:
    for key in ("rows_fingerprint", "declared_interval_seconds", "observed_interval_ms"):
        if key not in copy.details:
            raise ValueError(f"{copy.dataset_id} {copy.window_key}: missing {key}")
    declared = copy.details["declared_interval_seconds"]
    observed = copy.details["observed_interval_ms"]
    if declared is not None and not isinstance(declared, int):
        raise ValueError("invalid declared_interval_seconds")
    if observed is not None and not isinstance(observed, (int, float)):
        raise ValueError("invalid observed_interval_ms")
    return declared, observed / 1000 if observed is not None else None


def _archive_plan(
    connection: Connection,
    provider: str,
    feed: str,
    day: date,
    window: dict[str, Any],
) -> tuple[FeedDay, ledger.ArchiveCopy] | None:
    state = window.get("working_state")
    copy = _current_copy(connection, provider, feed, day, window)
    if state in ("partial", "trimmed") and copy is None:
        raise ArchiveNotVerified(f"{provider}/{feed} {day}: no verified current archive copy")
    if copy is None:
        return None
    declared, observed = _copy_details(copy)
    fingerprint = rows_fingerprint(
        connection, provider_id=provider, endpoint_key=feed, utc_date=day
    )
    pending = False
    if state in ("partial", "trimmed"):
        status = ledger.window_state(
            connection,
            dataset_id="capture." + feed,
            provider_id=provider,
            window_key=day.isoformat(),
        )
        assert status is not None
        remainder = status.remainder_fingerprint
        if remainder is None and state == "trimmed":
            remainder = hashlib.sha256(b"").hexdigest()
        pending = fingerprint != remainder
    elif state == "present" or state is None:
        if (
            fingerprint != copy.details["rows_fingerprint"]
            or copy.verified_at_utc is None
            or window["working_changed_at_utc"] > copy.verified_at_utc
        ):
            return None
    else:
        return None
    return _archive_day(provider, feed, day, copy, pending, declared, observed), copy


def _current_copy(
    connection: Connection,
    provider: str,
    feed: str,
    day: date,
    window: dict[str, Any],
) -> ledger.ArchiveCopy | None:
    if window.get("current_version") is None:
        return None
    copies = ledger.find_copies(
        connection,
        dataset_id="capture." + feed,
        provider_id=provider,
        start=day,
        end=day,
    )
    return next((copy for copy in copies if copy.is_current), None)


def _archive_day(
    provider: str,
    feed: str,
    day: date,
    copy: ledger.ArchiveCopy,
    pending: bool,
    declared: int | None,
    observed: float | None,
) -> FeedDay:
    return FeedDay(
        provider,
        feed,
        day,
        "available",
        None,
        "archive_copy",
        copy.content_version,
        copy.poll_count,
        copy.record_count,
        copy.first_time_utc,
        copy.last_time_utc,
        declared,
        observed,
        copy.poll_record_sha256,
        pending,
        True,
    )


def _working_record(
    connection: Connection,
    storage: BronzeStorageResolver,
    provider: str,
    feed: str,
    day: date,
    version: int | None,
) -> PollRecord:
    current = None
    if version is not None:
        copies = ledger.find_copies(
            connection,
            dataset_id="capture." + feed,
            provider_id=provider,
            start=day,
            end=day,
        )
        copy = next(copy for copy in copies if copy.content_version == version)
        current = read_copy_manifest(storage, copy)
    return read_working_day(
        connection,
        provider_id=provider,
        endpoint_key=feed,
        utc_date=day,
        current=current,
    )


def _plan_day(
    connection: Connection,
    storage: BronzeStorageResolver,
    provider: str,
    feed: str,
    day: date,
    now: datetime,
    created: date,
    has_polls: bool,
    window: dict[str, Any],
    records: dict[tuple[str, date], PollRecord],
    copies: dict[tuple[str, date], ledger.ArchiveCopy],
) -> FeedDay:
    if now < utc_day_closes_at(day):
        return _unavailable(provider, feed, day, "still_open")
    state, version = window.get("working_state"), window.get("current_version")
    archive = _archive_plan(connection, provider, feed, day, window)
    if archive is not None:
        result, copy = archive
        copies[feed, day] = copy
        return result
    if has_polls:
        record = _working_record(connection, storage, provider, feed, day, version)
        records[feed, day] = record
        return _object_day(record)
    if state == "empty":
        return _unavailable(provider, feed, day, "no_polls")
    reason: NotAvailableReason = "never_collected" if day < created else "pruned_before_archive"
    return _unavailable(provider, feed, day, reason)


def _endpoint(connection: Connection, params: dict[str, Any]) -> dict[str, Any] | None:
    row = (
        connection.execute(
            text(
                "SELECT feed_endpoint_id, created_at_utc FROM core.feed_endpoints "
                "WHERE provider_id=:provider_id AND endpoint_key=:endpoint_key"
            ),
            params,
        )
        .mappings()
        .one_or_none()
    )
    return dict(row) if row is not None else None


def _windows(connection: Connection, params: dict[str, Any]) -> dict[str, dict[str, Any]]:
    rows = connection.execute(
        text(
            "SELECT window_key, working_state, current_version, working_changed_at_utc "
            "FROM core.history_window "
            "WHERE dataset_id=:dataset_id AND provider_id=:provider_id AND revision=0 "
            "AND window_key=ANY(:keys)"
        ),
        params,
    ).mappings()
    return {row["window_key"]: dict(row) for row in rows}


def _locked_windows(
    connection: Connection,
    params: dict[str, Any],
    candidates: set[date],
) -> dict[str, dict[str, Any]]:
    for day in sorted(candidates):
        ledger.acquire_window_lock(
            connection,
            dataset_id=params["dataset_id"],
            provider_id=params["provider_id"],
            window_key=day.isoformat(),
        )
    params.update(keys=[d.isoformat() for d in candidates])
    return _windows(connection, params)


def _feed_plan(
    connection: Connection,
    storage: BronzeStorageResolver,
    provider: str,
    feed: str,
    start: datetime,
    end: datetime,
    now: datetime,
    dates: set[date],
    records: dict[tuple[str, date], PollRecord],
    copies: dict[tuple[str, date], ledger.ArchiveCopy],
) -> list[FeedDay]:
    source = get_dataset("capture." + feed).source
    assert isinstance(source, CaptureSource)
    params: dict[str, Any] = dict(provider_id=provider, endpoint_key=feed)
    endpoint = _endpoint(connection, params)
    if endpoint is None:
        return [_unavailable(provider, feed, day, "never_collected") for day in dates]
    params.update(
        feed_endpoint_id=endpoint["feed_endpoint_id"],
        start_utc=start,
        end_utc=end,
        first_date=start.date(),
    )
    poll_days = _poll_days(connection, source, params)
    params.update(dataset_id="capture." + feed)
    candidates = dates | poll_days | _archive_days(connection, params)
    by_key = _locked_windows(connection, params, candidates)
    created = endpoint["created_at_utc"].astimezone(UTC).date()
    return [
        _plan_day(
            connection,
            storage,
            provider,
            feed,
            day,
            now,
            created,
            day in poll_days,
            by_key.get(day.isoformat(), {}),
            records,
            copies,
        )
        for day in sorted(candidates)
    ]


def open_window(
    provider: str,
    feeds: Sequence[str],
    start_utc: datetime,
    end_utc: datetime,
    *,
    connection: Connection,
    storage: BronzeStorageResolver,
) -> CaptureWindow:
    feeds = tuple(feeds)
    if not provider or not feeds or len(feeds) != len(set(feeds)):
        raise ValueError("provider and distinct feeds are required")
    if start_utc.utcoffset() is None or end_utc.utcoffset() is None:
        raise ValueError("window times must be timezone-aware")
    if start_utc >= end_utc:
        raise ValueError("start_utc must be before end_utc")
    for feed in feeds:
        get_dataset("capture." + feed)
    start_utc, end_utc = start_utc.astimezone(UTC), end_utc.astimezone(UTC)
    now = connection.execute(text("SELECT now()")).scalar_one()
    first, last = start_utc.date(), (end_utc - timedelta(microseconds=1)).date()
    dates = {first + timedelta(days=n) for n in range((last - first).days + 1)}
    records: dict[tuple[str, date], PollRecord] = {}
    copies: dict[tuple[str, date], ledger.ArchiveCopy] = {}
    days = [
        day
        for feed in feeds
        for day in _feed_plan(
            connection, storage, provider, feed, start_utc, end_utc, now, dates, records, copies
        )
    ]
    return CaptureWindow(
        provider_id=provider,
        feeds=feeds,
        start_utc=start_utc,
        end_utc=end_utc,
        days=tuple(sorted(days, key=lambda d: (d.utc_date, d.endpoint_key))),
        connection=connection,
        storage=storage,
        records=records,
        copies=copies,
    )
