"""Best-effort live-publish hook in ``run_realtime_cycle``.

These tests exercise the extracted ``_best_effort_publish_live`` helper in
isolation — they never run the real realtime cycle (which performs live
ingestion) and never touch the database. ``publish_snapshot`` is monkeypatched
on the orchestration module so no R2/network I/O happens.
"""

from types import SimpleNamespace

import transit_ops.orchestration as orch


def _settings(**kw):
    base = {"SNAPSHOT_R2_BUCKET": "bucket", "SNAPSHOT_STORAGE_BACKEND": "s3"}
    base.update(kw)
    return SimpleNamespace(**base)


def test_publish_failure_is_swallowed_and_counted(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("R2 down")

    monkeypatch.setattr(orch, "publish_snapshot", boom)
    n = orch._best_effort_publish_live(
        "stm", settings=_settings(), engine=object(), registry=None
    )
    assert n == 1  # counted, NOT raised


def test_publish_success_counts_zero(monkeypatch):
    monkeypatch.setattr(orch, "publish_snapshot", lambda *a, **k: None)
    n = orch._best_effort_publish_live(
        "stm", settings=_settings(), engine=object(), registry=None
    )
    assert n == 0


def test_publish_skipped_when_unconfigured(monkeypatch):
    calls = []
    monkeypatch.setattr(orch, "publish_snapshot", lambda *a, **k: calls.append(1))
    n = orch._best_effort_publish_live(
        "stm",
        settings=_settings(SNAPSHOT_R2_BUCKET=None),
        engine=object(),
        registry=None,
    )
    assert n == 0 and calls == []  # skipped: no bucket + not local


def test_publish_runs_for_local_backend_without_bucket(monkeypatch):
    calls = []
    monkeypatch.setattr(orch, "publish_snapshot", lambda *a, **k: calls.append(1))
    n = orch._best_effort_publish_live(
        "stm",
        settings=_settings(SNAPSHOT_R2_BUCKET=None, SNAPSHOT_STORAGE_BACKEND="local"),
        engine=object(),
        registry=None,
    )
    assert n == 0 and calls == [1]  # local backend is a valid target
