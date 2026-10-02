from dataclasses import replace
from functools import partial
from pathlib import Path
from unittest.mock import MagicMock, Mock
from urllib.error import HTTPError

import pytest
from google.transit import gtfs_realtime_pb2

from transit_ops.ingestion import i3, realtime_gtfs, static_gtfs
from transit_ops.ingestion.common import DownloadedArtifact, finish_failed_capture
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings


@pytest.mark.parametrize("kind", ["static", "realtime", "i3", "service_alerts"])
@pytest.mark.parametrize("stage", ["download", "metadata"])
@pytest.mark.parametrize("recording_fails", [False, True])
def test_capture_preserves_original_error_and_cleans_resources(
    tmp_path, monkeypatch, caplog, kind, stage, recording_fails,
):
    settings = Settings(
        _env_file=None,
        STM_API_KEY="fixture-key",
        BRONZE_STORAGE_BACKEND="local",
        BRONZE_LOCAL_ROOT=str(tmp_path),
    )
    registry = ProviderRegistry.from_project_root(
        project_root=Path(__file__).resolve().parents[1], settings=settings,
    )
    if kind == "service_alerts":
        config = replace(
            i3.build_i3_ingestion_config(registry.get_provider("stm"), settings),
            endpoint_key="service_alerts",
            feed_kind="service_alerts",
            source_format="gtfs_rt_alerts",
        )
        monkeypatch.setattr(i3, "build_service_alerts_ingestion_config", lambda *args: config)
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.header.gtfs_realtime_version = "2.0"
    feed.header.timestamp = 1_788_588_000
    payload = b'{"alerts": []}' if kind == "i3" else feed.SerializeToString()
    temp_path = tmp_path / "download"
    if stage == "metadata":
        temp_path.write_bytes(payload)
    artifact = DownloadedArtifact(temp_path, len(payload), "a" * 64, 200, "https://fixture.test")
    original = (
        HTTPError("https://fixture.test", 503, "unavailable?token=fixture-secret", None, None)
        if stage == "download" else RuntimeError("metadata unavailable?token=fixture-secret")
    )
    download = Mock(side_effect=original) if stage == "download" else Mock(return_value=artifact)
    storage = Mock()
    storage.persist_temp_file.return_value = "memory://capture"
    result = MagicMock()
    result.scalar_one.return_value = 101
    result.scalar_one_or_none.return_value = 12
    result.mappings.return_value.one_or_none.return_value = None
    failures = []

    def execute(statement, params):
        sql = str(statement)
        if "INSERT INTO raw.ingestion_objects" in sql:
            raise original
        if "SET status = 'failed'" in sql:
            failures.append(params)
            if recording_fails:
                raise ConnectionError("recording unavailable?token=secondary-secret")
        return result

    engine = MagicMock()
    engine.begin.return_value.__enter__.return_value.execute.side_effect = execute
    args = dict(settings=settings, registry=registry, engine=engine)
    if kind == "static":
        monkeypatch.setattr(static_gtfs, "_download_to_tempfile", download)
        monkeypatch.setattr(static_gtfs, "get_bronze_storage", lambda *a, **kw: storage)
        capture = static_gtfs.ingest_static_feed
    elif kind == "realtime":
        monkeypatch.setattr(realtime_gtfs, "_download_to_tempfile", download)
        capture = partial(realtime_gtfs._capture_realtime_feed, endpoint_key="vehicle_positions")
        args["bronze_storage_resolver"] = lambda backend: storage
    else:
        monkeypatch.setattr(i3, "download_to_tempfile", download)
        capture = i3._capture_i3_alerts if kind == "i3" else i3._capture_service_alerts
        args["bronze_storage_resolver"] = lambda backend: storage

    with pytest.raises(type(original)) as caught:
        capture("stm", **args)

    assert caught.value is original
    assert not temp_path.exists()
    assert len(failures) == 1
    assert failures[0]["http_status_code"] == (503 if stage == "download" else 200)
    assert "fixture-secret" not in failures[0]["error_message"]
    assert "secondary-secret" not in caplog.text
    if stage == "metadata":
        storage.delete_object.assert_called_once_with(storage.persist_temp_file.call_args.args[1])
    else:
        storage.persist_temp_file.assert_not_called()
        storage.delete_object.assert_not_called()


def test_cleanup_attempts_survive_database_and_filesystem_failures(caplog):
    engine = Mock()
    engine.begin.side_effect = ConnectionError("database?token=connection-secret")
    temp_path = Mock(spec=Path)
    temp_path.unlink.side_effect = PermissionError("filesystem?token=filesystem-secret")
    storage = Mock()
    storage.delete_object.side_effect = RuntimeError("storage?token=storage-secret")
    artifact = DownloadedArtifact(temp_path, 1, "a" * 64, 200, "https://fixture.test")

    finish_failed_capture(
        engine=engine,
        ingestion_run_id=101,
        error=RuntimeError("original failure"),
        artifact=artifact,
        bronze_storage=storage,
        orphan_storage_path="capture.pb",
    )

    temp_path.unlink.assert_called_once_with(missing_ok=True)
    storage.delete_object.assert_called_once_with("capture.pb")
    assert len(caplog.records) == 3
    assert all("101" in record.message for record in caplog.records)
    assert "capture.pb" in caplog.text
    assert "secret" not in caplog.text
