
from __future__ import annotations

from pathlib import Path

import pytest
from realtime_replay_fixtures import (
    PROVIDER,
    PROVIDER_BOUNDS,
    REALTIME_SILVER_TABLES,
    SNAPSHOTS,
    WINDOW_END,
    WINDOW_START,
    _build_trip_update_bytes,
    _delay_facts,
    _seed_provider_and_static,
    _seed_raw_realtime_snapshots,
    _silver_counts,
    _storage_path,
    _StubRegistry,
)
from realtime_replay_fixtures import (
    bronze_root as bronze_root,
)
from realtime_replay_fixtures import (
    engine as engine,
)
from realtime_replay_fixtures import (
    settings as settings,
)
from sqlalchemy import event, text

from transit_ops.gold.marts import build_gold_marts
from transit_ops.ingestion.storage import get_bronze_storage
from transit_ops.silver.realtime_gtfs import (
    find_realtime_bronze_snapshots,
    load_realtime_snapshots_to_silver,
    replay_realtime_silver_window,
)


def test_replay_reconstructs_silver_and_gold_from_raw_after_prune(  # noqa: ANN001
    engine, settings, seed_provider
) -> None:
    with engine.begin() as connection:
        _seed_provider_and_static(connection, seed_provider)
        _seed_raw_realtime_snapshots(connection)

    bronze_storage = get_bronze_storage(settings, project_root=Path("/tmp"))
    with engine.connect() as connection:
        truth_snapshots = find_realtime_bronze_snapshots(
            connection,
            provider_id=PROVIDER,
            start_utc=WINDOW_START,
            end_utc=WINDOW_END,
            settings=settings,
            project_root=Path("/tmp"),
        )
    assert len(truth_snapshots) == len(SNAPSHOTS)
    with engine.begin() as connection:
        load_realtime_snapshots_to_silver(
            connection,
            provider_id=PROVIDER,
            snapshots=truth_snapshots,
            bronze_storage_resolver=lambda _backend: bronze_storage,
            skip_existing=False,
            provider_bounds=PROVIDER_BOUNDS,
        )
    build_gold_marts(PROVIDER, settings=settings, registry=_StubRegistry(), engine=engine)

    with engine.connect() as connection:
        truth_silver = _silver_counts(connection)
        truth_delays = _delay_facts(connection)

    assert truth_silver["silver.rt_feed_snapshots"] == len(SNAPSHOTS)
    assert truth_silver["silver.rt_trip_updates"] == len(SNAPSHOTS)
    assert truth_silver["silver.rt_trip_update_stop_times"] == len(SNAPSHOTS)
    assert len(truth_delays) == len(SNAPSHOTS)
    assert all(n > 0 for (n, _total) in truth_delays.values())

    with engine.begin() as connection:
        for table_name in REALTIME_SILVER_TABLES:
            connection.execute(
                text(f"DELETE FROM {table_name} WHERE provider_id = :p"),
                {"p": PROVIDER},
            )
    with engine.connect() as connection:
        pruned = _silver_counts(connection)
    assert pruned == dict.fromkeys(REALTIME_SILVER_TABLES, 0), (
        "thin-silver prune must remove every realtime Silver row"
    )

    replay_result = replay_realtime_silver_window(
        PROVIDER,
        start_utc=WINDOW_START,
        end_utc=WINDOW_END,
        settings=settings,
        registry=_StubRegistry(),
        engine=engine,
    )
    assert replay_result.provider_id == PROVIDER
    assert replay_result.loaded_count == len(SNAPSHOTS), (
        "replay must reconstruct every pruned snapshot from raw"
    )
    build_gold_marts(PROVIDER, settings=settings, registry=_StubRegistry(), engine=engine)

    with engine.connect() as connection:
        rebuilt_silver = _silver_counts(connection)
        rebuilt_delays = _delay_facts(connection)

    assert rebuilt_silver == truth_silver, (
        "replayed Silver row counts must match the pre-prune truth"
    )
    assert rebuilt_delays == truth_delays, (
        "Gold delay facts rebuilt from replayed Silver must match the pre-prune truth"
    )


def test_replay_empty_window_is_clean_noop(engine, settings, seed_provider) -> None:  # noqa: ANN001
    with engine.begin() as connection:
        _seed_provider_and_static(connection, seed_provider)

    result = replay_realtime_silver_window(
        PROVIDER,
        start_utc=WINDOW_START,
        end_utc=WINDOW_END,
        settings=settings,
        registry=_StubRegistry(),
        engine=engine,
    )

    assert result.provider_id == PROVIDER
    assert result.loaded_count == 0
    assert result.skipped_existing_snapshot_ids == []
    assert result.row_counts == {}
    assert result.results == []
    with engine.connect() as connection:
        assert _silver_counts(connection) == dict.fromkeys(REALTIME_SILVER_TABLES, 0)


def _partial_restored_window(engine, settings, seed_provider):
    with engine.begin() as connection:
        _seed_provider_and_static(connection, seed_provider)
        _seed_raw_realtime_snapshots(connection)
    replay_realtime_silver_window(
        PROVIDER,
        start_utc=WINDOW_START,
        end_utc=WINDOW_END,
        settings=settings,
        registry=_StubRegistry(),
        engine=engine,
    )
    with engine.begin() as connection:
        frames = dict(
            connection.execute(
                text("""
            SELECT source_realtime_snapshot_id,rt_feed_snapshot_id
            FROM silver.rt_feed_snapshots WHERE provider_id=:p
        """),
                {"p": PROVIDER},
            ).all()
        )
        connection.execute(
            text("""
            DELETE FROM silver.rt_trip_update_stop_times WHERE rt_feed_snapshot_id=:frame
        """),
            {"frame": frames[SNAPSHOTS[0][0]]},
        )
    return frames


def test_replay_restores_omitted_stop_times_and_preserves_complete_snapshots(
    engine, settings, seed_provider
):
    frames = _partial_restored_window(engine, settings, seed_provider)
    result = replay_realtime_silver_window(
        PROVIDER,
        start_utc=WINDOW_START,
        end_utc=WINDOW_END,
        settings=settings,
        registry=_StubRegistry(),
        engine=engine,
    )
    assert result.loaded_count == 1
    assert result.skipped_existing_snapshot_ids == [SNAPSHOTS[1][0]]
    assert result.verified_row_counts[SNAPSHOTS[0][0]]["rt_trip_update_stop_times"] == 1
    assert result.verified_row_counts[SNAPSHOTS[1][0]]["rt_trip_update_stop_times"] == 1
    with engine.connect() as connection:
        assert _silver_counts(connection)["silver.rt_trip_update_stop_times"] == 2
        assert (
            connection.execute(
                text("""
            SELECT rt_feed_snapshot_id FROM silver.rt_feed_snapshots
            WHERE source_realtime_snapshot_id=:snapshot
        """),
                {"snapshot": SNAPSHOTS[1][0]},
            ).scalar_one()
            == frames[SNAPSHOTS[1][0]]
        )


def test_failed_partial_replay_restores_previous_source_rows(engine, settings, seed_provider):
    frames = _partial_restored_window(engine, settings, seed_provider)
    with engine.connect() as connection:
        before = _silver_counts(connection)

    def fail_stop_insert(connection, cursor, statement, parameters, context, executemany):
        if "INSERT INTO silver.rt_trip_update_stop_times" in statement:
            raise RuntimeError("interrupted source reconstruction")

    event.listen(engine, "before_cursor_execute", fail_stop_insert)
    try:
        with pytest.raises(RuntimeError, match="interrupted source reconstruction"):
            replay_realtime_silver_window(
                PROVIDER,
                start_utc=WINDOW_START,
                end_utc=WINDOW_END,
                settings=settings,
                registry=_StubRegistry(),
                engine=engine,
            )
    finally:
        event.remove(engine, "before_cursor_execute", fail_stop_insert)
    with engine.connect() as connection:
        assert _silver_counts(connection) == before
        assert (
            dict(
                connection.execute(
                    text("""
            SELECT source_realtime_snapshot_id,rt_feed_snapshot_id
            FROM silver.rt_feed_snapshots WHERE provider_id=:p
        """),
                    {"p": PROVIDER},
                ).all()
            )
            == frames
        )


def test_unverified_archive_cannot_replace_a_partial_snapshot(
    engine, settings, seed_provider, bronze_root
):
    frames = _partial_restored_window(engine, settings, seed_provider)
    snapshot_id, _, _, captured_at, delay = SNAPSHOTS[0]
    path = bronze_root / _storage_path(snapshot_id)
    replacement = _build_trip_update_bytes(captured_at=captured_at, delay_seconds=delay + 1)
    assert len(replacement) == path.stat().st_size
    path.write_bytes(replacement)
    with engine.connect() as connection:
        before = _silver_counts(connection)
    with pytest.raises(ValueError, match="checksum mismatch"):
        replay_realtime_silver_window(
            PROVIDER,
            start_utc=WINDOW_START,
            end_utc=WINDOW_END,
            settings=settings,
            registry=_StubRegistry(),
            engine=engine,
        )
    with engine.connect() as connection:
        assert _silver_counts(connection) == before
        assert (
            dict(
                connection.execute(
                    text("""
            SELECT source_realtime_snapshot_id,rt_feed_snapshot_id
            FROM silver.rt_feed_snapshots WHERE provider_id=:p
        """),
                    {"p": PROVIDER},
                ).all()
            )
            == frames
        )
