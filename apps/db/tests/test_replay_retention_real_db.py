from datetime import timedelta

import pytest
from realtime_replay_fixtures import (
    PROVIDER,
    SNAPSHOTS,
    WINDOW_END,
    WINDOW_START,
    _seed_provider_and_static,
    _seed_raw_realtime_snapshots,
    _silver_counts,
)
from realtime_replay_fixtures import bronze_root as bronze_root
from realtime_replay_fixtures import engine as engine
from realtime_replay_fixtures import settings as settings
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from transit_ops.ingestion.storage import get_bronze_storage
from transit_ops.maintenance.silver import prune_realtime_silver_history
from transit_ops.silver.realtime_gtfs import (
    find_realtime_bronze_snapshots,
    load_realtime_snapshots_to_silver,
)


@pytest.fixture()
def replay(engine, settings, bronze_root, seed_provider):
    with engine.begin() as connection:
        _seed_provider_and_static(connection, seed_provider)
        _seed_raw_realtime_snapshots(connection)
        snapshots = find_realtime_bronze_snapshots(
            connection,
            provider_id=PROVIDER,
            start_utc=WINDOW_START,
            end_utc=WINDOW_END,
            settings=settings,
            project_root=bronze_root,
        )
    storage = get_bronze_storage(settings, project_root=bronze_root)

    def load(connection, selected=snapshots):
        return load_realtime_snapshots_to_silver(
            connection,
            provider_id=PROVIDER,
            snapshots=selected,
            bronze_storage_resolver=lambda _: storage,
            skip_existing=True,
            repair_incomplete=True,
        )

    with engine.begin() as connection:
        load(connection)
    return load


def prune(connection, *, batch_size=50000, dry_run=False):
    return prune_realtime_silver_history(
        connection,
        provider_id=PROVIDER,
        retention_days=1,
        now_utc=WINDOW_END + timedelta(days=2),
        batch_size=batch_size,
        dry_run=dry_run,
    )[1]


def test_retention_skips_raw_capture_locked_by_replay_then_prunes_on_retry(engine, replay):
    with engine.connect() as loader, engine.connect() as pruner:
        owner = loader.begin()
        try:
            replay(loader)
            with pruner.begin():
                assert not any(prune(pruner).values())
        finally:
            owner.rollback()
        with pruner.begin():
            assert prune(pruner)["silver.rt_feed_snapshots"] == 1


def test_replay_waits_for_pruner_and_retry_preserves_rolled_back_population(engine, replay):
    with engine.connect() as pruner, engine.connect() as loader:
        owner = pruner.begin()
        try:
            assert prune(pruner)["silver.rt_feed_snapshots"] == 1
            with pytest.raises(OperationalError) as blocked:
                with loader.begin():
                    loader.execute(text("SET LOCAL lock_timeout='100ms'"))
                    replay(loader)
            assert blocked.value.orig.sqlstate == "55P03"
        finally:
            owner.rollback()
        with loader.begin():
            assert replay(loader).loaded_count == 0
            assert _silver_counts(loader)["silver.rt_feed_snapshots"] == 2


def test_equal_capture_times_keep_raw_identity_not_replay_insertion_order(
    engine, replay, settings, bronze_root
):
    with engine.begin() as connection:
        for table in (
            "silver.rt_trip_update_stop_times",
            "silver.rt_trip_updates",
            "silver.rt_entities",
            "silver.rt_feed_snapshots",
        ):
            connection.execute(
                text(f"DELETE FROM {table} WHERE provider_id=:provider"),
                {"provider": PROVIDER},
            )
        connection.execute(
            text("""
            UPDATE raw.realtime_snapshot_index SET captured_at_utc=:captured
            WHERE provider_id=:provider
        """),
            {"captured": WINDOW_START, "provider": PROVIDER},
        )
        snapshots = find_realtime_bronze_snapshots(
            connection,
            provider_id=PROVIDER,
            start_utc=WINDOW_START,
            end_utc=WINDOW_END,
            settings=settings,
            project_root=bronze_root,
        )
        for snapshot in reversed(snapshots):
            assert replay(connection, [snapshot]).loaded_count == 1
        sources = (
            connection.execute(
                text("""
            SELECT source_realtime_snapshot_id FROM silver.rt_feed_snapshots
            WHERE provider_id=:provider ORDER BY rt_feed_snapshot_id
        """),
                {"provider": PROVIDER},
            )
            .scalars()
            .all()
        )
        assert sources == [SNAPSHOTS[1][0], SNAPSHOTS[0][0]]
        assert prune(connection)["silver.rt_feed_snapshots"] == 1
        assert (
            connection.execute(
                text("""
            SELECT source_realtime_snapshot_id FROM silver.rt_feed_snapshots
            WHERE provider_id=:provider
        """),
                {"provider": PROVIDER},
            ).scalar_one()
            == SNAPSHOTS[1][0]
        )


def test_partial_child_batches_keep_parent_until_all_children_are_deleted(engine, replay):
    with engine.begin() as connection:
        frame = connection.execute(
            text("""
            SELECT rt_feed_snapshot_id FROM silver.rt_feed_snapshots
            WHERE source_realtime_snapshot_id=:source
        """),
            {"source": SNAPSHOTS[0][0]},
        ).scalar_one()
        connection.execute(
            text("""
            INSERT INTO silver.rt_trip_update_stop_times
                (rt_feed_snapshot_id, entity_index, stop_time_update_index, provider_id)
            SELECT :frame, 0, i, :provider FROM generate_series(1, 4) i
        """),
            {"frame": frame, "provider": PROVIDER},
        )
        assert prune(connection, dry_run=True)["silver.rt_trip_update_stop_times"] == 5
        for remaining in range(4, -1, -1):
            counts = prune(connection, batch_size=1)
            assert all(count <= 1 for count in counts.values())
            assert counts["silver.rt_trip_update_stop_times"] == 1
            assert counts["silver.rt_feed_snapshots"] == (1 if remaining == 0 else 0)
        assert not any(prune(connection).values())
        assert _silver_counts(connection)["silver.rt_feed_snapshots"] == 1


@pytest.mark.parametrize("isolation", ["AUTOCOMMIT", "REPEATABLE READ", "SERIALIZABLE"])
def test_retention_refuses_connection_modes_that_cannot_recheck_locked_rows(
    engine, replay, isolation
):
    with engine.connect().execution_options(isolation_level=isolation) as connection:
        with connection.begin(), pytest.raises(ValueError, match="READ COMMITTED"):
            prune(connection)
    with engine.connect() as connection:
        assert _silver_counts(connection)["silver.rt_feed_snapshots"] == 2


def test_retention_requires_a_caller_transaction_before_locking(engine, replay):
    with engine.connect() as connection:
        with pytest.raises(ValueError, match="READ COMMITTED"):
            prune(connection)
        assert _silver_counts(connection)["silver.rt_feed_snapshots"] == 2
