from dataclasses import replace

import pytest
from history_fixtures import scripted_feed_day

from transit_ops.history.pack import PackCorrupt, read_pack, write_pack
from transit_ops.history.poll_record import PollRecordInvalid, ordered_record, poll_record_sha256
from transit_ops.history.seal_captures import pack_working_day
from transit_ops.ingestion.storage import BronzeStorageError, LocalBronzeStorage


@pytest.fixture
def working_day(tmp_path):
    record, payloads = scripted_feed_day()
    record = ordered_record(
        replace(
            record,
            captures=tuple(
                replace(c, packed=False, stream=None, offset=None) for c in record.captures
            ),
            polls=tuple(
                replace(p, status="stored", missing_reason=None) if p.ingestion_run_id == 5 else p
                for p in record.polls
            ),
        )
    )
    store = LocalBronzeStorage("local", tmp_path / "bronze")
    for capture, payload in zip(record.captures, (*payloads, b"missing"), strict=True):
        path = store.root / capture.storage_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
    directory = tmp_path / "pack"
    directory.mkdir()
    backends = []

    def resolver(backend):
        backends.append(backend)
        return store

    return record, store, directory, resolver, backends


def test_every_readable_capture_is_packed_in_capture_order(working_day):
    record, _, directory, resolver, backends = working_day
    result = pack_working_day(
        replace(record, captures=record.captures[::-1]), resolver, directory=directory
    )
    assert result.path == directory / "2026-01-02.pack.xz"
    with result.path.open("rb") as source:
        assert list(read_pack(source, result.pack.streams, result.pack.captures)) == [
            b"first",
            b"second",
            b"second",
            b"missing",
        ]
    for capture, packed in zip(result.record.captures, result.pack.captures, strict=True):
        assert capture.packed
        assert (capture.stream, capture.offset) == (packed.stream, packed.offset)
    assert result.record.polls == record.polls
    assert result.record.processing == record.processing
    assert backends == ["s3"] * 4


def test_unreadable_object_is_recorded_and_the_rest_is_packed(working_day):
    record, store, directory, resolver, _ = working_day
    (store.root / "capture/1").unlink()
    (store.root / "capture/2").write_bytes(b"change")
    result = pack_working_day(record, resolver, directory=directory)
    assert [c.packed for c in result.record.captures] == [True, False, False, True]
    for capture in result.record.captures[1:3]:
        assert capture.stream is None and capture.offset is None
    for poll, reason in zip(
        result.record.polls[1:3], ("object_absent", "object_mismatch"), strict=True
    ):
        assert poll.status == "capture_missing" and poll.missing_reason == reason
    assert poll_record_sha256(result.record) != poll_record_sha256(record)
    with result.path.open("rb") as source:
        assert list(read_pack(source, result.pack.streams, result.pack.captures)) == [
            b"first",
            b"missing",
        ]


@pytest.mark.parametrize("empty", [False, True])
def test_day_with_no_readable_capture_has_no_pack(working_day, empty):
    record, store, directory, resolver, _ = working_day
    for capture in record.captures:
        (store.root / capture.storage_path).unlink()
    if empty:
        record = replace(record, captures=(), polls=(), processing=())
    result = pack_working_day(record, resolver, directory=directory)
    assert result.pack is None and result.path is None
    assert list(directory.iterdir()) == []


@pytest.mark.parametrize("exists", [True, "error"])
def test_storage_failure_that_is_not_absence_stops_the_pack(working_day, monkeypatch, exists):
    record, _, directory, resolver, _ = working_day

    def fail(*args, **kwargs):
        raise BronzeStorageError("outage")

    monkeypatch.setattr(LocalBronzeStorage, "open_stream", fail)
    monkeypatch.setattr(
        LocalBronzeStorage, "exists", fail if exists == "error" else lambda *args: True
    )
    with pytest.raises(BronzeStorageError, match="outage"):
        pack_working_day(record, resolver, directory=directory)
    assert list(directory.iterdir()) == []


def test_local_pack_is_checked_before_it_is_returned(working_day, monkeypatch):
    record, _, directory, resolver, _ = working_day

    def corrupt(captures, out):
        pack = write_pack(captures, out)
        return replace(
            pack, captures=(replace(pack.captures[0], sha256="0" * 64), *pack.captures[1:])
        )

    monkeypatch.setattr("transit_ops.history.seal_captures.write_pack", corrupt)
    with pytest.raises(PackCorrupt):
        pack_working_day(record, resolver, directory=directory)
    assert list(directory.iterdir()) == []


@pytest.mark.parametrize("fields", [{"packed": True}, {"stream": 0}, {"offset": 0}])
def test_packed_record_is_refused(working_day, fields):
    record, _, directory, resolver, _ = working_day
    record = replace(record, captures=(replace(record.captures[0], **fields), *record.captures[1:]))
    with pytest.raises(ValueError):
        pack_working_day(record, resolver, directory=directory)
    assert list(directory.iterdir()) == []


def test_existing_pack_is_preserved(working_day):
    record, _, directory, resolver, _ = working_day
    path = directory / "2026-01-02.pack.xz"
    path.write_bytes(b"existing")
    with pytest.raises(FileExistsError):
        pack_working_day(record, resolver, directory=directory)
    assert path.read_bytes() == b"existing"


def test_missing_capture_without_stored_poll_is_refused(working_day):
    record, store, directory, resolver, _ = working_day
    (store.root / "capture/1").unlink()
    record = replace(record, polls=tuple(p for p in record.polls if p.capture_row_id != 1))
    with pytest.raises(PollRecordInvalid, match="realtime_snapshot.*1"):
        pack_working_day(record, resolver, directory=directory)
    assert list(directory.iterdir()) == []
