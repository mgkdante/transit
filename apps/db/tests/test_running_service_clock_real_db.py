from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text

ORIGINAL_RUNNING_QUERY = r"""
WITH current_schedule AS (
    SELECT dv.provider_id, dv.dataset_version_id, dp.timezone
    FROM core.dataset_versions dv
    JOIN gold.dim_provider dp ON dp.provider_id = dv.provider_id
    WHERE dv.provider_id = :p
      AND dv.dataset_kind = 'static_schedule' AND dv.is_current
),
trip_span AS (
    SELECT t.provider_id, t.dataset_version_id, cs.timezone,
           t.route_id, t.trip_id, t.service_id,
           min(split_part(COALESCE(st.departure_time, st.arrival_time), ':', 1)::bigint * 3600
               + split_part(COALESCE(st.departure_time, st.arrival_time), ':', 2)::int * 60
               + split_part(COALESCE(st.departure_time, st.arrival_time), ':', 3)::int
           ) AS first_seconds,
           max(split_part(COALESCE(st.arrival_time, st.departure_time), ':', 1)::bigint * 3600
               + split_part(COALESCE(st.arrival_time, st.departure_time), ':', 2)::int * 60
               + split_part(COALESCE(st.arrival_time, st.departure_time), ':', 3)::int
           ) AS last_seconds
    FROM current_schedule cs
    JOIN silver.trips t
      ON t.provider_id = cs.provider_id AND t.dataset_version_id = cs.dataset_version_id
    JOIN gold.dim_route dr ON dr.provider_id = t.provider_id AND dr.route_id = t.route_id
    JOIN silver.stop_times st
      ON st.provider_id = t.provider_id AND st.dataset_version_id = t.dataset_version_id
     AND st.trip_id = t.trip_id
    WHERE COALESCE(dr.route_type, 3) <> 1
      AND COALESCE(st.departure_time, st.arrival_time) IS NOT NULL
    GROUP BY t.dataset_version_id, t.trip_id, cs.timezone
),
candidate_days AS (
    SELECT ts.*, bounds.first_date + offsets.day_offset AS service_date
    FROM trip_span ts
    CROSS JOIN LATERAL (
        -- Padding covers civil-clock transitions. The exact elapsed test below
        -- selects the service date, including tomorrow or offsets beyond 48h.
        SELECT ((CAST(:at AS timestamptz) + interval '12 hours'
                 - ts.last_seconds * interval '1 second')
                    AT TIME ZONE ts.timezone)::date - 1 AS first_date,
               ((CAST(:at AS timestamptz) + interval '12 hours'
                 - ts.first_seconds * interval '1 second')
                    AT TIME ZONE ts.timezone)::date + 1 AS last_date
    ) bounds
    CROSS JOIN LATERAL generate_series(0, bounds.last_date - bounds.first_date)
        AS offsets(day_offset)
),
running AS (
    SELECT cd.*
    FROM candidate_days cd
    CROSS JOIN LATERAL (
        SELECT ((cd.service_date::timestamp + interval '12 hours')
                    AT TIME ZONE cd.timezone) - interval '12 hours' AS service_start
    ) clock
    WHERE CAST(:at AS timestamptz) BETWEEN clock.service_start
                       + cd.first_seconds * interval '1 second'
                 AND clock.service_start + cd.last_seconds * interval '1 second'
)
SELECT DISTINCT r.route_id, r.trip_id
FROM running r
LEFT JOIN silver.calendar c
  ON c.provider_id = r.provider_id AND c.dataset_version_id = r.dataset_version_id
 AND c.service_id = r.service_id
LEFT JOIN silver.calendar_dates exception
  ON exception.provider_id = r.provider_id
 AND exception.dataset_version_id = r.dataset_version_id
 AND exception.service_id = r.service_id AND exception.service_date = r.service_date
WHERE CASE
    WHEN exception.exception_type = 1 THEN true
    WHEN exception.exception_type = 2 THEN false
    ELSE r.service_date BETWEEN c.start_date AND c.end_date
         AND CASE extract(isodow FROM r.service_date)
             WHEN 1 THEN c.monday WHEN 2 THEN c.tuesday WHEN 3 THEN c.wednesday
             WHEN 4 THEN c.thursday WHEN 5 THEN c.friday WHEN 6 THEN c.saturday
             ELSE c.sunday END
END;
"""

PROVIDER = "running_clock_test"
DAY = date(2026, 2, 2)


@pytest.fixture
def conn(real_db_engine):
    with real_db_engine.connect() as connection, connection.begin() as transaction:
        try:
            yield connection
        finally:
            transaction.rollback()


def _instant(day, offset, timezone="America/Toronto"):
    noon_utc = datetime.combine(day, time(12), ZoneInfo(timezone)).astimezone(UTC)
    hours, minutes, seconds = map(int, offset.split(":"))
    return noon_utc - timedelta(hours=12) + timedelta(hours=hours, minutes=minutes, seconds=seconds)


def _edition(conn, seed_provider, *, provider=PROVIDER, current=True, timezone="America/Toronto"):
    seed_provider(conn, provider, display_name=provider, timezone=timezone, ignore_existing=True)
    params = {"p": provider, "current": current, "key": f"schedule-{current}"}
    params["e"] = conn.execute(
        text("""
        INSERT INTO core.feed_endpoints (provider_id,endpoint_key,feed_kind,source_format)
        VALUES (:p,:key,'static_schedule','gtfs_schedule_zip') RETURNING feed_endpoint_id
    """),
        params,
    ).scalar_one()
    params["run"] = conn.execute(
        text("""
        INSERT INTO raw.ingestion_runs (provider_id,feed_endpoint_id,run_kind,status)
        VALUES (:p,:e,'static_schedule','succeeded') RETURNING ingestion_run_id
    """),
        params,
    ).scalar_one()
    params["d"] = conn.execute(
        text("""
        INSERT INTO core.dataset_versions
            (provider_id,feed_endpoint_id,source_ingestion_run_id,content_hash,is_current)
        VALUES (:p,:e,:run,:key,:current) RETURNING dataset_version_id
    """),
        params,
    ).scalar_one()
    conn.execute(
        text("""
        INSERT INTO silver.routes (dataset_version_id,provider_id,route_id,route_type)
        VALUES (:d,:p,'R',3)
    """),
        params,
    )
    conn.execute(
        text("""
        INSERT INTO silver.stops (dataset_version_id,provider_id,stop_id,stop_name)
        VALUES (:d,:p,'S1','First stop'),(:d,:p,'S2','Last stop')
    """),
        params,
    )
    if current:
        conn.execute(
            text("""
            INSERT INTO gold.dim_route (provider_id,dataset_version_id,route_id,route_type)
            VALUES (:p,:d,'R',3)
        """),
            params,
        )
    return params


def _calendar(conn, edition, day=DAY):
    conn.execute(
        text("""
        INSERT INTO silver.calendar
            (dataset_version_id,provider_id,service_id,monday,tuesday,wednesday,thursday,
             friday,saturday,sunday,start_date,end_date)
        VALUES (:d,:p,'service',true,true,true,true,true,true,true,:day,:day)
    """),
        {**edition, "day": day},
    )


def _exception(conn, edition, kind, day=DAY):
    conn.execute(
        text("""
        INSERT INTO silver.calendar_dates
            (dataset_version_id,provider_id,service_id,service_date,exception_type)
        VALUES (:d,:p,'service',:day,:kind)
    """),
        {**edition, "day": day, "kind": kind},
    )


def _trip(conn, edition, start="12:00:05", end="12:30:05", trip="T"):
    params = {**edition, "trip": trip, "start": start, "end": end}
    conn.execute(
        text("""
        INSERT INTO silver.trips (dataset_version_id,provider_id,trip_id,route_id,service_id)
        VALUES (:d,:p,:trip,'R','service')
    """),
        params,
    )
    conn.execute(
        text("""
        INSERT INTO silver.stop_times
            (dataset_version_id,provider_id,trip_id,stop_sequence,stop_id,arrival_time,departure_time)
        VALUES (:d,:p,:trip,1,'S1',:start,:start),(:d,:p,:trip,2,'S2',:end,:end)
    """),
        params,
    )

    from transit_ops.silver.static_gtfs import refresh_trip_service_spans

    refresh_trip_service_spans(conn, provider_id=edition["p"], dataset_version_id=edition["d"])


def _assert_equivalent(conn, as_of, provider=PROVIDER):
    params = {"p": provider, "as_of": as_of, "at": as_of}
    expected = set(conn.execute(text(ORIGINAL_RUNNING_QUERY), params).all())
    actual = set(
        conn.execute(
            text("SELECT route_id, trip_id FROM gold.scheduled_running_trips_at(:p,:as_of)"), params
        ).all()
    )
    assert actual == expected


def _missing(conn, as_of, provider=PROVIDER):
    _assert_equivalent(conn, as_of, provider)
    definition = conn.execute(
        text("SELECT pg_get_viewdef('gold.non_responding_current'::regclass, true)")
    ).scalar_one()
    definition = (
        definition.strip().removesuffix(";").replace("now()", "CAST(:as_of AS timestamptz)")
    )
    rows = conn.execute(
        text(
            f"SELECT route_id,non_responding_count,trip_ids FROM ({definition}) running "
            "WHERE provider_id=:p ORDER BY route_id"
        ),
        {"as_of": as_of, "p": provider},
    ).all()
    return [(route, count, sorted(trips)) for route, count, trips in rows]


@pytest.mark.parametrize(
    "active,old_kind,current_kind,expected",
    [
        (True, 2, None, True),
        (True, None, 2, False),
        (False, None, 1, True),
        (False, 1, None, False),
    ],
)
def test_calendar_exceptions_belong_to_the_current_edition(
    conn, seed_provider, active, old_kind, current_kind, expected
):
    current = _edition(conn, seed_provider)
    old = _edition(conn, seed_provider, current=False)
    _trip(conn, current)
    if active:
        _calendar(conn, current)
    if old_kind:
        _exception(conn, old, old_kind)
    if current_kind:
        _exception(conn, current, current_kind)
    assert _missing(conn, _instant(DAY, "12:15:00")) == ([("R", 1, ["T"])] if expected else [])


@pytest.mark.parametrize(
    "offset,expected",
    [
        ("12:00:04", False),
        ("12:00:05", True),
        ("12:00:06", True),
        ("12:30:04", True),
        ("12:30:05", True),
        ("12:30:06", False),
    ],
)
def test_running_bounds_include_exact_endpoints_without_rounding(
    conn, seed_provider, offset, expected
):
    edition = _edition(conn, seed_provider)
    _calendar(conn, edition)
    _trip(conn, edition)
    assert _missing(conn, _instant(DAY, offset)) == ([("R", 1, ["T"])] if expected else [])


@pytest.mark.parametrize("hours", [25, 49, 100])
def test_extended_gtfs_hours_find_the_original_service_date(conn, seed_provider, hours):
    edition = _edition(conn, seed_provider)
    _calendar(conn, edition)
    _trip(conn, edition, f"{hours}:00:05", f"{hours}:30:05")
    assert _missing(conn, _instant(DAY, f"{hours}:15:00")) == [("R", 1, ["T"])]
    assert _missing(conn, _instant(DAY, f"{hours}:30:06")) == []


@pytest.mark.parametrize(
    "timezone,day,offset,utc,wrong",
    [
        ("America/Toronto", date(2026, 3, 8), "00:30:00", "2026-03-08T04:30Z", "2026-03-08T05:30Z"),
        (
            "America/Toronto",
            date(2026, 11, 1),
            "00:30:00",
            "2026-11-01T05:30Z",
            "2026-11-01T06:30Z",
        ),
        (
            "America/Toronto",
            date(2026, 11, 1),
            "01:30:00",
            "2026-11-01T06:30Z",
            "2026-11-01T05:30Z",
        ),
        (
            "Australia/Lord_Howe",
            date(2026, 10, 4),
            "00:30:00",
            "2026-10-03T13:30Z",
            "2026-10-03T14:00Z",
        ),
        (
            "Australia/Lord_Howe",
            date(2026, 4, 5),
            "01:30:00",
            "2026-04-04T15:00Z",
            "2026-04-04T14:30Z",
        ),
    ],
)
def test_service_day_uses_elapsed_time_from_noon_minus_twelve_hours(
    conn, seed_provider, timezone, day, offset, utc, wrong
):
    edition = _edition(conn, seed_provider, timezone=timezone)
    _calendar(conn, edition, day)
    _trip(conn, edition, offset, offset)
    expected = _instant(day, offset, timezone)
    assert expected == datetime.fromisoformat(utc)
    for session_timezone in ("UTC", "America/Los_Angeles", "Asia/Tokyo"):
        conn.execute(text("SELECT set_config('TimeZone', :tz, true)"), {"tz": session_timezone})
        assert _missing(conn, expected) == [("R", 1, ["T"])]
        assert _missing(conn, datetime.fromisoformat(wrong)) == []


def test_arrival_only_final_stop_extends_the_trip_but_untimed_trips_do_not_run(conn, seed_provider):
    edition = _edition(conn, seed_provider)
    _calendar(conn, edition)
    _trip(conn, edition)
    _trip(conn, edition, None, None, "untimed")
    conn.execute(
        text("""
        UPDATE silver.stop_times SET departure_time=NULL
        WHERE dataset_version_id=:d AND trip_id='T' AND stop_sequence=2
    """),
        edition,
    )
    assert _missing(conn, _instant(DAY, "12:15:00")) == [("R", 1, ["T"])]


def test_overlapping_service_days_count_distinct_trip_ids(conn, seed_provider):
    edition = _edition(conn, seed_provider)
    _calendar(conn, edition)
    _exception(conn, edition, 1, DAY - timedelta(days=1))
    for trip in ("T", "other-trip"):
        _trip(conn, edition, "00:00:00", "25:30:00", trip)
    assert _missing(conn, _instant(DAY, "01:00:00")) == [("R", 2, ["T", "other-trip"])]


def _vehicles(conn, edition, trip="T"):
    params = dict(edition)
    params["e"] = conn.execute(
        text("""
        INSERT INTO core.feed_endpoints (provider_id,endpoint_key,feed_kind,source_format)
        VALUES (:p,'vehicle_positions','vehicle_positions','gtfs_rt_vehicle_positions')
        RETURNING feed_endpoint_id
    """),
        params,
    ).scalar_one()
    params["run"] = conn.execute(
        text("""
        INSERT INTO raw.ingestion_runs (provider_id,feed_endpoint_id,run_kind,status)
        VALUES (:p,:e,'vehicle_positions','succeeded') RETURNING ingestion_run_id
    """),
        params,
    ).scalar_one()
    params["snapshot"] = conn.execute(
        text("""
        INSERT INTO raw.realtime_snapshot_index
            (ingestion_run_id,provider_id,feed_endpoint_id,captured_at_utc,feed_timestamp_utc)
        VALUES (:run,:p,:e,now(),now()) RETURNING realtime_snapshot_id
    """),
        params,
    ).scalar_one()
    for index in range(2):
        conn.execute(
            text("""
            INSERT INTO gold.latest_vehicle_snapshot
                (provider_id,realtime_snapshot_id,entity_index,snapshot_date_key,
                 snapshot_local_date,feed_timestamp_utc,captured_at_utc,trip_id)
            VALUES (:p,:snapshot,:index,20260202,'2026-02-02',now(),now(),:trip)
        """),
            {**params, "index": index, "trip": trip},
        )


def test_other_provider_calendar_and_vehicle_ids_do_not_leak(conn, seed_provider):
    edition = _edition(conn, seed_provider)
    other = _edition(conn, seed_provider, provider=PROVIDER + "_other")
    for schedule in (edition, other):
        _calendar(conn, schedule)
        _trip(conn, schedule)
    _exception(conn, other, 2)
    _vehicles(conn, other)
    now = _instant(DAY, "12:15:00")
    assert _missing(conn, now) == [("R", 1, ["T"])]
    assert _missing(conn, now, other["p"]) == []


def test_duplicate_live_vehicles_exclude_one_trip_and_metro_is_excluded(conn, seed_provider):
    edition = _edition(conn, seed_provider)
    _calendar(conn, edition)
    for trip in ("T", "other-trip"):
        _trip(conn, edition, trip=trip)
    _vehicles(conn, edition)
    now = _instant(DAY, "12:15:00")
    assert _missing(conn, now) == [("R", 1, ["other-trip"])]
    conn.execute(
        text(
            "UPDATE core.providers SET lines_without_live_data = "
            "'[{\"route_types\":[1]}]' WHERE provider_id=:p"
        ),
        edition,
    )
    conn.execute(text("UPDATE gold.dim_route SET route_type=1 WHERE provider_id=:p"), edition)
    assert _missing(conn, now) == []


def test_weekly_calendar_flags_and_date_bounds_control_service(conn, seed_provider):
    edition = _edition(conn, seed_provider)
    _calendar(conn, edition)
    _trip(conn, edition)
    conn.execute(
        text("""
        UPDATE silver.calendar
        SET tuesday=false, thursday=false, saturday=false, sunday=false, end_date=:last
        WHERE dataset_version_id=:d AND provider_id=:p
    """),
        {**edition, "last": DAY + timedelta(days=6)},
    )
    for offset in range(-1, 8):
        expected = [("R", 1, ["T"])] if offset in (0, 2, 4) else []
        assert _missing(conn, _instant(DAY + timedelta(days=offset), "12:15:00")) == expected


def test_installed_view_matches_the_dated_function_at_transaction_now(conn, seed_provider):
    now = conn.execute(text("SELECT now()")).scalar_one()
    day = now.astimezone(ZoneInfo("America/Toronto")).date()
    if now < _instant(day, "00:00:00"):
        day -= timedelta(days=1)
    edition = _edition(conn, seed_provider)
    _calendar(conn, edition, day)
    _trip(conn, edition, "00:00:00", "48:00:00")
    assert conn.execute(
        text("SELECT route_id,trip_id FROM gold.scheduled_running_trips_at(:p,now())"), edition
    ).all() == [("R", "T")]
    assert (
        conn.execute(
            text(
                "SELECT route_id,non_responding_count,trip_ids "
                "FROM gold.non_responding_current WHERE provider_id=:p"
            ),
            edition,
        ).all()
        == _missing(conn, now)
        == [("R", 1, ["T"])]
    )


def test_span_rebuild_replaces_changed_and_removed_times(conn, seed_provider):
    from transit_ops.silver.static_gtfs import refresh_trip_service_spans

    edition = _edition(conn, seed_provider)
    _trip(conn, edition)
    _trip(conn, edition, None, None, "untimed")
    _trip(conn, edition, "49:00:00", "50:00:00", "long")
    query = text("""
        SELECT trip_id, first_seconds, last_seconds FROM gold.trip_service_span
        WHERE dataset_version_id=:d ORDER BY trip_id COLLATE "C"
    """)
    assert conn.execute(query, edition).all() == [("T", 43205, 45005), ("long", 176400, 180000)]
    conn.execute(
        text("""
        UPDATE silver.stop_times SET departure_time=NULL, arrival_time=NULL
        WHERE dataset_version_id=:d AND trip_id='T'
    """),
        edition,
    )
    for _ in range(2):
        refresh_trip_service_spans(conn, provider_id=edition["p"], dataset_version_id=edition["d"])
        assert conn.execute(query, edition).all() == [("long", 176400, 180000)]


def test_span_migration_downgrade_upgrade_backfill_and_cascade(conn, seed_provider, monkeypatch):
    from importlib import import_module

    migration = import_module("transit_ops.db.migrations.versions.0095_trip_service_span")
    current = _edition(conn, seed_provider)
    old = _edition(conn, seed_provider, current=False)
    _calendar(conn, current)
    for edition in (current, old):
        _trip(conn, edition)
    monkeypatch.setattr(migration.op, "execute", conn.exec_driver_sql)
    with conn.begin_nested() as checkpoint:
        migration.downgrade()
        assert conn.execute(text("SELECT to_regclass('gold.trip_service_span')")).scalar() is None
        _assert_equivalent(conn, _instant(DAY, "12:15:00"))
        with conn.begin_nested() as interrupted:
            migration.upgrade()
            interrupted.rollback()
        migration.upgrade()
        assert conn.exec_driver_sql("SHOW lock_timeout").scalar() == "2s"
        assert conn.exec_driver_sql("SHOW statement_timeout").scalar() == "10min"
        assert conn.execute(
            text("""
            SELECT dataset_version_id FROM gold.trip_service_span WHERE provider_id=:p
        """),
            current,
        ).all() == [(current["d"],)]
        _assert_equivalent(conn, _instant(DAY, "12:15:00"))
        for role, privileges in (
            ("transit_app", ["SELECT", "INSERT", "DELETE"]),
            ("transit-db", ["SELECT"]),
        ):
            if conn.execute(text("SELECT 1 FROM pg_roles WHERE rolname=:r"), {"r": role}).scalar():
                for privilege in privileges:
                    assert conn.execute(
                        text(
                            "SELECT has_table_privilege(:r, 'gold.trip_service_span', :privilege)"
                        ),
                        {"r": role, "privilege": privilege},
                    ).scalar()
        # Remove the fixture's other FK holders, then let the new FK prune spans.
        for table in (
            "gold.dim_route",
            "silver.stop_times",
            "silver.trips",
            "silver.stops",
            "silver.routes",
            "silver.calendar",
        ):
            conn.execute(text(f"DELETE FROM {table} WHERE dataset_version_id=:d"), current)
        conn.execute(text("DELETE FROM core.dataset_versions WHERE dataset_version_id=:d"), current)
        assert (
            conn.execute(
                text("""
            SELECT count(*) FROM gold.trip_service_span WHERE dataset_version_id=:d
        """),
                current,
            ).scalar()
            == 0
        )
        checkpoint.rollback()
