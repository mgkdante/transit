"""Pure feed-day records and their canonical fingerprints."""

import hashlib
import json
import re
from collections.abc import Iterable
from dataclasses import asdict, dataclass, replace
from datetime import UTC, date, datetime, timedelta
from typing import Any, get_args, get_origin, get_type_hints


@dataclass(frozen=True)
class FeedDay:
    provider_id: str
    endpoint_key: str
    index_family: str
    utc_date: date


@dataclass(frozen=True)
class PollEntry:
    ingestion_run_id: int
    run_kind: str
    status: str
    run_status: str | None
    requested_at_utc: datetime | None
    started_at_utc: datetime
    completed_at_utc: datetime | None
    time_utc: datetime
    http_status_code: int | None
    error_message: str | None
    feed_timestamp_utc: datetime | None
    feed_timestamp_source: str | None
    entity_count: int | None
    index_family: str
    capture_row_id: int | None
    duplicate_of_row_id: int | None
    missing_reason: str | None


@dataclass(frozen=True)
class CaptureEntry:
    index_family: str
    capture_row_id: int
    ingestion_run_id: int
    ingestion_object_id: int
    packed: bool
    stream: int | None
    offset: int | None
    byte_size: int
    sha256: str
    storage_backend: str
    storage_path: str
    object_kind: str
    source_url: str | None
    object_created_at_utc: datetime
    started_at_utc: datetime
    captured_at_utc: datetime
    feed_timestamp_utc: datetime
    feed_timestamp_source: str
    entity_count: int | None
    http_status_code: int | None
    api_version: str | None
    alert_count: int | None


@dataclass(frozen=True)
class ProcessingEntry:
    stage: str
    index_family: str
    capture_row_id: int | None
    attribution: str | None
    status: str
    started_at_utc: datetime | None
    completed_at_utc: datetime | None
    error_message: str | None
    rows: int | None
    ingestion_run_id: int | None


@dataclass(frozen=True)
class PollRecord:
    feed_day: FeedDay
    polls: tuple[PollEntry, ...]
    captures: tuple[CaptureEntry, ...]
    processing: tuple[ProcessingEntry, ...]
    declared_interval_seconds: int | None
    observed_interval_ms: int | None


class PollRecordInvalid(ValueError):
    pass


def _json_value(value: object) -> object:
    if isinstance(value, datetime):
        if value.utcoffset() is None:
            raise TypeError("naive datetime")
        return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, dict) and all(isinstance(k, str) for k in value):
        return {k: _json_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(v) for v in value]
    if value is None or type(value) in (str, int, bool):
        return value
    raise TypeError("unsupported canonical JSON value")


def canonical_json(value: object) -> bytes:
    return json.dumps(
        _json_value(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def observed_interval_ms(poll_starts: Iterable[datetime]) -> int | None:
    starts = list(poll_starts)
    canonical_json(starts)
    starts = sorted(at.astimezone(UTC) for at in starts)
    gaps = sorted(
        (b - a) // timedelta(milliseconds=1) for a, b in zip(starts, starts[1:], strict=False)
    )
    return gaps[(len(gaps) - 1) // 2] if gaps else None


def ordered_record(record: PollRecord) -> PollRecord:
    validate_record(record)
    if len({p.ingestion_run_id for p in record.polls}) != len(record.polls):
        raise PollRecordInvalid("duplicate poll")
    if len({(c.index_family, c.capture_row_id) for c in record.captures}) != len(record.captures):
        raise PollRecordInvalid("duplicate capture")
    floor = datetime.min.replace(tzinfo=UTC)
    return replace(
        record,
        polls=tuple(
            sorted(record.polls, key=lambda p: (p.time_utc.astimezone(UTC), p.ingestion_run_id))
        ),
        captures=tuple(
            sorted(
                record.captures, key=lambda c: (c.captured_at_utc.astimezone(UTC), c.capture_row_id)
            )
        ),
        processing=tuple(
            sorted(
                record.processing,
                key=lambda p: (
                    p.stage,
                    p.started_at_utc is not None,
                    (p.started_at_utc.astimezone(UTC) if p.started_at_utc else floor),
                    (p.capture_row_id is not None, p.capture_row_id),
                    (p.ingestion_run_id is not None, p.ingestion_run_id),
                ),
            )
        ),
    )


def poll_record_sha256(record: PollRecord) -> str:
    value = asdict(ordered_record(record))
    for capture in value["captures"]:
        for field in ("packed", "stream", "offset"):
            del capture[field]
        if capture["index_family"] != "alert_snapshot":
            del capture["api_version"], capture["alert_count"]
    return hashlib.sha256(canonical_json(value)).hexdigest()


def validate_record(record: PollRecord) -> None:
    families = ("realtime_snapshot", "alert_snapshot")
    if record.feed_day.index_family not in families:
        raise PollRecordInvalid("invalid feed family")
    entries: tuple[PollEntry | CaptureEntry | ProcessingEntry, ...] = (
        *record.polls,
        *record.captures,
        *record.processing,
    )
    for entry in entries:
        if entry.index_family not in families:
            raise PollRecordInvalid("invalid entry family")
        if isinstance(entry, ProcessingEntry):
            valid = (
                entry.stage in ("silver_load", "gold_facts")
                and entry.status in ("failed", "observed", "none_observed", "not_observed")
                and entry.attribution in (None, "by_time", "recorded")
            )
        else:
            valid = entry.feed_timestamp_source in ("header", "capture_time", None)
            if isinstance(entry, PollEntry):
                valid &= entry.status in (
                    "stored",
                    "failed",
                    "unfinished",
                    "capture_missing",
                    "skipped_identical",
                )
            else:
                valid &= entry.feed_timestamp_source is not None and bool(
                    re.fullmatch("[0-9a-f]{64}", entry.sha256)
                )
                valid &= entry.index_family == "alert_snapshot" or (
                    entry.api_version is None and entry.alert_count is None
                )
        if not valid:
            raise PollRecordInvalid("invalid entry value")
    try:
        typed_value(PollRecord, asdict(record))
    except (TypeError, ValueError) as exc:
        raise PollRecordInvalid(str(exc)) from exc


def typed_value(kind: Any, value: Any) -> Any:
    origin, args = get_origin(kind), get_args(kind)
    if args and origin not in (tuple, dict):
        for option in args:
            try:
                return typed_value(option, value)
            except (TypeError, ValueError):
                pass
        raise PollRecordInvalid("invalid optional value")
    if kind in (datetime, date):
        result = value if type(value) is kind else kind.fromisoformat(value)
        canonical_json(result)
        return result
    if origin is tuple and isinstance(value, (list, tuple)):
        return tuple(typed_value(args[0], v) for v in value)
    if origin is dict and isinstance(value, dict):
        return {typed_value(args[0], k): typed_value(args[1], v) for k, v in value.items()}
    if isinstance(kind, type) and hasattr(kind, "__dataclass_fields__") and isinstance(value, dict):
        hints = get_type_hints(kind)
        if hints.keys() == value.keys():
            return kind(**{k: typed_value(t, value[k]) for k, t in hints.items()})
    elif type(value) is kind:
        return value
    raise PollRecordInvalid("invalid field type or keys")
