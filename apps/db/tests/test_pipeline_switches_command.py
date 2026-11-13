import json
from contextlib import contextmanager
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from sqlalchemy.exc import SQLAlchemyError
from typer.testing import CliRunner

from transit_ops import cli
from transit_ops import pipeline_switches as switches

runner = CliRunner()


@pytest.fixture
def database(monkeypatch):
    events = []

    @contextmanager
    def begin():
        events.append("begin")
        yield
        events.append("commit")

    connection = SimpleNamespace(
        begin=begin, execute=lambda *a: SimpleNamespace(scalar_one=lambda: "db_actor")
    )

    @contextmanager
    def connect():
        yield connection
        events.append("close")

    engine = SimpleNamespace(connect=connect, dispose=lambda: events.append("dispose"))
    monkeypatch.setattr(cli, "get_settings", lambda: cli.Settings(_env_file=None))
    monkeypatch.setattr(cli, "make_engine", lambda settings: engine)
    row = switches.PipelineSwitch(
        "history_daily", True, datetime(2026, 11, 1, tzinfo=UTC), "a", "r"
    )
    monkeypatch.setattr(switches, "list_switches", lambda c: [row])
    monkeypatch.setattr(switches, "show_switch", lambda c, key: row)
    monkeypatch.setattr(switches, "set_switch", lambda *a, **kw: events.append(kw))
    return events


def test_set_list_and_show_switches(database):
    result = runner.invoke(cli.app, ["list-pipeline-switches"])
    assert result.exit_code == 0, result.output
    row = json.loads(result.stdout)[0]
    assert row == dict(
        switch_key="history_daily",
        enabled=True,
        updated_at_utc="2026-11-01T00:00:00+00:00",
        updated_by="a",
        reason="r",
    )
    for args in (
        ["show-pipeline-switch", "history_daily"],
        ["set-pipeline-switch", "history_daily", "on", "--reason", "approved", "--actor", "owner"],
    ):
        result = runner.invoke(cli.app, args)
        assert result.exit_code == 0, result.output
        assert json.loads(result.stdout) == {**row, "present": True}
        assert database[-2:] == ["close", "dispose"]


def test_missing_switch_is_shown_as_off(database, monkeypatch):
    monkeypatch.setattr(switches, "show_switch", lambda *a: None)
    result = runner.invoke(cli.app, ["show-pipeline-switch", "unknown"])
    assert result.exit_code == 0
    assert json.loads(result.stdout) == dict(
        switch_key="unknown",
        enabled=False,
        updated_at_utc=None,
        updated_by=None,
        reason=None,
        present=False,
    )


@pytest.mark.parametrize(
    "error",
    [
        switches.GuardRefused("not ready"),
        switches.SchemaNotReady("schema not ready"),
        SQLAlchemyError("private detail"),
    ],
)
def test_switch_command_reports_refusals(database, monkeypatch, error):
    def refuse(*a, **kw):
        raise error

    monkeypatch.setattr(switches, "set_switch", refuse)
    result = runner.invoke(
        cli.app, ["set-pipeline-switch", "history_daily", "on", "--reason", "approved"]
    )
    assert result.exit_code == 1
    assert len(result.stderr.splitlines()) == 1
    assert "private detail" not in result.stderr
    assert database[-1] == "dispose"


def test_switch_command_uses_database_actor_when_omitted(database, monkeypatch):
    def readback(*a):
        assert database[-2] == "commit"
        assert database[-1]["updated_by"] == "db_actor"
        return None

    monkeypatch.setattr(switches, "show_switch", readback)
    result = runner.invoke(
        cli.app, ["set-pipeline-switch", "history_daily", "off", "--reason", "approved"]
    )
    assert result.exit_code == 0, result.output


@pytest.mark.parametrize(
    "args",
    [
        ["x", "invalid", "--reason", "r"],
        ["x", "on", "--reason", " "],
        ["x", "on", "--reason", "r", "--actor", ""],
        ["x\n", "on", "--reason", "r"],
    ],
)
def test_switch_command_validates_before_mutation(database, args):
    result = runner.invoke(cli.app, ["set-pipeline-switch", *args])
    assert result.exit_code == 2
    assert not database


def test_missing_switch_table_setter_is_off_and_cannot_enable():
    events = []

    @contextmanager
    def begin():
        yield
        events.append("commit")

    connection = SimpleNamespace(
        in_transaction=lambda: False,
        begin=begin,
        execute=lambda *a: SimpleNamespace(scalar_one=lambda: None),
    )
    switches.set_switch(connection, "history_daily", on=False, updated_by="a", reason="r")
    assert events == ["commit"]
    with pytest.raises(switches.SchemaNotReady):
        switches.set_switch(connection, "history_daily", on=True, updated_by="a", reason="r")


@pytest.mark.parametrize("on", [False, True])
def test_reserved_keys_and_invalid_transactions_do_no_io(on):
    with pytest.raises(ValueError, match="set-stop-time-diet"):
        switches.set_switch(None, "stop_time_diet:any", on=on, updated_by="a", reason="r")
    connection = SimpleNamespace(in_transaction=lambda: True)
    with pytest.raises(ValueError, match="transaction"):
        switches.set_switch(connection, "x", on=on, updated_by="a", reason="r")
