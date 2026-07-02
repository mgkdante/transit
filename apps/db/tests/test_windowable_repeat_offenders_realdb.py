"""Real-DB recompose gate for the S14 windowable repeat-offenders build (DB lane D3).

Self-skips when TRANSIT_TEST_DATABASE_URL is unset. Seeds gold.repeat_offender_daily_spine DIRECTLY
(the recompose reads only that table) with rows that CLEAR MIN_N (>=30 obs/entity/window), so the
ranking + Wilson paths run real assertions (the DB-PR-1 lesson: a too-sparse seed makes them
vacuous). Two mutation killers:
  * the MIN_N footgun (a 4-of-4-severe fluke pins the not-severe Wilson LB at 0.0% and would rank #1
    without the `if obs < _MIN_N_OFFENDER` exclude), and
  * the recurrence_days PARITY invariant: recurrence_days == COUNT(DISTINCT date WHERE the entity was
    severe that day) over the window, seeded across multiple dated rows so a wrong aggregation
    (SUM of severe days, or an un-DISTINCT count) reds.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine, text
from test_spine_cutover_gate import DB_URL  # noqa: E402

from transit_ops.snapshots.builders._helpers import _wilson_lo
from transit_ops.snapshots.builders.historic.small_surfaces import (
    _repeat_offenders_by_grain,
    build_repeat_offenders,
)

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set - windowable repeat-offenders real-DB gate skipped",
)

_PROVIDER = "stm_dense_ro"
_ROUTE = "RO1"
_ANCHOR = date(2026, 6, 30)  # week window = [anchor-6, anchor]; month = [anchor-29, anchor]


@contextmanager
def _seeded(rows):  # noqa: ANN001
    """rows = list of (entity_kind, entity_id, provider_local_date, obs, severe, sum_delay_seconds).
    Rollback-isolated; clears any leftover committed rows for this provider at entry so a stale row
    can never inflate a window past MIN_N (the pollution-defeat guard). The DELETE is in-tx."""
    engine = create_engine(DB_URL)
    with engine.connect() as conn:
        tx = conn.begin()
        try:
            conn.execute(
                text("DELETE FROM gold.repeat_offender_daily_spine WHERE provider_id = :p"),
                {"p": _PROVIDER},
            )
            conn.execute(
                text(
                    "INSERT INTO core.providers (provider_id, display_name, timezone, provider_key) "
                    "VALUES (:p, 'dense repeat-offenders seed', 'America/Toronto', :p) "
                    "ON CONFLICT (provider_id) DO NOTHING"
                ),
                {"p": _PROVIDER},
            )
            ins = text(
                "INSERT INTO gold.repeat_offender_daily_spine (provider_id, entity_kind, "
                "entity_id, route_id, provider_local_date, observation_count, severe_delay_count, "
                "sum_delay_seconds) VALUES (:p, :k, :e, :r, :d, :n, :sev, :sum)"
            )
            for kind, eid, day, obs, severe, sum_sec in rows:
                conn.execute(
                    ins,
                    {"p": _PROVIDER, "k": kind, "e": eid, "r": _ROUTE, "d": day,
                     "n": obs, "sev": severe, "sum": sum_sec},
                )
            yield conn
        finally:
            tx.rollback()
    engine.dispose()


def _one_day(rows):  # noqa: ANN001
    """rows = (kind, eid, obs, severe, sum) on the single anchor date."""
    return [(k, e, _ANCHOR, n, sev, sm) for (k, e, n, sev, sm) in rows]


def _week(grains):  # noqa: ANN001
    return next(g for g in grains if g.grain == "week")


def _month(grains):  # noqa: ANN001
    return next(g for g in grains if g.grain == "month")


def test_ranks_per_kind_by_not_severe_wilson_lower_bound() -> None:
    """trip and vehicle rank on SEPARATE ladders (rank restarts per kind); within a kind the
    high-n chronic-severe entity ranks worse (lower not-severe Wilson LB)."""
    with _seeded(_one_day([
        ("trip", "T_BAD", 900, 360, 900 * 200),   # 40% severe
        ("trip", "T_OK", 100, 20, 100 * 90),      # 20% severe
        ("vehicle", "V_BAD", 200, 100, 200 * 220),
    ])) as conn:
        week = _week(_repeat_offenders_by_grain(conn, _PROVIDER, {}))
    trips = [e for e in week.entries if e.type == "trip"]
    vehs = [e for e in week.entries if e.type == "vehicle"]
    assert [e.id for e in trips] == ["T_BAD", "T_OK"]
    assert [e.rank for e in trips] == [1, 2]     # rank restarts per kind
    assert [e.rank for e in vehs] == [1]
    assert trips[0].wilson_lo < trips[1].wilson_lo


def test_min_n_floor_excludes_tiny_fluke() -> None:
    """THE MUTATION KILLER. A 4-of-4-severe fluke pins the not-severe Wilson LB at 0.0% and would
    rank #1 without the MIN_N=30 exclude. Deleting `if obs < _MIN_N_OFFENDER` must red this."""
    assert _wilson_lo(0, 4) == 0.0
    with _seeded(_one_day([
        ("trip", "fluke", 4, 4, 4 * 600),           # n<30 -> excluded from ranking
        ("trip", "chronic", 900, 360, 900 * 200),   # clears MIN_N
    ])) as conn:
        week = _week(_repeat_offenders_by_grain(conn, _PROVIDER, {}))
    ids = [e.id for e in week.entries]
    assert "fluke" not in ids
    assert ids == ["chronic"]


def test_recurrence_days_equals_distinct_severe_days_parity() -> None:
    """PARITY (the 0075 invariant): recurrence_days == COUNT(DISTINCT date WHERE severe that day)
    over the window. Seed one entity across 4 distinct dates, 3 of them severe (>=1 severe obs) and
    1 clean, ALL inside the week window. A correct build reports recurrence_days=3, observed_days=4.
    A SUM-of-severe-days or an un-DISTINCT count would report a different number."""
    days = [_ANCHOR - timedelta(days=k) for k in range(4)]  # 4 distinct dates in the week window
    rows = [
        # 3 severe days (severe_delay_count > 0) + 1 clean day (severe = 0). Each day >=? obs; the
        # WINDOW sum clears MIN_N (4 x 30 = 120 obs).
        ("trip", "T", days[0], 30, 5, 30 * 200),   # severe day
        ("trip", "T", days[1], 30, 8, 30 * 200),   # severe day
        ("trip", "T", days[2], 30, 3, 30 * 200),   # severe day
        ("trip", "T", days[3], 30, 0, 30 * 60),    # CLEAN day (0 severe) -> not counted
    ]
    with _seeded(rows) as conn:
        week = _week(_repeat_offenders_by_grain(conn, _PROVIDER, {}))
    entry = next(e for e in week.entries if e.id == "T")
    assert entry.recurrence_days == 3, "recurrence_days must be DISTINCT severe days (3), not 16 severe or 4 days"
    assert entry.observed_days == 4, "observed_days = DISTINCT observed dates (4)"
    assert entry.observation_count == 120  # 30 x 4 days summed over the window


def test_sub_floor_tray_only_when_recurred() -> None:
    """A sub-MIN_N entity reaches the tray ONLY if it recurred (recurrence_days>=2); a single-day
    sub-floor fluke is dropped. Seed a 2-severe-day sub-floor entity and a 1-day sub-floor fluke."""
    days = [_ANCHOR, _ANCHOR - timedelta(days=1)]
    rows = [
        ("vehicle", "V_TRAY", days[0], 10, 3, 10 * 300),  # sub-floor, day 1 severe
        ("vehicle", "V_TRAY", days[1], 10, 2, 10 * 300),  # sub-floor, day 2 severe -> recurrence 2
        ("vehicle", "V_FLUKE", days[0], 5, 5, 5 * 600),   # sub-floor, single severe day -> dropped
    ]
    with _seeded(rows) as conn:
        week = _week(_repeat_offenders_by_grain(conn, _PROVIDER, {}))
    tray_ids = {e.id for e in week.tray}
    ranked_ids = {e.id for e in week.entries}
    assert tray_ids == {"V_TRAY"}
    assert "V_FLUKE" not in tray_ids and "V_FLUKE" not in ranked_ids
    tray_e = next(e for e in week.tray if e.id == "V_TRAY")
    assert tray_e.rank is None
    assert tray_e.recurrence_days == 2
    assert tray_e.wilson_lo is None  # uninformative below the floor


def test_avg_and_severity_from_own_window() -> None:
    """avg_delay_min = round(Σsum/Σobs/60,1); severity uses the mart vocabulary on the entry's own
    window (recurrence>=10 OR avg>600 critical; >=5 high; else watch)."""
    obs, severe, total = 60, 12, 60 * 660  # avg 660s = 11.0 min (> 600 -> critical)
    with _seeded(_one_day([("trip", "s1", obs, severe, total)])) as conn:
        week = _week(_repeat_offenders_by_grain(conn, _PROVIDER, {}))
    e = next(x for x in week.entries if x.id == "s1")
    assert e.avg_delay_min == 11.0
    assert e.severe_pct == 20.0
    assert e.wilson_lo == _wilson_lo(obs - severe, obs)
    assert e.severity == "critical"  # avg 660s > 600s


def test_window_days_and_grain_set() -> None:
    """Grains are week (window_days=7) + month (window_days=30) ONLY — never a 'day' grain."""
    with _seeded(_one_day([("trip", "t", 40, 8, 40 * 120)])) as conn:
        grains = _repeat_offenders_by_grain(conn, _PROVIDER, {})
    by = {g.grain: g for g in grains}
    assert set(by) == {"week", "month"}, "repeat-offenders are week|month only (no 'day')"
    assert by["week"].window_days == 7
    assert by["month"].window_days == 30


def test_honest_absence_omits_grain() -> None:
    """No qualifying entity -> the grain is OMITTED; an empty spine -> no grains at all."""
    with _seeded(_one_day([("trip", "tiny", 5, 1, 5 * 120)])) as conn:  # sub-floor, 1 day -> dropped
        assert _repeat_offenders_by_grain(conn, _PROVIDER, {}) == []


def test_end_to_end_build_emits_by_grain() -> None:
    """Wiring gate: build_repeat_offenders() (the full publisher path) must recompose + attach
    by_grain. A missing call or dropped kwarg leaves by_grain=[] -> this fails."""
    with _seeded(_one_day([
        ("trip", "chronic", 900, 360, 900 * 200),
        ("vehicle", "vok", 100, 10, 100 * 90),
    ])) as conn:
        out = build_repeat_offenders(conn, provider_id=_PROVIDER, generated_utc="2026-06-30T00:00:00Z")
    assert {g.grain for g in out.by_grain} == {"week", "month"}


def test_byte_ceiling_probe() -> None:
    """S14 real-DB size probe: the full published repeat_offenders.json (scalar + by_grain) off a
    dense seed stays under REPEAT_OFFENDERS_BYTE_CEILING. Prints the measured size as a gauge."""
    from transit_ops.snapshots.contract import REPEAT_OFFENDERS_BYTE_CEILING
    from transit_ops.snapshots.storage import _body

    # a wide dense seed: 120 trips + 120 vehicles clearing MIN_N across the month window.
    rows = []
    for i in range(120):
        rows.append(("trip", f"T{i:03d}", _ANCHOR, 200, 200 - (i % 60), 200 * 300))
        rows.append(("vehicle", f"V{i:03d}", _ANCHOR, 200, 200 - (i % 60), 200 * 300))
    with _seeded(_one_day([(k, e, n, sev, sm) for (k, e, _d, n, sev, sm) in rows])) as conn:
        out = build_repeat_offenders(conn, provider_id=_PROVIDER, generated_utc="2026-06-30T00:00:00Z")
    size = len(_body(out))
    assert size <= REPEAT_OFFENDERS_BYTE_CEILING, (
        f"seeded repeat_offenders.json {size}B exceeds ceiling {REPEAT_OFFENDERS_BYTE_CEILING}B"
    )
    print(f"\n[S14 size probe] seeded repeat_offenders.json = {size} bytes "
          f"(ceiling {REPEAT_OFFENDERS_BYTE_CEILING})")
