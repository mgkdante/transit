import hashlib
import time
from contextlib import contextmanager
from datetime import UTC
from threading import Event, Thread
from types import SimpleNamespace

import pytest
from google.transit import gtfs_realtime_pb2
from history_ledger_fixtures import conn as conn
from realtime_replay_fixtures import PROVIDER
from realtime_replay_fixtures import bronze_root as bronze_root
from realtime_replay_fixtures import engine as engine
from realtime_replay_fixtures import settings as settings
from sqlalchemy import text
from typer.testing import CliRunner

from transit_ops import cli
from transit_ops.history import close_runs, ledger
from transit_ops.history.working_captures import CLOSED_UNFINISHED, read_working_day
from transit_ops.ingestion import common, realtime_gtfs
from transit_ops.ingestion.storage import LocalBronzeStorage


def _seed(
    conn,
    seed_provider,
    *,
    endpoint="trip_updates",
    status="running",
    age=7200,
    provider=PROVIDER,
    kind=None,
):
    seed_provider(conn, provider, display_name="Close runs test", ignore_existing=True)
    source_format = {
        "trip_updates": "gtfs_rt_trip_updates",
        "i3_alerts": "api_i3_json",
        "static_schedule": "gtfs_schedule_zip",
        "gis_static": "stm_gis_zip",
    }[endpoint]
    endpoint_id = conn.execute(
        text("""
        INSERT INTO core.feed_endpoints (provider_id, endpoint_key, feed_kind, source_format)
        VALUES (:p, :e, :e, :f) ON CONFLICT (provider_id, endpoint_key)
        DO UPDATE SET endpoint_key=EXCLUDED.endpoint_key RETURNING feed_endpoint_id
    """),
        {"p": provider, "e": endpoint, "f": source_format},
    ).scalar_one()
    return conn.execute(
        text("""
        INSERT INTO raw.ingestion_runs
            (provider_id, feed_endpoint_id, run_kind, status, started_at_utc,
             http_status_code, entity_count, feed_timestamp_utc)
        VALUES (:p, :e, :k, :s, now() - make_interval(secs => :age), 202, 7, now())
        RETURNING ingestion_run_id
    """),
        dict(p=provider, e=endpoint_id, k=kind or endpoint, s=status, age=age),
    ).scalar_one()


def _runs(conn):
    return {
        r.ingestion_run_id: dict(r)
        for r in conn.execute(
            text("SELECT * FROM raw.ingestion_runs WHERE provider_id IN (:p, :other)"),
            {"p": PROVIDER, "other": "close_runs_other_test"},
        ).mappings()
    }


def _events(conn):
    return [
        dict(r)
        for r in conn.execute(
            text("""
        SELECT kind, dataset_id, provider_id, revision, window_key, content_version,
               reason, details, actor FROM core.history_event WHERE provider_id=:p
        ORDER BY event_id
    """),
            {"p": PROVIDER},
        ).mappings()
    ]


def test_run_without_result_after_an_hour_is_closed_as_failed(conn, seed_provider):
    ids = [
        _seed(conn, seed_provider, status=s, age=age, endpoint=e)
        for s, age, e in (
            ("running", 7200, "trip_updates"),
            ("pending", 7200, "trip_updates"),
            ("running", 86400, "trip_updates"),
            ("running", 10800, "i3_alerts"),
        )
    ]
    other = _seed(conn, seed_provider, provider="close_runs_other_test")
    before = _runs(conn)
    now = conn.execute(text("SELECT now()")).scalar_one()
    assert close_runs.close_unfinished_runs(conn, provider_id=PROVIDER, actor="test") == 4
    after = _runs(conn)
    for run_id in ids:
        assert after[run_id] == dict(
            before[run_id], status="failed", error_message=CLOSED_UNFINISHED, completed_at_utc=now
        )
    assert after[other] == before[other]
    groups = {}
    for run_id in ids:
        endpoint = before[run_id]["run_kind"]
        day = before[run_id]["started_at_utc"].astimezone(UTC).date().isoformat()
        groups.setdefault((endpoint, day), []).append(run_id)
    assert _events(conn) == [
        dict(
            kind="close_runs",
            dataset_id="capture." + endpoint,
            provider_id=PROVIDER,
            revision=0,
            window_key=day,
            content_version=None,
            reason=CLOSED_UNFINISHED,
            details={"ingestion_run_ids": sorted(run_ids), "older_than_seconds": 3600},
            actor="test",
        )
        for (endpoint, day), run_ids in sorted(groups.items())
    ]
    events = _events(conn)
    assert close_runs.close_unfinished_runs(conn, provider_id=PROVIDER) == 0
    assert _events(conn) == events


def test_young_run_and_static_run_are_left_alone(conn, seed_provider):
    _seed(conn, seed_provider, age=3540)
    for endpoint in ("static_schedule", "gis_static"):
        _seed(conn, seed_provider, endpoint=endpoint)
    _seed(conn, seed_provider, kind="silver_load")
    for status in ("succeeded", "failed"):
        _seed(conn, seed_provider, status=status)
    before = _runs(conn)
    assert close_runs.close_unfinished_runs(conn, provider_id=PROVIDER) == 0
    assert _runs(conn) == before
    assert _events(conn) == []


def test_closed_run_reads_as_unfinished(conn, seed_provider):
    run_id = _seed(conn, seed_provider)
    day = _runs(conn)[run_id]["started_at_utc"].astimezone(UTC).date()
    assert close_runs.close_unfinished_runs(conn, provider_id=PROVIDER) == 1
    record = read_working_day(conn, provider_id=PROVIDER, endpoint_key="trip_updates", utc_date=day)
    assert [
        (p.ingestion_run_id, p.status, p.run_status, p.error_message) for p in record.polls
    ] == [(run_id, "unfinished", "failed", CLOSED_UNFINISHED)]


@pytest.mark.parametrize("provider,age", [("", 3600), ("p", True), ("p", -1), ("p", 1.5)])
def test_invalid_arguments_are_refused_before_sql(provider, age):
    with pytest.raises(ValueError):
        close_runs.close_unfinished_runs(None, provider_id=provider, older_than_seconds=age)


def test_close_runs_command_prints_the_count(monkeypatch):
    calls = []
    connection = object()

    @contextmanager
    def begin():
        yield connection

    def close(c, *, provider_id):
        assert c is connection
        calls.append(provider_id)
        return 3

    monkeypatch.setattr(cli, "make_engine", lambda s: SimpleNamespace(begin=begin))
    monkeypatch.setattr(close_runs, "close_unfinished_runs", close)
    result = CliRunner().invoke(cli.app, ["history-close-runs", "--provider", "stm"])
    assert result.exit_code == 0, result.output
    assert result.output == "Closed 3 unfinished capture run(s) for provider stm.\n"
    assert calls == ["stm"]
    assert CliRunner().invoke(cli.app, ["history-close-runs"]).exit_code != 0


def _start(action):
    outcome = SimpleNamespace(value=None, error=None)

    def run():
        try:
            outcome.value = action()
        except Exception as exc:
            outcome.error = exc

    thread = Thread(target=run, daemon=True)
    thread.start()
    return thread, outcome


def _join(thread):
    thread.join(30)
    assert not thread.is_alive(), "worker did not finish"


def _wait_for_lock(engine, sql, params, expected):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        with engine.connect() as observer:
            if observer.execute(text(sql), params).scalar_one_or_none() == expected:
                return
        time.sleep(0.02)
    pytest.fail("database session did not wait on the row lock")


def _capture_case(engine, settings, bronze_root, seed_provider, monkeypatch):
    with engine.begin() as c:
        run_id = _seed(c, seed_provider)
        c.execute(text("DELETE FROM raw.ingestion_runs WHERE ingestion_run_id=:id"), {"id": run_id})
    config = SimpleNamespace(
        provider_id=PROVIDER,
        endpoint_key="trip_updates",
        feed_kind="trip_updates",
        source_format="gtfs_rt_trip_updates",
        source_url="https://example.test/feed",
        request_url="https://example.test/feed",
        request_headers={},
        storage_backend="local",
    )
    message = gtfs_realtime_pb2.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    payload = message.SerializeToString()

    def download(*args):
        path = bronze_root / "download.tmp"
        path.write_bytes(payload)
        return common.DownloadedArtifact(
            path, len(payload), hashlib.sha256(payload).hexdigest(), 200, config.source_url
        )

    local = LocalBronzeStorage("local", bronze_root)
    case = SimpleNamespace(go=Event(), paused=Event(), keys=[], events=[], storage=local)
    monkeypatch.setattr(realtime_gtfs, "_download_to_tempfile", download)
    monkeypatch.setattr(realtime_gtfs, "build_realtime_ingestion_config", lambda *a: config)
    monkeypatch.setattr(ledger, "record_event", lambda c, **kw: case.events.append(kw))
    case.capture = lambda: realtime_gtfs._capture_realtime_feed(
        PROVIDER,
        "trip_updates",
        settings=settings,
        engine=engine,
        registry=SimpleNamespace(get_provider=lambda p: None),
        bronze_storage_resolver=lambda backend: case.storage,
    )[0]
    return case


def _closing_first(case, engine):
    local = case.storage

    def persist(path, key):
        location = local.persist_temp_file(path, key)
        case.keys.append(key)
        case.paused.set()
        assert case.go.wait(10), "upload was not released"
        return location

    case.storage = SimpleNamespace(persist_temp_file=persist, delete_object=local.delete_object)
    thread, outcome = _start(case.capture)
    try:
        assert case.paused.wait(10), outcome.error
        with engine.connect() as a:
            try:
                a_pid = a.execute(text("SELECT pg_backend_pid()")).scalar_one()
                assert (
                    close_runs.close_unfinished_runs(a, provider_id=PROVIDER, older_than_seconds=0)
                    == 1
                )
                case.closed_at = a.execute(text("SELECT now()")).scalar_one()
                case.go.set()
                _wait_for_lock(
                    engine,
                    "SELECT count(*) FROM pg_stat_activity "
                    "WHERE datname=current_database() AND :pid=ANY(pg_blocking_pids(pid))",
                    {"pid": a_pid},
                    1,
                )
                a.commit()
            finally:
                a.rollback()
    finally:
        case.go.set()
        _join(thread)
    assert isinstance(outcome.error, common.CaptureRunRefused)


def _capture_first(case, engine, monkeypatch):
    real_success = realtime_gtfs.mark_ingestion_run_succeeded
    ready = Event()
    closer_state = {}

    def success(*args, **kwargs):
        real_success(*args, **kwargs)
        case.paused.set()
        assert case.go.wait(10), "success was not released"

    def close():
        with engine.connect() as b:
            try:
                closer_state["pid"] = b.execute(text("SELECT pg_backend_pid()")).scalar_one()
                ready.set()
                return close_runs.close_unfinished_runs(
                    b, provider_id=PROVIDER, older_than_seconds=0
                )
            finally:
                b.rollback()

    monkeypatch.setattr(realtime_gtfs, "mark_ingestion_run_succeeded", success)
    capture, outcome = _start(case.capture)
    closer = None
    try:
        assert case.paused.wait(10), outcome.error
        closer, closed = _start(close)
        assert ready.wait(10), closed.error
        _wait_for_lock(
            engine,
            "SELECT wait_event_type FROM pg_stat_activity WHERE pid=:pid",
            closer_state,
            "Lock",
        )
    finally:
        case.go.set()
        try:
            _join(capture)
        finally:
            if closer is not None:
                _join(closer)
    assert outcome.error is None
    assert outcome.value.status == "succeeded"
    assert closed.error is None
    assert closed.value == 0
    case.keys.append(outcome.value.storage_path)


@pytest.mark.parametrize("order", ["closing_first", "capture_first"])
def test_closing_and_a_late_result_cannot_both_win(
    order, engine, settings, bronze_root, seed_provider, monkeypatch
):
    case = _capture_case(engine, settings, bronze_root, seed_provider, monkeypatch)
    if order == "closing_first":
        _closing_first(case, engine)
    else:
        _capture_first(case, engine, monkeypatch)
    with engine.connect() as c:
        (run,) = _runs(c).values()
        for table in ("ingestion_objects", "realtime_snapshot_index"):
            ids = (
                c.execute(
                    text(f"SELECT ingestion_run_id FROM raw.{table} WHERE ingestion_run_id=:id"),
                    {"id": run["ingestion_run_id"]},
                )
                .scalars()
                .all()
            )
            assert ids == ([] if order == "closing_first" else [run["ingestion_run_id"]])
    assert case.keys
    assert all((bronze_root / key).exists() == (order == "capture_first") for key in case.keys)
    if order == "closing_first":
        assert (run["status"], run["error_message"], run["completed_at_utc"]) == (
            "failed",
            CLOSED_UNFINISHED,
            case.closed_at,
        )
        assert case.events == [
            dict(
                kind="close_runs",
                dataset_id="capture.trip_updates",
                provider_id=PROVIDER,
                revision=0,
                window_key=run["started_at_utc"].astimezone(UTC).date().isoformat(),
                reason=CLOSED_UNFINISHED,
                details={"ingestion_run_ids": [run["ingestion_run_id"]], "older_than_seconds": 0},
                actor=None,
            )
        ]
    else:
        assert (run["status"], run["error_message"]) == ("succeeded", None)
        assert case.events == []
