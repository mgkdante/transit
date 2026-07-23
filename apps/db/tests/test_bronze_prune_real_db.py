"""Real-database regression tests for the batched Bronze prune (slice-9.1.1k).

These exercise actual Postgres semantics the fake-connection tests cannot see:
oldest-first LIMIT batching, excluded-id re-selection, the silver /
dataset_versions reference guards, latest-per-endpoint survival, and the
capture race the age-gated orphan-run DELETE fixes (a worker commits its
ingestion_run in one transaction and registers the object in a second — an
unfiltered orphan sweep could delete the run in between).

They run ONLY when TRANSIT_TEST_DATABASE_URL points at a disposable Postgres
with the transit schema applied (e.g. a throwaway local cluster restored from
`pg_dump --schema-only -n core -n raw -n silver`). Each test runs inside one
transaction and rolls back — nothing persists, reruns are idempotent. Only the
CONNECTION-level prune functions are exercised here: the engine-level batch
loop commits per batch and would escape the rollback fixture (it is covered
offline in tests/test_maintenance.py).

    TRANSIT_TEST_DATABASE_URL=\
        "postgresql+psycopg://repro@/transit_repro?host=/tmp/bronzerepro" \
        uv run pytest tests/test_bronze_prune_real_db.py -v

Never point this at production.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from transit_ops.maintenance import (
    prune_bronze_realtime_objects,
    prune_bronze_static_objects,
)

PROVIDER = "stm_bronze_prune_test"
TU_ENDPOINT_ID = 990021
VP_ENDPOINT_ID = 990022
STATIC_ENDPOINT_ID = 990023

NOW = datetime.now(tz=UTC)

# (run_id, object_id, snapshot_id, endpoint_id, captured_at, storage_path)
TU_OLD_A = (
    990101,
    990201,
    990301,
    TU_ENDPOINT_ID,
    NOW - timedelta(days=40),
    "bronze-prune-test/trip_updates/old-a.pb",
)
TU_OLD_B = (
    990102,
    990202,
    990302,
    TU_ENDPOINT_ID,
    NOW - timedelta(days=39),
    "bronze-prune-test/trip_updates/old-b.pb",
)
TU_OLD_C = (
    990103,
    990203,
    990303,
    TU_ENDPOINT_ID,
    NOW - timedelta(days=38),
    "bronze-prune-test/trip_updates/old-c.pb",
)
TU_FRESH = (990104, 990204, 990304, TU_ENDPOINT_ID, NOW, "bronze-prune-test/trip_updates/fresh.pb")
# vehicle_positions has a single 37d-old row that is also its LATEST snapshot:
# old enough to be in the cutoff window, yet it must always survive.
VP_OLD_LATEST = (
    990105,
    990205,
    990305,
    VP_ENDPOINT_ID,
    NOW - timedelta(days=37),
    "bronze-prune-test/vehicle_positions/old-latest.pb",
)

REALTIME_ROWS = (TU_OLD_A, TU_OLD_B, TU_OLD_C, TU_FRESH, VP_OLD_LATEST)

STATIC_RUN_REFERENCED = 990111
STATIC_RUN_UNREFERENCED = 990112
STATIC_OBJECT_REFERENCED = 990211
STATIC_OBJECT_UNREFERENCED = 990212
STATIC_STARTED_AT = NOW - timedelta(days=400)
DATASET_VERSION_ID = 990401

IN_FLIGHT_RUN_ID = 990121
AGED_ORPHAN_RUN_ID = 990122

SILVER_SNAPSHOT_ROW_ID = 990501


class FakeBronzeStorage:
    """Bronze storage stub that records calls without doing I/O."""

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
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        _seed(connection, seed_provider)
        try:
            yield connection
        finally:
            transaction.rollback()


def _seed(connection, seed_provider) -> None:
    seed_provider(connection, PROVIDER, display_name="STM bronze prune regression")
    for endpoint_id, endpoint_key, feed_kind, source_format in (
        (TU_ENDPOINT_ID, "trip_updates", "trip_updates", "gtfs_rt_trip_updates"),
        (VP_ENDPOINT_ID, "vehicle_positions", "vehicle_positions", "gtfs_rt_vehicle_positions"),
        (STATIC_ENDPOINT_ID, "static_schedule", "static_schedule", "gtfs_schedule_zip"),
    ):
        connection.execute(
            text(
                """
                INSERT INTO core.feed_endpoints
                    (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
                VALUES (:e, :p, :key, :kind, :fmt)
                """
            ),
            {
                "e": endpoint_id,
                "p": PROVIDER,
                "key": endpoint_key,
                "kind": feed_kind,
                "fmt": source_format,
            },
        )
    for run_id, object_id, snapshot_id, endpoint_id, captured_at, storage_path in REALTIME_ROWS:
        run_kind = "trip_updates" if endpoint_id == TU_ENDPOINT_ID else "vehicle_positions"
        connection.execute(
            text(
                """
                INSERT INTO raw.ingestion_runs
                    (ingestion_run_id, provider_id, feed_endpoint_id,
                     run_kind, status, started_at_utc)
                VALUES (:r, :p, :e, :kind, 'succeeded', :started)
                """
            ),
            {
                "r": run_id,
                "p": PROVIDER,
                "e": endpoint_id,
                "kind": run_kind,
                "started": captured_at,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO raw.ingestion_objects
                    (ingestion_object_id, ingestion_run_id, provider_id,
                     object_kind, storage_backend, storage_path)
                VALUES (:o, :r, :p, 'gtfs_rt_feed', 's3', :path)
                """
            ),
            {"o": object_id, "r": run_id, "p": PROVIDER, "path": storage_path},
        )
        connection.execute(
            text(
                """
                INSERT INTO raw.realtime_snapshot_index
                    (realtime_snapshot_id, ingestion_run_id, ingestion_object_id,
                     provider_id, feed_endpoint_id, feed_timestamp_utc, captured_at_utc)
                VALUES (:s, :r, :o, :p, :e, :captured, :captured)
                """
            ),
            {
                "s": snapshot_id,
                "r": run_id,
                "o": object_id,
                "p": PROVIDER,
                "e": endpoint_id,
                "captured": captured_at,
            },
        )


def _seed_static_runs(connection) -> None:
    for run_id, object_id, storage_path in (
        (
            STATIC_RUN_REFERENCED,
            STATIC_OBJECT_REFERENCED,
            "bronze-prune-test/static/referenced.zip",
        ),
        (
            STATIC_RUN_UNREFERENCED,
            STATIC_OBJECT_UNREFERENCED,
            "bronze-prune-test/static/unreferenced.zip",
        ),
    ):
        connection.execute(
            text(
                """
                INSERT INTO raw.ingestion_runs
                    (ingestion_run_id, provider_id, feed_endpoint_id,
                     run_kind, status, started_at_utc)
                VALUES (:r, :p, :e, 'static_schedule', 'succeeded', :started)
                """
            ),
            {"r": run_id, "p": PROVIDER, "e": STATIC_ENDPOINT_ID, "started": STATIC_STARTED_AT},
        )
        connection.execute(
            text(
                """
                INSERT INTO raw.ingestion_objects
                    (ingestion_object_id, ingestion_run_id, provider_id,
                     object_kind, storage_backend, storage_path)
                VALUES (:o, :r, :p, 'gtfs_schedule_zip', 's3', :path)
                """
            ),
            {"o": object_id, "r": run_id, "p": PROVIDER, "path": storage_path},
        )
    connection.execute(
        text(
            """
            INSERT INTO core.dataset_versions
                (dataset_version_id, provider_id, feed_endpoint_id,
                 source_ingestion_run_id, dataset_kind, content_hash, is_current)
            VALUES (:dv, :p, :e, :r, 'static_schedule', 'bronze-prune-test-hash', false)
            """
        ),
        {
            "dv": DATASET_VERSION_ID,
            "p": PROVIDER,
            "e": STATIC_ENDPOINT_ID,
            "r": STATIC_RUN_REFERENCED,
        },
    )


def _seed_objectless_run(connection, run_id: int, started_at: datetime, status: str) -> None:
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id,
                 run_kind, status, started_at_utc)
            VALUES (:r, :p, :e, 'trip_updates', :status, :started)
            """
        ),
        {"r": run_id, "p": PROVIDER, "e": TU_ENDPOINT_ID, "status": status, "started": started_at},
    )


def _object_exists(connection, object_id: int) -> bool:
    return bool(
        connection.execute(
            text("SELECT 1 FROM raw.ingestion_objects WHERE ingestion_object_id = :o"),
            {"o": object_id},
        ).first()
    )


def _snapshot_exists(connection, snapshot_id: int) -> bool:
    return bool(
        connection.execute(
            text("SELECT 1 FROM raw.realtime_snapshot_index WHERE realtime_snapshot_id = :s"),
            {"s": snapshot_id},
        ).first()
    )


def _run_exists(connection, run_id: int) -> bool:
    return bool(
        connection.execute(
            text("SELECT 1 FROM raw.ingestion_runs WHERE ingestion_run_id = :r"),
            {"r": run_id},
        ).first()
    )


def test_realtime_prune_honors_oldest_first_limit(conn) -> None:
    storage = FakeBronzeStorage()

    cutoff_utc, object_counts, meta_counts, failed_ids = prune_bronze_realtime_objects(
        conn,
        provider_id=PROVIDER,
        retention_days=30,
        bronze_storage=storage,
        now_utc=NOW,
        max_objects=2,
    )

    assert cutoff_utc == NOW - timedelta(days=30)
    assert object_counts == {"realtime": 2}
    assert failed_ids == set()
    # Oldest two first, in capture order.
    assert storage.deleted == [TU_OLD_A[5], TU_OLD_B[5]]
    assert meta_counts["raw.realtime_snapshot_index"] == 2
    assert meta_counts["raw.ingestion_objects"] == 2
    # Their just-emptied runs are 40/39d old — swept by the age-gated orphan delete.
    assert meta_counts["raw.ingestion_runs"] == 2
    for _run, object_id, snapshot_id, *_ in (TU_OLD_A, TU_OLD_B):
        assert not _object_exists(conn, object_id)
        assert not _snapshot_exists(conn, snapshot_id)
    # Third-oldest stays for the next batch; fresh latest survives.
    assert _object_exists(conn, TU_OLD_C[1])
    assert _object_exists(conn, TU_FRESH[1])


def test_realtime_prune_skips_excluded_object_ids(conn) -> None:
    storage = FakeBronzeStorage()

    _cutoff, object_counts, _meta, failed_ids = prune_bronze_realtime_objects(
        conn,
        provider_id=PROVIDER,
        retention_days=30,
        bronze_storage=storage,
        now_utc=NOW,
        max_objects=2,
        excluded_object_ids=[TU_OLD_A[1]],
    )

    assert object_counts == {"realtime": 2}
    assert failed_ids == set()
    # The excluded oldest row is skipped; the next two are selected instead.
    assert storage.deleted == [TU_OLD_B[5], TU_OLD_C[5]]
    assert _object_exists(conn, TU_OLD_A[1])


def test_realtime_prune_excludes_silver_referenced_snapshots(conn) -> None:
    conn.execute(
        text(
            """
            INSERT INTO silver.rt_feed_snapshots
                (rt_feed_snapshot_id, provider_id, feed_endpoint_id, ingestion_run_id,
                 endpoint_key, source_realtime_snapshot_id)
            VALUES (:id, :p, :e, :r, 'trip_updates', :snap)
            """
        ),
        {
            "id": SILVER_SNAPSHOT_ROW_ID,
            "p": PROVIDER,
            "e": TU_ENDPOINT_ID,
            "r": TU_OLD_A[0],
            "snap": TU_OLD_A[2],
        },
    )
    storage = FakeBronzeStorage()

    _cutoff, object_counts, _meta, _failed = prune_bronze_realtime_objects(
        conn,
        provider_id=PROVIDER,
        retention_days=30,
        bronze_storage=storage,
        now_utc=NOW,
        max_objects=10,
    )

    # OLD_A is pinned by the silver source reference; only B and C delete.
    assert object_counts == {"realtime": 2}
    assert storage.deleted == [TU_OLD_B[5], TU_OLD_C[5]]
    assert _object_exists(conn, TU_OLD_A[1])
    assert _snapshot_exists(conn, TU_OLD_A[2])


def test_realtime_prune_never_deletes_latest_snapshot_per_endpoint(conn) -> None:
    storage = FakeBronzeStorage()

    _cutoff, object_counts, _meta, _failed = prune_bronze_realtime_objects(
        conn,
        provider_id=PROVIDER,
        retention_days=30,
        bronze_storage=storage,
        now_utc=NOW,
        max_objects=10,
    )

    # All three old trip_updates rows delete, but the 37d-old vehicle_positions
    # row survives: it is that endpoint's latest snapshot.
    assert object_counts == {"realtime": 3}
    assert VP_OLD_LATEST[5] not in storage.deleted
    assert _object_exists(conn, VP_OLD_LATEST[1])
    assert _snapshot_exists(conn, VP_OLD_LATEST[2])
    assert _object_exists(conn, TU_FRESH[1])


def test_static_prune_excludes_dataset_version_referenced_runs(conn) -> None:
    _seed_static_runs(conn)
    storage = FakeBronzeStorage()

    cutoff_utc, object_counts, meta_counts, failed_ids = prune_bronze_static_objects(
        conn,
        provider_id=PROVIDER,
        retention_days=365,
        bronze_storage=storage,
        now_utc=NOW,
        max_objects=10,
    )

    assert cutoff_utc == NOW - timedelta(days=365)
    assert object_counts == {"static": 1}
    assert failed_ids == set()
    assert storage.deleted == ["bronze-prune-test/static/unreferenced.zip"]
    assert not _object_exists(conn, STATIC_OBJECT_UNREFERENCED)
    assert not _run_exists(conn, STATIC_RUN_UNREFERENCED)
    # The dataset_versions-referenced run and its object are untouchable.
    assert _object_exists(conn, STATIC_OBJECT_REFERENCED)
    assert _run_exists(conn, STATIC_RUN_REFERENCED)
    assert meta_counts["raw.ingestion_objects"] == 1


def test_realtime_prune_spares_in_flight_capture_run(conn) -> None:
    """RACE REGRESSION: an object-less run committed seconds ago (the worker's
    first transaction; realtime_gtfs.py commits the run, then registers the
    object in a second transaction) must survive a live prune, while an aged
    object-less orphan is still swept."""
    _seed_objectless_run(conn, IN_FLIGHT_RUN_ID, NOW, "running")
    _seed_objectless_run(conn, AGED_ORPHAN_RUN_ID, NOW - timedelta(days=40), "failed")
    storage = FakeBronzeStorage()

    _cutoff, object_counts, meta_counts, _failed = prune_bronze_realtime_objects(
        conn,
        provider_id=PROVIDER,
        retention_days=30,
        bronze_storage=storage,
        now_utc=NOW,
        max_objects=10,
    )

    assert object_counts == {"realtime": 3}
    # 3 just-emptied old runs + the aged orphan; NOT the in-flight run.
    assert meta_counts["raw.ingestion_runs"] == 4
    assert _run_exists(conn, IN_FLIGHT_RUN_ID)
    assert not _run_exists(conn, AGED_ORPHAN_RUN_ID)
