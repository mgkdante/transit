"""Installed scheduled-running view behavior on a rollback-only disposable database."""

from datetime import UTC, date, datetime, time, timedelta
from importlib import import_module
from zoneinfo import ZoneInfo

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import text

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
    # UTC subtraction is elapsed time; subtracting on a zoned datetime is wall time.
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


def _missing(conn, as_of, provider=PROVIDER):
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


def test_migration_lifecycle_preserves_dependent_view_and_column_contract(
    conn, seed_provider, monkeypatch
):
    migration = import_module("transit_ops.db.migrations.versions.0091_running_service_clock")
    monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(conn)))
    migration.upgrade()
    conn.execute(
        text("CREATE TEMP VIEW running_consumer AS SELECT * FROM gold.non_responding_current")
    )
    columns = text("""
        SELECT attname,format_type(atttypid,atttypmod) FROM pg_attribute
        WHERE attrelid='running_consumer'::regclass AND attnum>0 ORDER BY attnum
    """)
    expected_columns = [
        ("provider_id", "text"),
        ("route_id", "text"),
        ("non_responding_count", "integer"),
        ("trip_ids", "text[]"),
    ]
    current = _edition(conn, seed_provider)
    old = _edition(conn, seed_provider, current=False)
    _calendar(conn, current)
    _trip(conn, current)
    _exception(conn, old, 2)
    instant = _instant(DAY, "12:15:00")
    for downgrade in (True, False):
        migration.downgrade() if downgrade else migration.upgrade()
        assert conn.execute(columns).all() == expected_columns
        conn.execute(text("SELECT * FROM running_consumer LIMIT 1")).all()
        function_exists = conn.execute(
            text("""
            SELECT to_regprocedure('gold.scheduled_running_trips_at(text,timestamptz)') IS NOT NULL
        """)
        ).scalar_one()
        assert function_exists is not downgrade
        assert _missing(conn, instant) == ([] if downgrade else [("R", 1, ["T"])])
