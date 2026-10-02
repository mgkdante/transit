
from __future__ import annotations

from contextlib import contextmanager
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import text

from transit_ops.gold import rollups
from transit_ops.settings import Settings

PROVIDER = "stm_stop_builder"
ENDPOINT_ID = 997001
TORONTO = ZoneInfo("America/Toronto")


class _NoCommitEngine:
    def __init__(self, connection) -> None:  # noqa: ANN001
        self._connection = connection

    @contextmanager
    def begin(self):  # noqa: ANN201
        yield self._connection


def _recent_weekday(weekend: bool = False):  # noqa: ANN202
    d = (datetime.now(TORONTO) - timedelta(days=1)).date()
    while (d.isoweekday() > 5) != weekend:
        d -= timedelta(days=1)
    return d


def _build(connection) -> None:  # noqa: ANN001
    rollups.build_warm_rollups(
        PROVIDER,
        settings=Settings.model_construct(DATABASE_URL=None),
        engine=_NoCommitEngine(connection),
    )


def _provider_and_endpoint(connection, seed_provider) -> None:  # noqa: ANN001
    seed_provider(connection, PROVIDER, display_name="STM stop builder")
    connection.execute(
        text(
            "INSERT INTO core.feed_endpoints "
            "(feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format) "
            "VALUES (:eid, :p, 'trip_updates', 'trip_updates', 'gtfs_rt_trip_updates')"
        ),
        {"eid": ENDPOINT_ID, "p": PROVIDER},
    )


def _seed_rows(connection, local_date, rows, base=997100) -> None:  # noqa: ANN001
    captured_at = datetime.combine(local_date, time(12, 0), tzinfo=TORONTO).astimezone(UTC)
    date_key = int(local_date.strftime("%Y%m%d"))
    for i, (stop_id, route_id, delay) in enumerate(rows):
        sid, run_id = base + i, base + 500 + i
        connection.execute(
            text(
                "INSERT INTO raw.ingestion_runs (ingestion_run_id, provider_id, feed_endpoint_id, "
                "run_kind, status) VALUES (:r, :p, :e, 'trip_updates', 'succeeded')"
            ),
            {"r": run_id, "p": PROVIDER, "e": ENDPOINT_ID},
        )
        connection.execute(
            text(
                "INSERT INTO raw.realtime_snapshot_index (realtime_snapshot_id, ingestion_run_id, "
                "provider_id, feed_endpoint_id, feed_timestamp_utc, entity_count, captured_at_utc) "
                "VALUES (:s, :r, :p, :e, :ts, 1, :ts)"
            ),
            {"s": sid, "r": run_id, "p": PROVIDER, "e": ENDPOINT_ID, "ts": captured_at},
        )
        connection.execute(
            text(
                """
                INSERT INTO gold.fact_trip_delay_snapshot
                    (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                     snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
                     trip_id, route_id, direction_id, start_date, vehicle_id,
                     trip_schedule_relationship, delay_seconds, stop_time_update_count,
                     delay_stop_id, delay_stop_sequence)
                VALUES (:p, :s, 0, :dk, :sld, :ts, :ts, :entity, :trip, :route, 0,
                        :sld, NULL, NULL, :delay, 0, :stop, NULL)
                """
            ),
            {
                "p": PROVIDER,
                "s": sid,
                "dk": date_key,
                "sld": local_date,
                "ts": captured_at,
                "entity": f"e{sid}",
                "trip": f"t{sid}",
                "route": route_id,
                "delay": delay,
                "stop": stop_id,
            },
        )


def _spine_row(connection, stop_id="S1", route_id="R1"):  # noqa: ANN001
    return (
        connection.execute(
            text(
                "SELECT observation_count, severe_delay_count, sum_delay_seconds "
                "FROM gold.stop_delay_spine "
                "WHERE provider_id = :p AND stop_id = :s AND route_id = :r"
            ),
            {"p": PROVIDER, "s": stop_id, "r": route_id},
        )
        .mappings()
        .one_or_none()
    )


@contextmanager
def _conn(real_db_engine):  # noqa: ANN202
    with real_db_engine.connect() as connection:
        tx = connection.begin()
        try:
            yield connection
        finally:
            tx.rollback()


def test_builder_boundary_oracle_counts_clamp_and_severe(real_db_engine, seed_provider) -> None:
    cld = _recent_weekday()
    rows = [("S1", "R1", d) for d in (300, 301, 3600, 3601, -60, -61, 299, None)]
    with _conn(real_db_engine) as conn:
        _provider_and_endpoint(conn, seed_provider)
        _seed_rows(conn, cld, rows)
        _build(conn)
        row = _spine_row(conn)
    assert row is not None, "builder produced NO stop-spine row from populated delay_stop_id facts"
    assert row["observation_count"] == 6
    assert row["severe_delay_count"] == 2
    assert int(row["sum_delay_seconds"]) == 4379


def test_builder_null_route_lands_under_unrouted_sentinel(real_db_engine, seed_provider) -> None:
    cld = _recent_weekday()
    rows = [("S1", "R1", 120), ("S1", None, 100)]
    with _conn(real_db_engine) as conn:
        _provider_and_endpoint(conn, seed_provider)
        _seed_rows(conn, cld, rows)
        _build(conn)
        routed = _spine_row(conn, "S1", "R1")
        unrouted = _spine_row(conn, "S1", "__unrouted__")
    assert routed is not None and routed["observation_count"] == 1
    assert unrouted is not None and unrouted["observation_count"] == 1
    assert int(unrouted["sum_delay_seconds"]) == 100


def test_builder_excludes_null_delay_stop_id(real_db_engine, seed_provider) -> None:
    cld = _recent_weekday()
    with _conn(real_db_engine) as conn:
        _provider_and_endpoint(conn, seed_provider)
        _seed_rows(conn, cld, [(None, "R1", 100), ("S1", "R1", 200)])
        _build(conn)
        null_rows = conn.execute(
            text(
                "SELECT count(*) FROM gold.stop_delay_spine "
                "WHERE provider_id=:p AND stop_id IS NULL"
            ),
            {"p": PROVIDER},
        ).scalar_one()
        s1 = _spine_row(conn)
    assert null_rows == 0, "a NULL delay_stop_id fact must NOT produce a spine row"
    assert s1 is not None and s1["observation_count"] == 1


def test_builder_is_all_days_weekend_produces_a_row(real_db_engine, seed_provider) -> None:
    sat = _recent_weekday(weekend=True)
    with _conn(real_db_engine) as conn:
        _provider_and_endpoint(conn, seed_provider)
        _seed_rows(conn, sat, [("S1", "R1", 120), ("S1", "R1", 480)])
        _build(conn)
        row = _spine_row(conn)
    assert row is not None, "weekend stop-delay rows MUST be built (all-days, no ISODOW filter)"
    assert row["observation_count"] == 2
    assert row["severe_delay_count"] == 1


def test_builder_idempotent_rebuild(real_db_engine, seed_provider) -> None:
    cld = _recent_weekday()
    rows = [("S1", "R1", 200), ("S1", "R1", 400)]
    with _conn(real_db_engine) as conn:
        _provider_and_endpoint(conn, seed_provider)
        _seed_rows(conn, cld, rows)
        _build(conn)
        first = _spine_row(conn)
        _build(
            conn
        )
        second = _spine_row(conn)
        watermarks = conn.execute(
            text(
                "SELECT count(*) FROM gold.warm_rollup_periods "
                "WHERE provider_id = :p AND rollup_kind = 'stop_delay_spine'"
            ),
            {"p": PROVIDER},
        ).scalar_one()
    assert first == second
    assert watermarks == 1
