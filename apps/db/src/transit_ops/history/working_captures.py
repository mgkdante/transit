"""Read the raw portion of one working feed-day inside the caller's transaction."""

import re
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import Connection, text

from transit_ops.history.datasets import CaptureSource, get_dataset
from transit_ops.history.manifest import Manifest
from transit_ops.history.poll_record import (
    CaptureEntry,
    FeedDayKey,
    PollEntry,
    PollRecord,
    PollRecordInvalid,
    ProcessingEntry,
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
) -> FeedDayKey:
    source = get_dataset("capture." + endpoint_key).source
    if not isinstance(source, CaptureSource):
        raise ValueError("dataset is not a capture source")
    if type(utc_date) is not date:
        raise ValueError("utc_date must be a date")
    day = FeedDayKey(provider_id, endpoint_key, source.index_family, utc_date)
    if (
        current is not None
        and FeedDayKey(
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


def _silver_loads(
    connection: Connection, family: str, params: dict[str, Any], interval: int | None
) -> tuple[ProcessingEntry, ...]:
    rows = connection.execute(
        text("""
        SELECT ingestion_run_id, status, started_at_utc, completed_at_utc, error_message
        FROM raw.ingestion_runs
        WHERE provider_id = :provider_id AND feed_endpoint_id = :feed_endpoint_id
          AND run_kind = 'silver_load'
          AND started_at_utc >= :day_start AND started_at_utc < :day_end
        """),
        params,
    ).mappings()
    table, key = _INDEX[family]
    entries = []
    for row in rows:
        if row["status"] != "failed":
            raise PollRecordInvalid(f"run {row['ingestion_run_id']}: nonfailed silver_load")
        capture = (
            connection.execute(
                text(f"""
            SELECT {key}, captured_at_utc FROM {table}
            WHERE feed_endpoint_id = :feed_endpoint_id AND captured_at_utc <= :load_started_at
            ORDER BY captured_at_utc DESC, {key} DESC LIMIT 1
            """),
                dict(params, load_started_at=row["started_at_utc"]),
            )
            .mappings()
            .one_or_none()
        )
        attributed = (
            capture is not None
            and interval is not None
            and row["started_at_utc"] - capture["captured_at_utc"] <= timedelta(seconds=interval)
        )
        entries.append(
            ProcessingEntry(
                "silver_load",
                family,
                capture[key] if attributed and capture is not None else None,
                "by_time" if attributed else None,
                rows=None,
                **row,
            )
        )
    return tuple(entries)


def _evidence_details(details: Any, family: str, event_id: int) -> tuple[datetime, dict[int, int]]:
    try:
        if not isinstance(details, dict) or set(details) != {
            "command",
            "completed_at_utc",
            "index_family",
            "rows_by_capture",
        }:
            raise ValueError("invalid keys")
        stamp, counts = details["completed_at_utc"], details["rows_by_capture"]
        if (
            not isinstance(details["command"], str)
            or details["index_family"] != family
            or not isinstance(stamp, str)
            or not re.fullmatch(
                r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z", stamp
            )
            or not isinstance(counts, dict)
        ):
            raise ValueError("invalid evidence fields")
        if any(
            not isinstance(key, str)
            or not re.fullmatch(r"[0-9]+", key)
            or int(key) <= 0
            or type(value) is not int
            or value < 0
            for key, value in counts.items()
        ):
            raise ValueError("invalid capture counts")
        return datetime.fromisoformat(stamp), {int(k): v for k, v in counts.items()}
    except (ValueError, TypeError, KeyError) as exc:
        raise PollRecordInvalid(f"event {event_id}: {exc}") from exc


def _recorded_evidence(connection: Connection, day: FeedDayKey) -> dict[int, ProcessingEntry]:
    events = connection.execute(
        text("""
        SELECT event_id, details FROM core.history_event
        WHERE kind = 'processing_evidence' AND dataset_id = :dataset_id
          AND provider_id = :provider_id AND revision = 0 AND window_key = :window_key
        ORDER BY event_id
        """),
        dict(
            dataset_id="capture." + day.endpoint_key,
            provider_id=day.provider_id,
            window_key=day.utc_date.isoformat(),
        ),
    ).mappings()
    result: dict[int, ProcessingEntry] = {}
    for event in events:
        completed, counts = _evidence_details(event["details"], day.index_family, event["event_id"])
        for capture_id, count in counts.items():
            previous = result.get(capture_id)
            # Events arrive in id order, so equal completion times prefer the later id.
            if previous and previous.completed_at_utc and previous.completed_at_utc > completed:
                continue
            result[capture_id] = ProcessingEntry(
                "gold_facts",
                day.index_family,
                capture_id,
                "recorded",
                "observed" if count else "none_observed",
                None,
                completed,
                None,
                count,
                None,
            )
    return result


def _fact_counts(
    connection: Connection, table: str, captures: tuple[CaptureEntry, ...]
) -> dict[int, int]:
    if not re.fullmatch(r"[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*", table):
        raise ValueError("invalid fact table")
    cutoff = connection.execute(text("SELECT now()")).scalar_one() - timedelta(days=13)
    young = [c.capture_row_id for c in captures if c.captured_at_utc > cutoff]
    if not young:
        return {}
    rows = connection.execute(
        text(f"""
        SELECT realtime_snapshot_id, count(*) AS rows FROM {table}
        WHERE realtime_snapshot_id = ANY(:capture_row_ids) GROUP BY realtime_snapshot_id
        """),
        dict(capture_row_ids=young),
    )
    return dict.fromkeys(young, 0) | {row[0]: row[1] for row in rows}


def _prefer_evidence(
    fresh: ProcessingEntry | None, old: ProcessingEntry | None
) -> ProcessingEntry | None:
    if (
        fresh
        and old
        and old.attribution == "recorded"
        and old.completed_at_utc
        and fresh.completed_at_utc
        and old.completed_at_utc >= fresh.completed_at_utc
    ):
        return old
    return fresh or old


def _gold_facts(
    connection: Connection,
    day: FeedDayKey,
    captures: tuple[CaptureEntry, ...],
    current: Manifest | None,
) -> tuple[ProcessingEntry, ...]:
    source = get_dataset("capture." + day.endpoint_key).source
    assert isinstance(source, CaptureSource)
    if source.fact_table is None:
        return ()
    evidence = _recorded_evidence(connection, day)
    carried = (
        {
            p.capture_row_id: p
            for p in current.processing
            if p.stage == "gold_facts" and p.index_family == day.index_family
        }
        if current
        else {}
    )
    chosen: dict[int, ProcessingEntry] = {}
    for capture in captures:
        selected = _prefer_evidence(
            evidence.get(capture.capture_row_id), carried.get(capture.capture_row_id)
        )
        if selected is not None:
            chosen[capture.capture_row_id] = selected
    counts = _fact_counts(
        connection, source.fact_table, tuple(c for c in captures if c.capture_row_id not in chosen)
    )
    return tuple(
        chosen[c.capture_row_id]
        if c.capture_row_id in chosen
        else _counted_outcome(day.index_family, c.capture_row_id, counts.get(c.capture_row_id))
        for c in captures
    )


def _counted_outcome(family: str, capture_id: int, rows: int | None) -> ProcessingEntry:
    status = "not_observed" if rows is None else "observed" if rows else "none_observed"
    return ProcessingEntry(
        "gold_facts", family, capture_id, None, status, None, None, None, rows, None
    )


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
            _silver_loads(connection, day.index_family, params, declared)
            + _gold_facts(connection, day, captures, current),
            declared,
            observed_interval_ms(p.started_at_utc for p in polls),
        )
    )
