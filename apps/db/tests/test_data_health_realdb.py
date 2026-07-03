"""Real-DB test for the S11 build_data_health builder (status/data_health.json).

Exercises the ACTUAL Postgres path fake tests cannot: the migration-0078 gate
telemetry columns on core.snapshot_publish_state, the SERVER-SIDE age_s
computation off now() (EXTRACT/floor), the honest-NULL gate block on a pre-0078
row (all gate_* columns NULL), the 'historic' -> 'rollup' lane relabel, the
omit-when-absent rule for a tier with no state row, and the byte-ceiling probe.

Runs ONLY with TRANSIT_TEST_DATABASE_URL on a disposable Postgres at head
(0078). CI has no Postgres; this file is local-only. Never point at production.
Each test runs inside one transaction and rolls back.

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://repro@:55437/transit_repro?host=/tmp/pg" \
        uv run pytest tests/test_data_health_realdb.py -v
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, text

from transit_ops.snapshots.builders import build_data_health
from transit_ops.snapshots.contract import DATA_HEALTH_BYTE_CEILING

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set — real-DB tests skipped",
)

PROVIDER = "stm_datahealth_test"
NOW = datetime.now(UTC)
# live: fresh, with gate telemetry (warn). historic: older, clean (pass).
LIVE_GEN = NOW - timedelta(seconds=60)
HISTORIC_GEN = NOW - timedelta(hours=6)
# static: a PRE-0078-shaped row — file counts present but every gate_* column NULL.
STATIC_GEN = NOW - timedelta(days=1)


@pytest.fixture()
def conn():
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        _seed(connection)
        try:
            yield connection
        finally:
            transaction.rollback()
        engine.dispose()


def _seed(connection) -> None:
    connection.execute(
        text(
            """
            INSERT INTO core.providers (provider_id, display_name, timezone, provider_key)
            VALUES (:p, 'STM data-health test', 'America/Toronto', :p)
            """
        ),
        {"p": PROVIDER},
    )
    # live lane — WITH gate telemetry (verdict warn).
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
    # historic lane — clean gate (pass); surfaced to the citizen as 'rollup'.
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
    # static lane — PRE-0078 shape: file counts present, gate_* all NULL (honest-unknown).
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
    # All three lanes present; historic surfaces as 'rollup'.
    assert set(lanes) == {"live", "static", "rollup"}
    # Fixed presentation order.
    assert [lane.lane for lane in out.lanes] == ["live", "static", "rollup"]

    live = lanes["live"]
    # age_s computed server-side off now() — ~60s, allow clock jitter.
    assert live.age_s is not None and 55 <= live.age_s <= 120
    assert live.files_total == 7
    assert live.gate is not None
    assert live.gate.verdict == "warn"
    assert live.gate.checks_run == 7 and live.gate.warnings == 2 and live.gate.errors == 0
    assert live.gate.generated_utc is not None  # ISO string, not None

    rollup = lanes["rollup"]
    assert rollup.gate is not None and rollup.gate.verdict == "pass"
    assert rollup.files_written == 300 and rollup.files_skipped == 50

    # Pre-0078 static row: file counts real, gate block honestly ABSENT (unknown).
    static = lanes["static"]
    assert static.files_total == 100
    assert static.last_publish_utc is not None
    assert static.age_s is not None and static.age_s >= 0
    assert static.gate is None  # honest-NULL: never a fabricated pass


def test_data_health_omits_tier_with_no_state_row(conn) -> None:
    # Drop the static row: build_data_health must OMIT the lane (honest not-applicable),
    # never fabricate a zero-age placeholder.
    conn.execute(
        text(
            "DELETE FROM core.snapshot_publish_state "
            "WHERE provider_id = :p AND tier = 'static'"
        ),
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
