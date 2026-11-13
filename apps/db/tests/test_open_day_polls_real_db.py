from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from history_fixtures import seed_working_day
from sqlalchemy import text

from transit_ops.history.datasets import UndeclaredDataset
from transit_ops.history.reader import open_day_polls

PROVIDER = "history_open_day_test"


@pytest.fixture
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        try:
            seed_provider(connection, PROVIDER, display_name="Open day test")
            yield connection
        finally:
            transaction.rollback()


def seed(conn, at, endpoint="trip_updates", **kwargs):
    return seed_working_day(
        conn, provider_id=PROVIDER, endpoint_key=endpoint, started_at_utc=at, **kwargs
    )


def test_polls_since_a_time_in_reader_order(conn):
    now = conn.execute(text("SELECT now()")).scalar_one()
    since = now - timedelta(hours=2, minutes=30)
    for run, hours, feed in [
        (1, 3, "trip_updates"),
        (2, 2, "vehicle_positions"),
        (3, 2, "trip_updates"),
        (4, 1, "vehicle_positions"),
        (5, 2, "trip_updates"),
    ]:
        seed(conn, now - timedelta(hours=hours), feed, run_id=run, capture_id=run)
    seed(conn, since - timedelta(seconds=10), run_id=6, capture_id=6, captured_at_utc=since)
    seed(conn, now - timedelta(hours=1), run_id=7, run_kind="silver_load", with_capture=False)
    result = open_day_polls(PROVIDER, ["vehicle_positions", "trip_updates"], since, connection=conn)
    seed(conn, now - timedelta(minutes=1), run_id=8, capture_id=8)
    polls = list(result)
    assert [p.ingestion_run_id for p in polls] == [6, 3, 5, 2, 4]
    assert polls[0].time_utc == since
    assert polls[0].started_at_utc < since
    assert all(p.provider_id == PROVIDER and p.status == "stored" for p in polls)


def test_run_in_progress_reads_unfinished(conn):
    now = conn.execute(text("SELECT now()")).scalar_one()
    start = now - timedelta(minutes=5)
    seed(conn, start, status="running", with_capture=False)
    (poll,) = open_day_polls(PROVIDER, ["trip_updates"], start, connection=conn)
    assert (poll.status, poll.completed_at_utc, poll.time_utc) == ("unfinished", None, start)
    assert poll.capture_row_id is None


def test_more_than_thirty_hours_back_is_refused(conn):
    now = conn.execute(text("SELECT now()")).scalar_one()
    with pytest.raises(ValueError, match="open_window"):
        open_day_polls(
            PROVIDER, ["trip_updates"], now - timedelta(hours=30, seconds=1), connection=conn
        )
    with pytest.raises(ValueError):
        open_day_polls(PROVIDER, ["trip_updates"], now.replace(tzinfo=None), connection=conn)
    assert (
        list(open_day_polls(PROVIDER, ["trip_updates"], now - timedelta(hours=30), connection=conn))
        == []
    )


def test_no_object_and_no_ledger_row_is_read(conn):
    now = conn.execute(text("SELECT now()")).scalar_one()
    at = now - timedelta(minutes=5)
    seed(conn, at)
    seed(conn, at, "i3_alerts", run_id=2, capture_id=2)
    role = "open_day_reader_" + uuid4().hex
    conn.execute(text(f"CREATE ROLE {role}"))
    conn.execute(text(f"GRANT USAGE ON SCHEMA raw, core TO {role}"))
    conn.execute(
        text(
            "GRANT SELECT ON raw.ingestion_runs, raw.realtime_snapshot_index, "
            f"raw.i3_alert_snapshots, core.feed_endpoints TO {role}"
        )
    )
    conn.execute(text(f"SET LOCAL ROLE {role}"))
    polls = list(open_day_polls(PROVIDER, ["trip_updates", "i3_alerts"], at, connection=conn))
    assert [(p.endpoint_key, p.ingestion_run_id, p.status) for p in polls] == [
        ("i3_alerts", 2, "stored"),
        ("trip_updates", 1, "stored"),
    ]


def test_feed_without_an_endpoint_yields_nothing(conn):
    now = conn.execute(text("SELECT now()")).scalar_one()
    assert list(open_day_polls(PROVIDER, ["trip_updates"], now, connection=conn)) == []


@pytest.mark.parametrize(
    "provider,feeds,naive,error",
    [
        ("", ["trip_updates"], False, ValueError),
        (PROVIDER, [], False, ValueError),
        (PROVIDER, ["trip_updates", "trip_updates"], False, ValueError),
        (PROVIDER, ["trip_updates"], True, ValueError),
        (PROVIDER, ["unknown"], False, UndeclaredDataset),
    ],
)
def test_invalid_arguments_are_refused_before_sql(provider, feeds, naive, error):
    since = datetime(2026, 1, 2, tzinfo=None if naive else UTC)
    with pytest.raises(error):
        open_day_polls(provider, feeds, since, connection=None)
