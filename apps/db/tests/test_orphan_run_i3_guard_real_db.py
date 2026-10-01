
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from transit_ops.maintenance import DELETE_ORPHANED_INGESTION_RUNS

PROVIDER = "stm_orphanrun_i3_test"
ENDPOINT_ID = 993014
I3_RUN_WITH_SNAPSHOT = 993201
ORPHAN_RUN = 993202
SNAPSHOT_ID = 993301

AGED = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
NOW = datetime.now(UTC)
CUTOFF = NOW - timedelta(days=30)


@pytest.fixture()
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        seed_provider(connection, PROVIDER, display_name="STM orphan-run i3 guard regression")
        _seed(connection)
        try:
            yield connection
        finally:
            transaction.rollback()


def _seed(connection) -> None:
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
    deleted = conn.execute(
        DELETE_ORPHANED_INGESTION_RUNS,
        {"provider_id": PROVIDER, "cutoff_utc": CUTOFF},
    ).rowcount

    remaining = _run_ids(conn)
    assert deleted == 1
    assert ORPHAN_RUN not in remaining
    assert I3_RUN_WITH_SNAPSHOT in remaining
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
