
from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
import real_db_seed as db_seed
from google.transit import gtfs_realtime_pb2
from sqlalchemy import text

from transit_ops.gtfs.types import ProviderBounds
from transit_ops.settings import Settings

PROVIDER = "stm_replay_drill_test"
PROVIDER_TZ = "America/Toronto"
STATIC_ENDPOINT_ID = 994401
TRIP_ENDPOINT_ID = 994402
STATIC_RUN_ID = 994500
DATASET_VERSION_ID = 994800
STATIC_OBJECT_ID = 994900

WINDOW_START = datetime(2026, 6, 20, 12, 0, tzinfo=UTC)
WINDOW_END = datetime(2026, 6, 20, 13, 0, tzinfo=UTC)
SNAPSHOTS = (
    (994601, 994701, 994901, datetime(2026, 6, 20, 12, 10, tzinfo=UTC), 60),
    (994602, 994702, 994902, datetime(2026, 6, 20, 12, 15, tzinfo=UTC), 180),
)

REALTIME_SILVER_TABLES = (
    "silver.rt_trip_update_stop_times",
    "silver.rt_trip_updates",
    "silver.rt_vehicle_positions",
    "silver.rt_entities",
    "silver.rt_feed_snapshots",
)

PROVIDER_BOUNDS = ProviderBounds(
    min_latitude=45.0,
    max_latitude=46.0,
    min_longitude=-74.0,
    max_longitude=-73.0,
)


def _storage_path(realtime_snapshot_id: int) -> str:
    return f"{PROVIDER}/trip_updates/{realtime_snapshot_id}.pb"


def _build_trip_update_bytes(*, captured_at: datetime, delay_seconds: int) -> bytes:

    message = gtfs_realtime_pb2.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    message.header.incrementality = gtfs_realtime_pb2.FeedHeader.FULL_DATASET
    message.header.timestamp = int(captured_at.timestamp())

    entity = message.entity.add()
    entity.id = "tu-replay-1"
    entity.trip_update.trip.trip_id = "T_REPLAY"
    entity.trip_update.trip.route_id = "51"
    entity.trip_update.trip.direction_id = 0
    entity.trip_update.trip.start_date = "20260620"
    entity.trip_update.trip.schedule_relationship = (
        gtfs_realtime_pb2.TripDescriptor.ScheduleRelationship.SCHEDULED
    )
    entity.trip_update.vehicle.id = "V_REPLAY"
    entity.trip_update.delay = delay_seconds

    stop_update = entity.trip_update.stop_time_update.add()
    stop_update.stop_sequence = 2
    stop_update.stop_id = "S2"
    scheduled_arrival = datetime(2026, 6, 20, 16, 8, tzinfo=UTC)
    stop_update.arrival.time = int(scheduled_arrival.timestamp()) + delay_seconds
    stop_update.arrival.delay = delay_seconds
    stop_update.schedule_relationship = (
        gtfs_realtime_pb2.TripUpdate.StopTimeUpdate.ScheduleRelationship.SCHEDULED
    )
    return message.SerializeToString()


@pytest.fixture()
def bronze_root(tmp_path: Path) -> Path:

    root = tmp_path / "bronze"
    for snapshot_id, _run, _obj, captured_at, delay in SNAPSHOTS:
        object_path = root / _storage_path(snapshot_id)
        object_path.parent.mkdir(parents=True, exist_ok=True)
        object_path.write_bytes(
            _build_trip_update_bytes(captured_at=captured_at, delay_seconds=delay)
        )
    return root


@pytest.fixture()
def settings(bronze_root: Path) -> Settings:

    return Settings(
        _env_file=None,
        BRONZE_STORAGE_BACKEND="local",
        BRONZE_LOCAL_ROOT=str(bronze_root),
    )


@pytest.fixture()
def engine(real_db_engine):
    _cleanup(real_db_engine)
    try:
        yield real_db_engine
    finally:
        _cleanup(real_db_engine)


def _cleanup(eng) -> None:  # noqa: ANN001

    with eng.begin() as connection:
        for table_name in (
            "gold.warm_rollup_periods",
            "gold.trip_delay_summary_5m",
            "gold.latest_trip_delay_snapshot",
            "gold.latest_vehicle_snapshot",
            "gold.fact_trip_delay_snapshot",
            "gold.fact_vehicle_snapshot",
            "gold.dim_date",
            "gold.dim_stop_history",
            "gold.dim_route_history",
            "gold.dim_stop",
            "gold.dim_route_pattern",
            "gold.dim_route",
            "silver.rt_trip_update_stop_times",
            "silver.rt_trip_updates",
            "silver.rt_vehicle_positions",
            "silver.rt_entities",
            "silver.rt_feed_snapshots",
            "silver.stop_times",
            "silver.trips",
            "silver.stops",
            "silver.routes",
            "core.dataset_versions",
            "raw.realtime_snapshot_index",
            "raw.ingestion_objects",
            "raw.ingestion_runs",
            "core.feed_endpoints",
            "core.providers",
        ):
            connection.execute(
                text(f"DELETE FROM {table_name} WHERE provider_id = :p"),
                {"p": PROVIDER},
            )


class _StubRegistry:

    class _Provider:
        provider_id = PROVIDER
        timezone = PROVIDER_TZ
        bounds = None

    class _Manifest:
        provider = None

        def realtime_feed(self, endpoint_key):
            return SimpleNamespace(endpoint_key=endpoint_key)

    def __init__(self) -> None:
        manifest = self._Manifest()
        manifest.provider = self._Provider()
        self._manifest = manifest

    def get_provider(self, provider_id: str):  # noqa: ANN001, ANN201
        assert provider_id == PROVIDER
        return self._manifest


def _seed_provider_and_static(connection, seed_provider) -> None:  # noqa: ANN001
    seed_provider(connection, PROVIDER, display_name="Replay drill", timezone=PROVIDER_TZ)
    connection.execute(
        text(
            """
            INSERT INTO core.feed_endpoints
                (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
            VALUES
                (:static_id, :p, 'static_schedule', 'static_schedule', 'gtfs_schedule_zip'),
                (:trip_id, :p, 'trip_updates', 'trip_updates', 'gtfs_rt_trip_updates')
            """
        ),
        {"static_id": STATIC_ENDPOINT_ID, "trip_id": TRIP_ENDPOINT_ID, "p": PROVIDER},
    )
    db_seed.ingestion_runs(
        connection, {'run_id': STATIC_RUN_ID, 'p': PROVIDER, 'endpoint_id': STATIC_ENDPOINT_ID},
        ingestion_run_id=':run_id', feed_endpoint_id=':endpoint_id', run_kind="'static_schedule'",
    )
    db_seed.ingestion_objects(
        connection,
        {
            "obj_id": STATIC_OBJECT_ID,
            "run_id": STATIC_RUN_ID,
            "p": PROVIDER,
            "path": f"{PROVIDER}/static/schedule.zip",
            "hash": "s" * 64,
        },
        ingestion_object_id=':obj_id', ingestion_run_id=':run_id', object_kind="'static_schedule'",
        storage_backend="'local'", checksum_sha256=':hash', byte_size='1',
    )
    db_seed.dataset_versions(
        connection,
        {
            "dv": DATASET_VERSION_ID,
            "p": PROVIDER,
            "endpoint_id": STATIC_ENDPOINT_ID,
            "run_id": STATIC_RUN_ID,
            "obj_id": STATIC_OBJECT_ID,
        },
        dataset_version_id=':dv', feed_endpoint_id=':endpoint_id',
        source_ingestion_run_id=':run_id', source_ingestion_object_id=':obj_id',
        content_hash="'replay-static'",
    )
    db_seed.replay_static_graph(connection, {"dv": DATASET_VERSION_ID, "p": PROVIDER})


def _seed_raw_realtime_snapshots(connection, snapshots=SNAPSHOTS) -> None:  # noqa: ANN001
    for snapshot_id, run_id, obj_id, captured_at, delay in snapshots:
        payload = _build_trip_update_bytes(captured_at=captured_at, delay_seconds=delay)
        db_seed.ingestion_runs(
            connection, {'run_id': run_id, 'p': PROVIDER, 'endpoint_id': TRIP_ENDPOINT_ID},
            ingestion_run_id=':run_id', feed_endpoint_id=':endpoint_id',
        )
        db_seed.ingestion_objects(
            connection,
            {
                "obj_id": obj_id,
                "run_id": run_id,
                "p": PROVIDER,
                "path": _storage_path(snapshot_id),
                "hash": hashlib.sha256(payload).hexdigest(),
                "size": len(payload),
            },
            ingestion_object_id=':obj_id', ingestion_run_id=':run_id',
            object_kind="'realtime_feed'", storage_backend="'local'", checksum_sha256=':hash',
            byte_size=':size',
        )
        db_seed.realtime_snapshot_index(
            connection,
            {
                "snapshot_id": snapshot_id,
                "run_id": run_id,
                "obj_id": obj_id,
                "p": PROVIDER,
                "endpoint_id": TRIP_ENDPOINT_ID,
                "captured": captured_at,
            },
            realtime_snapshot_id=':snapshot_id', ingestion_run_id=':run_id',
            ingestion_object_id=':obj_id', feed_endpoint_id=':endpoint_id',
            feed_timestamp_utc=':captured', entity_count='1', captured_at_utc=':captured',
        )


def _silver_counts(connection) -> dict[str, int]:  # noqa: ANN001
    return {
        table_name: connection.execute(
            text(f"SELECT count(*) FROM {table_name} WHERE provider_id = :p"),
            {"p": PROVIDER},
        ).scalar_one()
        for table_name in REALTIME_SILVER_TABLES
    }


def _delay_facts(connection) -> dict[int, tuple[int, int]]:  # noqa: ANN001
    rows = connection.execute(
        text(
            """
            SELECT realtime_snapshot_id,
                   count(*) AS n,
                   coalesce(sum(delay_seconds), 0) AS total
            FROM gold.fact_trip_delay_snapshot
            WHERE provider_id = :p
            GROUP BY realtime_snapshot_id
            ORDER BY realtime_snapshot_id
            """
        ),
        {"p": PROVIDER},
    ).mappings()
    return {int(row["realtime_snapshot_id"]): (int(row["n"]), int(row["total"])) for row in rows}


def _bootstrap_serving(engine, settings, selected):
    from transit_ops.gold.realtime import initialize_realtime_serving, refresh_gold_realtime
    from transit_ops.silver.realtime_gtfs import load_realtime_to_silver

    initialize_realtime_serving(PROVIDER, tuple(selected), engine=engine)
    receipts = [
        load_realtime_to_silver(
            PROVIDER,
            endpoint,
            snapshot_id=snapshot_id,
            settings=settings,
            registry=_StubRegistry(),
            engine=engine,
        )
        for endpoint, snapshot_id in selected.items()
    ]
    return refresh_gold_realtime(
        PROVIDER,
        snapshots=receipts,
        settings=settings,
        registry=_StubRegistry(),
        engine=engine,
        bootstrap_from_archive=True,
    )
