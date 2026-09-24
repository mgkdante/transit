"""Capture-time retention, replay ordering, and bounded native Postgres deletion."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from transit_ops.maintenance.silver import prune_realtime_silver_history

PROVIDER = "stm_silverprune_test"
TU_ENDPOINT_ID = 994010
VP_ENDPOINT_ID = 994011
RUN_BASE = 994100

# Retention is anchored at NOW with retention_days; "old" rows sit well before the
# cutoff, "recent" rows sit inside the window.
NOW = datetime.now(UTC)
RETENTION_DAYS = 14
CUTOFF = NOW - timedelta(days=RETENTION_DAYS)


@pytest.fixture()
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        _seed_refs(connection, seed_provider)
        try:
            yield connection
        finally:
            transaction.rollback()


def _seed_refs(connection, seed_provider) -> None:
    seed_provider(connection, PROVIDER, display_name="STM silver prune regression")
    for endpoint_id, endpoint_key in (
        (TU_ENDPOINT_ID, "trip_updates"),
        (VP_ENDPOINT_ID, "vehicle_positions"),
    ):
        connection.execute(
            text(
                """
                INSERT INTO core.feed_endpoints
                    (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
                VALUES (:e, :p, :k, :k, :fmt)
                """
            ),
            {
                "e": endpoint_id,
                "p": PROVIDER,
                "k": endpoint_key,
                "fmt": f"gtfs_rt_{endpoint_key}",
            },
        )


def _insert_snapshot(connection, *, snapshot_id: int, endpoint_key: str, captured_at) -> None:
    """Create a feed snapshot (+ its ingestion_run) for one endpoint at a time."""
    endpoint_id = TU_ENDPOINT_ID if endpoint_key == "trip_updates" else VP_ENDPOINT_ID
    run_id = RUN_BASE + snapshot_id
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
            VALUES (CAST(:r AS bigint), :p, CAST(:e AS bigint), :k, 'succeeded')
            """
        ),
        {"r": run_id, "p": PROVIDER, "e": endpoint_id, "k": endpoint_key},
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_feed_snapshots
                (rt_feed_snapshot_id, provider_id, feed_endpoint_id, ingestion_run_id,
                 endpoint_key, captured_at_utc)
            VALUES (
                CAST(:sid AS bigint), :p, CAST(:e AS bigint), CAST(:r AS bigint),
                :k, CAST(:ts AS timestamptz)
            )
            """
        ),
        {
            "sid": snapshot_id,
            "p": PROVIDER,
            "e": endpoint_id,
            "r": run_id,
            "k": endpoint_key,
            "ts": captured_at,
        },
    )


def _insert_entity_chain(
    connection, *, snapshot_id: int, endpoint_key: str, captured_at, entity_index: int = 0
) -> None:
    """Insert rt_entities + the endpoint-specific child rows under a snapshot."""
    connection.execute(
        text(
            """
            INSERT INTO silver.rt_entities
                (rt_feed_snapshot_id, entity_index, provider_id, entity_kind)
            VALUES (CAST(:sid AS bigint), :ei, :p, :k)
            """
        ),
        {"sid": snapshot_id, "ei": entity_index, "p": PROVIDER, "k": endpoint_key},
    )
    if endpoint_key == "trip_updates":
        connection.execute(
            text(
                """
                INSERT INTO silver.rt_trip_updates
                    (rt_feed_snapshot_id, entity_index, provider_id, captured_at_utc)
                VALUES (CAST(:sid AS bigint), :ei, :p, CAST(:ts AS timestamptz))
                """
            ),
            {"sid": snapshot_id, "ei": entity_index, "p": PROVIDER, "ts": captured_at},
        )
        connection.execute(
            text(
                """
                INSERT INTO silver.rt_trip_update_stop_times
                    (rt_feed_snapshot_id, entity_index, stop_time_update_index, provider_id)
                VALUES (CAST(:sid AS bigint), :ei, 0, :p)
                """
            ),
            {"sid": snapshot_id, "ei": entity_index, "p": PROVIDER},
        )
    else:
        connection.execute(
            text(
                """
                INSERT INTO silver.rt_vehicle_positions
                    (rt_feed_snapshot_id, entity_index, provider_id, captured_at_utc)
                VALUES (CAST(:sid AS bigint), :ei, :p, CAST(:ts AS timestamptz))
                """
            ),
            {"sid": snapshot_id, "ei": entity_index, "p": PROVIDER, "ts": captured_at},
        )


def _seed_monotonic_history(connection) -> None:
    """Seed a monotonic id/captured_at history across both endpoints.

    trip_updates snapshots: ids 1..5 ; vehicle_positions: ids 6..10. Each endpoint
    has 3 OLD snapshots (before cutoff) and 2 RECENT (inside window). ids ascend
    with captured_at (the production invariant the id-range prune relies on).
    """
    # Interleave capture times so ids and captured_at both ascend monotonically.
    plan = [
        # (snapshot_id, endpoint_key, captured_at)
        (1, "trip_updates", CUTOFF - timedelta(days=5)),
        (2, "trip_updates", CUTOFF - timedelta(days=4)),
        (3, "trip_updates", CUTOFF - timedelta(days=3)),
        (4, "trip_updates", NOW - timedelta(days=2)),
        (5, "trip_updates", NOW - timedelta(days=1)),
        (6, "vehicle_positions", CUTOFF - timedelta(days=5)),
        (7, "vehicle_positions", CUTOFF - timedelta(days=4)),
        (8, "vehicle_positions", CUTOFF - timedelta(days=3)),
        (9, "vehicle_positions", NOW - timedelta(days=2)),
        (10, "vehicle_positions", NOW - timedelta(days=1)),
    ]
    for snapshot_id, endpoint_key, captured_at in plan:
        _insert_snapshot(
            connection, snapshot_id=snapshot_id, endpoint_key=endpoint_key, captured_at=captured_at
        )
        _insert_entity_chain(
            connection, snapshot_id=snapshot_id, endpoint_key=endpoint_key, captured_at=captured_at
        )


def _expected_old_predicate_counts(connection) -> dict[str, int]:
    """The OLD captured_at retention predicate's delete set, computed inline.

    For each child table: rows whose snapshot has captured_at < cutoff AND whose
    snapshot is NOT the latest snapshot for its endpoint_key. This is the EXACT
    semantics the prior ctid-JOIN-on-captured_at prune implemented; the id-range
    prune must produce identical counts.
    """

    def _count(table: str, child_endpoint: str | None) -> int:
        endpoint_filter = "AND rfs.endpoint_key = :endpoint" if child_endpoint else ""
        params: dict[str, object] = {"p": PROVIDER, "cutoff": CUTOFF}
        if child_endpoint:
            params["endpoint"] = child_endpoint
        sql = f"""
            SELECT COUNT(*)
            FROM {table} AS t
            JOIN silver.rt_feed_snapshots AS rfs
                ON t.rt_feed_snapshot_id = rfs.rt_feed_snapshot_id
            WHERE rfs.provider_id = :p
              {endpoint_filter}
              AND rfs.captured_at_utc < :cutoff
              AND rfs.rt_feed_snapshot_id <> COALESCE((
                    SELECT l.rt_feed_snapshot_id
                    FROM silver.rt_feed_snapshots AS l
                    WHERE l.provider_id = :p
                      AND l.endpoint_key = rfs.endpoint_key
                    ORDER BY l.captured_at_utc DESC, l.rt_feed_snapshot_id DESC LIMIT 1
                ), -1)
        """
        return int(connection.execute(text(sql), params).scalar_one())

    return {
        "silver.rt_trip_update_stop_times": _count(
            "silver.rt_trip_update_stop_times", "trip_updates"
        ),
        "silver.rt_trip_updates": _count("silver.rt_trip_updates", "trip_updates"),
        "silver.rt_vehicle_positions": _count("silver.rt_vehicle_positions", "vehicle_positions"),
        "silver.rt_entities": _count("silver.rt_entities", None),
        "silver.rt_feed_snapshots": _count_snapshots(connection),
    }


def _count_snapshots(connection) -> int:
    sql = """
        SELECT COUNT(*)
        FROM silver.rt_feed_snapshots AS rfs
        WHERE rfs.provider_id = :p
          AND rfs.captured_at_utc < :cutoff
          AND rfs.rt_feed_snapshot_id <> COALESCE((
                SELECT l.rt_feed_snapshot_id
                FROM silver.rt_feed_snapshots AS l
                WHERE l.provider_id = :p
                  AND l.endpoint_key = rfs.endpoint_key
                    ORDER BY l.captured_at_utc DESC, l.rt_feed_snapshot_id DESC LIMIT 1
            ), -1)
    """
    return int(connection.execute(text(sql), {"p": PROVIDER, "cutoff": CUTOFF}).scalar_one())


def _live_counts(connection) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in (
        "silver.rt_trip_update_stop_times",
        "silver.rt_trip_updates",
        "silver.rt_vehicle_positions",
        "silver.rt_entities",
        "silver.rt_feed_snapshots",
    ):
        counts[table] = int(
            connection.execute(
                text(f"SELECT COUNT(*) FROM {table} WHERE provider_id = :p"),
                {"p": PROVIDER},
            ).scalar_one()
        )
    return counts


def test_dry_run_count_matches_capture_time_retention(conn) -> None:
    """Dry runs count all expired children without a batch cap."""
    _seed_monotonic_history(conn)
    expected = _expected_old_predicate_counts(conn)

    _cutoff, counts = prune_realtime_silver_history(
        conn,
        provider_id=PROVIDER,
        retention_days=RETENTION_DAYS,
        batch_size=10000,
        dry_run=True,
        now_utc=NOW,
    )

    assert counts == expected
    # Sanity: 3 old snapshots/endpoint, latest-of-old kept? No — the 2 RECENT are
    # latest; all 3 OLD are eligible. 3 trip_updates + 3 vehicle_positions deleted.
    assert expected["silver.rt_trip_update_stop_times"] == 3
    assert expected["silver.rt_vehicle_positions"] == 3
    assert expected["silver.rt_entities"] == 6
    assert expected["silver.rt_feed_snapshots"] == 6


def test_delete_drains_exactly_the_expired_capture_set(conn) -> None:
    """Running the prune to completion deletes exactly the old-predicate rows."""
    _seed_monotonic_history(conn)
    expected = _expected_old_predicate_counts(conn)
    before = _live_counts(conn)

    total_deleted = {table: 0 for table in expected}
    for _ in range(20):  # generous pass budget for the batched deletes
        _cutoff, counts = prune_realtime_silver_history(
            conn,
            provider_id=PROVIDER,
            retention_days=RETENTION_DAYS,
            batch_size=10000,
            now_utc=NOW,
        )
        for table, deleted in counts.items():
            total_deleted[table] += deleted
        if all(v == 0 for v in counts.values()):
            break

    assert total_deleted == expected
    after = _live_counts(conn)
    for table in expected:
        assert after[table] == before[table] - expected[table]
    # The 2 RECENT snapshots per endpoint (the latest two) always survive.
    assert after["silver.rt_feed_snapshots"] == 4


def test_dead_feed_keeps_single_latest_snapshot(conn) -> None:
    # All trip_updates snapshots are OLD (feed dead longer than retention).
    for snapshot_id, captured_at in (
        (1, CUTOFF - timedelta(days=5)),
        (2, CUTOFF - timedelta(days=4)),
        (3, CUTOFF - timedelta(days=3)),
    ):
        _insert_snapshot(
            conn, snapshot_id=snapshot_id, endpoint_key="trip_updates", captured_at=captured_at
        )
        _insert_entity_chain(
            conn, snapshot_id=snapshot_id, endpoint_key="trip_updates", captured_at=captured_at
        )

    expected = _expected_old_predicate_counts(conn)

    total_deleted = {table: 0 for table in expected}
    for _ in range(20):
        _cutoff, counts = prune_realtime_silver_history(
            conn,
            provider_id=PROVIDER,
            retention_days=RETENTION_DAYS,
            batch_size=10000,
            now_utc=NOW,
        )
        for table, deleted in counts.items():
            total_deleted[table] += deleted
        if all(v == 0 for v in counts.values()):
            break

    # Old predicate keeps the single latest (id=3); deletes the other two.
    assert expected["silver.rt_feed_snapshots"] == 2
    assert total_deleted == expected
    after = _live_counts(conn)
    assert after["silver.rt_feed_snapshots"] == 1  # the latest, id=3, survives
    surviving_id = int(
        conn.execute(
            text("SELECT rt_feed_snapshot_id FROM silver.rt_feed_snapshots WHERE provider_id = :p"),
            {"p": PROVIDER},
        ).scalar_one()
    )
    assert surviving_id == 3


@pytest.mark.parametrize("endpoint_key", ["trip_updates", "vehicle_positions"])
@pytest.mark.parametrize("latest_age_days", [1, 20])
def test_replayed_old_capture_is_pruned_without_deleting_newest_capture(
    conn, endpoint_key, latest_age_days
) -> None:
    latest = NOW - timedelta(days=latest_age_days)
    for snapshot_id, captured_at in ((1, latest), (2, CUTOFF - timedelta(days=10))):
        _insert_snapshot(
            conn, snapshot_id=snapshot_id, endpoint_key=endpoint_key, captured_at=captured_at
        )
        _insert_entity_chain(
            conn, snapshot_id=snapshot_id, endpoint_key=endpoint_key, captured_at=captured_at
        )

    _, preview = prune_realtime_silver_history(
        conn,
        provider_id=PROVIDER,
        retention_days=RETENTION_DAYS,
        now_utc=NOW,
        dry_run=True,
    )
    assert preview["silver.rt_feed_snapshots"] == 1
    _, deleted = prune_realtime_silver_history(
        conn,
        provider_id=PROVIDER,
        retention_days=RETENTION_DAYS,
        now_utc=NOW,
    )
    assert deleted == preview
    survivors = (
        conn.execute(
            text("SELECT rt_feed_snapshot_id FROM silver.rt_feed_snapshots WHERE provider_id = :p"),
            {"p": PROVIDER},
        )
        .scalars()
        .all()
    )
    assert survivors == [1]
