"""Checked payload reads without writes or reader-type dependencies."""

import hashlib
from collections.abc import Generator
from datetime import datetime

from transit_ops.history.ledger import ArchiveCopy
from transit_ops.history.manifest import Manifest
from transit_ops.history.pack import PackedCapture, read_stream
from transit_ops.history.poll_record import CaptureEntry
from transit_ops.ingestion.storage import BronzeStorageResolver


def object_payload(
    storage: BronzeStorageResolver, entry: CaptureEntry
) -> tuple[bytes | None, str | None]:
    backend = storage(entry.storage_backend)
    payload = bytearray()
    try:
        with backend.open_stream(entry.storage_path) as stream:
            while len(payload) <= entry.byte_size:
                chunk = stream.read(min(64 * 1024, entry.byte_size + 1 - len(payload)))
                if not chunk:
                    break
                payload.extend(chunk)
    except Exception:
        if not backend.exists(entry.storage_path):
            return None, "object_absent"
        raise
    if len(payload) != entry.byte_size or hashlib.sha256(payload).hexdigest() != entry.sha256:
        return None, "object_mismatch"
    return bytes(payload), None


def archive_payloads(
    storage: BronzeStorageResolver,
    copy: ArchiveCopy,
    manifest: Manifest,
    start: datetime,
    end: datetime,
) -> Generator[bytes, None, None]:
    packed = [c for c in manifest.captures if c.packed]
    selected = [c for c in packed if start <= c.captured_at_utc < end]
    if not selected:
        return
    assert selected[0].stream is not None and selected[-1].stream is not None
    streams = manifest.streams[selected[0].stream : selected[-1].stream + 1]
    first, last = streams[0], streams[-1]
    span = first.byte_offset, last.byte_offset + last.byte_size - first.byte_offset
    assert manifest.pack is not None
    try:
        with storage(copy.storage_backend).open_stream(
            manifest.pack.path, byte_range=span
        ) as source:
            for layout in streams:
                entries = packed[layout.first_capture : layout.first_capture + layout.capture_count]
                checks = [_packed(c) for c in entries]
                for entry, payload in zip(
                    entries, read_stream(source, layout, checks), strict=True
                ):
                    if start <= entry.captured_at_utc < end:
                        yield payload
    except Exception as exc:
        raise ValueError(
            f"archive {copy.provider_id}/{copy.dataset_id}/{copy.window_key}"
            f"/v{copy.content_version}: {exc}"
        ) from exc


def _packed(entry: CaptureEntry) -> PackedCapture:
    assert entry.stream is not None and entry.offset is not None
    return PackedCapture(entry.stream, entry.offset, entry.byte_size, entry.sha256)
