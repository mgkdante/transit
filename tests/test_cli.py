import json
from datetime import UTC, date, datetime

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
    assert "prune-gold-storage" in result.stdout
    assert "prune-bronze-storage" in result.stdout
    assert "vacuum-storage" in result.stdout
    assert "run-static-pipeline" in result.stdout
    assert "run-realtime-cycle" in result.stdout
    assert "run-realtime-worker" in result.stdout
    assert "build-warm-rollups" in result.stdout
    assert "prune-warm-rollup-storage" in result.stdout
    assert "rebuild-oracle-data" in result.stdout
    assert "validate-static-feeds" in result.stdout


def test_ingest_static_help() -> None:
    result = runner.invoke(app, ["ingest-static", "--help"])

    assert result.exit_code == 0
    assert "Download, archive, and register one static GTFS feed." in result.stdout


def test_validate_static_feeds_help() -> None:
    result = runner.invoke(app, ["validate-static-feeds", "--help"])

    assert result.exit_code == 0
    assert "Validate current and beta static GTFS feeds without ingesting them." in result.stdout


def test_validate_static_feeds_passes_provider_and_writes_report(
    monkeypatch, tmp_path
) -> None:
    from dataclasses import dataclass

    recorded: dict[str, object] = {}
    report_path = tmp_path / "static-validation.json"

    @dataclass(frozen=True)
    class FakeValidationResult:
        provider_id: str

        def display_dict(self) -> dict[str, object]:
            return {
                "provider_id": self.provider_id,
                "validated_at_utc": "2026-05-24T12:00:00+00:00",
                "current": {"status": "ok"},
                "beta": {"status": "ok"},
                "comparison": {"both_available": True},
            }

    def fake_validate_static_feeds(provider_id, *, settings, registry):  # noqa: ANN001
        recorded["provider_id"] = provider_id
        recorded["settings_type"] = type(settings).__name__
        recorded["registry_type"] = type(registry).__name__
        return FakeValidationResult(provider_id=provider_id)

    monkeypatch.setattr(cli_module, "validate_static_feeds", fake_validate_static_feeds)

    result = runner.invoke(
        app,
        ["validate-static-feeds", "stm", "--report-path", str(report_path)],
    )

    assert result.exit_code == 0
    assert recorded["provider_id"] == "stm"
    stdout_payload = json.loads(result.stdout)
    report_payload = json.loads(report_path.read_text(encoding="utf-8"))
    assert stdout_payload == report_payload
    assert report_payload["provider_id"] == "stm"


def test_validate_static_feeds_bad_report_path_exits_before_validation(
    monkeypatch, tmp_path
) -> None:
    called = False

    def fake_validate_static_feeds(provider_id, *, settings, registry):  # noqa: ANN001
        nonlocal called
        called = True
        raise AssertionError("validator should not be called")

    monkeypatch.setattr(cli_module, "validate_static_feeds", fake_validate_static_feeds)

    result = runner.invoke(
        app,
        ["validate-static-feeds", "stm", "--report-path", str(tmp_path)],
    )

    assert result.exit_code != 0
    assert called is False
    assert "--report-path must be a file path" in result.stderr


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


def test_prune_bronze_storage_help() -> None:
    result = runner.invoke(app, ["prune-bronze-storage", "--help"])

    assert result.exit_code == 0
    assert "Prune old Bronze R2 objects and raw metadata" in result.stdout
    assert "--dry-run" in result.stdout


def test_vacuum_storage_table_option_in_help() -> None:
    result = runner.invoke(app, ["vacuum-storage", "--help"])

    assert result.exit_code == 0
    assert "--table" in result.stdout


def test_prune_silver_storage_dry_run_flag(monkeypatch) -> None:
    from transit_ops.maintenance import SilverStoragePruneResult

    recorded: dict[str, object] = {}

    def fake_prune_silver_storage(provider_id, *, settings, dry_run):  # noqa: ANN001
        recorded["provider_id"] = provider_id
        recorded["dry_run"] = dry_run
        return SilverStoragePruneResult(
            provider_id=provider_id,
            dry_run=dry_run,
            static_dataset_retention_count=1,
            realtime_retention_days=2,
            retained_dataset_version_ids=[1],
            pruned_dataset_version_ids=[],
            realtime_cutoff_utc=None,
            deleted_row_counts={},
            completed_at_utc=datetime(2026, 3, 27, 0, 0, 0, tzinfo=UTC),
        )

    monkeypatch.setattr(cli_module, "prune_silver_storage", fake_prune_silver_storage)

    result = runner.invoke(app, ["prune-silver-storage", "stm", "--dry-run"])

    assert result.exit_code == 0
    assert recorded["dry_run"] is True


def test_prune_gold_storage_dry_run_flag(monkeypatch) -> None:
    from transit_ops.maintenance import GoldStoragePruneResult

    recorded: dict[str, object] = {}

    def fake_prune_gold_storage(provider_id, *, settings, dry_run):  # noqa: ANN001
        recorded["provider_id"] = provider_id
        recorded["dry_run"] = dry_run
        return GoldStoragePruneResult(
            provider_id=provider_id,
            dry_run=dry_run,
            retention_days=2,
            cutoff_utc=None,
            deleted_row_counts={},
            completed_at_utc=datetime(2026, 3, 27, 0, 0, 0, tzinfo=UTC),
        )

    monkeypatch.setattr(cli_module, "prune_gold_storage", fake_prune_gold_storage)

    result = runner.invoke(app, ["prune-gold-storage", "stm", "--dry-run"])

    assert result.exit_code == 0
    assert recorded["dry_run"] is True


def test_prune_bronze_storage_dry_run_flag(monkeypatch) -> None:
    from transit_ops.maintenance import BronzeStoragePruneResult

    recorded: dict[str, object] = {}

    def fake_prune_bronze_storage(provider_id, *, settings, dry_run):  # noqa: ANN001
        recorded["provider_id"] = provider_id
        recorded["dry_run"] = dry_run
        return BronzeStoragePruneResult(
            provider_id=provider_id,
            dry_run=dry_run,
            realtime_retention_days=7,
            static_retention_days=30,
            realtime_cutoff_utc=None,
            static_cutoff_utc=None,
            deleted_object_counts={"realtime": 0, "static": 0},
            deleted_metadata_counts={
                "raw.realtime_snapshot_index": 0,
                "raw.ingestion_objects": 0,
                "raw.ingestion_runs": 0,
            },
            completed_at_utc=datetime(2026, 3, 27, 0, 0, 0, tzinfo=UTC),
        )

    monkeypatch.setattr(cli_module, "prune_bronze_storage", fake_prune_bronze_storage)

    result = runner.invoke(app, ["prune-bronze-storage", "stm", "--dry-run"])

    assert result.exit_code == 0
    assert recorded["dry_run"] is True


def test_init_db_requires_database_url(monkeypatch) -> None:
    monkeypatch.setattr(cli_module, "get_settings", lambda: cli_module.Settings(_env_file=None))

    result = runner.invoke(app, ["init-db"])

    assert result.exit_code == 2
    assert "Invalid value: DATABASE_URL is required for init-db." in result.output


def test_build_warm_rollups_help() -> None:
    result = runner.invoke(app, ["build-warm-rollups", "--help"])

    assert result.exit_code == 0
    assert "Build 5-minute warm rollups" in result.stdout
    assert "--since" in result.stdout


def test_rebuild_oracle_data_help() -> None:
    result = runner.invoke(app, ["rebuild-oracle-data", "--help"])

    assert result.exit_code == 0
    assert "Guarded Oracle data rebuild" in result.stdout
    assert "--month" in result.stdout
    assert "--execute" in result.stdout
    assert "--delete-r2" in result.stdout
    assert "--confirm-reset" in result.stdout
    assert "--confirm-worker-stopped" in result.stdout
    assert "--confirm-r2-delete-before" in result.stdout
    assert "--report-path" in result.stdout


class FakeOracleCliResult:
    def __init__(self, provider_id: str, dry_run: bool) -> None:
        self.provider_id = provider_id
        self.dry_run = dry_run

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "dry_run": self.dry_run,
            "completed_at_utc": "2026-05-01T00:00:00+00:00",
        }


def test_rebuild_oracle_data_passes_flags_options(monkeypatch) -> None:
    recorded: dict[str, object] = {}

    def fake_rebuild_oracle_data(
        provider_id,
        *,
        month,
        execute,
        delete_r2,
        confirm_reset,
        confirm_worker_stopped,
        confirm_r2_delete_before,
        settings,
    ):  # noqa: ANN001
        recorded.update(
            {
                "provider_id": provider_id,
                "month": month,
                "execute": execute,
                "delete_r2": delete_r2,
                "confirm_reset": confirm_reset,
                "confirm_worker_stopped": confirm_worker_stopped,
                "confirm_r2_delete_before": confirm_r2_delete_before,
                "settings": settings,
            }
        )
        return FakeOracleCliResult(provider_id, dry_run=not execute)

    monkeypatch.setattr(cli_module, "rebuild_oracle_data", fake_rebuild_oracle_data)

    result = runner.invoke(
        app,
        [
            "rebuild-oracle-data",
            "stm",
            "--month",
            "2026-05",
            "--execute",
            "--delete-r2",
            "--confirm-reset",
            "--confirm-worker-stopped",
            "--confirm-r2-delete-before",
            "2026-05-01",
        ],
    )

    assert result.exit_code == 0
    assert recorded["provider_id"] == "stm"
    assert recorded["month"] == "2026-05"
    assert recorded["execute"] is True
    assert recorded["delete_r2"] is True
    assert recorded["confirm_reset"] is True
    assert recorded["confirm_worker_stopped"] is True
    assert recorded["confirm_r2_delete_before"] == date(2026, 5, 1)
    assert '"dry_run": false' in result.stdout


def test_rebuild_oracle_data_rejects_non_may_month(monkeypatch) -> None:
    def fake_rebuild_oracle_data(provider_id, *, month, **kwargs):  # noqa: ANN001
        raise ValueError(f"Oracle rebuild only supports month 2026-05, got {month}.")

    monkeypatch.setattr(cli_module, "rebuild_oracle_data", fake_rebuild_oracle_data)

    result = runner.invoke(app, ["rebuild-oracle-data", "stm", "--month", "2026-04"])

    assert result.exit_code == 2
    assert "Invalid value: Oracle rebuild only supports month 2026-05" in result.output


def test_rebuild_oracle_data_writes_report_path(monkeypatch, tmp_path) -> None:
    report_path = tmp_path / "oracle-report.json"

    monkeypatch.setattr(
        cli_module,
        "rebuild_oracle_data",
        lambda provider_id, **kwargs: FakeOracleCliResult(provider_id, dry_run=True),
    )

    result = runner.invoke(
        app,
        ["rebuild-oracle-data", "stm", "--report-path", str(report_path)],
    )

    assert result.exit_code == 0
    assert json.loads(report_path.read_text()) == {
        "provider_id": "stm",
        "dry_run": True,
        "completed_at_utc": "2026-05-01T00:00:00+00:00",
    }
    assert '"provider_id": "stm"' in result.stdout


def test_rebuild_oracle_data_bad_report_path_prevents_rebuild(monkeypatch, tmp_path) -> None:
    called = False

    def fake_rebuild_oracle_data(provider_id, **kwargs):  # noqa: ANN001
        nonlocal called
        called = True
        return FakeOracleCliResult(provider_id, dry_run=True)

    monkeypatch.setattr(cli_module, "rebuild_oracle_data", fake_rebuild_oracle_data)

    result = runner.invoke(
        app,
        [
            "rebuild-oracle-data",
            "stm",
            "--report-path",
            str(tmp_path / "missing" / "oracle-report.json"),
        ],
    )

    assert result.exit_code == 2
    assert "Invalid value" in result.output
    assert called is False


def test_rebuild_oracle_data_directory_report_path_prevents_rebuild(
    monkeypatch,
    tmp_path,
) -> None:
    called = False

    def fake_rebuild_oracle_data(provider_id, **kwargs):  # noqa: ANN001
        nonlocal called
        called = True
        return FakeOracleCliResult(provider_id, dry_run=True)

    monkeypatch.setattr(cli_module, "rebuild_oracle_data", fake_rebuild_oracle_data)

    result = runner.invoke(
        app,
        ["rebuild-oracle-data", "stm", "--report-path", str(tmp_path)],
    )

    assert result.exit_code == 2
    assert "Invalid value" in result.output
    assert called is False


def test_rebuild_oracle_data_surfaces_guardrail_failure_as_invalid_parameter(
    monkeypatch,
) -> None:
    def fake_rebuild_oracle_data(provider_id, **kwargs):  # noqa: ANN001
        raise ValueError("guardrail failed")

    monkeypatch.setattr(cli_module, "rebuild_oracle_data", fake_rebuild_oracle_data)

    result = runner.invoke(app, ["rebuild-oracle-data", "stm", "--execute"])

    assert result.exit_code == 2
    assert "Invalid value: guardrail failed" in result.output


def test_prune_warm_rollup_storage_help() -> None:
    result = runner.invoke(app, ["prune-warm-rollup-storage", "--help"])

    assert result.exit_code == 0
    assert "GOLD_WARM_ROLLUP_RETENTION_DAYS" in result.stdout
    assert "--dry-run" in result.stdout


def test_prune_warm_rollup_storage_dry_run_flag(monkeypatch) -> None:
    from transit_ops.maintenance import WarmRollupStoragePruneResult

    recorded: dict[str, object] = {}

    def fake_prune_warm_rollup_storage(provider_id, *, settings, dry_run):  # noqa: ANN001
        recorded["provider_id"] = provider_id
        recorded["dry_run"] = dry_run
        return WarmRollupStoragePruneResult(
            provider_id=provider_id,
            dry_run=dry_run,
            retention_days=90,
            cutoff_utc=None,
            deleted_row_counts={
                "gold.vehicle_summary_5m": 0,
                "gold.trip_delay_summary_5m": 0,
                "gold.warm_rollup_periods": 0,
            },
            completed_at_utc=datetime(2026, 3, 27, 0, 0, 0, tzinfo=UTC),
        )

    monkeypatch.setattr(cli_module, "prune_warm_rollup_storage", fake_prune_warm_rollup_storage)

    result = runner.invoke(app, ["prune-warm-rollup-storage", "stm", "--dry-run"])

    assert result.exit_code == 0
    assert recorded["dry_run"] is True


def test_build_warm_rollups_calls_build_warm_rollups(monkeypatch) -> None:
    from transit_ops.gold import WarmRollupBuildResult

    recorded: dict[str, object] = {}

    def fake_build_warm_rollups(provider_id, *, settings, since_utc):  # noqa: ANN001
        recorded["provider_id"] = provider_id
        recorded["since_utc"] = since_utc
        return WarmRollupBuildResult(
            provider_id=provider_id,
            since_utc=since_utc,
            built_vehicle_periods=3,
            built_trip_delay_periods=3,
            completed_at_utc=datetime(2026, 3, 27, 7, 0, 0, tzinfo=UTC),
        )

    monkeypatch.setattr(cli_module, "build_warm_rollups", fake_build_warm_rollups)

    result = runner.invoke(app, ["build-warm-rollups", "stm"])

    assert result.exit_code == 0
    assert recorded["provider_id"] == "stm"
    assert recorded["since_utc"] is None
    assert '"built_vehicle_periods": 3' in result.stdout


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
