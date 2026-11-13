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
            lambda backend: LocalBronzeStorage("local", root),
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
    assert list(LocalBronzeStorage("local", tmp_path).list_keys("archive/")) == []


def test_day_with_only_failed_polls_is_sealed(engine, tmp_path):
    seed(engine, tmp_path, failed=2)
    copy = run_seal(engine, tmp_path)
    m = manifest(tmp_path, copy)
    assert copy.state == "sealed"
    assert (copy.storage_path, copy.byte_size, copy.sha256, m.pack) == (None,) * 4
    assert (m.poll_count, m.capture_count) == (2, 0)
    assert list(LocalBronzeStorage("local", tmp_path).list_keys("archive/")) == [copy.manifest_path]


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
    assert list(LocalBronzeStorage("local", tmp_path).list_keys("archive/")) == [copy.manifest_path]


def test_unreadable_object_is_recorded_and_the_rest_is_sealed(engine, tmp_path):
    payloads = seed(engine, tmp_path, stored=3)
    with engine.begin() as conn:
        before = rows_fingerprint(
            conn, provider_id=PROVIDER, endpoint_key="trip_updates", utc_date=DAY
        )
        storage_path = conn.execute(
            text(
                "SELECT storage_path FROM raw.ingestion_objects "
                "WHERE provider_id=:p AND ingestion_run_id=:r"
            ),
            {"p": PROVIDER, "r": 771002},
        ).scalar_one()
    (tmp_path / storage_path).unlink()
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
            lambda backend: LocalBronzeStorage("local", tmp_path),
            dataset_id="capture.trip_updates",
            provider_id=PROVIDER,
            window_key=DAY.isoformat(),
            archive_backend="local",
            sealed_by="test",
        )
    with engine.begin() as conn:
        assert state(conn) is None


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
            (1, "rejected"),
            (2, "sealed"),
        ]
        if not rejected:
            import gzip
            import json

            assert copies[0].reject_reason == "incomplete_write"
            marker = tmp_path / (PREFIX + "1.rejected.json.gz")
            assert json.loads(gzip.decompress(marker.read_bytes()))["reason"] == "incomplete_write"
            assert conn.execute(
                text(
                    "SELECT content_version, reason FROM core.history_event "
                    "WHERE provider_id=:p AND kind='reject'"
                ),
                {"p": PROVIDER},
            ).all() == [(1, "incomplete_write")]


def verify(engine, copy):
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE core.history_archive_copy SET verified_at_utc=clock_timestamp() "
                "WHERE provider_id=:p AND content_version=:v AND window_key=:day"
            ),
            dict(p=PROVIDER, v=copy.content_version, day=copy.window_key),
        )
        conn.execute(
            text(
                "UPDATE core.history_window SET current_version=:v "
                "WHERE provider_id=:p AND window_key=:day"
            ),
            dict(p=PROVIDER, v=copy.content_version, day=copy.window_key),
        )


def archive_state(engine, root):
    with engine.begin() as conn:
        copies = (
            conn.execute(
                text(
                    "SELECT content_version FROM core.history_archive_copy "
                    "WHERE provider_id=:p ORDER BY content_version"
                ),
                dict(p=PROVIDER),
            )
            .scalars()
            .all()
        )
        events = (
            conn.execute(
                text("SELECT kind FROM core.history_event WHERE provider_id=:p ORDER BY event_id"),
                dict(p=PROVIDER),
            )
            .scalars()
            .all()
        )
    return copies, events, list(LocalBronzeStorage("local", root).list_keys("archive/"))


def change_run(engine):
    with engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE raw.ingestion_runs SET error_message='changed' "
                "WHERE ingestion_run_id=771002"
            ),
        )


def test_unchanged_day_is_not_sealed_again(engine, tmp_path):
    seed(engine, tmp_path, stored=1)
    first = run_seal(engine, tmp_path)
    verify(engine, first)
    before = archive_state(engine, tmp_path)
    with engine.connect() as conn:

        def no_storage(backend):
            pytest.fail("unchanged seal accessed storage")

        again = seal(
            conn,
            no_storage,
            dataset_id="capture.trip_updates",
            provider_id=PROVIDER,
            window_key=DAY.isoformat(),
            archive_backend="local",
            sealed_by="test",
        )
    assert (again.content_version, again.state) == (first.content_version, "verified")
    assert before[:2] == ([1], ["seal"])
    assert archive_state(engine, tmp_path) == before


def test_waiting_copy_is_returned_while_nothing_changed(engine, tmp_path):
    seed(engine, tmp_path, stored=1, failed=1)
    first = run_seal(engine, tmp_path)
    before = archive_state(engine, tmp_path)
    assert run_seal(engine, tmp_path) == first
    assert archive_state(engine, tmp_path) == before
    change_run(engine)
    second = run_seal(engine, tmp_path)
    assert (second.content_version, second.state) == (2, "sealed")
    assert archive_state(engine, tmp_path)[0] == [1, 2]
    assert manifest(tmp_path, second).supersedes is None


def seed_recent_day_with_facts(engine, tmp_path):
    with engine.begin() as conn:
        at = (conn.execute(text("SELECT now()")).scalar_one() - timedelta(days=2)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        seed_stored_capture(
            conn,
            tmp_path,
            provider_id=PROVIDER,
            endpoint_key="trip_updates",
            run_id=771001,
            capture_id=771001,
            started_at_utc=at,
            payload=b"capture",
        )
        seed_working_day(
            conn,
            provider_id=PROVIDER,
            endpoint_key="trip_updates",
            run_id=771002,
            started_at_utc=at + timedelta(seconds=30),
            with_capture=False,
            status="failed",
        )
        conn.execute(
            text("UPDATE core.feed_endpoints SET refresh_interval_seconds=30 WHERE provider_id=:p"),
            dict(p=PROVIDER),
        )
        conn.execute(
            text(
                "INSERT INTO gold.fact_trip_delay_snapshot "
                "(provider_id, realtime_snapshot_id, entity_index, snapshot_date_key, "
                "snapshot_local_date, feed_timestamp_utc, captured_at_utc, stop_time_update_count) "
                "SELECT :p, 771001, n, :key, :day, :at, :at, 0 FROM generate_series(1,3) n"
            ),
            dict(p=PROVIDER, key=int(at.strftime("%Y%m%d")), day=at.date(), at=at),
        )
    return at


def test_changed_day_is_sealed_again_with_its_outcomes_carried(engine, tmp_path):
    at = seed_recent_day_with_facts(engine, tmp_path)
    first = run_seal(engine, tmp_path, window_key=at.date().isoformat())
    old = manifest(tmp_path, first)
    assert [(p.status, p.rows) for p in old.processing] == [("observed", 3)]
    verify(engine, first)
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE core.feed_endpoints SET refresh_interval_seconds=60 WHERE provider_id=:p"),
            dict(p=PROVIDER),
        )
        conn.execute(
            text("DELETE FROM gold.fact_trip_delay_snapshot WHERE provider_id=:p"), dict(p=PROVIDER)
        )
    change_run(engine)
    second = run_seal(engine, tmp_path, window_key=at.date().isoformat())
    new = manifest(tmp_path, second)
    assert (second.content_version, new.supersedes) == (2, 1)
    assert new.processing == old.processing
    assert new.declared_interval_seconds == old.declared_interval_seconds == 30


def test_recorded_evidence_makes_the_day_sealed_again(engine, tmp_path):
    seed(engine, tmp_path, stored=1)
    first = run_seal(engine, tmp_path)
    verify(engine, first)
    completed = START + timedelta(days=14)
    with engine.begin() as conn:
        ledger.record_processing_evidence(
            conn,
            dataset_id="capture.trip_updates",
            provider_id=PROVIDER,
            window_key=DAY.isoformat(),
            command="replay",
            completed_at_utc=completed,
            rows_by_capture={771001: 100},
        )
        assert (
            rows_fingerprint(conn, provider_id=PROVIDER, endpoint_key="trip_updates", utc_date=DAY)
            == first.details["rows_fingerprint"]
        )
    second = run_seal(engine, tmp_path)
    (outcome,) = manifest(tmp_path, second).processing
    assert (second.content_version, outcome.status, outcome.rows, outcome.attribution) == (
        2,
        "observed",
        100,
        "recorded",
    )
    assert outcome.completed_at_utc == completed


def test_empty_window_that_gains_a_poll_is_present_again(engine, tmp_path):
    first = run_seal(engine, tmp_path)
    verify(engine, first)
    seed(engine, tmp_path, stored=1)
    second = run_seal(engine, tmp_path)
    assert (second.content_version, second.poll_count) == (2, 1)
    with engine.begin() as conn:
        assert state(conn).working_state == "present"


@pytest.mark.parametrize("remove_poll", [False, True])
def test_day_that_lost_rows_of_its_copy_is_refused(engine, tmp_path, remove_poll):
    seed(engine, tmp_path, stored=1)
    first = run_seal(engine, tmp_path)
    verify(engine, first)
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM raw.realtime_snapshot_index WHERE provider_id=:p"), dict(p=PROVIDER)
        )
        if remove_poll:
            for table in ("raw.ingestion_objects", "raw.ingestion_runs"):
                conn.execute(text(f"DELETE FROM {table} WHERE provider_id=:p"), dict(p=PROVIDER))
    before = archive_state(engine, tmp_path)
    with pytest.raises(ValueError, match="771001") as error:
        run_seal(engine, tmp_path)
    from transit_ops.history.seal_captures import CopyContentMissing

    assert type(error.value) is CopyContentMissing
    assert f"{PROVIDER}/trip_updates/{DAY}" in str(error.value)
    assert ("poll" if remove_poll else "realtime_snapshot") in str(error.value)
    assert archive_state(engine, tmp_path) == before


@pytest.mark.parametrize("working_state", ["partial", "trimmed"])
def test_trimmed_or_partly_trimmed_day_is_refused(engine, tmp_path, working_state):
    first = run_seal(engine, tmp_path)
    verify(engine, first)
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE core.history_window SET working_state=:s WHERE provider_id=:p"),
            dict(p=PROVIDER, s=working_state),
        )
    before = archive_state(engine, tmp_path)
    with pytest.raises(NotImplementedError, match="working rows were trimmed"):
        run_seal(engine, tmp_path)
    assert archive_state(engine, tmp_path) == before
