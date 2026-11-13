"""Check archive copies against storage and against their working day."""

import hashlib
from dataclasses import asdict, replace
from datetime import UTC, datetime

from transit_ops.history.ledger import ArchiveCopy
from transit_ops.history.manifest import Manifest, ManifestInvalid, read_copy_manifest
from transit_ops.history.pack import BinaryReader, PackCorrupt, PackedCapture, read_pack
from transit_ops.history.poll_record import (
    CaptureEntry,
    FeedDayKey,
    PollEntry,
    PollRecord,
    ProcessingEntry,
    canonical_json,
    poll_record_sha256,
)
from transit_ops.history.seal_captures import OBJECT_ABSENT, OBJECT_MISMATCH
from transit_ops.ingestion.storage import BronzeStorage, BronzeStorageResolver


class CopyCorrupt(ValueError):
    """A copy's objects disagree with its row, with its manifest or with themselves."""


def _corrupt(copy: ArchiveCopy, reason: str) -> CopyCorrupt:
    return CopyCorrupt(
        f"{copy.dataset_id}/{copy.provider_id}/{copy.window_key}/v{copy.content_version}: {reason}"
    )


class _DigestReader:
    def __init__(self, source: BinaryReader) -> None:
        self.source, self.size, self.digest = source, 0, hashlib.sha256()

    def read(self, size: int = -1) -> bytes:
        data = self.source.read(size)
        self.size += len(data)
        self.digest.update(data)
        return data


def _instant(value: datetime | None) -> datetime | None:
    if value is not None and value.utcoffset() is None:
        raise ValueError("naive datetime")
    return value.astimezone(UTC) if value is not None else None


def _check_row(copy: ArchiveCopy, manifest: Manifest) -> None:
    pairs = [
        (name, getattr(manifest, name), getattr(copy, name))
        for name in ("content_sha256", "poll_record_sha256", "poll_count", "source_bytes")
    ]
    pairs.insert(2, ("record_count", manifest.capture_count, copy.record_count))
    for name in ("first_time_utc", "last_time_utc"):
        actual: object
        try:
            actual = _instant(getattr(copy, name))
        except ValueError:
            actual = "naive datetime"
        pairs.append((name, _instant(getattr(manifest, name)), actual))
    pack = manifest.pack
    pairs.extend(
        [
            ("storage_path", pack.path if pack else None, copy.storage_path),
            ("byte_size", pack.byte_size if pack else None, copy.byte_size),
            ("sha256", pack.sha256 if pack else None, copy.sha256),
        ]
    )
    pairs.extend(
        (name, getattr(manifest, name), copy.details.get(name))
        for name in ("declared_interval_seconds", "observed_interval_ms")
    )
    for name, expected, actual in pairs:
        if expected != actual:
            raise _corrupt(copy, f"{name} differs")


def read_back_capture_copy(storage: BronzeStorageResolver, copy: ArchiveCopy) -> Manifest:
    if copy.sealed_at_utc is None:
        raise ValueError("an allocated copy has nothing to read back")
    for name in ("manifest_path", "manifest_sha256"):
        if getattr(copy, name) is None:
            raise _corrupt(copy, f"{name} is absent")
    assert copy.manifest_path is not None
    store = storage(copy.storage_backend)
    try:
        manifest = read_copy_manifest(storage, copy)
    except ManifestInvalid as exc:
        raise _corrupt(copy, str(exc)) from exc
    except Exception as exc:
        if not store.exists(copy.manifest_path):
            raise _corrupt(copy, "manifest object absent") from exc
        raise
    _check_row(copy, manifest)
    if manifest.pack is not None:
        _check_pack(store, copy, manifest)
    return manifest


def _check_pack(store: BronzeStorage, copy: ArchiveCopy, manifest: Manifest) -> None:
    assert copy.storage_path is not None
    packed = tuple(
        PackedCapture(c.stream, c.offset, c.byte_size, c.sha256)
        for c in manifest.captures
        if c.packed and c.stream is not None and c.offset is not None
    )
    try:
        with store.open_stream(copy.storage_path) as source:
            reader = _DigestReader(source)
            for payload in read_pack(reader, manifest.streams, packed):
                del payload
            while reader.read(64 * 1024):
                pass
    except PackCorrupt as exc:
        where = f"capture_index {exc.capture_index}: " if exc.capture_index is not None else ""
        raise _corrupt(copy, where + str(exc)) from exc
    except Exception as exc:
        if not store.exists(copy.storage_path):
            raise _corrupt(copy, "pack object absent") from exc
        raise
    if reader.size != copy.byte_size:
        raise _corrupt(copy, "pack byte_size differs")
    if reader.digest.hexdigest() != copy.sha256:
        raise _corrupt(copy, "pack sha256 differs")


def _entry_json(entry: PollEntry | CaptureEntry | ProcessingEntry) -> bytes:
    value = asdict(entry)
    if isinstance(entry, CaptureEntry):
        for name in ("packed", "stream", "offset"):
            del value[name]
        if entry.index_family != "alert_snapshot":
            del value["api_version"], value["alert_count"]
    return canonical_json(value)


def first_difference(manifest: Manifest, working: PollRecord) -> str | None:
    normalized = PollRecord(
        FeedDayKey(
            manifest.provider_id, manifest.endpoint_key, manifest.index_family, manifest.utc_date
        ),
        tuple(
            replace(p, status="stored", missing_reason=None)
            if p.status == "capture_missing"
            and p.missing_reason in (OBJECT_ABSENT, OBJECT_MISMATCH)
            else p
            for p in manifest.polls
        ),
        tuple(replace(c, packed=False, stream=None, offset=None) for c in manifest.captures),
        manifest.processing,
        manifest.declared_interval_seconds,
        manifest.observed_interval_ms,
    )
    if poll_record_sha256(normalized) == poll_record_sha256(working):
        return None
    if normalized.feed_day != working.feed_day:
        return "feed-day differs"
    for name in ("polls", "captures", "processing"):
        difference = _entries_difference(getattr(normalized, name), getattr(working, name))
        if difference is not None:
            return difference
    if normalized.declared_interval_seconds != working.declared_interval_seconds:
        return "declared interval differs"
    if normalized.observed_interval_ms != working.observed_interval_ms:
        return "observed interval differs"
    return "poll record digest differs"


def _entry_key(entry: PollEntry | CaptureEntry | ProcessingEntry) -> tuple[str, int]:
    if isinstance(entry, PollEntry):
        return "poll", entry.ingestion_run_id
    if isinstance(entry, CaptureEntry):
        return entry.index_family, entry.capture_row_id
    identity = entry.ingestion_run_id if entry.stage == "silver_load" else entry.capture_row_id
    assert identity is not None
    return entry.stage, identity


def _entries_difference(
    archived: tuple[PollEntry | CaptureEntry | ProcessingEntry, ...],
    working: tuple[PollEntry | CaptureEntry | ProcessingEntry, ...],
) -> str | None:
    left, right = ({_entry_key(e): e for e in entries} for entries in (archived, working))
    for key in sorted(left.keys() | right.keys()):
        entry = left.get(key) or right[key]
        label = (
            f"poll {key[1]}"
            if isinstance(entry, PollEntry)
            else f"capture {key[0]}/{key[1]}"
            if isinstance(entry, CaptureEntry)
            else f"processing {key[0]} {key[1]}"
        )
        if key not in left:
            return f"{label} is in the working rows and not in the copy"
        if key not in right:
            return f"{label} is in the copy and not in the working rows"
        if _entry_json(left[key]) != _entry_json(right[key]):
            return f"{label} differs"
    return None
