import json
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace

from typer.testing import CliRunner

import transit_ops.cli as cli_module
from transit_ops.backups import BackupError
from transit_ops.cli import app
from transit_ops.orchestration import RealtimeCycleResult

runner = CliRunner()
LEGACY_ORACLE_REBUILD_COMMAND = "rebuild-" + "oracle-data"
LEGACY_BETA_REBUILD_COMMAND = "rebuild-" + "beta-static"


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
    assert "ingest-gis" in result.stdout
    assert "capture-realtime" in result.stdout
    assert "capture-i3" in result.stdout
    assert "load-gis-silver" in result.stdout
    assert "load-static-silver" in result.stdout
    assert "load-realtime-silver" in result.stdout
    assert "load-i3-silver" in result.stdout
    assert "build-gold-marts" in result.stdout
    assert "replay-realtime-silver" in result.stdout
    assert "refresh-gold-realtime" in result.stdout
    assert "refresh-gold-static" in result.stdout
    assert "prune-silver-storage" in result.stdout
    assert "prune-gold-storage" in result.stdout
    assert "prune-bronze-storage" in result.stdout
    assert "prune-i3-storage" in result.stdout
    assert "vacuum-storage" in result.stdout
    assert "run-static-pipeline" in result.stdout
    assert "run-realtime-cycle" in result.stdout
    assert "run-realtime-worker" in result.stdout
    assert "build-warm-rollups" in result.stdout
    assert "prune-warm-rollup-storage" in result.stdout
    assert "rebuild-source-factory" in result.stdout
    assert LEGACY_ORACLE_REBUILD_COMMAND not in result.stdout
    assert LEGACY_BETA_REBUILD_COMMAND not in result.stdout
    assert "validate-static-feeds" in result.stdout
    assert "retention-proof-report" in result.stdout
    assert "recover" in result.stdout


def test_recover_help_mentions_health_report_and_guardrails() -> None:
    result = runner.invoke(app, ["recover", "--help"])

    assert result.exit_code == 0
    assert "/health" in result.stdout
    assert "report/webhook target" in result.stdout
    assert "restart-worker" in result.stdout
    assert "restart-health" in result.stdout
    assert "restart-pipeline" in result.stdout
    assert "reboot-vm" in result.stdout
    assert "--execute" in result.stdout
    assert "--confirm" in result.stdout


def test_recover_outputs_json_payload(monkeypatch) -> None:
    class FakeRecoveryResult:
        def display_dict(self) -> dict[str, object]:
            return {
                "action_id": "restart-worker",
                "execute": False,
                "commands": [
                    "docker compose --env-file .env -f docker-compose.yml restart worker"
                ],
                "status": "planned",
                "return_code": None,
                "stdout": None,
                "stderr": None,
                "completed_at_utc": "2026-05-25T12:00:00+00:00",
            }

    recorded: dict[str, object] = {}

    def fake_run_recovery_action(action_id, *, execute, confirmation):  # noqa: ANN001
        recorded["action_id"] = action_id
        recorded["execute"] = execute
        recorded["confirmation"] = confirmation
        return FakeRecoveryResult()

    monkeypatch.setattr(cli_module, "run_recovery_action", fake_run_recovery_action)

    result = runner.invoke(app, ["recover", "restart-worker"])

    assert result.exit_code == 0
    assert recorded == {
        "action_id": "restart-worker",
        "execute": False,
        "confirmation": None,
    }
    assert json.loads(result.stdout)["status"] == "planned"


def test_recover_exits_nonzero_on_failed_command(monkeypatch) -> None:
    class FakeRecoveryResult:
        def display_dict(self) -> dict[str, object]:
            return {
                "action_id": "restart-pipeline",
                "execute": True,
                "commands": ["bash scripts/resume-pipeline.sh"],
                "status": "failed",
                "return_code": 1,
                "stdout": "",
                "stderr": "unit missing\n",
                "completed_at_utc": "2026-05-25T12:00:00+00:00",
            }

    monkeypatch.setattr(
        cli_module,
        "run_recovery_action",
        lambda action_id, *, execute, confirmation: FakeRecoveryResult(),
    )

    result = runner.invoke(
        app,
        ["recover", "restart-pipeline", "--execute", "--confirm", "restart-pipeline"],
    )

    assert result.exit_code == 1
    assert json.loads(result.stdout)["status"] == "failed"


def test_recover_execute_requires_matching_confirmation() -> None:
    result = runner.invoke(app, ["recover", "restart-worker", "--execute"])

    assert result.exit_code == 2
    assert "requires --confirm restart-worker" in result.stderr


def test_ingest_static_help() -> None:
    result = runner.invoke(app, ["ingest-static", "--help"])

    assert result.exit_code == 0
    assert "Download, archive, and register one static GTFS feed." in result.stdout


def test_ingest_gis_help() -> None:
    result = runner.invoke(app, ["ingest-gis", "--help"])

    assert result.exit_code == 0
    assert "Download, archive, and register one STM GIS ZIP." in result.stdout


def test_validate_static_feeds_help() -> None:
    result = runner.invoke(app, ["validate-static-feeds", "--help"])

    assert result.exit_code == 0
    assert "Validate the active static GTFS feed without ingesting it" in result.stdout
    assert "current fallback" not in result.stdout


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
                "beta": {"status": "ok"},
                "schema_comparison": {"decision_signal": "schema_and_source_semantics"},
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


def test_retention_proof_report_help() -> None:
    result = runner.invoke(app, ["retention-proof-report", "--help"])

    assert result.exit_code == 0
    assert "Build a non-destructive retention and storage proof report." in result.stdout
    assert "--report-path" in result.stdout


def test_retention_proof_report_passes_provider_and_writes_report(
    monkeypatch, tmp_path
) -> None:
    from dataclasses import dataclass

    recorded: dict[str, object] = {}
    report_path = tmp_path / "retention-proof.json"

    @dataclass(frozen=True)
    class FakeRetentionProofResult:
        provider_id: str

        def display_dict(self) -> dict[str, object]:
            return {
                "provider_id": self.provider_id,
                "generated_at_utc": "2026-05-24T12:00:00+00:00",
                "retention_contract": {},
                "storage": {},
                "dry_runs": {},
                "static_feed_validation": {"status": "ok"},
            }

    def fake_build_retention_proof_report(provider_id, *, settings, registry):  # noqa: ANN001
        recorded["provider_id"] = provider_id
        recorded["settings_type"] = type(settings).__name__
        recorded["registry_type"] = type(registry).__name__
        return FakeRetentionProofResult(provider_id=provider_id)

    monkeypatch.setattr(
        cli_module,
        "build_retention_proof_report",
        fake_build_retention_proof_report,
    )
    monkeypatch.setattr(cli_module, "_skip_if_unseeded", lambda *a, **k: False)

    result = runner.invoke(
        app,
        ["retention-proof-report", "stm", "--report-path", str(report_path)],
    )

    assert result.exit_code == 0
    assert recorded["provider_id"] == "stm"
    stdout_payload = json.loads(result.stdout)
    report_payload = json.loads(report_path.read_text(encoding="utf-8"))
    assert stdout_payload == report_payload
    assert report_payload["provider_id"] == "stm"


def test_retention_proof_report_bad_report_path_exits_before_build(
    monkeypatch, tmp_path
) -> None:
    called = False

    def fake_build_retention_proof_report(provider_id, *, settings, registry):  # noqa: ANN001
        nonlocal called
        called = True
        raise AssertionError("proof report should not be built")

    monkeypatch.setattr(
        cli_module,
        "build_retention_proof_report",
        fake_build_retention_proof_report,
    )
    monkeypatch.setattr(cli_module, "_skip_if_unseeded", lambda *a, **k: False)

    result = runner.invoke(
        app,
        ["retention-proof-report", "stm", "--report-path", str(tmp_path)],
    )

    assert result.exit_code != 0
    assert called is False
    assert "--report-path must be a file path" in result.stderr


def test_retention_proof_report_rejects_unknown_provider_before_writing(
    tmp_path,
) -> None:
    report_path = tmp_path / "retention-proof.json"

    result = runner.invoke(
        app,
        ["retention-proof-report", "not-a-provider", "--report-path", str(report_path)],
    )

    assert result.exit_code != 0
    assert "No provider manifest found" in result.stderr
    assert "provider_id='not-a-provider'" in result.stderr
    assert not report_path.exists()


def test_capture_realtime_help() -> None:
    result = runner.invoke(app, ["capture-realtime", "--help"])

    assert result.exit_code == 0
    assert "Capture, archive, and register one GTFS-RT snapshot." in result.stdout


def test_load_static_silver_help() -> None:
    result = runner.invoke(app, ["load-static-silver", "--help"])

    assert result.exit_code == 0
    assert "Parse the latest Bronze static GTFS archive into Silver tables." in result.stdout


def test_load_gis_silver_help() -> None:
    result = runner.invoke(app, ["load-gis-silver", "--help"])

    assert result.exit_code == 0
    assert "Parse the latest Bronze GIS ZIP into Silver source tables." in result.stdout


def test_load_gis_silver_calls_loader(monkeypatch) -> None:
    from dataclasses import dataclass

    recorded: dict[str, object] = {}

    @dataclass(frozen=True)
    class FakeGisSilverResult:
        provider_id: str

        def display_dict(self) -> dict[str, object]:
            return {
                "provider_id": self.provider_id,
                "dataset_version_id": 88,
                "row_counts": {"gis_datasets": 1},
            }

    def fake_load_latest_gis_to_silver(provider_id, *, settings, registry):  # noqa: ANN001
        recorded["provider_id"] = provider_id
        recorded["settings_type"] = type(settings).__name__
        recorded["registry_type"] = type(registry).__name__
        return FakeGisSilverResult(provider_id=provider_id)

    monkeypatch.setattr(cli_module, "load_latest_gis_to_silver", fake_load_latest_gis_to_silver)

    result = runner.invoke(app, ["load-gis-silver", "stm"])

    assert result.exit_code == 0
    assert recorded["provider_id"] == "stm"
    payload = json.loads(result.stdout)
    assert payload["provider_id"] == "stm"
    assert payload["row_counts"] == {"gis_datasets": 1}


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


def test_run_static_pipeline_help(monkeypatch) -> None:
    # Force a wide terminal so the docstring renders on one line and the
    # contiguous help phrase below is not split by Rich line-wrapping.
    monkeypatch.setenv("COLUMNS", "200")
    result = runner.invoke(app, ["run-static-pipeline", "--help"])

    assert result.exit_code == 0
    assert (
        "Run ingest-static, load-static-silver, refresh-gold-static, "
        "then the GIS chain (best-effort)" in result.stdout
    )


def test_run_static_pipeline_warns_on_gis_failure_but_exits_zero(monkeypatch) -> None:
    """A best-effort GIS failure prints a stderr WARNING but the command still exits 0."""

    def fake_run_static_pipeline(provider_id, *, settings, registry):  # noqa: ANN001, ANN202
        return SimpleNamespace(
            display_dict=lambda: {"status": "succeeded", "gis_status": "failed"},
            gis_error_message="ingest-gis failed: boom",
        )

    monkeypatch.setattr(cli_module, "run_static_pipeline", fake_run_static_pipeline)

    result = runner.invoke(app, ["run-static-pipeline", "stm"])

    assert result.exit_code == 0
    assert "WARNING: GIS step failed" in result.output


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


def test_run_pruner_loop_help() -> None:
    result = runner.invoke(app, ["run-pruner-loop", "--help"])

    assert result.exit_code == 0
    assert "Run the dedicated retention pruner loop" in result.stdout
    assert "--max-cycles" in result.stdout


def test_run_pruner_loop_passes_max_cycles(monkeypatch) -> None:
    recorded: dict[str, object] = {}

    def fake_run_pruner_loop(provider_id, *, settings, max_cycles):  # noqa: ANN001
        recorded["provider_id"] = provider_id
        recorded["max_cycles"] = max_cycles

    monkeypatch.setattr(cli_module, "run_pruner_loop", fake_run_pruner_loop)

    result = runner.invoke(app, ["run-pruner-loop", "stm", "--max-cycles", "3"])

    assert result.exit_code == 0
    assert recorded == {"provider_id": "stm", "max_cycles": 3}


def test_prune_bronze_storage_help() -> None:
    result = runner.invoke(app, ["prune-bronze-storage", "--help"])

    assert result.exit_code == 0
    assert "Prune old Bronze R2 objects and raw metadata" in result.stdout
    assert "--dry-run" in result.stdout
    assert "--max-objects" in result.stdout
    assert "--max-batches" in result.stdout


def test_prune_i3_storage_help() -> None:
    result = runner.invoke(app, ["prune-i3-storage", "--help"])

    assert result.exit_code == 0
    assert "--dry-run" in result.stdout


def test_prune_i3_storage_dry_run_flag(monkeypatch) -> None:
    from transit_ops.maintenance import I3StoragePruneResult

    recorded: dict[str, object] = {}

    def fake_prune_i3_storage(provider_id, *, settings, dry_run):  # noqa: ANN001
        recorded["provider_id"] = provider_id
        recorded["dry_run"] = dry_run
        return I3StoragePruneResult(
            provider_id=provider_id,
            dry_run=dry_run,
            raw_retention_days=30,
            silver_closed_retention_days=90,
            raw_cutoff_utc=None,
            silver_cutoff_utc=None,
            deleted_object_counts={"i3_raw": 0},
            deleted_row_counts={},
            failed_object_counts={"i3_raw": 0},
            completed_at_utc=datetime(2026, 6, 13, 0, 0, 0, tzinfo=UTC),
        )

    monkeypatch.setattr(cli_module, "prune_i3_storage", fake_prune_i3_storage)
    monkeypatch.setattr(cli_module, "_skip_if_unseeded", lambda *a, **k: False)

    result = runner.invoke(app, ["prune-i3-storage", "stm", "--dry-run"])

    assert result.exit_code == 0
    assert recorded["provider_id"] == "stm"
    assert recorded["dry_run"] is True


def test_prune_i3_storage_requires_provider_id() -> None:
    # the provider_id argument is now required (no 'stm' default) so a
    # multi-provider setup cannot silently prune only stm.
    result = runner.invoke(app, ["prune-i3-storage"])

    assert result.exit_code != 0


def test_seed_core_help_documents_provider_option() -> None:
    result = runner.invoke(app, ["seed-core", "--help"])

    assert result.exit_code == 0
    assert "--provider" in result.stdout


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
            deferred_dataset_version_ids=[],
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


def _bronze_prune_cli_result(
    provider_id: str,
    dry_run: bool,
    failed_object_counts: dict[str, int] | None = None,
):
    from transit_ops.maintenance import BronzeStoragePruneResult

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
        failed_object_counts=failed_object_counts or {"realtime": 0, "static": 0},
        batch_counts={"realtime": 0, "static": 0},
        exhausted=True,
        completed_at_utc=datetime(2026, 3, 27, 0, 0, 0, tzinfo=UTC),
    )


def test_prune_bronze_storage_dry_run_flag(monkeypatch) -> None:
    recorded: dict[str, object] = {}

    def fake_prune_bronze_storage(
        provider_id, *, settings, dry_run, max_objects=None, max_batches=None
    ):  # noqa: ANN001
        recorded["provider_id"] = provider_id
        recorded["dry_run"] = dry_run
        return _bronze_prune_cli_result(provider_id, dry_run)

    monkeypatch.setattr(cli_module, "prune_bronze_storage", fake_prune_bronze_storage)
    monkeypatch.setattr(cli_module, "_skip_if_unseeded", lambda *a, **k: False)

    result = runner.invoke(app, ["prune-bronze-storage", "stm", "--dry-run"])

    assert result.exit_code == 0
    assert recorded["dry_run"] is True


def test_prune_bronze_storage_passes_max_objects_and_max_batches(monkeypatch) -> None:
    recorded: dict[str, object] = {}

    def fake_prune_bronze_storage(
        provider_id, *, settings, dry_run, max_objects, max_batches
    ):  # noqa: ANN001
        recorded["provider_id"] = provider_id
        recorded["dry_run"] = dry_run
        recorded["max_objects"] = max_objects
        recorded["max_batches"] = max_batches
        return _bronze_prune_cli_result(provider_id, dry_run)

    monkeypatch.setattr(cli_module, "prune_bronze_storage", fake_prune_bronze_storage)
    monkeypatch.setattr(cli_module, "_skip_if_unseeded", lambda *a, **k: False)

    result = runner.invoke(
        app,
        ["prune-bronze-storage", "stm", "--max-objects", "100", "--max-batches", "5"],
    )

    assert result.exit_code == 0
    assert recorded == {
        "provider_id": "stm",
        "dry_run": False,
        "max_objects": 100,
        "max_batches": 5,
    }


def test_prune_bronze_storage_exits_nonzero_when_r2_deletes_failed(monkeypatch) -> None:
    def fake_prune_bronze_storage(
        provider_id, *, settings, dry_run, max_objects=None, max_batches=None
    ):  # noqa: ANN001
        return _bronze_prune_cli_result(
            provider_id, dry_run, failed_object_counts={"realtime": 2, "static": 0}
        )

    monkeypatch.setattr(cli_module, "prune_bronze_storage", fake_prune_bronze_storage)
    monkeypatch.setattr(cli_module, "_skip_if_unseeded", lambda *a, **k: False)

    live_result = runner.invoke(app, ["prune-bronze-storage", "stm"])
    assert live_result.exit_code == 1

    # Dry-run never exits nonzero — it deletes nothing.
    dry_result = runner.invoke(app, ["prune-bronze-storage", "stm", "--dry-run"])
    assert dry_result.exit_code == 0


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


def test_source_factory_help_is_available() -> None:
    result = runner.invoke(app, ["rebuild-source-factory", "--help"])

    assert result.exit_code == 0
    assert "Rebuild STM Oracle from source truth" in result.stdout
    assert "--execute" in result.stdout
    assert "--destructive-r2-cleanup" in result.stdout
    assert "--active-prefix-wipe" in result.stdout
    assert "--confirm-oracle-target" in result.stdout
    assert "--confirm-worker-stopped" in result.stdout
    assert "--confirm-r2-cleanup" in result.stdout
    assert "--confirm-active-prefix-wipe" in result.stdout
    assert "--report-dir" in result.stdout


def test_legacy_rebuild_commands_are_removed() -> None:
    help_result = runner.invoke(app, ["--help"])

    assert help_result.exit_code == 0
    assert "rebuild-source-factory" in help_result.stdout
    assert LEGACY_ORACLE_REBUILD_COMMAND not in help_result.stdout
    assert LEGACY_BETA_REBUILD_COMMAND not in help_result.stdout


class FakeSourceFactoryCliResult:
    def __init__(self, provider_id: str, execute: bool) -> None:
        self.provider_id = provider_id
        self.execute = execute

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "execute": self.execute,
            "phase_status": {"preflight": "ok"},
            "artifacts": {"source_factory_result": "artifacts/slice-8.6/result.json"},
        }


def test_rebuild_source_factory_passes_destructive_gate_options(
    monkeypatch,
    tmp_path,
) -> None:
    recorded: dict[str, object] = {}

    def fake_run_source_factory_rebuild(
        provider_id,
        *,
        artifact_dir,
        keep_from_date,
        execute,
        destructive_r2_cleanup,
        active_prefix_wipe,
        confirm_worker_stopped,
        confirm_oracle_target,
        confirm_r2_cleanup,
        confirm_active_prefix_wipe,
        settings,
    ):  # noqa: ANN001
        recorded.update(
            {
                "provider_id": provider_id,
                "artifact_dir": artifact_dir,
                "keep_from_date": keep_from_date,
                "execute": execute,
                "destructive_r2_cleanup": destructive_r2_cleanup,
                "active_prefix_wipe": active_prefix_wipe,
                "confirm_worker_stopped": confirm_worker_stopped,
                "confirm_oracle_target": confirm_oracle_target,
                "confirm_r2_cleanup": confirm_r2_cleanup,
                "confirm_active_prefix_wipe": confirm_active_prefix_wipe,
                "settings": settings,
            }
        )
        return FakeSourceFactoryCliResult(provider_id, execute=execute)

    monkeypatch.setattr(
        cli_module,
        "run_source_factory_rebuild",
        fake_run_source_factory_rebuild,
    )
    monkeypatch.setattr(
        cli_module,
        "_default_source_factory_keep_from_date",
        lambda settings: date(2026, 4, 25),
        raising=False,
    )

    result = runner.invoke(
        app,
        [
            "rebuild-source-factory",
            "stm",
            "--execute",
            "--destructive-r2-cleanup",
            "--active-prefix-wipe",
            "--confirm-worker-stopped",
            "--confirm-oracle-target",
            "--confirm-r2-cleanup",
            "--confirm-active-prefix-wipe",
            "--report-dir",
            str(tmp_path),
        ],
    )

    assert result.exit_code == 0
    assert recorded["provider_id"] == "stm"
    assert recorded["artifact_dir"] == tmp_path
    assert recorded["keep_from_date"] == date(2026, 4, 25)
    assert recorded["execute"] is True
    assert recorded["destructive_r2_cleanup"] is True
    assert recorded["active_prefix_wipe"] is True
    assert recorded["confirm_worker_stopped"] is True
    assert recorded["confirm_oracle_target"] is True
    assert recorded["confirm_r2_cleanup"] is True
    assert recorded["confirm_active_prefix_wipe"] is True
    assert '"execute": true' in result.stdout


def test_rebuild_source_factory_bad_report_dir_prevents_run(
    monkeypatch,
    tmp_path,
) -> None:
    called = False

    def fake_run_source_factory_rebuild(provider_id, **kwargs):  # noqa: ANN001
        nonlocal called
        called = True
        return FakeSourceFactoryCliResult(provider_id, execute=False)

    monkeypatch.setattr(
        cli_module,
        "run_source_factory_rebuild",
        fake_run_source_factory_rebuild,
    )

    result = runner.invoke(
        app,
        [
            "rebuild-source-factory",
            "stm",
            "--report-dir",
            str(tmp_path / "missing" / "slice-8.6"),
        ],
    )

    assert result.exit_code == 2
    assert "--report-dir parent directory does not exist" in result.output
    assert called is False


def test_rebuild_source_factory_execute_requires_destructive_cleanup_gate() -> None:
    result = runner.invoke(app, ["rebuild-source-factory", "stm", "--execute"])

    assert result.exit_code == 2
    assert "--destructive-r2-cleanup is required with --execute" in result.output


def test_rebuild_source_factory_surfaces_guardrail_failure_as_invalid_parameter(
    monkeypatch,
) -> None:
    def fake_run_source_factory_rebuild(provider_id, **kwargs):  # noqa: ANN001
        raise ValueError("guardrail failed")

    monkeypatch.setattr(
        cli_module,
        "run_source_factory_rebuild",
        fake_run_source_factory_rebuild,
    )

    result = runner.invoke(
        app,
        ["rebuild-source-factory", "stm", "--execute", "--destructive-r2-cleanup"],
    )

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
    monkeypatch.setattr(cli_module, "_skip_if_unseeded", lambda *a, **k: False)

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
            },
            gold_build=None,
            gold_build_duration_seconds=0.25,
            gold_error_message=None,
        ),
    )

    result = runner.invoke(app, ["run-realtime-cycle", "stm"])

    assert result.exit_code == 1
    assert '"status": "partial_failure"' in result.stdout


def test_backup_database_command_outputs_summary_json(monkeypatch) -> None:
    class FakeBackupResult:
        def display_dict(self) -> dict[str, object]:
            return {
                "key": "backups/postgres/transit-20260611T093005Z.dump",
                "bucket": "transit-raw",
                "bytes_uploaded": 123456,
                "duration_seconds": 42.5,
                "pruned_keys": [],
                "retained_count": 3,
            }

    recorded: dict[str, object] = {}

    def fake_run_database_backup(settings):  # noqa: ANN001
        recorded["settings"] = settings
        return FakeBackupResult()

    monkeypatch.setattr(cli_module, "run_database_backup", fake_run_database_backup)

    result = runner.invoke(app, ["backup-database"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["key"] == "backups/postgres/transit-20260611T093005Z.dump"
    assert payload["bytes_uploaded"] == 123456
    assert payload["retained_count"] == 3
    assert "settings" in recorded


def test_backup_database_command_exits_nonzero_on_backup_error(monkeypatch) -> None:
    def fake_run_database_backup(settings):  # noqa: ANN001
        raise BackupError(
            "Excluded table(s) missing from the database: silver.rt_trip_update_stop_times"
        )

    monkeypatch.setattr(cli_module, "run_database_backup", fake_run_database_backup)

    result = runner.invoke(app, ["backup-database"])

    assert result.exit_code == 1
    assert "Excluded table(s) missing" in result.stderr


def test_list_backups_command_outputs_json(monkeypatch) -> None:
    listed = [
        {
            "key": "backups/postgres/transit-20260611T093005Z.dump",
            "size": 2048,
            "last_modified": "2026-06-11T09:30:05+00:00",
        },
        {
            "key": "backups/postgres/transit-20260610T093005Z.dump",
            "size": 1024,
            "last_modified": "2026-06-10T09:30:05+00:00",
        },
    ]
    monkeypatch.setattr(cli_module, "list_database_backups", lambda settings: listed)

    result = runner.invoke(app, ["list-backups"])

    assert result.exit_code == 0
    assert json.loads(result.stdout) == listed


def test_download_latest_backup_command_writes_dest(monkeypatch, tmp_path) -> None:
    recorded: dict[str, object] = {}

    def fake_download_latest_backup(settings, dest):  # noqa: ANN001
        recorded["dest"] = dest
        return {
            "key": "backups/postgres/transit-20260611T093005Z.dump",
            "size": 2048,
            "dest": str(dest),
        }

    monkeypatch.setattr(cli_module, "download_latest_backup", fake_download_latest_backup)

    dest = tmp_path / "latest.dump"
    result = runner.invoke(app, ["download-latest-backup", "--dest", str(dest)])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["key"] == "backups/postgres/transit-20260611T093005Z.dump"
    assert payload["dest"] == str(dest)
    assert recorded["dest"] == dest


def test_verify_backup_freshness_ok_when_recent(monkeypatch) -> None:
    monkeypatch.setattr(cli_module, "get_settings", lambda: cli_module.Settings(_env_file=None))
    recent = datetime.now(UTC).isoformat()
    listed = [
        {"key": "backups/postgres/transit-recent.dump", "size": 2048, "last_modified": recent},
    ]
    monkeypatch.setattr(cli_module, "list_database_backups", lambda settings: listed)

    result = runner.invoke(app, ["verify-backup-freshness"])

    assert result.exit_code == 0
    assert "Backup freshness OK" in result.stdout


def test_verify_backup_freshness_fails_when_stale(monkeypatch) -> None:
    monkeypatch.setattr(cli_module, "get_settings", lambda: cli_module.Settings(_env_file=None))
    stale = (datetime.now(UTC) - timedelta(hours=48)).isoformat()
    listed = [
        {"key": "backups/postgres/transit-stale.dump", "size": 2048, "last_modified": stale},
    ]
    monkeypatch.setattr(cli_module, "list_database_backups", lambda settings: listed)

    result = runner.invoke(app, ["verify-backup-freshness"])

    assert result.exit_code == 1
    assert "FAILED" in result.output


def test_verify_backup_freshness_fails_when_empty(monkeypatch) -> None:
    monkeypatch.setattr(cli_module, "get_settings", lambda: cli_module.Settings(_env_file=None))
    monkeypatch.setattr(cli_module, "list_database_backups", lambda settings: [])

    result = runner.invoke(app, ["verify-backup-freshness"])

    assert result.exit_code == 1
    assert "no backup objects found" in result.output


def test_verify_backup_freshness_respects_custom_threshold(monkeypatch) -> None:
    monkeypatch.setattr(cli_module, "get_settings", lambda: cli_module.Settings(_env_file=None))
    # 30h old: stale at the 26h default, but fresh under a 48h override.
    older = (datetime.now(UTC) - timedelta(hours=30)).isoformat()
    listed = [
        {"key": "backups/postgres/transit-30h.dump", "size": 2048, "last_modified": older},
    ]
    monkeypatch.setattr(cli_module, "list_database_backups", lambda settings: listed)

    result = runner.invoke(app, ["verify-backup-freshness", "--max-age-hours", "48"])

    assert result.exit_code == 0
    assert "Backup freshness OK" in result.stdout


def test_db_storage_report_help() -> None:
    result = runner.invoke(app, ["db-storage-report", "--help"])

    assert result.exit_code == 0
    assert "--limit" in result.stdout


class _FakeBatchLoadResult:
    def __init__(self, *, loaded_count, skipped_existing_snapshot_ids, row_counts):  # noqa: ANN001
        self.provider_id = "stm"
        self.loaded_count = loaded_count
        self.skipped_existing_snapshot_ids = skipped_existing_snapshot_ids
        self.row_counts = row_counts

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "loaded_count": self.loaded_count,
            "skipped_existing_snapshot_ids": self.skipped_existing_snapshot_ids,
            "row_counts": self.row_counts,
            "results": [],
        }


class _FakeGoldResult:
    def display_dict(self) -> dict[str, object]:
        return {"provider_id": "stm", "row_counts": {"fact_trip_delay_snapshot": 2}}


def _stub_replay_settings_and_registry(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(cli_module, "get_settings", lambda: cli_module.Settings(_env_file=None))
    monkeypatch.setattr(cli_module, "_provider_registry", lambda settings: object())


def test_replay_realtime_silver_help() -> None:
    result = runner.invoke(app, ["replay-realtime-silver", "--help"])

    assert result.exit_code == 0
    assert "Rebuild realtime Silver + Gold from raw Bronze" in result.stdout
    assert "--since" in result.stdout
    assert "--until" in result.stdout


def test_replay_realtime_silver_requires_since() -> None:
    result = runner.invoke(app, ["replay-realtime-silver", "stm"])

    assert result.exit_code == 2


def test_replay_realtime_silver_rejects_bad_since(monkeypatch) -> None:
    _stub_replay_settings_and_registry(monkeypatch)

    result = runner.invoke(
        app, ["replay-realtime-silver", "stm", "--since", "not-a-datetime"]
    )

    assert result.exit_code == 2
    assert "must be an ISO-8601 datetime" in result.output


def test_replay_realtime_silver_rejects_until_not_after_since(monkeypatch) -> None:
    _stub_replay_settings_and_registry(monkeypatch)

    result = runner.invoke(
        app,
        [
            "replay-realtime-silver",
            "stm",
            "--since",
            "2026-06-20T12:00:00Z",
            "--until",
            "2026-06-20T11:00:00Z",
        ],
    )

    assert result.exit_code == 2
    assert "must be after --since" in result.output


def test_replay_realtime_silver_rebuilds_and_reports_elapsed(monkeypatch) -> None:
    _stub_replay_settings_and_registry(monkeypatch)
    recorded: dict[str, object] = {}

    def fake_replay(provider_id, *, start_utc, end_utc, settings, registry):  # noqa: ANN001
        recorded["provider_id"] = provider_id
        recorded["start_utc"] = start_utc
        recorded["end_utc"] = end_utc
        return _FakeBatchLoadResult(
            loaded_count=2,
            skipped_existing_snapshot_ids=[],
            row_counts={"rt_feed_snapshots": 2, "rt_trip_updates": 2},
        )

    gold_called: dict[str, object] = {}

    def fake_build_gold(provider_id, *, settings, registry):  # noqa: ANN001
        gold_called["provider_id"] = provider_id
        return _FakeGoldResult()

    monkeypatch.setattr(cli_module, "replay_realtime_silver_window", fake_replay)
    monkeypatch.setattr(cli_module, "build_gold_marts", fake_build_gold)

    result = runner.invoke(
        app,
        [
            "replay-realtime-silver",
            "stm",
            "--since",
            "2026-06-20T12:00:00Z",
            "--until",
            "2026-06-20T13:00:00Z",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["status"] == "rebuilt"
    assert payload["snapshots_found"] == 2
    assert payload["gold"]["row_counts"]["fact_trip_delay_snapshot"] == 2
    assert payload["silver"]["loaded_count"] == 2
    assert "elapsed_seconds" in payload
    assert recorded["provider_id"] == "stm"
    assert recorded["start_utc"] == datetime(2026, 6, 20, 12, 0, tzinfo=UTC)
    assert recorded["end_utc"] == datetime(2026, 6, 20, 13, 0, tzinfo=UTC)
    assert gold_called["provider_id"] == "stm"


def test_replay_realtime_silver_empty_window_is_clean_noop(monkeypatch) -> None:
    _stub_replay_settings_and_registry(monkeypatch)

    monkeypatch.setattr(
        cli_module,
        "replay_realtime_silver_window",
        lambda provider_id, *, start_utc, end_utc, settings, registry: _FakeBatchLoadResult(
            loaded_count=0, skipped_existing_snapshot_ids=[], row_counts={}
        ),
    )

    def fail_build_gold(*args, **kwargs):  # noqa: ANN001, ANN002, ANN003
        raise AssertionError("gold rebuild must not run when no snapshots are found")

    monkeypatch.setattr(cli_module, "build_gold_marts", fail_build_gold)

    result = runner.invoke(
        app, ["replay-realtime-silver", "stm", "--since", "2026-06-20T12:00:00Z"]
    )

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["status"] == "no-snapshots-in-window"
    assert payload["snapshots_found"] == 0
    assert payload["gold"] is None
    assert "elapsed_seconds" in payload


# ---------------------------------------------------------------------------
# Unseeded-provider seed guard — every per-provider Daily Warm Rollups entry
# point must SKIP an enrolled-but-unseeded provider (no gold.dim_provider row)
# cleanly (exit 0) instead of crashing the all-providers run.
# ---------------------------------------------------------------------------


class _FakeConnCtx:
    def __enter__(self):
        return SimpleNamespace()

    def __exit__(self, *exc):  # noqa: ANN002
        return False


class _FakeEngine:
    def connect(self):
        return _FakeConnCtx()


def _stub_unseeded(monkeypatch, *, seeded: bool) -> None:
    """Force the seed probe without touching a real database.

    make_engine is stubbed so no DATABASE_URL is required; provider_is_seeded
    is stubbed to the desired verdict.
    """
    monkeypatch.setattr(cli_module, "make_engine", lambda settings: _FakeEngine())
    monkeypatch.setattr(cli_module, "provider_is_seeded", lambda conn, provider_id: seeded)


def test_prune_i3_storage_skips_unseeded_provider(monkeypatch) -> None:
    _stub_unseeded(monkeypatch, seeded=False)

    def fail(*args, **kwargs):  # noqa: ANN002, ANN003
        raise AssertionError("prune_i3_storage must not run for an unseeded provider")

    monkeypatch.setattr(cli_module, "prune_i3_storage", fail)

    result = runner.invoke(app, ["prune-i3-storage", "octranspo"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["skipped_not_seeded"] is True
    assert payload["provider_id"] == "octranspo"
    assert payload["step"] == "prune-i3-storage"


def test_prune_bronze_storage_skips_unseeded_provider(monkeypatch) -> None:
    _stub_unseeded(monkeypatch, seeded=False)

    def fail(*args, **kwargs):  # noqa: ANN002, ANN003
        raise AssertionError("prune_bronze_storage must not run for an unseeded provider")

    monkeypatch.setattr(cli_module, "prune_bronze_storage", fail)

    result = runner.invoke(app, ["prune-bronze-storage", "octranspo"])

    assert result.exit_code == 0
    assert json.loads(result.stdout)["skipped_not_seeded"] is True


def test_prune_warm_rollup_storage_skips_unseeded_provider(monkeypatch) -> None:
    _stub_unseeded(monkeypatch, seeded=False)

    def fail(*args, **kwargs):  # noqa: ANN002, ANN003
        raise AssertionError("prune_warm_rollup_storage must not run for an unseeded provider")

    monkeypatch.setattr(cli_module, "prune_warm_rollup_storage", fail)

    result = runner.invoke(app, ["prune-warm-rollup-storage", "octranspo"])

    assert result.exit_code == 0
    assert json.loads(result.stdout)["skipped_not_seeded"] is True


def test_retention_proof_report_skips_unseeded_provider(monkeypatch) -> None:
    _stub_unseeded(monkeypatch, seeded=False)

    def fail(*args, **kwargs):  # noqa: ANN002, ANN003
        raise AssertionError("build_retention_proof_report must not run for an unseeded provider")

    monkeypatch.setattr(cli_module, "build_retention_proof_report", fail)

    result = runner.invoke(app, ["retention-proof-report", "octranspo"])

    assert result.exit_code == 0
    assert json.loads(result.stdout)["skipped_not_seeded"] is True


def test_publish_all_skips_unseeded_and_publishes_seeded(monkeypatch) -> None:
    """publish-all must skip unseeded providers and still publish seeded ones,
    so the all-providers historic publish never fails on an unseeded provider."""
    seeded_set = {"stm"}
    published: list[str] = []

    monkeypatch.setattr(cli_module, "make_engine", lambda settings: _FakeEngine())
    monkeypatch.setattr(
        cli_module,
        "provider_is_seeded",
        lambda conn, provider_id: provider_id in seeded_set,
    )
    monkeypatch.setattr(
        cli_module,
        "_provider_registry",
        lambda settings: SimpleNamespace(list_provider_ids=lambda: ["octranspo", "stm"]),
    )

    def fake_publish_snapshot(provider_id, *, tier, settings, registry):  # noqa: ANN001
        published.append(provider_id)
        return SimpleNamespace(display_dict=lambda: {"provider_id": provider_id, "tier": tier})

    monkeypatch.setattr(cli_module, "publish_snapshot", fake_publish_snapshot)

    result = runner.invoke(app, ["publish-all", "--tier", "historic"])

    assert result.exit_code == 0
    # Unseeded octranspo skipped; seeded stm published.
    assert published == ["stm"]
    assert "publish-all skipped unseeded providers: octranspo" in result.stderr
    payload = json.loads(result.stdout)
    assert [r["provider_id"] for r in payload] == ["stm"]
