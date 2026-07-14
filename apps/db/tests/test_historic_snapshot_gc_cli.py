from __future__ import annotations

import json
from types import SimpleNamespace

from typer.testing import CliRunner

import transit_ops.cli as cli_module
from transit_ops.cli import app
from transit_ops.snapshots.historic_gc import HistoricGcBlockedError

runner = CliRunner()


class _Registry:
    def get_provider(self, provider_id: str) -> object:
        assert provider_id == "stm"
        return object()


def _stub_command(monkeypatch, calls: list[dict]) -> None:
    settings = SimpleNamespace(LOG_LEVEL="INFO")
    monkeypatch.setattr(cli_module, "get_settings", lambda: settings)
    monkeypatch.setattr(cli_module, "_provider_registry", lambda _settings: _Registry())
    monkeypatch.setattr(cli_module, "_skip_if_unseeded", lambda *_args, **_kwargs: False)

    def fake_run(provider_id: str, **kwargs):
        calls.append({"provider_id": provider_id, **kwargs})
        return SimpleNamespace(display_dict=lambda: {"provider_id": provider_id, "status": "pass"})

    monkeypatch.setattr(cli_module, "run_historic_snapshot_gc", fake_run, raising=False)


def test_historic_gc_cli_defaults_to_dry_run_and_writes_receipt(monkeypatch, tmp_path) -> None:
    calls: list[dict] = []
    _stub_command(monkeypatch, calls)
    report_path = tmp_path / "gc.json"

    result = runner.invoke(
        app,
        ["gc-historic-snapshots", "stm", "--report-path", str(report_path)],
    )

    assert result.exit_code == 0, result.output
    assert calls[0]["mode"] == "dry-run"
    assert json.loads(report_path.read_text(encoding="utf-8")) == {
        "provider_id": "stm",
        "status": "pass",
    }


def test_historic_gc_cli_accepts_explicit_mark_but_not_apply(monkeypatch, tmp_path) -> None:
    calls: list[dict] = []
    _stub_command(monkeypatch, calls)

    marked = runner.invoke(
        app,
        [
            "gc-historic-snapshots",
            "stm",
            "--mode",
            "mark",
            "--report-path",
            str(tmp_path / "mark.json"),
        ],
    )
    refused = runner.invoke(
        app,
        [
            "gc-historic-snapshots",
            "stm",
            "--mode",
            "apply",
            "--report-path",
            str(tmp_path / "apply.json"),
        ],
    )

    assert marked.exit_code == 0, marked.output
    assert len(calls) == 1
    assert calls[0]["provider_id"] == "stm"
    assert calls[0]["mode"] == "mark"
    assert isinstance(calls[0]["registry"], _Registry)
    assert refused.exit_code == 2
    assert "apply" in refused.output


def test_historic_gc_cli_writes_failure_receipt_before_nonzero_exit(monkeypatch, tmp_path) -> None:
    calls: list[dict] = []
    _stub_command(monkeypatch, calls)
    report_path = tmp_path / "failed.json"

    def fail(*_args, **_kwargs):
        raise HistoricGcBlockedError("missing_object:historic/history/index.json")

    monkeypatch.setattr(cli_module, "run_historic_snapshot_gc", fail)

    result = runner.invoke(
        app,
        ["gc-historic-snapshots", "stm", "--report-path", str(report_path)],
    )

    assert result.exit_code == 1
    assert json.loads(report_path.read_text(encoding="utf-8")) == {
        "failure": "missing_object:historic/history/index.json",
        "failure_type": "HistoricGcBlockedError",
        "mode": "dry-run",
        "provider_id": "stm",
        "status": "fail",
    }


def test_historic_gc_cli_writes_an_honest_unseeded_provider_receipt(
    monkeypatch,
    tmp_path,
) -> None:
    calls: list[dict] = []
    _stub_command(monkeypatch, calls)
    monkeypatch.setattr(cli_module, "_skip_if_unseeded", lambda *_args, **_kwargs: True)
    report_path = tmp_path / "unseeded.json"

    result = runner.invoke(
        app,
        [
            "gc-historic-snapshots",
            "stm",
            "--mode",
            "mark",
            "--report-path",
            str(report_path),
        ],
    )

    assert result.exit_code == 0, result.output
    assert calls == []
    assert json.loads(report_path.read_text(encoding="utf-8")) == {
        "mode": "mark",
        "provider_id": "stm",
        "skipped_not_seeded": True,
        "status": "skip",
    }
