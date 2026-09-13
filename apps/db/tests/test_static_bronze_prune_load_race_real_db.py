"""A static archive remains available while its Silver load is using it."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event
from time import monotonic

import pytest
from sqlalchemy import create_engine, text
from test_static_pipeline_recovery_real_db import subject as subject

from transit_ops.ingestion.storage import LocalBronzeStorage, get_bronze_storage
from transit_ops.maintenance.bronze import prune_bronze_static_objects
from transit_ops.silver.static_gtfs import (
    find_latest_static_bronze_archive,
    load_latest_static_to_silver,
    load_static_zip_to_silver,
)


@pytest.fixture
def static_source(subject):
    captured = subject.ingest()
    now = datetime.now(UTC)
    old = now - timedelta(days=400)
    with subject.engine.begin() as connection:
        connection.execute(
            text("""
                UPDATE raw.ingestion_runs SET started_at_utc=:old, completed_at_utc=:old
                WHERE ingestion_run_id=:run_id AND provider_id=:provider
            """),
            {"old": old, "run_id": captured.ingestion_run_id, "provider": subject.provider_id},
        )
    with subject.engine.connect() as connection:
        archive = find_latest_static_bronze_archive(
            connection,
            provider_id=subject.provider_id,
            endpoint_key="static_schedule",
            settings=subject.settings,
            project_root=Path(__file__).parents[1],
        )
    source = (
        archive,
        get_bronze_storage(subject.settings, project_root=Path(__file__).parents[1]),
        now,
    )
    assert _archive_path(source).is_file()
    return source


@pytest.fixture
def bounded_engine(subject):
    engine = create_engine(
        subject.engine.url,
        connect_args={"options": "-c statement_timeout=10000 -c lock_timeout=5000"},
    )
    try:
        yield engine
    finally:
        engine.dispose()


def _prune(connection, static_source):
    archive, storage, now = static_source
    return prune_bronze_static_objects(
        connection,
        provider_id=archive.provider_id,
        retention_days=365,
        now_utc=now,
        bronze_storage=storage,
    )


def _archive_path(static_source):
    archive, storage, _ = static_source
    return Path(storage.describe_location(archive.storage_path))


def test_static_archive_being_loaded_is_not_pruned(
    subject, static_source, bounded_engine, monkeypatch, record_property
):
    archive, _, _ = static_source
    archive_path = _archive_path(static_source)
    archive_read, resume_loader = Event(), Event()
    events = []
    read_bytes = LocalBronzeStorage.read_bytes

    def pause_after_read(storage, path):
        payload = read_bytes(storage, path)
        events.append("loader_read_archive")
        archive_read.set()
        assert resume_loader.wait(10), "loader was not released"
        events.append("loader_resumed")
        return payload

    monkeypatch.setattr(LocalBronzeStorage, "read_bytes", pause_after_read)
    engine = bounded_engine

    def load():
        try:
            result = load_latest_static_to_silver(
                subject.provider_id,
                settings=subject.settings,
                registry=subject.registry,
                engine=engine,
            )
            events.append("loader_committed")
            return result, None
        except Exception as error:
            events.append(f"loader_failed:{type(error).__name__}")
            return None, error

    def prune():
        with engine.begin() as connection:
            events.append("prune_started")
            result = _prune(connection, static_source)
        events.append("prune_committed")
        return result

    with ThreadPoolExecutor(max_workers=2) as pool:
        loading = pool.submit(load)
        try:
            assert archive_read.wait(5), "loader did not reach archive read"
            pruned = pool.submit(prune).result(timeout=5)
            archive_survived = archive_path.exists()
        finally:
            resume_loader.set()
        loaded, load_error = loading.result(timeout=10)
    observation = {
        "events": events,
        "pruned": pruned[1],
        "archive_survived": archive_survived,
        "load_error": type(load_error).__name__ if load_error else None,
        "constraint": getattr(
            getattr(getattr(load_error, "orig", None), "diag", None), "constraint_name", None
        ),
    }
    record_property("static_prune_race", observation)
    assert pruned[1] == {"static": 0}, observation
    assert archive_survived, observation
    assert load_error is None, observation
    assert loaded.source_ingestion_object_id == archive.source_ingestion_object_id


def test_pruner_first_prevents_archive_read_from_a_lost_source(
    static_source, bounded_engine, monkeypatch, record_property
):
    archive, storage, _ = static_source
    archive_deleted, resume_pruner, loader_started = Event(), Event(), Event()
    reads, pids, events = [], {}, []
    delete_objects, read_bytes = LocalBronzeStorage.delete_objects, LocalBronzeStorage.read_bytes

    def pause_after_delete(store, paths):
        failed = delete_objects(store, paths)
        assert not failed
        events.append("archive_deleted")
        archive_deleted.set()
        assert resume_pruner.wait(10), "pruner was not released"
        return failed

    def observe_read(store, path):
        reads.append(path)
        return read_bytes(store, path)

    monkeypatch.setattr(LocalBronzeStorage, "delete_objects", pause_after_delete)
    monkeypatch.setattr(LocalBronzeStorage, "read_bytes", observe_read)

    def prune():
        with bounded_engine.begin() as connection:
            pids["pruner"] = connection.execute(text("SELECT pg_backend_pid()")).scalar_one()
            result = _prune(connection, static_source)
        events.append("prune_committed")
        return result

    def load():
        try:
            with bounded_engine.begin() as connection:
                pids["loader"] = connection.execute(text("SELECT pg_backend_pid()")).scalar_one()
                loader_started.set()
                load_static_zip_to_silver(connection, archive=archive, bronze_storage=storage)
        except Exception as error:
            return error
        return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        pruning = pool.submit(prune)
        try:
            assert archive_deleted.wait(5), "pruner did not delete the archive"
            loading = pool.submit(load)
            assert loader_started.wait(5), "loader did not start"
            deadline, blocked = monotonic() + 3, False
            with bounded_engine.connect() as observer:
                while monotonic() < deadline and not loading.done():
                    blocked = observer.execute(
                        text("SELECT :pruner = ANY(pg_blocking_pids(:loader))"), pids
                    ).scalar_one()
                    if blocked:
                        events.append("loader_blocked_by_pruner")
                        break
        finally:
            resume_pruner.set()
        pruned, load_error = pruning.result(timeout=10), loading.result(timeout=10)
    record_property("static_prune_first", {"events": events, "reads": reads, "blocked": blocked})
    assert blocked, events
    assert pruned[1] == {"static": 1}
    assert isinstance(load_error, ValueError), load_error
    assert reads == []
    assert not _archive_path(static_source).exists()


def test_missing_static_source_is_refused_before_archive_io(
    static_source, bounded_engine, monkeypatch
):
    archive, storage, _ = static_source
    with bounded_engine.begin() as connection:
        assert _prune(connection, static_source)[1] == {"static": 1}

    def forbidden_read(*args):
        pytest.fail("missing source reached archive I/O")

    monkeypatch.setattr(LocalBronzeStorage, "read_bytes", forbidden_read)
    with bounded_engine.begin() as connection, pytest.raises(ValueError):
        load_static_zip_to_silver(connection, archive=archive, bronze_storage=storage)


@pytest.mark.parametrize(
    ("operation", "isolation"),
    [
        ("loader", None),
        ("pruner", None),
        ("loader", "AUTOCOMMIT"),
        ("pruner", "AUTOCOMMIT"),
        ("pruner", "REPEATABLE READ"),
    ],
)
def test_static_archive_operations_refuse_unsafe_transactions_before_io(
    static_source, bounded_engine, monkeypatch, operation, isolation
):
    archive, storage, _ = static_source

    def forbidden_io(*args):
        pytest.fail("unsafe transaction reached archive I/O")

    monkeypatch.setattr(LocalBronzeStorage, "read_bytes", forbidden_io)
    monkeypatch.setattr(LocalBronzeStorage, "delete_objects", forbidden_io)
    with bounded_engine.connect() as connection:
        if isolation:
            connection = connection.execution_options(isolation_level=isolation)
            connection.begin()
        with pytest.raises(ValueError):
            if operation == "loader":
                load_static_zip_to_silver(connection, archive=archive, bronze_storage=storage)
            else:
                _prune(connection, static_source)
    assert _archive_path(static_source).exists()


@pytest.mark.parametrize("isolation", ["READ COMMITTED", "REPEATABLE READ"])
def test_static_loader_rollback_releases_archive_for_later_prune(
    static_source, bounded_engine, isolation
):
    archive, storage, _ = static_source
    with bounded_engine.connect().execution_options(isolation_level=isolation) as loader:
        transaction = loader.begin()
        try:
            load_static_zip_to_silver(loader, archive=archive, bronze_storage=storage)
            with bounded_engine.begin() as pruner:
                assert _prune(pruner, static_source)[1] == {"static": 0}
            assert _archive_path(static_source).exists()
        finally:
            transaction.rollback()
    with bounded_engine.begin() as pruner:
        assert (
            pruner.execute(
                text("SELECT count(*) FROM core.dataset_versions WHERE provider_id=:p"),
                {"p": archive.provider_id},
            ).scalar_one()
            == 0
        )
        assert _prune(pruner, static_source)[1] == {"static": 1}
    assert not _archive_path(static_source).exists()
