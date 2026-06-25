"""Real-database regression for gold.route_delay_spine (S7-B PR1 Task 2).

Runs ONLY against a disposable Postgres database migrated to head (incl. 0063);
self-skips when TRANSIT_TEST_DATABASE_URL is unset, so the offline gate stays green:

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://postgres@127.0.0.1:54329/transit_test" \
        uv run pytest tests/test_route_delay_spine_real_db_regression.py -v

Exercises what the FakeConnection unit tests cannot (they do not execute SQL): that the
builder computes the EXACT count columns from the live delay_seconds predicates (NOT from
histogram bins), bins the histogram correctly, splits direction, accrues only closed days,
and is watermark-idempotent. The seed is a hand-computed oracle (see the per-test comments).
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, text

from transit_ops.gold import rollups
from transit_ops.settings import Settings

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set - spine real-DB regression skipped",
)

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
def conn():
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        _seed(connection)
        _build(connection)
        try:
            yield connection
        finally:
            transaction.rollback()
        engine.dispose()


def _seed(connection) -> None:  # noqa: ANN001
    cld = _closed_local_date()
    connection.execute(
        text(
            "INSERT INTO core.providers (provider_id, display_name, timezone, provider_key) "
            "VALUES (:p, 'STM spine regression', 'America/Toronto', :p)"
        ),
        {"p": PROVIDER},
    )
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
    # hour 8, dir 0: 14 in-clamp delays + a 7200 ghost (ABS>3600) + a NULL.
    dir0_h8 = [-3600, -120, -61, -60, -30, 0, 59, 60, 61, 200, 299, 301, 1800, 3599, 7200, None]
    dir1_h8 = [0, 60]            # second direction, same hour
    dir0_h9 = [60, 60, 90]      # for the additivity property
    _insert_rows(connection, cld, 997101, 997201, h8,
                 [(d, 0) for d in dir0_h8] + [(d, 1) for d in dir1_h8])
    _insert_rows(connection, cld, 997102, 997202, h9, [(d, 0) for d in dir0_h9])

    # An OPEN (today) row that must NOT be built (closed-day watermark).
    today = datetime.now(TORONTO).replace(hour=8, minute=0, second=0, microsecond=0)
    _insert_rows(connection, today.date(), 997103, 997203,
                 today.astimezone(UTC), [(100, 0)])


def _insert_rows(connection, local_date, snapshot_id, run_id, captured_at, rows) -> None:  # noqa: ANN001
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
        {"s": snapshot_id, "r": run_id, "p": PROVIDER, "e": ENDPOINT_ID,
         "ts": captured_at, "n": len(rows)},
    )
    date_key = int(local_date.strftime("%Y%m%d"))
    for idx, (delay, direction) in enumerate(rows):
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
            {"p": PROVIDER, "s": snapshot_id, "ei": idx, "dk": date_key, "sld": local_date,
             "ts": captured_at, "entity": f"e{snapshot_id}-{idx}", "trip": f"t{snapshot_id}-{idx}",
             "dir": direction, "delay": delay},
        )


def _spine_row(connection, hour, direction):  # noqa: ANN001
    return connection.execute(
        text(
            """
            SELECT observation_count, delay_observation_count, on_time_observation_count,
                   severe_delay_count, sum_delay_seconds, delay_histogram
            FROM gold.route_delay_spine
            WHERE provider_id = :p AND route_id = '99S'
              AND hour_of_day_local = :h AND direction_id = :d
            """
        ),
        {"p": PROVIDER, "h": hour, "d": direction},
    ).mappings().one_or_none()


def test_spine_hour8_dir0_exact_counts_and_histogram(conn) -> None:  # noqa: ANN001
    r = _spine_row(conn, 8, 0)
    assert r is not None
    # observation_count = every fact row in the grain: 14 in-clamp + ghost(7200) + NULL.
    assert r["observation_count"] == 16
    # delay_observation_count = COUNT(delay_seconds): NULL excluded, ghost INCLUDED.
    assert r["delay_observation_count"] == 15
    # on-time = delays in [-60, 300): -60,-30,0,59,60,61,200,299.
    assert r["on_time_observation_count"] == 8
    # severe = delay > 300 AND ABS <= 3600: 301, 1800, 3599 (ghost 7200 excluded).
    assert r["severe_delay_count"] == 3
    # pooled, ghost-excluded: sum of the 14 in-clamp delays.
    assert r["sum_delay_seconds"] == 2508
    hist = list(r["delay_histogram"])
    assert len(hist) == 21
    # in-clamp only -> 14, NOT delay_observation_count(15) (the ghost has no bin).
    assert sum(hist) == 14
    assert hist[5] == 1   # bin 5 = [-60,-30): the -60
    assert hist[9] == 2   # bin 9 = [60,90): 60, 61
    assert hist[14] == 1  # bin 14 = [240,300): 299 (NOT severe)
    assert hist[15] == 1  # bin 15 = [300,420): 301 (severe shares the bin -> why severe is a count, not a bin sum)


def test_spine_direction_split_not_merged(conn) -> None:  # noqa: ANN001
    r0 = _spine_row(conn, 8, 0)
    r1 = _spine_row(conn, 8, 1)
    assert r1 is not None
    assert r1["observation_count"] == 2   # dir 1 is its OWN PK row
    assert r0["observation_count"] == 16  # not merged into dir 0


def test_spine_open_day_excluded(conn) -> None:  # noqa: ANN001
    today = datetime.now(TORONTO).date()
    n = conn.execute(
        text(
            "SELECT count(*) FROM gold.route_delay_spine "
            "WHERE provider_id = :p AND service_local_date = :d"
        ),
        {"p": PROVIDER, "d": today},
    ).scalar_one()
    assert n == 0  # the open (today) day is never built


def test_spine_histograms_are_additive_across_hours(conn) -> None:  # noqa: ANN001
    h8 = list(_spine_row(conn, 8, 0)["delay_histogram"])
    h9 = list(_spine_row(conn, 9, 0)["delay_histogram"])
    # hour 9 dir 0 = [60, 60, 90] -> bin 9 = 2, bin 10 = 1.
    assert h9[9] == 2 and h9[10] == 1
    assert sum(h9) == 3
    combined = [a + b for a, b in zip(h8, h9)]
    assert combined[9] == 4               # 2 (h8) + 2 (h9): bins re-merge by addition
    assert sum(combined) == sum(h8) + sum(h9) == 17


def test_spine_watermark_idempotent(conn) -> None:  # noqa: ANN001
    before = conn.execute(
        text("SELECT count(*) FROM gold.route_delay_spine WHERE provider_id = :p"),
        {"p": PROVIDER},
    ).scalar_one()
    _build(conn)  # re-run in the same transaction; the watermark must skip the closed day
    after = conn.execute(
        text("SELECT count(*) FROM gold.route_delay_spine WHERE provider_id = :p"),
        {"p": PROVIDER},
    ).scalar_one()
    assert after == before
    kinds = {
        k
        for (k,) in conn.execute(
            text(
                "SELECT DISTINCT rollup_kind FROM gold.warm_rollup_periods "
                "WHERE provider_id = :p"
            ),
            {"p": PROVIDER},
        )
    }
    assert "route_delay_spine" in kinds
