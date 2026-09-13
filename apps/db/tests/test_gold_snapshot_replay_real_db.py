"""Scoped Gold replay preserves retained history and the current serving lanes."""

from __future__ import annotations

import hashlib
from datetime import datetime
from pathlib import Path

import pytest
from google.transit import gtfs_realtime_pb2
from realtime_replay_fixtures import (
    DATASET_VERSION_ID,
    PROVIDER,
    PROVIDER_BOUNDS,
    REALTIME_SILVER_TABLES,
    SNAPSHOTS,
    WINDOW_END,
    WINDOW_START,
    _bootstrap_serving,
    _build_trip_update_bytes,
    _delay_facts,
    _seed_provider_and_static,
    _seed_raw_realtime_snapshots,
    _storage_path,
    _StubRegistry,
)
from realtime_replay_fixtures import bronze_root as bronze_root
from realtime_replay_fixtures import engine as engine
from realtime_replay_fixtures import settings as settings
from sqlalchemy import event, text

from transit_ops.gold.marts import build_gold_marts
from transit_ops.gold.realtime import refresh_gold_snapshots
from transit_ops.ingestion.storage import get_bronze_storage
from transit_ops.silver.realtime_gtfs import (
    find_realtime_bronze_snapshots,
    load_realtime_snapshots_to_silver,
)

OLDER, NEWER = (snapshot[0] for snapshot in SNAPSHOTS)
GOLD_TABLES = (
    "fact_trip_delay_snapshot",
    "fact_vehicle_snapshot",
    "latest_trip_delay_snapshot",
    "latest_vehicle_snapshot",
    "warm_rollup_periods",
)


@pytest.fixture
def captured(engine, seed_provider):
    with engine.begin() as connection:
        _seed_provider_and_static(connection, seed_provider)
        _seed_raw_realtime_snapshots(connection)


def _load(engine, settings, snapshot_ids=(OLDER, NEWER)):
    storage = get_bronze_storage(settings, project_root=Path("/tmp"))
    with engine.begin() as connection:
        snapshots = find_realtime_bronze_snapshots(
            connection,
            provider_id=PROVIDER,
            start_utc=WINDOW_START,
            end_utc=WINDOW_END,
            settings=settings,
            project_root=Path("/tmp"),
        )
        return load_realtime_snapshots_to_silver(
            connection,
            provider_id=PROVIDER,
            snapshots=[s for s in snapshots if s.realtime_snapshot_id in snapshot_ids],
            bronze_storage_resolver=lambda _backend: storage,
            skip_existing=True,
            repair_incomplete=True,
            provider_bounds=PROVIDER_BOUNDS,
        )


@pytest.fixture
def projected(captured, engine, settings):
    result = _load(engine, settings)
    build_gold_marts(PROVIDER, settings=settings, registry=_StubRegistry(), engine=engine)
    _bootstrap_serving(engine, settings, {"trip_updates": NEWER})
    with engine.connect() as connection:
        assert _delay_facts(connection) == {OLDER: (1, 60), NEWER: (1, 180)}
    return result.verified_row_counts


def _refresh(engine, settings, expected):
    return refresh_gold_snapshots(
        PROVIDER,
        expected_rows=expected,
        settings=settings,
        registry=_StubRegistry(),
        engine=engine,
    )


def _rows(engine, table):
    with engine.connect() as connection:
        return (
            connection.execute(
                text(
                    f"SELECT to_jsonb(t) FROM gold.{table} AS t WHERE provider_id = :p "
                    "ORDER BY to_jsonb(t)::text"
                ),
                {"p": PROVIDER},
            )
            .scalars()
            .all()
        )


def _gold_state(engine):
    return {table: _rows(engine, table) for table in GOLD_TABLES}


def _prune_silver(connection, snapshot_id):
    for table in REALTIME_SILVER_TABLES:
        connection.execute(
            text(
                f"DELETE FROM {table} WHERE rt_feed_snapshot_id IN ("
                "SELECT rt_feed_snapshot_id FROM silver.rt_feed_snapshots "
                "WHERE provider_id = :p AND source_realtime_snapshot_id = :snapshot)"
            ),
            {"p": PROVIDER, "snapshot": snapshot_id},
        )


def _stale_fact(connection, snapshot_id, table="fact_trip_delay_snapshot"):
    # A stale extra entity proves replacement removes rows absent from Silver.
    connection.execute(
        text(
            f"INSERT INTO gold.{table} SELECT (jsonb_populate_record("
            f"NULL::gold.{table}, to_jsonb(f) || '{{\"entity_index\": 99}}'::jsonb)).* "
            f"FROM gold.{table} AS f WHERE provider_id = :p "
            "AND realtime_snapshot_id = :snapshot AND entity_index = 0"
        ),
        {"p": PROVIDER, "snapshot": snapshot_id},
    )


def _completed_periods(connection):
    connection.execute(
        text(
            "INSERT INTO gold.warm_rollup_periods "
            "(provider_id, rollup_kind, period_start_utc, built_at_utc) "
            "SELECT provider_id, 'trip_delay_summary_5m', captured_at_utc, "
            "captured_at_utc + interval '5 minutes' FROM raw.realtime_snapshot_index "
            "WHERE provider_id = :p "
            "ON CONFLICT (provider_id, rollup_kind, period_start_utc) "
            "DO UPDATE SET built_at_utc=EXCLUDED.built_at_utc, invalidated_at_utc=NULL"
        ),
        {"p": PROVIDER},
    )


def _change_archive(engine, bronze_root, snapshot, payload):
    snapshot_id, _, object_id, _, _ = snapshot
    message = gtfs_realtime_pb2.FeedMessage.FromString(payload)
    (bronze_root / _storage_path(snapshot_id)).write_bytes(payload)
    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE raw.ingestion_objects SET checksum_sha256 = :checksum, "
                "byte_size = :size WHERE ingestion_object_id = :object"
            ),
            {
                "checksum": hashlib.sha256(payload).hexdigest(),
                "size": len(payload),
                "object": object_id,
            },
        )
        connection.execute(
            text(
                "UPDATE raw.realtime_snapshot_index SET entity_count = :count "
                "WHERE realtime_snapshot_id = :snapshot"
            ),
            {"count": len(message.entity), "snapshot": snapshot_id},
        )


def test_selected_replacement_preserves_gold_beyond_silver_retention(projected, engine, settings):
    before = _rows(engine, "fact_trip_delay_snapshot")
    retained_old = [row for row in before if row["realtime_snapshot_id"] == OLDER]
    with engine.begin() as connection:
        _completed_periods(connection)
        _prune_silver(connection, OLDER)
        _stale_fact(connection, NEWER)
        connection.execute(
            text(
                "UPDATE gold.fact_trip_delay_snapshot SET delay_seconds = 999 "
                "WHERE provider_id = :p AND realtime_snapshot_id = :snapshot"
            ),
            {"p": PROVIDER, "snapshot": NEWER},
        )

    result = _refresh(engine, settings, {NEWER: projected[NEWER]})

    assert _rows(engine, "fact_trip_delay_snapshot") == before
    assert retained_old
    assert result.snapshot_ids == (NEWER,)
    assert result.row_counts["fact_trip_delay_snapshot"] == 1
    assert result.row_counts["fact_vehicle_snapshot"] == 0
    periods = [
        row
        for row in _rows(engine, "warm_rollup_periods")
        if row["rollup_kind"] == "trip_delay_summary_5m"
    ]
    assert len(periods) == 2
    by_period = {datetime.fromisoformat(row["period_start_utc"]): row for row in periods}
    assert by_period[SNAPSHOTS[0][3]]["invalidated_at_utc"] is None
    assert by_period[SNAPSHOTS[1][3]]["invalidated_at_utc"] is not None


def test_historical_selection_does_not_rewind_latest(projected, engine, settings):
    before = _rows(engine, "latest_trip_delay_snapshot")
    assert [row["realtime_snapshot_id"] for row in before] == [NEWER]
    _refresh(engine, settings, {OLDER: projected[OLDER]})
    assert _rows(engine, "latest_trip_delay_snapshot") == before


@pytest.mark.parametrize("selected", [OLDER, NEWER])
def test_newer_unprojected_silver_does_not_change_the_served_snapshot(
    engine, settings, bronze_root, seed_provider, selected
):
    with engine.begin() as connection:
        _seed_provider_and_static(connection, seed_provider)
        _seed_raw_realtime_snapshots(connection, (SNAPSHOTS[0],))
    _load(engine, settings, (OLDER,))
    build_gold_marts(PROVIDER, settings=settings, registry=_StubRegistry(), engine=engine)
    _bootstrap_serving(engine, settings, {"trip_updates": OLDER})
    with engine.begin() as connection:
        _seed_raw_realtime_snapshots(connection, (SNAPSHOTS[1],))
    before = _rows(engine, "latest_trip_delay_snapshot")
    assert [row["realtime_snapshot_id"] for row in before] == [OLDER]
    _change_archive(
        engine,
        bronze_root,
        SNAPSHOTS[0],
        _build_trip_update_bytes(captured_at=SNAPSHOTS[0][3], delay_seconds=240),
    )
    with engine.begin() as connection:
        _prune_silver(connection, OLDER)
    receipts = _load(engine, settings).verified_row_counts

    _refresh(engine, settings, {selected: receipts[selected]})

    latest = _rows(engine, "latest_trip_delay_snapshot")
    assert [row["realtime_snapshot_id"] for row in latest] == [OLDER]
    assert latest[0]["delay_seconds"] == (240 if selected == OLDER else 60)
    if selected == NEWER:
        assert latest == before
        assert any(
            row["realtime_snapshot_id"] == NEWER
            for row in _rows(engine, "fact_trip_delay_snapshot")
        )


def test_replay_does_not_fill_an_initially_empty_serving_lane(captured, engine, settings):
    receipts = _load(engine, settings).verified_row_counts
    assert not _rows(engine, "latest_trip_delay_snapshot")
    result = _refresh(engine, settings, receipts)
    with engine.connect() as connection:
        assert _delay_facts(connection) == {OLDER: (1, 60), NEWER: (1, 180)}
    assert not _rows(engine, "latest_trip_delay_snapshot")
    assert not _rows(engine, "latest_vehicle_snapshot")
    assert result.row_counts["latest_trip_delay_snapshot"] == 0


@pytest.mark.parametrize("selected", [OLDER, NEWER])
def test_empty_selected_cohort_removes_stale_facts_without_serving_an_older_snapshot(
    projected, engine, settings, bronze_root, selected
):
    before_latest = _rows(engine, "latest_trip_delay_snapshot")
    snapshot = next(s for s in SNAPSHOTS if s[0] == selected)
    message = gtfs_realtime_pb2.FeedMessage.FromString(
        _build_trip_update_bytes(captured_at=snapshot[3], delay_seconds=0)
    )
    message.ClearField("entity")
    _change_archive(engine, bronze_root, snapshot, message.SerializeToString())
    receipt = _load(engine, settings, (selected,)).verified_row_counts[selected]
    assert receipt == {
        "rt_feed_snapshots": 1,
        "rt_entities": 0,
        "rt_trip_updates": 0,
        "rt_trip_update_stop_times": 0,
    }

    result = _refresh(engine, settings, {selected: receipt})

    assert all(
        row["realtime_snapshot_id"] != selected for row in _rows(engine, "fact_trip_delay_snapshot")
    )
    assert result.row_counts["fact_trip_delay_snapshot"] == 0
    assert _rows(engine, "latest_trip_delay_snapshot") == (
        [] if selected == NEWER else before_latest
    )


@pytest.mark.parametrize(
    "corruption, error",
    [
        ("metadata", "Missing or inconsistent Silver source"),
        ("stop_times", "count mismatch"),
        ("entity_keys", "entity key mismatch"),
        ("missing_receipt_table", "requires expected counts"),
    ],
)
def test_every_selected_snapshot_is_validated_before_any_gold_write(
    projected, engine, settings, corruption, error
):
    with engine.begin() as connection:
        _stale_fact(connection, OLDER)
        silver_id = connection.execute(
            text(
                "SELECT rt_feed_snapshot_id FROM silver.rt_feed_snapshots "
                "WHERE provider_id = :p AND source_realtime_snapshot_id = :snapshot"
            ),
            {"p": PROVIDER, "snapshot": NEWER},
        ).scalar_one()
        if corruption == "metadata":
            connection.execute(
                text(
                    "UPDATE silver.rt_feed_snapshots SET manifest_json = '{}'::jsonb "
                    "WHERE rt_feed_snapshot_id = :id"
                ),
                {"id": silver_id},
            )
        elif corruption == "stop_times":
            connection.execute(
                text(
                    "DELETE FROM silver.rt_trip_update_stop_times WHERE rt_feed_snapshot_id = :id"
                ),
                {"id": silver_id},
            )
        elif corruption == "entity_keys":
            connection.execute(
                text(
                    "UPDATE silver.rt_entities SET entity_kind = 'vehicle_position' "
                    "WHERE rt_feed_snapshot_id = :id"
                ),
                {"id": silver_id},
            )
        else:
            projected[NEWER].pop("rt_trip_update_stop_times")
    before = _gold_state(engine)
    writes = []

    def record_gold_write(connection, cursor, statement, parameters, context, executemany):
        if "INSERT INTO gold." in statement or "DELETE FROM gold." in statement:
            writes.append(statement)

    event.listen(engine, "before_cursor_execute", record_gold_write)
    try:
        with pytest.raises(ValueError, match=error):
            _refresh(engine, settings, projected)
    finally:
        event.remove(engine, "before_cursor_execute", record_gold_write)
    assert writes == []
    assert _gold_state(engine) == before


def test_failed_second_projection_rolls_back_facts_serving_and_invalidation_then_retries(
    projected, engine, settings
):
    with engine.begin() as connection:
        _completed_periods(connection)
        for snapshot_id in (OLDER, NEWER):
            _stale_fact(connection, snapshot_id)
        connection.execute(
            text(
                "UPDATE gold.fact_trip_delay_snapshot SET delay_seconds = 999 "
                "WHERE provider_id = :p"
            ),
            {"p": PROVIDER},
        )
    before = _gold_state(engine)
    projections = 0

    def fail_second_projection(connection, cursor, statement, parameters, context, executemany):
        nonlocal projections
        if "INSERT INTO gold.fact_trip_delay_snapshot" in statement:
            projections += 1
            if projections == 2:
                raise RuntimeError("second snapshot projection interrupted")

    event.listen(engine, "before_cursor_execute", fail_second_projection)
    try:
        with pytest.raises(RuntimeError, match="second snapshot projection interrupted"):
            _refresh(engine, settings, projected)
    finally:
        event.remove(engine, "before_cursor_execute", fail_second_projection)
    assert projections == 2
    assert _gold_state(engine) == before

    result = _refresh(engine, settings, projected)
    with engine.connect() as connection:
        assert _delay_facts(connection) == {OLDER: (1, 60), NEWER: (1, 180)}
    assert result.row_counts["fact_trip_delay_snapshot"] == 2
    assert [row["delay_seconds"] for row in _rows(engine, "latest_trip_delay_snapshot")] == [180]
    periods = [
        row
        for row in _rows(engine, "warm_rollup_periods")
        if row["rollup_kind"] == "trip_delay_summary_5m"
    ]
    assert len(periods) == 2
    assert all(row["invalidated_at_utc"] is not None for row in periods)
    repaired = _rows(engine, "fact_trip_delay_snapshot")
    _refresh(engine, settings, projected)
    assert _rows(engine, "fact_trip_delay_snapshot") == repaired


def test_replay_uses_current_static_schedule_and_reports_that_policy(projected, engine, settings):
    current_version = DATASET_VERSION_ID + 1
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE core.dataset_versions SET is_current = false WHERE provider_id = :p"),
            {"p": PROVIDER},
        )
        connection.execute(
            text(
                "INSERT INTO core.dataset_versions "
                "(dataset_version_id, provider_id, feed_endpoint_id, source_ingestion_run_id, "
                "source_ingestion_object_id, dataset_kind, content_hash, is_current) "
                "SELECT :new, provider_id, feed_endpoint_id, source_ingestion_run_id, "
                "source_ingestion_object_id, dataset_kind, 'new-replay-static', true "
                "FROM core.dataset_versions WHERE dataset_version_id = :old"
            ),
            {"new": current_version, "old": DATASET_VERSION_ID},
        )
        for table in ("routes", "stops", "trips", "stop_times"):
            connection.execute(
                text(
                    f"INSERT INTO silver.{table} SELECT (jsonb_populate_record("
                    f"NULL::silver.{table}, to_jsonb(s) || "
                    "jsonb_build_object('dataset_version_id', CAST(:new AS bigint)))).* "
                    f"FROM silver.{table} AS s WHERE dataset_version_id = :old"
                ),
                {"new": current_version, "old": DATASET_VERSION_ID},
            )
        connection.execute(
            text(
                "UPDATE silver.stop_times SET arrival_time = '12:09:00', "
                "departure_time = '12:09:00' WHERE dataset_version_id = :new "
                "AND stop_sequence = 2"
            ),
            {"new": current_version},
        )

    result = _refresh(engine, settings, {OLDER: projected[OLDER]})

    assert result.dataset_version_id == current_version
    assert result.static_context == "current_dataset"
    assert result.display_dict()["static_context"] == "current_dataset"
    with engine.connect() as connection:
        assert _delay_facts(connection) == {OLDER: (1, 0), NEWER: (1, 180)}
    assert [row["delay_seconds"] for row in _rows(engine, "latest_trip_delay_snapshot")] == [180]


def test_vehicle_selection_replaces_only_vehicle_facts_and_serving(
    captured, engine, settings, bronze_root
):
    snapshot_id, run_id, _, captured_at, _ = SNAPSHOTS[1]
    message = gtfs_realtime_pb2.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    message.header.timestamp = int(captured_at.timestamp())
    entity = message.entity.add()
    entity.id = "vehicle-replay"
    entity.vehicle.vehicle.id = "V_REPLAY"
    entity.vehicle.trip.trip_id = "T_REPLAY"
    entity.vehicle.trip.route_id = "51"
    entity.vehicle.position.latitude = 45.5
    entity.vehicle.position.longitude = -73.6
    with engine.begin() as connection:
        endpoint = connection.execute(
            text(
                "INSERT INTO core.feed_endpoints "
                "(provider_id, endpoint_key, feed_kind, source_format) "
                "VALUES (:p, 'vehicle_positions', 'vehicle_positions', "
                "'gtfs_rt_vehicle_positions') RETURNING feed_endpoint_id"
            ),
            {"p": PROVIDER},
        ).scalar_one()
        connection.execute(
            text(
                "UPDATE raw.ingestion_runs SET feed_endpoint_id = :endpoint, "
                "run_kind = 'vehicle_positions' WHERE ingestion_run_id = :run"
            ),
            {"endpoint": endpoint, "run": run_id},
        )
        connection.execute(
            text(
                "UPDATE raw.realtime_snapshot_index SET feed_endpoint_id = :endpoint "
                "WHERE realtime_snapshot_id = :snapshot"
            ),
            {"endpoint": endpoint, "snapshot": snapshot_id},
        )
    _change_archive(engine, bronze_root, SNAPSHOTS[1], message.SerializeToString())
    receipts = _load(engine, settings).verified_row_counts
    build_gold_marts(PROVIDER, settings=settings, registry=_StubRegistry(), engine=engine)
    _bootstrap_serving(engine, settings, {"trip_updates": OLDER, "vehicle_positions": NEWER})
    before = _gold_state(engine)
    assert len(before["fact_vehicle_snapshot"]) == 1
    with engine.begin() as connection:
        _stale_fact(connection, NEWER, "fact_vehicle_snapshot")
        connection.execute(
            text("UPDATE gold.fact_vehicle_snapshot SET latitude = 0 WHERE provider_id = :p"),
            {"p": PROVIDER},
        )

    result = _refresh(engine, settings, {NEWER: receipts[NEWER]})

    assert _gold_state(engine) == before
    assert result.row_counts["fact_vehicle_snapshot"] == 1
    assert result.row_counts["fact_trip_delay_snapshot"] == 0
    assert result.row_counts["latest_vehicle_snapshot"] == 1
