
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, timedelta

import pytest
from sqlalchemy import text

from transit_ops.snapshots.builders._helpers import _severe_pct
from transit_ops.snapshots.builders.historic import build_stop_reliability

_PROVIDER = "stm_daily_s8"
_STOP = "S8STOP"


@contextmanager
def _seeded(rows, real_db_engine, seed_provider):  # noqa: ANN001
    with real_db_engine.connect() as conn:
        tx = conn.begin()
        try:
            conn.execute(
                text("DELETE FROM gold.stop_delay_spine WHERE provider_id = :p"),
                {"p": _PROVIDER},
            )
            seed_provider(
                conn,
                _PROVIDER,
                display_name="s8 daily seed",
                ignore_existing=True,
            )
            ins = text(
                "INSERT INTO gold.stop_delay_spine (provider_id, stop_id, route_id, "
                "provider_local_date, observation_count, severe_delay_count, sum_delay_seconds) "
                "VALUES (:p, :s, :r, :d, :n, :sev, :sum)"
            )
            for stop_id, route_id, day, obs, severe, sum_sec in rows:
                conn.execute(
                    ins,
                    {
                        "p": _PROVIDER,
                        "s": stop_id,
                        "r": route_id,
                        "d": day,
                        "n": obs,
                        "sev": severe,
                        "sum": sum_sec,
                    },
                )
            yield conn
        finally:
            tx.rollback()


def _daily(conn):  # noqa: ANN001
    out = build_stop_reliability(conn, provider_id=_PROVIDER, generated_utc="2026-07-02T00:00:00Z")
    assert _STOP in out, "seeded stop is missing from the build"
    return out[_STOP].daily


def test_daily_serves_summed_counts_and_omits_zero_obs_day(real_db_engine, seed_provider) -> None:
    d0 = date.today() - timedelta(days=4)
    d1 = date.today() - timedelta(days=3)
    gap = date.today() - timedelta(days=2)
    d3 = date.today() - timedelta(days=1)
    rows = [
        (_STOP, "R1", d0, 60, 15, 60 * 90),
        (_STOP, "R2", d0, 40, 10, 40 * 120),
        (_STOP, "R1", d1, 50, 5, 50 * 60),
        (_STOP, "R1", d3, 30, 0, 30 * 30),
    ]
    with _seeded(rows, real_db_engine, seed_provider) as conn:
        daily = _daily(conn)

    by_date = {p.date: p for p in daily}
    assert d0.isoformat() in by_date and d1.isoformat() in by_date and d3.isoformat() in by_date
    assert [p.date for p in daily] == sorted(p.date for p in daily)
    assert gap.isoformat() not in by_date

    p0 = by_date[d0.isoformat()]
    assert p0.observation_count == 100
    assert p0.severe_count == 25
    assert p0.severe_pct == _severe_pct(100, 25)
    assert p0.avg_delay_min == pytest.approx(1.7, abs=0.01)

    p3 = by_date[d3.isoformat()]
    assert p3.observation_count == 30
    assert p3.severe_count == 0
    assert p3.severe_pct == 0.0


def test_client_pooling_reproduces_served_rates_exactly(real_db_engine, seed_provider) -> None:
    base = date.today() - timedelta(days=10)
    rows = [
        (_STOP, "R1", base + timedelta(days=i), 40 + i, i, (40 + i) * (60 + i)) for i in range(5)
    ]
    with _seeded(rows, real_db_engine, seed_provider) as conn:
        daily = _daily(conn)

    assert len(daily) == 5
    pooled_obs = sum(p.observation_count for p in daily)
    pooled_severe = sum(p.severe_count for p in daily)
    expected = _severe_pct(pooled_obs, pooled_severe)

    raw_obs = sum(40 + i for i in range(5))
    raw_severe = sum(i for i in range(5))
    assert pooled_obs == raw_obs
    assert pooled_severe == raw_severe
    assert expected == _severe_pct(raw_obs, raw_severe)

    for p in daily:
        assert p.severe_pct == _severe_pct(p.observation_count, p.severe_count)
