"""Check archive copies against storage and against their working day."""

import hashlib
from dataclasses import asdict, dataclass, replace
from datetime import UTC, date, datetime
from typing import Literal, TypedDict

from sqlalchemy import Connection, text

from transit_ops.history import ledger
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
from transit_ops.history.seal_captures import (
    OBJECT_ABSENT,
    OBJECT_MISMATCH,
    CopyContentMissing,
    reconcile_rejection_marker,
    reject_capture_copy,
)
from transit_ops.history.working_captures import read_working_day, rows_fingerprint
from transit_ops.ingestion.storage import BronzeStorage, BronzeStorageResolver


class CopyCorrupt(ValueError):
    """A copy's objects disagree with its row, with its manifest or with themselves."""


@dataclass(frozen=True)
class Verification:
    copy: ArchiveCopy
    outcome: Literal["verified", "rejected"]
    reason: str | None
    difference: str | None
    became_current: bool


class _WindowIdentity(TypedDict):
    dataset_id: str
    provider_id: str
    window_key: str


def _identity(copy: ArchiveCopy) -> _WindowIdentity:
    return dict(
        dataset_id=copy.dataset_id, provider_id=copy.provider_id, window_key=copy.window_key
    )


def _read_state(
    connection: Connection, copy: ArchiveCopy,
) -> tuple[ledger.WindowState, ArchiveCopy, list[ArchiveCopy]]:
    identity = _identity(copy)
    window = ledger.window_state(connection, **identity)
    day = date.fromisoformat(copy.window_key)
    copies = ledger.find_copies(
        connection, dataset_id=copy.dataset_id, provider_id=copy.provider_id, start=day, end=day,
    )
    row = next((c for c in copies if c.content_version == copy.content_version), None)
    if window is None or row is None:
        raise LookupError(f"copy not found: {identity}, version {copy.content_version}")
    return window, row, copies


def _refuse_window(window: ledger.WindowState, copy: ArchiveCopy) -> None:
    if window.working_state in ("partial", "trimmed"):
        raise NotImplementedError(
            "verifying a copy of a day whose working rows were trimmed is not built: "
            "it needs the copy compared with the remainder recorded by trim"
        )
    if window.current_version is not None and window.current_version > copy.content_version:
        raise ValueError(
            f"copy version {copy.content_version} is older than {window.current_version}"
        )


def _result(
    connection: Connection, copy: ArchiveCopy, reason: str | None, difference: str | None,
) -> Verification:
    with connection.begin():
        _, row, _ = _read_state(connection, copy)
    return Verification(
        row, "rejected" if reason else "verified", row.reject_reason, difference, reason is None
    )


def _reject(
    connection: Connection, storage: BronzeStorageResolver, copy: ArchiveCopy,
    reason: str, difference: str, actor: str | None,
) -> Verification:
    if not reject_capture_copy(connection, storage, copy, reason=reason, actor=actor):
        with connection.begin():
            _, row, _ = _read_state(connection, copy)
        raise RuntimeError(
            f"{_identity(row)} version {row.content_version}: "
            f"another process acted on it ({row.state})"
        )
    return _result(connection, copy, reason, difference)


def verify_capture_copy(
    connection: Connection, storage: BronzeStorageResolver, copy: ArchiveCopy,
    *, actor: str | None = None,
) -> Verification:
    if connection.in_transaction():
        raise ValueError("verify requires a connection without a transaction")
    if actor == "":
        raise ValueError("actor must not be empty")
    with connection.begin():
        window, row, _ = _read_state(connection, copy)
        if row.state == "verified":
            return Verification(row, "verified", None, None, row.is_current)
        if row.state != "sealed":
            raise ValueError(f"{_identity(row)} version {row.content_version} is {row.state}")
        _refuse_window(window, row)
    try:
        manifest = read_back_capture_copy(storage, row)
    except CopyCorrupt as exc:
        return _reject(connection, storage, row, "corrupt_object", str(exc), actor)
    reason, difference = _verify_locked(connection, storage, row, manifest, actor)
    if reason == "stale" and difference != "rejection marker present":
        assert difference is not None
        return _reject(connection, storage, row, reason, difference, actor)
    return _result(connection, row, reason, difference)


class _WorkingArgs(TypedDict):
    provider_id: str
    endpoint_key: str
    utc_date: date


def _verify_locked(
    connection: Connection, storage: BronzeStorageResolver, copy: ArchiveCopy,
    manifest: Manifest, actor: str | None,
) -> tuple[str | None, str | None]:
    identity = _identity(copy)
    with connection.begin():
        ledger.acquire_window_lock(connection, **identity)
        verified_at = connection.execute(text("SELECT clock_timestamp()")).scalar_one()
        window, row, copies = _read_state(connection, copy)
        if row.state != "sealed":
            raise RuntimeError(
                f"{identity} version {row.content_version}: "
                f"another process acted on it ({row.state})"
            )
        _refuse_window(window, row)
        marker = reconcile_rejection_marker(connection, storage, row, actor=actor)
        if marker is not None:
            return marker[1], "rejection marker present"
        args = _WorkingArgs(
            provider_id=row.provider_id,
            endpoint_key=row.dataset_id.removeprefix("capture."),
            utc_date=date.fromisoformat(row.window_key),
        )
        record = read_working_day(connection, **args, current=manifest)
        fingerprint = rows_fingerprint(connection, **args)
        difference = first_difference(manifest, record)
        if difference is None and fingerprint != row.details.get("rows_fingerprint"):
            difference = "row fingerprint differs"
        if difference is not None:
            return "stale", difference
        current = next((c for c in copies if c.content_version == window.current_version), None)
        if window.current_version is not None:
            if current is None:
                raise LookupError(f"current copy not found: {identity}")
            _require_superseding_content(read_copy_manifest(storage, current), manifest)
        _make_current(connection, row, verified_at, window.current_version, actor)
    return None, None


def _require_superseding_content(current: Manifest, candidate: Manifest) -> None:
    label = f"{candidate.provider_id}/{candidate.endpoint_key}/{candidate.utc_date}"
    polls = {p.ingestion_run_id for p in candidate.polls}
    for poll in current.polls:
        if poll.ingestion_run_id not in polls:
            raise CopyContentMissing(f"{label}: missing poll {poll.ingestion_run_id}")
    captures = {(c.index_family, c.capture_row_id): c for c in candidate.captures}
    for capture in current.captures:
        key = (capture.index_family, capture.capture_row_id)
        replacement = captures.get(key)
        if replacement is None:
            raise CopyContentMissing(f"{label}: missing capture {key}")
        if capture.packed and (
            not replacement.packed
            or replacement.sha256 != capture.sha256
            or replacement.byte_size != capture.byte_size
        ):
            raise CopyContentMissing(f"{label}: packed capture {key} loses or changes bytes")


def _make_current(
    connection: Connection, copy: ArchiveCopy, verified_at: datetime,
    previous: int | None, actor: str | None,
) -> None:
    identity = _identity(copy)
    values = dict(identity, version=copy.content_version, verified_at=verified_at)
    updated = connection.execute(text("""
        UPDATE core.history_archive_copy SET verified_at_utc=:verified_at
        WHERE dataset_id=:dataset_id AND provider_id=:provider_id AND revision=0
          AND window_key=:window_key AND content_version=:version
          AND sealed_at_utc IS NOT NULL AND verified_at_utc IS NULL AND rejected_at_utc IS NULL
    """), values)
    if updated.rowcount != 1:
        raise RuntimeError(f"could not verify copy {identity}")
    updated = connection.execute(text("""
        UPDATE core.history_window SET current_version=:version
        WHERE dataset_id=:dataset_id AND provider_id=:provider_id AND revision=0
          AND window_key=:window_key AND (current_version IS NULL OR current_version < :version)
    """), values)
    if updated.rowcount != 1:
        raise RuntimeError(f"could not make copy current {identity}")
    ledger.record_event(
        connection, kind="verify", revision=0, content_version=copy.content_version,
        actor=actor, **identity,
    )
    ledger.record_event(
        connection, kind="current", revision=0, content_version=copy.content_version,
        details={"previous_version": previous}, actor=actor, **identity,
    )


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
