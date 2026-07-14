"""Focused reducer and production-query tests for retained as-of rankings."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from _sqlfakes import NamedQueryConn

from transit_ops.snapshots.builders import build_hotspots, build_repeat_offenders
from transit_ops.snapshots.serialization import snapshot_json_bytes
from transit_ops.sql_registry import query_name

_DEFAULT_ON_TIME = object()


def _history_module():  # noqa: ANN202
    from transit_ops.snapshots.builders import historic

    return historic


def _route_row(
    local_date: date | str,
    route_id: str,
    *,
    obs: int = 40,
    on_time: int | None | object = _DEFAULT_ON_TIME,
    known_obs: int | None = None,
    severe: int = 8,
    sum_delay_sec: int = 12_000,
    in_clamp_obs: int | None = None,
    peak_obs: int = 0,
    peak_severe: int = 0,
    peak_sum_delay_sec: int = 0,
    peak_present: int | None = None,
    generated_utc: str | None = None,
) -> dict[str, object]:
    rendered = local_date.isoformat() if isinstance(local_date, date) else local_date
    resolved_on_time = obs // 2 if on_time is _DEFAULT_ON_TIME else on_time
    return {
        "local_date": rendered,
        "route_id": route_id,
        "observation_count": obs,
        "on_time_count": resolved_on_time,
        "known_observation_count": (
            (obs if resolved_on_time is not None else 0) if known_obs is None else known_obs
        ),
        "daily_present": 1,
        "severe_count": severe,
        "sum_delay_seconds": sum_delay_sec,
        "in_clamp_observation_count": obs if in_clamp_obs is None else in_clamp_obs,
        "peak_observation_count": peak_obs,
        "peak_severe_count": peak_severe,
        "peak_sum_delay_seconds": peak_sum_delay_sec,
        "peak_present": int(peak_obs > 0) if peak_present is None else peak_present,
        "source_generated_utc": generated_utc or f"{rendered}T23:00:00Z",
    }


def _stop_row(
    local_date: date | str,
    stop_id: str,
    *,
    route_id: str = "R1",
    obs: int = 40,
    severe: int = 8,
    sum_delay_sec: int = 12_000,
    peak_obs: int = 0,
    peak_severe: int = 0,
    peak_sum_delay_sec: int = 0,
    peak_present: int | None = None,
    daily_present: int = 1,
    generated_utc: str | None = None,
) -> dict[str, object]:
    rendered = local_date.isoformat() if isinstance(local_date, date) else local_date
    return {
        "local_date": rendered,
        "stop_id": stop_id,
        "route_id": route_id,
        "observation_count": obs,
        "severe_count": severe,
        "sum_delay_seconds": sum_delay_sec,
        "peak_observation_count": peak_obs,
        "peak_severe_count": peak_severe,
        "peak_sum_delay_seconds": peak_sum_delay_sec,
        "peak_present": int(peak_obs > 0) if peak_present is None else peak_present,
        "daily_present": daily_present,
        "source_generated_utc": generated_utc or f"{rendered}T23:30:00Z",
    }


def _name(
    kind: str,
    entity_id: str,
    value: str,
    valid_from: str,
    valid_to: str | None = None,
) -> dict[str, object]:
    return {
        "entity_kind": kind,
        "entity_id": entity_id,
        "name": value,
        "valid_from_utc": valid_from,
        "valid_to_utc": valid_to,
    }


def _days(
    *,
    routes=(),  # noqa: ANN001
    stops=(),  # noqa: ANN001
    names=(),  # noqa: ANN001
    timezone: str = "America/Toronto",
):  # noqa: ANN202
    plan = _history_module().build_hotspots_history_plan_from_rows(
        route_rows=routes,
        stop_rows=stops,
        name_rows=names,
        provider_timezone=timezone,
    )
    return list(plan.iter_days())


def _grain(day, grain: str):  # noqa: ANN001, ANN202
    return next(value for value in day.by_grain if value.grain == grain)


def _entry(day, grain: str, kind: str, entity_id: str):  # noqa: ANN001, ANN202
    values = [*_grain(day, grain).entries, *_grain(day, grain).tray]
    return next(value for value in values if value.type == kind and value.id == entity_id)


def test_hotspots_as_of_old_day_is_immutable_after_future_rows_append() -> None:
    first = date(2026, 7, 6)
    original_routes = [
        _route_row(first, "R1", severe=12),
        _route_row(first + timedelta(days=1), "R1", severe=10),
    ]
    original_names = [_name("route", "R1", "Original", "2026-01-01T00:00:00Z")]
    old_before = snapshot_json_bytes(_days(routes=original_routes, names=original_names)[0])

    appended = original_routes + [
        _route_row(first + timedelta(days=2), "R1", severe=40, sum_delay_sec=100_000)
    ]
    appended_names = original_names + [
        _name("route", "R1", "Future rename", "2026-07-08T12:00:00Z")
    ]
    old_after = snapshot_json_bytes(_days(routes=appended, names=appended_names)[0])

    assert old_after == old_before
    assert _days(routes=appended, names=appended_names)[0].date == first.isoformat()


def test_hotspots_as_of_streams_first_day_before_exhausting_future_rows() -> None:
    class TrackingRows:
        def __init__(self, row_factory) -> None:  # noqa: ANN001
            self.consumed = 0
            self.rows = [
                row_factory(date(2026, 7, 1) + timedelta(days=offset)) for offset in range(40)
            ]

        def __iter__(self):  # noqa: ANN204
            for row in self.rows:
                self.consumed += 1
                yield row

    routes = TrackingRows(lambda value: _route_row(value, "R1"))
    stops = TrackingRows(lambda value: _stop_row(value, "S1"))
    plan = _history_module().build_hotspots_history_plan_from_rows(
        route_rows=routes,
        stop_rows=stops,
        name_rows=(),
        provider_timezone="America/Toronto",
    )

    first = next(plan.iter_days())

    assert first.date == "2026-07-01"
    # One next-date lookahead may close the ordered first group, but the reducer
    # must not materialize the remaining retained days before yielding it.
    assert routes.consumed <= 2
    assert stops.consumed <= 2


def test_hotspots_as_of_uses_bounded_day_week_month_and_peak_week_windows() -> None:
    first = date(2026, 5, 1)
    rows = [
        _route_row(
            first + timedelta(days=offset),
            "R1",
            obs=10,
            severe=2,
            sum_delay_sec=3_000,
            peak_obs=5,
            peak_severe=1,
            peak_sum_delay_sec=1_500,
        )
        for offset in range(40)
    ]
    latest = _days(routes=rows)[-1]

    assert _entry(latest, "day", "route", "R1").observation_count == 10
    assert _entry(latest, "week", "route", "R1").observation_count == 70
    assert _entry(latest, "month", "route", "R1").observation_count == 300
    assert _entry(latest, "shift", "route", "R1").observation_count == 35
    assert _grain(latest, "day").date == "2026-06-09"
    assert _grain(latest, "week").date == "2026-06-03"
    assert _grain(latest, "month").date == "2026-05-11"
    assert _grain(latest, "shift").date is None
    assert [grain.grain for grain in latest.by_grain] == ["day", "week", "month", "shift"]
    assert _grain(latest, "day").window_end == "2026-06-09"
    assert _grain(latest, "week").window_end == "2026-06-09"
    assert _grain(latest, "month").window_end == "2026-06-09"
    assert _grain(latest, "shift").window_end is None


def test_hotspots_as_of_windows_use_calendar_bounds_not_last_observed_groups() -> None:
    payload = _days(
        routes=[
            _route_row("2026-05-01", "R1", obs=40),
            _route_row("2026-06-20", "R1", obs=40),
        ]
    )[-1]

    assert _entry(payload, "week", "route", "R1").observation_count == 40
    assert _entry(payload, "month", "route", "R1").observation_count == 40


def test_hotspots_as_of_shift_requires_source_presence_but_preserves_real_zero() -> None:
    absent = _days(routes=[_route_row("2026-07-06", "R1", peak_present=0, peak_obs=0)])[0]
    assert [grain.grain for grain in absent.by_grain] == ["day", "week", "month"]

    real_zero = _days(
        routes=[
            _route_row(
                "2026-07-06",
                "R1",
                peak_present=1,
                peak_obs=0,
                peak_severe=0,
                peak_sum_delay_sec=0,
            )
        ]
    )[0]
    shift = _grain(real_zero, "shift")
    assert shift.entries == []
    assert [(item.id, item.observation_count, item.severe_pct) for item in shift.tray] == [
        ("R1", 0, None)
    ]


def test_hotspots_as_of_peak_only_stop_day_is_retained_without_fake_base_grains() -> None:
    payload = _days(
        stops=[
            _stop_row(
                "2026-07-06",
                "S1",
                obs=0,
                severe=0,
                sum_delay_sec=0,
                daily_present=0,
                peak_present=1,
                peak_obs=5,
                peak_severe=1,
                peak_sum_delay_sec=1_500,
            )
        ]
    )[0]

    assert payload.date == "2026-07-06"
    assert [grain.grain for grain in payload.by_grain] == ["shift"]
    assert _entry(payload, "shift", "stop", "S1").observation_count == 5


def test_hotspots_as_of_scalar_resets_on_iso_monday_not_trailing_week() -> None:
    payload = _days(
        routes=[
            _route_row("2026-07-05", "SUNDAY", severe=20),
            _route_row("2026-07-06", "MONDAY", severe=1),
        ]
    )[-1]

    assert [item.id for item in payload.hotspots] == ["MONDAY"]
    assert {item.id for item in _grain(payload, "week").entries} == {"MONDAY", "SUNDAY"}


def test_hotspots_as_of_scalar_is_iso_week_to_date_cross_kind_issue_order() -> None:
    monday = date(2026, 7, 6)
    routes = [
        _route_row(monday, "R2", severe=1),
        _route_row(monday + timedelta(days=1), "R2", severe=1),
        _route_row(monday + timedelta(days=2), "R2", severe=1),
        _route_row(monday + timedelta(days=3), "R2", severe=1),
        _route_row(monday + timedelta(days=4), "R2", severe=1),
        # A later-in-week row must not leak backward into Friday's scalar.
        _route_row(monday + timedelta(days=6), "R2", severe=20),
    ]
    stops = [
        _stop_row(monday + timedelta(days=4), "S1", severe=4, sum_delay_sec=40_000),
    ]

    friday = _days(routes=routes, stops=stops)[4]

    assert friday.date == "2026-07-10"
    assert [(item.type, item.id) for item in friday.hotspots[:2]] == [
        ("route", "R2"),
        ("stop", "S1"),
    ]
    assert friday.hotspots[0].severity == "high"


def test_hotspots_as_of_scalar_uses_postgres_numeric_rounding_and_stable_ties() -> None:
    day = "2026-07-06"
    routes = [
        # 60001 / 200 = 300.005 -> PostgreSQL numeric ROUND(..., 2) = 300.01,
        # so this zero-issue route clears avg_delay_seconds > 300.
        _route_row(
            day,
            "ROUND",
            obs=200,
            on_time=200,
            severe=0,
            sum_delay_sec=60_001,
            in_clamp_obs=200,
        ),
        _route_row(day, "B", severe=1),
        _route_row(day, "A", severe=1),
    ]
    payload = _days(routes=routes)[0]

    assert [item.id for item in payload.hotspots] == ["A", "B", "ROUND"]
    assert payload.hotspots[-1].severity == "high"


def test_hotspots_as_of_scalar_top20_ranks_and_strict_critical_boundaries() -> None:
    rows = [_route_row("2026-07-06", f"R{i:02d}", severe=1) for i in range(15)] + [
        _route_row("2026-07-06", "ISSUE_CRIT", severe=10),
        _route_row(
            "2026-07-06",
            "AVG_CRIT",
            obs=100,
            severe=0,
            sum_delay_sec=60_001,
            in_clamp_obs=100,
        ),
        _route_row(
            "2026-07-06",
            "AVG_BOUND",
            obs=100,
            severe=0,
            sum_delay_sec=60_000,
            in_clamp_obs=100,
        ),
    ]
    payload = _days(routes=rows)[0]

    assert len(payload.hotspots) == 18
    assert [item.rank for item in payload.hotspots] == list(range(1, 19))
    by_id = {item.id: item for item in payload.hotspots}
    assert by_id["ISSUE_CRIT"].severity == "critical"
    assert by_id["AVG_CRIT"].severity == "critical"
    assert by_id["AVG_BOUND"].severity == "high"


def test_hotspots_as_of_scalar_caps_at_top20_after_deterministic_order() -> None:
    payload = _days(
        routes=[_route_row("2026-07-06", f"R{i:02d}", severe=1) for i in reversed(range(25))]
    )[0]

    assert len(payload.hotspots) == 20
    assert [item.rank for item in payload.hotspots] == list(range(1, 21))
    assert [item.id for item in payload.hotspots] == [f"R{i:02d}" for i in range(20)]


def test_hotspots_as_of_scalar_cross_kind_and_source_route_ties_are_stable() -> None:
    routes = [_route_row("2026-07-06", "R", severe=3)]
    stops = [
        _stop_row("2026-07-06", "S", route_id="Z", severe=3, sum_delay_sec=12_000),
        _stop_row("2026-07-06", "S", route_id="A", severe=3, sum_delay_sec=24_040),
    ]
    forward = _days(routes=routes, stops=stops)[0]
    reverse = _days(routes=routes, stops=list(reversed(stops)))[0]

    assert [(item.type, item.id) for item in forward.hotspots] == [
        ("route", "R"),
        ("stop", "S"),
        ("stop", "S"),
    ]
    assert [item.severity for item in forward.hotspots[1:]] == ["critical", "high"]
    assert snapshot_json_bytes(forward) == snapshot_json_bytes(reverse)


def test_hotspots_as_of_route_scalar_and_ladder_keep_distinct_denominators() -> None:
    payload = _days(
        routes=[
            _route_row(
                "2026-07-06",
                "GHOSTS",
                obs=100,
                on_time=0,
                severe=0,
                sum_delay_sec=601,
                in_clamp_obs=2,
            )
        ]
    )[0]

    # Scalar pooled avg is 601/2 = 300.5s and therefore clears the >300
    # mart doctrine even with zero severe issues.
    assert [(item.id, item.severity) for item in payload.hotspots] == [("GHOSTS", "high")]
    # The executable ladder deliberately keeps the ghost-inclusive n=100, so
    # its displayed pooled mean is 601/100/60 -> 0.1 min.
    entry = _entry(payload, "day", "route", "GHOSTS")
    assert entry.observation_count == 100
    assert entry.avg_delay_min == 0.1


def test_hotspots_as_of_stop_scalar_identity_keeps_route_but_ladder_pools_stop() -> None:
    payload = _days(
        stops=[
            _stop_row("2026-07-06", "S1", route_id="R1", obs=40, severe=4),
            _stop_row("2026-07-06", "S1", route_id="R2", obs=40, severe=5),
        ]
    )[0]

    assert [(item.type, item.id) for item in payload.hotspots] == [
        ("stop", "S1"),
        ("stop", "S1"),
    ]
    stop_entries = [item for item in _grain(payload, "day").entries if item.type == "stop"]
    assert len(stop_entries) == 1
    assert stop_entries[0].id == "S1"
    assert stop_entries[0].observation_count == 80


def test_hotspots_as_of_scalar_otp_baselines_preserve_kind_specific_population() -> None:
    payload = _days(
        routes=[
            _route_row("2026-07-06", "R1", obs=100, on_time=50, severe=1),
            _route_row("2026-07-06", "RNULL", obs=100, on_time=None, severe=1),
        ],
        stops=[
            _stop_row("2026-07-06", "S1", route_id="A", obs=100, severe=10),
            _stop_row("2026-07-06", "S1", route_id="B", obs=100, severe=30),
        ],
    )[0]
    route = next(item for item in payload.hotspots if item.type == "route" and item.id == "R1")
    stops = [item for item in payload.hotspots if item.type == "stop" and item.id == "S1"]

    # RNULL has no on-time numerator, so its n is excluded from the route net:
    # R1 cell 50% vs route network 50%, not vs a fabricated 25%.
    assert route.otp_delta_pts == 0.0
    # Both scalar candidates use the whole-stop pooled proxy (20% severe) and
    # the stop network proxy, never the unrelated route baseline.
    assert [item.otp_delta_pts for item in stops] == [0.0, 0.0]


def test_hotspots_as_of_equal_ladder_scores_sort_by_id_not_input_order() -> None:
    payload = _days(
        routes=[
            _route_row("2026-07-06", "Z", obs=40, severe=20, sum_delay_sec=20_000),
            _route_row("2026-07-06", "A", obs=40, severe=20, sum_delay_sec=20_000),
        ]
    )[0]

    assert [item.id for item in _grain(payload, "day").entries] == ["A", "Z"]


def test_hotspots_as_of_ladder_uses_wilson_before_raw_rate_then_avg_and_id() -> None:
    payload = _days(
        routes=[
            # Lower raw severe rate (50%) but low n makes its not-severe Wilson
            # lower bound worse than BIG's 60%-severe, high-n interval.
            _route_row("2026-07-06", "SMALL", obs=30, severe=15, sum_delay_sec=30_000),
            _route_row("2026-07-06", "BIG", obs=1_000, severe=600, sum_delay_sec=1_000_000),
            # Same Wilson interval: higher avg first, then id for exact ties.
            _route_row("2026-07-06", "LOWAVG", obs=100, severe=50, sum_delay_sec=10_000),
            _route_row("2026-07-06", "ZAVG", obs=100, severe=50, sum_delay_sec=20_000),
            _route_row("2026-07-06", "AAVG", obs=100, severe=50, sum_delay_sec=20_000),
        ]
    )[0]
    ids = [item.id for item in _grain(payload, "day").entries]

    assert ids.index("SMALL") < ids.index("BIG")
    assert ids.index("AAVG") < ids.index("ZAVG") < ids.index("LOWAVG")


def test_hotspots_as_of_ladder_floor_is_exactly_30_and_caps_stops_too() -> None:
    stops = [_stop_row("2026-07-06", f"S{i:02d}", obs=30, severe=20) for i in range(55)] + [
        _stop_row("2026-07-06", "N29", obs=29, severe=29)
    ]
    grain = _grain(_days(stops=stops)[0], "day")

    assert len([item for item in grain.entries if item.type == "stop"]) == 50
    assert grain.total_ranked_stops == 55
    assert [(item.id, item.issue_count) for item in grain.tray] == [("N29", None)]


def test_hotspots_as_of_tray_cap_is_one_cross_kind_sixty_total() -> None:
    routes = [_route_row("2026-07-06", f"R{i:02d}", obs=10, severe=10) for i in range(40)]
    stops = [_stop_row("2026-07-06", f"S{i:02d}", obs=10, severe=9) for i in range(40)]
    grain = _grain(_days(routes=routes, stops=stops)[0], "day")

    assert grain.tray_total == 80
    assert len(grain.tray) == 60
    assert {item.type for item in grain.tray} == {"route", "stop"}
    assert all(item.issue_count is None for item in grain.tray)


def test_hotspots_as_of_ladders_restart_rank_and_keep_null_issue_count() -> None:
    day = "2026-07-06"
    payload = _days(
        routes=[_route_row(day, "R1", obs=40, severe=36, sum_delay_sec=80_000)],
        stops=[_stop_row(day, "S1", obs=40, severe=32, sum_delay_sec=70_000)],
    )[0]
    grain = _grain(payload, "day")

    assert [(item.type, item.rank) for item in grain.entries] == [
        ("route", 1),
        ("stop", 1),
    ]
    assert all(item.issue_count is None for item in grain.entries)
    assert grain.total_ranked_routes == 1
    assert grain.total_ranked_stops == 1


def test_hotspots_as_of_preserves_min_n_caps_tray_and_honest_counts() -> None:
    day = "2026-07-06"
    routes = [
        _route_row(day, f"R{i:02d}", obs=40, severe=39 - (i % 3), sum_delay_sec=40_000)
        for i in range(55)
    ] + [
        _route_row(day, f"T{i:02d}", obs=10, severe=10 - (i % 2), sum_delay_sec=10_000)
        for i in range(65)
    ]
    grain = _grain(_days(routes=routes)[0], "day")

    assert len([item for item in grain.entries if item.type == "route"]) == 50
    assert grain.total_ranked_routes == 55
    assert len(grain.tray) == 60
    assert grain.tray_total == 65
    assert all(item.rank is None and item.wilson_lo is None for item in grain.tray)
    assert all(item.observation_count == 10 for item in grain.tray)


def test_hotspots_as_of_discovers_published_empty_before_sentinel_filtering() -> None:
    payload = _days(
        routes=[_route_row("2026-07-06", "__unrouted__", obs=0, on_time=None, severe=0)],
        stops=[_stop_row("2026-07-06", "__unknown_stop__", route_id="__unrouted__")],
    )[0]

    assert payload.date == "2026-07-06"
    assert payload.generated_utc == "2026-07-06T23:30:00Z"
    assert payload.hotspots == []
    assert payload.by_grain == []


def test_hotspots_as_of_keeps_unrouted_stop_scalar_identity_and_honest_zero() -> None:
    payload = _days(
        stops=[
            _stop_row(
                "2026-07-06",
                "S1",
                route_id="__unrouted__",
                obs=40,
                severe=0,
                sum_delay_sec=20_000,
            )
        ]
    )[0]

    assert [(item.type, item.id) for item in payload.hotspots] == [("stop", "S1")]
    assert payload.hotspots[0].otp_delta_pts == 0.0
    entry = _entry(payload, "day", "stop", "S1")
    assert entry.severe_count == 0
    assert entry.severe_pct == 0.0


def test_hotspots_as_of_names_resolve_at_provider_local_close_with_dst_overlap_and_gap() -> None:
    rows = [
        _route_row("2026-03-07", "MID"),
        _route_row("2026-03-07", "NEXT"),
        _route_row("2026-03-08", "DST"),
        _route_row("2026-03-08", "OVER"),
        _route_row("2026-03-08", "GAP"),
    ]
    names = [
        _name("route", "MID", "Old", "2026-01-01T00:00:00Z", "2026-03-07T17:00:00Z"),
        _name("route", "MID", "Midday", "2026-03-07T17:00:00Z"),
        _name("route", "NEXT", "Before midnight", "2026-01-01T00:00:00Z", "2026-03-08T05:00:00Z"),
        _name("route", "NEXT", "Next day", "2026-03-08T05:00:00Z"),
        # March 8 closes at 04:00Z after Toronto's DST jump.
        _name("route", "DST", "DST day", "2026-01-01T00:00:00Z", "2026-03-09T04:00:00Z"),
        _name("route", "DST", "After DST day", "2026-03-09T04:00:00Z"),
        _name("route", "OVER", "Older overlap", "2026-01-01T00:00:00Z"),
        _name("route", "OVER", "Newest overlap", "2026-03-08T12:00:00Z"),
        _name("route", "GAP", "Expired", "2026-01-01T00:00:00Z", "2026-03-08T12:00:00Z"),
    ]
    by_date = {payload.date: payload for payload in _days(routes=rows, names=names)}

    mar7 = {item.id: item.name for item in by_date["2026-03-07"].hotspots}
    mar8 = {item.id: item.name for item in by_date["2026-03-08"].hotspots}
    assert mar7 == {"MID": "Midday", "NEXT": "Before midnight"}
    assert {key: mar8[key] for key in ("DST", "GAP", "OVER")} == {
        "DST": "DST day",
        "GAP": None,
        "OVER": "Newest overlap",
    }
    assert mar8["MID"] == "Midday"
    assert mar8["NEXT"] == "Next day"


def test_hotspots_as_of_stop_name_and_envelope_are_historical_and_stable() -> None:
    payload = _days(
        stops=[_stop_row("2026-07-06", "S1", severe=2)],
        names=[
            _name("stop", "S1", "Old stop", "2026-01-01T00:00:00Z", "2026-07-06T18:00:00Z"),
            _name("stop", "S1", "Closing stop", "2026-07-06T18:00:00Z"),
        ],
    )[0]

    assert payload.hotspots[0].name == "Closing stop"
    assert payload.methodology_version == "reliability-1"
    assert payload.publish_generation_id is None


def test_hotspots_as_of_name_close_handles_fall_dst_boundary() -> None:
    payload = _days(
        routes=[_route_row("2026-11-01", "FALL")],
        names=[
            _name(
                "route",
                "FALL",
                "Fall DST day",
                "2026-01-01T00:00:00Z",
                "2026-11-02T05:00:00Z",
            ),
            _name("route", "FALL", "Next day", "2026-11-02T05:00:00Z"),
        ],
    )[0]

    assert payload.hotspots[0].name == "Fall DST day"


def test_hotspots_history_production_plan_executes_exactly_four_closed_day_queries() -> None:
    conn = NamedQueryConn(
        {
            "history.hotspots.timezone": [{"timezone": "America/Toronto"}],
            "history.hotspots.names": [],
            "history.hotspots.route_daily": [
                _route_row("2026-07-05", "R1"),
                _route_row("2026-07-06", "R1"),
            ],
            "history.hotspots.stop_daily": [
                _stop_row("2026-07-05", "S1"),
                _stop_row("2026-07-06", "S1"),
            ],
        },
        strict=True,
    )

    plan = _history_module().build_hotspots_history_plan(conn, provider_id="stm")

    assert [day.date for day in plan.iter_days()] == ["2026-07-05", "2026-07-06"]
    assert [query_name(sql) for sql in conn.executed] == [
        "history.hotspots.timezone",
        "history.hotspots.names",
        "history.hotspots.route_daily",
        "history.hotspots.stop_daily",
    ]
    route_sql, stop_sql = conn.executed[-2:]
    assert "provider_local_date < timezone(dp.timezone, now())::date" in route_sql
    assert "provider_local_date < timezone(dp.timezone, now())::date" in stop_sql
    assert "ORDER BY" in route_sql and "ORDER BY" in stop_sql
    assert "LIMIT" not in route_sql and "LIMIT" not in stop_sql
    assert "ORDER BY sp.provider_local_date, sp.route_id" in route_sql
    assert "ORDER BY local_date, stop_id, route_id" in stop_sql
    assert "stop_delay_shift_daily" in stop_sql
    assert "known_observation_count" in route_sql
    assert "WHERE sp.on_time_observation_count IS NOT NULL" in route_sql
    assert "FULL OUTER JOIN peak" in stop_sql
    assert "IN ('am_peak', 'pm_peak')" in route_sql
    assert "shift.shift IN ('am_peak', 'pm_peak')" in stop_sql


def test_hotspots_history_plan_is_exported_from_both_builder_facades() -> None:
    from transit_ops.snapshots import builders

    historic = _history_module()
    assert builders.build_hotspots_history_plan is historic.build_hotspots_history_plan
    assert (
        builders.build_hotspots_history_plan_from_rows
        is historic.build_hotspots_history_plan_from_rows
    )


def test_hotspots_history_exact_256_kib_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    module = _history_module()
    monkeypatch.setattr(module.hotspots_history, "HOTSPOTS_BYTE_CEILING", 1)

    with pytest.raises(ValueError, match="262144|256 KiB|byte ceiling"):
        _days(routes=[_route_row("2026-07-06", "R1")])


def test_current_hotspots_fixed_builder_bytes_and_dispatch_are_unchanged() -> None:
    conn = NamedQueryConn(
        {
            "hotspots.list": [
                {
                    "entity_kind": "route",
                    "entity_id": "51",
                    "issue_count": 9,
                    "severity_label": "high",
                    "route_on_time": 75,
                    "route_known": 100,
                    "net_on_time": 80,
                    "net_known": 100,
                }
            ]
        }
    )

    payload = build_hotspots(conn, generated_utc="2026-07-01T00:00:00Z")

    assert snapshot_json_bytes(payload) == (
        b'{"schema_version":1,"methodology_version":null,"publish_generation_id":null,'
        b'"generated_utc":"2026-07-01T00:00:00Z","hotspots":[{"rank":1,'
        b'"type":"route","id":"51","name":null,"severity":"high",'
        b'"otp_delta_pts":-5.0}],"by_grain":[]}'
    )
    assert [query_name(sql) for sql in conn.executed] == [
        "hotspots.list",
        "static.route_names",
        "static.stop_names",
        "hotspots.route.anchor",
        "hotspots.stop.anchor",
    ]


def test_hotspots_as_of_newest_scalar_fields_match_current_builder_doctrine() -> None:
    historical = _days(
        routes=[
            _route_row(
                "2026-07-06",
                "R1",
                obs=100,
                on_time=50,
                known_obs=100,
                severe=10,
                sum_delay_sec=30_000,
                in_clamp_obs=100,
            )
        ],
        stops=[
            _stop_row(
                "2026-07-06",
                "S1",
                route_id="R1",
                obs=100,
                severe=20,
                sum_delay_sec=30_000,
            )
        ],
    )[0]
    current = build_hotspots(
        NamedQueryConn(
            {
                "hotspots.list": [
                    {
                        "entity_kind": "stop",
                        "entity_id": "S1",
                        "issue_count": 20,
                        "severity_label": "critical",
                        "stop_obs": 100,
                        "stop_severe": 20,
                        "net_stop_obs": 100,
                        "net_stop_severe": 20,
                    },
                    {
                        "entity_kind": "route",
                        "entity_id": "R1",
                        "issue_count": 10,
                        "severity_label": "critical",
                        "route_on_time": 50,
                        "route_known": 100,
                        "net_on_time": 50,
                        "net_known": 100,
                    },
                ]
            }
        ),
        generated_utc="2026-07-06T23:30:00Z",
    )

    assert [item.model_dump(mode="json") for item in historical.hotspots] == [
        item.model_dump(mode="json") for item in current.hotspots
    ]


def test_hotspots_as_of_source_generated_time_accepts_aware_datetime() -> None:
    row = _route_row("2026-07-06", "R1")
    row["source_generated_utc"] = datetime(2026, 7, 7, 1, 2, tzinfo=UTC)

    assert _days(routes=[row])[0].generated_utc == "2026-07-07T01:02:00Z"


# --------------------------------------------------------------------------
# Repeat Offenders retained as-of history
# --------------------------------------------------------------------------


def _offender_row(
    local_date: date | str,
    entity_id: str,
    *,
    kind: str = "trip",
    route_id: str = "R1",
    obs: int = 30,
    severe: int = 1,
    sum_delay_sec: int = 9_000,
    generated_utc: str | datetime | None = None,
) -> dict[str, object]:
    rendered = local_date.isoformat() if isinstance(local_date, date) else local_date
    return {
        "local_date": rendered,
        "entity_kind": kind,
        "entity_id": entity_id,
        "route_id": route_id,
        "observation_count": obs,
        "severe_count": severe,
        "sum_delay_seconds": sum_delay_sec,
        "source_generated_utc": generated_utc or f"{rendered}T23:45:00Z",
    }


def _offender_days(
    *,
    rows=(),  # noqa: ANN001
    names=(),  # noqa: ANN001
    timezone: str = "America/Toronto",
):  # noqa: ANN202
    plan = _history_module().build_repeat_offenders_history_plan_from_rows(
        daily_rows=rows,
        name_rows=names,
        provider_timezone=timezone,
    )
    return list(plan.iter_days())


def _repeat_grain(day, grain: str):  # noqa: ANN001, ANN202
    return next(value for value in day.by_grain if value.grain == grain)


def _repeat_entry(
    day,  # noqa: ANN001
    grain: str,
    kind: str,
    entity_id: str,
    *,
    route_id: str | None = None,
):  # noqa: ANN202
    values = [*_repeat_grain(day, grain).entries, *_repeat_grain(day, grain).tray]
    return next(
        value
        for value in values
        if value.type == kind
        and value.id == entity_id
        and (route_id is None or value.route == route_id)
    )


def test_repeat_offenders_as_of_old_day_is_immutable_after_future_rows_append() -> None:
    first = date(2026, 7, 6)
    original = [
        _offender_row(first, "T1", sum_delay_sec=18_000),
        _offender_row(first + timedelta(days=1), "T1", sum_delay_sec=18_000),
    ]
    original_names = [_name("route", "R1", "Original", "2026-01-01T00:00:00Z")]
    old_before = snapshot_json_bytes(_offender_days(rows=original, names=original_names)[0])

    appended = original + [
        _offender_row(
            first + timedelta(days=2),
            "T1",
            obs=100,
            severe=100,
            sum_delay_sec=100_000,
        )
    ]
    appended_names = original_names + [
        _name("route", "R1", "Future rename", "2026-07-08T12:00:00Z")
    ]
    old_after = snapshot_json_bytes(_offender_days(rows=appended, names=appended_names)[0])

    assert old_after == old_before


def test_repeat_offenders_as_of_streams_first_day_before_exhausting_future_rows() -> None:
    class TrackingRows:
        def __init__(self) -> None:
            self.consumed = 0
            self.rows = [
                _offender_row(date(2026, 5, 1) + timedelta(days=offset), "T1")
                for offset in range(40)
            ]

        def __iter__(self):  # noqa: ANN204
            for row in self.rows:
                self.consumed += 1
                yield row

    rows = TrackingRows()
    plan = _history_module().build_repeat_offenders_history_plan_from_rows(
        daily_rows=rows,
        name_rows=(),
        provider_timezone="America/Toronto",
    )

    first = next(plan.iter_days())

    assert first.date == "2026-05-01"
    assert rows.consumed <= 2


def test_repeat_offenders_as_of_uses_calendar_bounded_7_14_30_day_states() -> None:
    first = date(2026, 5, 1)
    rows = [
        _offender_row(
            first + timedelta(days=offset),
            "T1",
            obs=10,
            severe=1,
            sum_delay_sec=6_000,
        )
        for offset in range(40)
    ]

    latest = _offender_days(rows=rows)[-1]

    assert latest.date == "2026-06-09"
    assert latest.offenders[0].recurrence == "14/14d"
    assert latest.offenders[0].recurrence_days == 14
    assert latest.offenders[0].window_days == 14
    assert _repeat_entry(latest, "week", "trip", "T1").observation_count == 70
    assert _repeat_entry(latest, "week", "trip", "T1").observed_days == 7
    assert _repeat_entry(latest, "month", "trip", "T1").observation_count == 300
    assert _repeat_entry(latest, "month", "trip", "T1").observed_days == 30
    assert [value.grain for value in latest.by_grain] == ["week", "month"]
    assert (_repeat_grain(latest, "week").date, _repeat_grain(latest, "week").window_end) == (
        "2026-06-03",
        "2026-06-09",
    )
    assert (
        _repeat_grain(latest, "month").date,
        _repeat_grain(latest, "month").window_end,
    ) == ("2026-05-11", "2026-06-09")


def test_repeat_offenders_as_of_windows_use_dates_not_last_observed_groups() -> None:
    latest = _offender_days(
        rows=[
            _offender_row("2026-05-01", "OLD", obs=40),
            _offender_row("2026-06-20", "NEW", obs=40),
        ]
    )[-1]

    assert latest.offenders == []
    assert {value.id for value in _repeat_grain(latest, "week").entries} == {"NEW"}
    assert {value.id for value in _repeat_grain(latest, "month").entries} == {"NEW"}


def test_repeat_offenders_as_of_scalar_requires_three_recurrence_days() -> None:
    first = date(2026, 7, 1)
    rows = [
        *[_offender_row(first + timedelta(days=offset), "TWO", severe=1) for offset in range(2)],
        *[_offender_row(first + timedelta(days=offset), "THREE", severe=1) for offset in range(3)],
    ]
    rows.sort(key=lambda row: (str(row["local_date"]), str(row["entity_id"])))

    latest = _offender_days(rows=rows)[-1]

    assert [(value.id, value.recurrence) for value in latest.offenders] == [("THREE", "3/14d")]


def test_repeat_offenders_as_of_scalar_recurrence_severity_boundaries() -> None:
    first = date(2026, 7, 1)
    rows = [
        _offender_row(
            first + timedelta(days=offset),
            entity_id,
            obs=10,
            severe=1,
            sum_delay_sec=1_000,
        )
        for entity_id, recurrence_days in (("WATCH", 4), ("HIGH", 5), ("CRITICAL", 10))
        for offset in range(recurrence_days)
    ]
    rows.sort(key=lambda row: (str(row["local_date"]), str(row["entity_id"])))

    latest = _offender_days(rows=rows)[-1]

    assert {value.id: value.severity for value in latest.offenders} == {
        "CRITICAL": "critical",
        "HIGH": "high",
        "WATCH": "watch",
    }


def test_repeat_offenders_as_of_scalar_uses_rounded_seconds_for_severity_and_order() -> None:
    first = date(2026, 7, 1)
    rows: list[dict[str, object]] = []
    for offset, high_sum, boundary_sum in (
        (0, 30_002, 30_000),
        (1, 30_002, 30_000),
        (2, 30_003, 30_000),
        (3, 30_003, 30_000),
    ):
        day = first + timedelta(days=offset)
        rows.extend(
            [
                _offender_row(
                    day,
                    "ROUND_HIGH",
                    obs=50,
                    severe=1,
                    sum_delay_sec=high_sum,
                ),
                _offender_row(
                    day,
                    "ROUND_BOUNDARY",
                    obs=50,
                    severe=1,
                    sum_delay_sec=boundary_sum,
                ),
            ]
        )

    latest = _offender_days(rows=rows)[-1]
    by_id = {value.id: value for value in latest.offenders}

    assert [value.id for value in latest.offenders] == ["ROUND_HIGH", "ROUND_BOUNDARY"]
    assert by_id["ROUND_HIGH"].avg_delay_min == 10.0
    assert by_id["ROUND_HIGH"].severity == "critical"  # 600.05s -> numeric 600.1s
    assert by_id["ROUND_BOUNDARY"].avg_delay_min == 10.0
    assert by_id["ROUND_BOUNDARY"].severity == "watch"  # 600.0s is not >600


def test_repeat_offenders_as_of_scalar_orders_recurrence_then_average_and_caps_50() -> None:
    first = date(2026, 7, 1)
    rows: list[dict[str, object]] = []
    for index in reversed(range(55)):
        for offset in range(3):
            rows.append(
                _offender_row(
                    first + timedelta(days=offset),
                    f"T{index:02d}",
                    obs=10,
                    severe=1,
                    sum_delay_sec=(index + 1) * 100,
                )
            )
    for offset in range(4):
        rows.append(
            _offender_row(
                first + timedelta(days=offset),
                "MORE_RECURRENCE",
                obs=10,
                severe=1,
                sum_delay_sec=1,
            )
        )
    rows.sort(
        key=lambda row: (
            str(row["local_date"]),
            str(row["entity_kind"]),
            str(row["entity_id"]),
            str(row["route_id"]),
        )
    )

    latest = _offender_days(rows=rows)[-1]

    assert len(latest.offenders) == 50
    assert latest.offenders[0].id == "MORE_RECURRENCE"
    assert [value.id for value in latest.offenders[1:4]] == ["T54", "T53", "T52"]


def test_repeat_offenders_as_of_same_id_routes_are_distinct_and_deterministic() -> None:
    first = date(2026, 7, 1)
    rows = [
        _offender_row(first + timedelta(days=offset), "SAME", route_id=route_id)
        for offset in range(3)
        for route_id in ("Z", "A")
    ]
    opposite_within_each_date = sorted(
        rows,
        key=lambda row: (str(row["local_date"]), str(row["route_id"])),
    )
    forward = _offender_days(rows=rows)[-1]
    reverse = _offender_days(rows=opposite_within_each_date)[-1]

    assert [(value.id, value.route) for value in forward.offenders] == [
        ("SAME", "A"),
        ("SAME", "Z"),
    ]
    assert [(value.id, value.route) for value in _repeat_grain(forward, "week").entries] == [
        ("SAME", "A"),
        ("SAME", "Z"),
    ]
    assert snapshot_json_bytes(forward) == snapshot_json_bytes(reverse)


def test_repeat_offenders_as_of_by_grain_preserves_wilson_floor_and_kind_ranks() -> None:
    day = "2026-07-06"
    payload = _offender_days(
        rows=[
            _offender_row(day, "SMALL", obs=30, severe=15, sum_delay_sec=30_000),
            _offender_row(day, "BIG", obs=1_000, severe=600, sum_delay_sec=1_000_000),
            _offender_row(day, "N29", obs=29, severe=29, sum_delay_sec=29_000),
            _offender_row(
                day,
                "VEHICLE",
                kind="vehicle",
                obs=100,
                severe=80,
                sum_delay_sec=70_000,
            ),
        ]
    )[0]
    week = _repeat_grain(payload, "week")
    trips = [value for value in week.entries if value.type == "trip"]
    vehicles = [value for value in week.entries if value.type == "vehicle"]

    assert [value.id for value in trips] == ["SMALL", "BIG"]
    assert [value.rank for value in trips] == [1, 2]
    assert [value.rank for value in vehicles] == [1]
    assert "N29" not in {value.id for value in week.entries}
    assert "N29" not in {value.id for value in week.tray}  # recurrence 1 is not repeat evidence


def test_repeat_offenders_as_of_by_grain_ties_use_avg_then_id_then_route() -> None:
    payload = _offender_days(
        rows=[
            _offender_row("2026-07-06", "LOWAVG", obs=100, severe=50, sum_delay_sec=10_000),
            _offender_row("2026-07-06", "ZAVG", obs=100, severe=50, sum_delay_sec=20_000),
            _offender_row("2026-07-06", "AAVG", obs=100, severe=50, sum_delay_sec=20_000),
            _offender_row(
                "2026-07-06",
                "SAME",
                route_id="Z",
                obs=100,
                severe=50,
                sum_delay_sec=30_000,
            ),
            _offender_row(
                "2026-07-06",
                "SAME",
                route_id="A",
                obs=100,
                severe=50,
                sum_delay_sec=30_000,
            ),
        ]
    )[0]

    assert [(value.id, value.route) for value in _repeat_grain(payload, "week").entries] == [
        ("SAME", "A"),
        ("SAME", "Z"),
        ("AAVG", "R1"),
        ("ZAVG", "R1"),
        ("LOWAVG", "R1"),
    ]


def test_repeat_offenders_as_of_by_grain_uses_unrounded_severity_boundary() -> None:
    payload = _offender_days(
        rows=[
            _offender_row(
                "2026-07-06",
                "UNROUNDED",
                obs=30,
                severe=1,
                sum_delay_sec=18_012,
            )
        ]
    )[0]
    entry = _repeat_entry(payload, "week", "trip", "UNROUNDED")

    assert entry.avg_delay_min == 10.0
    assert entry.severity == "critical"  # 600.4s, before display rounding


def test_repeat_offenders_as_of_by_grain_caps_each_kind_and_tray_union() -> None:
    first = date(2026, 7, 5)
    rows: list[dict[str, object]] = []
    for kind, prefix in (("trip", "T"), ("vehicle", "V")):
        rows.extend(
            _offender_row(first + timedelta(days=1), f"{prefix}{index:02d}", kind=kind)
            for index in range(55)
        )
    for kind, prefix in (("trip", "TT"), ("vehicle", "TV")):
        for offset in range(2):
            rows.extend(
                _offender_row(
                    first + timedelta(days=offset),
                    f"{prefix}{index:02d}",
                    kind=kind,
                    obs=10,
                    severe=10 - (index % 2),
                    sum_delay_sec=10_000,
                )
                for index in range(40)
            )
    rows.sort(
        key=lambda row: (
            str(row["local_date"]),
            str(row["entity_kind"]),
            str(row["entity_id"]),
            str(row["route_id"]),
        )
    )

    week = _repeat_grain(_offender_days(rows=rows)[-1], "week")

    assert len([value for value in week.entries if value.type == "trip"]) == 50
    assert len([value for value in week.entries if value.type == "vehicle"]) == 50
    assert week.total_ranked_trips == 55
    assert week.total_ranked_vehicles == 55
    assert week.tray_total == 80
    assert len(week.tray) == 60
    assert {value.type for value in week.tray} == {"trip", "vehicle"}
    assert all(value.rank is None and value.wilson_lo is None for value in week.tray)


def test_repeat_offenders_as_of_real_zero_and_zero_denominator_are_honest() -> None:
    payload = _offender_days(
        rows=[
            _offender_row("2026-07-06", "ZERO", obs=30, severe=0, sum_delay_sec=0),
            _offender_row("2026-07-06", "NO_DENOM", obs=0, severe=0, sum_delay_sec=0),
        ]
    )[0]
    zero = _repeat_entry(payload, "week", "trip", "ZERO")

    assert zero.severe_count == 0
    assert zero.severe_pct == 0.0
    assert zero.avg_delay_min == 0.0
    assert "NO_DENOM" not in {value.id for value in _repeat_grain(payload, "week").entries}
    assert "NO_DENOM" not in {value.id for value in _repeat_grain(payload, "week").tray}


def test_repeat_offenders_as_of_discovers_published_empty_before_eligibility() -> None:
    payload = _offender_days(
        rows=[
            _offender_row(
                "2026-07-06",
                "FLUKE",
                obs=5,
                severe=1,
                sum_delay_sec=1_000,
                generated_utc="2026-07-07T01:15:00Z",
            )
        ]
    )[0]

    assert payload.date == "2026-07-06"
    assert payload.generated_utc == "2026-07-07T01:15:00Z"
    assert payload.offenders == []
    assert payload.by_grain == []


def test_repeat_offenders_as_of_names_use_provider_local_close_overlap_and_gap() -> None:
    day = "2026-03-08"
    payload = _offender_days(
        rows=[
            _offender_row(day, "MID", route_id="MID", obs=30),
            _offender_row(day, "NEXT", route_id="NEXT", obs=30),
            _offender_row(day, "DST", route_id="DST", obs=30),
            _offender_row(day, "OVER", route_id="OVER", obs=30),
            _offender_row(day, "GAP", route_id="GAP", obs=30),
        ],
        names=[
            _name("route", "MID", "Old", "2026-01-01T00:00:00Z", "2026-03-08T17:00:00Z"),
            _name("route", "MID", "Midday", "2026-03-08T17:00:00Z"),
            _name(
                "route",
                "NEXT",
                "Before midnight",
                "2026-01-01T00:00:00Z",
                "2026-03-09T04:00:00Z",
            ),
            _name("route", "NEXT", "Next day", "2026-03-09T04:00:00Z"),
            _name(
                "route",
                "DST",
                "DST day",
                "2026-01-01T00:00:00Z",
                "2026-03-09T04:00:00Z",
            ),
            _name("route", "DST", "After DST day", "2026-03-09T04:00:00Z"),
            _name("route", "OVER", "Older overlap", "2026-01-01T00:00:00Z"),
            _name("route", "OVER", "Newest overlap", "2026-03-08T12:00:00Z"),
            _name("route", "GAP", "Expired", "2026-01-01T00:00:00Z", "2026-03-08T12:00:00Z"),
        ],
    )[0]
    by_route = {value.route: value.route_name for value in _repeat_grain(payload, "week").entries}

    assert by_route == {
        "DST": "DST day",
        "GAP": None,
        "MID": "Midday",
        "NEXT": "Before midnight",
        "OVER": "Newest overlap",
    }


def test_repeat_offenders_as_of_fall_dst_close_and_envelope_are_stable() -> None:
    payload = _offender_days(
        rows=[_offender_row("2026-11-01", "FALL", route_id="FALL")],
        names=[
            _name(
                "route",
                "FALL",
                "Fall DST day",
                "2026-01-01T00:00:00Z",
                "2026-11-02T05:00:00Z",
            ),
            _name("route", "FALL", "Next day", "2026-11-02T05:00:00Z"),
        ],
    )[0]

    assert _repeat_grain(payload, "week").entries[0].route_name == "Fall DST day"
    assert payload.methodology_version == "reliability-1"
    assert payload.publish_generation_id is None


def test_repeat_offenders_as_of_generated_time_accepts_aware_datetime_and_uses_max() -> None:
    payload = _offender_days(
        rows=[
            _offender_row(
                "2026-07-06",
                "T1",
                generated_utc=datetime(2026, 7, 7, 1, 2, tzinfo=UTC),
            ),
            _offender_row(
                "2026-07-06",
                "T2",
                generated_utc="2026-07-07T01:03:00Z",
            ),
        ]
    )[0]

    assert payload.generated_utc == "2026-07-07T01:03:00Z"


def test_repeat_offenders_history_production_plan_executes_exactly_three_queries() -> None:
    conn = NamedQueryConn(
        {
            "history.repeat_offenders.timezone": [{"timezone": "America/Toronto"}],
            "history.repeat_offenders.names": [],
            "history.repeat_offenders.daily": [
                _offender_row("2026-07-05", "T1"),
                _offender_row("2026-07-06", "T1"),
            ],
        },
        strict=True,
    )

    plan = _history_module().build_repeat_offenders_history_plan(conn, provider_id="stm")

    assert [value.date for value in plan.iter_days()] == ["2026-07-05", "2026-07-06"]
    assert [query_name(sql) for sql in conn.executed] == [
        "history.repeat_offenders.timezone",
        "history.repeat_offenders.names",
        "history.repeat_offenders.daily",
    ]
    sql = conn.executed[-1]
    assert "FROM gold.repeat_offender_daily_spine AS sp" in sql
    assert "provider_local_date < timezone(dp.timezone, now())::date" in sql
    assert "ORDER BY sp.provider_local_date, sp.entity_kind, sp.entity_id, sp.route_id" in sql
    assert "LIMIT" not in sql
    assert "gold.repeat_offender AS" not in sql


def test_repeat_offenders_history_plan_is_exported_from_both_builder_facades() -> None:
    from transit_ops.snapshots import builders

    historic = _history_module()
    assert (
        builders.build_repeat_offenders_history_plan is historic.build_repeat_offenders_history_plan
    )
    assert (
        builders.build_repeat_offenders_history_plan_from_rows
        is historic.build_repeat_offenders_history_plan_from_rows
    )


def test_repeat_offenders_history_exact_256_kib_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    module = _history_module()
    monkeypatch.setattr(module.repeat_offenders_history, "REPEAT_OFFENDERS_BYTE_CEILING", 1)

    with pytest.raises(ValueError, match="262144|256 KiB|byte ceiling"):
        _offender_days(rows=[_offender_row("2026-07-06", "T1")])


def test_current_repeat_offenders_fixed_builder_bytes_and_dispatch_are_unchanged() -> None:
    conn = NamedQueryConn(
        {
            "repeat.offenders": [
                {
                    "entity_kind": "trip",
                    "entity_id": "T1",
                    "route_id": "51",
                    "recurrence_days": 3,
                    "window_days": 14,
                    "avg_delay_seconds": 120.0,
                    "severity_label": "watch",
                }
            ],
            "static.route_names": [],
            "repeat.offenders.spine.anchor": [{"anchor": None}],
        },
        strict=True,
    )

    payload = build_repeat_offenders(conn, generated_utc="2026-07-01T00:00:00Z")

    assert snapshot_json_bytes(payload) == (
        b'{"schema_version":1,"methodology_version":null,"publish_generation_id":null,'
        b'"generated_utc":"2026-07-01T00:00:00Z","offenders":[{"type":"trip",'
        b'"id":"T1","route":"51","route_name":null,"recurrence":"3/14d",'
        b'"recurrence_days":3,"window_days":14,"avg_delay_min":2.0,'
        b'"severity":"watch"}],"by_grain":[]}'
    )
    assert [query_name(sql) for sql in conn.executed] == [
        "repeat.offenders",
        "static.route_names",
        "repeat.offenders.spine.anchor",
    ]
    fixed_sql = conn.executed[0]
    assert "FROM gold.repeat_offender" in fixed_sql
    assert "ORDER BY recurrence_days DESC, avg_delay_seconds DESC" in fixed_sql
    assert "LIMIT 50" in fixed_sql


def test_repeat_offenders_as_of_closed_scalar_matches_equivalent_closed_spine_window() -> None:
    """History parity is against the equivalent 14 CLOSED local-date spine window.

    The fixed mutable mart uses an instant `now()-14d` fact window and may include the open
    local day plus a partial oldest day. Exact newest parity applies only when that mutable
    window is aligned to these same closed dates; history never weakens its closed-day rule.
    """
    first = date(2026, 7, 1)
    rows = [
        _offender_row(first + timedelta(days=offset), "T1", obs=10, severe=1, sum_delay_sec=4_000)
        for offset in range(3)
    ]

    historical = _offender_days(rows=rows)[-1].offenders[0]

    assert historical.model_dump(mode="json") == {
        "type": "trip",
        "id": "T1",
        "route": "R1",
        "route_name": None,
        "recurrence": "3/14d",
        "recurrence_days": 3,
        "window_days": 14,
        "avg_delay_min": 6.7,
        "severity": "watch",
    }
