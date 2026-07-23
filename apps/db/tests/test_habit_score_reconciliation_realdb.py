"""S14 score-reconciliation parity gate (real-DB).

Proves the ONE reconciled repeat_problem_score (gold/reader ROUTE_HABIT_SPINE_SQL, read over
an ALL-TIME window — score.all_time_window) reproduces the DROPPED whole-history
gold.route_habit_score mart CELL-FOR-CELL, so re-pointing the scalar RouteReliability.habits
matrix off the mart onto the reader is value-lossless.

The mart is gone (migration 0076), so we cannot read it. Instead we embed a FROZEN copy of the
OLD mart's score SQL (the CTE + composite verbatim from the deleted UPSERT_ROUTE_HABIT_SCORE,
turned SELECT-shaped) and run BOTH against the SAME seeded gold.route_delay_spine. Equality
proves the reconciliation; a mutation-killer perturbs the frozen /60 divisor and asserts the
parity assertion then FAILS (the test would be worthless if it passed against a broken oracle).

Self-skips when TRANSIT_TEST_DATABASE_URL is unset (the `real-db-tests` job sets it):

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://postgres@127.0.0.1:54329/transit_test" \
        uv run pytest tests/test_habit_score_reconciliation_realdb.py -v
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date

from sqlalchemy import text

from transit_ops.gold.reader import ROUTE_HABIT_SPINE_SQL, all_time_window

_PROVIDER = "stm_habit_recon"
_ROUTE = "R1"

# 21-bin smallint[] delay histograms. The bin totals sum to the in-clamp delay count = the
# pooled-avg DENOMINATOR. The zero-histogram cell exercises the NULLIF divide-by-zero guard.
_HIST_60 = "{" + ",".join(["60"] + ["0"] * 20) + "}"  # in-clamp count = 60
_HIST_120 = "{" + ",".join(["70", "50"] + ["0"] * 19) + "}"  # in-clamp count = 120
_HIST_ZERO = "{" + ",".join(["0"] * 21) + "}"  # in-clamp count = 0 -> NULLIF -> NULL avg

# Multi-day / multi-hour / multi-dow spine seed. Two dates share (dow, hour) so the all-time
# aggregate SUMs across days; the zero-histogram row is a NULL-avg edge (severe-only score).
#   d, hour, obs, dobs, on_time, severe, sum_delay_seconds, histogram
_SEED_ROWS = (
    # Monday 2026-06-01 08:00 — normal cell (severe=2, in_clamp=60, sum=3600 -> avg=60s)
    (date(2026, 6, 1), 8, 60, 60, 58, 2, 3600, _HIST_60),
    # Monday 2026-06-08 08:00 — SAME (dow, hour) a week later; the all-time SUM merges both days
    (date(2026, 6, 8), 8, 60, 60, 55, 3, 5400, _HIST_60),
    # Tuesday 2026-06-02 09:00 — larger cell (in_clamp=120, sum=9000)
    (date(2026, 6, 2), 9, 120, 120, 100, 4, 9000, _HIST_120),
    # Wednesday 2026-06-03 17:00 — NULL-avg edge: zero histogram bins -> pooled avg NULL,
    # score = severe*10 only (COALESCE(NULL,0) contributes nothing)
    (date(2026, 6, 3), 17, 5, 5, 5, 5, 0, _HIST_ZERO),
    # Thursday 2026-06-04 06:00 — a genuinely calm cell (severe=0, small delay)
    (date(2026, 6, 4), 6, 40, 40, 40, 0, 1200, _HIST_60),
)

# Anchor = the newest seeded day; all_time_window(anchor) covers every seeded row.
_ANCHOR = max(r[0] for r in _SEED_ROWS)


# FROZEN copy of the OLD gold.route_habit_score mart score SQL (the CTE + composite verbatim
# from the deleted rollups.UPSERT_ROUTE_HABIT_SCORE, turned SELECT-shaped). {div} is the /60
# divisor — 60 in the real oracle; the mutation-killer swaps it to prove the parity check bites.
def _frozen_mart_sql(*, div: str = "60") -> str:
    return f"""
    WITH habit AS (
        SELECT
            sp.provider_id,
            sp.route_id,
            EXTRACT(ISODOW FROM sp.provider_local_date)::integer AS day_of_week_iso,
            sp.hour_of_day_local::integer AS hour_of_day_local,
            SUM(sp.observation_count)::integer AS observation_count,
            ROUND(
                SUM(sp.sum_delay_seconds)::numeric
                / NULLIF(SUM((SELECT COALESCE(SUM(x), 0)
                             FROM unnest(sp.delay_histogram) AS x)), 0),
                2
            ) AS avg_delay_seconds,
            SUM(sp.severe_delay_count)::integer AS severe_delay_count
        FROM gold.route_delay_spine AS sp
        WHERE sp.provider_id = :provider_id AND sp.route_id = :route_id
        GROUP BY 1, 2, 3, 4
    )
    SELECT
        day_of_week_iso,
        hour_of_day_local,
        LEAST(
            ROUND(
                (
                    severe_delay_count::numeric * 10
                    + GREATEST(COALESCE(avg_delay_seconds, 0), 0) / {div}
                ),
                4
            ),
            9999.9999
        ) AS repeat_problem_score
    FROM habit
    """


@contextmanager
def _seeded_conn(real_db_engine, seed_provider):  # noqa: ANN001, ANN202
    with real_db_engine.connect() as conn:
        tx = conn.begin()
        try:
            seed_provider(conn, _PROVIDER, display_name="habit recon seed")
            ins = text(
                "INSERT INTO gold.route_delay_spine (provider_id, route_id, provider_local_date, "
                "hour_of_day_local, direction_id, observation_count, delay_observation_count, "
                "on_time_observation_count, severe_delay_count, sum_delay_seconds, "
                "delay_histogram) "
                "VALUES (:p, :r, :d, :h, 0, :obs, :dobs, :ot, :sev, :sum, "
                "CAST(:hist AS smallint[]))"
            )
            for d, h, obs, dobs, ot, sev, s, hist in _SEED_ROWS:
                conn.execute(
                    ins,
                    {
                        "p": _PROVIDER,
                        "r": _ROUTE,
                        "d": d,
                        "h": h,
                        "obs": obs,
                        "dobs": dobs,
                        "ot": ot,
                        "sev": sev,
                        "sum": s,
                        "hist": hist,
                    },
                )
            yield conn
        finally:
            tx.rollback()


def _reader_scores(conn) -> dict:  # noqa: ANN001
    """The new all-time reader scores, keyed by (dow, hour)."""
    win_start, win_end = all_time_window(_ANCHOR)
    return {
        (int(r["day_of_week_iso"]), int(r["hour_of_day_local"])): r["repeat_problem_score"]
        for r in conn.execute(
            ROUTE_HABIT_SPINE_SQL,
            {
                "provider_id": _PROVIDER,
                "route_id": _ROUTE,
                "win_start": win_start,
                "win_end": win_end,
            },
        ).mappings()
    }


def _frozen_scores(conn, *, div: str = "60") -> dict:  # noqa: ANN001
    return {
        (int(r["day_of_week_iso"]), int(r["hour_of_day_local"])): r["repeat_problem_score"]
        for r in conn.execute(
            text(_frozen_mart_sql(div=div)),
            {"provider_id": _PROVIDER, "route_id": _ROUTE},
        ).mappings()
    }


def test_all_time_reader_matches_frozen_mart_cell_for_cell(real_db_engine, seed_provider) -> None:
    """The reconciled all-time reader score == the OLD mart's score for every (dow, hour) cell
    (numeric equality), including the NULL-avg (zero-histogram) severe-only edge."""
    with _seeded_conn(real_db_engine, seed_provider) as conn:
        reader = _reader_scores(conn)
        frozen = _frozen_scores(conn)
    assert frozen, "seed produced no frozen-mart rows"
    assert set(reader) == set(frozen), "cell key sets diverge (reader vs frozen mart)"
    for key in frozen:
        # Numeric equality (Decimal == Decimal) — both paths clamp + ROUND server-side.
        assert reader[key] == frozen[key], (
            f"cell {key}: reader {reader[key]} != frozen mart {frozen[key]}"
        )
    # Anchor the expected values so a silent formula drift on BOTH paths is still caught:
    #   Mon 08: severe=2+3=5, sum=3600+5400=9000, in_clamp=120 -> avg=75.0 -> 50 + 75/60 = 51.25
    #   Tue 09: severe=4, sum=9000, in_clamp=120 -> avg=75.0 -> 40 + 75/60 = 41.25
    #   Wed 17: severe=5, zero histogram -> avg NULL -> 50 + 0 = 50.0 (NULL-avg edge)
    #   Thu 06: severe=0, sum=1200, in_clamp=60 -> avg=20.0 -> 0 + 20/60 = 0.3333
    assert float(reader[(1, 8)]) == 51.25
    assert float(reader[(2, 9)]) == 41.25
    assert float(reader[(3, 17)]) == 50.0  # severe-only, NULL avg contributes nothing
    assert float(reader[(4, 6)]) == 0.3333


def test_mutation_killer_perturbed_divisor_breaks_parity(real_db_engine, seed_provider) -> None:
    """Sanity: perturbing the frozen mart's /60 divisor to /61 makes the frozen scores diverge
    from the reader, so the parity assertion above would FAIL. Proves the oracle is load-bearing
    (not a vacuous tautology)."""
    with _seeded_conn(real_db_engine, seed_provider) as conn:
        reader = _reader_scores(conn)
        mutated = _frozen_scores(conn, div="61")
    # At least one non-NULL-avg cell must diverge under the perturbed divisor.
    assert any(reader[k] != mutated[k] for k in reader), (
        "perturbed /61 divisor did not change any score — mutation-killer is toothless"
    )
