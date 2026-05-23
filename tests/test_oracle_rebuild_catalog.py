from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from google.transit import gtfs_realtime_pb2

from transit_ops.ingestion.storage import BronzeObjectInfo
from transit_ops.providers import ProviderRegistry
from transit_ops.rebuild.catalog import (
    month_bounds,
    rebuild_raw_catalog,
    reset_rebuild_tables,
    select_rebuild_bronze_objects,
)
from transit_ops.settings import Settings


class FakeListStorage:
    def __init__(
        self,
        keys: list[str],
        *,
        byte_size_by_key: dict[str, int] | None = None,
        payloads_by_key: dict[str, bytes] | None = None,
        storage_backend: str = "local",
    ) -> None:
        self.keys = keys
        self.byte_size_by_key = byte_size_by_key or {}
        self.payloads_by_key = payloads_by_key or {}
        self.storage_backend = storage_backend
        self.listed_prefixes: list[str] = []
        self.read_paths: list[str] = []

    def list_objects(self, prefix: str) -> list[BronzeObjectInfo]:
        self.listed_prefixes.append(prefix)
        return [
            BronzeObjectInfo(
                storage_path=key,
                byte_size=self.byte_size_by_key.get(key),
                last_modified=None,
            )
            for key in self.keys
            if key.startswith(prefix)
        ]

    def read_bytes(self, storage_path: str) -> bytes:
        self.read_paths.append(storage_path)
        return self.payloads_by_key[storage_path]


class ScalarResult:
    def __init__(self, value: int | None) -> None:
        self.value = value

    def scalar_one(self) -> int:
        if self.value is None:
            raise AssertionError("Expected scalar value")
        return self.value

    def scalar_one_or_none(self) -> int | None:
        return self.value


class RecordingConnection:
    def __init__(self) -> None:
        self.statements: list[str] = []
        self.params: list[dict[str, Any]] = []
        self.next_ingestion_run_id = 100
        self.next_ingestion_object_id = 200
        self.next_realtime_snapshot_id = 300
        self.feed_endpoint_ids = {
            ("stm", "static_schedule"): 10,
            ("stm", "trip_updates"): 11,
            ("stm", "vehicle_positions"): 12,
        }

    def execute(self, statement: object, params: dict[str, Any] | None = None) -> ScalarResult:
        sql = str(statement)
        self.statements.append(sql)
        self.params.append(params or {})

        if "SELECT feed_endpoint_id" in sql:
            key = (self.params[-1]["provider_id"], self.params[-1]["endpoint_key"])
            return ScalarResult(self.feed_endpoint_ids.get(key))
        if "RETURNING ingestion_run_id" in sql:
            value = self.next_ingestion_run_id
            self.next_ingestion_run_id += 1
            return ScalarResult(value)
        if "RETURNING ingestion_object_id" in sql:
            value = self.next_ingestion_object_id
            self.next_ingestion_object_id += 1
            return ScalarResult(value)
        if "RETURNING realtime_snapshot_id" in sql:
            value = self.next_realtime_snapshot_id
            self.next_realtime_snapshot_id += 1
            return ScalarResult(value)
        return ScalarResult(None)


@dataclass(frozen=True)
class FakeFeed:
    endpoint_key: str
    source_format: str
    source_url: str

    def resolved_source_url(self, settings: object | None = None) -> str:
        return self.source_url


class FakeManifest:
    def static_feed(self) -> FakeFeed:
        return FakeFeed(
            endpoint_key="static_schedule",
            source_format="gtfs_schedule_zip",
            source_url="https://example.test/gtfs.zip",
        )

    def realtime_feed(self, endpoint_key: str) -> FakeFeed:
        return FakeFeed(
            endpoint_key=endpoint_key,
            source_format=f"gtfs_rt_{endpoint_key}",
            source_url=f"https://example.test/{endpoint_key}.pb",
        )


class FakeRegistry:
    def get_provider(self, provider_id: str) -> FakeManifest:
        assert provider_id == "stm"
        return FakeManifest()


def make_gtfs_rt_payload(*, timestamp: int, entity_count: int) -> bytes:
    message = gtfs_realtime_pb2.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    message.header.timestamp = timestamp
    for index in range(entity_count):
        message.entity.add().id = str(index)
    return message.SerializeToString()


def test_select_rebuild_bronze_objects_keeps_may_window_only() -> None:
    storage = FakeListStorage(
        [
            "stm/static_schedule/ingested_at_utc=2026-04-30/20260430T120000000000Z__abcdef123456__gtfs.zip",
            "stm/static_schedule/ingested_at_utc=2026-05-02/20260502T120000000000Z__abcdef123457__gtfs.zip",
            "stm/trip_updates/captured_at_utc=2026-05-02/20260502T120000000000Z__abcdef123458__trip_updates.pb",
            "stm/trip_updates/captured_at_utc=2026-06-01/20260601T120000000000Z__abcdef123459__trip_updates.pb",
        ]
    )

    selection = select_rebuild_bronze_objects(storage, provider_id="stm", month="2026-05")

    assert selection.static_archive.storage_path.endswith("abcdef123457__gtfs.zip")
    assert [item.endpoint_key for item in selection.realtime_snapshots] == ["trip_updates"]


def test_select_rebuild_bronze_objects_uses_newest_may_static_archive() -> None:
    storage = FakeListStorage(
        [
            "stm/static_schedule/ingested_at_utc=2026-05-01/20260501T090000000000Z__aaaaaaaaaaaa__gtfs.zip",
            "stm/static_schedule/ingested_at_utc=2026-05-31/20260531T230000000000Z__bbbbbbbbbbbb__gtfs.zip",
            "stm/static_schedule/ingested_at_utc=2026-05-15/20260515T120000000000Z__cccccccccccc__gtfs.zip",
        ]
    )

    selection = select_rebuild_bronze_objects(storage, provider_id="stm", month="2026-05")

    assert selection.static_archive.storage_path.endswith("bbbbbbbbbbbb__gtfs.zip")


def test_select_rebuild_bronze_objects_tie_breaks_static_archive_by_storage_path() -> None:
    lower_key = (
        "stm/static_schedule/ingested_at_utc=2026-05-31/"
        "20260531T230000000000Z__aaaaaaaaaaaa__gtfs.zip"
    )
    higher_key = (
        "stm/static_schedule/ingested_at_utc=2026-05-31/"
        "20260531T230000000000Z__bbbbbbbbbbbb__gtfs.zip"
    )
    storage = FakeListStorage([lower_key, higher_key])

    selection = select_rebuild_bronze_objects(storage, provider_id="stm", month="2026-05")

    assert selection.static_archive.storage_path == higher_key


def test_select_rebuild_bronze_objects_orders_all_may_realtime_snapshots_by_timestamp() -> None:
    storage = FakeListStorage(
        [
            "stm/static_schedule/ingested_at_utc=2026-05-01/20260501T000000000000Z__aaaaaaaaaaaa__gtfs.zip",
            "stm/vehicle_positions/captured_at_utc=2026-05-01/20260501T001000000000Z__bbbbbbbbbbbb__vehicle_positions.pb",
            "stm/trip_updates/captured_at_utc=2026-05-01/20260501T000500000000Z__cccccccccccc__trip_updates.pb",
            "stm/trip_updates/captured_at_utc=2026-05-01/20260501T002000000000Z__dddddddddddd__trip_updates.pb",
        ]
    )

    selection = select_rebuild_bronze_objects(storage, provider_id="stm", month="2026-05")

    assert [item.endpoint_key for item in selection.realtime_snapshots] == [
        "trip_updates",
        "vehicle_positions",
        "trip_updates",
    ]
    assert [item.observed_at_utc.minute for item in selection.realtime_snapshots] == [5, 10, 20]


def test_select_rebuild_bronze_objects_requires_may_static_archive() -> None:
    storage = FakeListStorage(
        [
            "stm/static_schedule/ingested_at_utc=2026-04-30/20260430T120000000000Z__abcdef123456__gtfs.zip",
            "stm/trip_updates/captured_at_utc=2026-05-02/20260502T120000000000Z__abcdef123458__trip_updates.pb",
        ]
    )

    with pytest.raises(ValueError, match="No static_schedule Bronze archive found"):
        select_rebuild_bronze_objects(storage, provider_id="stm", month="2026-05")


def test_select_rebuild_bronze_objects_ignores_malformed_keys() -> None:
    storage = FakeListStorage(
        [
            "stm/static_schedule/malformed.zip",
            "stm/trip_updates/captured_at_utc=2026-05-02/not-a-timestamp__abcdef123458__trip_updates.pb",
            "stm/static_schedule/ingested_at_utc=2026-05-02/20260502T120000000000Z__abcdef123457__gtfs.zip",
        ]
    )

    selection = select_rebuild_bronze_objects(storage, provider_id="stm", month="2026-05")

    assert selection.static_archive.storage_path.endswith("abcdef123457__gtfs.zip")
    assert selection.realtime_snapshots == []
    assert sorted(selection.skipped_unknown_keys) == sorted(storage.keys[:2])


def test_month_bounds_rejects_malformed_month() -> None:
    with pytest.raises(ValueError, match="YYYY-MM"):
        month_bounds("2026-5")


def test_reset_rebuild_tables_truncates_raw_silver_gold_but_not_core_provider_tables() -> None:
    conn = RecordingConnection()

    reset_rebuild_tables(conn)

    sql = conn.statements[0]
    assert "TRUNCATE TABLE" in sql
    assert "raw.ingestion_runs" in sql
    assert "core.dataset_versions" in sql
    assert "core.providers" not in sql
    assert "core.feed_endpoints" not in sql


def test_rebuild_raw_catalog_inserts_static_run_and_object_rows() -> None:
    static_key = (
        "stm/static_schedule/ingested_at_utc=2026-05-02/"
        "20260502T120000000000Z__abcdef123457__gtfs.zip"
    )
    static_payload = b"fake static zip bytes"
    storage = FakeListStorage(
        [static_key],
        byte_size_by_key={static_key: 1234},
        payloads_by_key={static_key: static_payload},
    )
    selection = select_rebuild_bronze_objects(storage, provider_id="stm", month="2026-05")
    conn = RecordingConnection()

    result = rebuild_raw_catalog(
        conn,
        provider_id="stm",
        selection=selection,
        settings=object(),
        registry=FakeRegistry(),
        storage=storage,
    )

    run_params = [
        params for sql, params in zip(conn.statements, conn.params, strict=True)
        if "INSERT INTO raw.ingestion_runs" in sql
    ]
    object_params = [
        params for sql, params in zip(conn.statements, conn.params, strict=True)
        if "INSERT INTO raw.ingestion_objects" in sql
    ]
    assert run_params == [
        {
            "provider_id": "stm",
            "feed_endpoint_id": 10,
            "run_kind": "static_schedule",
            "requested_at_utc": datetime(2026, 5, 2, 12, 0, tzinfo=UTC),
            "started_at_utc": datetime(2026, 5, 2, 12, 0, tzinfo=UTC),
        }
    ]
    assert object_params[0]["object_kind"] == "gtfs_schedule_zip"
    assert object_params[0]["storage_path"] == static_key
    assert object_params[0]["source_url"] == "https://example.test/gtfs.zip"
    assert object_params[0]["checksum_sha256"] == hashlib.sha256(static_payload).hexdigest()
    assert object_params[0]["byte_size"] == 1234
    assert result.static_ingestion_run_id == 100
    assert result.static_ingestion_object_id == 200


def test_rebuild_raw_catalog_inserts_realtime_rows_with_extracted_metadata() -> None:
    static_key = (
        "stm/static_schedule/ingested_at_utc=2026-05-02/"
        "20260502T120000000000Z__abcdef123457__gtfs.zip"
    )
    realtime_key = (
        "stm/trip_updates/captured_at_utc=2026-05-02/"
        "20260502T121500000000Z__abcdef123458__trip_updates.pb"
    )
    payload = make_gtfs_rt_payload(timestamp=1777724010, entity_count=3)
    static_payload = b"fake static zip bytes"
    storage = FakeListStorage(
        [static_key, realtime_key],
        byte_size_by_key={static_key: 1234, realtime_key: len(payload)},
        payloads_by_key={static_key: static_payload, realtime_key: payload},
    )
    selection = select_rebuild_bronze_objects(storage, provider_id="stm", month="2026-05")
    conn = RecordingConnection()

    result = rebuild_raw_catalog(
        conn,
        provider_id="stm",
        selection=selection,
        settings=object(),
        registry=FakeRegistry(),
        storage=storage,
    )

    realtime_index_params = [
        params for sql, params in zip(conn.statements, conn.params, strict=True)
        if "INSERT INTO raw.realtime_snapshot_index" in sql
    ]
    succeeded_params = [
        params for sql, params in zip(conn.statements, conn.params, strict=True)
        if "UPDATE raw.ingestion_runs" in sql and params["ingestion_run_id"] == 101
    ]
    assert storage.read_paths == [static_key, realtime_key]
    assert realtime_index_params == [
        {
            "ingestion_run_id": 101,
            "ingestion_object_id": 201,
            "provider_id": "stm",
            "feed_endpoint_id": 11,
            "feed_timestamp_utc": datetime.fromtimestamp(1777724010, tz=UTC),
            "entity_count": 3,
            "captured_at_utc": datetime(2026, 5, 2, 12, 15, tzinfo=UTC),
        }
    ]
    assert succeeded_params[0]["entity_count"] == 3
    assert succeeded_params[0]["feed_timestamp_utc"] == datetime.fromtimestamp(
        1777724010,
        tz=UTC,
    )
    assert result.realtime_snapshot_ids == [300]


def test_rebuild_raw_catalog_stores_full_sha256_for_static_and_realtime_objects() -> None:
    static_key = (
        "stm/static_schedule/ingested_at_utc=2026-05-02/"
        "20260502T120000000000Z__abcdef123457__gtfs.zip"
    )
    realtime_key = (
        "stm/trip_updates/captured_at_utc=2026-05-02/"
        "20260502T121500000000Z__abcdef123458__trip_updates.pb"
    )
    static_payload = b"fake static zip bytes"
    realtime_payload = make_gtfs_rt_payload(timestamp=1777724010, entity_count=3)
    storage = FakeListStorage(
        [static_key, realtime_key],
        byte_size_by_key={static_key: len(static_payload), realtime_key: len(realtime_payload)},
        payloads_by_key={static_key: static_payload, realtime_key: realtime_payload},
    )
    selection = select_rebuild_bronze_objects(storage, provider_id="stm", month="2026-05")
    conn = RecordingConnection()

    rebuild_raw_catalog(
        conn,
        provider_id="stm",
        selection=selection,
        settings=object(),
        registry=FakeRegistry(),
        storage=storage,
    )

    object_params = [
        params for sql, params in zip(conn.statements, conn.params, strict=True)
        if "INSERT INTO raw.ingestion_objects" in sql
    ]
    assert [params["checksum_sha256"] for params in object_params] == [
        hashlib.sha256(static_payload).hexdigest(),
        hashlib.sha256(realtime_payload).hexdigest(),
    ]
    assert all(len(params["checksum_sha256"]) == 64 for params in object_params)
    assert storage.read_paths == [static_key, realtime_key]


def test_rebuild_raw_catalog_uses_real_stm_manifest_strings() -> None:
    static_key = (
        "stm/static_schedule/ingested_at_utc=2026-05-02/"
        "20260502T120000000000Z__abcdef123457__gtfs.zip"
    )
    realtime_key = (
        "stm/vehicle_positions/captured_at_utc=2026-05-02/"
        "20260502T121500000000Z__abcdef123458__vehicle_positions.pb"
    )
    static_payload = b"fake static zip bytes"
    realtime_payload = make_gtfs_rt_payload(timestamp=1777724010, entity_count=1)
    storage = FakeListStorage(
        [static_key, realtime_key],
        byte_size_by_key={static_key: len(static_payload), realtime_key: len(realtime_payload)},
        payloads_by_key={static_key: static_payload, realtime_key: realtime_payload},
    )
    selection = select_rebuild_bronze_objects(storage, provider_id="stm", month="2026-05")
    registry = ProviderRegistry.from_project_root(
        Path(__file__).resolve().parents[1],
        settings=Settings(_env_file=None),
    )
    conn = RecordingConnection()

    rebuild_raw_catalog(
        conn,
        provider_id="stm",
        selection=selection,
        settings=object(),
        registry=registry,
        storage=storage,
    )

    object_params = [
        params for sql, params in zip(conn.statements, conn.params, strict=True)
        if "INSERT INTO raw.ingestion_objects" in sql
    ]
    assert object_params[0]["object_kind"] == "gtfs_schedule_zip"
    assert object_params[0]["source_url"] == "https://www.stm.info/sites/default/files/gtfs/gtfs_stm.zip"
    assert object_params[1]["object_kind"] == "gtfs_rt_vehicle_positions"
    assert object_params[1]["source_url"] == (
        "https://api.stm.info/pub/od/gtfs-rt/ic/v2/vehiclePositions"
    )


def test_raw_catalog_result_display_dict_is_json_friendly() -> None:
    static_key = (
        "stm/static_schedule/ingested_at_utc=2026-05-02/"
        "20260502T120000000000Z__abcdef123457__gtfs.zip"
    )
    realtime_key = (
        "stm/vehicle_positions/captured_at_utc=2026-05-02/"
        "20260502T121500000000Z__abcdef123458__vehicle_positions.pb"
    )
    payload = make_gtfs_rt_payload(timestamp=1777724010, entity_count=1)
    static_payload = b"fake static zip bytes"
    storage = FakeListStorage(
        [static_key, realtime_key],
        byte_size_by_key={static_key: 1234, realtime_key: len(payload)},
        payloads_by_key={static_key: static_payload, realtime_key: payload},
    )
    selection = select_rebuild_bronze_objects(storage, provider_id="stm", month="2026-05")

    result = rebuild_raw_catalog(
        RecordingConnection(),
        provider_id="stm",
        selection=selection,
        settings=object(),
        registry=FakeRegistry(),
        storage=storage,
    )

    assert result.display_dict() == {
        "provider_id": "stm",
        "static_selected_count": 1,
        "realtime_selected_count": 1,
        "static_ingestion_run_id": 100,
        "static_ingestion_object_id": 200,
        "realtime_ingestion_run_ids": [101],
        "realtime_ingestion_object_ids": [201],
        "realtime_snapshot_ids": [300],
    }
