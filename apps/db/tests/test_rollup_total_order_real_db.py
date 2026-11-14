from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta

import pytest
import real_db_seed as seed
from sqlalchemy import text

from transit_ops.gold.rollups import build_warm_rollups
from transit_ops.settings import Settings

PROVIDER = "rollup_order_test"
STAMP = datetime(2026, 6, 18, 16, tzinfo=UTC)
DAY = date(2026, 6, 16)


class TransactionEngine:
    def __init__(self, conn):
        self.conn = conn

    @contextmanager
    def begin(self):
        yield self.conn


@pytest.fixture
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection, connection.begin() as transaction:
        seed_provider(connection, PROVIDER, display_name="Rollup order test")
        seed.feed_endpoints(connection, {"p": PROVIDER, "e": 987001})
        # Service-span materialization lags a capture day.
        observe(connection, 987090, "next-day", 0, minute=1440, route="context")
        collation = connection.execute(
            text("SELECT datcollate FROM pg_database WHERE datname = current_database()")
        ).scalar_one()
        print(f"CI database collation: {collation}")
        try:
            yield connection
        finally:
            transaction.rollback()


def observe(conn, sid, trip, delay, *, minute=0, entity=0, route="span"):
    stamp = datetime(2026, 6, 16, 14, tzinfo=UTC) + timedelta(minutes=minute)
    params = {"p": PROVIDER, "e": 987001, "r": sid, "s": sid, "ts": stamp, "n": 1}
    seed.ingestion_runs(conn, params)
    seed.realtime_snapshot_index(conn, params)
    conn.execute(
        text(
            "INSERT INTO gold.fact_trip_delay_snapshot "
            "(provider_id, realtime_snapshot_id, entity_index, snapshot_date_key, "
            "snapshot_local_date, captured_at_utc, feed_timestamp_utc, "
            "entity_id, trip_id, route_id, "
            "direction_id, start_date, delay_seconds, stop_time_update_count) "
            "VALUES (:p, :s, :entity, :date_key, :capture_day, :ts, :ts, :trip, :trip, :route, "
            "0, :day, :delay, 1)"
        ),
        {
            **params,
            "entity": entity,
            "day": DAY,
            "trip": trip,
            "route": route,
            "delay": delay,
            "date_key": int(stamp.strftime("%Y%m%d")),
            "capture_day": stamp.date(),
        },
    )


def build(conn):
    build_warm_rollups(
        PROVIDER,
        engine=TransactionEngine(conn),
        settings=Settings.model_construct(DATABASE_URL=None),
        as_of_utc=STAMP,
    )


def span(conn):
    return conn.execute(
        text(
            "SELECT first_trip_delay_seconds, last_trip_delay_seconds, trip_count "
            "FROM gold.route_service_span_daily "
            "WHERE provider_id = :p AND provider_local_date = :day AND route_id = 'span'"
        ),
        {"p": PROVIDER, "day": DAY},
    ).one()


@pytest.mark.parametrize("reverse", [False, True])
@pytest.mark.parametrize("first_delay", [0, None])
@pytest.mark.parametrize(
    "trips, terminal_delay",
    [
        ([("10", 10), ("9", 90), ("B", 20), ("_", 30), ("a", 40), ("é", 50)], 10),
        ([("B", 20), ("a", 40)], 20),
        ([("_", 30), ("a", 40)], 30),
        ([("a", 40), ("é", 50)], 40),
    ],
)
def test_service_span_uses_binary_trip_order_after_old_keys_tie(
    conn, reverse, first_delay, trips, terminal_delay
):
    # Terminal delays expose which trip won; all original ranking keys tie.
    trips = list(trips)
    if reverse:
        trips.reverse()
    for index, (trip, terminal) in enumerate(trips):
        observe(conn, 987100 + index * 2, trip, first_delay)
        observe(conn, 987101 + index * 2, trip, terminal, minute=10)
    build(conn)
    assert tuple(span(conn)) == (first_delay, terminal_delay, len(trips))


@pytest.mark.parametrize("reverse", [False, True])
def test_service_span_observation_order_finishes_with_snapshot_identity(conn, reverse):
    rows = [(987200, 20), (987201, 90)]
    if reverse:
        rows.reverse()
    for sid, delay in rows:
        observe(conn, sid, "same-trip", delay)
    build(conn)
    assert tuple(span(conn)) == (20, 90, 1)


def test_headway_tied_trip_starts_keep_the_positive_gap_sample(conn):
    for index, trip in enumerate(["é", "a", "_", "B", "9", "10"]):
        observe(conn, 987300 + index, trip, 0, route="headway")
    observe(conn, 987310, "later", 0, minute=10, route="headway")
    build(conn)
    for table in ("route_headway_by_shift", "route_headway_by_direction_shift"):
        rows = conn.execute(
            text(
                f"SELECT observed_headway_min, sample_count FROM gold.{table} "
                "WHERE provider_id = :p AND route_id = 'headway'"
            ),
            {"p": PROVIDER},
        ).all()
        assert [tuple(row) for row in rows] == [(10, 1)]
    rows = conn.execute(
        text(
            "SELECT trip_count, gap_count, sum_gap_min, gap_histogram "
            "FROM gold.route_headway_shift_daily "
            "WHERE provider_id = :p AND route_id = 'headway' AND provider_local_date = :day"
        ),
        {"p": PROVIDER, "day": DAY},
    ).all()
    assert [tuple(row) for row in rows] == [
        (7, 1, 10, [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    ]


@pytest.mark.parametrize("reverse", [False, True])
def test_equal_load_stamps_choose_the_larger_edition_id(conn, reverse):
    observe(conn, 987400, "observed", 0)
    editions = [987410, 987411]
    if reverse:
        editions.reverse()
    for edition in editions:
        params = {"p": PROVIDER, "e": 987001, "r": 987400, "d": edition, "ts": STAMP}
        seed.dataset_versions(conn, params, content_hash="CAST(:d AS text)", loaded_at_utc=":ts")
        conn.execute(
            text(
                "INSERT INTO silver.calendar_dates "
                "(dataset_version_id, provider_id, service_id, service_date, exception_type) "
                "VALUES (:d, :p, 'service', :day, 1)"
            ),
            {**params, "day": DAY},
        )
        conn.execute(
            text(
                "INSERT INTO silver.trips "
                "(dataset_version_id, provider_id, trip_id, route_id, service_id) "
                "VALUES (:d, :p, 'trip', CAST(:d AS text), 'service')"
            ),
            params,
        )
    build(conn)
    rows = conn.execute(
        text(
            "SELECT route_id, dataset_version_id, scheduled_trip_count "
            "FROM gold.route_scheduled_trips_daily "
            "WHERE provider_id = :p AND provider_local_date = :day"
        ),
        {"p": PROVIDER, "day": DAY},
    ).all()
    assert [tuple(row) for row in rows] == [("987411", 987411, 1)]
