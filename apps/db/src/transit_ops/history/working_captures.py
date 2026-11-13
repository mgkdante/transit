"""Read the raw portion of one working feed-day inside the caller's transaction."""

from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import Connection, text

from transit_ops.history.datasets import CaptureSource, get_dataset
from transit_ops.history.manifest import Manifest
from transit_ops.history.poll_record import (
    CaptureEntry,
    FeedDay,
    PollEntry,
    PollRecord,
    PollRecordInvalid,
    observed_interval_ms,
    ordered_record,
)

CLOSED_UNFINISHED = "closed_unfinished"
_INDEX = {
    "realtime_snapshot": ("raw.realtime_snapshot_index", "realtime_snapshot_id"),
    "alert_snapshot": ("raw.i3_alert_snapshots", "i3_alert_snapshot_id"),
}
_PREDICATE = """
    r.provider_id = :provider_id AND r.feed_endpoint_id = :feed_endpoint_id
    AND r.run_kind <> 'silver_load'
    AND r.started_at_utc >= :day_start AND r.started_at_utc < :day_end
"""


def _poll(row: dict[str, Any], family: str) -> PollEntry:
    captured = row["capture_row_id"] is not None
    raw = row.pop("status")
    if captured and raw != "succeeded":
        raise PollRecordInvalid(f"run {row['ingestion_run_id']}: capture on {raw} run")
    missing = raw == "succeeded" and not captured
    status = (
        "stored"
        if captured
        else "capture_missing"
        if missing
        else "unfinished"
        if raw in ("pending", "running")
        or (raw == "failed" and row["error_message"] == CLOSED_UNFINISHED)
        else "failed"
    )
    captured_at = row.pop("captured_at_utc")
    stamp = row["feed_timestamp_utc"]
    return PollEntry(
        **row,
        status=status,
        run_status=raw,
        index_family=family,
        time_utc=captured_at or row["completed_at_utc"] or row["started_at_utc"],
        feed_timestamp_source=None
        if stamp is None
        else "capture_time"
        if stamp == row["completed_at_utc"]
        else "header",
        duplicate_of_row_id=None,
        missing_reason="capture_row_absent" if missing else None,
    )


def _captures(
    connection: Connection, family: str, params: dict[str, Any]
) -> tuple[CaptureEntry, ...]:
    table, key = _INDEX[family]
    alert = family == "alert_snapshot"
    stamp = "COALESCE(r.feed_timestamp_utc, i.captured_at_utc)" if alert else "i.feed_timestamp_utc"
    extras = "i.api_version, i.alert_count" if alert else "NULL AS api_version, NULL AS alert_count"
    fields = ("source_url", "storage_backend", "storage_path", "checksum_sha256", "byte_size")
    mismatch = " OR ".join(f"i.{field} IS DISTINCT FROM o.{field}" for field in fields)
    extras += (
        f", ({mismatch} OR i.http_status_code IS DISTINCT FROM r.http_status_code) AS mismatch"
        if alert
        else ", false AS mismatch"
    )
    rows = connection.execute(
        text(f"""
        SELECT i.{key} AS capture_row_id, i.ingestion_run_id, i.ingestion_object_id,
               o.byte_size, o.checksum_sha256 AS sha256, o.storage_backend, o.storage_path,
               o.object_kind, o.source_url, o.created_at_utc AS object_created_at_utc,
               r.started_at_utc, i.captured_at_utc, {stamp} AS feed_timestamp_utc,
               {"r" if alert else "i"}.entity_count, r.http_status_code, {extras}
        FROM {table} i JOIN raw.ingestion_runs r ON r.ingestion_run_id = i.ingestion_run_id
        LEFT JOIN raw.ingestion_objects o ON o.ingestion_object_id = i.ingestion_object_id
        WHERE {_PREDICATE}
    """),
        params,
    ).mappings()
    return tuple(_capture(dict(row), family) for row in rows)


def _capture(row: dict[str, Any], family: str) -> CaptureEntry:
    if row.pop("mismatch"):
        raise PollRecordInvalid(f"capture {row['capture_row_id']}: alert columns differ")
    return CaptureEntry(
        **row,
        index_family=family,
        packed=False,
        stream=None,
        offset=None,
        feed_timestamp_source="capture_time"
        if row["feed_timestamp_utc"] == row["captured_at_utc"]
        else "header",
    )


def _validated(record: PollRecord) -> PollRecord:
    # Validate entries separately so even a required null identifies its source row.
    entries: tuple[PollEntry | CaptureEntry, ...] = (*record.polls, *record.captures)
    for entry in entries:
        one = PollRecord(
            record.feed_day,
            (entry,) if isinstance(entry, PollEntry) else (),
            (entry,) if isinstance(entry, CaptureEntry) else (),
            (),
            None,
            None,
        )
        try:
            ordered_record(one)
        except (ValueError, TypeError) as exc:
            raise PollRecordInvalid(f"run {entry.ingestion_run_id}: {exc}") from exc
    return ordered_record(record)


def _feed_day(
    provider_id: str, endpoint_key: str, utc_date: date, current: Manifest | None
) -> FeedDay:
    source = get_dataset("capture." + endpoint_key).source
    if not isinstance(source, CaptureSource):
        raise ValueError("dataset is not a capture source")
    if type(utc_date) is not date:
        raise ValueError("utc_date must be a date")
    day = FeedDay(provider_id, endpoint_key, source.index_family, utc_date)
    if (
        current is not None
        and FeedDay(
            current.provider_id, current.endpoint_key, current.index_family, current.utc_date
        )
        != day
    ):
        raise ValueError("current manifest describes another feed-day")
    return day


def _feed(connection: Connection, params: dict[str, Any]) -> Any:
    feed = (
        connection.execute(
            text(
                "SELECT feed_endpoint_id, refresh_interval_seconds FROM core.feed_endpoints "
                "WHERE provider_id = :provider_id AND endpoint_key = :endpoint_key"
            ),
            params,
        )
        .mappings()
        .one_or_none()
    )
    if feed is None:
        raise LookupError(f"no feed endpoint: {params['provider_id']}/{params['endpoint_key']}")
    return feed


def read_working_day(
    connection: Connection,
    *,
    provider_id: str,
    endpoint_key: str,
    utc_date: date,
    current: Manifest | None = None,
) -> PollRecord:
    day = _feed_day(provider_id, endpoint_key, utc_date, current)
    params: dict[str, Any] = dict(provider_id=provider_id, endpoint_key=endpoint_key)
    feed = _feed(connection, params)
    start = datetime.combine(utc_date, time(), UTC)
    params.update(
        feed_endpoint_id=feed["feed_endpoint_id"],
        day_start=start,
        day_end=start + timedelta(days=1),
    )
    table, key = _INDEX[day.index_family]
    rows = connection.execute(
        text(f"""
        SELECT r.ingestion_run_id, r.run_kind, r.status, r.requested_at_utc, r.started_at_utc,
               r.completed_at_utc, r.http_status_code, r.error_message, r.feed_timestamp_utc,
               r.entity_count, i.{key} AS capture_row_id, i.captured_at_utc
        FROM raw.ingestion_runs r LEFT JOIN {table} i ON i.ingestion_run_id = r.ingestion_run_id
        WHERE {_PREDICATE}
    """),
        params,
    ).mappings()
    polls = tuple(_poll(dict(row), day.index_family) for row in rows)
    captures = _captures(connection, day.index_family, params)
    declared = current.declared_interval_seconds if current else feed["refresh_interval_seconds"]
    return _validated(
        PollRecord(
            day,
            polls,
            captures,
            (),
            declared,
            observed_interval_ms(p.started_at_utc for p in polls),
        )
    )
