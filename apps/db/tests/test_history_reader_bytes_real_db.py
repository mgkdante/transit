from datetime import UTC, datetime, timedelta

import pytest
from history_fixtures import delete_provider_rows, seed_stored_capture
from history_reader_bytes_fixtures import RecordingStorage

from transit_ops.history import store
from transit_ops.history.reader import open_window

PROVIDER = "reader_bytes_test"
START = datetime(2026, 1, 2, tzinfo=UTC)
DAY = START.date()


@pytest.fixture
def engine(real_db_engine, seed_provider):
    try:
        with real_db_engine.begin() as conn:
            delete_provider_rows(conn, PROVIDER)
            seed_provider(conn, PROVIDER, display_name="Reader bytes test")
        yield real_db_engine
    finally:
        with real_db_engine.begin() as conn:
            delete_provider_rows(conn, PROVIDER)


def seed(engine, root, *, feed="trip_updates", count=3, start=START, first=786001):
    with engine.begin() as conn:
        for i in range(count):
            seed_stored_capture(
                conn,
                root,
                provider_id=PROVIDER,
                endpoint_key=feed,
                run_id=first + i,
                capture_id=first + i,
                started_at_utc=start + timedelta(seconds=30 * i),
                payload=(b"first", b"second", b"second")[i % 3],
            )


def read(engine, storage, *, feeds=("trip_updates",), start=START, end=None):
    with engine.connect() as conn:
        return open_window(
            PROVIDER,
            feeds,
            start,
            end or START + timedelta(days=2),
            connection=conn,
            storage=lambda backend: storage,
        )


def archive(engine, storage, feed="trip_updates", day=DAY):
    with engine.connect() as conn:
        copy = store.seal(
            conn,
            lambda backend: storage,
            dataset_id="capture." + feed,
            provider_id=PROVIDER,
            window_key=day.isoformat(),
            archive_backend="local",
            sealed_by="test",
        )
        assert store.verify(conn, lambda backend: storage, copy).outcome == "verified"
    return copy


def test_same_captures_in_the_same_order_from_objects_and_from_a_pack(engine, tmp_path):
    seed(engine, tmp_path)
    storage = RecordingStorage(tmp_path)
    before = list(read(engine, storage).captures())
    archive(engine, storage)
    after = list(read(engine, storage).captures())
    assert before == after
    assert [c.payload for c in after] == [b"first", b"second", b"second"]
    assert len({c.capture_row_id for c in after}) == 3


def test_feeds_merge_by_capture_time_endpoint_and_row_id(engine, tmp_path):
    seed(engine, tmp_path, start=START - timedelta(seconds=2), count=1)
    seed(engine, tmp_path, feed="vehicle_positions", first=786010, count=2)
    seed(engine, tmp_path, first=786020, count=2)
    seed(engine, tmp_path, first=786030, count=1)
    storage = RecordingStorage(tmp_path)
    archive(engine, storage, day=START.date() - timedelta(days=1))
    result = read(engine, storage)
    assert [c.capture_row_id for c in result.captures()] == [
        786001,
        786020,
        786030,
        786010,
        786021,
        786011,
    ]
    assert {d.form for d in result.days if d.state == "available"} == {"objects", "archive_copy"}


def test_without_bytes_reads_no_pack(engine, tmp_path):
    seed(engine, tmp_path)
    storage = RecordingStorage(tmp_path)
    result = read(engine, storage)
    list(result.captures(with_bytes=False))
    list(result.processing())
    assert storage.opened == []
    archive(engine, storage)
    result = read(engine, storage)
    storage.opened.clear()
    list(result.captures(with_bytes=False))
    list(result.processing())
    assert all(key.endswith(".gz") for key, _ in storage.opened)


def test_window_inside_a_day_starts_at_the_right_stream(engine, tmp_path, monkeypatch):
    from transit_ops.history import seal_captures
    from transit_ops.history.manifest import read_copy_manifest
    from transit_ops.history.pack import write_pack

    monkeypatch.setattr(
        seal_captures,
        "write_pack",
        lambda captures, out: write_pack(captures, out, stream_max_source_bytes=12),
    )
    seed(engine, tmp_path, count=6)
    storage = RecordingStorage(tmp_path)
    copy = archive(engine, storage)
    manifest = read_copy_manifest(lambda backend: storage, copy)
    assert len(manifest.streams) >= 3
    result = read(
        engine, storage, start=START + timedelta(seconds=94), end=START + timedelta(seconds=154)
    )
    storage.opened.clear()
    assert [c.capture_row_id for c in result.captures()] == [786004, 786005]
    first, last = manifest.streams[1:3]
    assert [(key, span) for key, span in storage.opened if key.endswith(".xz")] == [
        (
            copy.storage_path,
            (first.byte_offset, last.byte_offset + last.byte_size - first.byte_offset),
        )
    ]
    assert copy.storage_path in storage.closed


def test_unreadable_object_is_skipped_and_listed(engine, tmp_path):
    seed(engine, tmp_path, count=5)
    storage = RecordingStorage(tmp_path)
    result = read(engine, storage)
    metadata = list(result.captures(with_bytes=False))
    for c, damage in zip(metadata, (None, b"x", b"too long", b"xxxxx"), strict=False):
        path = tmp_path / c.storage_path
        if damage is None:
            path.unlink()
        else:
            path.write_bytes(damage)
    polls = list(result.polls())
    for _ in range(2):
        assert [c.capture_row_id for c in result.captures()] == [786005]
        assert [p.missing_reason for p in result.unreadable] == [
            "object_absent",
            "object_mismatch",
            "object_mismatch",
            "object_mismatch",
        ]
        assert all(p.status == "capture_missing" for p in result.unreadable)
        list(result.captures(with_bytes=False))
        assert len(result.unreadable) == 4
        assert list(result.polls()) == polls


def test_present_window_with_extra_rows_is_read_from_objects(engine, tmp_path):
    seed(engine, tmp_path)
    storage = RecordingStorage(tmp_path)
    archive(engine, storage)
    seed(engine, tmp_path, first=786020, count=1, start=START + timedelta(hours=1))
    result = read(engine, storage)
    assert result.days[0].form == "objects"
    assert [c.payload for c in result.captures()] == [b"first", b"second", b"second", b"first"]


@pytest.mark.parametrize("feed", ["i3_alerts", "service_alerts"])
def test_alert_feed_goes_through_the_same_reader(engine, tmp_path, feed):
    seed(engine, tmp_path, feed=feed)
    storage = RecordingStorage(tmp_path)
    before = list(read(engine, storage, feeds=(feed,)).captures())
    archive(engine, storage, feed)
    assert list(read(engine, storage, feeds=(feed,)).captures()) == before
    assert [c.payload for c in before] == [b"first", b"second", b"second"]
    assert all(c.index_family == "alert_snapshot" for c in before)
