"""Permanent cutover gate for the route delay spine (S7-B PR1 Task 4).

Proves build_route_reliability(source="spine") reproduces the source="fact" output
BYTE-IDENTICALLY on the count + share fields, allowing only {avg_delay_min, p50_min,
p90_min} to move (pooled avg + CDF-interp percentiles — the deliberate rebaseline).
This is the oracle that LICENSES the Task 5 fold-table drop, and it survives the drop:
the frozen golden `fixtures/spine_golden/route_reliability_CUT-1.fact.json` is the
committed source="fact" render, so the gate keeps working once the fact path is gone.

Runs ONLY against a disposable Postgres migrated to head (incl. 0063); self-skips when
TRANSIT_TEST_DATABASE_URL is unset:

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://postgres@127.0.0.1:54329/transit_test" \
        uv run pytest tests/test_spine_cutover_gate.py -v

Regenerate the frozen golden (after an INTENTIONAL, reviewed change to the fact output):

    SPINE_GOLDEN_REGEN=1 TRANSIT_TEST_DATABASE_URL=... uv run pytest \
        tests/test_spine_cutover_gate.py::test_regenerate_golden -v

Calendar stability (the seed is "now"-relative — Postgres now() can't be mocked):
the seed is 7 IDENTICAL consecutive closed days, which always partition into exactly
5 weekday + 2 weekend days and cover all 7 ISO weekdays once each, so every ratio field
is calendar-invariant. The canonicalizer relativizes dates to anchor offsets and dedups
the weekly/monthly grains (identical days -> one representative) so the golden is stable
regardless of which weekday "today" is. feed_timestamp_utc == captured_at_utc (the common
case; the feed-vs-captured date-basis caveat is documented on the Task 3 commit).
"""

from __future__ import annotations

import json
import os
import re
from contextlib import contextmanager
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, text

from transit_ops.gold import rollups
from transit_ops.settings import Settings
from transit_ops.snapshots.builders.historic import build_route_reliability

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set - spine cutover gate skipped",
)

PROVIDER = "stm_gate_test"
TU_ENDPOINT_ID = 995001
VP_ENDPOINT_ID = 995002
ROUTE = "99G"
TORONTO = ZoneInfo("America/Toronto")
GENERATED_UTC = "2026-06-25T00:00:00Z"  # fixed -> stable across runs

GOLDEN_PATH = Path(__file__).parent / "fixtures" / "spine_golden" / "route_reliability_CUT-1.fact.json"

# The only leaves allowed to differ between fact and spine (the rebaseline).
ALLOW_MOVE = {"avg_delay_min", "p50_min", "p90_min"}
# Grains whose per-entry date is calendar-unstable (which ISO week / month a day
# lands in drifts with "today"); identical-per-day data makes every entry equal, so
# the canonicalizer dedups them to one representative.
_COLLAPSE_GRAINS = {"week", "month"}

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T")


class _NoCommitEngine:
    def __init__(self, connection) -> None:  # noqa: ANN001
        self._connection = connection

    @contextmanager
    def begin(self):  # noqa: ANN201
        yield self._connection


class _Counter:
    def __init__(self, start: int) -> None:
        self.value = start

    def next(self) -> int:
        self.value += 1
        return self.value


# --- the rich, calendar-stable seed ----------------------------------------
# Per-day fact set (direction, hour, delay_seconds, schedule_relationship). Identical
# on each of the 7 seeded days. Covers: am_peak/midday/pm_peak/night shifts; an
# adversarial midday DIRECTION SPLIT (dir 1 delayed, dir 0 silent); a NIGHT GHOST-ONLY
# hour (|delay|>3600 -> delay_obs counts them, on_time/severe exclude -> otp 0%, Finding F);
# a NULL-delay row; and one CANCELED trip (schedule_relationship=3) for cancellation_rate.
_PER_DAY_DELAYS = [
    (0, 7, -30, None), (0, 7, 200, None), (0, 7, 400, None), (0, 7, None, None),
    (1, 10, 60, None), (1, 10, 350, None),
    (0, 10, None, None), (0, 10, None, None),   # midday dir 0 silent (adversarial)
    (0, 17, 120, None),
    (0, 23, 7200, None), (0, 23, 5000, None),   # night ghost-only hour (Finding F)
    (0, 7, None, 3),                            # CANCELED trip (cancellation_rate)
]
# Per-day vehicle occupancy pings (occupancy_status code) -> occupancy_mix non-null.
_PER_DAY_OCCUPANCY = [1, 1, 2, 3, 5]
_SEED_DAYS = 7


def _seed(connection) -> None:  # noqa: ANN001
    connection.execute(
        text(
            "INSERT INTO core.providers (provider_id, display_name, timezone, provider_key) "
            "VALUES (:p, 'STM cutover gate', 'America/Toronto', :p)"
        ),
        {"p": PROVIDER},
    )
    for eid, key, kind, fmt in (
        (TU_ENDPOINT_ID, "trip_updates", "trip_updates", "gtfs_rt_trip_updates"),
        (VP_ENDPOINT_ID, "vehicle_positions", "vehicle_positions", "gtfs_rt_vehicle_positions"),
    ):
        connection.execute(
            text(
                "INSERT INTO core.feed_endpoints "
                "(feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format) "
                "VALUES (:eid, :p, :key, :kind, :fmt)"
            ),
            {"eid": eid, "p": PROVIDER, "key": key, "kind": kind, "fmt": fmt},
        )

    ids = _Counter(995100)
    today = datetime.now(TORONTO).date()
    for offset in range(1, _SEED_DAYS + 1):
        local_date = today - timedelta(days=offset)
        by_hour: dict[int, list[tuple[int, object, object]]] = {}
        for direction, hour, delay, sched in _PER_DAY_DELAYS:
            by_hour.setdefault(hour, []).append((direction, delay, sched))
        for hour, rows in by_hour.items():
            _insert_trip_snapshot(connection, ids, local_date, hour, rows)
        _insert_vehicle_snapshot(connection, ids, local_date, 12, _PER_DAY_OCCUPANCY)


def _insert_trip_snapshot(connection, ids, local_date, hour, rows) -> None:  # noqa: ANN001
    captured_at = datetime.combine(local_date, time(hour, 0), tzinfo=TORONTO).astimezone(UTC)
    sid, run_id = ids.next(), ids.next()
    _snapshot_header(connection, sid, run_id, TU_ENDPOINT_ID, captured_at, len(rows))
    date_key = int(local_date.strftime("%Y%m%d"))
    for idx, (direction, delay, sched) in enumerate(rows):
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
                        :sld, NULL, :sched, :delay, 0, NULL, NULL)
                """
            ),
            {"p": PROVIDER, "s": sid, "ei": idx, "dk": date_key, "sld": local_date,
             "ts": captured_at, "entity": f"e{sid}-{idx}", "trip": f"t{sid}-{idx}",
             "route": ROUTE, "dir": direction, "sched": sched, "delay": delay},
        )


def _insert_vehicle_snapshot(connection, ids, local_date, hour, codes) -> None:  # noqa: ANN001
    captured_at = datetime.combine(local_date, time(hour, 0), tzinfo=TORONTO).astimezone(UTC)
    sid, run_id = ids.next(), ids.next()
    _snapshot_header(connection, sid, run_id, VP_ENDPOINT_ID, captured_at, len(codes))
    date_key = int(local_date.strftime("%Y%m%d"))
    for idx, code in enumerate(codes):
        connection.execute(
            text(
                """
                INSERT INTO gold.fact_vehicle_snapshot
                    (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                     snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
                     vehicle_id, trip_id, route_id, stop_id, current_stop_sequence,
                     current_status, occupancy_status, latitude, longitude, bearing, speed)
                VALUES (:p, :s, :ei, :dk, :sld, :ts, :ts, :entity, :veh, NULL, :route,
                        NULL, NULL, NULL, :occ, NULL, NULL, NULL, NULL)
                """
            ),
            {"p": PROVIDER, "s": sid, "ei": idx, "dk": date_key, "sld": local_date,
             "ts": captured_at, "entity": f"v{sid}-{idx}", "veh": f"V{sid}-{idx}",
             "route": ROUTE, "occ": code},
        )


def _snapshot_header(connection, sid, run_id, eid, captured_at, n) -> None:  # noqa: ANN001
    connection.execute(
        text(
            "INSERT INTO raw.ingestion_runs "
            "(ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status) "
            "VALUES (:r, :p, :e, 'trip_updates', 'succeeded')"
        ),
        {"r": run_id, "p": PROVIDER, "e": eid},
    )
    connection.execute(
        text(
            "INSERT INTO raw.realtime_snapshot_index "
            "(realtime_snapshot_id, ingestion_run_id, provider_id, feed_endpoint_id, "
            " feed_timestamp_utc, entity_count, captured_at_utc) "
            "VALUES (:s, :r, :p, :e, :ts, :n, :ts)"
        ),
        {"s": sid, "r": run_id, "p": PROVIDER, "e": eid, "ts": captured_at, "n": n},
    )


def _build(connection) -> None:  # noqa: ANN001
    rollups.build_warm_rollups(
        PROVIDER,
        settings=Settings.model_construct(DATABASE_URL=None),
        engine=_NoCommitEngine(connection),
    )


def _anchor_today(connection) -> date:  # noqa: ANN001
    return connection.execute(
        text(
            "SELECT (now() AT TIME ZONE dp.timezone)::date "
            "FROM gold.dim_provider dp WHERE dp.provider_id = :p"
        ),
        {"p": PROVIDER},
    ).scalar_one()


def _render(connection, source: str):  # noqa: ANN001
    return build_route_reliability(
        connection, provider_id=PROVIDER, route_id=ROUTE,
        generated_utc=GENERATED_UTC, source=source,
    ).model_dump(mode="json")


# --- canonicalization (calendar-stable) ------------------------------------


def _relativize(value: str, anchor: date) -> str:
    """ISO date/datetime -> anchor-relative offset token (date part only)."""
    if _DATETIME_RE.match(value):
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return f"D{(anchor - dt.date()).days}T{dt.strftime('%H:%M:%S')}"
    if _DATE_RE.match(value):
        return f"D{(anchor - date.fromisoformat(value)).days}"
    return value


def _norm(obj, anchor: date):  # noqa: ANN001, ANN202
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            out[k] = v if k == "generated_utc" else _norm(v, anchor)
        return out
    if isinstance(obj, list):
        return [_norm(v, anchor) for v in obj]
    if isinstance(obj, str):
        return _relativize(obj, anchor)
    return obj


def _sort_key(elem) -> str:  # noqa: ANN001
    """Canonical order key from an element's frozen (non-allow-move) content."""
    if isinstance(elem, dict):
        frozen = {k: v for k, v in elem.items() if k not in ALLOW_MOVE}
        return json.dumps(frozen, sort_keys=True)
    return json.dumps(elem, sort_keys=True)


def _canonicalize(rel: dict, anchor: date) -> dict:
    """Date-relativized, list-sorted, week/month-deduped canonical form."""
    norm = _norm(rel, anchor)
    # Dedup the calendar-unstable week/month period grains to one representative each
    # (identical-per-day -> all entries share frozen fields); drop their date.
    periods = []
    seen_collapsed: dict[str, str] = {}
    for p in norm.get("periods", []):
        if p.get("grain") in _COLLAPSE_GRAINS:
            p = {**p, "date": None}
            key = _sort_key(p)
            if seen_collapsed.get(p["grain"]) == key:
                continue
            assert p["grain"] not in seen_collapsed, (
                f"{p['grain']} grain entries diverge across identical days: not calendar-stable"
            )
            seen_collapsed[p["grain"]] = key
        periods.append(p)
    norm["periods"] = periods
    # Sort every top-level list by canonical key (habits.matrix is nested in an object,
    # not a top-level list, so its row order is preserved).
    for k, v in norm.items():
        if isinstance(v, list):
            norm[k] = sorted(v, key=_sort_key)
    return norm


# --- comparison -------------------------------------------------------------


def _assert_frozen_match(golden, candidate, path: str = "") -> None:  # noqa: ANN001
    """Every leaf equal EXCEPT allow-move names (which must be numeric-or-None)."""
    if isinstance(golden, dict):
        assert isinstance(candidate, dict), f"{path}: type mismatch"
        assert set(golden) == set(candidate), (
            f"{path}: key mismatch {set(golden) ^ set(candidate)}"
        )
        for k in golden:
            child = f"{path}.{k}"
            if k in ALLOW_MOVE:
                assert candidate[k] is None or isinstance(candidate[k], (int, float)), (
                    f"{child}: allow-move not numeric-or-None: {candidate[k]!r}"
                )
            else:
                _assert_frozen_match(golden[k], candidate[k], child)
    elif isinstance(golden, list):
        assert isinstance(candidate, list) and len(golden) == len(candidate), (
            f"{path}: list length {len(golden) if isinstance(golden, list) else '?'} "
            f"!= {len(candidate) if isinstance(candidate, list) else '?'}"
        )
        for i, (g, c) in enumerate(zip(golden, candidate, strict=True)):
            _assert_frozen_match(g, c, f"{path}[{i}]")
    else:
        assert golden == candidate, f"{path}: {golden!r} != {candidate!r}"


def _zero_allow_move(obj):  # noqa: ANN001, ANN202
    if isinstance(obj, dict):
        return {k: (None if k in ALLOW_MOVE else _zero_allow_move(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_zero_allow_move(v) for v in obj]
    return obj


def _has_delay_subtree(canon: dict) -> bool:
    """Finding E: the gate is vacuous unless the delay cube actually rendered."""
    grains = {p["grain"] for p in canon.get("periods", [])}
    cube = grains & {"week", "month", "weekday", "weekend", "am_peak", "midday", "pm_peak", "night"}
    return bool(cube) and bool(canon.get("day_of_week")) and bool(canon.get("by_shift_daytype"))


@contextmanager
def _seeded_conn():
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        tx = connection.begin()
        try:
            _seed(connection)
            _build(connection)
            yield connection
        finally:
            tx.rollback()
        engine.dispose()


@pytest.mark.skipif(
    not os.environ.get("SPINE_GOLDEN_REGEN"),
    reason="set SPINE_GOLDEN_REGEN=1 to regenerate the frozen golden",
)
def test_regenerate_golden() -> None:
    with _seeded_conn() as connection:
        anchor = _anchor_today(connection)
        canon_fact = _canonicalize(_render(connection, "fact"), anchor)
    assert _has_delay_subtree(canon_fact), "refusing to freeze an empty delay subtree (Finding E)"
    GOLDEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    GOLDEN_PATH.write_text(json.dumps(canon_fact, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def test_spine_matches_frozen_golden_on_count_and_share_fields() -> None:
    assert GOLDEN_PATH.exists(), (
        f"frozen golden missing: regenerate with SPINE_GOLDEN_REGEN=1 ({GOLDEN_PATH})"
    )
    golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    assert _has_delay_subtree(golden), "frozen golden has an empty delay subtree (Finding E)"
    with _seeded_conn() as connection:
        anchor = _anchor_today(connection)
        canon_spine = _canonicalize(_render(connection, "spine"), anchor)
        canon_fact = _canonicalize(_render(connection, "fact"), anchor)
    # The committed golden is the fact render; today's fact render must still match it
    # (guards against the golden going stale vs an unrelated fact-path change).
    _assert_frozen_match(golden, canon_fact)
    # The licensing assertion: spine reproduces every frozen field of the golden.
    _assert_frozen_match(golden, canon_spine)
    # Byte backstop: with the allow-move leaves zeroed, the bodies are identical.
    assert _zero_allow_move(golden) == _zero_allow_move(canon_spine)


def test_spine_equals_fact_live_full_object() -> None:
    """Calendar-stable live proof (same now for both renders): the full canonical
    object matches on every frozen field, only allow-move differs."""
    with _seeded_conn() as connection:
        anchor = _anchor_today(connection)
        canon_fact = _canonicalize(_render(connection, "fact"), anchor)
        canon_spine = _canonicalize(_render(connection, "spine"), anchor)
    assert _has_delay_subtree(canon_fact)
    _assert_frozen_match(canon_fact, canon_spine)


def test_ghost_only_hour_otp_byte_identical() -> None:
    """Finding F: the night ghost-only hour (|delay|>3600) -> otp_pct identical
    (delay_obs counts ghosts, on_time excludes them -> 0% on both paths)."""
    with _seeded_conn() as connection:
        fact = {(p["grain"], p["date"]): p for p in _render(connection, "fact")["periods"]}
        spine = {(p["grain"], p["date"]): p for p in _render(connection, "spine")["periods"]}
    night_keys = [k for k in fact if k[0] == "night"]
    assert night_keys, "expected a night grain from the ghost-only hour"
    for k in night_keys:
        assert fact[k]["otp_pct"] == spine[k]["otp_pct"] == 0
