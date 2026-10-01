
from __future__ import annotations

from contextlib import contextmanager
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text

from transit_ops.gold import rollups
from transit_ops.settings import Settings

PROVIDER = "stm_spine_test"
ENDPOINT_ID = 997001
TORONTO = ZoneInfo("America/Toronto")


class _NoCommitEngine:
    def __init__(self, connection) -> None:  # noqa: ANN001
        self._connection = connection

    @contextmanager
    def begin(self):  # noqa: ANN201
        yield self._connection


def _closed_local_date():
    base = datetime.now(TORONTO).replace(hour=12, minute=0, second=0, microsecond=0)
    return (base - timedelta(days=1)).date()


def _build(connection) -> None:  # noqa: ANN001
    rollups.build_warm_rollups(
        PROVIDER,
        settings=Settings.model_construct(DATABASE_URL=None),
        engine=_NoCommitEngine(connection),
    )


@pytest.fixture()
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        _seed(connection, seed_provider)
        _build(connection)
        try:
            yield connection
        finally:
            transaction.rollback()


def _seed(connection, seed_provider) -> None:  # noqa: ANN001
    cld = _closed_local_date()
    seed_provider(connection, PROVIDER, display_name="STM spine regression")
    connection.execute(
        text(
            "INSERT INTO core.feed_endpoints "
            "(feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format) "
            "VALUES (:eid, :p, 'trip_updates', 'trip_updates', 'gtfs_rt_trip_updates')"
        ),
        {"eid": ENDPOINT_ID, "p": PROVIDER},
    )

    h8 = datetime.combine(cld, time(8, 0), tzinfo=TORONTO).astimezone(UTC)
    h9 = datetime.combine(cld, time(9, 0), tzinfo=TORONTO).astimezone(UTC)
    dir0_h8 = [-3600, -120, -61, -60, -30, 0, 59, 60, 61, 200, 299, 301, 1800, 3599, 7200, None]
    dir1_h8 = [0, 60]
    dir0_h9 = [60, 60, 90]
    _insert_rows(
        connection, cld, 997101, 997201, h8, [(d, 0) for d in dir0_h8] + [(d, 1) for d in dir1_h8]
    )
    _insert_rows(connection, cld, 997102, 997202, h9, [(d, 0) for d in dir0_h9])

    h10a = datetime.combine(cld, time(10, 1), tzinfo=TORONTO).astimezone(UTC)
    h10b = datetime.combine(cld, time(10, 7), tzinfo=TORONTO).astimezone(UTC)
    _insert_rows(
        connection,
        cld,
        997104,
        997204,
        h10a,
        [(60, 0), (120, 0), (7200, 0), (0, 0), (-30, 0), (60, 0)],
        trip_ids=["repeat", "repeat", "ghost", "zero", "negative", None],
    )
    _insert_rows(
        connection,
        cld,
        997105,
        997205,
        h10b,
        [(60, 0)],
        trip_ids=["repeat"],
    )

    today = datetime.now(TORONTO).replace(hour=8, minute=0, second=0, microsecond=0)
    _insert_rows(connection, today.date(), 997103, 997203, today.astimezone(UTC), [(100, 0)])


def _insert_rows(  # noqa: ANN001
    connection, local_date, snapshot_id, run_id, captured_at, rows, *, trip_ids=None
) -> None:
    connection.execute(
        text(
            "INSERT INTO raw.ingestion_runs "
            "(ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status) "
            "VALUES (:r, :p, :e, 'trip_updates', 'succeeded')"
        ),
        {"r": run_id, "p": PROVIDER, "e": ENDPOINT_ID},
    )
    connection.execute(
        text(
            "INSERT INTO raw.realtime_snapshot_index "
            "(realtime_snapshot_id, ingestion_run_id, provider_id, feed_endpoint_id, "
            " feed_timestamp_utc, entity_count, captured_at_utc) "
            "VALUES (:s, :r, :p, :e, :ts, :n, :ts)"
        ),
        {
            "s": snapshot_id,
            "r": run_id,
            "p": PROVIDER,
            "e": ENDPOINT_ID,
            "ts": captured_at,
            "n": len(rows),
        },
    )
    date_key = int(local_date.strftime("%Y%m%d"))
    for idx, (delay, direction) in enumerate(rows):
        trip_id = trip_ids[idx] if trip_ids is not None else f"t{snapshot_id}-{idx}"
        connection.execute(
            text(
                """
                INSERT INTO gold.fact_trip_delay_snapshot
                    (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                     snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
                     trip_id, route_id, direction_id, start_date, vehicle_id,
                     trip_schedule_relationship, delay_seconds, stop_time_update_count,
                     delay_stop_id, delay_stop_sequence)
                VALUES (:p, :s, :ei, :dk, :sld, :ts, :ts, :entity, :trip, '99S', :dir,
                        :sld, NULL, NULL, :delay, 0, NULL, NULL)
                """
            ),
            {
                "p": PROVIDER,
                "s": snapshot_id,
                "ei": idx,
                "dk": date_key,
                "sld": local_date,
                "ts": captured_at,
                "entity": f"e{snapshot_id}-{idx}",
                "trip": trip_id,
                "dir": direction,
                "delay": delay,
            },
        )


def _spine_row(connection, hour, direction):  # noqa: ANN001
    return (
        connection.execute(
            text(
                """
            SELECT observation_count, delay_observation_count, on_time_observation_count,
                   severe_delay_count, sum_delay_seconds, delay_histogram, delayed_trip_count
            FROM gold.route_delay_spine
            WHERE provider_id = :p AND route_id = '99S'
              AND hour_of_day_local = :h AND direction_id = :d
            """
            ),
            {"p": PROVIDER, "h": hour, "d": direction},
        )
        .mappings()
        .one_or_none()
    )


def test_spine_hour8_dir0_exact_counts_and_histogram(conn) -> None:  # noqa: ANN001
    r = _spine_row(conn, 8, 0)
    assert r is not None
    assert r["observation_count"] == 16
    assert r["delay_observation_count"] == 15
    assert r["on_time_observation_count"] == 8
    assert r["severe_delay_count"] == 3
    assert r["sum_delay_seconds"] == 2508
    hist = list(r["delay_histogram"])
    assert len(hist) == 21
    assert sum(hist) == 14
    assert hist[5] == 1
    assert hist[9] == 2
    assert hist[14] == 1
    assert (
        hist[15] == 1
    )


def test_spine_direction_split_not_merged(conn) -> None:  # noqa: ANN001
    r0 = _spine_row(conn, 8, 0)
    r1 = _spine_row(conn, 8, 1)
    assert r1 is not None
    assert r1["observation_count"] == 2
    assert r0["observation_count"] == 16


def test_spine_open_day_excluded(conn) -> None:  # noqa: ANN001
    today = datetime.now(TORONTO).date()
    n = conn.execute(
        text(
            "SELECT count(*) FROM gold.route_delay_spine "
            "WHERE provider_id = :p AND provider_local_date = :d"
        ),
        {"p": PROVIDER, "d": today},
    ).scalar_one()
    assert n == 0


def test_spine_histograms_are_additive_across_hours(conn) -> None:  # noqa: ANN001
    h8 = list(_spine_row(conn, 8, 0)["delay_histogram"])
    h9 = list(_spine_row(conn, 9, 0)["delay_histogram"])
    assert h9[9] == 2 and h9[10] == 1
    assert sum(h9) == 3
    combined = [a + b for a, b in zip(h8, h9, strict=False)]
    assert combined[9] == 4
    assert sum(combined) == sum(h8) + sum(h9) == 17


def test_spine_delayed_trips_are_distinct_per_5m_then_additive(conn) -> None:  # noqa: ANN001
    r = _spine_row(conn, 10, 0)
    assert r is not None
    assert r["delayed_trip_count"] == 3


def test_spine_plan_reads_the_closed_day_fact_slice_once(conn) -> None:  # noqa: ANN001
    cld = _closed_local_date()
    explain = text("EXPLAIN (FORMAT JSON)\n" + str(rollups.UPSERT_ROUTE_DELAY_SPINE))
    raw_plan = conn.execute(
        explain,
        {
            "provider_id": PROVIDER,
            "local_date": cld,
            "date_key": int(cld.strftime("%Y%m%d")),
            "built_at_utc": datetime.now(UTC),
        },
    ).scalar_one()

    def walk(node):  # noqa: ANN001, ANN202
        yield node
        for child in node.get("Plans", []):
            yield from walk(child)

    fact_nodes = [
        node
        for node in walk(raw_plan[0]["Plan"])
        if node.get("Relation Name") == "fact_trip_delay_snapshot"
    ]
    assert len(fact_nodes) == 1
    conditions = " ".join(
        str(fact_nodes[0].get(key, "")) for key in ("Index Cond", "Recheck Cond", "Filter")
    )
    assert "provider_id" in conditions
    assert "captured_at_utc >=" in conditions
    assert "captured_at_utc <" in conditions


def test_spine_watermark_idempotent(conn) -> None:  # noqa: ANN001
    before = conn.execute(
        text("SELECT count(*) FROM gold.route_delay_spine WHERE provider_id = :p"),
        {"p": PROVIDER},
    ).scalar_one()
    _build(conn)
    after = conn.execute(
        text("SELECT count(*) FROM gold.route_delay_spine WHERE provider_id = :p"),
        {"p": PROVIDER},
    ).scalar_one()
    assert after == before
    kinds = {
        k
        for (k,) in conn.execute(
            text(
                "SELECT DISTINCT rollup_kind FROM gold.warm_rollup_periods WHERE provider_id = :p"
            ),
            {"p": PROVIDER},
        )
    }
    assert "route_delay_spine" in kinds
