from __future__ import annotations

from datetime import date

import pytest
from _sqlfakes import NamedQueryConn
from sqlalchemy import text

from transit_ops.snapshots.builders.historic.hotspots_history import (
    build_hotspots_history_plan,
    build_hotspots_history_plan_from_rows,
)
from transit_ops.snapshots.builders.historic.ranking_kernel import (
    build_hotspot_kind_ladder,
    otp_delta_points,
)
from transit_ops.snapshots.builders.historic.small_surfaces import build_hotspots, build_receipts
from transit_ops.snapshots.builders.live import build_network


@pytest.mark.parametrize(
    ("on_time", "severe", "unknown", "expected_otp", "expected_coverage"),
    [(5, 3, 0, 63, 100), (5, 0, 3, 100, 63)],
)
def test_live_network_rates_round_half_ties_away(
    on_time, severe, unknown, expected_otp, expected_coverage
) -> None:
    rows = [
        {"status_band": band, "occupancy_status": None}
        for band, count in (
            ("À l'heure / On time", on_time),
            ("Critique / Severe", severe),
            ("Inconnu / Unknown", unknown),
        )
        for _ in range(count)
    ]
    payload = build_network(
        NamedQueryConn({"network.live.vehicles": rows}), generated_utc="2026-07-01T00:00:00Z"
    )
    assert payload.on_time_pct == expected_otp
    assert payload.coverage_pct == expected_coverage


def test_hotspot_delta_is_zero_against_its_own_population() -> None:
    ladder = build_hotspot_kind_ladder(
        [{"route_id": "R1", "obs": 30, "severe": 2, "sum_delay_sec": 1200}], "route", {}
    )
    assert ladder.entries[0].otp_delta_pts == 0.0


def test_scalar_hotspot_delta_uses_counts_before_rounding() -> None:
    payload = build_hotspots(
        NamedQueryConn(
            {
                "hotspots.list": [
                    {
                        "entity_kind": "route",
                        "entity_id": "R1",
                        "severity_label": "high",
                        "route_on_time": 5,
                        "route_known": 8,
                        "net_on_time": 12,
                        "net_known": 16,
                    }
                ]
            }
        ),
        generated_utc="2026-07-01T00:00:00Z",
    )
    assert payload.hotspots[0].otp_delta_pts == -12.5


def test_replayed_scalar_hotspot_delta_uses_counts_before_rounding() -> None:
    rows = [
        {
            "local_date": "2026-07-01",
            "route_id": route_id,
            "daily_present": 1,
            "observation_count": 8,
            "on_time_count": on_time,
            "known_observation_count": 8,
            "severe_count": 8 - on_time,
            "sum_delay_seconds": 600 * (8 - on_time),
            "in_clamp_observation_count": 8,
            "peak_observation_count": 0,
            "peak_severe_count": 0,
            "peak_sum_delay_seconds": 0,
            "peak_present": 0,
            "source_generated_utc": "2026-07-02T00:00:00Z",
        }
        for route_id, on_time in (("R1", 5), ("R2", 7))
    ]
    plan = build_hotspots_history_plan_from_rows(
        route_rows=rows, stop_rows=[], name_rows=[], provider_timezone="America/Toronto"
    )
    payload = next(plan.iter_days())
    assert {entry.id: entry.otp_delta_pts for entry in payload.hotspots} == {
        "R1": -12.5,
        "R2": 12.5,
    }


@pytest.mark.parametrize("usable_observations", [2, 30])
def test_current_and_replayed_hotspots_exclude_outliers_from_every_grain(
    real_db_engine, seed_provider, usable_observations
) -> None:
    provider_id = "hotspot_metric_parity"
    local_date = date(2026, 7, 1)
    histogram = [0] * 21
    histogram[7] = usable_observations - 2
    histogram[17] = 2
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        try:
            seed_provider(connection, provider_id, display_name="Hotspot metric parity")
            params = {
                "provider": provider_id,
                "day": local_date,
                "known": usable_observations + 28,
                "usable": usable_observations,
                "on_time": usable_observations - 2,
                "histogram": histogram,
            }
            connection.execute(
                text("""
                INSERT INTO gold.route_delay_spine (
                    provider_id, route_id, provider_local_date, hour_of_day_local, direction_id,
                    observation_count, delay_observation_count, on_time_observation_count,
                    severe_delay_count, sum_delay_seconds, delay_histogram, built_at_utc
                ) VALUES (:provider, 'R1', :day, 8, 0, :known, :known, :on_time,
                    2, 1200, CAST(:histogram AS smallint[]), '2026-07-02T00:00:00Z')
            """),
                params,
            )
            connection.execute(
                text("""
                INSERT INTO gold.stop_delay_spine (
                    provider_id, stop_id, route_id, provider_local_date, observation_count,
                    severe_delay_count, sum_delay_seconds, built_at_utc
                ) VALUES (:provider, 'S1', 'R1', :day, :usable, 2, 1200,
                    '2026-07-02T00:00:00Z')
            """),
                params,
            )
            connection.execute(
                text("""
                INSERT INTO gold.stop_delay_shift_daily (
                    provider_id, stop_id, route_id, provider_local_date, shift, observation_count,
                    severe_delay_count, sum_delay_seconds, built_at_utc
                ) VALUES (:provider, 'S1', 'R1', :day, 'am_peak', :usable, 2, 1200,
                    '2026-07-02T00:00:00Z')
            """),
                params,
            )
            current = build_hotspots(
                connection, provider_id=provider_id, generated_utc="2026-07-02T00:00:00Z"
            )
            replayed = next(build_hotspots_history_plan(connection, provider_id).iter_days())
            for payload in (current, replayed):
                assert {grain.grain for grain in payload.by_grain} == {
                    "day",
                    "week",
                    "month",
                    "shift",
                }
                for grain in payload.by_grain:
                    entries = grain.tray if usable_observations < 30 else grain.entries
                    assert len(entries) == 2
                    assert all(entry.observation_count == usable_observations for entry in entries)
                    assert all(entry.severe_count == 2 for entry in entries)
                    assert entries[0].avg_delay_min == entries[1].avg_delay_min
                    assert entries[0].severe_pct == entries[1].severe_pct
                    if usable_observations < 30:
                        assert grain.entries == []
                        assert all(entry.avg_delay_min == 10.0 for entry in entries)
                        assert all(entry.severe_pct == 100.0 for entry in entries)
                    else:
                        assert all(entry.otp_delta_pts == 0.0 for entry in entries)
                        assert all(entry.avg_delay_min == 0.7 for entry in entries)
        finally:
            transaction.rollback()


@pytest.mark.parametrize(
    ("cell_successes", "cell_total", "network_successes", "network_total", "expected"),
    [
        (1, 16, 0, 16, 6.3),
        (0, 16, 1, 16, -6.3),
        (None, 8, 5, 8, None),
        (5, 8, None, 8, None),
        (0, 0, 5, 8, None),
        (5, 8, 0, 0, None),
    ],
)
def test_hotspot_delta_preserves_unknowns_and_rounds_signed_ties(
    cell_successes, cell_total, network_successes, network_total, expected
) -> None:
    assert (
        otp_delta_points(cell_successes, cell_total, network_successes, network_total) == expected
    )


def test_receipt_route_delta_uses_unrounded_network_counts() -> None:
    day = date(2026, 7, 1)
    connection = NamedQueryConn(
        {
            "receipts.accountability": [
                {
                    "provider_local_date": day,
                    "affected_route_count": 1,
                    "affected_stop_count": 0,
                    "alert_count": 0,
                    "rider_impact_score": None,
                }
            ],
            "receipts.network_daily": [
                {
                    "local_date": day,
                    "known_obs": 16,
                    "on_time": 12,
                    "severe": 4,
                    "pooled_delay_sec": 2400,
                    "inclamp_obs": 16,
                }
            ],
            "receipts.worst_route": [
                {
                    "d": day,
                    "route_id": "R1",
                    "on_time": 5,
                    "known_obs": 8,
                }
            ],
        }
    )
    receipt = build_receipts(connection, generated_utc="2026-07-02T00:00:00Z")[day.isoformat()]
    assert receipt.otp_pct == 75
    assert receipt.worst_route.otp_delta_pts == -12.5
