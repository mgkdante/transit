from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, replace
from datetime import datetime
from typing import Literal

from sqlalchemy import Connection, Engine
from sqlalchemy.sql.elements import TextClause

from transit_ops.db.connection import make_engine, set_daily_warm_transaction_timeouts
from transit_ops.gold.delay_days import invalidate_delay_days
from transit_ops.gold.delay_periods import invalidate_delay_snapshot, lock_delay_hours
from transit_ops.gold.marts import (
    ACQUIRE_GOLD_BUILD_LOCK,
    ANALYZE_REALTIME_SILVER_TABLES,
    UPSERT_FACT_TRIP_DELAY_SNAPSHOT_LATEST,
    UPSERT_FACT_VEHICLE_SNAPSHOT_LATEST,
    GoldBuildContext,
    GoldRealtimeRefreshResult,
    _realtime_analyze_is_due,
    _refresh_latest_gold_tables,
    _resolve_gold_build_context,
    _safe_rowcount,
)
from transit_ops.gold.transactions import run_gold_transaction
from transit_ops.ingestion.common import utc_now
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings, get_settings
from transit_ops.silver.realtime_gtfs import RealtimeSilverLoadResult
from transit_ops.sql_registry import named_query


@dataclass(frozen=True)
class GoldSnapshotRefreshResult:
    provider_id: str
    dataset_version_id: int
    snapshot_ids: tuple[int, ...]
    refreshed_at_utc: datetime
    row_counts: dict[str, int]
    static_context: Literal["current_dataset"] = "current_dataset"
    serving_policy: Literal["preserve_current"] = "preserve_current"

    def display_dict(self) -> dict[str, object]:
        return {**asdict(self), "refreshed_at_utc": self.refreshed_at_utc.isoformat()}


@dataclass(frozen=True)
class _SnapshotProjection:
    fact_table: str
    projection: TextClause
    entity_kind: str
    source_tables: tuple[str, ...]


_SNAPSHOT_PROJECTIONS = {
    "trip_updates": _SnapshotProjection(
        "fact_trip_delay_snapshot",
        UPSERT_FACT_TRIP_DELAY_SNAPSHOT_LATEST,
        "trip_update",
        ("rt_feed_snapshots", "rt_entities", "rt_trip_updates", "rt_trip_update_stop_times"),
    ),
    "vehicle_positions": _SnapshotProjection(
        "fact_vehicle_snapshot",
        UPSERT_FACT_VEHICLE_SNAPSHOT_LATEST,
        "vehicle_position",
        ("rt_feed_snapshots", "rt_entities", "rt_vehicle_positions"),
    ),
}
_REPLAY_SOURCE = named_query(
    "mart.replay.source",
    """
    SELECT s.rt_feed_snapshot_id, s.endpoint_key, r.entity_count,
           r.captured_at_utc, r.feed_timestamp_utc, r.ingestion_run_id, r.ingestion_object_id,
           o.checksum_sha256,
           COALESCE(
               run.status = 'succeeded' AND run.provider_id = r.provider_id
               AND run.feed_endpoint_id = r.feed_endpoint_id
               AND endpoint.provider_id = r.provider_id
               AND o.provider_id = r.provider_id AND o.ingestion_run_id = r.ingestion_run_id
               AND o.checksum_sha256 ~ '^[0-9a-fA-F]{64}$' AND o.byte_size >= 0
               AND s.provider_id = r.provider_id AND s.feed_endpoint_id = r.feed_endpoint_id
               AND s.endpoint_key = endpoint.endpoint_key
               AND s.ingestion_run_id = r.ingestion_run_id
               AND s.ingestion_object_id = r.ingestion_object_id
               AND s.checksum_sha256 = o.checksum_sha256 AND s.byte_size = o.byte_size
               AND s.captured_at_utc = r.captured_at_utc
               AND s.feed_timestamp_utc IS NOT DISTINCT FROM r.feed_timestamp_utc
               AND r.entity_count >= 0
               AND s.manifest_json @> jsonb_build_object('entity_count', r.entity_count), false
           ) AS metadata_matches
    FROM raw.realtime_snapshot_index AS r
    JOIN raw.ingestion_runs AS run USING (ingestion_run_id)
    JOIN core.feed_endpoints AS endpoint ON endpoint.feed_endpoint_id = r.feed_endpoint_id
    LEFT JOIN raw.ingestion_objects AS o USING (ingestion_object_id)
    LEFT JOIN silver.rt_feed_snapshots AS s
      ON s.source_realtime_snapshot_id = r.realtime_snapshot_id
    WHERE r.provider_id = :provider_id AND r.realtime_snapshot_id = :snapshot_id
    """,
)
_REPLAY_COUNTS = {
    table: named_query(
        f"mart.replay.count_{table}",
        f"""
        SELECT count(*) AS rows,
               count(*) FILTER (WHERE provider_id = :provider_id) AS owned_rows
        FROM silver.{table} WHERE rt_feed_snapshot_id = :silver_id
        """,
    )
    for table in {table for item in _SNAPSHOT_PROJECTIONS.values() for table in item.source_tables}
}
_REPLAY_KEYS = {
    endpoint: named_query(
        f"mart.replay.keys_{endpoint}",
        f"""
        SELECT NOT EXISTS (
            SELECT 1 FROM silver.rt_entities
            WHERE rt_feed_snapshot_id = :silver_id
              AND (entity_index < 0 OR entity_index >= :entity_count)
        ) AND NOT EXISTS (
            (SELECT entity_index FROM silver.rt_entities
             WHERE rt_feed_snapshot_id = :silver_id AND entity_kind = :entity_kind
             EXCEPT SELECT entity_index FROM silver.{item.source_tables[2]}
             WHERE rt_feed_snapshot_id = :silver_id)
            UNION ALL
            (SELECT entity_index FROM silver.{item.source_tables[2]}
             WHERE rt_feed_snapshot_id = :silver_id
             EXCEPT SELECT entity_index FROM silver.rt_entities
             WHERE rt_feed_snapshot_id = :silver_id AND entity_kind = :entity_kind)
        )
        """,
    )
    for endpoint, item in _SNAPSHOT_PROJECTIONS.items()
}
_REPLAY_DELETE = {
    endpoint: named_query(
        f"mart.replay.delete_{endpoint}",
        f"DELETE FROM gold.{item.fact_table} "
        "WHERE provider_id = :provider_id AND realtime_snapshot_id = :snapshot_id",
    )
    for endpoint, item in _SNAPSHOT_PROJECTIONS.items()
}
_REPLAY_SERVING_IDS = named_query(
    "mart.replay.serving_ids",
    """
    SELECT (SELECT max(realtime_snapshot_id) FROM gold.latest_trip_delay_snapshot
            WHERE provider_id = :provider_id) AS trips,
           (SELECT max(realtime_snapshot_id) FROM gold.latest_vehicle_snapshot
            WHERE provider_id = :provider_id) AS vehicles
    """,
)

_SERVING_STATE = named_query(
    "mart.realtime.serving_state",
    """
    SELECT endpoint_key, realtime_snapshot_id, captured_at_utc, initialized_at_utc
    FROM gold.realtime_serving_state WHERE provider_id = :provider_id
    """,
)
_INITIALIZE_SERVING = named_query(
    "mart.realtime.initialize_serving",
    """
    INSERT INTO gold.realtime_serving_state
        (provider_id, endpoint_key, realtime_snapshot_id, captured_at_utc)
    VALUES (:provider_id, :endpoint_key, :snapshot_id, :captured_at_utc)
    ON CONFLICT (provider_id, endpoint_key) DO NOTHING
    """,
)
_ADVANCE_SERVING = named_query(
    "mart.realtime.advance_serving",
    """
    UPDATE gold.realtime_serving_state
    SET realtime_snapshot_id = :snapshot_id, captured_at_utc = :captured_at_utc
    WHERE provider_id = :provider_id AND endpoint_key = :endpoint_key
    """,
)
_LATEST_CAPTURE = named_query(
    "mart.realtime.latest_capture",
    """
    SELECT r.realtime_snapshot_id
    FROM raw.realtime_snapshot_index AS r
    JOIN core.feed_endpoints AS e ON e.feed_endpoint_id = r.feed_endpoint_id
    JOIN raw.ingestion_runs AS run ON run.ingestion_run_id = r.ingestion_run_id
    WHERE r.provider_id = :provider_id AND e.provider_id = r.provider_id
      AND e.endpoint_key = :endpoint_key AND run.status = 'succeeded'
    ORDER BY r.captured_at_utc DESC, r.realtime_snapshot_id DESC LIMIT 1
    """,
)
_CACHE_IDENTITY = {
    endpoint: named_query(
        f"mart.realtime.cache_identity_{endpoint}",
        f"""
        SELECT c.realtime_snapshot_id, c.captured_at_utc,
               bool_and(COALESCE(r.provider_id = c.provider_id
                   AND e.provider_id = c.provider_id AND e.endpoint_key = :endpoint_key
                   AND r.captured_at_utc = c.captured_at_utc, false)) AS valid
        FROM gold.{table} AS c
        LEFT JOIN raw.realtime_snapshot_index AS r USING (realtime_snapshot_id)
        LEFT JOIN core.feed_endpoints AS e ON e.feed_endpoint_id = r.feed_endpoint_id
        WHERE c.provider_id = :provider_id
        GROUP BY c.realtime_snapshot_id, c.captured_at_utc
        """,
    )
    for endpoint, table in (
        ("trip_updates", "latest_trip_delay_snapshot"),
        ("vehicle_positions", "latest_vehicle_snapshot"),
    )
}


def _project_facts(
    conn: Connection, context: GoldBuildContext, endpoints: Mapping[int, str]
) -> dict[str, int]:
    provider_id = context.provider_id
    lock_delay_hours(conn, provider_id)
    for snapshot_id, endpoint in endpoints.items():
        if endpoint == "trip_updates":
            invalidate_delay_snapshot(conn, provider_id, snapshot_id)
    invalidate_delay_days(
        conn,
        provider_id,
        [sid for sid, endpoint in endpoints.items() if endpoint == "trip_updates"],
    )
    row_counts = {item.fact_table: 0 for item in _SNAPSHOT_PROJECTIONS.values()}
    for snapshot_id, endpoint in endpoints.items():
        spec = _SNAPSHOT_PROJECTIONS[endpoint]
        params = {
            "provider_id": provider_id,
            "snapshot_id": snapshot_id,
            "realtime_snapshot_id": snapshot_id,
            "provider_timezone": context.provider_timezone,
            "dataset_version_id": context.dataset_version_id,
        }
        conn.execute(_REPLAY_DELETE[endpoint], params)
        row_counts[spec.fact_table] += _safe_rowcount(conn.execute(spec.projection, params))
    return row_counts


def initialize_realtime_serving(
    provider_id: str,
    endpoint_keys: Sequence[str],
    *,
    engine: Engine | None = None,
    settings: Settings | None = None,
) -> None:
    """Preserve proven caches or fix an unknown lane's cutoff before fresh capture."""
    endpoints = tuple(sorted(set(endpoint_keys)))
    if any(endpoint not in _SNAPSHOT_PROJECTIONS for endpoint in endpoints):
        raise ValueError("Serving initialization supports trip_updates and vehicle_positions")
    if not endpoints:
        return
    owns_engine = engine is None
    engine = engine or make_engine(settings or get_settings())

    def initialize(conn: Connection) -> None:
        set_daily_warm_transaction_timeouts(conn)
        conn.execute(ACQUIRE_GOLD_BUILD_LOCK, {"provider_id": provider_id})
        existing = conn.execute(_SERVING_STATE, {"provider_id": provider_id}).mappings().all()
        initialized = {row["endpoint_key"] for row in existing}
        for endpoint in endpoints:
            if endpoint in initialized:
                continue
            params = {"provider_id": provider_id, "endpoint_key": endpoint}
            cache = conn.execute(_CACHE_IDENTITY[endpoint], params).mappings().all()
            if len(cache) > 1 or (cache and not cache[0]["valid"]):
                raise ValueError(f"Cannot initialize inconsistent Gold serving cache {endpoint}")
            conn.execute(
                _INITIALIZE_SERVING,
                params
                | {
                    "snapshot_id": cache[0]["realtime_snapshot_id"] if cache else None,
                    "captured_at_utc": cache[0]["captured_at_utc"] if cache else None,
                },
            )

    try:
        run_gold_transaction(engine, initialize)
    finally:
        if owns_engine:
            engine.dispose()


def refresh_gold_realtime(
    provider_id: str,
    *,
    snapshots: Sequence[RealtimeSilverLoadResult],
    settings: Settings | None = None,
    registry: ProviderRegistry | None = None,
    engine: Engine | None = None,
    bootstrap_from_archive: bool = False,
) -> GoldRealtimeRefreshResult:
    """Project exact Silver successes and advance each live lane in capture order."""
    snapshots = tuple(snapshots)
    if any(not isinstance(snapshot, RealtimeSilverLoadResult) for snapshot in snapshots):
        raise TypeError("Gold live projection requires typed Silver load receipts")
    if any(snapshot.provider_id != provider_id for snapshot in snapshots):
        raise ValueError("Gold live receipts must belong to the requested provider")
    if len({snapshot.endpoint_key for snapshot in snapshots}) != len(snapshots):
        raise ValueError("Gold live projection accepts one receipt per endpoint")
    if any(
        type(snapshot.realtime_snapshot_id) is not int or snapshot.realtime_snapshot_id <= 0
        for snapshot in snapshots
    ):
        raise ValueError("Gold live projection requires positive snapshot IDs")
    if any(
        type(count) is not int or count < 0
        for snapshot in snapshots
        for count in snapshot.row_counts.values()
    ):
        raise ValueError("Expected Silver table counts must be nonnegative integers")
    settings = settings or get_settings()
    registry = registry or ProviderRegistry.from_project_root(settings=settings)
    manifest = registry.get_provider(provider_id)
    if not snapshots:
        return GoldRealtimeRefreshResult(
            provider_id,
            manifest.provider.timezone,
            None,
            None,
            None,
            utc_now(),
            {},
        )
    owns_engine = engine is None
    engine = engine or make_engine(settings)

    def project(conn: Connection) -> GoldRealtimeRefreshResult:
        set_daily_warm_transaction_timeouts(conn)
        conn.execute(ACQUIRE_GOLD_BUILD_LOCK, {"provider_id": provider_id})
        context = _resolve_gold_build_context(
            conn, provider_id=provider_id, provider_timezone=manifest.provider.timezone
        )
        states = {
            row["endpoint_key"]: dict(row)
            for row in conn.execute(_SERVING_STATE, {"provider_id": provider_id}).mappings()
        }
        endpoints = {}
        refresh_ids = set()
        advanced = []
        bootstrapped = []
        changes = []
        for receipt in sorted(snapshots, key=lambda snapshot: snapshot.realtime_snapshot_id):
            source = _validate_replay_snapshot(
                conn, provider_id, receipt.realtime_snapshot_id, receipt.row_counts
            )
            for field, expected in (
                ("endpoint_key", receipt.endpoint_key),
                ("ingestion_run_id", receipt.source_ingestion_run_id),
                ("ingestion_object_id", receipt.source_ingestion_object_id),
                ("captured_at_utc", receipt.captured_at_utc),
                ("feed_timestamp_utc", receipt.feed_timestamp_utc),
                ("checksum_sha256", receipt.content_hash),
            ):
                if source[field] != expected:
                    raise ValueError(f"Silver receipt disagrees with source {field}")
            endpoint = receipt.endpoint_key
            snapshot_id = receipt.realtime_snapshot_id
            endpoints[snapshot_id] = endpoint
            if endpoint not in states:
                raise ValueError(
                    f"Initialize serving for {endpoint} before capturing realtime data"
                )
            state = states[endpoint]
            previous_id = state["realtime_snapshot_id"]
            if previous_id == snapshot_id and state["captured_at_utc"] != receipt.captured_at_utc:
                raise ValueError("Accepted capture timestamp changed for the same snapshot ID")
            if bootstrap_from_archive and previous_id is None:
                latest = conn.execute(
                    _LATEST_CAPTURE, {"provider_id": provider_id, "endpoint_key": endpoint}
                ).scalar_one_or_none()
                if latest != snapshot_id:
                    raise ValueError("Archive bootstrap selection is no longer the latest capture")
                bootstrapped.append(snapshot_id)
                newer = True
            elif previous_id is None:
                newer = receipt.captured_at_utc > state["initialized_at_utc"]
            else:
                newer = (receipt.captured_at_utc, snapshot_id) > (
                    state["captured_at_utc"],
                    previous_id,
                )
            if newer:
                advanced.append(snapshot_id)
                refresh_ids.add(snapshot_id)
                changes.append(
                    {
                        "provider_id": provider_id,
                        "endpoint_key": endpoint,
                        "snapshot_id": snapshot_id,
                        "captured_at_utc": receipt.captured_at_utc,
                    }
                )
                state.update(
                    realtime_snapshot_id=snapshot_id, captured_at_utc=receipt.captured_at_utc
                )
            elif previous_id == snapshot_id:
                refresh_ids.add(snapshot_id)
        if _realtime_analyze_is_due(
            conn, min_interval_seconds=settings.GOLD_REALTIME_ANALYZE_MIN_INTERVAL_SECONDS
        ):
            conn.execute(ANALYZE_REALTIME_SILVER_TABLES)
        row_counts = _project_facts(conn, context, endpoints)
        for params in changes:
            conn.execute(_ADVANCE_SERVING, params)
        context = replace(
            context,
            latest_trip_updates_snapshot_id=states.get("trip_updates", {}).get(
                "realtime_snapshot_id", context.latest_trip_updates_snapshot_id
            ),
            latest_vehicle_snapshot_id=states.get("vehicle_positions", {}).get(
                "realtime_snapshot_id", context.latest_vehicle_snapshot_id
            ),
        )
        row_counts.update(
            _refresh_latest_gold_tables(conn, context=context, snapshot_ids=frozenset(refresh_ids))
        )
        return GoldRealtimeRefreshResult(
            provider_id,
            context.provider_timezone,
            context.dataset_version_id,
            context.latest_trip_updates_snapshot_id,
            context.latest_vehicle_snapshot_id,
            utc_now(),
            row_counts,
            tuple(sorted(endpoints)),
            tuple(advanced),
            tuple(bootstrapped),
        )

    try:
        return run_gold_transaction(engine, project)
    finally:
        if owns_engine:
            engine.dispose()


def _validate_replay_snapshot(
    conn: Connection, provider_id: str, snapshot_id: int, expected: Mapping[str, int]
) -> Mapping[str, object]:
    frames = (
        conn.execute(_REPLAY_SOURCE, {"provider_id": provider_id, "snapshot_id": snapshot_id})
        .mappings()
        .all()
    )
    if len(frames) != 1 or not frames[0]["metadata_matches"]:
        raise ValueError(f"Missing or inconsistent Silver source for snapshot {snapshot_id}")
    source = frames[0]
    endpoint = str(source["endpoint_key"])
    if endpoint not in _SNAPSHOT_PROJECTIONS:
        raise ValueError(f"Unsupported Silver snapshot endpoint {endpoint!r}")
    spec = _SNAPSHOT_PROJECTIONS[endpoint]
    if set(expected) != set(spec.source_tables):
        raise ValueError(
            f"Snapshot {snapshot_id} requires expected counts for {', '.join(spec.source_tables)}"
        )
    if expected["rt_feed_snapshots"] != 1 or expected["rt_entities"] != source["entity_count"]:
        raise ValueError(
            f"Expected counts disagree with capture metadata for snapshot {snapshot_id}"
        )
    params = {
        "provider_id": provider_id,
        "silver_id": source["rt_feed_snapshot_id"],
        "entity_kind": spec.entity_kind,
        "entity_count": source["entity_count"],
    }
    for table in spec.source_tables:
        actual = conn.execute(_REPLAY_COUNTS[table], params).mappings().one()
        if actual["rows"] != expected[table] or actual["owned_rows"] != expected[table]:
            raise ValueError(f"Incomplete Silver snapshot {snapshot_id}: {table} count mismatch")
    if not conn.execute(_REPLAY_KEYS[endpoint], params).scalar_one():
        raise ValueError(f"Incomplete Silver snapshot {snapshot_id}: entity key mismatch")
    return {str(key): value for key, value in source.items()}


def refresh_gold_snapshots(
    provider_id: str,
    *,
    expected_rows: Mapping[int, Mapping[str, int]],
    settings: Settings | None = None,
    registry: ProviderRegistry | None = None,
    engine: Engine | None = None,
) -> GoldSnapshotRefreshResult:
    """Project selected complete populations while preserving the current serving identity."""
    if not expected_rows or any(type(key) is not int or key <= 0 for key in expected_rows):
        raise ValueError("Snapshot replay requires explicit positive snapshot IDs")
    if any(
        type(value) is not int or value < 0
        for rows in expected_rows.values()
        for value in rows.values()
    ):
        raise ValueError("Expected Silver table counts must be nonnegative integers")
    settings = settings or get_settings()
    registry = registry or ProviderRegistry.from_project_root(settings=settings)
    manifest = registry.get_provider(provider_id)
    owns_engine = engine is None
    engine = engine or make_engine(settings)
    snapshot_ids = tuple(sorted(expected_rows))

    def project(conn: Connection) -> GoldSnapshotRefreshResult:
        set_daily_warm_transaction_timeouts(conn)
        conn.execute(ACQUIRE_GOLD_BUILD_LOCK, {"provider_id": provider_id})
        context = _resolve_gold_build_context(
            conn, provider_id=provider_id, provider_timezone=manifest.provider.timezone
        )
        endpoints = {
            snapshot_id: str(
                _validate_replay_snapshot(
                    conn, provider_id, snapshot_id, expected_rows[snapshot_id]
                )["endpoint_key"]
            )
            for snapshot_id in snapshot_ids
        }
        serving = conn.execute(_REPLAY_SERVING_IDS, {"provider_id": provider_id}).mappings().one()
        context = replace(
            context,
            latest_trip_updates_snapshot_id=serving["trips"],
            latest_vehicle_snapshot_id=serving["vehicles"],
        )
        row_counts = _project_facts(conn, context, endpoints)
        row_counts.update(
            _refresh_latest_gold_tables(conn, context=context, snapshot_ids=frozenset(snapshot_ids))
        )
        return GoldSnapshotRefreshResult(
            provider_id, context.dataset_version_id, snapshot_ids, utc_now(), row_counts
        )

    try:
        return run_gold_transaction(engine, project)
    finally:
        if owns_engine:
            engine.dispose()
