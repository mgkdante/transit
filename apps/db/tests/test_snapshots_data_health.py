"""FakeConn tests for build_data_health (S11 status/data_health.json).

No real DB — canned snapshot_publish_state + feed_freshness_current rows fed
through the same FakeConn the other builder tests use. Covers: all three lanes
present with gate telemetry; a pre-0078 lane (NULL gate columns) emitting an
honest-NULL gate block; a missing tier row omitted (honest-null lane, never a
fabricated zero-age lane); the historic tier surfacing as the 'rollup' lane; and
feeds mirroring feed_freshness_current.
"""

from __future__ import annotations

from decimal import Decimal

from transit_ops.snapshots.builders import build_data_health
from transit_ops.snapshots.contract import DataHealth

from test_snapshots_builders import FakeConn


def _lanes_key() -> str:
    return "data_health.lanes"


def _feeds_key() -> str:
    return "data_health.feeds"


def _row(tier, *, gen="2026-07-02T00:00:00Z", age=42, written=10, skipped=2, total=12,
         checks=12, errors=0, warnings=1, verdict="warn", gate_gen="2026-07-02T00:00:00Z"):
    return {
        "tier": tier,
        "generated_utc": gen,
        "age_s": None if age is None else Decimal(age),
        "files_written": written,
        "files_skipped": skipped,
        "files_total": total,
        "gate_checks_run": checks,
        "gate_errors": errors,
        "gate_warnings": warnings,
        "gate_verdict": verdict,
        "gate_generated_utc": gate_gen,
    }


def test_build_data_health_all_three_lanes_present() -> None:
    conn = FakeConn(
        {
            _lanes_key(): [
                _row("live", verdict="pass", warnings=0),
                _row("static", verdict="warn", warnings=3),
                _row("historic", verdict="fail", errors=2),
            ],
            _feeds_key(): [
                {"endpoint_key": "trip_updates", "status": "fresh", "completed_age_seconds": 30},
                {"endpoint_key": "vehicle_positions", "status": "fresh", "completed_age_seconds": 12},
            ],
        }
    )
    out = build_data_health(conn, provider_id="stm", generated_utc="2026-07-02T12:00:00Z")
    assert isinstance(out, DataHealth)
    # Fixed presentation order: live, static, rollup.
    assert [lane.lane for lane in out.lanes] == ["live", "static", "rollup"]
    live, static, rollup = out.lanes
    assert live.gate is not None and live.gate.verdict == "pass"
    assert static.gate is not None and static.gate.verdict == "warn"
    # historic tier -> 'rollup' citizen label; fail verdict carried through.
    assert rollup.lane == "rollup" and rollup.gate is not None
    assert rollup.gate.verdict == "fail" and rollup.gate.errors == 2
    # age_s is the server-computed integer (Decimal coerced), not a client clock.
    assert live.age_s == 42 and isinstance(live.age_s, int)
    assert live.files_total == 12
    # feeds mirror feed_freshness_current.
    assert [f.feed for f in out.feeds] == ["trip_updates", "vehicle_positions"]
    assert out.feeds[0].age_s == 30 and out.feeds[0].status == "fresh"


def test_build_data_health_pre_0078_lane_emits_null_gate_block() -> None:
    """A lane published before migration 0078 has every gate_* column NULL — the
    gate block is honestly ABSENT (None), never a fabricated all-null/pass shape."""
    conn = FakeConn(
        {
            _lanes_key(): [
                {
                    "tier": "live",
                    "generated_utc": "2026-07-01T00:00:00Z",
                    "age_s": Decimal(100),
                    "files_written": 6,
                    "files_skipped": 0,
                    "files_total": 6,
                    "gate_checks_run": None,
                    "gate_errors": None,
                    "gate_warnings": None,
                    "gate_verdict": None,
                    "gate_generated_utc": None,
                },
            ],
            _feeds_key(): [],
        }
    )
    out = build_data_health(conn, provider_id="stm", generated_utc="t")
    assert len(out.lanes) == 1
    lane = out.lanes[0]
    assert lane.lane == "live"
    assert lane.gate is None  # honest-NULL: gate outcome UNKNOWN, not assumed pass
    assert lane.age_s == 100 and lane.files_total == 6


def test_build_data_health_missing_tier_row_omitted_not_fabricated() -> None:
    """A tier with no publish-state row is ABSENT from lanes (the web renders it as
    honest not-applicable) — build_data_health never emits a zero-age placeholder."""
    conn = FakeConn(
        {
            _lanes_key(): [_row("live"), _row("historic")],  # no 'static' row
            _feeds_key(): [],
        }
    )
    out = build_data_health(conn, provider_id="stm", generated_utc="t")
    assert [lane.lane for lane in out.lanes] == ["live", "rollup"]
    assert all(lane.lane != "static" for lane in out.lanes)


def test_build_data_health_never_published_lane_has_null_age() -> None:
    """A row whose generated_utc is NULL (lane exists but never completed a publish)
    carries honest-NULL last_publish_utc + age_s, never a fabricated 0."""
    conn = FakeConn(
        {
            _lanes_key(): [
                {
                    "tier": "static",
                    "generated_utc": None,
                    "age_s": None,
                    "files_written": 0,
                    "files_skipped": 0,
                    "files_total": 0,
                    "gate_checks_run": None,
                    "gate_errors": None,
                    "gate_warnings": None,
                    "gate_verdict": None,
                    "gate_generated_utc": None,
                },
            ],
            _feeds_key(): [],
        }
    )
    out = build_data_health(conn, provider_id="stm", generated_utc="t")
    assert len(out.lanes) == 1
    lane = out.lanes[0]
    assert lane.last_publish_utc is None
    assert lane.age_s is None
    assert lane.gate is None


def test_build_data_health_feed_null_age_preserved() -> None:
    conn = FakeConn(
        {
            _lanes_key(): [],
            _feeds_key(): [
                {"endpoint_key": "alerts", "status": None, "completed_age_seconds": None},
            ],
        }
    )
    out = build_data_health(conn, provider_id="stm", generated_utc="t")
    assert out.lanes == []
    assert len(out.feeds) == 1
    assert out.feeds[0].feed == "alerts"
    assert out.feeds[0].age_s is None and out.feeds[0].status is None
