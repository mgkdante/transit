
from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import text

from transit_ops.gold.rollups import (
    UPSERT_ROUTE_CANCELLATION_DAILY,
    UPSERT_ROUTE_SCHEDULED_TRIPS_DAILY,
)
from transit_ops.snapshots.builders._helpers import _representative_services
from transit_ops.snapshots.builders.historic.network_trend import _TREND_CANCELLATION_SQL
from transit_ops.snapshots.builders.historic.route_reliability import (
    _ROUTE_CANCELLATION_DAILY_SQL,
)

PROVIDER = "stm_sched_test"
STATIC_ENDPOINT_ID = 993001
STATIC_RUN_ID = 993101
DVID = 993201
MONDAY = date(2026, 6, 15)
TUESDAY = date(2026, 6, 16)
SATURDAY = date(2026, 6, 20)


def _seed_provider_edition(connection) -> None:  # noqa: ANN001
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


@pytest.fixture()
def conn(real_db_engine):  # noqa: ANN001
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        try:
            yield connection
        finally:
            transaction.rollback()


def test_scheduled_normal_weekly_calendar(conn) -> None:
    _seed_provider_edition(conn)
    _add_calendar(conn, "weekday", weekdays=True, saturday=False)
    _add_trips(conn, "weekday", ["t1", "t2", "t3"])
    assert _run_scheduled(conn, MONDAY) == 3
    assert _run_scheduled(conn, SATURDAY) is None


def test_scheduled_added_exception_type1(conn) -> None:
    _seed_provider_edition(conn)
    _add_calendar(conn, "weekday", weekdays=True, saturday=False)
    _add_trips(conn, "weekday", ["t1", "t2"])
    _add_exception(conn, "weekday", SATURDAY, 1)
    assert _run_scheduled(conn, SATURDAY) == 2


def test_scheduled_removed_exception_type2(conn) -> None:
    _seed_provider_edition(conn)
    _add_calendar(conn, "weekday", weekdays=True, saturday=False)
    _add_trips(conn, "weekday", ["t1", "t2", "t3"])
    _add_exception(conn, "weekday", MONDAY, 2)
    assert _run_scheduled(conn, MONDAY) is None
    assert _run_scheduled(conn, TUESDAY) == 3


def test_scheduled_calendar_dates_only_feed(conn) -> None:
    _seed_provider_edition(conn)
    _add_trips(conn, "holiday", ["h1", "h2", "h3", "h4"])
    _add_exception(conn, "holiday", MONDAY, 1)
    assert _run_scheduled(conn, MONDAY) == 4
    assert _run_scheduled(conn, TUESDAY) is None


RT_ENDPOINT_ID = 993002
RT_RUN_ID = 993102


def _seed_fact_trip_days(connection, target: date, canceled: int, delivered: int) -> None:  # noqa: ANN001
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


def test_cancellation_split_with_scheduled_universe(conn) -> None:
    _seed_provider_edition(conn)
    _add_calendar(conn, "weekday", weekdays=True, saturday=False)
    _add_trips(conn, "weekday", ["t1", "t2", "t3", "t4", "t5"])
    _seed_fact_trip_days(conn, MONDAY, canceled=1, delivered=3)
    assert _run_scheduled(conn, MONDAY) == 5
    row = _run_cancellation(conn, MONDAY)
    assert row["total_trip_days"] == 4
    assert row["canceled_trip_days"] == 1
    assert float(row["cancellation_rate_pct"]) == 25.0
    assert row["scheduled_trip_days"] == 5
    assert row["delivered_trip_days"] == 3
    assert row["silent_trip_days"] == 1


def test_cancellation_split_null_when_no_scheduled(conn) -> None:
    _seed_provider_edition(conn)
    _add_calendar(conn, "weekday", weekdays=True, saturday=False)
    _seed_fact_trip_days(conn, MONDAY, canceled=1, delivered=3)
    _run_scheduled(conn, MONDAY)
    row = _run_cancellation(conn, MONDAY)
    assert row["total_trip_days"] == 4
    assert row["canceled_trip_days"] == 1
    assert row["scheduled_trip_days"] is None
    assert row["silent_trip_days"] is None
    assert row["delivered_trip_days"] == 3


def test_silent_clamped_at_zero_on_over_delivery(conn) -> None:
    _seed_provider_edition(conn)
    _add_calendar(conn, "weekday", weekdays=True, saturday=False)
    _add_trips(conn, "weekday", ["t1", "t2"])
    _seed_fact_trip_days(conn, MONDAY, canceled=0, delivered=5)
    assert _run_scheduled(conn, MONDAY) == 2
    row = _run_cancellation(conn, MONDAY)
    assert row["scheduled_trip_days"] == 2
    assert row["silent_trip_days"] == 0
    read = conn.execute(
        _ROUTE_CANCELLATION_DAILY_SQL, {"provider_id": PROVIDER, "route_id": "R1"}
    ).mappings().one()
    assert float(read["service_completeness_pct"]) == 100.0


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


def test_fully_dark_scheduled_day_emits_row_and_byte_parity(conn) -> None:
    _seed_provider_edition(conn)
    _add_route(conn, "R2")
    _add_calendar(conn, "weekday", weekdays=True, saturday=False)
    _add_trips(conn, "weekday", ["t1", "t2", "t3", "t4", "t5"])
    _seed_fact_trip_days(conn, MONDAY, canceled=1, delivered=3)
    _add_trips_route(conn, "weekday", "R2", ["u1", "u2", "u3", "u4"])
    assert _run_scheduled(conn, MONDAY) is not None
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
    assert rows["R1"]["total_trip_days"] == 4
    assert rows["R1"]["canceled_trip_days"] == 1
    assert float(rows["R1"]["cancellation_rate_pct"]) == 25.0
    assert rows["R1"]["scheduled_trip_days"] == 5
    assert rows["R1"]["delivered_trip_days"] == 3
    assert rows["R1"]["silent_trip_days"] == 1
    assert "R2" in rows, "fully-dark scheduled day must still emit a row (FIX-4)"
    assert rows["R2"]["total_trip_days"] == 0
    assert rows["R2"]["canceled_trip_days"] == 0
    assert rows["R2"]["cancellation_rate_pct"] is None
    assert rows["R2"]["scheduled_trip_days"] == 4
    assert rows["R2"]["delivered_trip_days"] == 0
    assert rows["R2"]["silent_trip_days"] == 4
    assert (
        rows["R2"]["delivered_trip_days"] + rows["R2"]["canceled_trip_days"]
        == rows["R2"]["total_trip_days"]
    )


def _seed_capture_day_snapshot(
    connection,  # noqa: ANN001
    *,
    capture_day: date,
    hour: int,
    run_id: int,
    snapshot_id: int,
) -> datetime:
    connection.execute(
        text(
            "INSERT INTO core.feed_endpoints "
            "(feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format) "
            "VALUES (:e, :p, 'trip_updates', 'trip_updates', 'gtfs_rt_trip_updates') "
            "ON CONFLICT DO NOTHING"
        ),
        {"e": RT_ENDPOINT_ID, "p": PROVIDER},
    )
    connection.execute(
        text(
            "INSERT INTO raw.ingestion_runs "
            "(ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status) "
            "VALUES (:r, :p, :e, 'trip_updates', 'succeeded')"
        ),
        {"r": run_id, "p": PROVIDER, "e": RT_ENDPOINT_ID},
    )
    ts = datetime(capture_day.year, capture_day.month, capture_day.day, hour, 0, tzinfo=UTC)
    connection.execute(
        text(
            "INSERT INTO raw.realtime_snapshot_index "
            "(realtime_snapshot_id, ingestion_run_id, provider_id, feed_endpoint_id, "
            " feed_timestamp_utc, entity_count, captured_at_utc) "
            "VALUES (:s, :r, :p, :e, :ts, 50, :ts)"
        ),
        {"s": snapshot_id, "r": run_id, "p": PROVIDER, "e": RT_ENDPOINT_ID, "ts": ts},
    )
    return ts


def _seed_fact_on_snapshot(
    connection,  # noqa: ANN001
    *,
    trip_id: str,
    service_day: date,
    capture_day: date,
    snapshot_id: int,
    ts: datetime,
    entity_index: int,
    canceled: bool = False,
) -> None:
    connection.execute(
        text(
            """
            INSERT INTO gold.fact_trip_delay_snapshot
                (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                 snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
                 trip_id, route_id, direction_id, start_date, vehicle_id,
                 trip_schedule_relationship, delay_seconds, stop_time_update_count,
                 delay_stop_id, delay_stop_sequence)
            VALUES (:p, :s, :ei, :dk, :cld, :ts, :ts, :entity, :trip, 'R1', 0,
                    :svc, NULL, :rel, 0, 0, NULL, NULL)
            """
        ),
        {
            "p": PROVIDER,
            "s": snapshot_id,
            "ei": entity_index,
            "dk": int(capture_day.strftime("%Y%m%d")),
            "cld": capture_day,
            "ts": ts,
            "entity": f"e{entity_index}",
            "trip": trip_id,
            "svc": service_day,
            "rel": 3 if canceled else None,
        },
    )


def test_cancellation_observed_universe_filtered_to_service_day(conn) -> None:
    _seed_provider_edition(conn)
    _add_calendar(conn, "weekday", weekdays=True, saturday=False)
    _add_trips(conn, "weekday", ["t1", "t2", "t3", "t4", "t5"])
    ts_mon = _seed_capture_day_snapshot(
        conn, capture_day=MONDAY, hour=12, run_id=994001, snapshot_id=994001,
    )
    ts_tue = _seed_capture_day_snapshot(
        conn, capture_day=TUESDAY, hour=2, run_id=994002, snapshot_id=994002,
    )
    for i in range(3):
        _seed_fact_on_snapshot(
            conn, trip_id=f"mon_day{i}", service_day=MONDAY, capture_day=MONDAY,
            snapshot_id=994001, ts=ts_mon, entity_index=i,
        )
    _seed_fact_on_snapshot(
        conn, trip_id="mon_overnight", service_day=MONDAY, capture_day=TUESDAY,
        snapshot_id=994002, ts=ts_tue, entity_index=100,
    )
    _seed_fact_on_snapshot(
        conn, trip_id="tue_day", service_day=TUESDAY, capture_day=TUESDAY,
        snapshot_id=994002, ts=ts_tue, entity_index=200,
    )
    assert _run_scheduled(conn, MONDAY) == 5
    row = _run_cancellation(conn, MONDAY)
    assert row["total_trip_days"] == 4, "observed universe must == service-day-MONDAY trips"
    assert row["canceled_trip_days"] == 0
    assert row["scheduled_trip_days"] == 5
    assert row["silent_trip_days"] == 1
    assert row["delivered_trip_days"] == 4
    read = conn.execute(
        _ROUTE_CANCELLATION_DAILY_SQL, {"provider_id": PROVIDER, "route_id": "R1"}
    ).mappings().one()
    assert float(read["service_completeness_pct"]) == 80.0


def test_trend_cancel_delivered_filters_null_scheduled(conn) -> None:
    _seed_provider_edition(conn)
    _add_route(conn, "R2")
    _add_calendar(conn, "weekday", weekdays=True, saturday=False)
    _add_trips(conn, "weekday", ["t1", "t2", "t3", "t4", "t5"])
    _seed_fact_trip_days(conn, MONDAY, canceled=0, delivered=3)
    _seed_fact_trip_days_route(conn, MONDAY, "R2", canceled=0, delivered=2, base=500)
    _run_scheduled(conn, MONDAY)
    conn.execute(
        UPSERT_ROUTE_CANCELLATION_DAILY,
        {"provider_id": PROVIDER, "local_date": MONDAY,
         "date_key": int(MONDAY.strftime("%Y%m%d")),
         "built_at_utc": datetime(2026, 6, 16, tzinfo=UTC)},
    )
    row = conn.execute(
        _TREND_CANCELLATION_SQL, {"provider_id": PROVIDER}
    ).mappings().one()
    assert row["scheduled"] == 5
    assert row["delivered"] == 3


def test_representative_services_calendar_dates_only(conn) -> None:
    _seed_provider_edition(conn)
    _add_trips(conn, "holiday", ["h1", "h2"])
    _add_exception(conn, "holiday", MONDAY, 1)
    weekday, weekend = _representative_services(
        conn, provider_id=PROVIDER, dataset_version_id=DVID
    )
    assert weekday == ["holiday"]
    assert weekend == []


def test_representative_services_honors_type2_removal(conn) -> None:
    _seed_provider_edition(conn)
    _add_calendar(conn, "svc_big", weekdays=True, saturday=False)
    _add_calendar(conn, "svc_small", weekdays=True, saturday=False)
    _add_trips(conn, "svc_big", ["b1", "b2", "b3", "b4"])
    _add_trips(conn, "svc_small", ["s1"])
    for day in range(1, 31):
        _add_exception(conn, "svc_big", date(2026, 6, day), 2)
    weekday, _weekend = _representative_services(
        conn, provider_id=PROVIDER, dataset_version_id=DVID
    )
    assert "svc_big" not in weekday
    assert "svc_small" in weekday
