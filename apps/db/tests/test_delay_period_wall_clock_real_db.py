from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
import test_delay_period_lifecycle_real_db as lifecycle
from sqlalchemy import text
from test_warm_rollups import FakeConnection, FakeEngine

from transit_ops.gold import delay_periods, rollups

PERIOD = lifecycle.PERIOD
STAMP = PERIOD + timedelta(days=1)
BOUNDARY = PERIOD + timedelta(days=14)
DST_CASES = [
    pytest.param(
        datetime(2026, 3, 1, 13, 30, tzinfo=UTC),
        datetime(2026, 3, 15, 9, tzinfo=ZoneInfo("America/New_York")),
        1,
        id="spring-forward",
    ),
    pytest.param(
        datetime(2026, 10, 31, 13, 30, tzinfo=UTC),
        datetime(2026, 11, 14, 9, tzinfo=ZoneInfo("America/New_York")),
        0,
        id="fall-back",
    ),
]


@pytest.fixture
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection, connection.begin():
        seed_provider(connection, lifecycle.PROVIDER, display_name="Delay wall clock")
        lifecycle.add_capture(connection, PERIOD + timedelta(seconds=5))
        yield connection
        connection.rollback()


def stored_rows(conn):
    summaries = (
        conn.execute(
            text("""
        SELECT to_jsonb(s) - 'built_at_utc' FROM gold.trip_delay_summary_5m s
        WHERE provider_id = :provider ORDER BY period_start_utc, route_id
        """),
            {"provider": lifecycle.PROVIDER},
        )
        .scalars()
        .all()
    )
    watermarks = conn.execute(
        text("""
        SELECT rollup_kind, period_start_utc, invalidated_at_utc
        FROM gold.warm_rollup_periods WHERE provider_id = :provider
        ORDER BY rollup_kind, period_start_utc
        """),
        {"provider": lifecycle.PROVIDER},
    ).all()
    return summaries, watermarks


@pytest.mark.parametrize("offset, expected", [(timedelta(), 1), (timedelta(microseconds=1), 0)])
def test_explicit_clock_decides_retention_independently_of_real_clock(
    conn, monkeypatch, offset, expected
):
    results = []
    for real_clock in (PERIOD + timedelta(days=13), PERIOD + timedelta(days=15)):
        monkeypatch.setattr(delay_periods, "utc_now", lambda clock=real_clock: clock)
        with conn.begin_nested() as attempt:
            progress = delay_periods.PeriodBuildProgress()
            assert (
                delay_periods.build_delay_periods(
                    lifecycle.TransactionEngine(conn),
                    provider_id=lifecycle.PROVIDER,
                    since_utc=None,
                    now=STAMP,
                    progress=progress,
                    wall_clock_utc=BOUNDARY + offset,
                )
                == expected
            )
            assert progress.committed_rows == expected
            results.append(stored_rows(conn))
            if expected:
                assert lifecycle.summaries(conn) == [(PERIOD, "51", 1, 60)]
                assert results[-1][1] == [("trip_delay_summary_5m", PERIOD, None)]
            else:
                assert results[-1] == ([], [])
            attempt.rollback()
    assert results[0] == results[1]


@pytest.mark.parametrize(
    "real_clock, expected", [(BOUNDARY, 1), (BOUNDARY + timedelta(seconds=1), 0)]
)
def test_default_clock_keeps_retention_safety(conn, monkeypatch, real_clock, expected):
    monkeypatch.setattr(delay_periods, "utc_now", lambda: real_clock)
    assert lifecycle.build(conn, STAMP) == expected
    if expected:
        assert lifecycle.summaries(conn) == [(PERIOD, "51", 1, 60)]
        assert stored_rows(conn)[1] == [("trip_delay_summary_5m", PERIOD, None)]
    else:
        assert stored_rows(conn) == ([], [])


def test_naive_wall_clock_is_refused_by_name():
    with pytest.raises(ValueError, match="wall_clock_utc.*timezone-aware"):
        delay_periods.build_delay_periods(
            None,
            provider_id="wall-clock",
            since_utc=None,
            now=STAMP,
            progress=delay_periods.PeriodBuildProgress(),
            wall_clock_utc=datetime(2026, 9, 5),
        )


def test_unseeded_warm_rollups_refuse_naive_wall_clock():
    with pytest.raises(ValueError, match="wall_clock_utc.*timezone-aware"):
        rollups.build_warm_rollups(
            "wall-clock",
            engine=FakeEngine(FakeConnection(seeded=False)),
            as_of_utc=STAMP,
            wall_clock_utc=datetime(2026, 9, 5),
        )


@pytest.mark.parametrize("explicit", [False, True])
def test_warm_rollups_forward_the_optional_clock(monkeypatch, explicit):
    monkeypatch.setattr(delay_periods, "utc_now", lambda: PERIOD + timedelta(days=15))
    kwargs = {"wall_clock_utc": STAMP} if explicit else {}
    result = rollups.build_warm_rollups(
        "wall-clock",
        engine=FakeEngine(FakeConnection(trip_delay_periods=[PERIOD])),
        as_of_utc=STAMP,
        **kwargs,
    )
    assert result.built_trip_delay_periods == (1 if explicit else 0)


@pytest.mark.parametrize("period, wall, expected", DST_CASES)
def test_equivalent_dst_clocks_make_the_same_retention_decision(period, wall, expected):
    for clock in (wall.astimezone(UTC), wall):
        progress = delay_periods.PeriodBuildProgress()
        assert (
            delay_periods.build_delay_periods(
                FakeEngine(FakeConnection(trip_delay_periods=[period])),
                provider_id="wall-clock",
                since_utc=period,
                now=period + timedelta(days=1),
                progress=progress,
                wall_clock_utc=clock,
            )
            == expected
        )
        assert progress.committed_rows == expected


@pytest.mark.parametrize("period, wall, expected", DST_CASES)
def test_equivalent_dst_clocks_build_identical_summaries_and_watermarks(
    conn, period, wall, expected
):
    lifecycle.add_capture(conn, period + timedelta(seconds=5))
    results = []
    for clock in (wall.astimezone(UTC), wall):
        with conn.begin_nested() as attempt:
            progress = delay_periods.PeriodBuildProgress()
            assert (
                delay_periods.build_delay_periods(
                    lifecycle.TransactionEngine(conn),
                    provider_id=lifecycle.PROVIDER,
                    since_utc=period,
                    now=period + timedelta(days=1),
                    progress=progress,
                    wall_clock_utc=clock,
                )
                == expected
            )
            assert progress.committed_rows == expected
            results.append(stored_rows(conn))
            if expected:
                assert lifecycle.summaries(conn) == [(period, "51", 1, 60)]
                assert results[-1][1] == [("trip_delay_summary_5m", period, None)]
            else:
                assert results[-1] == ([], [])
            attempt.rollback()
    assert results[0] == results[1]
