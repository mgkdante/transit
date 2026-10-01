
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, timedelta

from sqlalchemy import text

from transit_ops.snapshots.builders._helpers import _wilson_lo
from transit_ops.snapshots.builders.historic.small_surfaces import (
    _repeat_offenders_by_grain,
    build_repeat_offenders,
)

_PROVIDER = "stm_dense_ro"
_ROUTE = "RO1"
_ANCHOR = date(2026, 6, 30)


@contextmanager
def _seeded(rows, real_db_engine, seed_provider):  # noqa: ANN001
    with real_db_engine.connect() as conn:
        tx = conn.begin()
        try:
            conn.execute(
                text("DELETE FROM gold.repeat_offender_daily_spine WHERE provider_id = :p"),
                {"p": _PROVIDER},
            )
            seed_provider(
                conn,
                _PROVIDER,
                display_name="dense repeat-offenders seed",
                ignore_existing=True,
            )
            ins = text(
                "INSERT INTO gold.repeat_offender_daily_spine (provider_id, entity_kind, "
                "entity_id, route_id, provider_local_date, observation_count, severe_delay_count, "
                "sum_delay_seconds) VALUES (:p, :k, :e, :r, :d, :n, :sev, :sum)"
            )
            for kind, eid, day, obs, severe, sum_sec in rows:
                conn.execute(
                    ins,
                    {
                        "p": _PROVIDER,
                        "k": kind,
                        "e": eid,
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


def _one_day(rows):  # noqa: ANN001
    return [(k, e, _ANCHOR, n, sev, sm) for (k, e, n, sev, sm) in rows]


def _week(grains):  # noqa: ANN001
    return next(g for g in grains if g.grain == "week")


def _month(grains):  # noqa: ANN001
    return next(g for g in grains if g.grain == "month")


def test_ranks_per_kind_by_not_severe_wilson_lower_bound(real_db_engine, seed_provider) -> None:
    with _seeded(
        _one_day(
            [
                ("trip", "T_BAD", 900, 360, 900 * 200),
                ("trip", "T_OK", 100, 20, 100 * 90),
                ("vehicle", "V_BAD", 200, 100, 200 * 220),
            ]
        ),
        real_db_engine,
        seed_provider,
    ) as conn:
        week = _week(_repeat_offenders_by_grain(conn, _PROVIDER, {}))
    trips = [e for e in week.entries if e.type == "trip"]
    vehs = [e for e in week.entries if e.type == "vehicle"]
    assert [e.id for e in trips] == ["T_BAD", "T_OK"]
    assert [e.rank for e in trips] == [1, 2]
    assert [e.rank for e in vehs] == [1]
    assert trips[0].wilson_lo < trips[1].wilson_lo


def test_min_n_floor_excludes_tiny_fluke(real_db_engine, seed_provider) -> None:
    assert _wilson_lo(0, 4) == 0.0
    with _seeded(
        _one_day(
            [
                ("trip", "fluke", 4, 4, 4 * 600),
                ("trip", "chronic", 900, 360, 900 * 200),
            ]
        ),
        real_db_engine,
        seed_provider,
    ) as conn:
        week = _week(_repeat_offenders_by_grain(conn, _PROVIDER, {}))
    ids = [e.id for e in week.entries]
    assert "fluke" not in ids
    assert ids == ["chronic"]


def test_recurrence_days_equals_distinct_severe_days_parity(real_db_engine, seed_provider) -> None:
    days = [_ANCHOR - timedelta(days=k) for k in range(4)]
    rows = [
        ("trip", "T", days[0], 30, 5, 30 * 200),
        ("trip", "T", days[1], 30, 8, 30 * 200),
        ("trip", "T", days[2], 30, 3, 30 * 200),
        ("trip", "T", days[3], 30, 0, 30 * 60),
    ]
    with _seeded(rows, real_db_engine, seed_provider) as conn:
        week = _week(_repeat_offenders_by_grain(conn, _PROVIDER, {}))
    entry = next(e for e in week.entries if e.id == "T")
    assert entry.recurrence_days == 3, (
        "recurrence_days must be DISTINCT severe days (3), not 16 severe or 4 days"
    )
    assert entry.observed_days == 4, "observed_days = DISTINCT observed dates (4)"
    assert entry.observation_count == 120


def test_sub_floor_tray_only_when_recurred(real_db_engine, seed_provider) -> None:
    days = [_ANCHOR, _ANCHOR - timedelta(days=1)]
    rows = [
        ("vehicle", "V_TRAY", days[0], 10, 3, 10 * 300),
        ("vehicle", "V_TRAY", days[1], 10, 2, 10 * 300),
        ("vehicle", "V_FLUKE", days[0], 5, 5, 5 * 600),
    ]
    with _seeded(rows, real_db_engine, seed_provider) as conn:
        week = _week(_repeat_offenders_by_grain(conn, _PROVIDER, {}))
    tray_ids = {e.id for e in week.tray}
    ranked_ids = {e.id for e in week.entries}
    assert tray_ids == {"V_TRAY"}
    assert "V_FLUKE" not in tray_ids and "V_FLUKE" not in ranked_ids
    tray_e = next(e for e in week.tray if e.id == "V_TRAY")
    assert tray_e.rank is None
    assert tray_e.recurrence_days == 2
    assert tray_e.wilson_lo is None


def test_avg_and_severity_from_own_window(real_db_engine, seed_provider) -> None:
    obs, severe, total = 60, 12, 60 * 660
    with _seeded(
        _one_day([("trip", "s1", obs, severe, total)]),
        real_db_engine,
        seed_provider,
    ) as conn:
        week = _week(_repeat_offenders_by_grain(conn, _PROVIDER, {}))
    e = next(x for x in week.entries if x.id == "s1")
    assert e.avg_delay_min == 11.0
    assert e.severe_pct == 20.0
    assert e.wilson_lo == _wilson_lo(obs - severe, obs)
    assert e.severity == "critical"


def test_window_days_and_grain_set(real_db_engine, seed_provider) -> None:
    with _seeded(
        _one_day([("trip", "t", 40, 8, 40 * 120)]),
        real_db_engine,
        seed_provider,
    ) as conn:
        grains = _repeat_offenders_by_grain(conn, _PROVIDER, {})
    by = {g.grain: g for g in grains}
    assert set(by) == {"week", "month"}, "repeat-offenders are week|month only (no 'day')"
    assert by["week"].window_days == 7
    assert by["month"].window_days == 30


def test_honest_absence_omits_grain(real_db_engine, seed_provider) -> None:
    with _seeded(
        _one_day([("trip", "tiny", 5, 1, 5 * 120)]),
        real_db_engine,
        seed_provider,
    ) as conn:
        assert _repeat_offenders_by_grain(conn, _PROVIDER, {}) == []


def test_end_to_end_build_emits_by_grain(real_db_engine, seed_provider) -> None:
    with _seeded(
        _one_day(
            [
                ("trip", "chronic", 900, 360, 900 * 200),
                ("vehicle", "vok", 100, 10, 100 * 90),
            ]
        ),
        real_db_engine,
        seed_provider,
    ) as conn:
        out = build_repeat_offenders(
            conn, provider_id=_PROVIDER, generated_utc="2026-06-30T00:00:00Z"
        )
    assert {g.grain for g in out.by_grain} == {"week", "month"}


def test_byte_ceiling_probe(real_db_engine, seed_provider) -> None:
    from transit_ops.snapshots.contract import REPEAT_OFFENDERS_BYTE_CEILING
    from transit_ops.snapshots.storage import _body

    rows = []
    for i in range(120):
        rows.append(("trip", f"T{i:03d}", _ANCHOR, 200, 200 - (i % 60), 200 * 300))
        rows.append(("vehicle", f"V{i:03d}", _ANCHOR, 200, 200 - (i % 60), 200 * 300))
    with _seeded(
        _one_day([(k, e, n, sev, sm) for (k, e, _d, n, sev, sm) in rows]),
        real_db_engine,
        seed_provider,
    ) as conn:
        out = build_repeat_offenders(
            conn, provider_id=_PROVIDER, generated_utc="2026-06-30T00:00:00Z"
        )
    size = len(_body(out))
    assert size <= REPEAT_OFFENDERS_BYTE_CEILING, (
        f"seeded repeat_offenders.json {size}B exceeds ceiling {REPEAT_OFFENDERS_BYTE_CEILING}B"
    )
    print(
        f"\n[S14 size probe] seeded repeat_offenders.json = {size} bytes "
        f"(ceiling {REPEAT_OFFENDERS_BYTE_CEILING})"
    )


def test_as_of_history_executes_one_closed_spine_stream_and_recomposes_windows(
    real_db_engine, seed_provider
) -> None:
    from transit_ops.snapshots.builders import historic

    days = [_ANCHOR - timedelta(days=offset) for offset in range(4)]
    rows = [
        ("trip", "T", days[0], 30, 5, 30 * 400),
        ("trip", "T", days[1], 30, 4, 30 * 400),
        ("trip", "T", days[2], 30, 3, 30 * 400),
        ("trip", "T", days[3], 30, 0, 30 * 100),
    ]
    with _seeded(rows, real_db_engine, seed_provider) as conn:
        payload = list(historic.build_repeat_offenders_history_plan(conn, _PROVIDER).iter_days())[
            -1
        ]

    assert payload.date == _ANCHOR.isoformat()
    assert [
        (value.id, value.recurrence_days, value.window_days) for value in payload.offenders
    ] == [("T", 3, 14)]
    week = _week(payload.by_grain)
    entry = next(value for value in week.entries if value.id == "T")
    assert entry.observation_count == 120
    assert entry.recurrence_days == 3
    assert entry.observed_days == 4
    assert week.date == (_ANCHOR - timedelta(days=6)).isoformat()
    assert week.window_end == _ANCHOR.isoformat()
