from datetime import UTC, datetime, timedelta

import pytest
from test_warm_rollups import FakeConnection, FakeEngine, SharedCalendarConnection

from transit_ops.gold import delay_periods, rollups
from transit_ops.settings import Settings

NOW = datetime(2026, 3, 26, 12, tzinfo=UTC)


@pytest.mark.parametrize("retention", [14, 30])
def test_percentile_calendar_stays_fixed_when_retention_grows(monkeypatch, retention):
    monkeypatch.setattr(rollups, "utc_now", lambda: NOW)
    monkeypatch.setattr(delay_periods, "utc_now", lambda: NOW)
    conn = SharedCalendarConnection()
    rollups.build_warm_rollups(
        "lookback",
        engine=FakeEngine(conn),
        settings=Settings(_env_file=None, GOLD_FACT_RETENTION_DAYS=retention),
    )
    calendar = next(p for _, p in conn.bound_calls if "retained_since_utc" in p)
    assert calendar["floor_key"] == 20260313
    assert calendar["retained_since_utc"] == NOW - timedelta(days=retention)
    period = next(p for _, p in conn.bound_calls if "closed_before" in p)
    assert period["since_utc"] == datetime(2026, 3, 13, 12, tzinfo=UTC)


@pytest.mark.parametrize("retention", [0, 1, 10, 13])
def test_warm_build_refuses_insufficient_retention_before_connecting(retention):
    with pytest.raises(ValueError, match="GOLD_FACT_RETENTION_DAYS.*at least 14"):
        rollups.build_warm_rollups(
            "lookback",
            engine=FakeEngine(FakeConnection()),
            settings=Settings(_env_file=None, GOLD_FACT_RETENTION_DAYS=retention),
        )


@pytest.mark.parametrize("retention", [0, 1, 10, 13])
def test_period_build_refuses_insufficient_retention_before_connecting(retention):
    with pytest.raises(ValueError, match="retained facts.*at least 14"):
        delay_periods.build_delay_periods(
            FakeEngine(FakeConnection()),
            provider_id="lookback",
            since_utc=None,
            now=NOW,
            progress=delay_periods.PeriodBuildProgress(),
            retention_days=retention,
        )
