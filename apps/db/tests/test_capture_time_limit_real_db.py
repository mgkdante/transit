import hashlib
from io import BytesIO
from types import SimpleNamespace

import pytest
from google.transit import gtfs_realtime_pb2
from realtime_replay_fixtures import PROVIDER
from realtime_replay_fixtures import bronze_root as bronze_root
from realtime_replay_fixtures import engine as engine
from realtime_replay_fixtures import settings as settings
from sqlalchemy import text

from transit_ops.ingestion import common, gis, i3, realtime_gtfs, static_gtfs
from transit_ops.ingestion.storage import LocalBronzeStorage


def _config(engine, seed_provider, endpoint):
    source_format = "gtfs_rt_trip_updates" if endpoint == "trip_updates" else "api_i3_json"
    with engine.begin() as connection:
        seed_provider(connection, PROVIDER, display_name="Capture deadline test")
        connection.execute(
            text(
                "INSERT INTO core.feed_endpoints "
                "(provider_id, endpoint_key, feed_kind, source_format) VALUES (:p, :e, :e, :f)"
            ),
            {"p": PROVIDER, "e": endpoint, "f": source_format},
        )
    return SimpleNamespace(
        provider_id=PROVIDER,
        endpoint_key=endpoint,
        feed_kind=endpoint,
        source_format=source_format,
        source_url="https://example.test/feed",
        request_url="https://example.test/feed",
        request_headers={},
        storage_backend="local",
    )


def _replace_downloads(monkeypatch, config, root):
    message = gtfs_realtime_pb2.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    payload = (
        message.SerializeToString() if config.endpoint_key == "trip_updates" else b'{"alerts": []}'
    )
    downloads = []

    def download(*args, **kwargs):
        path = root / "download.tmp"
        path.write_bytes(payload)
        downloads.append(path)
        return common.DownloadedArtifact(
            path, len(payload), hashlib.sha256(payload).hexdigest(), 200, config.source_url
        )

    monkeypatch.setattr(realtime_gtfs, "_download_to_tempfile", download)
    monkeypatch.setattr(realtime_gtfs, "build_realtime_ingestion_config", lambda *a: config)
    monkeypatch.setattr(i3, "download_to_tempfile", download)
    return downloads


def _storage(engine, root, store):
    local = LocalBronzeStorage(root)

    def persist(path, key):
        location = local.persist_temp_file(path, key)
        store.keys.append(key)
        if store.mutation:
            with engine.begin() as connection:
                connection.execute(
                    text(
                        "UPDATE raw.ingestion_runs SET " + store.mutation + " WHERE provider_id=:p"
                    ),
                    {"p": PROVIDER},
                )
                store.closed = dict(
                    connection.execute(
                        text(
                            "SELECT status, error_message, completed_at_utc, http_status_code "
                            "FROM raw.ingestion_runs WHERE provider_id=:p"
                        ),
                        {"p": PROVIDER},
                    )
                    .mappings()
                    .one()
                )
        return location

    return SimpleNamespace(persist_temp_file=persist, delete_object=local.delete_object)


def _capture(config, settings, engine, storage):
    if config.endpoint_key == "trip_updates":
        return realtime_gtfs._capture_realtime_feed(
            PROVIDER,
            config.endpoint_key,
            settings=settings,
            engine=engine,
            registry=SimpleNamespace(get_provider=lambda p: None),
            bronze_storage_resolver=lambda backend: storage,
        )[0]
    return i3._run_alert_capture(
        config,
        settings=settings,
        engine=engine,
        extract_metadata=lambda payload, provider: i3.extract_i3_metadata(
            payload, provider_id=provider
        ),
        build_storage_path=i3.build_i3_object_storage_path,
        default_filename="alerts.json",
        missing_endpoint_message="Missing test endpoint",
        bronze_storage_resolver=lambda backend: storage,
    )


@pytest.fixture(params=["trip_updates", "i3_alerts"])
def capture_case(request, engine, settings, bronze_root, seed_provider, monkeypatch):
    config = _config(engine, seed_provider, request.param)
    downloads = _replace_downloads(monkeypatch, config, bronze_root)
    store = SimpleNamespace(keys=[], closed=None, mutation=None)
    storage = _storage(engine, bronze_root, store)
    return SimpleNamespace(
        capture=lambda: _capture(config, settings, engine, storage),
        store=store,
        downloads=downloads,
        root=bronze_root,
    )


def _state(engine):
    with engine.connect() as connection:
        run = dict(
            connection.execute(
                text(
                    "SELECT ingestion_run_id, status, error_message, "
                    "completed_at_utc, http_status_code "
                    "FROM raw.ingestion_runs WHERE provider_id=:p"
                ),
                {"p": PROVIDER},
            )
            .mappings()
            .one()
        )
        rows = {
            table: connection.execute(
                text(f"SELECT ingestion_run_id FROM raw.{table} WHERE ingestion_run_id=:id"),
                {"id": run["ingestion_run_id"]},
            )
            .scalars()
            .all()
            for table in ("ingestion_objects", "realtime_snapshot_index", "i3_alert_snapshots")
        }
    return run, rows


def _assert_discarded(case, engine):
    run, rows = _state(engine)
    assert all(not ids for ids in rows.values())
    assert all(not (case.root / key).exists() for key in case.store.keys)
    assert case.downloads and all(not path.exists() for path in case.downloads)
    return run


def test_download_past_the_limit_fails_the_run(capture_case, engine, monkeypatch):
    monkeypatch.setattr(common, "CAPTURE_TOTAL_TIMEOUT_SECONDS", 0)
    with pytest.raises(common.CaptureTimeLimitExceeded):
        capture_case.capture()
    run = _assert_discarded(capture_case, engine)
    assert run["status"] == "failed"
    assert run["completed_at_utc"] is not None
    assert run["error_message"] == "Capture exceeded its total time limit of 0 s."
    assert capture_case.store.keys == []


def _closed_capture(case):
    case.store.mutation = (
        "status='failed', error_message='closed_unfinished', "
        "completed_at_utc=now(), http_status_code=409"
    )
    with pytest.raises(common.CaptureRunRefused):
        case.capture()


def test_final_transaction_refuses_a_run_that_was_closed(capture_case, engine):
    _closed_capture(capture_case)
    _assert_discarded(capture_case, engine)


def test_refused_capture_removes_its_uploaded_object(capture_case, engine):
    _closed_capture(capture_case)
    assert capture_case.store.keys
    _assert_discarded(capture_case, engine)


def test_failure_path_keeps_the_closed_unfinished_error(capture_case, engine):
    _closed_capture(capture_case)
    run = _assert_discarded(capture_case, engine)
    assert {key: run[key] for key in capture_case.store.closed} == capture_case.store.closed


def test_run_past_its_limit_by_the_database_clock_is_refused(capture_case, engine):
    capture_case.store.mutation = "started_at_utc=started_at_utc - interval '301 seconds'"
    with pytest.raises(common.CaptureTimeLimitExceeded):
        capture_case.capture()
    run = _assert_discarded(capture_case, engine)
    assert run["status"] == "failed"
    assert run["error_message"] == "Capture exceeded its total time limit of 300 s."
    assert run["completed_at_utc"] is not None
    assert capture_case.store.keys


@pytest.mark.parametrize("capture_case", ["trip_updates"], indirect=True)
def test_capture_inside_its_limit_records_its_result(capture_case, engine):
    result = capture_case.capture()
    run, rows = _state(engine)
    assert run["status"] == "succeeded"
    assert rows["ingestion_objects"] == [result.ingestion_run_id]
    assert rows["realtime_snapshot_index"] == [result.ingestion_run_id]
    assert (capture_case.root / result.storage_path).exists()


def test_download_stops_after_the_chunk_that_passes_its_deadline(tmp_path, monkeypatch):
    chunks = [b"first", b"second", b"third"]
    reads = []

    class Response(BytesIO):
        def read(self, size=-1):
            reads.append(True)
            return chunks.pop(0) if chunks else b""

    response = Response()
    monkeypatch.setattr(common, "urlopen", lambda *a, **kw: response)
    with pytest.raises(common.CaptureTimeLimitExceeded):
        common.download_to_tempfile(
            source_url="https://example.test/feed",
            temp_dir=tmp_path,
            default_filename="feed",
            deadline=0,
        )
    assert reads == [True]
    assert response.closed
    assert list(tmp_path.iterdir()) == []
    chunks[:] = [b"first", b"second", b"third"]
    response = Response()
    artifact = common.download_to_tempfile(
        source_url="https://example.test/feed",
        temp_dir=tmp_path,
        default_filename="feed",
        deadline=None,
    )
    assert artifact.byte_size == len(b"firstsecondthird")
    assert artifact.checksum_sha256 == hashlib.sha256(b"firstsecondthird").hexdigest()
    assert artifact.temp_path.read_bytes() == b"firstsecondthird"
    assert response.closed


def test_static_download_has_no_total_limit(tmp_path, monkeypatch):
    monkeypatch.setattr(common, "CAPTURE_TOTAL_TIMEOUT_SECONDS", 0)
    monkeypatch.setattr(common, "urlopen", lambda *a, **kw: BytesIO(b"archive"))
    for module in (static_gtfs, gis):
        artifact = module._download_to_tempfile("https://example.test/feed.zip", tmp_path)
        assert artifact.temp_path.read_bytes() == b"archive"
        artifact.temp_path.unlink()
    with pytest.raises(common.CaptureTimeLimitExceeded):
        realtime_gtfs._download_to_tempfile(
            SimpleNamespace(
                request_url="https://example.test/feed.pb", request_headers={}, endpoint_key="trips"
            ),
            tmp_path,
        )
    assert list(tmp_path.iterdir()) == []
