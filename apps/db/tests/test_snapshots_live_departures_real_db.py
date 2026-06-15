"""Real-database regression tests for the live stop-departures builder (slice-9.1.1q).

These tests exercise the SQL semantics that fake-connection tests structurally
cannot see: the per-(stop, route) window partition over
``gold.current_stop_next_departures`` (0027), the ``stop_id IS NULL`` exclusion,
the view's own ``predicted_departure_utc >= now()`` past filter, and the 60-minute
ETA horizon on ``build_trips`` (slice-9.1.1q). They are the failing-first artifact
for the SQL — per the 9.1.1h lesson that offline-green code shipped a prod
incident.

They run ONLY when TRANSIT_TEST_DATABASE_URL points at a disposable Postgres with
the transit schema applied (a throwaway local cluster restored from
``pg_dump --schema-only -n core -n raw -n silver -n gold`` then
``alembic upgrade head`` so the 0018/0027 gold views exist). Each test runs inside
one transaction and rolls back — nothing persists, reruns are idempotent.

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://repro@:55432/transit_repro?host=/tmp/qrepro" \\
        uv run pytest tests/test_snapshots_live_departures_real_db.py -v

Never point this at production.
"""

from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text

from transit_ops.snapshots.builders import build_stop_departures, build_trips

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set — real-DB regression tests skipped",
)

# Explicit ids in the 99xxxx range so a botched rollback never collides with
# real data; a dedicated provider keeps every query scoped to the fixture rows.
PROVIDER = "stm_stopdep_test"
ENDPOINT_ID = 990014
RUN_ID = 990201
RAW_SNAP_ID = 990301  # raw.realtime_snapshot_index (FK target of source_realtime_snapshot_id)
RT_SNAP_ID = 990401  # silver.rt_feed_snapshots.rt_feed_snapshot_id


@pytest.fixture()
def conn():
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        _seed_parents(connection)
        try:
            yield connection
        finally:
            transaction.rollback()
        engine.dispose()


def _seed_parents(connection) -> None:
    """Seed the provider + ingestion + snapshot parent chain shared by all tests.

    Per-test trip/stop-time rows are inserted by each test so the SQL-side
    ``now()`` offsets stay close to query time (no clock-skew flakiness).
    """
    connection.execute(
        text(
            """
            INSERT INTO core.providers (provider_id, display_name, timezone, provider_key)
            VALUES (:p, 'STM stop-departures regression', 'America/Toronto', :p)
            """
        ),
        {"p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO core.feed_endpoints
                (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
            VALUES (:e, :p, 'trip_updates', 'trip_updates', 'gtfs_rt_trip_updates')
            """
        ),
        {"e": ENDPOINT_ID, "p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
            VALUES (:r, :p, :e, 'trip_updates', 'succeeded')
            """
        ),
        {"r": RUN_ID, "p": PROVIDER, "e": ENDPOINT_ID},
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.realtime_snapshot_index
                (realtime_snapshot_id, ingestion_run_id, provider_id,
                 feed_endpoint_id, feed_timestamp_utc)
            VALUES (:rs, :r, :p, :e, now())
            """
        ),
        {"rs": RAW_SNAP_ID, "r": RUN_ID, "p": PROVIDER, "e": ENDPOINT_ID},
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_feed_snapshots
                (rt_feed_snapshot_id, provider_id, feed_endpoint_id, ingestion_run_id,
                 endpoint_key, source_realtime_snapshot_id, captured_at_utc, loaded_at_utc)
            VALUES (:s, :p, :e, :r, 'trip_updates', :rs, now(), now())
            """
        ),
        {"s": RT_SNAP_ID, "p": PROVIDER, "e": ENDPOINT_ID, "r": RUN_ID, "rs": RAW_SNAP_ID},
    )


def _add_trip_update(connection, *, entity_index: int, trip_id: str, route_id: str) -> None:
    """Insert one rt_entity + rt_trip_update for the shared snapshot."""
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_entities
                (rt_feed_snapshot_id, entity_index, provider_id, entity_kind)
            VALUES (:s, :i, :p, 'trip_update')
            """
        ),
        {"s": RT_SNAP_ID, "i": entity_index, "p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_trip_updates
                (rt_feed_snapshot_id, entity_index, provider_id, trip_id, route_id, captured_at_utc)
            VALUES (:s, :i, :p, :trip, :route, now())
            """
        ),
        {"s": RT_SNAP_ID, "i": entity_index, "p": PROVIDER, "trip": trip_id, "route": route_id},
    )


def _stop(
    connection,
    *,
    entity_index: int,
    stu_index: int,
    stop_id: str | None,
    seq: int,
    mins: int,
) -> None:
    """Insert one rt_trip_update_stop_time at now()+mins (SQL-side now())."""
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_trip_update_stop_times
                (rt_feed_snapshot_id, entity_index, stop_time_update_index, provider_id,
                 stop_sequence, stop_id, departure_time_utc)
            VALUES (:s, :i, :sui, :p, :seq, :stop,
                    now() + make_interval(mins => :mins))
            """
        ),
        {
            "s": RT_SNAP_ID,
            "i": entity_index,
            "sui": stu_index,
            "p": PROVIDER,
            "seq": seq,
            "stop": stop_id,
            "mins": mins,
        },
    )


def _add_delay_snapshot(
    connection,
    *,
    entity_index: int,
    trip_id: str,
    route_id: str,
    direction_id: int,
    delay_seconds: int,
) -> None:
    """Insert one gold.latest_trip_delay_snapshot row — the source of
    gold.current_trip_delay_computed (which groups by realtime_snapshot_id,
    trip_id, route_id, direction_id). Two rows with the same trip_id but distinct
    direction_id therefore produce two delay rows for that trip, the exact case
    build_stop_departures' inner GROUP BY de-dups before the LEFT JOIN."""
    connection.execute(
        text(
            """
            INSERT INTO gold.latest_trip_delay_snapshot
                (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                 snapshot_local_date, feed_timestamp_utc, captured_at_utc,
                 trip_id, route_id, direction_id, start_date, delay_seconds,
                 stop_time_update_count)
            VALUES (:p, :rs, :i, to_char(now(), 'YYYYMMDD')::int,
                    now()::date, now(), now(),
                    :trip, :route, :dir, now()::date, :delay, 1)
            """
        ),
        {
            "p": PROVIDER,
            "rs": RAW_SNAP_ID,
            "i": entity_index,
            "trip": trip_id,
            "route": route_id,
            "dir": direction_id,
            "delay": delay_seconds,
        },
    )


def test_stop_departures_dedups_multi_direction_delay_rows(conn) -> None:
    """A trip appearing under two direction_id rows in
    gold.current_trip_delay_computed must NOT fan out the delay LEFT JOIN:
    build_stop_departures keeps exactly ONE departure per (stop, route) and reports
    the per-trip average delay (slice-9.1.1q dedup GROUP BY). Without the inner
    GROUP BY this stop would list the same departure twice and the route_rank cap
    would be corrupted — this is the failing-first artifact for that dedup."""
    # one route-A departure at S1
    _add_trip_update(conn, entity_index=0, trip_id="DD-trip", route_id="A")
    _stop(conn, entity_index=0, stu_index=0, stop_id="S1", seq=1, mins=5)
    # the SAME trip seen under two directions in the delay view (120s and 240s)
    _add_delay_snapshot(
        conn, entity_index=10, trip_id="DD-trip", route_id="A", direction_id=0, delay_seconds=120
    )
    _add_delay_snapshot(
        conn, entity_index=11, trip_id="DD-trip", route_id="A", direction_id=1, delay_seconds=240
    )

    out = build_stop_departures(conn, provider_id=PROVIDER, generated_utc="2026-06-10T12:00:00Z")

    deps = out.stops["S1"]
    assert len(deps) == 1  # NOT duplicated by the two delay rows
    assert deps[0].route == "A"
    assert deps[0].trip == "DD-trip"
    assert deps[0].delay_min == 3  # avg(120, 240) = 180s -> 3 min, per-trip (de-duped)


def test_stop_departures_caps_two_per_route_and_keeps_all_routes(conn) -> None:
    """At stop S1: route A at +5/+15/+25 and route B at +8 -> the file keeps
    A@+5, B@+8, A@+15 (chronological; cap 2 per route drops A@+25)."""
    # route A trip with three future stops at S1
    _add_trip_update(conn, entity_index=0, trip_id="A-trip", route_id="A")
    _stop(conn, entity_index=0, stu_index=0, stop_id="S1", seq=1, mins=5)
    _stop(conn, entity_index=0, stu_index=1, stop_id="S1", seq=2, mins=15)
    _stop(conn, entity_index=0, stu_index=2, stop_id="S1", seq=3, mins=25)
    # route B trip with one future stop at S1
    _add_trip_update(conn, entity_index=1, trip_id="B-trip", route_id="B")
    _stop(conn, entity_index=1, stu_index=0, stop_id="S1", seq=1, mins=8)

    out = build_stop_departures(conn, provider_id=PROVIDER, generated_utc="2026-06-10T12:00:00Z")

    deps = out.stops["S1"]
    assert [d.route for d in deps] == ["A", "B", "A"]  # chronological 5, 8, 15
    assert len(deps) == 3  # A@+25 dropped by the per-route cap of 2


def test_stop_departures_excludes_past_and_null_stop_ids(conn) -> None:
    """A departure in the past and one with a NULL stop_id must both be absent."""
    _add_trip_update(conn, entity_index=0, trip_id="C-trip", route_id="C")
    # past departure (view filters predicted_departure_utc >= now())
    _stop(conn, entity_index=0, stu_index=0, stop_id="S2", seq=1, mins=-10)
    # NULL stop_id (informational update; builder WHERE stop_id IS NOT NULL)
    _stop(conn, entity_index=0, stu_index=1, stop_id=None, seq=2, mins=12)

    out = build_stop_departures(conn, provider_id=PROVIDER, generated_utc="2026-06-10T12:00:00Z")

    assert "S2" not in out.stops  # past departure excluded
    # the NULL-stop row produced no key; nothing else seeded -> no stops at all
    assert out.stops == {}


def test_trips_sql_horizon_excludes_beyond_60_minutes(conn) -> None:
    """build_trips keeps only stops within the next 60 minutes (slice-9.1.1q)."""
    _add_trip_update(conn, entity_index=0, trip_id="D-trip", route_id="D")
    _stop(conn, entity_index=0, stu_index=0, stop_id="S3", seq=1, mins=10)
    _stop(conn, entity_index=0, stu_index=1, stop_id="S4", seq=2, mins=90)

    out = build_trips(conn, provider_id=PROVIDER, generated_utc="2026-06-10T12:00:00Z")

    trip = out.trips["D-trip"]
    assert [s.stop for s in trip.stops] == ["S3"]  # +90 min stop is beyond the horizon
