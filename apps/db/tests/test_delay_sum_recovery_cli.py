from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from typer.testing import CliRunner

from transit_ops import cli
from transit_ops.gold.delay_sums import DelaySumRecovery
from transit_ops.settings import Settings


@pytest.mark.parametrize("execute", [False, True])
def test_recovery_cli_previews_unless_execution_is_explicit(monkeypatch, execute):
    calls = []
    monkeypatch.setattr(cli, "get_settings", lambda: Settings(_env_file=None))
    monkeypatch.setattr(cli, "assert_explicit_remote_url", lambda *args: calls.append("intent"))

    def recover(provider, **kwargs):
        calls.append(kwargs)
        return DelaySumRecovery(
            provider, kwargs["from_utc"], kwargs["until_utc"], kwargs["dry_run"]
        )

    monkeypatch.setattr(cli, "recover_delay_sums", recover)
    result = CliRunner().invoke(
        cli.app,
        [
            "recover-delay-sums",
            "stm",
            "--from",
            "2026-09-01",
            "--until",
            "2026-09-05",
            *(["--execute"] if execute else []),
        ],
    )
    assert result.exit_code == 0, result.output
    assert calls[-1]["dry_run"] is not execute
    assert calls[-1]["from_utc"] == datetime(2026, 9, 1, tzinfo=UTC)
    assert calls[-1]["until_utc"] == datetime(2026, 9, 5, tzinfo=UTC)
    assert ("intent" in calls) is execute


@pytest.mark.parametrize("start,end", [("invalid", "2026-09-05"), ("2026-09-06", "2026-09-05")])
def test_recovery_cli_rejects_invalid_bounds_without_connecting(monkeypatch, start, end):
    monkeypatch.setattr(cli, "get_settings", lambda: Settings(_env_file=None))
    result = CliRunner().invoke(
        cli.app,
        [
            "recover-delay-sums",
            "stm",
            "--from",
            start,
            "--until",
            end,
        ],
    )
    assert result.exit_code == 2


@pytest.mark.parametrize("execute", [False, True])
def test_period_repair_cli_keeps_preview_and_execution_distinct(monkeypatch, execute):
    calls = []
    monkeypatch.setattr(cli, "get_settings", lambda: Settings(_env_file=None))
    monkeypatch.setattr(cli, "assert_explicit_remote_url", lambda *args: calls.append("intent"))
    monkeypatch.setattr(cli, "make_engine", lambda settings: SimpleNamespace(dispose=lambda: None))

    def repair(engine, **kwargs):
        calls.append(kwargs)
        kwargs["progress"].committed_rows = int(not kwargs["dry_run"])
        return 1

    monkeypatch.setattr(cli, "build_delay_periods", repair)
    monkeypatch.setattr(
        cli, "refresh_changed_delay_hours", lambda *args: calls.append("parents") or 1
    )
    result = CliRunner().invoke(
        cli.app,
        [
            "repair-delay-periods",
            "stm",
            "--from",
            "2026-09-04T11:55:00+0000",
            "--until",
            "2026-09-04T12:00:00+0000",
            *(["--execute"] if execute else []),
        ],
    )
    assert result.exit_code == 0, result.output
    request = next(item for item in calls if isinstance(item, dict))
    assert request["repair_premature"] is True
    assert request["dry_run"] is not execute
    assert request["since_utc"] == datetime(2026, 9, 4, 11, 55, tzinfo=UTC)
    assert ("intent" in calls) is execute
    assert ("parents" in calls) is execute
