import hashlib
import re
from datetime import UTC, datetime, timedelta

import pytest
from history_fixtures import seed_working_day
from sqlalchemy import text

from transit_ops.history.datasets import UndeclaredDataset
from transit_ops.history.working_captures import rows_fingerprint

PROVIDER = "history_rows_fingerprint_test"
START = datetime(2026, 1, 2, tzinfo=UTC)
DAY = START.date()


@pytest.fixture
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        try:
            seed_provider(connection, PROVIDER, display_name="Rows fingerprint test")
            yield connection
        finally:
            transaction.rollback()


def seed(conn, endpoint="trip_updates", **kwargs):
    return seed_working_day(
        conn,
        provider_id=PROVIDER,
        endpoint_key=endpoint,
        started_at_utc=kwargs.pop("started_at_utc", START),
        **kwargs,
    )


def fingerprint(conn, endpoint="trip_updates", day=DAY):
    return rows_fingerprint(conn, provider_id=PROVIDER, endpoint_key=endpoint, utc_date=day)


def test_status_changed_in_place_changes_the_row_fingerprint(conn):
    for run_id in (1, 2, 3):
        seed(conn, run_id=run_id, capture_id=run_id)
    before = fingerprint(conn)
    assert re.fullmatch("[0-9a-f]{64}", before)
    conn.execute(
        text(
            "UPDATE raw.ingestion_runs SET status='failed', error_message='broken' "
            "WHERE ingestion_run_id=2"
        )
    )
    assert fingerprint(conn) != before
    conn.execute(
        text(
            "UPDATE raw.ingestion_runs SET status='succeeded', error_message=NULL "
            "WHERE ingestion_run_id=2"
        )
    )
    assert fingerprint(conn) == before


def test_every_part_of_the_day_counts(conn):
    seed(conn)
    before = fingerprint(conn)
    seed(conn, run_id=2, run_kind="silver_load", status="failed", with_capture=False)
    after_load = fingerprint(conn)
    assert after_load != before
    conn.execute(
        text("UPDATE raw.ingestion_objects SET checksum_sha256=:checksum WHERE ingestion_run_id=1"),
        dict(checksum="b" * 64),
    )
    after_object = fingerprint(conn)
    assert after_object != after_load
    conn.execute(
        text(
            "UPDATE raw.realtime_snapshot_index "
            "SET captured_at_utc=captured_at_utc + interval '1 microsecond' "
            "WHERE ingestion_run_id=1"
        )
    )
    assert fingerprint(conn) != after_object
    seed(conn, "i3_alerts", run_id=3, capture_id=3)
    before_alert = fingerprint(conn, "i3_alerts")
    conn.execute(
        text("UPDATE raw.i3_alert_snapshots SET api_version='v2' WHERE ingestion_run_id=3")
    )
    assert fingerprint(conn, "i3_alerts") != before_alert


def test_what_is_carried_does_not_count(conn):
    endpoint = seed(conn)
    before = fingerprint(conn)
    conn.execute(
        text(
            "INSERT INTO core.history_event "
            "(kind,dataset_id,provider_id,revision,window_key,actor) "
            "VALUES ('processing_evidence','capture.trip_updates',:p,0,:day,'test')"
        ),
        dict(p=PROVIDER, day=DAY.isoformat()),
    )
    assert fingerprint(conn) == before
    conn.execute(
        text(
            "UPDATE core.feed_endpoints SET refresh_interval_seconds=60 WHERE feed_endpoint_id=:e"
        ),
        dict(e=endpoint),
    )
    assert fingerprint(conn) == before


def test_rows_of_another_day_or_feed_do_not_count(conn):
    seed(conn)
    before = fingerprint(conn)
    seed(conn, run_id=2, capture_id=2, started_at_utc=START - timedelta(seconds=1))
    assert fingerprint(conn) == before
    seed(conn, "vehicle_positions", run_id=3, capture_id=3)
    assert fingerprint(conn) == before
    seed(conn, run_id=4, capture_id=4, started_at_utc=START + timedelta(days=1))
    assert fingerprint(conn) == before


def test_fingerprint_of_no_row_is_the_digest_of_nothing(conn):
    seed(conn, started_at_utc=START - timedelta(days=1))
    assert fingerprint(conn) == hashlib.sha256(b"").hexdigest()


@pytest.mark.parametrize("endpoint", ["trip_updates", "i3_alerts"])
def test_fingerprint_does_not_depend_on_the_session_time_zone(conn, endpoint):
    seed(conn, endpoint)
    before = fingerprint(conn, endpoint)
    conn.execute(text("SET LOCAL TimeZone = 'Asia/Tokyo'"))
    conn.execute(text("SET LOCAL DateStyle = 'SQL, DMY'"))
    assert fingerprint(conn, endpoint) == before


def test_undeclared_or_missing_feed_is_refused(conn):
    with pytest.raises(UndeclaredDataset):
        fingerprint(conn, "undeclared")
    with pytest.raises(LookupError, match="no feed endpoint"):
        fingerprint(conn)
    with pytest.raises(ValueError, match="utc_date must be a date"):
        fingerprint(conn, day=START)
