"""Real-database drill-test for the rebuild-from-raw realtime replay gate.

This is the PROOF behind thin-silver retention and disaster recovery: the
windowed replay functions (``find_realtime_bronze_snapshots`` +
``load_realtime_snapshots_to_silver``) have NO production callers today, yet the
nightly pg_dump excludes realtime stop-times and bets recovery on this path. The
drill seeds a small window of RAW Bronze realtime .pb snapshots on local disk,
loads them to Silver + builds Gold to capture the TRUTH, DELETES the realtime
Silver rows (simulating a thin-silver prune), then RE-DERIVES Silver from the raw
.pb via the real replay path (``replay-realtime-silver`` CLI core) and asserts the
reconstructed Silver row counts AND key Gold delay facts MATCH the captured truth
exactly. The truth is captured dynamically from the first normal load (never
hardcoded), so a tautology cannot pass.

Runs ONLY against a disposable Postgres migrated to head:

    TRANSIT_TEST_DATABASE_URL=postgresql+psycopg://postgres@localhost:5433/transit_ci \
        uv run pytest tests/test_replay_realtime_silver_real_db.py -v

Never point this at production.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from google.transit import gtfs_realtime_pb2
from sqlalchemy import text

from transit_ops.gold.marts import build_gold_marts
from transit_ops.gtfs.types import ProviderBounds
from transit_ops.ingestion.storage import get_bronze_storage
from transit_ops.settings import Settings
from transit_ops.silver.realtime_gtfs import (
    find_realtime_bronze_snapshots,
    load_realtime_snapshots_to_silver,
    replay_realtime_silver_window,
)

PROVIDER = "stm_replay_drill_test"
PROVIDER_TZ = "America/Toronto"
STATIC_ENDPOINT_ID = 994401
TRIP_ENDPOINT_ID = 994402
STATIC_RUN_ID = 994500
DATASET_VERSION_ID = 994800
STATIC_OBJECT_ID = 994900

# Two trip-update snapshots five minutes apart inside one window.
WINDOW_START = datetime(2026, 6, 20, 12, 0, tzinfo=UTC)
WINDOW_END = datetime(2026, 6, 20, 13, 0, tzinfo=UTC)
SNAPSHOTS = (
    # (realtime_snapshot_id, ingestion_run_id, ingestion_object_id, captured_at_utc, delay)
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

# Bounds covering Montreal; trip-update-only feed has no positions so this is a
# no-op, but it keeps the replay provider-agnostic via the manifest bounds path.
PROVIDER_BOUNDS = ProviderBounds(
    min_latitude=45.0,
    max_latitude=46.0,
    min_longitude=-74.0,
    max_longitude=-73.0,
)


def _storage_path(realtime_snapshot_id: int) -> str:
    return f"{PROVIDER}/trip_updates/{realtime_snapshot_id}.pb"


def _build_trip_update_bytes(*, captured_at: datetime, delay_seconds: int) -> bytes:
    """A one-entity, one-stop trip update whose arrival time encodes a delay."""

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
    # arrival time = scheduled 12:08 America/Toronto (= 16:08 UTC in June) + delay.
    scheduled_arrival = datetime(2026, 6, 20, 16, 8, tzinfo=UTC)
    stop_update.arrival.time = int(scheduled_arrival.timestamp()) + delay_seconds
    stop_update.arrival.delay = delay_seconds
    stop_update.schedule_relationship = (
        gtfs_realtime_pb2.TripUpdate.StopTimeUpdate.ScheduleRelationship.SCHEDULED
    )
    return message.SerializeToString()


@pytest.fixture()
def bronze_root(tmp_path: Path) -> Path:
    """Write the raw .pb bytes to a real local bronze tree for the replay to read."""

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
    """Settings wired to a real LOCAL bronze backend rooted at the tmp tree."""

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
    """Remove every row this drill could have committed, provider-scoped."""

    with eng.begin() as connection:
        for table_name in (
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
    """Manifest-driven registry stub so the replay stays provider-agnostic.

    Mirrors ProviderManifest.provider (provider_id, timezone, bounds) that the
    replay/gold paths read; no STM hardcoding leaks into the code under test.
    Bounds are None here (generic WGS84 fallback) since the drill feed is
    trip-updates-only and the position-quality bbox is unused.
    """

    class _Provider:
        provider_id = PROVIDER
        timezone = PROVIDER_TZ
        bounds = None

    class _Manifest:
        provider = None  # populated in __init__

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
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
            VALUES (:run_id, :p, :endpoint_id, 'static_schedule', 'succeeded')
            """
        ),
        {"run_id": STATIC_RUN_ID, "p": PROVIDER, "endpoint_id": STATIC_ENDPOINT_ID},
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_objects
                (ingestion_object_id, ingestion_run_id, provider_id, object_kind,
                 storage_backend, storage_path, checksum_sha256, byte_size)
            VALUES (:obj_id, :run_id, :p, 'static_schedule', 'local', :path, :hash, 1)
            """
        ),
        {
            "obj_id": STATIC_OBJECT_ID,
            "run_id": STATIC_RUN_ID,
            "p": PROVIDER,
            "path": f"{PROVIDER}/static/schedule.zip",
            "hash": "s" * 64,
        },
    )
    connection.execute(
        text(
            """
            INSERT INTO core.dataset_versions
                (dataset_version_id, provider_id, feed_endpoint_id,
                 source_ingestion_run_id, source_ingestion_object_id,
                 dataset_kind, content_hash, is_current)
            VALUES (:dv, :p, :endpoint_id, :run_id, :obj_id,
                    'static_schedule', 'replay-static', true)
            """
        ),
        {
            "dv": DATASET_VERSION_ID,
            "p": PROVIDER,
            "endpoint_id": STATIC_ENDPOINT_ID,
            "run_id": STATIC_RUN_ID,
            "obj_id": STATIC_OBJECT_ID,
        },
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.routes (dataset_version_id, provider_id, route_id, route_type)
            VALUES (:dv, :p, '51', 3)
            """
        ),
        {"dv": DATASET_VERSION_ID, "p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.stops (dataset_version_id, provider_id, stop_id, stop_name)
            VALUES (:dv, :p, 'S1', 'Stop 1'), (:dv, :p, 'S2', 'Stop 2')
            """
        ),
        {"dv": DATASET_VERSION_ID, "p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.trips
                (dataset_version_id, provider_id, trip_id, route_id, service_id)
            VALUES (:dv, :p, 'T_REPLAY', '51', 'WK')
            """
        ),
        {"dv": DATASET_VERSION_ID, "p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO silver.stop_times
                (dataset_version_id, provider_id, trip_id, stop_sequence,
                 stop_id, arrival_time, departure_time)
            VALUES
                (:dv, :p, 'T_REPLAY', 1, 'S1', '12:00:00', '12:00:00'),
                (:dv, :p, 'T_REPLAY', 2, 'S2', '12:08:00', '12:08:00')
            """
        ),
        {"dv": DATASET_VERSION_ID, "p": PROVIDER},
    )


def _seed_raw_realtime_snapshots(connection) -> None:  # noqa: ANN001
    for snapshot_id, run_id, obj_id, captured_at, _delay in SNAPSHOTS:
        connection.execute(
            text(
                """
                INSERT INTO raw.ingestion_runs
                    (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
                VALUES (:run_id, :p, :endpoint_id, 'trip_updates', 'succeeded')
                """
            ),
            {"run_id": run_id, "p": PROVIDER, "endpoint_id": TRIP_ENDPOINT_ID},
        )
        connection.execute(
            text(
                """
                INSERT INTO raw.ingestion_objects
                    (ingestion_object_id, ingestion_run_id, provider_id, object_kind,
                     storage_backend, storage_path, checksum_sha256, byte_size)
                VALUES (:obj_id, :run_id, :p, 'realtime_feed', 'local', :path, :hash, 1)
                """
            ),
            {
                "obj_id": obj_id,
                "run_id": run_id,
                "p": PROVIDER,
                "path": _storage_path(snapshot_id),
                "hash": f"{snapshot_id:064d}",
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO raw.realtime_snapshot_index
                    (realtime_snapshot_id, ingestion_run_id, ingestion_object_id,
                     provider_id, feed_endpoint_id, feed_timestamp_utc,
                     entity_count, captured_at_utc)
                VALUES (:snapshot_id, :run_id, :obj_id, :p, :endpoint_id,
                        :captured, 1, :captured)
                """
            ),
            {
                "snapshot_id": snapshot_id,
                "run_id": run_id,
                "obj_id": obj_id,
                "p": PROVIDER,
                "endpoint_id": TRIP_ENDPOINT_ID,
                "captured": captured_at,
            },
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
    # Per-snapshot (row_count, total_delay_seconds) — a DETERMINISTIC, complete
    # projection of the Gold delay facts. (Keying {snapshot_id: delay_seconds}
    # over many rows/snapshot would keep an arbitrary last row — physical-order
    # dependent — so it could differ between two builds even when the facts are
    # identical. Count + sum catch both a row-count drift AND any value drift.)
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


def test_replay_reconstructs_silver_and_gold_from_raw_after_prune(  # noqa: ANN001
    engine, settings, seed_provider
) -> None:
    # --- 1. Seed raw bronze window + static schedule (committed). ---------------
    with engine.begin() as connection:
        _seed_provider_and_static(connection, seed_provider)
        _seed_raw_realtime_snapshots(connection)

    # --- 2. NORMAL load + Gold build -> capture the TRUTH. ----------------------
    # Establish ground truth via the standard per-snapshot load path
    # (skip_existing=False), DISTINCT from the windowed replay path exercised in
    # step 4, so equality in step 5 is a real cross-path proof, not a tautology.
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
            bronze_storage=bronze_storage,
            skip_existing=False,
            provider_bounds=PROVIDER_BOUNDS,
        )
    build_gold_marts(PROVIDER, settings=settings, registry=_StubRegistry(), engine=engine)

    with engine.connect() as connection:
        truth_silver = _silver_counts(connection)
        truth_delays = _delay_facts(connection)

    # Non-tautology guards: the truth must be NON-EMPTY and reflect both snapshots.
    assert truth_silver["silver.rt_feed_snapshots"] == len(SNAPSHOTS)
    assert truth_silver["silver.rt_trip_updates"] == len(SNAPSHOTS)
    assert truth_silver["silver.rt_trip_update_stop_times"] == len(SNAPSHOTS)
    assert len(truth_delays) == len(SNAPSHOTS)
    assert all(n > 0 for (n, _total) in truth_delays.values())

    # --- 3. PRUNE realtime Silver (simulate thin-silver retention). -------------
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

    # --- 4. REPLAY from RAW Bronze (the gated DR path) + rebuild Gold. ----------
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

    # --- 5. ASSERT reconstruction MATCHES the captured truth. -------------------
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
    # Seed the provider + static (so the registry/manifest resolve) but NO raw
    # realtime snapshots in the window.
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
