import sys
import tracemalloc
from contextlib import nullcontext
from dataclasses import replace
from datetime import date, timedelta
from types import SimpleNamespace as NS
from unittest.mock import Mock

import pytest
from history_fixtures import delete_provider_rows, seed_stored_capture, seed_working_day
from sqlalchemy import text
from test_seal_local_pack import working_day as working_day

from transit_ops.history import probe
from transit_ops.history.datasets import utc_day_closes_at
from transit_ops.ingestion.storage import BronzeStorageError, LocalBronzeStorage


@pytest.fixture
def day(working_day, monkeypatch):
    record, store, _, _, _ = working_day
    record = replace(record, captures=record.captures[:3])
    state = NS(record=record, now=utc_day_closes_at(record.feed_day.utc_date))

    connection = Mock()
    connection.in_transaction.return_value = False
    connection.begin.return_value = nullcontext()
    connection.execute.return_value.scalar_one.side_effect = lambda: state.now
    monkeypatch.setattr(probe, "read_working_day", lambda *a, **kw: state.record)
    monkeypatch.setitem(sys.modules, "duckdb", None)
    state.connection = connection
    state.store = store
    state.run = lambda: probe.probe_capture_day(
        state.connection,
        lambda _: store,
        provider_id="network",
        endpoint_key="trip_updates",
        utc_date=record.feed_day.utc_date,
    )
    return state


def test_probe_reports_missing_and_mismatching_objects(day):
    (day.store.root / "capture/1").unlink()
    (day.store.root / "capture/2").write_bytes(b"changed")
    report = day.run()
    assert (report.packed_count, report.missing_count, report.mismatch_count) == (1, 1, 1)
    assert {f.reason for f in report.findings} == {"object_absent", "object_mismatch"}
    assert report.source_bytes == 5 and report.compressed_bytes > 0


@pytest.mark.parametrize("failure", ["storage", "codec", "database", "duckdb"])
def test_probe_preserves_storage_errors_and_cleans_temporary_files(day, monkeypatch, failure):
    paths = []
    original = probe.pack_working_day

    def pack(*args, directory, **kwargs):
        paths.append(directory)
        result = original(*args, directory=directory, **kwargs)
        if failure == "codec":
            raise ValueError("codec failed")
        return result

    def fail(*args, **kwargs):
        raise BronzeStorageError("operation failed")

    monkeypatch.setattr(probe, "pack_working_day", pack)
    if failure == "storage":
        monkeypatch.setattr(LocalBronzeStorage, "open_stream", fail)
    if failure == "database":
        monkeypatch.setattr(probe, "read_working_day", fail)
    if failure == "duckdb":
        monkeypatch.setitem(sys.modules, "duckdb", NS(connect=fail))
    tracing = tracemalloc.is_tracing()
    with pytest.raises((BronzeStorageError, ValueError)):
        day.run()
    assert all(not p.exists() for p in paths)
    assert tracemalloc.is_tracing() == tracing


def test_probe_refuses_an_open_day_without_storage_reads(day, monkeypatch):
    day.now -= timedelta(microseconds=1)
    monkeypatch.setattr(probe, "pack_working_day", lambda *a, **k: pytest.fail("packed open day"))
    with pytest.raises(ValueError):
        day.run()


@pytest.mark.parametrize("failed", [False, True])
def test_probe_reports_empty_and_failed_only_days(day, failed):
    day.record = replace(day.record, captures=(), polls=day.record.polls[3:4] if failed else ())
    report = day.run()
    assert report.outcome == "no_captures" and report.ratio is None
    assert report.source_bytes == report.compressed_bytes == report.packed_count == 0
    assert report.duckdb["duckdb_status"] == "not_applicable"


def test_probe_reports_timing_and_memory_basis(day, monkeypatch):
    ticks = iter(range(20))
    monkeypatch.setattr(probe, "monotonic", lambda: next(ticks))
    monkeypatch.setattr(probe, "peak_rss", lambda: (None, "unavailable on this platform"))
    report = day.run()
    assert report.database_read_seconds == report.pack_and_verify_seconds == 1
    assert report.decode_and_check_seconds == 1 and report.total_seconds >= 3
    assert report.python_traced_peak_bytes >= 0 and "native" in report.memory_method
    assert report.process_peak_rss_bytes is None and report.process_peak_rss_reason
    assert report.unfinished_attempts == 1 and report.longest_completed_poll_seconds == 0


def test_probe_defers_duckdb_when_unavailable(day):
    report = day.run()
    assert report.duckdb["duckdb_status"] == "deferred"
    assert report.duckdb["duckdb_read_seconds"] is None
    assert "later addition" in report.duckdb["duckdb_reason"]


def test_probe_duckdb_reads_every_payload_of_the_same_day(day, monkeypatch):
    monkeypatch.delitem(sys.modules, "duckdb")
    pytest.importorskip("duckdb")
    report = day.run()
    assert report.duckdb["duckdb_status"] == "measured"
    assert report.duckdb["duckdb_capture_count"] == 3
    assert report.duckdb["duckdb_byte_count"] == 17


def test_probe_does_not_hide_duckdb_errors(day, monkeypatch):
    monkeypatch.setitem(
        sys.modules,
        "duckdb",
        NS(connect=lambda **kw: (_ for _ in ()).throw(RuntimeError("broken module"))),
    )
    with pytest.raises(RuntimeError):
        day.run()


def test_probe_writes_nothing_to_storage_or_database(
    real_db_engine, seed_provider, tmp_path, monkeypatch
):
    provider = "probe-read-only"
    tables = """raw.ingestion_runs raw.ingestion_objects raw.realtime_snapshot_index
                core.history_window core.history_archive_copy core.history_event
                core.pipeline_switches""".split()

    def snapshot(c):
        return [
            sorted(c.execute(text(f"SELECT row_to_json(t)::text FROM {t} t")).scalars())
            for t in tables
        ]

    selection = dict(provider_id=provider, endpoint_key="trip_updates")
    start = utc_day_closes_at(date(2026, 1, 1))
    with real_db_engine.begin() as c:
        delete_provider_rows(c, provider)
        seed_provider(c, provider, display_name="Probe fixture")
        args = dict(**selection, started_at_utc=start)
        seed_stored_capture(
            c, tmp_path, **args, run_id=978001, capture_id=978001, payload=b"capture"
        )
        seed_working_day(c, **args, run_id=978002, with_capture=False, status="running")
    reader = probe.read_working_day

    def read(c, **kwargs):
        assert c.execute(text("SHOW transaction_read_only")).scalar_one() == "on"
        assert c.execute(text("SHOW transaction_isolation")).scalar_one() == "repeatable read"
        return reader(c, **kwargs)

    monkeypatch.setattr(probe, "read_working_day", read)
    monkeypatch.setitem(sys.modules, "duckdb", None)
    for method in ("persist_temp_file", "put_if_absent", "delete_object", "delete_objects"):
        monkeypatch.setattr(LocalBronzeStorage, method, lambda *a, **k: pytest.fail("mutation"))

    def files():
        return {p.relative_to(tmp_path): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}

    try:
        with real_db_engine.connect() as c:
            before = snapshot(c)
            c.rollback()
            objects = files()
            report = probe.probe_capture_day(
                c,
                lambda _: LocalBronzeStorage("local", tmp_path),
                provider_id=provider,
                endpoint_key="trip_updates",
                utc_date=date(2026, 1, 2),
            )
            assert report.packed_count == 1 and report.unfinished_attempts == 1
            assert snapshot(c) == before
            assert files() == objects
    finally:
        with real_db_engine.begin() as c:
            delete_provider_rows(c, provider)
