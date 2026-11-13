from dataclasses import replace
from datetime import timedelta

import pytest
from history_reader_bytes_fixtures import RecordingStorage, example, window, with_processing

from transit_ops.history.poll_record import ProcessingEntry


@pytest.mark.parametrize("exists", [True, "fails"])
def test_object_outage_is_not_reported_as_missing(tmp_path, exists):
    ex = example(tmp_path)

    class Outage(RecordingStorage):
        def open_stream(self, key, *, byte_range=None):
            raise OSError("read unavailable")

        def exists(self, key):
            if exists == "fails":
                raise OSError("exists unavailable")
            return True

    result = window(Outage(tmp_path), [ex])
    with pytest.raises(OSError, match="unavailable"):
        list(result.captures())
    assert result.unreadable == []


@pytest.mark.parametrize("damage", ["manifest", "hash", "truncated", "absent"])
def test_archive_corruption_never_falls_back_to_objects(tmp_path, damage):
    class ReadOnly(RecordingStorage):
        def put_if_absent(self, *args):
            raise AssertionError("reader attempted a write")

        persist_temp_file = delete_object = delete_objects = put_if_absent

    ex = example(tmp_path)
    path = tmp_path / (ex[2].manifest_path if damage == "manifest" else ex[2].storage_path)
    if damage == "absent":
        path.unlink()
    elif damage == "truncated":
        path.write_bytes(path.read_bytes()[:12])
    else:
        path.write_bytes(b"corrupt")
    storage = ReadOnly(tmp_path)
    result = window(storage, [ex], archived=True)
    with pytest.raises((ValueError, OSError)):
        next(result.captures())
    assert all(not key.startswith("capture/") for key, _ in storage.opened)
    assert result.unreadable == []
    assert sorted(storage.closed) == sorted(key for key, _ in storage.opened)


def test_capture_iterator_closes_streams_on_close_and_failure(tmp_path):
    examples = [
        example(tmp_path, feed=feed, limit=5) for feed in ("trip_updates", "vehicle_positions")
    ]
    storage = RecordingStorage(tmp_path)
    result = window(storage, examples, archived=True)
    iterator = result.captures()
    next(iterator)
    assert sum(key.endswith(".xz") for key, _ in storage.opened) == 1
    iterator.close()
    assert sorted(storage.closed) == sorted(key for key, _ in storage.opened)
    storage.opened.clear()
    storage.closed.clear()
    iterator = result.captures()
    next(iterator)
    next(iterator)
    object.__setattr__(storage, "fail_key", examples[0][2].storage_path)
    with pytest.raises(ValueError, match="stream unavailable"):
        next(iterator)
    assert sorted(storage.closed) == sorted(key for key, _ in storage.opened)


@pytest.mark.parametrize("archived", [False, True])
def test_processing_uses_capture_time_and_preserves_unknown_evidence(tmp_path, archived):
    ex = example(tmp_path)
    record, manifest, copy, payloads = ex
    start = record.captures[2].captured_at_utc
    evidence = ProcessingEntry(
        "silver_load", "realtime_snapshot", None, None, "failed", start, start, "failure", None, 99
    )
    later = start + timedelta(days=2)
    processing = tuple(
        replace(
            p,
            completed_at_utc=later,
            started_at_utc=later if p.stage == "silver_load" else p.started_at_utc,
        )
        for p in record.processing
    )
    ex = with_processing(tmp_path, ex, processing + (evidence,))
    result = window(
        RecordingStorage(tmp_path),
        [ex],
        archived=archived,
        start=start,
        end=start + timedelta(minutes=2),
    )
    records = list(result.processing())
    assert [(r.capture_row_id, r.status, r.rows) for r in records] == [
        (2, "not_observed", None),
        (5, "failed", None),
        (None, "failed", None),
        (2, "failed", None),
    ]
    assert all(r.provider_id == "network" and r.endpoint_key == "trip_updates" for r in records)


def test_selected_stream_footer_is_checked_and_objects_are_bounded(tmp_path):
    ex = example(tmp_path)
    path = tmp_path / ex[2].storage_path
    data = bytearray(path.read_bytes())
    data[-1] ^= 1
    path.write_bytes(data)
    storage = RecordingStorage(tmp_path)
    iterator = window(storage, [ex], archived=True).captures()
    # Captures are individually sound; exhaustion must still check the footer.
    with pytest.raises(ValueError):
        list(iterator)
    path = tmp_path / ex[0].captures[0].storage_path
    path.write_bytes(b"x" * 100000)
    result = window(storage, [ex])
    assert [c.payload for c in result.captures()] == [b"second", b"second"]
    assert result.unreadable[0].missing_reason == "object_mismatch"
    reads = [n for key, _, n in storage.reads if key == ex[0].captures[0].storage_path]
    assert sum(reads) == 6


def test_metadata_reads_no_payloads_and_range_keeps_original_offsets(tmp_path):
    ex = example(tmp_path, limit=5)
    storage = RecordingStorage(tmp_path)
    result = window(storage, [ex])
    assert len(list(result.captures(with_bytes=False))) == 4
    list(result.processing())
    assert storage.opened == []
    result = window(storage, [ex], archived=True)
    assert len(list(result.captures(with_bytes=False))) == 3
    list(result.processing())
    assert storage.opened == [(ex[2].manifest_path, None)] * 2
    storage.opened.clear()
    start = ex[0].captures[1].captured_at_utc
    result = window(storage, [ex], archived=True, start=start, end=start + timedelta(seconds=30))
    assert [c.payload for c in result.captures()] == [b"second"]
    stream = ex[1].streams[1]
    assert storage.opened == [
        (ex[2].manifest_path, None),
        (ex[2].storage_path, (stream.byte_offset, stream.byte_size)),
    ]
    assert ex[2].storage_path in storage.closed
