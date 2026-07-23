"""Real-database regression tests for static dataset-version pruning (slice-9.1.1j).

These tests exercise the actual Postgres FK constraints
(fk_gold_dim_*_dataset_version_id) that fake-connection tests structurally
cannot see — the prod wedge they lock in is a per-cycle ForeignKeyViolation when
prune_static_silver_datasets tried to DELETE a core.dataset_versions row that
gold dims still referenced. The fix DEFERS such versions instead of deleting
them; once gold dims re-point to the current version, the next cycle prunes the
old version cleanly.

They run ONLY when TRANSIT_TEST_DATABASE_URL points at a disposable Postgres
with the transit schema applied. IMPORTANT: the schema dump MUST include the
gold schema (gold dims hold the FK at issue):

    /usr/lib/postgresql/16/bin/initdb -D /tmp/dvprune ...
    pg_dump --schema-only -n core -n raw -n silver -n gold ... > schema.sql
    # apply schema.sql, then alembic upgrade head

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://repro@:55432/transit_repro?host=/tmp/dvprune" \
        uv run pytest tests/test_maintenance_real_db_regression.py -v

Each test runs inside one transaction and rolls back — nothing persists, reruns
are idempotent. CI has no Postgres; this file is local-only. Never point this at
production.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from transit_ops.maintenance import prune_static_silver_datasets

PROVIDER = "stm_dvprune_test"
ENDPOINT_ID = 991014
RUN_ID = 991101
# v1 is the old (superseded) version still referenced by gold dims; v2 is current.
V1 = 991001
V2 = 991002
T1 = datetime(2026, 6, 10, 3, 0, tzinfo=UTC)
T2 = datetime(2026, 6, 10, 3, 5, tzinfo=UTC)

EXPECTED_GOLD_DATASET_VERSION_FKS = (
    "fk_gold_dim_route_dataset_version_id",
    "fk_gold_dim_stop_dataset_version_id",
    "fk_gold_dim_date_dataset_version_id",
    "fk_gold_dim_route_pattern_dataset_version_id",
)


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
    seed_provider(
        connection,
        PROVIDER,
        display_name="STM dataset-version prune regression",
    )
    connection.execute(
        text(
            """
            INSERT INTO core.feed_endpoints
                (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
            VALUES (:e, :p, 'static_schedule', 'static_schedule', 'gtfs_schedule_zip')
            """
        ),
        {"e": ENDPOINT_ID, "p": PROVIDER},
    )
    # core.dataset_versions.source_ingestion_run_id is NOT NULL with an FK to
    # raw.ingestion_runs — the seed MUST include an ingestion_runs row.
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
            VALUES (:r, :p, :e, 'static_schedule', 'succeeded')
            """
        ),
        {"r": RUN_ID, "p": PROVIDER, "e": ENDPOINT_ID},
    )
    for version_id, loaded_at, is_current, content_hash in (
        (V1, T1, False, f"{PROVIDER}-hash-v1"),
        (V2, T2, True, f"{PROVIDER}-hash-v2"),
    ):
        connection.execute(
            text(
                """
                INSERT INTO core.dataset_versions
                    (dataset_version_id, provider_id, feed_endpoint_id,
                     source_ingestion_run_id, dataset_kind, content_hash,
                     loaded_at_utc, is_current)
                VALUES (:v, :p, :e, :r, 'static_schedule', :h, :loaded, :cur)
                """
            ),
            {
                "v": version_id,
                "p": PROVIDER,
                "e": ENDPOINT_ID,
                "r": RUN_ID,
                "h": content_hash,
                "loaded": loaded_at,
                "cur": is_current,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO silver.routes
                    (dataset_version_id, provider_id, route_id, route_type)
                VALUES (:v, :p, 'R1', 3)
                """
            ),
            {"v": version_id, "p": PROVIDER},
        )
    # gold.dim_route references the OLD version v1 — the wedge precondition.
    connection.execute(
        text(
            """
            INSERT INTO gold.dim_route
                (provider_id, dataset_version_id, route_id, route_type)
            VALUES (:p, :v, 'R1', 3)
            """
        ),
        {"p": PROVIDER, "v": V1},
    )


def _dataset_version_ids(connection) -> set[int]:
    return {
        int(row[0])
        for row in connection.execute(
            text(
                """
                SELECT dataset_version_id FROM core.dataset_versions
                WHERE provider_id = :p
                """
            ),
            {"p": PROVIDER},
        )
    }


def _silver_route_version_ids(connection) -> set[int]:
    return {
        int(row[0])
        for row in connection.execute(
            text(
                """
                SELECT DISTINCT dataset_version_id FROM silver.routes
                WHERE provider_id = :p
                """
            ),
            {"p": PROVIDER},
        )
    }


def test_prune_defers_gold_referenced_version_instead_of_fk_violation(conn) -> None:
    # v1 is the superseded version but gold.dim_route still references it.
    # Under live FK constraints, an unguarded DELETE of v1 would FK-violate;
    # the fixed prune must DEFER v1 (raise nothing) and prune nothing.
    retained, pruned, deferred, _counts = prune_static_silver_datasets(
        conn,
        provider_id=PROVIDER,
        retention_count=1,
    )

    assert retained == [V2]
    assert deferred == [V1]
    assert pruned == []
    # v1 keeps both its core.dataset_versions row and its silver rows.
    assert V1 in _dataset_version_ids(conn)
    assert V1 in _silver_route_version_ids(conn)


def test_prune_deletes_version_once_gold_dims_repointed(conn) -> None:
    # After gold dims re-point to the current version v2, the old version v1 has
    # no remaining gold references and is pruned cleanly (silver + version row).
    conn.execute(
        text(
            """
            UPDATE gold.dim_route SET dataset_version_id = :v2
            WHERE provider_id = :p
            """
        ),
        {"v2": V2, "p": PROVIDER},
    )

    retained, pruned, deferred, _counts = prune_static_silver_datasets(
        conn,
        provider_id=PROVIDER,
        retention_count=1,
    )

    assert retained == [V2]
    assert deferred == []
    assert pruned == [V1]
    assert V1 not in _dataset_version_ids(conn)
    assert V1 not in _silver_route_version_ids(conn)
    assert V2 in _dataset_version_ids(conn)
    assert V2 in _silver_route_version_ids(conn)


def test_gold_dim_dataset_version_fks_still_exist(conn) -> None:
    # Lock-in: a future "fix by dropping the FK" would regress loudly here. All
    # four gold dim → core.dataset_versions FK constraints must exist.
    existing = {
        row[0]
        for row in conn.execute(
            text(
                """
                SELECT conname FROM pg_constraint
                WHERE contype = 'f'
                  AND conname = ANY(:names)
                """
            ),
            {"names": list(EXPECTED_GOLD_DATASET_VERSION_FKS)},
        )
    }
    assert existing == set(EXPECTED_GOLD_DATASET_VERSION_FKS)
