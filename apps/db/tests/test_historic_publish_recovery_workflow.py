from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS = REPO_ROOT / ".github" / "workflows"
RECOVERY_WORKFLOW = WORKFLOWS / "historic-publish-recovery.yml"
DAILY_WORKFLOW = WORKFLOWS / "daily-warm-rollups.yml"

FORBIDDEN = {
    "build-warm-rollups",
    "rebuild-warm-rollups",
    "build-gold-marts",
    "run-static-pipeline",
    "prune-i3-storage",
    "prune-warm-rollup-storage",
    "prune-bronze-storage",
    "prune-silver-storage",
    "prune-gold-storage",
    "backfill-alert-archive",
    "replay-realtime-silver",
}

EXPECTED_ENV = {
    "APP_ENV": "production",
    "LOG_LEVEL": "INFO",
    "PROVIDER_TIMEZONE": "America/Toronto",
    "STM_PROVIDER_ID": "stm",
    "DATABASE_URL": "${{ secrets.DATABASE_URL }}",
    "BRONZE_S3_ENDPOINT": "https://eccfb9bedd87d413eaf4cac6ae2285d3.r2.cloudflarestorage.com",
    "BRONZE_S3_REGION": "auto",
    "BRONZE_S3_ACCESS_KEY": "${{ secrets.BRONZE_S3_ACCESS_KEY }}",
    "BRONZE_S3_SECRET_KEY": "${{ secrets.BRONZE_S3_SECRET_KEY }}",
    "SNAPSHOT_STORAGE_BACKEND": "s3",
    "SNAPSHOT_R2_BUCKET": "${{ secrets.SNAPSHOT_R2_BUCKET }}",
    "SNAPSHOT_PUBLIC_BASE_URL": "${{ secrets.SNAPSHOT_PUBLIC_BASE_URL }}",
}


def _load(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _on_block(document: dict) -> dict:
    # PyYAML 1.1 resolves the bare key `on:` to the boolean True.
    return document.get("on", document.get(True, {}))


def _only_job(document: dict) -> dict:
    assert set(document["jobs"]) == {"publish-historic-recovery"}
    return document["jobs"]["publish-historic-recovery"]


def _step(job: dict, name: str) -> dict:
    return next(step for step in job["steps"] if step.get("name") == name)


def test_recovery_workflow_is_manual_bounded_and_serialized_with_daily_lane() -> None:
    document = _load(RECOVERY_WORKFLOW)
    daily_document = _load(DAILY_WORKFLOW)
    job = _only_job(document)

    assert set(_on_block(document)) == {"workflow_dispatch"}
    assert document["permissions"] == {"contents": "read"}
    assert document["concurrency"] == {
        "group": "daily-warm-rollups",
        "cancel-in-progress": False,
    }
    assert document["concurrency"] == daily_document["concurrency"]

    assert job["runs-on"] == "ubuntu-latest"
    assert job["timeout-minutes"] == 45
    assert job["defaults"] == {"run": {"working-directory": "apps/db"}}
    assert job["env"] == EXPECTED_ENV
    assert "shell" not in job
    assert all("shell" not in step for step in job["steps"])


def test_recovery_workflow_reuses_the_daily_lane_pinned_setup() -> None:
    document = _load(RECOVERY_WORKFLOW)
    daily_document = _load(DAILY_WORKFLOW)
    recovery_setup = _only_job(document)["steps"][:4]
    daily_job = next(iter(daily_document["jobs"].values()))

    assert recovery_setup == daily_job["steps"][:4]
    assert [step.get("uses") for step in recovery_setup] == [
        "actions/checkout@v5",
        "actions/setup-python@v6",
        "astral-sh/setup-uv@v6",
        None,
    ]
    assert recovery_setup[1]["with"] == {"python-version": "3.12"}
    assert recovery_setup[3]["run"] == "uv sync --locked"


def test_recovery_workflow_runs_the_exact_bounded_recovery_sequence() -> None:
    document = _load(RECOVERY_WORKFLOW)
    job = _only_job(document)
    run_bodies = "\n".join(str(step["run"]) for step in job["steps"] if "run" in step)

    init = run_bodies.index("transit_ops.cli init-db")
    migration_head = run_bodies.index("alembic current --check-heads")
    sync = run_bodies.index("transit_ops.cli sync-alert-archive")
    publish = run_bodies.index("transit_ops.cli publish-all")
    proof = run_bodies.index("transit_ops.cli verify-historic-publish")
    assert init < migration_head < sync < publish < proof

    assert (
        _step(job, "Apply database migrations")["run"].strip()
        == """\
mkdir -p artifacts/historic-publish-recovery
uv run python -m transit_ops.cli init-db 2>&1 \\
  | tee artifacts/historic-publish-recovery/migration-upgrade.txt"""
    )

    assert (
        _step(job, "Prove database migration head")["run"].strip()
        == """\
{
  uv run alembic heads
  uv run alembic current --check-heads
} 2>&1 | tee artifacts/historic-publish-recovery/migration-head.txt"""
    )

    assert (
        _step(job, "Sync retained alert archive (all providers)")["run"].strip()
        == """\
for provider in $(uv run python -m transit_ops.cli list-providers); do
  uv run python -m transit_ops.cli sync-alert-archive "$provider" \\
    | tee "artifacts/historic-publish-recovery/alert-archive-sync-${provider}.json"
done"""
    )

    publish_run = _step(job, "Publish gated historic snapshot (all providers)")["run"].strip()
    assert (
        publish_run
        == """\
uv run python -m transit_ops.cli publish-all \\
  --tier historic \\
  --report-dir artifacts/historic-publish-recovery \\
  | tee artifacts/historic-publish-recovery/historic-publish.json"""
    )
    assert "2>&1" not in publish_run

    expected_proof = (
        "for provider in $(jq -r '.[].provider_id' "
        "artifacts/historic-publish-recovery/historic-publish.json); do\n"
        '  uv run python -m transit_ops.cli verify-historic-publish "$provider" \\\n'
        '    --sync-report "artifacts/historic-publish-recovery/'
        'alert-archive-sync-${provider}.json" \\\n'
        '    --gate-report "artifacts/historic-publish-recovery/'
        'publish-gate-${provider}.json" \\\n'
        '    --report-path "artifacts/historic-publish-recovery/'
        'public-proof-${provider}.json"\n'
        "done"
    )
    assert _step(job, "Prove published historic snapshots")["run"].strip() == expected_proof


def test_recovery_workflow_has_no_gate_override_or_expensive_command() -> None:
    raw = RECOVERY_WORKFLOW.read_text(encoding="utf-8")

    assert "--no-gate" not in raw
    assert "--force" not in raw
    for command in FORBIDDEN:
        assert command not in raw


def test_recovery_workflow_always_uploads_the_complete_evidence_directory() -> None:
    document = _load(RECOVERY_WORKFLOW)
    job = _only_job(document)
    upload = job["steps"][-1]

    assert upload == {
        "name": "Upload historic recovery evidence",
        "if": "always()",
        "continue-on-error": True,
        "uses": "actions/upload-artifact@v4",
        "with": {
            "name": "historic-publish-recovery-${{ github.run_id }}",
            "path": "apps/db/artifacts/historic-publish-recovery/",
            "retention-days": 30,
            "if-no-files-found": "warn",
        },
    }
