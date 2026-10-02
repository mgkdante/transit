from pathlib import Path

import pytest

from transit_ops.maintenance import bronze


@pytest.mark.parametrize("body_fails", [False, True])
@pytest.mark.parametrize("close_fails", [False, True])
def test_prune_scope_closes_once_and_preserves_an_existing_failure(
    monkeypatch, body_fails, close_fails
):
    events = []

    class Scope:
        def __init__(self, settings, *, project_root):
            events.append("created")

        def resolve(self, backend):
            events.append(backend)
            return backend

        def close(self):
            events.append("closed")
            if close_fails:
                raise OSError("close failed")

    monkeypatch.setattr(bronze, "BronzeStorageScope", Scope)

    def execute():
        with bronze._prune_archive_stores(object(), Path("/unused")) as resolve:
            assert resolve("local") == "local"
            if body_fails:
                raise RuntimeError("body failed")

    if body_fails:
        with pytest.raises(RuntimeError, match="body failed"):
            execute()
    elif close_fails:
        with pytest.raises(OSError, match="close failed"):
            execute()
    else:
        execute()
    assert events == ["created", "local", "closed"]


def test_dry_run_counts_metadata_without_resolving_any_archive_backend(monkeypatch):
    from test_maintenance import BronzePruneSettings, RecordingConnection, RecordingEngine

    resolutions = []
    closes = []

    class Scope:
        def __init__(self, settings, *, project_root):
            pass

        def resolve(self, backend):
            resolutions.append(backend)
            raise AssertionError("dry-run attempted archive access")

        def close(self):
            closes.append(True)

    monkeypatch.setattr(bronze, "BronzeStorageScope", Scope)
    result = bronze.prune_bronze_storage(
        "stm",
        settings=BronzePruneSettings(),
        engine=RecordingEngine(RecordingConnection()),
        dry_run=True,
    )
    assert result.deleted_object_counts == {"realtime": 12345, "static": 678}
    assert resolutions == []
    assert closes == [True]
