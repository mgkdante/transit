
from __future__ import annotations

import json
import os
import re
from contextlib import contextmanager
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text

from transit_ops.gold import rollups
from transit_ops.settings import Settings
from transit_ops.snapshots.builders.historic import (
    build_hotspots,
    build_network_trend,
    build_route_reliability,
)

PROVIDER = "stm_gate_test"
TU_ENDPOINT_ID = 995001
VP_ENDPOINT_ID = 995002
ROUTE = "99G"
ROUTE2 = "99H"
_SEED_ROUTES = (ROUTE, ROUTE2)
TORONTO = ZoneInfo("America/Toronto")
GENERATED_UTC = "2026-06-25T00:00:00Z"

GOLDEN_PATH = (
    Path(__file__).parent
    / "fixtures"
    / "spine_golden"
    / "route_reliability_CUT-1.fact.json"
)

ALLOW_MOVE = {"avg_delay_min", "p50_min", "p90_min"}
_COLLAPSE_GRAINS = {"week", "month"}
_COLLAPSE_NULL_FIELDS = (
    "date",
    "observation_count",
    "on_time",
    "wilson_lo",
    "wilson_hi",
    "delay_histogram",
)

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T")

_DAYKIND_LABELS = {"weekday", "weekend"}
_ANCHOR_DAYKIND = "anchor-daykind"
_DAY_DAYTYPE_PRIOR_NULL_FIELDS = (
    "prior_observation_count",
    "prior_on_time",
    "prior_otp_pct",
)


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


_PER_DAY_DELAYS = [
    (0, 7, -30, None), (0, 7, 200, None), (0, 7, 400, None), (0, 7, None, None),
    (1, 10, 60, None), (1, 10, 350, None),
    (0, 10, None, None), (0, 10, None, None),
    (0, 17, 120, None),
    (0, 23, 7200, None), (0, 23, 5000, None),
    (0, 7, None, 3),
]
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
        for route in _SEED_ROUTES:
            for hour, rows in by_hour.items():
                _insert_trip_snapshot(connection, ids, route, local_date, hour, rows)
            _insert_vehicle_snapshot(connection, ids, route, local_date, 12, _PER_DAY_OCCUPANCY)


def _insert_trip_snapshot(connection, ids, route, local_date, hour, rows) -> None:  # noqa: ANN001
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
                        :sld, NULL, :sched, :delay, 0, :stop, NULL)
                """
            ),
            {"p": PROVIDER, "s": sid, "ei": idx, "dk": date_key, "sld": local_date,
             "ts": captured_at, "entity": f"e{sid}-{idx}", "trip": f"t{sid}-{idx}",
             "route": route, "dir": direction, "sched": sched, "delay": delay,
             "stop": f"stop{idx % 3}"},
        )


def _insert_vehicle_snapshot(connection, ids, route, local_date, hour, codes) -> None:  # noqa: ANN001
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
             "route": route, "occ": code},
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


def _render(connection):  # noqa: ANN001
    return build_route_reliability(
        connection, provider_id=PROVIDER, route_id=ROUTE, generated_utc=GENERATED_UTC,
    ).model_dump(mode="json")


def _relativize(value: str, anchor: date) -> str:
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
    if isinstance(elem, dict):
        frozen = {k: v for k, v in elem.items() if k not in ALLOW_MOVE}
        return json.dumps(frozen, sort_keys=True)
    return json.dumps(elem, sort_keys=True)


def _relativize_day_grain_calendar(norm: dict, anchor: date) -> None:
    for entry in norm.get("periods_by_grain", []):
        if entry.get("grain") != "day":
            continue
        for row in entry.get("by_daytype") or []:
            if row.get("grain") in _DAYKIND_LABELS:
                row["grain"] = _ANCHOR_DAYKIND
            for field in _DAY_DAYTYPE_PRIOR_NULL_FIELDS:
                if field in row:
                    row[field] = None
        for row in entry.get("by_shift_daytype") or []:
            if row.get("day_type") in _DAYKIND_LABELS:
                row["day_type"] = _ANCHOR_DAYKIND
        for row in entry.get("day_of_week") or []:
            iso = row.get("day_of_week_iso")
            if isinstance(iso, int):
                row["day_of_week_iso"] = f"DOW-A{(anchor.isoweekday() - iso) % 7}"


def _canonicalize(rel: dict, anchor: date) -> dict:
    norm = _norm(rel, anchor)
    _relativize_day_grain_calendar(norm, anchor)
    periods = []
    seen_collapsed: dict[str, str] = {}
    for p in norm.get("periods", []):
        if p.get("grain") in _COLLAPSE_GRAINS:
            p = {**p, **dict.fromkeys(_COLLAPSE_NULL_FIELDS)}
            key = _sort_key(p)
            if seen_collapsed.get(p["grain"]) == key:
                continue
            assert p["grain"] not in seen_collapsed, (
                f"{p['grain']} grain entries diverge across identical days: not calendar-stable"
            )
            seen_collapsed[p["grain"]] = key
        periods.append(p)
    norm["periods"] = periods
    for k, v in norm.items():
        if isinstance(v, list):
            norm[k] = sorted(v, key=_sort_key)
    return norm


def _assert_frozen_match(golden, candidate, path: str = "") -> None:  # noqa: ANN001
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
    grains = {p["grain"] for p in canon.get("periods", [])}
    cube = grains & {"week", "month", "weekday", "weekend", "am_peak", "midday", "pm_peak", "night"}
    return bool(cube) and bool(canon.get("day_of_week")) and bool(canon.get("by_shift_daytype"))


def _has_weak_stops(canon: dict) -> bool:
    ws = canon.get("weak_stops") or []
    return bool(ws) and all(s.get("id") for s in ws)


@pytest.fixture()
def conn(real_db_engine):  # noqa: ANN001
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        try:
            _seed(connection)
            _build(connection)
            yield connection
        finally:
            transaction.rollback()


@pytest.mark.skipif(
    not os.environ.get("SPINE_GOLDEN_REGEN"),
    reason="set SPINE_GOLDEN_REGEN=1 to regenerate the frozen golden",
)
def test_regenerate_golden(conn) -> None:
    anchor = _anchor_today(conn)
    canon = _canonicalize(_render(conn), anchor)
    assert _has_delay_subtree(canon), "refusing to freeze an empty delay subtree (Finding E)"
    assert _has_weak_stops(canon), "refusing to freeze an empty weak_stops subtree (DB-PR-3)"
    GOLDEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    GOLDEN_PATH.write_text(json.dumps(canon, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def test_spine_matches_frozen_golden_on_count_and_share_fields(conn) -> None:
    assert GOLDEN_PATH.exists(), (
        f"frozen golden missing: regenerate with SPINE_GOLDEN_REGEN=1 ({GOLDEN_PATH})"
    )
    golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    assert _has_delay_subtree(golden), "frozen golden has an empty delay subtree (Finding E)"
    assert _has_weak_stops(golden), "frozen golden has an empty weak_stops subtree (DB-PR-3)"
    anchor = _anchor_today(conn)
    canon_spine = _canonicalize(_render(conn), anchor)
    _assert_frozen_match(golden, canon_spine)
    assert _zero_allow_move(golden) == _zero_allow_move(canon_spine)


def test_network_by_shift_daytype_renders_from_spine(conn) -> None:
    spine = build_network_trend(
        conn, provider_id=PROVIDER, generated_utc=GENERATED_UTC
    ).model_dump(mode="json")
    for grain_key in ("by_shift", "by_daytype"):
        rows = {row["grain"]: row for row in spine[grain_key]}
        assert rows, grain_key
        for row in rows.values():
            assert row["otp_pct"] is None or 0 <= row["otp_pct"] <= 100
            assert row["severe_pct"] is None or row["severe_pct"] >= 0
    assert len({row["grain"] for row in spine["by_shift"]}) >= 3
    assert {row["grain"] for row in spine["by_daytype"]} == {"weekday", "weekend"}


def test_repeated_problem_route_issue_count_matches_spine_weekly_severe(conn) -> None:
    rp = {
        (r["entity_id"], r["period_start_local"]): r["issue_count"]
        for r in conn.execute(
            text(
                "SELECT entity_id, period_start_local, issue_count "
                "FROM gold.repeated_problem_route_stop "
                "WHERE provider_id = :p AND entity_kind = 'route' AND period_grain = 'week'"
            ),
            {"p": PROVIDER},
        ).mappings()
    }
    spine = {
        (r["route_id"], r["wk"]): r["severe"]
        for r in conn.execute(
            text(
                "SELECT route_id, date_trunc('week', provider_local_date)::date AS wk, "
                "       SUM(severe_delay_count)::int AS severe "
                "FROM gold.route_delay_spine WHERE provider_id = :p "
                "GROUP BY route_id, date_trunc('week', provider_local_date)::date "
                "HAVING SUM(severe_delay_count) > 0"
            ),
            {"p": PROVIDER},
        ).mappings()
    }
    hot = build_hotspots(conn, provider_id=PROVIDER, generated_utc=GENERATED_UTC)
    assert rp, "expected route-grain repeated-problem rows from the seeded severe delays"
    assert spine, "expected severe delays in the spine"
    for key, severe in spine.items():
        assert rp.get(key) == severe, (key, rp.get(key), severe)
    assert hot is not None


def test_hotspots_by_grain_matches_hand_rolled_spine_wilson(conn) -> None:
    from transit_ops.gold.reader import wilson_lo as _wlo
    from transit_ops.snapshots.builders.historic.small_surfaces import _hotspots_by_grain

    anchor = conn.execute(
        text(
            "SELECT MAX(provider_local_date) AS a FROM gold.route_delay_spine "
            "WHERE provider_id = :p"
        ),
        {"p": PROVIDER},
    ).scalar_one()
    win_start = anchor - timedelta(days=6)
    usable_delays = [
        delay for _, _, delay, _ in _PER_DAY_DELAYS
        if delay is not None and abs(delay) <= 3600
    ]
    observations = len(usable_delays) * _SEED_DAYS
    severe = sum(delay > 300 for delay in usable_delays) * _SEED_DAYS
    hand = {route: (observations, severe) for route in _SEED_ROUTES}
    names = _entity_name_maps_or_empty(conn)
    grains = _hotspots_by_grain(conn, PROVIDER, names[0], names[1])

    by_grain = {g.grain: g for g in grains}
    assert "week" in by_grain, "expected a week ladder from the seeded spine"
    week = by_grain["week"]
    assert week.date == win_start.isoformat()
    assert week.window_end == anchor.isoformat()
    expected = sorted(
        (
            (_wlo(obs - severe, obs), rid)
            for rid, (obs, severe) in hand.items()
            if obs >= 30
        ),
        key=lambda t: (t[0], t[1]),
    )
    got_routes = [(e.wilson_lo, e.id) for e in week.entries if e.type == "route"]
    assert got_routes == expected, (got_routes, expected)
    if week.entries:
        e0 = week.entries[0]
        assert e0.observation_count is not None
        assert e0.severe_pct is not None
        assert e0.wilson_lo is not None and e0.wilson_hi is not None


def test_hotspots_by_grain_payload_size_under_ceiling(conn) -> None:
    from transit_ops.snapshots.contract import HOTSPOTS_BYTE_CEILING
    from transit_ops.snapshots.storage import _body

    hot = build_hotspots(conn, provider_id=PROVIDER, generated_utc=GENERATED_UTC)
    size = len(_body(hot))
    assert size <= HOTSPOTS_BYTE_CEILING, (
        f"seeded hotspots.json {size}B exceeds ceiling {HOTSPOTS_BYTE_CEILING}B"
    )
    print(f"\n[S12 size probe] seeded hotspots.json = {size} bytes "
          f"(ceiling {HOTSPOTS_BYTE_CEILING})")


def test_repeat_offenders_payload_size_under_ceiling(conn) -> None:
    from transit_ops.snapshots.builders.historic import build_repeat_offenders
    from transit_ops.snapshots.contract import REPEAT_OFFENDERS_BYTE_CEILING
    from transit_ops.snapshots.storage import _body

    ro = build_repeat_offenders(conn, provider_id=PROVIDER, generated_utc=GENERATED_UTC)
    size = len(_body(ro))
    assert size <= REPEAT_OFFENDERS_BYTE_CEILING, (
        f"seeded repeat_offenders.json {size}B exceeds ceiling {REPEAT_OFFENDERS_BYTE_CEILING}B"
    )
    print(f"\n[S14 size probe] seeded repeat_offenders.json = {size} bytes "
          f"(ceiling {REPEAT_OFFENDERS_BYTE_CEILING})")


def _entity_name_maps_or_empty(connection):  # noqa: ANN001, ANN202
    from transit_ops.snapshots.builders._helpers import _entity_name_maps

    return _entity_name_maps(connection, provider_id=PROVIDER)


def test_ghost_only_hour_otp_is_zero(conn) -> None:
    spine = {(p["grain"], p["date"]): p for p in _render(conn)["periods"]}
    night_keys = [k for k in spine if k[0] == "night"]
    assert night_keys, "expected a night grain from the ghost-only hour"
    for k in night_keys:
        assert spine[k]["otp_pct"] == 0
