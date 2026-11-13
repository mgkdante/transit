from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from typer.testing import CliRunner

from transit_ops import cli
from transit_ops.history import close_runs, storage, store
from transit_ops.history.seal_captures import CopyContentMissing

ARGS = [
    "history-seal",
    "--provider",
    "stm",
    "--feed",
    "trip_updates",
    "--date",
    "2026-01-02",
    "--sealed-by",
    "abc123",
]


@pytest.fixture
def command(monkeypatch):
    calls = []
    connection = object()
    settings = cli.Settings(_env_file=None, BRONZE_STORAGE_BACKEND="s3")

    @contextmanager
    def connect():
        yield connection

    def close(c, **kwargs):
        assert c is connection
        calls.append(("close_runs", kwargs))
        return 2

    def seal(c, resolver, **kwargs):
        assert c is connection
        assert resolver is scope.resolve
        calls.append(("seal", kwargs))
        return SimpleNamespace(content_version=3, state="sealed")

    scope = SimpleNamespace(resolve=object(), close=lambda: calls.append(("close_scope", {})))
    monkeypatch.setattr(cli, "get_settings", lambda: settings)
    monkeypatch.setattr(
        cli, "make_engine", lambda s: SimpleNamespace(begin=connect, connect=connect)
    )
    monkeypatch.setattr(close_runs, "close_unfinished_runs", close)
    monkeypatch.setattr(store, "seal", seal)
    monkeypatch.setattr(storage, "history_storage", lambda s: scope)
    return calls


def test_history_seal_command_closes_runs_then_seals(command):
    result = CliRunner().invoke(cli.app, ARGS)
    assert result.exit_code == 0, result.output
    assert result.output == (
        "Closed 2 unfinished capture run(s) for provider stm.\n"
        "Sealed capture.trip_updates 2026-01-02 for provider stm: version 3, sealed.\n"
    )
    assert command[:2] == [
        ("close_runs", {"provider_id": "stm"}),
        (
            "seal",
            dict(
                dataset_id="capture.trip_updates",
                provider_id="stm",
                window_key="2026-01-02",
                archive_backend="s3",
                sealed_by="abc123",
            ),
        ),
    ]
    assert CliRunner().invoke(cli.app, ARGS[:-2]).exit_code != 0


def test_history_seal_command_reports_a_refused_day(command, monkeypatch):
    def refuse(*args, **kwargs):
        raise CopyContentMissing("the working rows lack 2 captures of the current copy")

    monkeypatch.setattr(store, "seal", refuse)
    result = CliRunner().invoke(cli.app, ARGS)
    assert result.exit_code == 1
    assert result.stderr == (
        "Not sealed capture.trip_updates 2026-01-02 for provider stm: "
        "the working rows lack 2 captures of the current copy\n"
    )
    assert "Traceback" not in result.output


@pytest.mark.parametrize("fails", [False, True])
def test_history_seal_command_closes_the_storage_scope(command, monkeypatch, fails):
    if fails:

        def fail(*args, **kwargs):
            raise RuntimeError("storage failure")

        monkeypatch.setattr(store, "seal", fail)
    result = CliRunner().invoke(cli.app, ARGS)
    assert result.exit_code == (1 if fails else 0)
    assert command.count(("close_scope", {})) == 1
