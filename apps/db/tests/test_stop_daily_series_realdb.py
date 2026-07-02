"""Real-DB gate for the S8 stop DAILY series (contract StopReliability.daily).

Self-skips when TRANSIT_TEST_DATABASE_URL is unset. Seeds gold.stop_delay_spine
DIRECTLY (build_stop_reliability's daily read touches only that table + the
gold.dim_provider timezone JOIN) with dated rows INSIDE the now()-anchored
trailing-90-day window, then asserts the SERVE-THE-COUNTS contract:

  * per-day points carry the EXACT summed observation_count + severe_count;
  * a zero-observation day is ABSENT from the series (never zero-filled);
  * counts sum ACROSS the stop's routes (whole-stop view);
  * a client that pools an arbitrary sub-range by SUMMING the served counts
    reproduces the served per-day severe_pct exactly (the client-pooling fixture).
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine, text
from test_spine_cutover_gate import DB_URL  # noqa: E402

from transit_ops.snapshots.builders._helpers import _severe_pct
from transit_ops.snapshots.builders.historic import build_stop_reliability

pytestmark = pytest.mark.skipif(
    not DB_URL, reason="TRANSIT_TEST_DATABASE_URL not set - stop daily-series real-DB gate skipped"
)

_PROVIDER = "stm_daily_s8"
_STOP = "S8STOP"


@contextmanager
def _seeded(rows):  # noqa: ANN001
    """rows = list of (stop_id, route_id, provider_local_date, obs, severe, sum_delay_sec).

    Rollback-isolated; clears any leftover committed rows for this provider first so a
    stale row can never pollute the read (the same pollution-defeat guard the sibling
    windowable real-DB tests use). The DELETE is in-tx, scoping only this test's read.
    """
    engine = create_engine(DB_URL)
    with engine.connect() as conn:
        tx = conn.begin()
        try:
            conn.execute(
                text("DELETE FROM gold.stop_delay_spine WHERE provider_id = :p"),
                {"p": _PROVIDER},
            )
            conn.execute(
                text(
                    "INSERT INTO core.providers (provider_id, display_name, timezone, provider_key) "
                    "VALUES (:p, 's8 daily seed', 'America/Toronto', :p) "
                    "ON CONFLICT (provider_id) DO NOTHING"
                ),
                {"p": _PROVIDER},
            )
            ins = text(
                "INSERT INTO gold.stop_delay_spine (provider_id, stop_id, route_id, "
                "provider_local_date, observation_count, severe_delay_count, sum_delay_seconds) "
                "VALUES (:p, :s, :r, :d, :n, :sev, :sum)"
            )
            for stop_id, route_id, day, obs, severe, sum_sec in rows:
                conn.execute(
                    ins,
                    {"p": _PROVIDER, "s": stop_id, "r": route_id, "d": day,
                     "n": obs, "sev": severe, "sum": sum_sec},
                )
            yield conn
        finally:
            tx.rollback()
    engine.dispose()


def _daily(conn):  # noqa: ANN001
    out = build_stop_reliability(conn, provider_id=_PROVIDER, generated_utc="2026-07-02T00:00:00Z")
    assert _STOP in out, "seeded stop is missing from the build"
    return out[_STOP].daily


def test_daily_serves_summed_counts_and_omits_zero_obs_day() -> None:
    # Closed days INSIDE the trailing-90 window with an interior GAP day (today-2)
    # left UNSEEDED — a zero-observation day must be ABSENT, never zero-filled.
    d0 = date.today() - timedelta(days=4)
    d1 = date.today() - timedelta(days=3)
    gap = date.today() - timedelta(days=2)  # deliberately UNSEEDED
    d3 = date.today() - timedelta(days=1)
    rows = [
        # d0: two routes at the SAME stop -> summed obs=100, severe=25
        (_STOP, "R1", d0, 60, 15, 60 * 90),
        (_STOP, "R2", d0, 40, 10, 40 * 120),
        # d1: single route
        (_STOP, "R1", d1, 50, 5, 50 * 60),
        # (gap deliberately UNSEEDED -> zero-observation day -> absent)
        (_STOP, "R1", d3, 30, 0, 30 * 30),
    ]
    with _seeded(rows) as conn:
        daily = _daily(conn)

    by_date = {p.date: p for p in daily}
    # every seeded day is present, days arrive date-ascending
    assert d0.isoformat() in by_date and d1.isoformat() in by_date and d3.isoformat() in by_date
    assert [p.date for p in daily] == sorted(p.date for p in daily)
    # the UNSEEDED interior day is ABSENT — a zero-obs day is never zero-filled
    assert gap.isoformat() not in by_date

    # d0 sums ACROSS both routes: obs 60+40=100, severe 15+10=25
    p0 = by_date[d0.isoformat()]
    assert p0.observation_count == 100
    assert p0.severe_count == 25
    assert p0.severe_pct == _severe_pct(100, 25)  # 25.0
    # avg = (60*90 + 40*120)/100 sec = 102s -> 1.7 min (pooled sum / summed obs)
    assert p0.avg_delay_min == pytest.approx(1.7, abs=0.01)

    # d3 has zero severe -> severe_pct honestly 0.0 (obs>0), avg from its own sum
    p3 = by_date[d3.isoformat()]
    assert p3.observation_count == 30
    assert p3.severe_count == 0
    assert p3.severe_pct == 0.0


def test_client_pooling_reproduces_served_rates_exactly() -> None:
    """Documents the SERVE-THE-COUNTS invariant: summing the served per-day counts
    over an arbitrary sub-range yields a severe_pct byte-identical to the server's
    per-day severe_pct helper applied to the same summed ingredients. This is the
    exact math the web performs client-side (sum counts -> _severe_pct), so no
    fabricated re-aggregation can drift the pooled rate."""
    base = date.today() - timedelta(days=10)
    rows = [
        (_STOP, "R1", base + timedelta(days=i), 40 + i, i, (40 + i) * (60 + i))
        for i in range(5)
    ]
    with _seeded(rows) as conn:
        daily = _daily(conn)

    assert len(daily) == 5
    # pool ALL five days by summing the SERVED counts (what the client does)
    pooled_obs = sum(p.observation_count for p in daily)
    pooled_severe = sum(p.severe_count for p in daily)
    expected = _severe_pct(pooled_obs, pooled_severe)

    # independently recompute from the raw seed to prove the counts are the honest sum
    raw_obs = sum(40 + i for i in range(5))
    raw_severe = sum(i for i in range(5))
    assert pooled_obs == raw_obs
    assert pooled_severe == raw_severe
    assert expected == _severe_pct(raw_obs, raw_severe)

    # every per-day point's own severe_pct also equals the helper on ITS counts
    for p in daily:
        assert p.severe_pct == _severe_pct(p.observation_count, p.severe_count)
