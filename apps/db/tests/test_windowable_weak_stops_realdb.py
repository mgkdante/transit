"""Real-DB recompose gate for the S7-B windowable §4 weak-stops build (DB-PR-3).

Self-skips when TRANSIT_TEST_DATABASE_URL is unset. Seeds gold.stop_delay_spine DIRECTLY (the
recompose reads only that table) with rows that CLEAR MIN_N (>=30 obs/stop/window), so the ranking
+ Wilson paths run real assertions (the DB-PR-1 lesson: a too-sparse seed makes them vacuous). The
MIN_N-footgun test is the mutation killer: deleting the `if obs < _MIN_N_WEAK_STOP: continue` line
must flip it red (a 4-of-4-severe fluke pins the not-severe Wilson LB at 0.0% and would rank #1).
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine, text
from test_spine_cutover_gate import DB_URL  # noqa: E402

from transit_ops.snapshots.builders._helpers import _wilson_lo
from transit_ops.snapshots.builders.historic import _weak_stops_by_grain, build_route_reliability

pytestmark = pytest.mark.skipif(
    not DB_URL, reason="TRANSIT_TEST_DATABASE_URL not set - windowable weak-stops real-DB gate skipped"
)

_PROVIDER = "stm_dense_ws"
_ROUTE = "WS1"
_D = date(2026, 6, 1)  # one date inside every grain window (anchor = max(date) = _D)


@contextmanager
def _seeded_dated(rows):  # noqa: ANN001
    """rows = list of (stop_id, provider_local_date, observation_count, severe_delay_count,
    sum_delay_seconds). Rollback-isolated; ALSO clears any leftover committed rows for this
    provider/route at entry so a stale row can never silently inflate a window past MIN_N (the
    review's pollution-defeat finding) — the DELETE is in-tx, so it only scopes THIS test's read."""
    engine = create_engine(DB_URL)
    with engine.connect() as conn:
        tx = conn.begin()
        try:
            conn.execute(text("DELETE FROM gold.stop_delay_spine WHERE provider_id = :p"),
                         {"p": _PROVIDER})
            conn.execute(
                text(
                    "INSERT INTO core.providers (provider_id, display_name, timezone, provider_key) "
                    "VALUES (:p, 'dense weak-stops seed', 'America/Toronto', :p) "
                    "ON CONFLICT (provider_id) DO NOTHING"
                ),
                {"p": _PROVIDER},
            )
            ins = text(
                "INSERT INTO gold.stop_delay_spine (provider_id, stop_id, route_id, "
                "provider_local_date, observation_count, severe_delay_count, sum_delay_seconds) "
                "VALUES (:p, :s, :r, :d, :n, :sev, :sum)"
            )
            for stop_id, day, obs, severe, sum_sec in rows:
                conn.execute(
                    ins,
                    {"p": _PROVIDER, "s": stop_id, "r": _ROUTE, "d": day,
                     "n": obs, "sev": severe, "sum": sum_sec},
                )
            yield conn
        finally:
            tx.rollback()
    engine.dispose()


@contextmanager
def _seeded(rows):  # noqa: ANN001
    """rows = list of (stop_id, observation_count, severe_delay_count, sum_delay_seconds). One date (_D)."""
    with _seeded_dated([(s, _D, n, sev, sm) for (s, n, sev, sm) in rows]) as conn:
        yield conn


def _params() -> dict:
    return {"provider_id": _PROVIDER, "route_id": _ROUTE}


def _month(grains):  # noqa: ANN001
    return next(g for g in grains if g.grain == "month")


def test_rank_ascending_by_not_severe_wilson_lower_bound() -> None:
    """A high-n chronic-severe stop ranks WORSE (lower not-severe Wilson LB) than a low-n
    occasional stop — the doctrine: rank by the lower confidence bound, never the point estimate."""
    # chronic: 900 obs, 360 severe (40% severe) -> not-severe LB ~56.7%
    # occasional: 100 obs, 20 severe (20% severe) -> not-severe LB ~71.5%
    with _seeded([
        ("chronic", 900, 360, 900 * 200),
        ("occasional", 100, 20, 100 * 90),
    ]) as conn:
        grains = _weak_stops_by_grain(conn, _params(), {})
    stops = _month(grains).stops
    assert [s.id for s in stops] == ["chronic", "occasional"], "chronic high-n stop must rank worst"
    assert stops[0].wilson_lo < stops[1].wilson_lo  # ASC: worst (lowest LB) first


def test_rank_is_the_lower_bound_not_the_point_estimate() -> None:
    """B1 (diff-review): the rank MUST be the Wilson LOWER bound, not the not-severe POINT estimate.
    Two MIN_N-clearing stops with the SAME not-severe point estimate (50%) but different n: under the
    lower bound the smaller-n stop ranks WORSE (wider interval -> lower LB); under the point estimate
    they tie and fall back to the (equal-avg) id tie-break, flipping the order. This reds a
    `rank on (100*severe_k/obs)` mutation that the other recompose tests do NOT catch."""
    # small: 40 obs / 20 severe -> not-severe 50%, wilson_lo 35.2 ; big: 400/200 -> 50%, wilson_lo 45.1
    assert _wilson_lo(20, 40) < _wilson_lo(200, 400), "precondition: equal p, smaller n -> lower LB"
    with _seeded([
        ("small", 40, 20, 40 * 180),    # avg 180s = 3.0 min (same as big -> avg tie-break is neutral)
        ("big", 400, 200, 400 * 180),
    ]) as conn:
        stops = _month(_weak_stops_by_grain(conn, _params(), {})).stops
    # lower bound: small (35.2) ranks worse than big (45.1). A point-estimate rank would tie at 50%
    # and break by id ASC -> ["big", "small"], which this assertion rejects.
    assert [s.id for s in stops] == ["small", "big"], "rank must use the LOWER bound, not the point estimate"


def test_min_n_floor_excludes_tiny_fluke_not_merely_outranks_it() -> None:
    """THE MUTATION KILLER. A 4-of-4-severe fluke pins the not-severe Wilson LB at EXACTLY 0.0%
    (n-independent boundary) -> WITHOUT the MIN_N exclude it would rank #1 worst, beating a 900-obs
    chronic offender. With the MIN_N=30 hard floor it is OMITTED entirely. Deleting the
    `if obs < _MIN_N_WEAK_STOP: continue` line in _weak_stops_by_grain must flip this red."""
    assert _wilson_lo(0, 4) == 0.0, "precondition: 4/4-severe not-severe LB is 0.0% (the footgun)"
    with _seeded([
        ("fluke", 4, 4, 4 * 600),          # n<30, would-be wilson_lo 0.0 -> rank #1 if not excluded
        ("chronic", 900, 360, 900 * 200),  # the real worst offender that clears MIN_N
    ]) as conn:
        grains = _weak_stops_by_grain(conn, _params(), {})
    ids = [s.id for s in _month(grains).stops]
    assert "fluke" not in ids, "MIN_N must EXCLUDE the sub-30 fluke (Wilson alone does not demote it)"
    assert ids == ["chronic"], "only the MIN_N-clearing chronic stop survives, ranked #1"


def test_avg_and_wilson_fields_match_hand_computation() -> None:
    """avg_delay_min = round(sum/obs/60, 1); wilson_lo/wilson_hi = the not-severe Wilson interval."""
    obs, severe, total = 50, 10, 50 * 180  # avg 180s = 3.0 min; not-severe k = 40
    with _seeded([("s1", obs, severe, total)]) as conn:
        stops = _month(_weak_stops_by_grain(conn, _params(), {})).stops
    s = stops[0]
    assert s.avg_delay_min == 3.0
    assert s.observation_count == obs
    assert s.severe_pct == 20.0
    assert s.wilson_lo == _wilson_lo(obs - severe, obs)  # exact (same helper, same args)
    assert s.wilson_hi is not None and s.wilson_lo < s.wilson_hi


def test_grain_with_no_qualifying_stop_is_omitted() -> None:
    """Honest absence: when no stop clears MIN_N in any window, every grain is OMITTED (empty list),
    never a fabricated bucket with avg=0."""
    with _seeded([("tiny", 10, 2, 10 * 120)]) as conn:  # obs 10 < 30 -> never qualifies
        grains = _weak_stops_by_grain(conn, _params(), {})
    assert grains == []


def test_stored_cap_truncates_full_ranked_set_to_15() -> None:
    """Rank the FULL window set, THEN truncate to the stored cap (15) — so a smaller display-N never
    rescales. Seed 20 qualifying stops with strictly increasing not-severe rate -> the 15 WORST
    (lowest wilson_lo) are kept, in ascending order."""
    # stop i: obs=200, severe = 200 - 10*(i+1)  -> not-severe count rises with i -> wilson_lo rises;
    # so stop 0 (fewest not-severe) is worst. Keep the 15 lowest-LB -> ids ws00..ws14.
    # SEED BEST-FIRST (ws19..ws00) so the rows' insert/physical order is ANTI-correlated with rank:
    # a truncate-BEFORE-rank bug would keep the first-returned (the BEST) stops; only rank-then-
    # truncate yields the worst 15 (ws00..ws14). (review SF3)
    rows = [(f"ws{i:02d}", 200, 200 - 10 * (i + 1), 200 * 150) for i in range(19, -1, -1)]
    with _seeded(rows) as conn:
        stops = _month(_weak_stops_by_grain(conn, _params(), {})).stops
    assert len(stops) == 15
    assert [s.id for s in stops] == [f"ws{i:02d}" for i in range(15)]
    los = [s.wilson_lo for s in stops]
    assert los == sorted(los), "stored worst-N must be ascending by not-severe wilson_lo"


def test_window_boundaries_day_week_month_inclusive_edges() -> None:
    """SF5 (diff-review): the trailing windows are date-INCLUSIVE on the right edges. anchor =
    MAX(provider_local_date); day=[anchor,anchor], week=[anchor-6,anchor], month=[anchor-29,anchor].
    Each boundary stop (>=MIN_N obs on ONE date) must land in exactly the grains whose window covers
    its date — pinning the `provider_local_date BETWEEN win_start AND win_end` edges (off-by-one bait)."""
    anchor = date(2026, 6, 30)
    rows = [
        ("at_anchor", anchor, 40, 8, 40 * 120),                       # day, week, month
        ("wk_edge", anchor - timedelta(days=6), 40, 8, 40 * 120),     # week, month (NOT day)
        ("before_wk", anchor - timedelta(days=7), 40, 8, 40 * 120),   # month (NOT week, NOT day)
        ("mo_edge", anchor - timedelta(days=29), 40, 8, 40 * 120),    # month (NOT week, NOT day)
        ("before_mo", anchor - timedelta(days=30), 40, 8, 40 * 120),  # NONE (outside the month window)
    ]
    with _seeded_dated(rows) as conn:
        grains = {g.grain: {s.id for s in g.stops} for g in _weak_stops_by_grain(conn, _params(), {})}
    assert grains.get("day") == {"at_anchor"}
    assert grains.get("week") == {"at_anchor", "wk_edge"}
    assert grains.get("month") == {"at_anchor", "wk_edge", "before_wk", "mo_edge"}
    # before_mo (anchor-30) is outside every window -> appears in NO grain (honest exclusion).
    assert all("before_mo" not in ids for ids in grains.values())


def test_end_to_end_build_route_reliability_emits_weak_stops_by_grain() -> None:
    """Wiring gate: build_route_reliability() (the full publisher path, NOT a direct _weak_stops_by_grain
    call) must call the recompose AND pass it to the RouteReliability constructor. A missing call or a
    dropped kwarg leaves weak_stops_by_grain=[] -> this fails. Seed clears MIN_N so the path is real."""
    with _seeded([
        ("chronic", 900, 360, 900 * 200),
        ("ok", 100, 10, 100 * 90),
    ]) as conn:
        rel = build_route_reliability(
            conn, provider_id=_PROVIDER, route_id=_ROUTE, generated_utc="2026-06-25T00:00:00Z",
        )
    grains = {g.grain for g in rel.weak_stops_by_grain}
    assert grains == {"day", "week", "month"}, "build_route_reliability must emit all windowed grains"
    month = next(g for g in rel.weak_stops_by_grain if g.grain == "month")
    assert [s.id for s in month.stops] == ["chronic", "ok"], "ranked through the full build path"


def test_provider_scoping_isolates_routes() -> None:
    """The window read is scoped by (provider_id, route_id): a different route's rows never leak."""
    with _seeded([("shared", 100, 40, 100 * 200)]) as conn:
        conn.execute(
            text(
                "INSERT INTO gold.stop_delay_spine (provider_id, stop_id, route_id, "
                "provider_local_date, observation_count, severe_delay_count, sum_delay_seconds) "
                "VALUES (:p, 'other', 'OTHER_ROUTE', :d, 500, 250, 100000)"
            ),
            {"p": _PROVIDER, "d": _D},
        )
        ids = [s.id for s in _month(_weak_stops_by_grain(conn, _params(), {})).stops]
    assert ids == ["shared"], "a different route's stop must not leak into this route's weak-stops"
