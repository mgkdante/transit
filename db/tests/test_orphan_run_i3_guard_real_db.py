"""Real-DB regression: orphaned-ingestion-run prune must not destroy i3 runs.

Batch-2 (ops-core#4): maintenance.DELETE_ORPHANED_INGESTION_RUNS deletes aged
raw.ingestion_runs that own no raw.ingestion_objects row. But an i3 run owns its
raw.i3_alert_snapshots row instead (fk_raw_i3_alert_snapshots_ingestion_run_id,
0013 — non-cascading, 1:1 UNIQUE on ingestion_run_id), NOT an ingestion_objects
row. An i3 run older than the bronze cutoff whose snapshot survives under the
longer 90-day silver-closed retention would match the unguarded "orphaned"
DELETE and FK-violate, aborting the whole per-cycle bronze-realtime prune. The
fix adds a NOT EXISTS guard against raw.i3_alert_snapshots, mirroring the i3
variant DELETE_ORPHANED_I3_INGESTION_RUNS.

This exercises the ACTUAL non-cascading FK that fake-connection tests cannot
see. Runs ONLY with TRANSIT_TEST_DATABASE_URL on a disposable Postgres at head.
CI has no Postgres; this file is local-only. Never point this at production.

Each test runs inside one transaction and rolls back.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, text

from transit_ops.maintenance import DELETE_ORPHANED_INGESTION_RUNS

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set — real-DB regression tests skipped",
)

PROVIDER = "stm_orphanrun_i3_test"
ENDPOINT_ID = 993014
# An i3 run that owns a surviving i3_alert_snapshots row (must be retained).
I3_RUN_WITH_SNAPSHOT = 993201
# A genuinely orphaned run: aged, no objects, no i3 snapshot (must be deleted).
ORPHAN_RUN = 993202
SNAPSHOT_ID = 993301

# All runs are well older than the cutoff so the age gate does not retain them.
AGED = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
NOW = datetime.now(UTC)
CUTOFF = NOW - timedelta(days=30)


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
            VALUES (:p, 'STM orphan-run i3 guard regression', 'America/Toronto', :p)
            """
        ),
        {"p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO core.feed_endpoints
                (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
            VALUES (:e, :p, 'i3_alerts', 'i3_alerts', 'api_i3_json')
            """
        ),
        {"e": ENDPOINT_ID, "p": PROVIDER},
    )
    # Two aged runs with NO ingestion_objects rows.
    for run_id in (I3_RUN_WITH_SNAPSHOT, ORPHAN_RUN):
        connection.execute(
            text(
                """
                INSERT INTO raw.ingestion_runs
                    (ingestion_run_id, provider_id, feed_endpoint_id, run_kind,
                     status, started_at_utc)
                VALUES (
                    CAST(:r AS bigint), :p, CAST(:e AS bigint), 'i3_alerts',
                    'succeeded', CAST(:ts AS timestamptz)
                )
                """
            ),
            {"r": run_id, "p": PROVIDER, "e": ENDPOINT_ID, "ts": AGED},
        )
    # Only I3_RUN_WITH_SNAPSHOT owns a surviving i3_alert_snapshots row.
    connection.execute(
        text(
            """
            INSERT INTO raw.i3_alert_snapshots
                (i3_alert_snapshot_id, provider_id, feed_endpoint_id,
                 ingestion_run_id, captured_at_utc, raw_payload_json)
            VALUES (
                CAST(:sid AS bigint), :p, CAST(:e AS bigint),
                CAST(:r AS bigint), CAST(:ts AS timestamptz), CAST('{}' AS jsonb)
            )
            """
        ),
        {
            "sid": SNAPSHOT_ID,
            "p": PROVIDER,
            "e": ENDPOINT_ID,
            "r": I3_RUN_WITH_SNAPSHOT,
            "ts": AGED,
        },
    )


def _run_ids(connection) -> set[int]:
    return {
        int(row[0])
        for row in connection.execute(
            text(
                """
                SELECT ingestion_run_id FROM raw.ingestion_runs
                WHERE provider_id = :p
                """
            ),
            {"p": PROVIDER},
        )
    }


def test_orphan_run_prune_spares_i3_run_with_surviving_snapshot(conn) -> None:
    """The aged i3 run keeps its run row because its snapshot still references it.

    Without the NOT EXISTS i3_alert_snapshots guard this DELETE would FK-violate
    (the snapshot's non-cascading FK) and abort the entire bronze-realtime prune.
    """
    deleted = conn.execute(
        DELETE_ORPHANED_INGESTION_RUNS,
        {"provider_id": PROVIDER, "cutoff_utc": CUTOFF},
    ).rowcount

    remaining = _run_ids(conn)
    # The genuinely-orphaned run is gone; the i3 run with a snapshot is retained.
    assert deleted == 1
    assert ORPHAN_RUN not in remaining
    assert I3_RUN_WITH_SNAPSHOT in remaining
    # The owning snapshot is untouched.
    surviving_snapshots = int(
        conn.execute(
            text(
                """
                SELECT COUNT(*) FROM raw.i3_alert_snapshots
                WHERE ingestion_run_id = CAST(:r AS bigint)
                """
            ),
            {"r": I3_RUN_WITH_SNAPSHOT},
        ).scalar_one()
    )
    assert surviving_snapshots == 1
