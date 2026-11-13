from contextlib import contextmanager
from datetime import date
from types import SimpleNamespace as NS

import pytest
from typer.testing import CliRunner

from transit_ops import cli
from transit_ops.history import ledger, storage, store
from transit_ops.history.seal_captures import CopyContentMissing

ARGS = ["history-verify", "--provider", "network", "--feed", "trip_updates", "--date", "2026-01-02"]
LABEL = "capture.trip_updates 2026-01-02 for provider network"


@pytest.fixture
def command(monkeypatch):
    state = NS(copies=[], current=None, verified=[], scopes=[], closed=[], results={}, error=None)
    connection = object()

    @contextmanager
    def connect():
        yield connection

    def copies(c, **kwargs):
        assert c is connection
        assert kwargs == dict(
            dataset_id="capture.trip_updates",
            provider_id="network",
            start=date(2026, 1, 2),
            end=date(2026, 1, 2),
        )
        return [NS(content_version=v, state=s) for v, s in state.copies]

    scope = NS(resolve=object(), close=lambda: state.closed.append(True))

    def build_scope(settings):
        state.scopes.append(settings)
        return scope

    def verify(c, resolver, copy):
        assert c is connection and resolver is scope.resolve
        state.verified.append(copy.content_version)
        if state.error:
            raise state.error
        return state.results.get(copy.content_version, NS(outcome="verified", became_current=True))

    monkeypatch.setattr(cli, "get_settings", lambda: cli.Settings(_env_file=None))
    monkeypatch.setattr(cli, "make_engine", lambda s: NS(begin=connect, connect=connect))
    monkeypatch.setattr(ledger, "window_state", lambda c, **kw: NS(current_version=state.current))
    monkeypatch.setattr(ledger, "find_copies", copies)
    monkeypatch.setattr(storage, "history_storage", build_scope)
    monkeypatch.setattr(store, "verify", verify)
    return state


def test_sealed_copies_above_the_current_one_are_verified_in_order(command):
    command.current = 1
    command.copies = [(1, "verified"), (2, "sealed"), (3, "sealed"), (4, "rejected")]
    result = CliRunner().invoke(cli.app, ARGS)
    assert result.exit_code == 0, result.output
    assert command.verified == [2, 3]
    assert result.output == "".join(f"Verified {LABEL}: version {v}, current.\n" for v in (2, 3))
    assert command.closed == [True]


def test_a_rejected_copy_makes_the_command_fail(command):
    command.copies = [(1, "sealed"), (2, "sealed")]
    difference = "poll 5 is in the working rows and not in the copy"
    command.results[1] = NS(outcome="rejected", reason="stale", difference=difference)
    result = CliRunner().invoke(cli.app, ARGS)
    assert result.exit_code == 1
    assert result.output == (
        f"Rejected {LABEL}: version 1, stale: {difference}.\n"
        f"Verified {LABEL}: version 2, current.\n"
    )
    assert command.verified == [1, 2] and command.closed == [True]


@pytest.mark.parametrize("current", [None, 1])
def test_nothing_to_verify_exits_cleanly(command, current):
    command.current = current
    command.copies = [(1, "verified")] if current else []
    result = CliRunner().invoke(cli.app, ARGS)
    assert result.exit_code == 0
    assert (
        result.output
        == "Nothing to verify for capture.trip_updates 2026-01-02 of provider network.\n"
    )
    assert command.verified == command.scopes == []


def test_version_option_verifies_only_that_copy(command):
    command.copies = [(v, "sealed") for v in (1, 2, 3)]
    command.results[2] = NS(outcome="verified", became_current=False)
    result = CliRunner().invoke(cli.app, [*ARGS, "--version", "2"])
    assert result.exit_code == 0
    assert result.output == f"Verified {LABEL}: version 2, not current.\n"
    assert command.verified == [2] and command.closed == [True]
    result = CliRunner().invoke(cli.app, [*ARGS, "--version", "9"])
    assert result.exit_code == 2
    assert result.output == f"No copy 9 of {LABEL}.\n"
    assert len(command.scopes) == 1


def test_an_error_closes_the_scope_and_fails(command):
    command.copies = [(1, "sealed")]
    command.error = ValueError("copy cannot be verified")
    result = CliRunner().invoke(cli.app, ARGS)
    assert result.exit_code != 0 and result.exception is command.error
    assert command.closed == [True]


def test_missing_content_is_one_line_and_exit_one(command):
    command.copies = [(1, "sealed")]
    command.error = CopyContentMissing("missing poll 5")
    result = CliRunner().invoke(cli.app, ARGS)
    assert result.exit_code == 1
    assert result.stdout == ""
    assert result.stderr == f"Not verified {LABEL}: missing poll 5\n"
    assert command.closed == [True]
