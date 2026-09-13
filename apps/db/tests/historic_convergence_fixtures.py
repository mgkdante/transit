"""One retained provider/day for real historic publication and recovery."""

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from google.transit import gtfs_realtime_pb2
from realtime_replay_fixtures import _build_trip_update_bytes
from sqlalchemy import text

from transit_ops.gold import delay_days, rollups
from transit_ops.gold.marts import build_gold_marts
from transit_ops.gold.realtime import refresh_gold_snapshots
from transit_ops.settings import Settings
from transit_ops.silver.realtime_gtfs import load_realtime_to_silver
from transit_ops.snapshots import publish
from transit_ops.snapshots.storage import LocalSnapshotStorage
from transit_ops.source_factory.catalog import reset_source_factory_tables

PROVIDER = "historic_convergence_test"
TZ = ZoneInfo("America/Toronto")
ROOT_KEY = "historic/history/index.json"


def cleanup(engine):
    with engine.begin() as conn:
        retained = (
            conn.execute(
                text("""
            SELECT quote_ident(n.nspname)||'.'||quote_ident(c.relname)
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='provider_id'
            WHERE c.relkind IN ('r','p') AND NOT c.relispartition
              AND (n.nspname='gold' OR
                   (n.nspname='core' AND c.relname LIKE 'snapshot_%'))
            ORDER BY c.relname
        """)
            )
            .scalars()
            .all()
        )
        for table in retained:
            conn.execute(text(f"DELETE FROM {table} WHERE provider_id=:p"), {"p": PROVIDER})
        reset_source_factory_tables(conn, PROVIDER)
        conn.execute(text("DELETE FROM core.feed_endpoints WHERE provider_id=:p"), {"p": PROVIDER})
        conn.execute(text("DELETE FROM core.providers WHERE provider_id=:p"), {"p": PROVIDER})


def seed_static(conn):
    version = conn.execute(
        text("""
        WITH endpoint AS (
            INSERT INTO core.feed_endpoints(provider_id,endpoint_key,feed_kind,source_format)
            VALUES (:p,'static_schedule','static_schedule','gtfs_schedule_zip')
            RETURNING feed_endpoint_id
        ), run AS (
            INSERT INTO raw.ingestion_runs(provider_id,feed_endpoint_id,run_kind,status)
            SELECT :p,feed_endpoint_id,'static_schedule','succeeded' FROM endpoint
            RETURNING ingestion_run_id,feed_endpoint_id
        )
        INSERT INTO core.dataset_versions(provider_id,feed_endpoint_id,
            source_ingestion_run_id,dataset_kind,content_hash,is_current)
        SELECT :p,feed_endpoint_id,ingestion_run_id,'static_schedule',repeat('a',64),true FROM run
        RETURNING dataset_version_id
    """),
        {"p": PROVIDER},
    ).scalar_one()
    for statement in (
        "INSERT INTO silver.routes(dataset_version_id,provider_id,route_id,route_type,"
        "route_short_name) VALUES (:v,:p,'51',3,'51')",
        "INSERT INTO silver.stops(dataset_version_id,provider_id,stop_id,stop_name) "
        "VALUES (:v,:p,'S1','Stop 1'),(:v,:p,'S2','Stop 2')",
        "INSERT INTO silver.trips(dataset_version_id,provider_id,trip_id,route_id,service_id) "
        "VALUES (:v,:p,'T_REPLAY','51','WK')",
        "INSERT INTO silver.stop_times(dataset_version_id,provider_id,trip_id,stop_sequence,"
        "stop_id,arrival_time,departure_time) "
        "VALUES (:v,:p,'T_REPLAY',1,'S1','12:00:00','12:00:00'),"
        "(:v,:p,'T_REPLAY',2,'S2','12:08:00','12:08:00')",
    ):
        conn.execute(text(statement), {"p": PROVIDER, "v": version})


@dataclass
class HistoryScenario:
    engine: object
    settings: Settings
    storage: LocalSnapshotStorage
    captured: datetime
    registry: object
    snapshot_id: int | None = None
    receipt: object = None

    @property
    def day(self):
        return self.captured.astimezone(TZ).date()

    def capture(self, delay):
        message = gtfs_realtime_pb2.FeedMessage.FromString(
            _build_trip_update_bytes(captured_at=self.captured, delay_seconds=delay)
        )
        message.entity[0].trip_update.trip.start_date = self.day.strftime("%Y%m%d")
        message.entity[0].trip_update.stop_time_update[0].arrival.time = (
            int(datetime.combine(self.day, time(12, 8), TZ).timestamp()) + delay
        )
        body = message.SerializeToString()
        path = f"{PROVIDER}/trip.pb"
        archive = Path(self.settings.BRONZE_LOCAL_ROOT) / path
        archive.parent.mkdir(parents=True, exist_ok=True)
        archive.write_bytes(body)
        params = {
            "p": PROVIDER,
            "captured": self.captured,
            "path": path,
            "hash": hashlib.sha256(body).hexdigest(),
            "size": len(body),
        }
        with self.engine.begin() as conn:
            if self.snapshot_id is None:
                self.snapshot_id = conn.execute(
                    text("""
                    WITH endpoint AS (
                        INSERT INTO core.feed_endpoints
                            (provider_id,endpoint_key,feed_kind,source_format)
                        VALUES (:p,'trip_updates','trip_updates','gtfs_rt_trip_updates')
                        RETURNING feed_endpoint_id
                    ), run AS (
                        INSERT INTO raw.ingestion_runs(provider_id,feed_endpoint_id,run_kind,status)
                        SELECT :p,feed_endpoint_id,'trip_updates','succeeded' FROM endpoint
                        RETURNING ingestion_run_id,feed_endpoint_id
                    ), object AS (
                        INSERT INTO raw.ingestion_objects(provider_id,ingestion_run_id,object_kind,
                            storage_backend,storage_path,checksum_sha256,byte_size)
                        SELECT :p,ingestion_run_id,'realtime_feed','local',:path,:hash,:size
                        FROM run
                        RETURNING ingestion_object_id,ingestion_run_id
                    )
                    INSERT INTO raw.realtime_snapshot_index(provider_id,feed_endpoint_id,
                        ingestion_run_id,ingestion_object_id,feed_timestamp_utc,
                        captured_at_utc,entity_count)
                    SELECT :p,feed_endpoint_id,ingestion_run_id,ingestion_object_id,
                           :captured,:captured,1
                    FROM run JOIN object USING(ingestion_run_id) RETURNING realtime_snapshot_id
                """),
                    params,
                ).scalar_one()
            else:
                conn.execute(
                    text("""
                    UPDATE raw.ingestion_objects SET checksum_sha256=:hash,byte_size=:size
                    WHERE provider_id=:p AND storage_path=:path
                """),
                    params,
                )
                for table in (
                    "rt_trip_update_stop_times",
                    "rt_trip_updates",
                    "rt_entities",
                    "rt_feed_snapshots",
                ):
                    conn.execute(text(f"DELETE FROM silver.{table} WHERE provider_id=:p"), params)
        self.receipt = load_realtime_to_silver(
            PROVIDER,
            "trip_updates",
            snapshot_id=self.snapshot_id,
            settings=self.settings,
            registry=self.registry,
            engine=self.engine,
        )

    def project(self):
        return refresh_gold_snapshots(
            PROVIDER,
            expected_rows={self.snapshot_id: self.receipt.row_counts},
            settings=self.settings,
            registry=self.registry,
            engine=self.engine,
        )

    def repair(self):
        result = rollups.rebuild_warm_rollups(
            PROVIDER,
            engine=self.engine,
            settings=self.settings,
            from_date=self.day,
            to_date=self.day,
            kinds=list(delay_days.DAILY_DELAY_TABLES),
        )
        rollups.build_warm_rollups(PROVIDER, engine=self.engine, settings=self.settings)
        return result

    def publish(self):
        return publish.publish_snapshot(
            PROVIDER,
            tier="historic",
            engine=self.engine,
            storage=self.storage,
            settings=self.settings,
        )

    def dirty(self):
        with self.engine.connect() as conn:
            return delay_days.daily_delay_status(conn, PROVIDER)

    def state(self):
        with self.engine.connect() as conn:
            return {
                table: conn.execute(
                    text(
                        f"SELECT to_jsonb(t) FROM {table} t WHERE provider_id=:p "
                        "ORDER BY to_jsonb(t)::text"
                    ),
                    {"p": PROVIDER},
                )
                .scalars()
                .all()
                for table in (
                    "core.snapshot_publish_state",
                    "core.snapshot_historic_receipts",
                    "gold.warm_rollup_periods",
                )
            }

    def graph_hashes(self):
        hashes = {}

        def visit(key):
            if key in hashes:
                return
            body = Path(self.storage.full_key(key)).read_bytes()
            digest = hashlib.sha256(body).hexdigest()
            hashes[key] = digest
            if "/generations/" in key:
                assert key.split("/generations/", 1)[1].split("/", 1)[0] == digest

            def references(value):
                if isinstance(value, dict):
                    for field in ("path", "index_path"):
                        child = value.get(field)
                        if isinstance(child, str) and child.startswith("historic/"):
                            visit(child)
                            if value.get("sha256") is not None:
                                assert hashes[child] == value["sha256"]
                    for child in value.values():
                        references(child)
                elif isinstance(value, list):
                    for child in value:
                        references(child)

            references(json.loads(body))

        visit(ROOT_KEY)
        root = self.storage.get_json(ROOT_KEY)
        assert {family["family"] for family in root["families"]} == {
            "alerts",
            "receipts",
            "network",
            "lines",
            "stops",
            "hotspots",
            "repeat_offenders",
        }
        return hashes

    def receipt_hashes(self):
        receipts = self.state()["core.snapshot_historic_receipts"]
        assert receipts, "native publisher did not persist source receipts"
        return {
            f"{row['family']}:{row['entity_key']}:{month}": {
                name: receipt[name]
                for name in ("combined_source_sha256", "input_sha256", "scope_receipt_sha256")
            }
            for row in receipts
            for month, receipt in row["month_receipts"].items()
        }

    def network_day(self):
        root = self.storage.get_json(ROOT_KEY)
        family = next(item for item in root["families"] if item["family"] == "network")
        index = self.storage.get_json(family["index_path"])
        for ref in index["partitions"]:
            partition = self.storage.get_json(ref["path"])
            for day in partition["days"]:
                if day["date"] == self.day.isoformat():
                    return day
        raise AssertionError("published capture day missing")


@pytest.fixture
def history(real_db_engine, seed_provider, tmp_path):
    cleanup(real_db_engine)
    provider = SimpleNamespace(provider_id=PROVIDER, timezone=str(TZ), bounds=None)
    manifest = SimpleNamespace(
        provider=provider, realtime_feed=lambda key: SimpleNamespace(endpoint_key=key)
    )
    registry = SimpleNamespace(get_provider=lambda _: manifest)
    settings = Settings(
        _env_file=None,
        BRONZE_STORAGE_BACKEND="local",
        BRONZE_LOCAL_ROOT=str(tmp_path / "bronze"),
        SNAPSHOT_PUBLISH_CONCURRENCY=1,
        SNAPSHOT_PUBLIC_BASE_URL="https://data.example.test",
    )
    captured = datetime.combine(
        datetime.now(TZ).date() - timedelta(days=2), time(12), TZ
    ).astimezone(UTC)
    scenario = HistoryScenario(
        real_db_engine,
        settings,
        LocalSnapshotStorage(str(tmp_path / "published"), PROVIDER),
        captured,
        registry,
    )
    try:
        with real_db_engine.begin() as conn:
            seed_provider(conn, PROVIDER, display_name="Historic convergence")
            seed_static(conn)
        scenario.capture(60)
        build_gold_marts(PROVIDER, engine=real_db_engine, settings=settings, registry=registry)
        scenario.repair()
        yield scenario
    finally:
        cleanup(real_db_engine)
