from __future__ import annotations

import hashlib
from types import SimpleNamespace

import pytest
from google.transit import gtfs_realtime_pb2
from realtime_replay_fixtures import (
    PROVIDER,
    PROVIDER_TZ,
    SNAPSHOTS,
    _seed_provider_and_static,
    _seed_raw_realtime_snapshots,
    _storage_path,
)
from realtime_replay_fixtures import bronze_root as bronze_root
from realtime_replay_fixtures import engine as engine
from realtime_replay_fixtures import settings as settings
from sqlalchemy import text

from transit_ops.silver import realtime_gtfs

OLDER, NEWER = (snapshot[0] for snapshot in SNAPSHOTS)


class Registry:
    def get_provider(self, provider_id):
        return SimpleNamespace(
            provider=SimpleNamespace(provider_id=provider_id, timezone=PROVIDER_TZ, bounds=None),
            realtime_feed=lambda endpoint: SimpleNamespace(endpoint_key=endpoint),
        )


@pytest.fixture
def captured(engine, seed_provider):
    with engine.begin() as connection:
        _seed_provider_and_static(connection, seed_provider)
        _seed_raw_realtime_snapshots(connection)


def _load(engine, settings, snapshot_id=OLDER, provider_id=PROVIDER, endpoint="trip_updates"):
    return realtime_gtfs.load_realtime_to_silver(
        provider_id,
        endpoint,
        snapshot_id=snapshot_id,
        settings=settings,
        registry=Registry(),
        engine=engine,
    )


def _silver_state(engine):
    with engine.connect() as connection:
        return {
            table: connection.execute(
                text(
                    f"SELECT to_jsonb(t) FROM silver.{table} t WHERE provider_id=:p "
                    "ORDER BY to_jsonb(t)::text"
                ),
                {"p": PROVIDER},
            )
            .scalars()
            .all()
            for table in (
                "rt_feed_snapshots",
                "rt_entities",
                "rt_trip_updates",
                "rt_trip_update_stop_times",
            )
        }


def test_exact_capture_loads_older_a_when_newer_b_is_already_committed(captured, engine, settings):
    result = _load(engine, settings)
    assert result.realtime_snapshot_id == OLDER
    assert result.source_ingestion_run_id == SNAPSHOTS[0][1]
    assert result.source_ingestion_object_id == SNAPSHOTS[0][2]
    state = _silver_state(engine)
    assert [row["source_realtime_snapshot_id"] for row in state["rt_feed_snapshots"]] == [OLDER]
    assert result.row_counts["rt_trip_update_stop_times"] == 1
    assert NEWER not in [row["source_realtime_snapshot_id"] for row in state["rt_feed_snapshots"]]


def test_exact_capture_retry_verifies_bytes_and_preserves_the_complete_load(
    captured, engine, settings, bronze_root
):
    first = _load(engine, settings)
    before = _silver_state(engine)
    second = _load(engine, settings)
    assert second.display_dict() == first.display_dict()
    assert _silver_state(engine) == before
    path = bronze_root / _storage_path(OLDER)
    payload = path.read_bytes()
    path.write_bytes(payload[:-1] + bytes([payload[-1] ^ 1]))
    with pytest.raises(ValueError, match="checksum mismatch"):
        _load(engine, settings)
    assert _silver_state(engine) == before


def test_exact_capture_retry_refuses_partially_pruned_silver(captured, engine, settings):
    _load(engine, settings)
    with engine.begin() as connection:
        connection.execute(
            text("DELETE FROM silver.rt_trip_update_stop_times WHERE provider_id=:p"),
            {"p": PROVIDER},
        )
    before = _silver_state(engine)
    with pytest.raises(ValueError, match="Incomplete Silver load"):
        _load(engine, settings)
    assert _silver_state(engine) == before


def test_exact_empty_capture_is_idempotent(captured, engine, settings, bronze_root):
    message = gtfs_realtime_pb2.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    message.header.timestamp = int(SNAPSHOTS[0][3].timestamp())
    payload = message.SerializeToString()
    (bronze_root / _storage_path(OLDER)).write_bytes(payload)
    with engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE raw.ingestion_objects SET checksum_sha256=:hash, byte_size=:size "
                "WHERE ingestion_object_id=:id"
            ),
            {
                "hash": hashlib.sha256(payload).hexdigest(),
                "size": len(payload),
                "id": SNAPSHOTS[0][2],
            },
        )
        connection.execute(
            text(
                "UPDATE raw.realtime_snapshot_index SET entity_count=0 "
                "WHERE realtime_snapshot_id=:id"
            ),
            {"id": OLDER},
        )
    first = _load(engine, settings)
    second = _load(engine, settings)
    assert first.display_dict() == second.display_dict()
    assert first.row_counts == {
        "rt_feed_snapshots": 1,
        "rt_entities": 0,
        "rt_trip_updates": 0,
        "rt_trip_update_stop_times": 0,
    }


@pytest.mark.parametrize("change", ["missing", "provider", "endpoint", "failed_run"])
def test_exact_capture_identity_never_falls_back_to_latest(captured, engine, settings, change):
    kwargs = {}
    if change == "missing":
        kwargs["snapshot_id"] = NEWER + 1
    elif change == "provider":
        kwargs["provider_id"] = "absent_capture_provider"
    elif change == "endpoint":
        kwargs["endpoint"] = "vehicle_positions"
    else:
        with engine.begin() as connection:
            connection.execute(
                text("UPDATE raw.ingestion_runs SET status='failed' WHERE ingestion_run_id=:id"),
                {"id": SNAPSHOTS[0][1]},
            )
    with pytest.raises(ValueError, match="snapshot"):
        _load(engine, settings, **kwargs)
    assert not _silver_state(engine)["rt_feed_snapshots"]


@pytest.mark.parametrize("snapshot_id", [0, -1, True, "1"])
def test_exact_capture_rejects_invalid_identifiers_before_database_access(snapshot_id):
    with pytest.raises(ValueError, match="positive integer"):
        _load(object(), object(), snapshot_id=snapshot_id)


@pytest.mark.parametrize("selection", ["capture_time", "id_tie", "failed_newer"])
def test_latest_archive_selection_uses_capture_order_and_omits_missing_lanes(
    captured, engine, settings, selection
):
    from datetime import timedelta

    with engine.begin() as connection:
        if selection == "capture_time":
            connection.execute(
                text(
                    "UPDATE raw.realtime_snapshot_index SET captured_at_utc=:captured "
                    "WHERE realtime_snapshot_id=:id"
                ),
                {"captured": SNAPSHOTS[1][3] + timedelta(seconds=1), "id": OLDER},
            )
            expected = OLDER
        elif selection == "id_tie":
            connection.execute(
                text(
                    "UPDATE raw.realtime_snapshot_index SET captured_at_utc=:captured "
                    "WHERE realtime_snapshot_id=:id"
                ),
                {"captured": SNAPSHOTS[1][3], "id": OLDER},
            )
            expected = NEWER
        else:
            connection.execute(
                text("UPDATE raw.ingestion_runs SET status='failed' WHERE ingestion_run_id=:id"),
                {"id": SNAPSHOTS[1][1]},
            )
            expected = OLDER
    results = realtime_gtfs.load_latest_realtime_snapshots_to_silver(
        PROVIDER,
        ("trip_updates", "vehicle_positions"),
        settings=settings,
        registry=Registry(),
        engine=engine,
    )
    assert [result.realtime_snapshot_id for result in results] == [expected]
    assert [result.endpoint_key for result in results] == ["trip_updates"]
    assert [
        row["source_realtime_snapshot_id"] for row in _silver_state(engine)["rt_feed_snapshots"]
    ] == [expected]
