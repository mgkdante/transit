from datetime import UTC, datetime

from typer.testing import CliRunner

import transit_ops.cli as cli_module
from transit_ops.cli import app
from transit_ops.orchestration import RealtimeCycleResult

runner = CliRunner()


def test_cli_help() -> None:
    result = runner.invoke(app, ["--help"])

    assert result.exit_code == 0
    assert "show-config" in result.stdout
    assert "list-providers" in result.stdout
    assert "show-provider" in result.stdout
    assert "db-test" in result.stdout
    assert "init-db" in result.stdout
    assert "seed-core" in result.stdout
    assert "ingest-static" in result.stdout
    assert "capture-realtime" in result.stdout
    assert "load-static-silver" in result.stdout
    assert "load-realtime-silver" in result.stdout
    assert "build-gold-marts" in result.stdout
    assert "refresh-gold-realtime" in result.stdout
    assert "refresh-gold-static" in result.stdout
    assert "prune-silver-storage" in result.stdout
    assert "vacuum-storage" in result.stdout
    assert "run-static-pipeline" in result.stdout
    assert "run-realtime-cycle" in result.stdout
    assert "run-realtime-worker" in result.stdout


def test_ingest_static_help() -> None:
    result = runner.invoke(app, ["ingest-static", "--help"])

    assert result.exit_code == 0
    assert "Download, archive, and register one static GTFS feed." in result.stdout


def test_capture_realtime_help() -> None:
    result = runner.invoke(app, ["capture-realtime", "--help"])

    assert result.exit_code == 0
    assert "Capture, archive, and register one GTFS-RT snapshot." in result.stdout


def test_load_static_silver_help() -> None:
    result = runner.invoke(app, ["load-static-silver", "--help"])

    assert result.exit_code == 0
    assert "Parse the latest Bronze static GTFS archive into Silver tables." in result.stdout


def test_load_realtime_silver_help() -> None:
    result = runner.invoke(app, ["load-realtime-silver", "--help"])

    assert result.exit_code == 0
    assert "Parse the latest Bronze realtime snapshot into Silver tables." in result.stdout


def test_build_gold_marts_help() -> None:
    result = runner.invoke(app, ["build-gold-marts", "--help"])

    assert result.exit_code == 0
    assert "Run the heavy full-history Gold rebuild" in result.stdout


def test_refresh_gold_realtime_help() -> None:
    result = runner.invoke(app, ["refresh-gold-realtime", "--help"])

    assert result.exit_code == 0
    assert "Upsert the latest realtime snapshots into Gold history" in result.stdout


def test_refresh_gold_static_help() -> None:
    result = runner.invoke(app, ["refresh-gold-static", "--help"])

    assert result.exit_code == 0
    assert "Refresh only Gold dimension tables" in result.stdout


def test_refresh_gold_static_calls_refresh_gold_static(monkeypatch) -> None:
    from datetime import UTC, datetime

    from transit_ops.gold import GoldStaticRefreshResult

    recorded: dict[str, object] = {}

    def fake_refresh_gold_static(provider_id, *, settings, registry):  # noqa: ANN001
        recorded["provider_id"] = provider_id
        return GoldStaticRefreshResult(
            provider_id=provider_id,
            provider_timezone="America/Toronto",
            dataset_version_id=7,
            refreshed_at_utc=datetime(2026, 3, 25, 0, 2, 0, tzinfo=UTC),
            row_counts={"dim_route": 100, "dim_stop": 200, "dim_date": 365},
        )

    monkeypatch.setattr(cli_module, "refresh_gold_static", fake_refresh_gold_static)

    result = runner.invoke(app, ["refresh-gold-static", "stm"])

    assert result.exit_code == 0
    assert recorded == {"provider_id": "stm"}
    assert '"dim_route": 100' in result.stdout
    assert '"dataset_version_id": 7' in result.stdout


def test_prune_silver_storage_help() -> None:
    result = runner.invoke(app, ["prune-silver-storage", "--help"])

    assert result.exit_code == 0
    assert "Prune old static and realtime Silver rows" in result.stdout


def test_vacuum_storage_help() -> None:
    result = runner.invoke(app, ["vacuum-storage", "--help"])

    assert result.exit_code == 0
    assert "Run one-shot storage maintenance" in result.stdout
    assert "--full" in result.stdout


def test_run_static_pipeline_help() -> None:
    result = runner.invoke(app, ["run-static-pipeline", "--help"])

    assert result.exit_code == 0
    assert "Run ingest-static, load-static-silver, and refresh-gold-static" in result.stdout


def test_run_realtime_cycle_help() -> None:
    result = runner.invoke(app, ["run-realtime-cycle", "--help"])

    assert result.exit_code == 0
    assert "Run both realtime captures, both Silver loads, refresh Gold" in result.stdout


def test_run_realtime_worker_help() -> None:
    result = runner.invoke(app, ["run-realtime-worker", "--help"])

    assert result.exit_code == 0
    assert "Run the realtime cycle forever with configurable polling delays." in result.stdout
    assert "--max-cycles" in result.stdout


def test_run_realtime_worker_passes_max_cycles(monkeypatch) -> None:
    recorded: dict[str, object] = {}

    def fake_run_realtime_worker_loop(
        provider_id, *, settings, registry, max_cycles
    ):  # noqa: ANN001
        recorded["provider_id"] = provider_id
        recorded["max_cycles"] = max_cycles

    monkeypatch.setattr(cli_module, "run_realtime_worker_loop", fake_run_realtime_worker_loop)

    result = runner.invoke(app, ["run-realtime-worker", "stm", "--max-cycles", "2"])

    assert result.exit_code == 0
    assert recorded == {"provider_id": "stm", "max_cycles": 2}


def test_run_realtime_cycle_returns_non_zero_on_partial_failure(monkeypatch) -> None:
    monkeypatch.setattr(
        cli_module,
        "run_realtime_cycle",
        lambda provider_id, settings, registry: RealtimeCycleResult(
            provider_id=provider_id,
            status="partial_failure",
            started_at_utc=datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC),
            completed_at_utc=datetime(2026, 3, 25, 0, 0, 1, tzinfo=UTC),
            total_duration_seconds=1.0,
            successful_endpoint_count=1,
            failed_endpoint_count=1,
            endpoint_results=[],
            step_timings_seconds={
                "capture_trip_updates": 0.25,
                "load_trip_updates_to_silver": 0.5,
                "capture_vehicle_positions": 0.25,
                "load_vehicle_positions_to_silver": None,
                "refresh_gold_realtime": 0.25,
                "prune_silver_storage": None,
                "prune_gold_storage": None,
            },
            gold_build=None,
            gold_build_duration_seconds=0.25,
            gold_error_message=None,
            silver_maintenance=None,
            silver_maintenance_duration_seconds=None,
            silver_maintenance_error_message=None,
            gold_maintenance=None,
            gold_maintenance_duration_seconds=None,
            gold_maintenance_error_message=None,
        ),
    )

    result = runner.invoke(app, ["run-realtime-cycle", "stm"])

    assert result.exit_code == 1
    assert '"status": "partial_failure"' in result.stdout
