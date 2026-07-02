"""Real-DB coverage for the GC2 H1 scheduled universe + H2 busiest-day fix.

Runs only against a disposable Postgres migrated to head (0073+):

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://postgres@127.0.0.1:55437/transit_gc2" \
        uv run pytest tests/test_scheduled_universe_real_db.py -v

H1 (UPSERT_ROUTE_SCHEDULED_TRIPS_DAILY): the canonical GTFS service-on-date rule
resolves calendar ∩ calendar_dates for a target closed date across four feed shapes:
normal weekly calendar; an added exception (type=1) making a service run on a date the
weekly pattern excludes; a removed exception (type=2) suppressing a normally-active
service; and a CALENDAR_DATES-ONLY feed (empty silver.calendar) where only type=1
exceptions define service.

H2 (_representative_services): honors calendar_dates on a calendar_dates-only fixture
and respects a type=2 removal on the would-be busiest date.
"""

from __future__ import annotations

import os
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import create_engine, text

from transit_ops.gold.rollups import (
    UPSERT_ROUTE_CANCELLATION_DAILY,
    UPSERT_ROUTE_SCHEDULED_TRIPS_DAILY,
)
from transit_ops.snapshots.builders._helpers import _representative_services
from transit_ops.snapshots.builders.historic.network_trend import _TREND_CANCELLATION_SQL
from transit_ops.snapshots.builders.historic.route_reliability import (
    _ROUTE_CANCELLATION_DAILY_SQL,
)

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set - scheduled-universe real-DB tests skipped",
)

PROVIDER = "stm_sched_test"
STATIC_ENDPOINT_ID = 993001
STATIC_RUN_ID = 993101
DVID = 993201
# 2026-06-15 is a Monday (isodow=1).
MONDAY = date(2026, 6, 15)
TUESDAY = date(2026, 6, 16)
SATURDAY = date(2026, 6, 20)


def _seed_provider_edition(connection, *, with_calendar: bool) -> None:  # noqa: ANN001
    connection.execute(
        text(
            "INSERT INTO core.providers (provider_id, display_name, timezone, provider_key) "
            "VALUES (:p, 'STM sched test', 'America/Toronto', :p)"
        ),
        {"p": PROVIDER},
    )
    connection.execute(
        text(
            "INSERT INTO core.feed_endpoints "
            "(feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format) "
            "VALUES (:e, :p, 'static_schedule', 'static_schedule', 'gtfs_schedule_zip')"
        ),
        {"e": STATIC_ENDPOINT_ID, "p": PROVIDER},
    )
    connection.execute(
        text(
            "INSERT INTO raw.ingestion_runs "
            "(ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status) "
            "VALUES (:r, :p, :e, 'static_schedule', 'succeeded')"
        ),
        {"r": STATIC_RUN_ID, "p": PROVIDER, "e": STATIC_ENDPOINT_ID},
    )
    connection.execute(
        text(
            "INSERT INTO core.dataset_versions "
            "(dataset_version_id, provider_id, feed_endpoint_id, source_ingestion_run_id, "
            " dataset_kind, content_hash, is_current) "
            "VALUES (:d, :p, :e, :r, 'static_schedule', 'sched-test-hash', true)"
        ),
        {"d": DVID, "p": PROVIDER, "e": STATIC_ENDPOINT_ID, "r": STATIC_RUN_ID},
    )
    connection.execute(
        text(
            "INSERT INTO silver.routes "
            "(dataset_version_id, provider_id, route_id, route_short_name, route_type) "
            "VALUES (:d, :p, 'R1', 'R1', 3)"
        ),
        {"d": DVID, "p": PROVIDER},
    )


def _add_calendar(connection, service_id: str, *, weekdays: bool, saturday: bool) -> None:  # noqa: ANN001, FBT001
    connection.execute(
        text(
            "INSERT INTO silver.calendar "
            "(dataset_version_id, provider_id, service_id, monday, tuesday, wednesday, "
            " thursday, friday, saturday, sunday, start_date, end_date) "
            "VALUES (:d, :p, :s, :wd, :wd, :wd, :wd, :wd, :sat, false, "
            " DATE '2026-06-01', DATE '2026-06-30')"
        ),
        {"d": DVID, "p": PROVIDER, "s": service_id, "wd": weekdays, "sat": saturday},
    )


def _add_exception(connection, service_id: str, service_date: date, exc: int) -> None:  # noqa: ANN001
    connection.execute(
        text(
            "INSERT INTO silver.calendar_dates "
            "(dataset_version_id, provider_id, service_id, service_date, exception_type) "
            "VALUES (:d, :p, :s, :dt, :exc)"
        ),
        {"d": DVID, "p": PROVIDER, "s": service_id, "dt": service_date, "exc": exc},
    )


def _add_trips(connection, service_id: str, trip_ids: list[str]) -> None:  # noqa: ANN001
    for tid in trip_ids:
        connection.execute(
            text(
                "INSERT INTO silver.trips "
                "(dataset_version_id, provider_id, trip_id, route_id, service_id, direction_id) "
                "VALUES (:d, :p, :t, 'R1', :s, 0)"
            ),
            {"d": DVID, "p": PROVIDER, "t": tid, "s": service_id},
        )


def _run_scheduled(connection, target: date) -> int | None:  # noqa: ANN001
    connection.execute(
        UPSERT_ROUTE_SCHEDULED_TRIPS_DAILY,
        {"provider_id": PROVIDER, "local_date": target, "date_key": None,
         "built_at_utc": datetime(2026, 6, 16, tzinfo=UTC)},
    )
    return connection.execute(
        text(
            "SELECT scheduled_trip_count FROM gold.route_scheduled_trips_daily "
            "WHERE provider_id = :p AND provider_local_date = :dt AND route_id = 'R1'"
        ),
        {"p": PROVIDER, "dt": target},
    ).scalar()


def _tx():  # noqa: ANN202
    engine = create_engine(DB_URL)
    connection = engine.connect()
    tx = connection.begin()
    return engine, connection, tx


def test_scheduled_normal_weekly_calendar() -> None:
    engine, conn, tx = _tx()
    try:
        _seed_provider_edition(conn, with_calendar=True)
        _add_calendar(conn, "weekday", weekdays=True, saturday=False)
        _add_trips(conn, "weekday", ["t1", "t2", "t3"])
        # Monday: weekday service runs -> 3 scheduled trips.
        assert _run_scheduled(conn, MONDAY) == 3
        # Saturday: weekday service does NOT run -> no row -> None.
        assert _run_scheduled(conn, SATURDAY) is None
    finally:
        tx.rollback()
        conn.close()
        engine.dispose()


def test_scheduled_added_exception_type1() -> None:
    engine, conn, tx = _tx()
    try:
        _seed_provider_edition(conn, with_calendar=True)
        # weekday-only service; Saturday normally excluded by the weekly pattern.
        _add_calendar(conn, "weekday", weekdays=True, saturday=False)
        _add_trips(conn, "weekday", ["t1", "t2"])
        # type=1 ADD on Saturday -> service active that date despite the weekly pattern.
        _add_exception(conn, "weekday", SATURDAY, 1)
        assert _run_scheduled(conn, SATURDAY) == 2
    finally:
        tx.rollback()
        conn.close()
        engine.dispose()


def test_scheduled_removed_exception_type2() -> None:
    engine, conn, tx = _tx()
    try:
        _seed_provider_edition(conn, with_calendar=True)
        _add_calendar(conn, "weekday", weekdays=True, saturday=False)
        _add_trips(conn, "weekday", ["t1", "t2", "t3"])
        # type=2 REMOVE on Monday -> service suppressed that date -> no scheduled trips.
        _add_exception(conn, "weekday", MONDAY, 2)
        assert _run_scheduled(conn, MONDAY) is None
        # Tuesday unaffected -> still 3.
        assert _run_scheduled(conn, TUESDAY) == 3
    finally:
        tx.rollback()
        conn.close()
        engine.dispose()


def test_scheduled_calendar_dates_only_feed() -> None:
    engine, conn, tx = _tx()
    try:
        _seed_provider_edition(conn, with_calendar=False)
        # NO silver.calendar rows; service defined purely by type=1 exceptions.
        _add_trips(conn, "holiday", ["h1", "h2", "h3", "h4"])
        _add_exception(conn, "holiday", MONDAY, 1)
        # The OR branch fires with zero calendar rows -> non-empty scheduled_trip_count.
        assert _run_scheduled(conn, MONDAY) == 4
        # A date with no type=1 exception -> no service -> None.
        assert _run_scheduled(conn, TUESDAY) is None
    finally:
        tx.rollback()
        conn.close()
        engine.dispose()


RT_ENDPOINT_ID = 993002
RT_RUN_ID = 993102


def _seed_fact_trip_days(connection, target: date, canceled: int, delivered: int) -> None:  # noqa: ANN001
    """Insert (delivered + canceled) distinct RT-observed trip-days for R1 on target."""
    connection.execute(
        text(
            "INSERT INTO core.feed_endpoints "
            "(feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format) "
            "VALUES (:e, :p, 'trip_updates', 'trip_updates', 'gtfs_rt_trip_updates')"
        ),
        {"e": RT_ENDPOINT_ID, "p": PROVIDER},
    )
    connection.execute(
        text(
            "INSERT INTO raw.ingestion_runs "
            "(ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status) "
            "VALUES (:r, :p, :e, 'trip_updates', 'succeeded')"
        ),
        {"r": RT_RUN_ID, "p": PROVIDER, "e": RT_ENDPOINT_ID},
    )
    ts = datetime(target.year, target.month, target.day, 12, 0, tzinfo=UTC)
    connection.execute(
        text(
            "INSERT INTO raw.realtime_snapshot_index "
            "(realtime_snapshot_id, ingestion_run_id, provider_id, feed_endpoint_id, "
            " feed_timestamp_utc, entity_count, captured_at_utc) "
            "VALUES (:s, :r, :p, :e, :ts, :n, :ts)"
        ),
        {"s": 993301, "r": RT_RUN_ID, "p": PROVIDER, "e": RT_ENDPOINT_ID,
         "ts": ts, "n": canceled + delivered},
    )
    date_key = int(target.strftime("%Y%m%d"))
    idx = 0
    for i in range(canceled + delivered):
        rel = 3 if i < canceled else None  # first `canceled` are CANCELED
        connection.execute(
            text(
                """
                INSERT INTO gold.fact_trip_delay_snapshot
                    (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                     snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
                     trip_id, route_id, direction_id, start_date, vehicle_id,
                     trip_schedule_relationship, delay_seconds, stop_time_update_count,
                     delay_stop_id, delay_stop_sequence)
                VALUES (:p, :s, :ei, :dk, :sld, :ts, :ts, :entity, :trip, 'R1', 0,
                        :sld, NULL, :rel, 0, 0, NULL, NULL)
                """
            ),
            {"p": PROVIDER, "s": 993301, "ei": idx, "dk": date_key, "sld": target,
             "ts": ts, "entity": f"e{idx}", "trip": f"trip{idx}", "rel": rel},
        )
        idx += 1


def _run_cancellation(connection, target: date) -> dict:  # noqa: ANN001
    connection.execute(
        UPSERT_ROUTE_CANCELLATION_DAILY,
        {"provider_id": PROVIDER, "local_date": target,
         "date_key": int(target.strftime("%Y%m%d")),
         "built_at_utc": datetime(2026, 6, 16, tzinfo=UTC)},
    )
    return dict(
        connection.execute(
            text(
                "SELECT total_trip_days, canceled_trip_days, cancellation_rate_pct, "
                "scheduled_trip_days, delivered_trip_days, silent_trip_days "
                "FROM gold.route_cancellation_daily "
                "WHERE provider_id = :p AND provider_local_date = :dt AND route_id = 'R1'"
            ),
            {"p": PROVIDER, "dt": target},
        ).mappings().one()
    )


def test_cancellation_split_with_scheduled_universe() -> None:
    engine, conn, tx = _tx()
    try:
        _seed_provider_edition(conn, with_calendar=True)
        _add_calendar(conn, "weekday", weekdays=True, saturday=False)
        # 5 scheduled trips; RT observed 4 trip-days (1 canceled, 3 delivered).
        _add_trips(conn, "weekday", ["t1", "t2", "t3", "t4", "t5"])
        _seed_fact_trip_days(conn, MONDAY, canceled=1, delivered=3)
        # Build scheduled BEFORE cancellation (production order).
        assert _run_scheduled(conn, MONDAY) == 5
        row = _run_cancellation(conn, MONDAY)
        # Old RT-observed fields UNCHANGED: total=4, canceled=1, rate=25.00.
        assert row["total_trip_days"] == 4
        assert row["canceled_trip_days"] == 1
        assert float(row["cancellation_rate_pct"]) == 25.0
        # New split: delivered = total - canceled = 3; scheduled = 5;
        # silent = max(5 - 4, 0) = 1.
        assert row["scheduled_trip_days"] == 5
        assert row["delivered_trip_days"] == 3
        assert row["silent_trip_days"] == 1
    finally:
        tx.rollback()
        conn.close()
        engine.dispose()


def test_cancellation_split_null_when_no_scheduled() -> None:
    """No silver schedule for the date -> scheduled/silent NULL (honest-unknown),
    delivered still known, old RT fields unchanged."""
    engine, conn, tx = _tx()
    try:
        _seed_provider_edition(conn, with_calendar=True)
        # calendar exists but NO trips -> scheduled rollup yields no R1 row for the date.
        _add_calendar(conn, "weekday", weekdays=True, saturday=False)
        _seed_fact_trip_days(conn, MONDAY, canceled=1, delivered=3)
        _run_scheduled(conn, MONDAY)  # no scheduled row for R1
        row = _run_cancellation(conn, MONDAY)
        assert row["total_trip_days"] == 4
        assert row["canceled_trip_days"] == 1
        assert row["scheduled_trip_days"] is None
        assert row["silent_trip_days"] is None
        # delivered is ALWAYS known (total - canceled), independent of scheduled.
        assert row["delivered_trip_days"] == 3
    finally:
        tx.rollback()
        conn.close()
        engine.dispose()


def test_silent_clamped_at_zero_on_over_delivery() -> None:
    """RT reports MORE trip-days than scheduled (added/unscheduled service):
    silent clamps to 0, never negative; AND the read-time service_completeness_pct
    clamps to 100 (not 250) so the publish gate's 0-100 rate check never aborts (FIX-1)."""
    engine, conn, tx = _tx()
    try:
        _seed_provider_edition(conn, with_calendar=True)
        _add_calendar(conn, "weekday", weekdays=True, saturday=False)
        _add_trips(conn, "weekday", ["t1", "t2"])  # only 2 scheduled
        _seed_fact_trip_days(conn, MONDAY, canceled=0, delivered=5)  # 5 observed
        assert _run_scheduled(conn, MONDAY) == 2
        row = _run_cancellation(conn, MONDAY)
        assert row["scheduled_trip_days"] == 2
        assert row["silent_trip_days"] == 0  # max(2 - 5, 0)
        # FIX-1: the read query CLAMPS completeness at 100 — 5 delivered / 2 scheduled
        # = 250% raw, published as 100.0 (over-delivery reads as fully complete).
        read = conn.execute(
            _ROUTE_CANCELLATION_DAILY_SQL, {"provider_id": PROVIDER, "route_id": "R1"}
        ).mappings().one()
        assert float(read["service_completeness_pct"]) == 100.0
    finally:
        tx.rollback()
        conn.close()
        engine.dispose()


def _add_route(connection, route_id: str) -> None:  # noqa: ANN001
    connection.execute(
        text(
            "INSERT INTO silver.routes "
            "(dataset_version_id, provider_id, route_id, route_short_name, route_type) "
            "VALUES (:d, :p, :rid, :rid, 3)"
        ),
        {"d": DVID, "p": PROVIDER, "rid": route_id},
    )


def _add_trips_route(connection, service_id: str, route_id: str, trip_ids: list[str]) -> None:  # noqa: ANN001
    for tid in trip_ids:
        connection.execute(
            text(
                "INSERT INTO silver.trips "
                "(dataset_version_id, provider_id, trip_id, route_id, service_id, direction_id) "
                "VALUES (:d, :p, :t, :rid, :s, 0)"
            ),
            {"d": DVID, "p": PROVIDER, "t": tid, "rid": route_id, "s": service_id},
        )


def _seed_fact_trip_days_route(
    connection, target: date, route_id: str, canceled: int, delivered: int, *, base: int
) -> None:  # noqa: ANN001
    """Like _seed_fact_trip_days but for an arbitrary route_id; RT infra reused from base."""
    ts = datetime(target.year, target.month, target.day, 12, 0, tzinfo=UTC)
    date_key = int(target.strftime("%Y%m%d"))
    for i in range(canceled + delivered):
        rel = 3 if i < canceled else None
        connection.execute(
            text(
                """
                INSERT INTO gold.fact_trip_delay_snapshot
                    (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                     snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
                     trip_id, route_id, direction_id, start_date, vehicle_id,
                     trip_schedule_relationship, delay_seconds, stop_time_update_count,
                     delay_stop_id, delay_stop_sequence)
                VALUES (:p, :s, :ei, :dk, :sld, :ts, :ts, :entity, :trip, :rid, 0,
                        :sld, NULL, :rel, 0, 0, NULL, NULL)
                """
            ),
            {"p": PROVIDER, "s": 993301, "ei": base + i, "dk": date_key, "sld": target,
             "ts": ts, "entity": f"e{base + i}", "trip": f"{route_id}trip{i}", "rid": route_id,
             "rel": rel},
        )


def test_fully_dark_scheduled_day_emits_row_and_byte_parity() -> None:
    """FIX-4: a scheduled route with ZERO RT-observed trips emits a row (total=0,
    canceled=0, rate NULL, scheduled=N, delivered=0, silent=N); a route WITH RT
    observations on the same day is BYTE-UNCHANGED by the FULL-JOIN conversion."""
    engine, conn, tx = _tx()
    try:
        _seed_provider_edition(conn, with_calendar=True)
        _add_route(conn, "R2")  # dark route
        _add_calendar(conn, "weekday", weekdays=True, saturday=False)
        # R1: 5 scheduled + RT observed (1 canceled, 3 delivered) — the parity anchor.
        _add_trips(conn, "weekday", ["t1", "t2", "t3", "t4", "t5"])
        _seed_fact_trip_days(conn, MONDAY, canceled=1, delivered=3)
        # R2: 4 scheduled, NO RT observations at all (fully dark).
        _add_trips_route(conn, "weekday", "R2", ["u1", "u2", "u3", "u4"])
        assert _run_scheduled(conn, MONDAY) is not None  # builds BOTH routes' scheduled
        conn.execute(
            UPSERT_ROUTE_CANCELLATION_DAILY,
            {"provider_id": PROVIDER, "local_date": MONDAY,
             "date_key": int(MONDAY.strftime("%Y%m%d")),
             "built_at_utc": datetime(2026, 6, 16, tzinfo=UTC)},
        )
        rows = {
            r["route_id"]: dict(r)
            for r in conn.execute(
                text(
                    "SELECT route_id, total_trip_days, canceled_trip_days, "
                    "cancellation_rate_pct, scheduled_trip_days, delivered_trip_days, "
                    "silent_trip_days FROM gold.route_cancellation_daily "
                    "WHERE provider_id = :p AND provider_local_date = :dt"
                ),
                {"p": PROVIDER, "dt": MONDAY},
            ).mappings()
        }
        # R1 (had RT obs): byte-unchanged split — total=4, canceled=1, delivered=3, silent=1.
        assert rows["R1"]["total_trip_days"] == 4
        assert rows["R1"]["canceled_trip_days"] == 1
        assert float(rows["R1"]["cancellation_rate_pct"]) == 25.0
        assert rows["R1"]["scheduled_trip_days"] == 5
        assert rows["R1"]["delivered_trip_days"] == 3
        assert rows["R1"]["silent_trip_days"] == 1
        # R2 (fully dark): a row EXISTS with honest zeros + NULL rate.
        assert "R2" in rows, "fully-dark scheduled day must still emit a row (FIX-4)"
        assert rows["R2"]["total_trip_days"] == 0
        assert rows["R2"]["canceled_trip_days"] == 0
        assert rows["R2"]["cancellation_rate_pct"] is None  # no RT denominator -> honest-NULL
        assert rows["R2"]["scheduled_trip_days"] == 4
        assert rows["R2"]["delivered_trip_days"] == 0
        assert rows["R2"]["silent_trip_days"] == 4  # all scheduled trips silent
        # gate invariant: delivered + canceled == total (0+0==0); silent<=scheduled.
        assert (
            rows["R2"]["delivered_trip_days"] + rows["R2"]["canceled_trip_days"]
            == rows["R2"]["total_trip_days"]
        )
    finally:
        tx.rollback()
        conn.close()
        engine.dispose()


def test_trend_cancel_delivered_filters_null_scheduled() -> None:
    """FIX-2: the network-trend cancel SUM(delivered) is FILTERed to known-scheduled
    rows, so a route-day with NULL scheduled does NOT inflate Σdelivered."""
    engine, conn, tx = _tx()
    try:
        _seed_provider_edition(conn, with_calendar=True)
        _add_route(conn, "R2")
        _add_calendar(conn, "weekday", weekdays=True, saturday=False)
        # R1 scheduled (5 trips) + RT delivered 3. R2 has NO scheduled trips (calendar
        # exists but no R2 trips) yet RT delivered 2 -> its scheduled is NULL.
        _add_trips(conn, "weekday", ["t1", "t2", "t3", "t4", "t5"])
        _seed_fact_trip_days(conn, MONDAY, canceled=0, delivered=3)          # R1
        _seed_fact_trip_days_route(conn, MONDAY, "R2", canceled=0, delivered=2, base=500)
        _run_scheduled(conn, MONDAY)  # only R1 gets a scheduled row
        conn.execute(
            UPSERT_ROUTE_CANCELLATION_DAILY,
            {"provider_id": PROVIDER, "local_date": MONDAY,
             "date_key": int(MONDAY.strftime("%Y%m%d")),
             "built_at_utc": datetime(2026, 6, 16, tzinfo=UTC)},
        )
        row = conn.execute(
            _TREND_CANCELLATION_SQL, {"provider_id": PROVIDER}
        ).mappings().one()
        # scheduled = 5 (R1 only). delivered FILTERed to known-scheduled = 3 (R1 only),
        # NOT 5 (would be 3 + R2's 2 if the FILTER were missing).
        assert row["scheduled"] == 5
        assert row["delivered"] == 3
    finally:
        tx.rollback()
        conn.close()
        engine.dispose()


def test_representative_services_calendar_dates_only() -> None:
    engine, conn, tx = _tx()
    try:
        _seed_provider_edition(conn, with_calendar=False)
        _add_trips(conn, "holiday", ["h1", "h2"])
        # Busiest weekday must resolve from calendar_dates alone (empty silver.calendar).
        _add_exception(conn, "holiday", MONDAY, 1)
        weekday, weekend = _representative_services(
            conn, provider_id=PROVIDER, dataset_version_id=DVID
        )
        assert weekday == ["holiday"]
        assert weekend == []
    finally:
        tx.rollback()
        conn.close()
        engine.dispose()


def test_representative_services_honors_type2_removal() -> None:
    engine, conn, tx = _tx()
    try:
        _seed_provider_edition(conn, with_calendar=True)
        # Two weekday services; svc_big has more trips so it drives the busiest-date pick.
        _add_calendar(conn, "svc_big", weekdays=True, saturday=False)
        _add_calendar(conn, "svc_small", weekdays=True, saturday=False)
        _add_trips(conn, "svc_big", ["b1", "b2", "b3", "b4"])
        _add_trips(conn, "svc_small", ["s1"])
        # Remove svc_big from EVERY weekday in the resolution window so the active-service
        # set on the busiest weekday never contains it (type=2 honored end-to-end).
        for day in range(1, 31):
            _add_exception(conn, "svc_big", date(2026, 6, day), 2)
        weekday, _weekend = _representative_services(
            conn, provider_id=PROVIDER, dataset_version_id=DVID
        )
        assert "svc_big" not in weekday
        assert "svc_small" in weekday
    finally:
        tx.rollback()
        conn.close()
        engine.dispose()
