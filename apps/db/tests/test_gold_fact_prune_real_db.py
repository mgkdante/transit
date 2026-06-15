"""Real-database regression tests for the batched gold-fact retention prune.

Batch-2 hot-path operability (ops-core#3 / x-perf#3): the two gold-fact
retention DELETEs in maintenance.prune_gold_fact_history previously ran as a
single UNBOUNDED DELETE every ~57s worker cycle. The first cycle after a worker
outage had to drain the entire 18.7M-scale fact_trip_delay_snapshot backlog in
ONE transaction — a long lock hold + WAL/bloat spike, the same unbounded-heavy-op
hang class the silver realtime prunes were already batched to avoid. The fix
applies ctid IN (SELECT ... LIMIT :batch) batching with a per-cycle cap so a
backlog drains over many cycles, while the dry-run COUNT stays unbounded.

These tests exercise the ACTUAL Postgres ctid batching + LIMIT semantics that
fake-connection tests structurally cannot see. They run ONLY when
TRANSIT_TEST_DATABASE_URL points at a disposable Postgres with the transit
schema applied (alembic upgrade head). CI has no Postgres; this file is
local-only. Never point this at production.

Each test runs inside one transaction and rolls back — nothing persists, reruns
are idempotent.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, text

from transit_ops.maintenance import prune_gold_fact_history

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set — real-DB regression tests skipped",
)

PROVIDER = "stm_goldfactprune_test"
ENDPOINT_ID = 992014
RUN_ID = 992101
# Old rows are this many days back; retention is 14 days, so all are eligible.
OLD = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
# A recent row that must survive a 14-day retention prune anchored at NOW.
NOW = datetime.now(UTC)


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
            VALUES (:p, 'STM gold-fact prune regression', 'America/Toronto', :p)
            """
        ),
        {"p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO core.feed_endpoints
                (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
            VALUES (:e, :p, 'trip_updates', 'trip_updates', 'gtfs_rt_trip_updates')
            """
        ),
        {"e": ENDPOINT_ID, "p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
            VALUES (:r, :p, :e, 'trip_updates', 'succeeded')
            """
        ),
        {"r": RUN_ID, "p": PROVIDER, "e": ENDPOINT_ID},
    )


def _insert_fact_rows(connection, *, snapshot_id: int, count: int, captured_at) -> None:
    """Insert ``count`` fact_trip_delay_snapshot rows under one realtime snapshot.

    The fact table FKs realtime_snapshot_id -> raw.realtime_snapshot_index, so a
    snapshot-index row is created first. Each snapshot needs its OWN ingestion_run
    (uq_realtime_snapshot_index_ingestion_run_id is unique on ingestion_run_id —
    one snapshot per run), so derive a distinct run id from the snapshot id.
    """
    run_id = snapshot_id + 1_000_000
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
            VALUES (CAST(:r AS bigint), :p, CAST(:e AS bigint), 'trip_updates', 'succeeded')
            """
        ),
        {"r": run_id, "p": PROVIDER, "e": ENDPOINT_ID},
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.realtime_snapshot_index
                (realtime_snapshot_id, ingestion_run_id, provider_id,
                 feed_endpoint_id, feed_timestamp_utc)
            VALUES (
                CAST(:sid AS bigint), CAST(:r AS bigint), :p,
                CAST(:e AS bigint), CAST(:ts AS timestamptz)
            )
            """
        ),
        {"sid": snapshot_id, "r": run_id, "p": PROVIDER, "e": ENDPOINT_ID, "ts": captured_at},
    )
    connection.execute(
        text(
            """
            INSERT INTO gold.fact_trip_delay_snapshot
                (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                 snapshot_local_date, feed_timestamp_utc, captured_at_utc,
                 stop_time_update_count)
            SELECT
                :p,
                CAST(:sid AS bigint),
                gs.i,
                20260101,
                DATE '2026-01-01',
                CAST(:ts AS timestamptz),
                CAST(:ts AS timestamptz),
                1
            FROM generate_series(0, CAST(:n AS integer) - 1) AS gs(i)
            """
        ),
        {"p": PROVIDER, "sid": snapshot_id, "ts": captured_at, "n": count},
    )


def _fact_count(connection) -> int:
    return int(
        connection.execute(
            text(
                """
                SELECT COUNT(*) FROM gold.fact_trip_delay_snapshot
                WHERE provider_id = :p
                """
            ),
            {"p": PROVIDER},
        ).scalar_one()
    )


def test_gold_fact_prune_caps_deletes_at_batch_per_cycle(conn) -> None:
    """A backlog larger than :batch deletes exactly :batch rows in one cycle."""
    _insert_fact_rows(conn, snapshot_id=992001, count=25, captured_at=OLD)
    assert _fact_count(conn) == 25

    _cutoff, counts = prune_gold_fact_history(
        conn,
        provider_id=PROVIDER,
        retention_days=14,
        batch_size=10,
        now_utc=NOW,
    )

    # Only :batch rows were drained this cycle; the rest remain for later cycles.
    assert counts["gold.fact_trip_delay_snapshot"] == 10
    assert _fact_count(conn) == 15


def test_gold_fact_prune_drains_backlog_over_multiple_cycles(conn) -> None:
    """Repeated bounded cycles eventually drain the whole eligible backlog."""
    _insert_fact_rows(conn, snapshot_id=992001, count=25, captured_at=OLD)

    total_deleted = 0
    for _ in range(10):  # generous cycle budget; 25 / 10 -> 3 cycles
        _cutoff, counts = prune_gold_fact_history(
            conn,
            provider_id=PROVIDER,
            retention_days=14,
            batch_size=10,
            now_utc=NOW,
        )
        total_deleted += counts["gold.fact_trip_delay_snapshot"]
        if _fact_count(conn) == 0:
            break

    assert total_deleted == 25
    assert _fact_count(conn) == 0


def test_gold_fact_prune_keeps_rows_inside_retention_window(conn) -> None:
    """Rows newer than the retention cutoff are never deleted, even when batched."""
    _insert_fact_rows(conn, snapshot_id=992001, count=5, captured_at=OLD)
    recent = NOW - timedelta(days=1)  # inside the 14-day window
    _insert_fact_rows(conn, snapshot_id=992002, count=5, captured_at=recent)
    assert _fact_count(conn) == 10

    # Large batch so the only thing bounding the delete is the cutoff predicate.
    _cutoff, counts = prune_gold_fact_history(
        conn,
        provider_id=PROVIDER,
        retention_days=14,
        batch_size=10000,
        now_utc=NOW,
    )

    assert counts["gold.fact_trip_delay_snapshot"] == 5
    assert _fact_count(conn) == 5  # the recent snapshot survives


def test_gold_fact_prune_dry_run_reports_full_backlog_unbounded(conn) -> None:
    """The dry-run COUNT reports the TRUE backlog, never the per-cycle batch cap."""
    _insert_fact_rows(conn, snapshot_id=992001, count=25, captured_at=OLD)

    _cutoff, counts = prune_gold_fact_history(
        conn,
        provider_id=PROVIDER,
        retention_days=14,
        batch_size=10,  # smaller than the backlog
        dry_run=True,
        now_utc=NOW,
    )

    # COUNT is unbounded — reports all 25 eligible rows despite batch_size=10.
    assert counts["gold.fact_trip_delay_snapshot"] == 25
    # Nothing was actually deleted.
    assert _fact_count(conn) == 25
