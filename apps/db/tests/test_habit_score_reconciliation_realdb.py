
from __future__ import annotations

from contextlib import contextmanager
from datetime import date

from sqlalchemy import text

from transit_ops.gold.reader import ROUTE_HABIT_SPINE_SQL, all_time_window

_PROVIDER = "stm_habit_recon"
_ROUTE = "R1"

_HIST_60 = "{" + ",".join(["60"] + ["0"] * 20) + "}"
_HIST_120 = "{" + ",".join(["70", "50"] + ["0"] * 19) + "}"
_HIST_ZERO = "{" + ",".join(["0"] * 21) + "}"

_SEED_ROWS = (
    (date(2026, 6, 1), 8, 60, 60, 58, 2, 3600, _HIST_60),
    (date(2026, 6, 8), 8, 60, 60, 55, 3, 5400, _HIST_60),
    (date(2026, 6, 2), 9, 120, 120, 100, 4, 9000, _HIST_120),
    (date(2026, 6, 3), 17, 5, 5, 5, 5, 0, _HIST_ZERO),
    (date(2026, 6, 4), 6, 40, 40, 40, 0, 1200, _HIST_60),
)

_ANCHOR = max(r[0] for r in _SEED_ROWS)


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
    with _seeded_conn(real_db_engine, seed_provider) as conn:
        reader = _reader_scores(conn)
        frozen = _frozen_scores(conn)
    assert frozen, "seed produced no frozen-mart rows"
    assert set(reader) == set(frozen), "cell key sets diverge (reader vs frozen mart)"
    for key in frozen:
        assert reader[key] == frozen[key], (
            f"cell {key}: reader {reader[key]} != frozen mart {frozen[key]}"
        )
    assert float(reader[(1, 8)]) == 51.25
    assert float(reader[(2, 9)]) == 41.25
    assert float(reader[(3, 17)]) == 50.0
    assert float(reader[(4, 6)]) == 0.3333


def test_mutation_killer_perturbed_divisor_breaks_parity(real_db_engine, seed_provider) -> None:
    with _seeded_conn(real_db_engine, seed_provider) as conn:
        reader = _reader_scores(conn)
        mutated = _frozen_scores(conn, div="61")
    assert any(reader[k] != mutated[k] for k in reader), (
        "perturbed /61 divisor did not change any score — mutation-killer is toothless"
    )
