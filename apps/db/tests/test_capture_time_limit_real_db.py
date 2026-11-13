import hashlib
from io import BytesIO
from types import SimpleNamespace

import pytest
from google.transit import gtfs_realtime_pb2
from realtime_replay_fixtures import PROVIDER
from realtime_replay_fixtures import bronze_root as bronze_root
from realtime_replay_fixtures import engine as engine
from realtime_replay_fixtures import settings as settings
from sqlalchemy import event, text

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
    local = LocalBronzeStorage("local", root)

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
    case = SimpleNamespace(
        capture=lambda: _capture(config, settings, engine, storage),
        store=store,
        downloads=downloads,
        root=bronze_root,
    )
    try:
        yield case
    finally:
        with engine.begin() as connection:
            connection.execute(
                text("DELETE FROM raw.i3_alert_snapshots WHERE provider_id=:p"), {"p": PROVIDER}
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


def _assert_discarded(case, engine, *, uploaded=True):
    run, rows = _state(engine)
    assert all(not ids for ids in rows.values())
    if uploaded:
        assert case.store.keys
        assert all(not (case.root / key).exists() for key in case.store.keys)
    else:
        assert case.store.keys == []
    assert case.downloads and all(not path.exists() for path in case.downloads)
    return run


def test_download_past_the_limit_fails_the_run(capture_case, engine, monkeypatch):
    monkeypatch.setattr(common, "CAPTURE_TOTAL_TIMEOUT_SECONDS", 0)
    with pytest.raises(common.CaptureTimeLimitExceeded):
        capture_case.capture()
    run = _assert_discarded(capture_case, engine, uploaded=False)
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
    timeouts = []
    monkeypatch.setattr(common.time, "monotonic", lambda: 2)

    class Response(BytesIO):
        def read(self, size=-1):
            reads.append("read")
            return chunks.pop(0) if chunks else b""

        def read1(self, size=-1):
            reads.append("read1")
            return chunks.pop(0) if chunks else b""

    response = Response()

    def open_response(*args, **kwargs):
        timeouts.append(kwargs["timeout"])
        return response

    monkeypatch.setattr(common, "urlopen", open_response)
    with pytest.raises(common.CaptureTimeLimitExceeded):
        common.download_to_tempfile(
            source_url="https://example.test/feed",
            temp_dir=tmp_path,
            default_filename="feed",
            deadline=0,
        )
    assert reads == ["read1"]
    assert timeouts == [1]
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
    assert reads == ["read1", "read", "read", "read", "read"]
    assert timeouts == [1, 120]
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


@pytest.mark.parametrize("capture_case", ["trip_updates", "i3_alerts"], indirect=True)
def test_recorded_success_keeps_its_object_when_the_failure_path_runs(
    capture_case, engine, monkeypatch
):
    def fail_after_commit(**kwargs):
        raise RuntimeError("result construction failed")

    monkeypatch.setattr(realtime_gtfs, "RealtimeIngestionResult", fail_after_commit)
    monkeypatch.setattr(i3, "I3IngestionResult", fail_after_commit)
    with pytest.raises(RuntimeError, match="result construction failed"):
        capture_case.capture()
    run, rows = _state(engine)
    assert run["status"] == "succeeded"
    assert rows["ingestion_objects"] == [run["ingestion_run_id"]]
    assert (rows["realtime_snapshot_index"] or rows["i3_alert_snapshots"]) == [
        run["ingestion_run_id"]
    ]
    assert capture_case.store.keys
    assert all((capture_case.root / key).exists() for key in capture_case.store.keys)
    assert all(not path.exists() for path in capture_case.downloads)


def test_failed_commit_still_removes_the_uploaded_object(capture_case, engine):
    def fail_commit(connection):
        status = connection.execute(
            text("SELECT status FROM raw.ingestion_runs WHERE provider_id=:p"), {"p": PROVIDER}
        ).scalar_one_or_none()
        if status == "succeeded":
            raise RuntimeError("commit failed before database commit")

    event.listen(engine, "commit", fail_commit)
    try:
        with pytest.raises(RuntimeError, match="commit failed before database commit"):
            capture_case.capture()
    finally:
        event.remove(engine, "commit", fail_commit)
    run = _assert_discarded(capture_case, engine)
    assert run["status"] == "failed"
    assert run["error_message"] == "commit failed before database commit"
    assert capture_case.store.keys


def test_final_database_age_check_refuses_expiry_after_first_guard(
    capture_case, engine, monkeypatch
):
    def insert_then_age(connection, **kwargs):
        object_id = common.insert_ingestion_object(connection, **kwargs)
        connection.execute(
            text(
                "UPDATE raw.ingestion_runs "
                "SET started_at_utc=started_at_utc - interval '301 seconds' "
                "WHERE ingestion_run_id=:id"
            ),
            {"id": kwargs["ingestion_run_id"]},
        )
        return object_id

    monkeypatch.setattr(realtime_gtfs, "insert_ingestion_object", insert_then_age)
    monkeypatch.setattr(i3, "insert_ingestion_object", insert_then_age)
    with pytest.raises(common.CaptureTimeLimitExceeded):
        capture_case.capture()
    run = _assert_discarded(capture_case, engine)
    assert run["status"] == "failed"
    assert run["error_message"] == "Capture exceeded its total time limit of 300 s."


@pytest.mark.parametrize("endpoint", ["trip_updates", "i3_alerts"])
def test_final_monotonic_check_refuses_expiry_after_upload(
    endpoint, settings, bronze_root, monkeypatch
):
    import test_i3_ingestion as alert_fakes
    import test_realtime_ingestion as realtime_fakes

    fakes = realtime_fakes if endpoint == "trip_updates" else alert_fakes
    config = SimpleNamespace(
        provider_id=PROVIDER,
        endpoint_key=endpoint,
        feed_kind=endpoint,
        source_format="gtfs_rt_trip_updates",
        source_url="https://example.test/feed",
        request_url="https://example.test/feed",
        request_headers={},
        storage_backend="local",
    )
    paths = _replace_downloads(monkeypatch, config, bronze_root)
    local = LocalBronzeStorage("local", bronze_root)
    keys = []

    def upload(path, key):
        keys.append(key)
        location = local.persist_temp_file(path, key)
        monkeypatch.setattr(common.time, "monotonic", lambda: 301)
        return location

    monkeypatch.setattr(common.time, "monotonic", lambda: 0)
    storage = SimpleNamespace(persist_temp_file=upload, delete_object=local.delete_object)
    with pytest.raises(common.CaptureTimeLimitExceeded):
        _capture(config, settings, fakes.FakeEngine(fakes.RecordingConnection()), storage)
    assert keys
    assert all(not (bronze_root / key).exists() for key in keys)
    assert paths and all(not path.exists() for path in paths)
