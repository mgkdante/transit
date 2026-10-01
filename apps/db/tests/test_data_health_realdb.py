
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from transit_ops.snapshots.builders import build_data_health
from transit_ops.snapshots.contract import DATA_HEALTH_BYTE_CEILING

PROVIDER = "stm_datahealth_test"
NOW = datetime.now(UTC)
LIVE_GEN = NOW - timedelta(seconds=60)
HISTORIC_GEN = NOW - timedelta(hours=6)
STATIC_GEN = NOW - timedelta(days=1)


@pytest.fixture()
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        seed_provider(connection, PROVIDER, display_name="STM data-health test")
        _seed(connection)
        try:
            yield connection
        finally:
            transaction.rollback()


def _seed(connection) -> None:
    connection.execute(
        text(
            """
            INSERT INTO core.snapshot_publish_state
                (provider_id, tier, generated_utc, files_written, files_skipped, files_total,
                 gate_checks_run, gate_errors, gate_warnings, gate_verdict, gate_generated_utc)
            VALUES (:p, 'live', :g, 7, 0, 7, 7, 0, 2, 'warn', :g)
            """
        ),
        {"p": PROVIDER, "g": LIVE_GEN},
    )
    connection.execute(
        text(
            """
            INSERT INTO core.snapshot_publish_state
                (provider_id, tier, generated_utc, files_written, files_skipped, files_total,
                 gate_checks_run, gate_errors, gate_warnings, gate_verdict, gate_generated_utc)
            VALUES (:p, 'historic', :g, 300, 50, 350, 350, 0, 0, 'pass', :g)
            """
        ),
        {"p": PROVIDER, "g": HISTORIC_GEN},
    )
    connection.execute(
        text(
            """
            INSERT INTO core.snapshot_publish_state
                (provider_id, tier, generated_utc, files_written, files_skipped, files_total)
            VALUES (:p, 'static', :g, 100, 0, 100)
            """
        ),
        {"p": PROVIDER, "g": STATIC_GEN},
    )


def test_data_health_lanes_server_side_ages_and_honest_null_gate(conn) -> None:
    out = build_data_health(conn, provider_id=PROVIDER, generated_utc="t")

    lanes = {lane.lane: lane for lane in out.lanes}
    assert set(lanes) == {"live", "static", "rollup"}
    assert [lane.lane for lane in out.lanes] == ["live", "static", "rollup"]

    live = lanes["live"]
    assert live.age_s is not None and 55 <= live.age_s <= 120
    assert live.files_total == 7
    assert live.gate is not None
    assert live.gate.verdict == "warn"
    assert live.gate.checks_run == 7 and live.gate.warnings == 2 and live.gate.errors == 0
    assert live.gate.generated_utc is not None

    rollup = lanes["rollup"]
    assert rollup.gate is not None and rollup.gate.verdict == "pass"
    assert rollup.files_written == 300 and rollup.files_skipped == 50

    static = lanes["static"]
    assert static.files_total == 100
    assert static.last_publish_utc is not None
    assert static.age_s is not None and static.age_s >= 0
    assert static.gate is None


def test_data_health_omits_tier_with_no_state_row(conn) -> None:
    conn.execute(
        text("DELETE FROM core.snapshot_publish_state WHERE provider_id = :p AND tier = 'static'"),
        {"p": PROVIDER},
    )
    out = build_data_health(conn, provider_id=PROVIDER, generated_utc="t")
    assert [lane.lane for lane in out.lanes] == ["live", "rollup"]
    assert all(lane.lane != "static" for lane in out.lanes)


def test_data_health_within_byte_ceiling(conn) -> None:
    out = build_data_health(conn, provider_id=PROVIDER, generated_utc="t")
    size = len(out.model_dump_json().encode("utf-8"))
    assert size <= DATA_HEALTH_BYTE_CEILING, (
        f"data_health {size}B exceeds ceiling {DATA_HEALTH_BYTE_CEILING}B"
    )
