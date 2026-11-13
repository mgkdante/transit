from datetime import UTC, datetime, timedelta, timezone
from types import MappingProxyType

import pytest
from history_ledger_fixtures import conn as rollback_conn
from history_ledger_fixtures import pipeline_role
from sqlalchemy import text

from transit_ops.history import datasets, ledger

conn = rollback_conn

SCOPE = dict(dataset_id="capture.trip_updates", provider_id="network", revision=0)
IDENTITY = {k: v for k, v in SCOPE.items() if k != "revision"}
NOW = datetime(2026, 11, 2, tzinfo=UTC)
A, B = "a" * 64, "b" * 64


@pytest.fixture
def folding(monkeypatch):
    dataset = datasets.HistoryDataset(
        "test.cells",
        datasets.TableSource("test.cells", "day", ("day",), "revision", 0),
        "service_day",
        16,
        (),
        1,
        (datasets.Fold("monthly", "month"), datasets.Fold("yearly", "year")),
    )
    monkeypatch.setattr(
        datasets,
        "HISTORY_DATASETS",
        MappingProxyType({**datasets.HISTORY_DATASETS, dataset.dataset_id: dataset}),
    )
    return dict(dataset_id=dataset.dataset_id, provider_id="network", revision=3)


def _copy(conn, key, *, version=1, digest=A, verified=True, rejected=False):
    ledger.lock_window(conn, **IDENTITY, window_key=key)
    conn.execute(
        text("""
        UPDATE core.history_window SET current_version=:version,
            working_changed_at_utc=:time - interval '1 day' WHERE window_key=:key
    """),
        dict(version=version, time=NOW, key=key),
    )
    conn.execute(
        text("""
        INSERT INTO core.history_archive_copy
        (dataset_id, provider_id, revision, window_key, content_version, schema_version,
         storage_backend, allocated_at_utc, sealed_at_utc, verified_at_utc,
         rejected_at_utc, reject_reason, content_sha256)
        VALUES (:dataset_id, :provider_id, :revision, :key, :version, 1, 'local',
                :time - interval '2 days', :time - interval '1 day', :verified,
                :rejected, :reason, :digest)
    """),
        {
            **SCOPE,
            "key": key,
            "version": version,
            "time": NOW,
            "verified": NOW if verified else None,
            "rejected": NOW if rejected else None,
            "reason": "bad" if rejected else None,
            "digest": digest,
        },
    )


def _events(conn):
    return conn.exec_driver_sql(
        "SELECT kind, window_key, revision, content_version, details, actor "
        "FROM core.history_event ORDER BY event_id"
    ).all()


def test_fold_sources_gives_the_digest_of_each_verified_current_copy(conn):
    keys = [f"2026-11-{day:02d}" for day in range(1, 6)]
    _copy(conn, keys[0])
    _copy(conn, keys[1], verified=False)
    _copy(conn, keys[2], rejected=True)
    ledger.lock_window(conn, **IDENTITY, window_key=keys[3])
    before = _events(conn)
    result = ledger.fold_sources(conn, **SCOPE, window_keys=keys)
    assert list(result.items()) == list(zip(keys, [A, None, None, None, None], strict=True))
    assert ledger.fold_sources(conn, **SCOPE, window_keys=[]) == {}
    assert _events(conn) == before


def test_fold_built_before_a_change_names_the_older_digest(conn):
    key = "2026-11-01"
    _copy(conn, key)
    assert ledger.fold_sources(conn, **SCOPE, window_keys=[key]) == {key: A}
    ledger.lock_window(conn, **IDENTITY, window_key=key)
    assert ledger.fold_sources(conn, **SCOPE, window_keys=[key]) == {key: None}
    conn.execute(
        text("""
        INSERT INTO core.history_archive_copy
        (dataset_id,provider_id,revision,window_key,content_version,schema_version,
         storage_backend,allocated_at_utc,sealed_at_utc,verified_at_utc,content_sha256)
        VALUES (:dataset_id,:provider_id,0,:key,2,1,'local',clock_timestamp(),
                clock_timestamp(),clock_timestamp(),:digest)
    """),
        {**IDENTITY, "key": key, "digest": B},
    )
    conn.exec_driver_sql("UPDATE core.history_window SET current_version=2")
    assert ledger.fold_sources(conn, **SCOPE, window_keys=[key]) == {key: B}


def _publication(folding):
    return {
        **folding,
        "fold": "monthly",
        "period_key": "2026-11",
        "object_key": "tree/month",
        "sources": {"2026-11-01": A, "2026-11-02": None},
        "actor": "publisher",
    }


def test_fold_published_records_the_digests_it_was_built_from(conn, folding):
    publication = _publication(folding)
    ledger.record_fold_published(conn, **publication)
    expected = {key: publication[key] for key in ("fold", "period_key", "object_key", "sources")}
    assert _events(conn) == [("fold_published", "2026-11", 3, None, expected, "publisher")]
    ledger.record_fold_published(conn, **{**publication, "fold": "yearly", "period_key": "2026"})
    assert _events(conn)[-1].window_key == "2026"


@pytest.mark.parametrize(
    "invalid",
    [
        {"fold": "unknown"},
        {"period_key": "2026-13"},
        {"period_key": "0000-11"},
        {"fold": "yearly", "period_key": "2026-11"},
        {"object_key": ""},
        {"sources": {}},
        {"sources": {"2026-12-01": A}},
        {"sources": {"2026-11": A}},
        {"sources": {"2026-11-01": "A" * 64}},
        {"sources": {"2026-11-01": "abc"}},
        {"revision": -1},
        {"actor": ""},
    ],
)
def test_fold_publication_refuses_invalid_values_before_sql(conn, folding, invalid):
    before = _events(conn)
    with pytest.raises(ValueError):
        ledger.record_fold_published(None, **{**_publication(folding), **invalid})
    assert _events(conn) == before


def _evidence():
    return {
        **IDENTITY,
        "window_key": "2026-11-01",
        "command": "replay",
        "completed_at_utc": NOW.astimezone(timezone(timedelta(hours=2))),
        "rows_by_capture": {12: 0, 13: 5},
        "actor": "replay",
    }


def test_processing_evidence_marks_the_window_changed_and_waits_in_an_event(conn):
    ledger.lock_window(conn, **IDENTITY, window_key="2026-11-01")
    before = ledger.window_state(conn, **IDENTITY, window_key="2026-11-01")
    conn.exec_driver_sql("UPDATE core.history_window SET working_state='trimmed'")
    ledger.record_processing_evidence(conn, **_evidence())
    after = ledger.window_state(conn, **IDENTITY, window_key="2026-11-01")
    assert after.working_state == "present"
    assert after.working_changed_at_utc > before.working_changed_at_utc
    assert _events(conn)[-2:] == [
        ("changed", "2026-11-01", 0, None, {}, "replay"),
        (
            "processing_evidence",
            "2026-11-01",
            0,
            None,
            {
                "command": "replay",
                "completed_at_utc": "2026-11-02T00:00:00.000000Z",
                "index_family": "realtime_snapshot",
                "rows_by_capture": {"12": 0, "13": 5},
            },
            "replay",
        ),
    ]


@pytest.mark.parametrize(
    "invalid",
    [
        {"dataset_id": "capture.i3_alerts"},
        {"completed_at_utc": NOW.replace(tzinfo=None)},
        {"rows_by_capture": {12: -1}},
        {"rows_by_capture": {True: 0}},
        {"rows_by_capture": {0: 0}},
        {"rows_by_capture": {12: True}},
        {"rows_by_capture": {1.5: 0}},
        {"rows_by_capture": {12: 1.5}},
        {"command": ""},
        {"window_key": "2026-11"},
        {"actor": ""},
    ],
)
def test_processing_evidence_refuses_invalid_values_before_sql(conn, invalid):
    before = _events(conn)
    with pytest.raises(ValueError):
        ledger.record_processing_evidence(None, **{**_evidence(), **invalid})
    assert _events(conn) == before


def test_recording_calls_refuse_an_undeclared_dataset(conn, folding):
    before = _events(conn)
    for function, args in (
        (ledger.fold_sources, {**SCOPE, "window_keys": ["2026-11-01"]}),
        (ledger.record_fold_published, _publication(folding)),
        (ledger.record_processing_evidence, _evidence()),
    ):
        with pytest.raises(datasets.UndeclaredDataset):
            function(None, **{**args, "dataset_id": "unknown"})
    assert _events(conn) == before


@pytest.mark.parametrize("invalid", [{"revision": 1}, {"window_keys": ["2026-11"]}])
def test_fold_sources_validates_before_sql(conn, invalid):
    with pytest.raises(ValueError):
        ledger.fold_sources(None, **{**SCOPE, "window_keys": ["2026-11-01"], **invalid})


def test_recording_calls_run_as_the_pipeline_role(conn, monkeypatch, folding):
    with pipeline_role(conn, monkeypatch):
        _copy(conn, "2026-11-01")
        assert ledger.fold_sources(conn, **SCOPE, window_keys=["2026-11-01"]) == {"2026-11-01": A}
        ledger.record_fold_published(conn, **_publication(folding))
        ledger.record_processing_evidence(conn, **_evidence())
        assert _events(conn)[-1].kind == "processing_evidence"
