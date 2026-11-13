import json
from contextlib import nullcontext
from unittest.mock import Mock

import pytest
from typer.testing import CliRunner

from transit_ops import cli
from transit_ops.history import probe, storage

ARGS = "history-probe-pack --provider network --feed trip_updates --date 2026-01-02".split()


@pytest.mark.parametrize(
    "args", [ARGS[:1], ARGS[:-2], ARGS[:-1] + ["20260102"], ARGS + ["--end", "2026-01-03"]]
)
def test_probe_command_requires_one_provider_feed_and_date(args):
    assert CliRunner().invoke(cli.app, args).exit_code == 2


@pytest.mark.parametrize("failure", [False, True])
def test_probe_command_emits_report_and_closes_resources(monkeypatch, failure):
    closed = []

    def run(*a, **kw):
        if failure:
            raise RuntimeError("private response body")
        return probe.Finding(1, "object_absent")

    engine, scope = Mock(), Mock()
    engine.connect.return_value = nullcontext(object())
    engine.dispose.side_effect = lambda: closed.append("engine")
    scope.close.side_effect = lambda: closed.append("scope")
    monkeypatch.setattr(cli, "get_settings", lambda: None)
    monkeypatch.setattr(cli, "make_engine", lambda _: engine)
    monkeypatch.setattr(storage, "history_storage", lambda _: scope)
    monkeypatch.setattr(probe, "probe_capture_day", run)
    result = CliRunner().invoke(cli.app, ARGS)
    assert closed == ["scope", "engine"]
    if failure:
        assert result.exit_code == 1 and "private" not in result.output
        assert "2026-01-02" in result.stderr and result.stdout == ""
    else:
        assert result.exit_code == 0 and json.loads(result.stdout) == dict(
            capture_row_id=1, reason="object_absent"
        )


def test_probe_command_reports_safe_failures(monkeypatch):
    def fail():
        raise ValueError("private settings")

    monkeypatch.setattr(cli, "get_settings", fail)
    result = CliRunner().invoke(cli.app, ARGS)
    assert result.exit_code == 1 and "private" not in result.output
