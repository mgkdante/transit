"""CLI contract for the D2 alert-language coverage JSON receipt."""

from __future__ import annotations

import json
from contextlib import nullcontext
from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace

from typer.testing import CliRunner

import transit_ops.cli as cli_module
from transit_ops.cli import app
from transit_ops.validation.alert_language_coverage import (
    AlertLanguageCoverageMeasurement,
    AlertLanguageCoverageReceipt,
)

runner = CliRunner()


def test_measure_alert_language_coverage_help() -> None:
    result = runner.invoke(app, ["measure-alert-language-coverage", "--help"])

    assert result.exit_code == 0
    assert "--retain" in result.stdout
    assert "7" in result.stdout
    assert "30" in result.stdout


def test_measure_alert_language_coverage_outputs_receipt_and_forwards_retain(
    monkeypatch,
) -> None:  # noqa: ANN001
    manifest = SimpleNamespace(provider=SimpleNamespace(provider_id="stm"))
    registry = SimpleNamespace(
        list_active_provider_ids=lambda: ["stm"],
        get_provider=lambda provider_id: manifest,
    )
    measurement = AlertLanguageCoverageMeasurement(
        provider_id="stm",
        provider_timezone="America/Toronto",
        window_days=7,
        window_start=date(2026, 7, 24),
        window_end=date(2026, 7, 30),
        state="available",
        explicit_en_pct=Decimal("50.00"),
        explicit_fr_pct=Decimal("100.00"),
        undetermined_pct=Decimal("0.00"),
        denominator=2,
        alert_observation_count=2,
        feed_observation_days=7,
    )
    receipt = AlertLanguageCoverageReceipt(
        measured_at_utc=datetime(2026, 7, 30, 12, tzinfo=UTC),
        retained=True,
        measurements=[measurement],
    )
    calls: list[dict[str, object]] = []
    fake_connection = object()

    def fake_run(connection, *, manifests, measured_at_utc, retain):  # noqa: ANN001, ANN202
        calls.append(
            {
                "connection": connection,
                "manifests": manifests,
                "measured_at_utc": measured_at_utc,
                "retain": retain,
            }
        )
        return receipt

    fake_settings = SimpleNamespace(LOG_LEVEL="INFO")
    monkeypatch.setattr(cli_module, "get_settings", lambda: fake_settings)
    monkeypatch.setattr(cli_module, "_provider_registry", lambda settings: registry)
    monkeypatch.setattr(
        cli_module,
        "make_engine",
        lambda settings: SimpleNamespace(begin=lambda: nullcontext(fake_connection)),
    )
    monkeypatch.setattr(
        cli_module,
        "run_alert_language_coverage_measurement",
        fake_run,
    )

    result = runner.invoke(
        app,
        ["measure-alert-language-coverage", "--retain"],
    )

    assert result.exit_code == 0
    assert len(calls) == 1
    assert calls[0]["connection"] is fake_connection
    assert calls[0]["manifests"] == [manifest]
    assert calls[0]["retain"] is True
    assert isinstance(calls[0]["measured_at_utc"], datetime)
    payload = json.loads(result.stdout)
    assert payload == {
        "measured_at_utc": "2026-07-30T12:00:00Z",
        "retained": True,
        "measurements": [
            {
                "provider_id": "stm",
                "provider_timezone": "America/Toronto",
                "window_days": 7,
                "window_start": "2026-07-24",
                "window_end": "2026-07-30",
                "state": "available",
                "explicit_en_pct": 50.0,
                "explicit_fr_pct": 100.0,
                "undetermined_pct": 0.0,
                "denominator": 2,
                "alert_observation_count": 2,
                "feed_observation_days": 7,
            }
        ],
    }
