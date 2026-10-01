
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, timedelta

from sqlalchemy import text

from transit_ops.snapshots.builders._helpers import _wilson_lo
from transit_ops.snapshots.builders.historic import build_route_reliability
from transit_ops.snapshots.builders.historic._spine import _weak_stops_by_grain

_PROVIDER = "stm_dense_ws"
_ROUTE = "WS1"
_D = date(2026, 6, 1)


@contextmanager
def _seeded_dated(rows, real_db_engine, seed_provider):  # noqa: ANN001
    with real_db_engine.connect() as conn:
        tx = conn.begin()
        try:
            conn.execute(
                text("DELETE FROM gold.stop_delay_spine WHERE provider_id = :p"), {"p": _PROVIDER}
            )
            seed_provider(
                conn,
                _PROVIDER,
                display_name="dense weak-stops seed",
                ignore_existing=True,
            )
            ins = text(
                "INSERT INTO gold.stop_delay_spine (provider_id, stop_id, route_id, "
                "provider_local_date, observation_count, severe_delay_count, sum_delay_seconds) "
                "VALUES (:p, :s, :r, :d, :n, :sev, :sum)"
            )
            for stop_id, day, obs, severe, sum_sec in rows:
                conn.execute(
                    ins,
                    {
                        "p": _PROVIDER,
                        "s": stop_id,
                        "r": _ROUTE,
                        "d": day,
                        "n": obs,
                        "sev": severe,
                        "sum": sum_sec,
                    },
                )
            yield conn
        finally:
            tx.rollback()


@contextmanager
def _seeded(rows, real_db_engine, seed_provider):  # noqa: ANN001
    with _seeded_dated(
        [(s, _D, n, sev, sm) for (s, n, sev, sm) in rows],
        real_db_engine,
        seed_provider,
    ) as conn:
        yield conn


def _params() -> dict:
    return {"provider_id": _PROVIDER, "route_id": _ROUTE}


def _month(grains):  # noqa: ANN001
    return next(g for g in grains if g.grain == "month")


def test_rank_ascending_by_not_severe_wilson_lower_bound(real_db_engine, seed_provider) -> None:
    with _seeded(
        [
            ("chronic", 900, 360, 900 * 200),
            ("occasional", 100, 20, 100 * 90),
        ],
        real_db_engine,
        seed_provider,
    ) as conn:
        grains = _weak_stops_by_grain(conn, _params(), {})
    stops = _month(grains).stops
    assert [s.id for s in stops] == ["chronic", "occasional"], "chronic high-n stop must rank worst"
    assert stops[0].wilson_lo < stops[1].wilson_lo


def test_rank_is_the_lower_bound_not_the_point_estimate(real_db_engine, seed_provider) -> None:
    assert _wilson_lo(20, 40) < _wilson_lo(200, 400), "precondition: equal p, smaller n -> lower LB"
    with _seeded(
        [
            (
                "small",
                40,
                20,
                40 * 180,
            ),
            ("big", 400, 200, 400 * 180),
        ],
        real_db_engine,
        seed_provider,
    ) as conn:
        stops = _month(_weak_stops_by_grain(conn, _params(), {})).stops
    assert [s.id for s in stops] == ["small", "big"], (
        "rank must use the LOWER bound, not the point estimate"
    )


def test_min_n_floor_excludes_tiny_fluke_not_merely_outranks_it(
    real_db_engine, seed_provider
) -> None:
    assert _wilson_lo(0, 4) == 0.0, "precondition: 4/4-severe not-severe LB is 0.0% (the footgun)"
    with _seeded(
        [
            ("fluke", 4, 4, 4 * 600),
            ("chronic", 900, 360, 900 * 200),
        ],
        real_db_engine,
        seed_provider,
    ) as conn:
        grains = _weak_stops_by_grain(conn, _params(), {})
    ids = [s.id for s in _month(grains).stops]
    assert "fluke" not in ids, (
        "MIN_N must EXCLUDE the sub-30 fluke (Wilson alone does not demote it)"
    )
    assert ids == ["chronic"], "only the MIN_N-clearing chronic stop survives, ranked #1"


def test_avg_and_wilson_fields_match_hand_computation(real_db_engine, seed_provider) -> None:
    obs, severe, total = 50, 10, 50 * 180
    with _seeded([("s1", obs, severe, total)], real_db_engine, seed_provider) as conn:
        stops = _month(_weak_stops_by_grain(conn, _params(), {})).stops
    s = stops[0]
    assert s.avg_delay_min == 3.0
    assert s.observation_count == obs
    assert s.severe_pct == 20.0
    assert s.wilson_lo == _wilson_lo(obs - severe, obs)
    assert s.wilson_hi is not None and s.wilson_lo < s.wilson_hi


def test_grain_with_no_qualifying_stop_is_omitted(real_db_engine, seed_provider) -> None:
    with _seeded(
        [("tiny", 10, 2, 10 * 120)], real_db_engine, seed_provider
    ) as conn:
        grains = _weak_stops_by_grain(conn, _params(), {})
    assert grains == []


def test_stored_cap_truncates_full_ranked_set_to_15(real_db_engine, seed_provider) -> None:
    rows = [(f"ws{i:02d}", 200, 200 - 10 * (i + 1), 200 * 150) for i in range(19, -1, -1)]
    with _seeded(rows, real_db_engine, seed_provider) as conn:
        stops = _month(_weak_stops_by_grain(conn, _params(), {})).stops
    assert len(stops) == 15
    assert [s.id for s in stops] == [f"ws{i:02d}" for i in range(15)]
    los = [s.wilson_lo for s in stops]
    assert los == sorted(los), "stored worst-N must be ascending by not-severe wilson_lo"


def test_window_boundaries_day_week_month_inclusive_edges(real_db_engine, seed_provider) -> None:
    anchor = date(2026, 6, 30)
    rows = [
        ("at_anchor", anchor, 40, 8, 40 * 120),
        ("wk_edge", anchor - timedelta(days=6), 40, 8, 40 * 120),
        ("before_wk", anchor - timedelta(days=7), 40, 8, 40 * 120),
        ("mo_edge", anchor - timedelta(days=29), 40, 8, 40 * 120),
        (
            "before_mo",
            anchor - timedelta(days=30),
            40,
            8,
            40 * 120,
        ),
    ]
    with _seeded_dated(rows, real_db_engine, seed_provider) as conn:
        grains = {
            g.grain: {s.id for s in g.stops} for g in _weak_stops_by_grain(conn, _params(), {})
        }
    assert grains.get("day") == {"at_anchor"}
    assert grains.get("week") == {"at_anchor", "wk_edge"}
    assert grains.get("month") == {"at_anchor", "wk_edge", "before_wk", "mo_edge"}
    assert all("before_mo" not in ids for ids in grains.values())


def test_end_to_end_build_route_reliability_emits_weak_stops_by_grain(
    real_db_engine, seed_provider
) -> None:
    with _seeded(
        [
            ("chronic", 900, 360, 900 * 200),
            ("ok", 100, 10, 100 * 90),
        ],
        real_db_engine,
        seed_provider,
    ) as conn:
        rel = build_route_reliability(
            conn,
            provider_id=_PROVIDER,
            route_id=_ROUTE,
            generated_utc="2026-06-25T00:00:00Z",
        )
    grains = {g.grain for g in rel.weak_stops_by_grain}
    assert grains == {"day", "week", "month"}, (
        "build_route_reliability must emit all windowed grains"
    )
    month = next(g for g in rel.weak_stops_by_grain if g.grain == "month")
    assert [s.id for s in month.stops] == ["chronic", "ok"], "ranked through the full build path"


def test_provider_scoping_isolates_routes(real_db_engine, seed_provider) -> None:
    with _seeded([("shared", 100, 40, 100 * 200)], real_db_engine, seed_provider) as conn:
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
