"""Real-DB fact-vs-spine regression for the route delay cube (S7-B PR1 Task 3).

Proves the publisher projector reads gold.route_delay_spine and reproduces the
delay-cube breakdowns (weekly / monthly / by_shift / by_daytype / day_of_week /
crosstab) BYTE-IDENTICALLY on the count + share fields, while allowing only
{avg_delay_min, p50_min, p90_min} to move. This is the live precursor to the
Task 4 frozen-golden cutover gate.

Runs ONLY against a disposable Postgres migrated to head (incl. 0063); self-skips
when TRANSIT_TEST_DATABASE_URL is unset so the offline gate stays green:

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://postgres@127.0.0.1:54329/transit_test" \
        uv run pytest tests/test_route_delay_folds_real_db_regression.py -v

One build_warm_rollups call builds BOTH the fact fold tables (5m -> route_delay_hourly
-> by_shift/by_daytype/weekly/monthly/day_of_week/crosstab) AND the spine, so the two
render paths see identical seeded data. The seed uses CLOSED days inside the reporting
open window (the spine excludes today; the fold feeder's open window is the last
~10 days) so both paths cover the exact same days. feed_timestamp_utc == captured_at_utc
(the common case): the spine's date is feed-derived and the fold's is captured-derived,
which only diverge for sub-minute-lagged rows straddling a local-midnight boundary.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, text

from transit_ops.gold import rollups
from transit_ops.settings import Settings
from transit_ops.snapshots.builders.historic import build_route_reliability

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set - folds real-DB regression skipped",
)

PROVIDER = "stm_folds_test"
ENDPOINT_ID = 996001
ROUTE = "99F"
TORONTO = ZoneInfo("America/Toronto")

# Fields the gate FREEZES byte-identical between fact and spine.
_FROZEN_PERIOD = ("otp_pct", "severe_pct")
_FROZEN_DOW = ("severe_pct", "observation_count")
_FROZEN_CROSSTAB = ("otp_pct", "severe_pct", "observation_count")
# Fields the gate ALLOWS to move (rebaseline): pooled avg + CDF-interp percentiles.
_ALLOW_MOVE = ("avg_delay_min", "p50_min", "p90_min")


class _NoCommitEngine:
    def __init__(self, connection) -> None:  # noqa: ANN001
        self._connection = connection

    @contextmanager
    def begin(self):  # noqa: ANN201
        yield self._connection


def _build(connection) -> None:  # noqa: ANN001
    rollups.build_warm_rollups(
        PROVIDER,
        settings=Settings.model_construct(DATABASE_URL=None),
        engine=_NoCommitEngine(connection),
    )


@pytest.fixture()
def conn():
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        _seed(connection)
        _build(connection)
        try:
            yield connection
        finally:
            transaction.rollback()
        engine.dispose()


class _Counter:
    def __init__(self, start: int) -> None:
        self.value = start

    def next(self) -> int:
        self.value += 1
        return self.value


def _seed(connection) -> None:  # noqa: ANN001
    connection.execute(
        text(
            "INSERT INTO core.providers (provider_id, display_name, timezone, provider_key) "
            "VALUES (:p, 'STM folds regression', 'America/Toronto', :p)"
        ),
        {"p": PROVIDER},
    )
    connection.execute(
        text(
            "INSERT INTO core.feed_endpoints "
            "(feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format) "
            "VALUES (:eid, :p, 'trip_updates', 'trip_updates', 'gtfs_rt_trip_updates')"
        ),
        {"eid": ENDPOINT_ID, "p": PROVIDER},
    )

    ids = _Counter(996100)
    today = datetime.now(TORONTO).date()
    # 8 consecutive CLOSED days (offsets 1..8): always spans >=1 weekend + >=1
    # weekday + an ISO-week boundary, and stays inside the ~10d open window.
    for offset in range(1, 9):
        local_date = today - timedelta(days=offset)
        # am_peak (hour 7) dir 0 — on-time + late mix.
        _insert_snapshot(connection, ids, local_date, 7, [(-30, 0), (60, 0), (200, 0)])
        # pm_peak (hour 17) dir 1 — a severe (>300) + an on-time.
        _insert_snapshot(connection, ids, local_date, 17, [(400, 1), (90, 1)])

    # Adversarial direction-split hour on one closed day (offset 3, midday/hour 10):
    # dir 0 has real delays; dir 1 has observations but NO delays (NULL delay_seconds).
    # In the fact path route_delay_hourly merges directions, so its on-time count is
    # non-null; the spine stores dir1 on_time=NULL (delay_obs=0). Plain SUM(on_time)
    # must reproduce the fold's otp_pct -> this is the exact case the review flagged.
    split_day = today - timedelta(days=3)
    _insert_snapshot(
        connection, ids, split_day, 10,
        [(120, 0), (350, 0), (None, 1), (None, 1)],
    )


def _insert_snapshot(connection, ids, local_date, hour, rows) -> None:  # noqa: ANN001
    """Insert one feed snapshot of fact rows at a provider-local date + hour.

    feed_timestamp_utc == captured_at_utc (the common case). rows = (delay, direction).
    """
    captured_at = datetime.combine(local_date, time(hour, 0), tzinfo=TORONTO).astimezone(UTC)
    snapshot_id = ids.next()
    run_id = ids.next()
    connection.execute(
        text(
            "INSERT INTO raw.ingestion_runs "
            "(ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status) "
            "VALUES (:r, :p, :e, 'trip_updates', 'succeeded')"
        ),
        {"r": run_id, "p": PROVIDER, "e": ENDPOINT_ID},
    )
    connection.execute(
        text(
            "INSERT INTO raw.realtime_snapshot_index "
            "(realtime_snapshot_id, ingestion_run_id, provider_id, feed_endpoint_id, "
            " feed_timestamp_utc, entity_count, captured_at_utc) "
            "VALUES (:s, :r, :p, :e, :ts, :n, :ts)"
        ),
        {"s": snapshot_id, "r": run_id, "p": PROVIDER, "e": ENDPOINT_ID,
         "ts": captured_at, "n": len(rows)},
    )
    date_key = int(local_date.strftime("%Y%m%d"))
    for idx, (delay, direction) in enumerate(rows):
        connection.execute(
            text(
                """
                INSERT INTO gold.fact_trip_delay_snapshot
                    (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                     snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
                     trip_id, route_id, direction_id, start_date, vehicle_id,
                     trip_schedule_relationship, delay_seconds, stop_time_update_count,
                     delay_stop_id, delay_stop_sequence)
                VALUES (:p, :s, :ei, :dk, :sld, :ts, :ts, :entity, :trip, :route, :dir,
                        :sld, NULL, NULL, :delay, 0, NULL, NULL)
                """
            ),
            {"p": PROVIDER, "s": snapshot_id, "ei": idx, "dk": date_key, "sld": local_date,
             "ts": captured_at, "entity": f"e{snapshot_id}-{idx}", "trip": f"t{snapshot_id}-{idx}",
             "route": ROUTE, "dir": direction, "delay": delay},
        )


def _render(connection, source):  # noqa: ANN001
    return build_route_reliability(
        connection, provider_id=PROVIDER, route_id=ROUTE,
        generated_utc="2026-06-25T00:00:00Z", source=source,
    )


# Cube grains only (the daily grain reads the carve-out public_route_reliability_daily
# and is identical under both sources).
_CUBE_GRAINS = {"week", "month", "am_peak", "midday", "pm_peak", "evening", "night", "weekday", "weekend"}


def _cube_periods(rel):  # noqa: ANN001
    return {(p.grain, p.date): p for p in rel.periods if p.grain in _CUBE_GRAINS}


def test_folds_periods_counts_and_shares_byte_identical(conn) -> None:  # noqa: ANN001
    fact = _cube_periods(_render(conn, "fact"))
    spine = _cube_periods(_render(conn, "spine"))
    # Same grain coverage.
    assert set(fact) == set(spine) and fact, sorted(set(fact) ^ set(spine))
    # week + month + shift + daytype grains all present.
    grains = {g for g, _d in fact}
    assert {"week", "month", "weekday", "weekend"} <= grains
    assert grains & {"am_peak", "pm_peak", "midday"}
    for key, fp in fact.items():
        sp = spine[key]
        for field in _FROZEN_PERIOD:
            assert getattr(fp, field) == getattr(sp, field), (key, field)


def test_folds_day_of_week_byte_identical(conn) -> None:  # noqa: ANN001
    fact = {r.day_of_week_iso: r for r in _render(conn, "fact").day_of_week}
    spine = {r.day_of_week_iso: r for r in _render(conn, "spine").day_of_week}
    assert set(fact) == set(spine) and fact
    for iso, fr in fact.items():
        for field in _FROZEN_DOW:
            assert getattr(fr, field) == getattr(spine[iso], field), (iso, field)


def test_folds_crosstab_byte_identical(conn) -> None:  # noqa: ANN001
    fact = {(c.shift, c.day_type): c for c in _render(conn, "fact").by_shift_daytype}
    spine = {(c.shift, c.day_type): c for c in _render(conn, "spine").by_shift_daytype}
    assert set(fact) == set(spine) and fact
    for key, fc in fact.items():
        for field in _FROZEN_CROSSTAB:
            assert getattr(fc, field) == getattr(spine[key], field), (key, field)


def test_adversarial_direction_split_otp_matches(conn) -> None:  # noqa: ANN001
    """The midday split hour: dir0 delayed, dir1 silent. Plain SUM(on_time) must
    reproduce the fold otp_pct (route_delay_hourly merges directions, so its
    NULL-guard never fires) — the exact divergence one reviewer predicted."""
    fact = _cube_periods(_render(conn, "fact"))
    spine = _cube_periods(_render(conn, "spine"))
    midday = [(g, d) for (g, d) in fact if g == "midday"]
    assert midday, "expected a midday grain from the split hour"
    for key in midday:
        assert fact[key].otp_pct == spine[key].otp_pct
        assert fact[key].otp_pct is not None  # dir0 has delays -> a real OTP, not None


def test_spine_populates_percentiles_where_fact_was_none(conn) -> None:  # noqa: ANN001
    """The D3 upgrade: weekly/monthly/by_shift gain p50/p90 from the mergeable
    histogram (None under fact -> numeric under spine), an allowed rebaseline."""
    fact = _cube_periods(_render(conn, "fact"))
    spine = _cube_periods(_render(conn, "spine"))
    # Fact leaves these None on every cube grain; spine populates them where there
    # are in-clamp delays.
    assert all(fp.p50_min is None and fp.p90_min is None for fp in fact.values())
    assert any(sp.p50_min is not None for sp in spine.values())
