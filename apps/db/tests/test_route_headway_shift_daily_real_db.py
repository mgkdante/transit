"""Real-DB regression for the route_headway_shift_daily BUILDER (DB-PR-2, M1).

Seeds gold.fact_trip_delay_snapshot with staggered trip-starts -> runs build_warm_rollups ->
asserts the produced gold.route_headway_shift_daily row. This is the facts->builder->table
gate the diff-review proved was missing: without it, a 10x gap-unit bug or a broken clamp
passes the whole suite (the recompose tests direct-INSERT pre-computed rows). Mirrors
test_route_delay_spine_real_db_regression. Self-skips when TRANSIT_TEST_DATABASE_URL is unset.
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
    not DB_URL, reason="TRANSIT_TEST_DATABASE_URL not set - headway builder real-DB gate skipped"
)

PROVIDER = "stm_hw_builder"
ENDPOINT_ID = 998001
TORONTO = ZoneInfo("America/Toronto")


class _NoCommitEngine:
    def __init__(self, connection) -> None:  # noqa: ANN001
        self._connection = connection

    @contextmanager
    def begin(self):  # noqa: ANN201
        yield self._connection


def _recent_weekday(weekend: bool = False):  # noqa: ANN202
    d = (datetime.now(TORONTO) - timedelta(days=1)).date()
    want_weekend = weekend
    while (d.isoweekday() > 5) != want_weekend:
        d -= timedelta(days=1)
    return d


def _build(connection) -> None:  # noqa: ANN001
    rollups.build_warm_rollups(
        PROVIDER,
        settings=Settings.model_construct(DATABASE_URL=None),
        engine=_NoCommitEngine(connection),
    )


def _provider_and_endpoint(connection) -> None:  # noqa: ANN001
    connection.execute(
        text(
            "INSERT INTO core.providers (provider_id, display_name, timezone, provider_key) "
            "VALUES (:p, 'STM headway builder', 'America/Toronto', :p)"
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


def _insert_one_trip(connection, local_date, sid, rid, captured_at, trip_id, direction) -> None:  # noqa: ANN001
    # One snapshot carrying ONE trip's first (and only) observation -> MIN(captured_at) = its start.
    connection.execute(
        text(
            "INSERT INTO raw.ingestion_runs (ingestion_run_id, provider_id, feed_endpoint_id, "
            "run_kind, status) VALUES (:r, :p, :e, 'trip_updates', 'succeeded')"
        ),
        {"r": rid, "p": PROVIDER, "e": ENDPOINT_ID},
    )
    connection.execute(
        text(
            "INSERT INTO raw.realtime_snapshot_index (realtime_snapshot_id, ingestion_run_id, "
            "provider_id, feed_endpoint_id, feed_timestamp_utc, entity_count, captured_at_utc) "
            "VALUES (:s, :r, :p, :e, :ts, 1, :ts)"
        ),
        {"s": sid, "r": rid, "p": PROVIDER, "e": ENDPOINT_ID, "ts": captured_at},
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
            VALUES (:p, :s, 0, :dk, :sld, :ts, :ts, :entity, :trip, '99H', :dir,
                    :sld, NULL, NULL, 0, 0, NULL, NULL)
            """
        ),
        {"p": PROVIDER, "s": sid, "dk": int(local_date.strftime("%Y%m%d")), "sld": local_date,
         "ts": captured_at, "entity": f"e{sid}", "trip": trip_id, "dir": direction},
    )


def _seed_starts(connection, local_date, starts, direction=0, base=998100) -> None:  # noqa: ANN001
    for i, t in enumerate(starts):
        cap = datetime.combine(local_date, t, tzinfo=TORONTO).astimezone(UTC)
        _insert_one_trip(connection, local_date, base + i, base + 500 + i, cap, f"hw-{base}-{i}", direction)


def _headway_row(connection, shift="am_peak", direction=0):  # noqa: ANN001
    return connection.execute(
        text(
            "SELECT gap_count, sum_gap_min, sum_gap_sq_min, bunched_gap_count, trip_count, "
            "gap_histogram FROM gold.route_headway_shift_daily "
            "WHERE provider_id = :p AND route_id = '99H' AND shift = :sh AND direction_id = :d"
        ),
        {"p": PROVIDER, "sh": shift, "d": direction},
    ).mappings().one_or_none()


@contextmanager
def _conn():  # noqa: ANN202
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        tx = connection.begin()
        try:
            yield connection
        finally:
            tx.rollback()
        engine.dispose()


def test_builder_exact_moments_histogram_and_bunched() -> None:
    """4 trip-starts on a weekday am_peak (gaps 2,10,10 min) -> exact stored moments/histogram.
    Oracle: gap_count=3, Σgap=22, Σgap²=204, bunched=1 (gap<0.5*median(=10)), trip_count=4,
    histogram bin3 ([2,3))=1 + bin9 ([10,12))=2 (sum 3)."""
    cld = _recent_weekday()
    with _conn() as conn:
        _provider_and_endpoint(conn)
        _seed_starts(conn, cld, [time(7, 0), time(7, 2), time(7, 12), time(7, 22)])
        _build(conn)
        row = _headway_row(conn)
    assert row is not None, "builder produced NO headway row from staggered trip-starts"
    assert row["gap_count"] == 3
    assert float(row["sum_gap_min"]) == 22.0
    assert float(row["sum_gap_sq_min"]) == 204.0  # 2²+10²+10² = 4+100+100
    assert row["bunched_gap_count"] == 1
    assert row["trip_count"] == 4
    hist = list(row["gap_histogram"])
    assert sum(hist) == 3
    assert hist[3] == 1  # gap 2 -> [2,3)
    assert hist[9] == 2  # gap 10 -> [10,12)


def test_builder_clamp_drops_zero_and_over_240() -> None:
    """Gaps of 0 (identical starts) and >=240 min are clamped out; only 0<gap<240 survive."""
    cld = _recent_weekday()
    with _conn() as conn:
        _provider_and_endpoint(conn)
        # starts: 7:00, 7:00 (gap 0 -> dropped), 7:05 (gap 5 -> kept), 11:05 (gap 240 -> dropped)
        _seed_starts(conn, cld, [time(7, 0), time(7, 0), time(7, 5), time(11, 5)])
        _build(conn)
        row = _headway_row(conn)
    assert row is not None
    assert row["gap_count"] == 1  # only the 5-min gap survives the 0<gap<240 clamp
    assert float(row["sum_gap_min"]) == 5.0


def test_builder_weekday_guard_skips_weekend_service_day() -> None:
    """M2: a WEEKEND service day produces NO headway rows (the inner+outer ISODOW guards)."""
    sat = _recent_weekday(weekend=True)
    with _conn() as conn:
        _provider_and_endpoint(conn)
        _seed_starts(conn, sat, [time(7, 0), time(7, 6), time(7, 12)])
        _build(conn)
        row = _headway_row(conn)
    assert row is None, "weekend service-day gaps must NOT be built (weekday-only parity)"
