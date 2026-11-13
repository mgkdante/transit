import hashlib
from contextlib import contextmanager
from dataclasses import fields, replace
from datetime import UTC, datetime, timedelta, timezone

import pytest
from history_fixtures import scripted_feed_day

from transit_ops.history.ledger import ArchiveCopy
from transit_ops.history.manifest import build_manifest, encode_manifest
from transit_ops.history.pack import write_pack
from transit_ops.history.verify import CopyCorrupt, first_difference, read_back_capture_copy
from transit_ops.ingestion.storage import LocalBronzeStorage


@pytest.fixture
def stored_copy(tmp_path):
    record, payloads = scripted_feed_day()
    return _store(tmp_path, record, payloads)


def _store(root, record, payloads):
    key = "archive/v1/captures/network/feed/2026/01/2026-01-02.c1"
    pack_path = root / (key + ".pack.xz")
    pack_path.parent.mkdir(parents=True, exist_ok=True)
    with pack_path.open("wb") as out:
        pack = write_pack(payloads, out)
    entries = iter(pack.captures if pack else ())
    record = replace(
        record,
        captures=tuple(
            replace(c, stream=(p := next(entries)).stream, offset=p.offset) if c.packed else c
            for c in record.captures
        ),
    )
    now = datetime(2026, 1, 3, tzinfo=UTC)
    manifest = build_manifest(
        record,
        feed_endpoint_id=1,
        feed_kind="trip_updates",
        content_version=1,
        supersedes=None,
        pack_path=key + ".pack.xz" if pack else None,
        pack=pack,
        sealed_at_utc=now,
        sealed_by="commit",
    )
    data = encode_manifest(manifest)
    path = key + ".manifest.json.gz"
    (root / path).write_bytes(data)
    copy = _copy(manifest, pack, path, data, now)
    opened, sizes = [], {}

    class RecordingStore(LocalBronzeStorage):
        @contextmanager
        def open_stream(self, path, **kwargs):
            opened.append(path)
            with super().open_stream(path, **kwargs) as stream:

                class Reader:
                    def read(self, size=-1):
                        data = stream.read(size)
                        sizes[path] = sizes.get(path, 0) + len(data)
                        return data

                yield Reader()

    return lambda _: RecordingStore("local", root), copy, manifest, record, opened, sizes


def _copy(manifest, pack, path, data, now):
    return ArchiveCopy(
        dataset_id="capture.feed",
        provider_id="network",
        revision=0,
        window_key="2026-01-02",
        content_version=1,
        schema_version=1,
        storage_backend="local",
        storage_path=manifest.pack.path if pack else None,
        manifest_path=path,
        byte_size=pack.byte_size if pack else None,
        sha256=pack.sha256 if pack else None,
        manifest_sha256=hashlib.sha256(data).hexdigest(),
        record_count=manifest.capture_count,
        poll_count=manifest.poll_count,
        source_bytes=manifest.source_bytes,
        content_sha256=manifest.content_sha256,
        poll_record_sha256=manifest.poll_record_sha256,
        first_time_utc=manifest.first_time_utc,
        last_time_utc=manifest.last_time_utc,
        allocated_at_utc=now,
        sealed_at_utc=now,
        verified_at_utc=None,
        rejected_at_utc=None,
        reject_reason=None,
        details=dict(
            rows_fingerprint="f" * 64, declared_interval_seconds=30, observed_interval_ms=30_000
        ),
        window_start=None,
        is_current=False,
    )


def test_sound_copy_reads_back_to_its_manifest(stored_copy):
    storage, copy, manifest, _, opened, sizes = stored_copy
    assert read_back_capture_copy(storage, copy) == manifest
    assert opened == [copy.manifest_path, copy.storage_path]
    assert sizes[copy.storage_path] == copy.byte_size


def test_one_flipped_byte_in_the_pack_is_corrupt(stored_copy, tmp_path):
    _damage(stored_copy, tmp_path, "flip")


@pytest.mark.parametrize("kind", ["short", "extended"])
def test_pack_cut_short_or_extended_is_corrupt(stored_copy, tmp_path, kind):
    _damage(stored_copy, tmp_path, kind)


def test_flipped_byte_in_the_manifest_is_corrupt(stored_copy, tmp_path):
    _damage(stored_copy, tmp_path, "manifest")


def _damage(stored_copy, tmp_path, kind):
    storage, copy, *_ = stored_copy
    path = tmp_path / (copy.manifest_path if kind == "manifest" else copy.storage_path)
    data = bytearray(path.read_bytes())
    if kind == "short":
        del data[-1]
    elif kind == "extended":
        data.append(0)
    else:
        data[len(data) // 2] ^= 1
    path.write_bytes(data)
    with pytest.raises(CopyCorrupt, match="capture.feed/network/2026-01-02/v1"):
        read_back_capture_copy(storage, copy)


@pytest.mark.parametrize(
    "field",
    [
        "content_sha256",
        "poll_record_sha256",
        "record_count",
        "poll_count",
        "source_bytes",
        "first_time_utc",
        "last_time_utc",
        "byte_size",
        "sha256",
        "storage_path",
        "details",
        "manifest_path",
        "manifest_sha256",
    ],
)
def test_row_that_disagrees_with_its_manifest_is_corrupt(stored_copy, field):
    storage, copy, *_ = stored_copy
    value = getattr(copy, field)
    if field == "details":
        value = dict(value, observed_interval_ms=1)
    elif field.startswith("manifest_"):
        value = None
    elif isinstance(value, datetime):
        value += timedelta(microseconds=1)
    elif isinstance(value, int):
        value += 1
    else:
        value += "x"
    with pytest.raises(CopyCorrupt, match=field if field != "details" else "observed_interval_ms"):
        read_back_capture_copy(storage, replace(copy, **{field: value}))


def test_times_are_compared_as_instants(stored_copy):
    storage, copy, manifest, *_ = stored_copy
    zone = timezone(timedelta(hours=-5))
    copy = replace(
        copy,
        first_time_utc=copy.first_time_utc.astimezone(zone),
        last_time_utc=copy.last_time_utc.astimezone(zone),
    )
    assert read_back_capture_copy(storage, copy) == manifest


@pytest.mark.parametrize("field", ["storage_path", "manifest_path"])
def test_absent_object_is_corrupt(stored_copy, tmp_path, field):
    storage, copy, *_ = stored_copy
    (tmp_path / getattr(copy, field)).unlink()
    with pytest.raises(CopyCorrupt, match="object absent"):
        read_back_capture_copy(storage, copy)


def test_storage_outage_propagates(stored_copy):
    _, copy, *_ = stored_copy

    class Outage(LocalBronzeStorage):
        def open_stream(self, path):
            raise OSError("outage")

        def exists(self, path):
            return True

    with pytest.raises(OSError, match="outage"):
        read_back_capture_copy(lambda _: Outage("local", None), copy)


def test_copy_without_a_pack_reads_back(tmp_path):
    record, _ = scripted_feed_day()
    record = replace(
        record,
        polls=tuple(p for p in record.polls if p.status == "failed"),
        captures=(),
        processing=(),
    )
    storage, copy, manifest, _, opened, _ = _store(tmp_path, record, ())
    assert read_back_capture_copy(storage, copy) == manifest
    assert opened == [copy.manifest_path]


def test_allocated_copy_is_a_caller_error(stored_copy):
    storage, copy, *_ = stored_copy
    with pytest.raises(ValueError) as error:
        read_back_capture_copy(storage, replace(copy, sealed_at_utc=None))
    assert type(error.value) is ValueError


def _working(record):
    return replace(
        record,
        captures=tuple(replace(c, packed=False, stream=None, offset=None) for c in record.captures),
    )


@pytest.mark.parametrize("reason", ["object_absent", "object_mismatch"])
def test_working_day_equal_to_its_copy_has_no_difference(stored_copy, tmp_path, reason):
    _, _, manifest, record, *_ = stored_copy
    assert first_difference(manifest, _working(record)) is None
    polls = (
        replace(manifest.polls[0], status="capture_missing", missing_reason=reason),
        *manifest.polls[1:],
    )
    captures = (
        replace(record.captures[0], packed=False, stream=None, offset=None),
        *record.captures[1:],
    )
    missing = replace(record, polls=polls, captures=captures)
    _, _, manifest, *_ = _store(tmp_path, missing, (b"second", b"second"))
    assert first_difference(manifest, _working(record)) is None


@pytest.mark.parametrize(
    "change, expected",
    [
        ("add", "poll 99 is in the working rows and not in the copy"),
        ("remove", "poll 0 is in the copy and not in the working rows"),
        ("poll", "poll 0 differs"),
        ("capture", "capture realtime_snapshot/0 is in the copy and not in the working rows"),
        ("processing", "processing gold_facts 0 differs"),
        ("declared", "declared interval differs"),
        ("observed", "observed interval differs"),
        ("day", "feed-day differs"),
    ],
)
def test_each_difference_is_named(stored_copy, change, expected):
    _, _, manifest, record, *_ = stored_copy
    working = _working(record)
    changes = {
        "add": dict(polls=(*working.polls, replace(working.polls[0], ingestion_run_id=99))),
        "remove": dict(polls=working.polls[1:]),
        "poll": dict(
            polls=(replace(working.polls[0], error_message="changed"), *working.polls[1:])
        ),
        "capture": dict(captures=working.captures[1:]),
        "processing": dict(
            processing=tuple(
                replace(p, attribution="recorded", rows=42)
                if p.stage == "gold_facts" and p.capture_row_id == 0
                else p
                for p in working.processing
            )
        ),
        "declared": dict(declared_interval_seconds=31),
        "observed": dict(observed_interval_ms=1),
        "day": dict(feed_day=replace(working.feed_day, endpoint_key="other")),
    }
    assert first_difference(manifest, replace(working, **changes[change])) == expected


def test_working_times_in_another_zone_are_not_a_difference(stored_copy):
    _, _, manifest, record, *_ = stored_copy
    zone = timezone(timedelta(hours=-5))

    def convert(entry):
        return replace(
            entry,
            **{
                f.name: v.astimezone(zone)
                for f in fields(entry)
                if isinstance(v := getattr(entry, f.name), datetime)
            },
        )

    working = _working(record)
    working = replace(
        working,
        **{
            name: tuple(map(convert, getattr(working, name)))
            for name in ("polls", "captures", "processing")
        },
    )
    assert first_difference(manifest, working) is None
