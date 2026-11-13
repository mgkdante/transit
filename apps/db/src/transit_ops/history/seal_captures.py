"""Build and verify a local pack from a working poll record."""

import hashlib
from collections.abc import Iterator
from dataclasses import dataclass, replace
from pathlib import Path

from transit_ops.history.pack import PackResult, read_pack, write_pack
from transit_ops.history.poll_record import (
    CaptureEntry,
    PollRecord,
    PollRecordInvalid,
    ordered_record,
)
from transit_ops.ingestion.storage import BronzeStorage, BronzeStorageResolver

OBJECT_ABSENT = "object_absent"
OBJECT_MISMATCH = "object_mismatch"


@dataclass(frozen=True)
class LocalPack:
    record: PollRecord
    pack: PackResult | None
    path: Path | None


def _read_capture(capture: CaptureEntry, store: BronzeStorage) -> bytes | None:
    try:
        with store.open_stream(capture.storage_path) as source:
            payload = bytearray()
            while chunk := source.read(64 * 1024):
                payload.extend(chunk)
    except Exception:
        if not store.exists(capture.storage_path):
            return None
        raise
    return bytes(payload)


def _checked_captures(
    record: PollRecord,
    storage: BronzeStorageResolver,
    missing: dict[tuple[str, int], str],
) -> Iterator[bytes]:
    for capture in record.captures:
        payload = _read_capture(capture, storage(capture.storage_backend))
        reason = None
        if payload is None:
            reason = OBJECT_ABSENT
        elif (
            len(payload) != capture.byte_size
            or hashlib.sha256(payload).hexdigest() != capture.sha256
        ):
            reason = OBJECT_MISMATCH
        if reason is not None:
            missing[capture.index_family, capture.capture_row_id] = reason
        else:
            assert payload is not None
            yield payload
        del payload


def _packed_record(
    record: PollRecord, pack: PackResult | None, missing: dict[tuple[str, int], str]
) -> PollRecord:
    entries = iter(pack.captures if pack else ())
    captures = []
    for capture in record.captures:
        if (capture.index_family, capture.capture_row_id) not in missing:
            entry = next(entries)
            if (entry.byte_size, entry.sha256) != (capture.byte_size, capture.sha256):
                raise RuntimeError("packed capture differs from its row")
            capture = replace(capture, packed=True, stream=entry.stream, offset=entry.offset)
        captures.append(capture)
    polls = list(record.polls)
    for key, reason in missing.items():
        matches = [
            i
            for i, poll in enumerate(polls)
            if (poll.index_family, poll.capture_row_id) == key and poll.status == "stored"
        ]
        if len(matches) != 1:
            raise PollRecordInvalid(f"capture {key} needs exactly one stored poll")
        i = matches[0]
        polls[i] = replace(polls[i], status="capture_missing", missing_reason=reason)
    return ordered_record(replace(record, captures=tuple(captures), polls=tuple(polls)))


def pack_working_day(
    record: PollRecord, storage: BronzeStorageResolver, *, directory: Path
) -> LocalPack:
    record = ordered_record(record)
    if any(c.packed or c.stream is not None or c.offset is not None for c in record.captures):
        raise ValueError("expected a working poll record without packed captures")
    path = directory / f"{record.feed_day.utc_date.isoformat()}.pack.xz"
    out = path.open("xb")
    try:
        missing: dict[tuple[str, int], str] = {}
        with out:
            pack = write_pack(_checked_captures(record, storage, missing), out)
        if pack is None:
            path.unlink()
        else:
            with path.open("rb") as source:
                for _ in read_pack(source, pack.streams, pack.captures):
                    pass
        return LocalPack(_packed_record(record, pack, missing), pack, path if pack else None)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
