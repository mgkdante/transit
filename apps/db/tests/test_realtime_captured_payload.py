from __future__ import annotations

import hashlib

import pytest
from test_realtime_silver import (
    FakeBronzeStorage,
    FakeEngine,
    FakeRegistry,
    FakeResult,
    RecordingConnection,
    SnapshotLookupConnection,
    _build_manifest,
    _build_snapshot_row,
    _build_trip_updates_bytes,
    _build_vehicle_positions_bytes,
    _insert_call_sql,
)

from transit_ops import orchestration
from transit_ops.ingestion import realtime_gtfs as capture
from transit_ops.ingestion.common import DownloadedArtifact
from transit_ops.settings import Settings
from transit_ops.silver import realtime_gtfs as silver


class CaptureConnection(RecordingConnection):
    def __init__(self, endpoint_key):
        super().__init__()
        self.row = {"endpoint_key": endpoint_key}

    def execute(self, statement, params=None):
        sql = str(statement)
        if "FROM raw.realtime_snapshot_index AS rsi" in sql:
            assert params["snapshot_id"] == self.row["realtime_snapshot_id"]
            return FakeResult(mapping_value=self.row)
        for column, value in (
            ("ingestion_run_id", 101),
            ("ingestion_object_id", 202),
            ("realtime_snapshot_id", 303),
        ):
            if f"RETURNING {column}" in sql:
                self.calls.append((sql, params))
                self.row.update(params)
                self.row[column] = value
                return FakeResult(scalar_value=value)
        if "SELECT feed_endpoint_id" in sql:
            return FakeResult(scalar_value=12)
        return super().execute(statement, params)


class CapturedStorage(FakeBronzeStorage):
    def __init__(self, payload):
        super().__init__(payload)
        self.uploaded = []

    def persist_temp_file(self, temp_path, storage_path):
        self.uploaded.append((storage_path, temp_path.read_bytes()))
        temp_path.unlink()
        return self.describe_location(storage_path)


@pytest.mark.parametrize("endpoint_key", ["trip_updates", "vehicle_positions"])
def test_worker_normalizes_just_archived_capture_without_an_archive_get(
    tmp_path,
    monkeypatch,
    endpoint_key,
):
    payload = (
        _build_trip_updates_bytes()
        if endpoint_key == "trip_updates"
        else _build_vehicle_positions_bytes()
    )
    path = tmp_path / "capture.pb"
    path.write_bytes(payload)
    artifact = DownloadedArtifact(
        path,
        len(payload),
        hashlib.sha256(payload).hexdigest(),
        200,
        "https://example.com/rt.pb",
    )
    monkeypatch.setattr(capture, "_download_to_tempfile", lambda *args: artifact)
    connection = CaptureConnection(endpoint_key)
    storage = CapturedStorage(payload)
    result = orchestration._capture_and_load_endpoint(
        "stm",
        endpoint_key,
        settings=Settings(_env_file=None, BRONZE_STORAGE_BACKEND="s3", STM_API_KEY="test"),
        registry=FakeRegistry(_build_manifest()),
        engine=FakeEngine(connection, connection),
        bronze_storage_resolver=lambda backend: storage,
    )
    assert result.status == "succeeded"
    assert storage.uploaded == [(result.capture_result["storage_path"], payload)]
    assert storage.read_calls == []
    assert result.silver_load_result.source_ingestion_object_id == 202
    assert result.silver_load_result.realtime_snapshot_id == 303
    assert _insert_call_sql(connection)
    assert "payload" not in result.capture_result


@pytest.mark.parametrize("fault", [None, "checksum", "byte size", "snapshot ID"])
def test_immediate_payload_is_verified_against_selected_capture_before_silver_writes(
    tmp_path,
    fault,
):
    payload = _build_trip_updates_bytes()
    path = tmp_path / "capture.pb"
    path.write_bytes(payload)
    row = _build_snapshot_row(path, endpoint_key="trip_updates", realtime_snapshot_id=77)
    connection = RecordingConnection()
    storage = FakeBronzeStorage(payload)
    supplied = None
    if fault == "checksum":
        supplied = bytes([payload[0] ^ 1]) + payload[1:]
    elif fault == "byte size":
        supplied = payload[:-1]
    elif fault == "snapshot ID":
        supplied = payload
    arguments = dict(
        snapshot_id=None if fault == "snapshot ID" else 77,
        settings=Settings(_env_file=None),
        registry=FakeRegistry(_build_manifest()),
        engine=FakeEngine(SnapshotLookupConnection(row), connection),
        bronze_storage_resolver=lambda backend: storage,
    )
    if fault is None:
        result = silver._load_realtime_to_silver("stm", "trip_updates", **arguments)
        assert result.realtime_snapshot_id == 77
        assert storage.read_calls == [row["storage_path"]]
    else:
        with pytest.raises(ValueError, match=fault):
            silver._load_realtime_to_silver(
                "stm",
                "trip_updates",
                captured_payload=supplied,
                **arguments,
            )
        assert storage.read_calls == []
        assert _insert_call_sql(connection) == []
