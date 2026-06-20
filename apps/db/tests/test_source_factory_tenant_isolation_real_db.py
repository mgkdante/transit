"""Real-DB guard: a per-provider source-factory reset must not touch other providers.

Phase 1 (multi-provider). ``reset_source_factory_tables(connection, provider_id)``
DELETEs only that provider's rows, walking the reset list child-to-parent and
skipping shared seeds. This proves — against the REAL schema and its foreign
keys — that rebuilding provider A leaves provider B's rows intact, which the
offline fake-connection tests cannot verify (they can't see real FK ordering).

Seeds a shallow but FK-complete chain for two providers:
    core.providers -> core.feed_endpoints -> raw.ingestion_runs -> raw.ingestion_objects
``ingestion_objects`` (child) is deleted before ``ingestion_runs`` (parent) in the
reset order, so a passing run also confirms the child->parent walk is correct.

Runs ONLY with TRANSIT_TEST_DATABASE_URL pointing at a disposable Postgres at
head; CI/local-only, never production. Each test runs in one transaction and
rolls back.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
from sqlalchemy import Connection, create_engine, text

from transit_ops.source_factory.catalog import reset_source_factory_tables

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set — real-DB regression tests skipped",
)

PROVIDER_A = "mpp_iso_a"
PROVIDER_B = "mpp_iso_b"


def _seed_provider(connection: Connection, provider_id: str) -> None:
    connection.execute(
        text(
            "INSERT INTO core.providers "
            "(provider_id, provider_key, display_name, timezone) "
            "VALUES (:pid, :pid, :name, 'America/Toronto')"
        ),
        {"pid": provider_id, "name": f"Isolation {provider_id}"},
    )
    feed_endpoint_id = connection.execute(
        text(
            "INSERT INTO core.feed_endpoints "
            "(provider_id, endpoint_key, feed_kind, source_format) "
            "VALUES (:pid, 'static_schedule', 'static_schedule', 'gtfs_schedule_zip') "
            "RETURNING feed_endpoint_id"
        ),
        {"pid": provider_id},
    ).scalar_one()
    ingestion_run_id = connection.execute(
        text(
            "INSERT INTO raw.ingestion_runs "
            "(provider_id, feed_endpoint_id, run_kind, status) "
            "VALUES (:pid, :feid, 'static_schedule', 'succeeded') "
            "RETURNING ingestion_run_id"
        ),
        {"pid": provider_id, "feid": feed_endpoint_id},
    ).scalar_one()
    connection.execute(
        text(
            "INSERT INTO raw.ingestion_objects "
            "(ingestion_run_id, provider_id, object_kind, storage_backend, storage_path) "
            "VALUES (:rid, :pid, 'gtfs_schedule_zip', 'local', :path)"
        ),
        {"rid": ingestion_run_id, "pid": provider_id, "path": f"{provider_id}/static/x.zip"},
    )


def _count(connection: Connection, table: str, provider_id: str) -> int:
    return connection.execute(
        text(f"SELECT count(*) FROM {table} WHERE provider_id = :pid"),
        {"pid": provider_id},
    ).scalar_one()


@pytest.fixture()
def conn() -> Iterator[Connection]:
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        _seed_provider(connection, PROVIDER_A)
        _seed_provider(connection, PROVIDER_B)
        try:
            yield connection
        finally:
            transaction.rollback()
            engine.dispose()


def test_per_provider_reset_leaves_other_providers_untouched(conn: Connection) -> None:
    assert _count(conn, "raw.ingestion_runs", PROVIDER_A) == 1
    assert _count(conn, "raw.ingestion_objects", PROVIDER_A) == 1
    assert _count(conn, "raw.ingestion_runs", PROVIDER_B) == 1

    summary = reset_source_factory_tables(conn, PROVIDER_A)

    # provider A's rows are gone (child ingestion_objects before parent runs)...
    assert _count(conn, "raw.ingestion_runs", PROVIDER_A) == 0
    assert _count(conn, "raw.ingestion_objects", PROVIDER_A) == 0
    # ...provider B is fully intact...
    assert _count(conn, "raw.ingestion_runs", PROVIDER_B) == 1
    assert _count(conn, "raw.ingestion_objects", PROVIDER_B) == 1
    # ...shared core config (not in the reset set) survives for both providers...
    assert _count(conn, "core.providers", PROVIDER_A) == 1
    assert _count(conn, "core.feed_endpoints", PROVIDER_A) == 1
    assert _count(conn, "core.providers", PROVIDER_B) == 1
    # ...and the shared seed table with no provider_id column is skipped, not deleted.
    assert summary["mode"] == "per_provider"
    assert "gold.report_labels" in summary["skipped_tables"]


def test_all_providers_reset_truncates_every_provider(conn: Connection) -> None:
    summary = reset_source_factory_tables(conn, all_providers=True)

    assert summary["mode"] == "all_providers"
    assert _count(conn, "raw.ingestion_runs", PROVIDER_A) == 0
    assert _count(conn, "raw.ingestion_runs", PROVIDER_B) == 0
