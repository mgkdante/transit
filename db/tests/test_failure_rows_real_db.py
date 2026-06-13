"""Real-database regression tests for silver-load failure rows (slice-9.1.1o).

These exercise actual Postgres semantics that fake-connection tests cannot
see — the exact lesson of slice-9.1.1h, where every offline test passed while
prod was broken:

  1. ck_ingestion_runs_run_kind (post-0041) ACCEPTS run_kind='silver_load'.
     A fake connection cannot see a CHECK constraint; only a real INSERT can
     prove the migration actually widened it.
  2. The age-gated orphan-run prune retains a FRESH silver_load failure row
     (no ingestion_objects, recent started_at) while sweeping an AGED one —
     so failure history survives its retention window and is probe-queryable.
  3. gold.feed_freshness_current (re-created by 0041 with the silver_load
     filter) never surfaces a silver_load row: the latest run per endpoint
     stays the capture row, so public /v1 provenance.json / network.json
     freshness is byte-identical for real run_kinds.

They run ONLY when TRANSIT_TEST_DATABASE_URL points at a disposable Postgres
with the transit schema applied AND migrated to head (>= 0041):

    pg_dump --schema-only -n core -n raw -n silver -n gold prod | psql repro
    cd db && TRANSIT_TEST_DATABASE_URL=... uv run alembic upgrade head
    TRANSIT_TEST_DATABASE_URL=\
        "postgresql+psycopg://repro@/transit_repro?host=/tmp/failrepro" \
        uv run pytest tests/test_failure_rows_real_db.py -v

Each test runs inside one transaction and rolls back — nothing persists,
reruns are idempotent. Never point this at production.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, text

from transit_ops.ingestion.common import insert_failed_ingestion_run
from transit_ops.maintenance import prune_bronze_realtime_objects

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set — real-DB regression tests skipped",
)

PROVIDER = "stm_silver_load_test"
TU_ENDPOINT_ID = 990031
I3_ENDPOINT_ID = 990032

NOW = datetime.now(tz=UTC)

# A normal succeeded capture run with a registered object (so it is NOT an
# orphan) — this is what gold.feed_freshness_current should keep surfacing.
CAPTURE_RUN_ID = 990141
CAPTURE_OBJECT_ID = 990241
CAPTURE_SNAPSHOT_ID = 990341
CAPTURE_AT = NOW - timedelta(minutes=1)

FRESH_FAILED_RUN_ID = 990142
AGED_FAILED_RUN_ID = 990143


class FakeBronzeStorage:
    def __init__(self) -> None:
        self.deleted: list[str] = []
        self.fail_on: set[str] = set()

    def delete_object(self, storage_path: str) -> None:
        if storage_path in self.fail_on:
            raise OSError(f"Simulated failure for {storage_path}")
        self.deleted.append(storage_path)

    def storage_backend(self) -> str:
        return "local"


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
            VALUES (:p, 'STM silver_load regression', 'America/Toronto', :p)
            """
        ),
        {"p": PROVIDER},
    )
    for endpoint_id, endpoint_key, feed_kind, source_format in (
        (TU_ENDPOINT_ID, "trip_updates", "trip_updates", "gtfs_rt_trip_updates"),
        (I3_ENDPOINT_ID, "i3_alerts", "i3_alerts", "api_i3_json"),
    ):
        connection.execute(
            text(
                """
                INSERT INTO core.feed_endpoints
                    (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
                VALUES (:e, :p, :key, :kind, :fmt)
                """
            ),
            {"e": endpoint_id, "p": PROVIDER, "key": endpoint_key,
             "kind": feed_kind, "fmt": source_format},
        )
    # A successful capture run for trip_updates WITH an object + snapshot (so it
    # is not orphaned and IS the latest run for the endpoint).
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id,
                 run_kind, status, started_at_utc, completed_at_utc)
            VALUES (:r, :p, :e, 'trip_updates', 'succeeded', :at, :at)
            """
        ),
        {"r": CAPTURE_RUN_ID, "p": PROVIDER, "e": TU_ENDPOINT_ID, "at": CAPTURE_AT},
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_objects
                (ingestion_object_id, ingestion_run_id, provider_id,
                 object_kind, storage_backend, storage_path)
            VALUES (:o, :r, :p, 'gtfs_rt_feed', 's3', 'silver-load-test/tu/capture.pb')
            """
        ),
        {"o": CAPTURE_OBJECT_ID, "r": CAPTURE_RUN_ID, "p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.realtime_snapshot_index
                (realtime_snapshot_id, ingestion_run_id, ingestion_object_id,
                 provider_id, feed_endpoint_id, feed_timestamp_utc, captured_at_utc)
            VALUES (:s, :r, :o, :p, :e, :at, :at)
            """
        ),
        {"s": CAPTURE_SNAPSHOT_ID, "r": CAPTURE_RUN_ID, "o": CAPTURE_OBJECT_ID,
         "p": PROVIDER, "e": TU_ENDPOINT_ID, "at": CAPTURE_AT},
    )


def _run_exists(connection, run_id: int) -> bool:
    return bool(
        connection.execute(
            text("SELECT 1 FROM raw.ingestion_runs WHERE ingestion_run_id = :r"),
            {"r": run_id},
        ).first()
    )


def test_silver_load_run_kind_accepted_by_check_constraint(conn) -> None:
    """The post-0041 ck_ingestion_runs_run_kind must accept 'silver_load'.

    A fake connection structurally cannot see this CHECK — only a real INSERT
    proves the migration widened the constraint.
    """
    run_id = insert_failed_ingestion_run(
        conn,
        provider_id=PROVIDER,
        feed_endpoint_id=I3_ENDPOINT_ID,
        run_kind="silver_load",
        started_at_utc=NOW,
        completed_at_utc=NOW + timedelta(seconds=5),
        error_message="load-i3-silver failed: boom",
    )

    row = conn.execute(
        text(
            """
            SELECT run_kind, status, error_message, http_status_code
            FROM raw.ingestion_runs
            WHERE ingestion_run_id = :r
            """
        ),
        {"r": run_id},
    ).one()
    assert row.run_kind == "silver_load"
    assert row.status == "failed"
    assert row.error_message == "load-i3-silver failed: boom"
    assert row.http_status_code is None


def test_orphan_prune_retains_fresh_failed_runs_real_db(conn) -> None:
    """A fresh silver_load failure row (no objects) survives the orphan prune;
    an aged one is swept by the same age-gated DELETE."""
    # Fresh failure row — written NOW, must survive the 30-day cutoff.
    _fresh_run_id = insert_failed_ingestion_run(
        conn,
        provider_id=PROVIDER,
        feed_endpoint_id=TU_ENDPOINT_ID,
        run_kind="silver_load",
        started_at_utc=NOW,
        completed_at_utc=NOW,
        error_message="load-realtime-silver failed: fresh",
    )
    # Re-id THIS specific fresh run, not max(ingestion_run_id) — the fixture
    # seeds runs that already own ingestion_objects at higher ids, so max()
    # would target one of those and the re-id FK-violates on its child objects.
    conn.execute(
        text("UPDATE raw.ingestion_runs SET ingestion_run_id = :new "
             "WHERE ingestion_run_id = :old"),
        {"new": FRESH_FAILED_RUN_ID, "old": _fresh_run_id},
    )
    # Aged failure row — 40 days old, must be swept.
    conn.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id,
                 run_kind, status, started_at_utc, completed_at_utc)
            VALUES (:r, :p, :e, 'silver_load', 'failed', :at, :at)
            """
        ),
        {"r": AGED_FAILED_RUN_ID, "p": PROVIDER, "e": TU_ENDPOINT_ID,
         "at": NOW - timedelta(days=40)},
    )

    storage = FakeBronzeStorage()
    prune_bronze_realtime_objects(
        conn,
        provider_id=PROVIDER,
        retention_days=30,
        bronze_storage=storage,
        now_utc=NOW,
        max_objects=10,
    )

    assert _run_exists(conn, FRESH_FAILED_RUN_ID)
    assert not _run_exists(conn, AGED_FAILED_RUN_ID)


def test_feed_freshness_view_ignores_silver_load_rows(conn) -> None:
    """gold.feed_freshness_current must keep surfacing the capture row, never a
    silver_load failure row — even when the failure row is the newest run for
    the endpoint (which would otherwise win the DISTINCT ON)."""
    # A silver_load failure row strictly newer than the capture run.
    insert_failed_ingestion_run(
        conn,
        provider_id=PROVIDER,
        feed_endpoint_id=TU_ENDPOINT_ID,
        run_kind="silver_load",
        started_at_utc=NOW,
        completed_at_utc=NOW,
        error_message="load-realtime-silver failed: newest",
    )

    row = conn.execute(
        text(
            """
            SELECT status, completed_at_utc
            FROM gold.feed_freshness_current
            WHERE provider_id = :p AND endpoint_key = 'trip_updates'
            """
        ),
        {"p": PROVIDER},
    ).one()
    # The capture row wins — status succeeded, not the silver_load 'failed'.
    assert row.status == "succeeded"
    assert row.completed_at_utc == CAPTURE_AT
