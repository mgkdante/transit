from unittest.mock import MagicMock, Mock

import pytest

from transit_ops import worker_start_probe as starts


def test_missing_table_is_green_and_sends_nothing():
    engine = MagicMock()
    conn = engine.connect.return_value.__enter__.return_value
    conn.execute.return_value.mappings.return_value.one.return_value = {
        "role": "transit-db", "present": False, "readable": None,
        "core_usage": True, "core_create": False, "version_update": False,
        "core_usage_grant": False, "new_table_grants": False,
    }
    send = Mock()
    assert starts.probe(engine, send) == 0
    send.assert_not_called()


def test_probe_names_role_and_denied_access_is_failure(capsys):
    engine = MagicMock()
    conn = engine.connect.return_value.__enter__.return_value
    conn.execute.return_value.mappings.return_value.one.return_value = {
        "role": "unexpected_reader", "present": True, "readable": False,
        "core_usage": True, "core_create": False, "version_update": False,
        "core_usage_grant": False, "new_table_grants": False,
    }
    send = Mock()
    with pytest.raises(PermissionError, match="unexpected_reader"):
        starts.probe(engine, send)
    send.assert_not_called()
    assert "read_access=no" in capsys.readouterr().out


def test_fifty_starts_one_issue_and_closed_count_deduplication():
    channel = starts.AlertChannel.__new__(starts.AlertChannel)
    channel.issues = []
    channel.create = Mock()
    channel.update = Mock()
    row = {"provider_id": "stm", "start_count": 50, "last_started_at_utc": "2026-11-06"}
    channel.notify(row)
    channel.create.assert_called_once()
    body = channel.create.call_args.args[1]
    assert "50" in body and "exit code are unknown" in body
    channel.issues = [{"number": 1, "state": "OPEN", "body": body,
                       "labels": [{"name": "alert:worker-start-stm"}]}]
    channel.notify(row)
    channel.update.assert_not_called()
    row["start_count"] = 51
    channel.notify(row)
    channel.update.assert_called_once()
    assert "may not email" in channel.update.call_args.args[1]
    channel.issues[0]["state"] = "CLOSED"
    row["start_count"] = 50
    channel.notify(row)
    assert channel.create.call_count == 1
    row["start_count"] = 52
    channel.notify(row)
    assert channel.create.call_count == 2


def test_probe_permission_failure_is_not_missing_table():
    engine = MagicMock()
    engine.connect.side_effect = PermissionError("private")
    with pytest.raises(PermissionError):
        starts.probe(engine, Mock())


def test_channel_uses_existing_route_and_separate_label(monkeypatch):
    channel = starts.AlertChannel.__new__(starts.AlertChannel)
    run = Mock()
    monkeypatch.setattr(starts.subprocess, "run", run)
    channel.create("worker-start-stm", "body")
    args = run.call_args.args[0]
    assert args[0] == "bash" and args[1].endswith("alert-issue.sh")
    assert run.call_args.kwargs["env"]["ALERT_LABEL"] == "worker-restart-alert"


def test_open_issue_update_mentions_owner_preserves_text_and_high_water(monkeypatch):
    gh = Mock()
    monkeypatch.setattr(starts, "_gh", gh)
    channel = starts.AlertChannel.__new__(starts.AlertChannel)
    channel.update({"number": 7, "body": "Owner notes\n<!-- worker-start-count:50 -->"},
                   "51 starts <!-- worker-start-count:51 -->")
    assert gh.call_count == 2
    assert gh.call_args_list[0].args[:3] == ("issue", "comment", "7")
    assert "@mgkdante" in gh.call_args_list[0].args[-1]
    assert gh.call_args_list[1].args[-1] == "Owner notes\n\n<!-- worker-start-count:51 -->"


def test_workflow_is_independent_and_uses_existing_token():
    from pathlib import Path

    import yaml

    root = Path(__file__).resolve().parents[3]
    raw = (root / ".github/workflows/worker-start-probe.yml").read_text()
    doc = yaml.safe_load(raw)
    assert doc["permissions"]["issues"] == "write"
    assert "github.token" in raw and "secrets.DATABASE_URL" in raw
    assert "pipeline-alert" not in raw
    assert "freshness-probe" not in raw
    assert "daily-static" not in raw and "daily-warm" not in raw
    assert "transit_ops.worker_start_probe" in raw


def test_missing_table_logs_all_preflight_booleans_without_alerts(capsys):
    engine = MagicMock()
    conn = engine.connect.return_value.__enter__.return_value
    conn.execute.return_value.mappings.return_value.one.return_value = {
        "role": "transit-db", "present": False, "readable": None,
        "core_usage": True, "core_create": False, "version_update": False,
        "core_usage_grant": False, "new_table_grants": True,
    }
    notify = Mock()
    assert starts.probe(engine, notify) == 0
    notify.assert_not_called()
    output = capsys.readouterr().out
    assert '"core_usage": true' in output
    assert '"core_create": false' in output
    assert '"version_update": false' in output
    assert '"core_usage_grant": false' in output
    assert '"new_table_grants": true' in output


def test_real_db_preflight_runs_read_only_and_reports_capabilities(real_db_engine, capsys):
    assert starts.probe(real_db_engine, Mock()) == 0
    output = capsys.readouterr().out
    assert "role=" in output
    for capability in ("core_usage", "core_create", "version_update", "core_usage_grant",
                       "new_table_grants"):
        assert f'"{capability}": true' in output

