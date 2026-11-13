import hashlib
from datetime import UTC, datetime, timedelta

import pytest
from history_fixtures import delete_provider_rows, seed_stored_capture, seed_working_day
from sqlalchemy import text

from transit_ops.history import ledger
from transit_ops.history.manifest import decode_manifest
from transit_ops.history.pack import PackedCapture, read_pack
from transit_ops.history.poll_record import poll_record_sha256
from transit_ops.history.seal_captures import WindowNotClosed
from transit_ops.history.store import seal
from transit_ops.history.working_captures import read_working_day, rows_fingerprint
from transit_ops.ingestion.storage import LocalBronzeStorage

PROVIDER = "history_seal_test"
START = datetime(2026, 1, 2, tzinfo=UTC)
DAY = START.date()
PREFIX = f"archive/v1/captures/{PROVIDER}/trip_updates/2026/01/2026-01-02.c"


@pytest.fixture
def engine(real_db_engine, seed_provider):
    try:
        with real_db_engine.begin() as conn:
            delete_provider_rows(conn, PROVIDER)
            seed_provider(conn, PROVIDER, display_name="Seal test")
            conn.execute(
                text("""
                INSERT INTO core.feed_endpoints
                    (provider_id, endpoint_key, feed_kind, source_format)
                VALUES (:p, 'trip_updates', 'trip_updates', 'gtfs_rt_trip_updates')
            """),
                {"p": PROVIDER},
            )
        yield real_db_engine
    finally:
        with real_db_engine.begin() as conn:
            delete_provider_rows(conn, PROVIDER)


def run_seal(engine, root, **kwargs):
    with engine.connect() as conn:
        return seal(
            conn,
            lambda backend: LocalBronzeStorage(root),
            dataset_id="capture.trip_updates",
            provider_id=PROVIDER,
            window_key=kwargs.pop("window_key", DAY.isoformat()),
            archive_backend="local",
            sealed_by="test-commit",
            actor="test",
            **kwargs,
        )


def seed(engine, root, *, stored=0, failed=0):
    payloads = [f"capture-{i}".encode() for i in range(stored)]
    with engine.begin() as conn:
        for i in range(stored + failed):
            args = dict(
                provider_id=PROVIDER,
                endpoint_key="trip_updates",
                run_id=771001 + i,
                capture_id=771001 + i,
                started_at_utc=START + timedelta(seconds=30 * i),
            )
            if i < stored:
                seed_stored_capture(conn, root, payload=payloads[i], **args)
            else:
                seed_working_day(conn, with_capture=False, status="failed", **args)
    return payloads


def manifest(root, copy):
    return decode_manifest((root / copy.manifest_path).read_bytes())


def packed(root, copy, m):
    entries = tuple(
        PackedCapture(c.stream, c.offset, c.byte_size, c.sha256) for c in m.captures if c.packed
    )
    with (root / copy.storage_path).open("rb") as source:
        return list(read_pack(source, m.streams, entries))


def state(conn, day=DAY):
    return ledger.window_state(
        conn, dataset_id="capture.trip_updates", provider_id=PROVIDER, window_key=day.isoformat()
    )


def test_closed_day_is_sealed_into_a_pack_and_a_manifest(engine, tmp_path):
    payloads = seed(engine, tmp_path, stored=3, failed=1)
    copy = run_seal(engine, tmp_path)
    m = manifest(tmp_path, copy)
    assert (copy.state, copy.content_version) == ("sealed", 1)
    assert copy.storage_path == PREFIX + "1.pack.xz"
    assert copy.manifest_path == PREFIX + "1.manifest.json.gz"
    data = (tmp_path / copy.storage_path).read_bytes()
    assert (copy.byte_size, copy.sha256) == (len(data), hashlib.sha256(data).hexdigest())
    assert (
        copy.manifest_sha256
        == hashlib.sha256((tmp_path / copy.manifest_path).read_bytes()).hexdigest()
    )
    assert (m.capture_count, m.poll_count, m.content_version, m.supersedes, m.sealed_by) == (
        3,
        4,
        1,
        None,
        "test-commit",
    )
    assert packed(tmp_path, copy, m) == payloads
    assert copy.verified_at_utc is None
    assert copy.sealed_at_utc != m.sealed_at_utc
    assert not copy.is_current
    with engine.begin() as conn:
        assert copy.details == dict(
            rows_fingerprint=rows_fingerprint(
                conn, provider_id=PROVIDER, endpoint_key="trip_updates", utc_date=DAY
            ),
            declared_interval_seconds=m.declared_interval_seconds,
            observed_interval_ms=m.observed_interval_ms,
        )
        w = state(conn)
        assert (w.working_state, w.current_version) == ("present", None)
        assert conn.execute(
            text(
                "SELECT kind, content_version, actor FROM core.history_event WHERE provider_id=:p"
            ),
            {"p": PROVIDER},
        ).all() == [("seal", 1, "test")]


def test_open_day_is_refused(engine, tmp_path):
    with engine.begin() as conn:
        now = conn.execute(text("SELECT now()")).scalar_one()
    day = (now - timedelta(hours=6)).astimezone(UTC).date()
    with pytest.raises(WindowNotClosed):
        run_seal(engine, tmp_path, window_key=day.isoformat())
    with engine.begin() as conn:
        assert state(conn, day) is None
        assert (
            ledger.find_copies(
                conn, dataset_id="capture.trip_updates", provider_id=PROVIDER, start=day, end=day
            )
            == []
        )
    assert list(LocalBronzeStorage(tmp_path).list_keys("archive/")) == []


def test_day_with_only_failed_polls_is_sealed(engine, tmp_path):
    seed(engine, tmp_path, failed=2)
    copy = run_seal(engine, tmp_path)
    m = manifest(tmp_path, copy)
    assert copy.state == "sealed"
    assert (copy.storage_path, copy.byte_size, copy.sha256, m.pack) == (None,) * 4
    assert (m.poll_count, m.capture_count) == (2, 0)
    assert list(LocalBronzeStorage(tmp_path).list_keys("archive/")) == [copy.manifest_path]


def test_day_with_no_poll_becomes_an_empty_window(engine, tmp_path):
    run_seal(engine, tmp_path)
    with engine.begin() as conn:
        assert state(conn).working_state == "empty"


def test_empty_day_gets_a_manifest_only_copy(engine, tmp_path):
    copy = run_seal(engine, tmp_path)
    m = manifest(tmp_path, copy)
    assert (copy.poll_count, copy.record_count) == (0, 0)
    assert (copy.storage_path, copy.byte_size, copy.sha256, m.pack) == (None,) * 4
    assert (m.polls, m.captures, m.processing) == ((), (), ())
    assert list(LocalBronzeStorage(tmp_path).list_keys("archive/")) == [copy.manifest_path]


def test_unreadable_object_is_recorded_and_the_rest_is_sealed(engine, tmp_path):
    payloads = seed(engine, tmp_path, stored=3)
    with engine.begin() as conn:
        before = rows_fingerprint(
            conn, provider_id=PROVIDER, endpoint_key="trip_updates", utc_date=DAY
        )
    (tmp_path / "capture/771002").unlink()
    copy = run_seal(engine, tmp_path)
    m = manifest(tmp_path, copy)
    assert (m.polls[1].status, m.polls[1].missing_reason) == ("capture_missing", "object_absent")
    assert not m.captures[1].packed
    assert packed(tmp_path, copy, m) == [payloads[0], payloads[2]]
    with engine.begin() as conn:
        assert (
            rows_fingerprint(conn, provider_id=PROVIDER, endpoint_key="trip_updates", utc_date=DAY)
            == before
        )


def test_version_is_taken_above_an_orphan_key(engine, tmp_path):
    orphan = tmp_path / (PREFIX + "3.pack.xz")
    orphan.parent.mkdir(parents=True)
    orphan.write_bytes(b"orphan")
    copy = run_seal(engine, tmp_path)
    assert copy.content_version == 4
    assert copy.manifest_path == PREFIX + "4.manifest.json.gz"
    assert orphan.read_bytes() == b"orphan"


def test_digest_is_equal_before_and_after_seal(engine, tmp_path):
    seed(engine, tmp_path, stored=2)
    with engine.begin() as conn:
        before = poll_record_sha256(
            read_working_day(conn, provider_id=PROVIDER, endpoint_key="trip_updates", utc_date=DAY)
        )
    copy = run_seal(engine, tmp_path)
    assert before == copy.poll_record_sha256 == manifest(tmp_path, copy).poll_record_sha256


def test_seal_needs_a_connection_without_a_transaction(engine, tmp_path):
    with engine.begin() as conn, pytest.raises(ValueError, match="transaction"):
        seal(
            conn,
            lambda backend: LocalBronzeStorage(tmp_path),
            dataset_id="capture.trip_updates",
            provider_id=PROVIDER,
            window_key=DAY.isoformat(),
            archive_backend="local",
            sealed_by="test",
        )
    with engine.begin() as conn:
        assert state(conn) is None


@pytest.mark.parametrize("current", [False, True])
def test_existing_sealed_or_current_copy_requires_next_packet(engine, tmp_path, current):
    copy = run_seal(engine, tmp_path)
    if current:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE core.history_archive_copy SET verified_at_utc=clock_timestamp() "
                    "WHERE provider_id=:p"
                ),
                {"p": PROVIDER},
            )
            conn.execute(
                text("UPDATE core.history_window SET current_version=:v WHERE provider_id=:p"),
                {"p": PROVIDER, "v": copy.content_version},
            )
    with pytest.raises(NotImplementedError, match="H04c4"):
        run_seal(engine, tmp_path)


@pytest.mark.parametrize("rejected", [False, True])
def test_allocated_or_rejected_copy_does_not_block_a_new_version(engine, tmp_path, rejected):
    with engine.begin() as conn:
        version = ledger.allocate_version(
            conn,
            dataset_id="capture.trip_updates",
            provider_id=PROVIDER,
            window_key=DAY.isoformat(),
        )
        conn.execute(
            text("""
            INSERT INTO core.history_archive_copy
                (dataset_id, provider_id, revision, window_key, content_version,
                 schema_version, storage_backend, allocated_at_utc)
            VALUES ('capture.trip_updates', :p, 0, :day, :v, 1, 'local', clock_timestamp())
        """),
            {"p": PROVIDER, "day": DAY.isoformat(), "v": version},
        )
        if rejected:
            conn.execute(
                text("""
                UPDATE core.history_archive_copy
                SET rejected_at_utc=clock_timestamp(), reject_reason='test rejection'
                WHERE provider_id=:p
            """),
                {"p": PROVIDER},
            )
    copy = run_seal(engine, tmp_path)
    assert (copy.content_version, copy.state) == (2, "sealed")
    with engine.begin() as conn:
        copies = ledger.find_copies(
            conn, dataset_id="capture.trip_updates", provider_id=PROVIDER, start=DAY, end=DAY
        )
        assert [(c.content_version, c.state) for c in copies] == [
            (1, "rejected" if rejected else "allocated"),
            (2, "sealed"),
        ]
