"""Real encoded archives and observable storage for reader tests."""

import hashlib
import io
from contextlib import contextmanager
from dataclasses import fields, replace
from datetime import timedelta

from history_fixtures import scripted_feed_day
from history_reader_fakes import fake_feed_day

from transit_ops.history.ledger import ArchiveCopy
from transit_ops.history.manifest import build_manifest, encode_manifest
from transit_ops.history.pack import PackedCapture, PackResult, write_pack
from transit_ops.history.poll_record import ordered_record
from transit_ops.history.reader import CaptureWindow
from transit_ops.ingestion.storage import LocalBronzeStorage


class RecordingStorage(LocalBronzeStorage):
    def __init__(self, root):
        super().__init__(storage_backend="local", root=root)
        object.__setattr__(self, "opened", [])
        object.__setattr__(self, "closed", [])
        object.__setattr__(self, "reads", [])
        object.__setattr__(self, "fail_key", None)

    @contextmanager
    def open_stream(self, key, *, byte_range=None):
        self.opened.append((key, byte_range))
        owner = self

        class Observed:
            def read(self, size=-1):
                if key == owner.fail_key:
                    raise OSError("stream unavailable")
                data = stream.read(size)
                owner.reads.append((key, size, len(data)))
                return data

        try:
            with super().open_stream(key, byte_range=byte_range) as stream:
                yield Observed()
        finally:
            self.closed.append(key)


def example(root, *, feed="trip_updates", shift=timedelta(), limit=1000):
    record, payloads = scripted_feed_day(endpoint_key=feed)
    record = replace(
        record,
        feed_day=replace(record.feed_day, utc_date=record.feed_day.utc_date + shift),
        captures=tuple(
            replace(c, storage_backend="local", captured_at_utc=c.captured_at_utc + shift)
            for c in record.captures
        ),
        polls=tuple(replace(p, time_utc=p.time_utc + shift) for p in record.polls),
    )
    out = io.BytesIO()
    pack = write_pack(payloads, out, stream_max_source_bytes=limit)
    layouts = iter(pack.captures)
    record = replace(
        record,
        captures=tuple(
            replace(c, stream=(p := next(layouts)).stream, offset=p.offset) if c.packed else c
            for c in record.captures
        ),
    )
    return _store_example(root, record, pack, out.getvalue(), payloads)


def _store_example(root, record, pack, data, payloads):
    feed = record.feed_day.endpoint_key
    prefix = f"{feed}-{record.feed_day.utc_date}"
    manifest = build_manifest(
        record,
        feed_endpoint_id=1,
        feed_kind=feed,
        content_version=1,
        supersedes=None,
        pack_path=prefix + ".xz",
        pack=pack,
        sealed_at_utc=record.polls[-1].time_utc,
        sealed_by="test",
    )
    encoded = encode_manifest(manifest)
    (root / (prefix + ".gz")).write_bytes(encoded)
    (root / (prefix + ".xz")).write_bytes(data)
    for c, payload in zip(record.captures, payloads, strict=False):
        path = root / c.storage_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
    values = dict.fromkeys(f.name for f in fields(ArchiveCopy))
    values.update(
        dataset_id="capture." + feed,
        provider_id="network",
        revision=0,
        window_key=record.feed_day.utc_date.isoformat(),
        content_version=1,
        schema_version=1,
        storage_backend="local",
        storage_path=prefix + ".xz",
        manifest_path=prefix + ".gz",
        manifest_sha256=hashlib.sha256(encoded).hexdigest(),
        details={},
        is_current=True,
    )
    return record, manifest, ArchiveCopy(**values), payloads


def with_processing(root, ex, processing):
    record, manifest, copy, payloads = ex
    record = ordered_record(replace(record, processing=processing))
    packed = tuple(
        PackedCapture(c.stream, c.offset, c.byte_size, c.sha256)
        for c in record.captures
        if c.packed
    )
    pack = PackResult(
        manifest.pack.byte_size,
        manifest.pack.sha256,
        manifest.source_bytes,
        manifest.streams,
        packed,
    )
    return _store_example(root, record, pack, (root / copy.storage_path).read_bytes(), payloads)


def window(storage, examples, *, archived=False, start=None, end=None):
    days, records, copies = [], {}, {}
    for record, _manifest, copy, _ in examples:
        key = record.feed_day.endpoint_key, record.feed_day.utc_date
        records[key], copies[key] = record, copy
        days.append(
            fake_feed_day(
                provider_id="network",
                endpoint_key=key[0],
                utc_date=key[1],
                form="archive_copy" if archived else "objects",
                content_version=1 if archived else None,
                bytes_verified=archived,
            )
        )
    first = min(c.captured_at_utc for r, *_ in examples for c in r.captures)
    return CaptureWindow(
        provider_id="network",
        feeds=tuple(d.endpoint_key for d in days),
        start_utc=start or first,
        end_utc=end or first + timedelta(days=3),
        days=tuple(days),
        connection=None,
        storage=lambda backend: storage,
        records=records,
        copies=copies,
    )
