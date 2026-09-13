"""D7 drops known carry-in starts without adding a cross-midnight gap."""

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text
from test_delay_days_real_db import capture

from transit_ops.gold import rollups

PROVIDER = "headway_carry_test"
OTHER = "headway_carry_other"
DAY = date(2026, 6, 24)
SERVICE = DAY - timedelta(days=1)
TZ = ZoneInfo("America/Toronto")


@pytest.fixture
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection, connection.begin() as transaction:
        for provider in (PROVIDER, OTHER):
            seed_provider(connection, provider, display_name="Headway carry-in", timezone=str(TZ))
        try:
            yield connection
        finally:
            transaction.rollback()


def instant(day=DAY, hour=0, minute=0):
    return datetime.combine(day, time(hour, minute), tzinfo=TZ).astimezone(UTC)


def observe(
    conn,
    trip,
    captured,
    *,
    service=SERVICE,
    delay=0,
    direction=0,
    route="51",
    provider=PROVIDER,
    snapshot_day=None,
):
    snapshot = capture(conn, provider=provider, captured=captured)
    local_day = snapshot_day or captured.astimezone(TZ).date()
    conn.execute(
        text(
            "UPDATE gold.fact_trip_delay_snapshot SET trip_id=:trip, start_date=:service, "
            "delay_seconds=:delay, direction_id=:direction, route_id=:route, "
            "snapshot_local_date=:day, snapshot_date_key=:key "
            "WHERE provider_id=:provider AND realtime_snapshot_id=:snapshot"
        ),
        {
            "trip": trip,
            "service": service,
            "delay": delay,
            "direction": direction,
            "route": route,
            "day": local_day,
            "key": int(local_day.strftime("%Y%m%d")),
            "provider": provider,
            "snapshot": snapshot,
        },
    )
    return snapshot


def build(conn, day=DAY):
    conn.execute(
        rollups.UPSERT_ROUTE_HEADWAY_SHIFT_DAILY,
        {
            "provider_id": PROVIDER,
            "local_date": day,
            "date_key": int(day.strftime("%Y%m%d")),
            "built_at_utc": instant(day + timedelta(days=1)),
        },
    )


def result(conn, *, day=DAY, shift="night", direction=0):
    row = (
        conn.execute(
            text(
                "SELECT gap_count, sum_gap_min, sum_gap_sq_min, bunched_gap_count, "
                "trip_count, gap_histogram FROM gold.route_headway_shift_daily "
                "WHERE provider_id=:p AND provider_local_date=:day AND shift=:shift "
                "AND direction_id=:direction AND route_id='51'"
            ),
            {"p": PROVIDER, "day": day, "shift": shift, "direction": direction},
        )
        .mappings()
        .one_or_none()
    )
    return dict(row) if row else None


def today_starts(conn, *, service=SERVICE):
    for trip, minute in (("A", 5), ("B", 10), ("C", 30)):
        observe(conn, trip, instant(minute=minute), service=service)


def assert_moments(row, gaps, trips):
    assert row is not None
    assert row["gap_count"] == len(gaps)
    assert row["sum_gap_min"] == sum(gaps)
    assert row["sum_gap_sq_min"] == sum(gap * gap for gap in gaps)
    assert row["trip_count"] == trips
    assert sum(row["gap_histogram"]) == len(gaps)


@pytest.mark.parametrize("repeat", [False, True])
def test_midnight_carry_in_drops_phantom_five_minute_gap_without_importing_boundary(conn, repeat):
    observe(conn, "A", instant(SERVICE, 23, 50))
    if repeat:
        observe(conn, "A", instant(minute=5))
    observe(conn, "B", instant(minute=10))
    observe(conn, "C", instant(minute=30))
    build(conn)
    assert_moments(result(conn), [20], 2)


@pytest.mark.parametrize("delay", [None, 3601, -3601, 3600, -3600])
def test_only_earlier_first_computable_deviation_can_veto_a_start(conn, delay):
    observe(conn, "A", instant(SERVICE, 23, 50), delay=delay)
    today_starts(conn)
    build(conn)
    veto = delay is not None and abs(delay) <= 3600
    assert_moments(result(conn), [20] if veto else [5, 20], 2 if veto else 3)


@pytest.mark.parametrize(
    "difference", ["service", "direction", "route", "provider", "missing_date"]
)
def test_retained_witness_does_not_merge_reused_ids_across_instance_keys(conn, difference):
    kwargs = {
        "service": {"service": SERVICE - timedelta(days=1)},
        "direction": {"direction": 1},
        "route": {"route": "52"},
        "provider": {"provider": OTHER},
        "missing_date": {"service": None},
    }[difference]
    observe(conn, "A", instant(SERVICE, 23, 50), **kwargs)
    today_starts(conn)
    build(conn)
    assert_moments(result(conn), [5, 20], 3)


def test_null_direction_retains_the_existing_coalesced_direction_identity(conn):
    observe(conn, "A", instant(SERVICE, 23, 50), direction=None)
    today_starts(conn)
    build(conn)
    assert_moments(result(conn), [20], 2)


@pytest.mark.parametrize("mixed", [False, True])
def test_missing_or_mixed_start_date_fallback_is_unchanged_and_not_used_as_carry_proof(conn, mixed):
    observe(conn, "A", instant(SERVICE, 23, 50), service=DAY)
    observe(conn, "A", instant(minute=5), service=None)
    if mixed:
        observe(conn, "A", instant(minute=6), service=DAY)
    observe(conn, "B", instant(minute=10), service=DAY)
    observe(conn, "C", instant(minute=30), service=DAY)
    build(conn)
    assert_moments(result(conn), [5, 20], 3)


def test_absent_retained_context_does_not_invent_a_witness(conn):
    today_starts(conn)
    build(conn)
    assert_moments(result(conn), [5, 20], 3)


def test_ordinary_day_moments_histogram_and_bunching_are_unchanged(conn):
    for index, minute in enumerate((0, 2, 12, 22)):
        observe(conn, str(index), instant(hour=7, minute=minute), service=DAY)
    build(conn)
    row = result(conn, shift="am_peak")
    assert_moments(row, [2, 10, 10], 4)
    assert row["bunched_gap_count"] == 1
    assert row["gap_histogram"][3] == 1
    assert row["gap_histogram"][9] == 2


@pytest.mark.parametrize(
    "day,service", [(date(2026, 6, 27), date(2026, 6, 26)), (date(2026, 6, 29), date(2026, 6, 28))]
)
def test_both_output_day_and_service_day_weekday_guards_remain(conn, day, service):
    observe(conn, "A", instant(service, 23, 50), service=service)
    for trip, minute in (("A", 5), ("B", 10), ("C", 30)):
        observe(conn, trip, instant(day, minute=minute), service=service)
    build(conn, day)
    assert result(conn, day=day) is None


def test_shift_boundaries_do_not_gain_a_preceding_shift_gap(conn):
    observe(conn, "A", instant(hour=5, minute=55), service=DAY)
    observe(conn, "B", instant(hour=6, minute=5), service=DAY)
    observe(conn, "C", instant(hour=6, minute=15), service=DAY)
    build(conn)
    assert result(conn) is None
    assert_moments(result(conn, shift="am_peak"), [10], 2)


@pytest.mark.parametrize("gap", [0, 239, 240, 241])
def test_strict_gap_range_is_preserved_within_one_shift(conn, gap):
    observe(conn, "A", instant(), service=DAY)
    observe(conn, "B", instant() + timedelta(minutes=gap), service=DAY)
    build(conn)
    if gap == 239:
        assert_moments(result(conn), [gap], 2)
    else:
        assert result(conn) is None


def test_snapshot_calendar_filter_is_not_replaced_by_capture_day(conn):
    other_capture_day = DAY + timedelta(days=1)
    for trip, minute in (("A", 5), ("B", 10), ("C", 30)):
        observe(conn, trip, instant(other_capture_day, minute=minute), snapshot_day=DAY)
    build(conn)
    assert_moments(result(conn), [5, 20], 3)
