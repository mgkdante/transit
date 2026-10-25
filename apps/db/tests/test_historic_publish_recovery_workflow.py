import json
import os
import subprocess
from pathlib import Path

import pytest
import yaml

from transit_ops.validation.historic_publish import HISTORIC_PROOF_TIMEOUT_SECONDS

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS = REPO_ROOT / ".github" / "workflows"
RECOVERY_WORKFLOW = WORKFLOWS / "historic-publish-recovery.yml"
DAILY_WORKFLOW = WORKFLOWS / "daily-warm-rollups.yml"
RETIRED_ALERT_ARCHIVE_BACKFILL_COMMAND = "backfill-" + "alert-archive"

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
    RETIRED_ALERT_ARCHIVE_BACKFILL_COMMAND,
    "replay-realtime-silver",
}

EXPECTED_ENV = {
    "APP_ENV": "production",
    "LOG_LEVEL": "INFO",
    "PROVIDER_TIMEZONE": "America/Toronto",
    "STM_PROVIDER_ID": "stm",
    "DATABASE_URL": "${{ secrets.DATABASE_URL }}",
    "BRONZE_STORAGE_BACKEND": "s3",
    "BRONZE_S3_ENDPOINT": "https://eccfb9bedd87d413eaf4cac6ae2285d3.r2.cloudflarestorage.com",
    "BRONZE_S3_BUCKET": "transit-raw",
    "BRONZE_S3_REGION": "auto",
    "BRONZE_S3_ACCESS_KEY": "${{ secrets.BRONZE_S3_ACCESS_KEY }}",
    "BRONZE_S3_SECRET_KEY": "${{ secrets.BRONZE_S3_SECRET_KEY }}",
    "SNAPSHOT_STORAGE_BACKEND": "s3",
    "SNAPSHOT_R2_BUCKET": "${{ secrets.SNAPSHOT_R2_BUCKET }}",
    "SNAPSHOT_PUBLIC_BASE_URL": "${{ secrets.SNAPSHOT_PUBLIC_BASE_URL }}",
}

EXPECTED_STEP_NAMES = [
    "Check out repository",
    "Set up Python workspace",
    "Apply database migrations",
    "Prove database migration head",
    "Sync retained alert archive (all providers)",
    "Publish gated historic snapshot (all providers)",
    "Prove published historic snapshots",
    "Upload historic recovery evidence",
]


def _load(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _on_block(document: dict) -> dict:
    return document.get("on", document.get(True, {}))


def _only_job(document: dict) -> dict:
    assert set(document["jobs"]) == {"publish-historic-recovery"}
    return document["jobs"]["publish-historic-recovery"]


def _step(job: dict, name: str) -> dict:
    return next(step for step in job["steps"] if step.get("name") == name)


def _github_shell_template(job: dict) -> list[str]:
    if job["defaults"]["run"].get("shell") == "bash":
        return ["bash", "--noprofile", "--norc", "-eo", "pipefail", "{0}"]
    return ["bash", "-e", "{0}"]


def _fake_uv_environment(tmp_path: Path, body: str) -> dict[str, str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fake_uv = bin_dir / "uv"
    fake_uv.write_text(f"#!/usr/bin/env bash\nset -eu\n{body}", encoding="utf-8")
    fake_uv.chmod(0o755)
    environment = os.environ.copy()
    environment["PATH"] = f"{bin_dir}:{environment['PATH']}"
    return environment


def _run_step_script(
    job: dict,
    name: str,
    *,
    cwd: Path,
    environment: dict[str, str],
) -> subprocess.CompletedProcess[str]:
    script_path = cwd / "github-step.sh"
    script_path.write_text(_step(job, name)["run"], encoding="utf-8")
    command = [str(script_path) if part == "{0}" else part for part in _github_shell_template(job)]
    return subprocess.run(
        command,
        cwd=cwd,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )


def _write_sync_receipt(
    artifact_dir: Path,
    filename_provider: str,
    payload: object,
) -> None:
    body = payload if isinstance(payload, str) else json.dumps(payload)
    (artifact_dir / f"alert-archive-sync-{filename_provider}.json").write_text(
        body,
        encoding="utf-8",
    )


def _write_provider_discovery(artifact_dir: Path, payload: object) -> None:
    body = payload if isinstance(payload, str) else json.dumps(payload)
    (artifact_dir / "provider-discovery.json").write_text(body, encoding="utf-8")


PASSING_PROOF_UV_BODY = """\
if [[ "$*" == *"verify-historic-publish"* ]]; then
  provider="$6"
  report_path="artifacts/historic-publish-recovery/public-proof-${provider}.json"
  printf '{"provider_id":"%s","status":"pass"}\\n' "$provider" > "$report_path"
fi
"""


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

    assert job["runs-on"] == "ubuntu-24.04"
    assert job["timeout-minutes"] == 90
    assert job["defaults"] == {"run": {"working-directory": "apps/db", "shell": "bash"}}
    assert _github_shell_template(job) == [
        "bash",
        "--noprofile",
        "--norc",
        "-eo",
        "pipefail",
        "{0}",
    ]
    assert job["env"] == EXPECTED_ENV
    assert "defaults" not in document
    assert "shell" not in job
    assert all("shell" not in step for step in job["steps"])
    assert [step.get("name") for step in job["steps"]] == EXPECTED_STEP_NAMES
    proof_timeout_minutes = _step(job, "Prove published historic snapshots")["timeout-minutes"]
    assert proof_timeout_minutes == 38
    assert HISTORIC_PROOF_TIMEOUT_SECONDS < proof_timeout_minutes * 60
    assert job["timeout-minutes"] - proof_timeout_minutes >= 45
    assert _step(job, "Upload historic recovery evidence")["if"] == "always()"
    assert _step(job, "Apply database migrations")["run"].strip() == (
        "mkdir -p artifacts/historic-publish-recovery\n"
        "uv run python -m transit_ops.cli init-db 2>&1 \\\n"
        "  | tee artifacts/historic-publish-recovery/migration-upgrade.txt"
    )
    assert _step(job, "Prove database migration head")["run"].strip() == (
        "{\n  uv run alembic heads\n  uv run alembic current --check-heads\n"
        "} 2>&1 | tee artifacts/historic-publish-recovery/migration-head.txt"
    )
    sync = _step(job, "Sync retained alert archive (all providers)")["run"]
    assert "> artifacts/historic-publish-recovery/provider-discovery.json" in sync
    assert "jq -n --args '$ARGS.positional'" in sync
    assert 'for provider in "${discovered_providers[@]}"; do' in sync
    assert 'sync-alert-archive "$provider"' in sync
    assert '| tee "artifacts/historic-publish-recovery/alert-archive-sync-${provider}.json"' in sync
    publish = _step(job, "Publish gated historic snapshot (all providers)")["run"]
    assert "--tier historic" in publish
    assert "--report-dir artifacts/historic-publish-recovery" in publish
    assert "| tee artifacts/historic-publish-recovery/historic-publish.json" in publish
    assert "2>&1" not in publish
    proof = _step(job, "Prove published historic snapshots")["run"]
    assert (
        '--sync-report "artifacts/historic-publish-recovery/alert-archive-sync-${provider}.json"'
        in proof
    )
    assert (
        '--gate-report "artifacts/historic-publish-recovery/publish-gate-${provider}.json"'
        in proof
    )
    assert '--report-path "$proof_path"' in proof
    assert 'proof_seed_path="${proof_path}.seed"' in proof
    assert 'mv -f "$proof_seed_path" "$proof_path"' in proof
    assert 'if ($synced | unique | length) != ($synced | length) then' in proof


def test_recovery_workflow_reuses_the_daily_lane_pinned_setup() -> None:
    document = _load(RECOVERY_WORKFLOW)
    daily_document = _load(DAILY_WORKFLOW)
    recovery_setup = _only_job(document)["steps"][:2]
    daily_job = next(iter(daily_document["jobs"].values()))

    assert recovery_setup == daily_job["steps"][:2]
    assert recovery_setup[1]["uses"] == "./.github/actions/setup-py"


def test_recovery_provider_loops_do_not_hide_discovery_failures() -> None:
    job = _only_job(_load(RECOVERY_WORKFLOW))
    sync_run = _step(job, "Sync retained alert archive (all providers)")["run"]
    proof_run = _step(job, "Prove published historic snapshots")["run"]

    assert "for provider in $(" not in sync_run
    assert "for provider in $(" not in proof_run
    assert 'providers="$(uv run python -m transit_ops.cli list-providers)"' in sync_run
    assert "while IFS= read -r provider; do" in sync_run
    assert 'done <<< "$providers"' in sync_run
    assert 'published_providers="$(' in proof_run
    assert "jq -er" in proof_run
    assert "while IFS= read -r provider; do" in proof_run
    assert 'done <<< "$published_providers"' in proof_run


def test_sync_step_propagates_failed_provider_discovery(tmp_path: Path) -> None:
    environment = _fake_uv_environment(
        tmp_path,
        'if [[ "$*" == *"list-providers"* ]]; then exit 23; fi\nexit 0\n',
    )
    job = _only_job(_load(RECOVERY_WORKFLOW))

    result = _run_step_script(
        job,
        "Sync retained alert archive (all providers)",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode == 23


def test_sync_step_rejects_empty_provider_discovery(tmp_path: Path) -> None:
    environment = _fake_uv_environment(tmp_path, "exit 0\n")
    job = _only_job(_load(RECOVERY_WORKFLOW))

    result = _run_step_script(
        job,
        "Sync retained alert archive (all providers)",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode != 0
    assert "Provider discovery returned no providers" in result.stderr


@pytest.mark.parametrize("provider_id", ["../sto", " ", "stm\n\nsto"])
def test_sync_step_rejects_unsafe_provider_before_path_use(
    tmp_path: Path,
    provider_id: str,
) -> None:
    (tmp_path / "artifacts" / "historic-publish-recovery").mkdir(parents=True)
    calls = tmp_path / "uv-calls.txt"
    environment = _fake_uv_environment(
        tmp_path,
        """\
if [[ "$*" == *"list-providers"* ]]; then
  printf '%s\\n' "$PROVIDER_ID"
  exit 0
fi
printf '%s\\n' "$*" >> "$UV_CALLS"
exit 0
""",
    )
    environment["PROVIDER_ID"] = provider_id
    environment["UV_CALLS"] = str(calls)
    job = _only_job(_load(RECOVERY_WORKFLOW))

    result = _run_step_script(
        job,
        "Sync retained alert archive (all providers)",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode != 0
    assert not calls.exists()


def test_sync_step_rejects_duplicate_provider_discovery(tmp_path: Path) -> None:
    (tmp_path / "artifacts" / "historic-publish-recovery").mkdir(parents=True)
    calls = tmp_path / "uv-calls.txt"
    environment = _fake_uv_environment(
        tmp_path,
        """\
if [[ "$*" == *"list-providers"* ]]; then
  printf 'stm\\nstm\\n'
  exit 0
fi
printf '%s\\n' "$*" >> "$UV_CALLS"
exit 0
""",
    )
    environment["UV_CALLS"] = str(calls)
    job = _only_job(_load(RECOVERY_WORKFLOW))

    result = _run_step_script(
        job,
        "Sync retained alert archive (all providers)",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode != 0
    assert not calls.exists()


def test_unspecified_linux_shell_can_mask_a_left_pipeline_failure(tmp_path: Path) -> None:
    script = tmp_path / "pipeline.sh"
    script.write_text("false | true\n", encoding="utf-8")

    unspecified = subprocess.run(
        ["bash", "-e", str(script)],
        check=False,
    )
    declared_bash = subprocess.run(
        ["bash", "--noprofile", "--norc", "-eo", "pipefail", str(script)],
        check=False,
    )

    assert unspecified.returncode == 0
    assert declared_bash.returncode != 0


@pytest.mark.parametrize(
    ("step_name", "fake_uv_body", "expected_status"),
    [
        (
            "Apply database migrations",
            'if [[ "$*" == *"init-db"* ]]; then exit 31; fi\nexit 0\n',
            31,
        ),
        (
            "Prove database migration head",
            'if [[ "$*" == *"alembic heads"* ]]; then exit 32; fi\nexit 0\n',
            32,
        ),
        (
            "Sync retained alert archive (all providers)",
            """\
if [[ "$*" == *"list-providers"* ]]; then printf 'stm\\n'; exit 0; fi
if [[ "$*" == *"sync-alert-archive"* ]]; then exit 33; fi
exit 0
""",
            33,
        ),
        (
            "Publish gated historic snapshot (all providers)",
            'if [[ "$*" == *"publish-all"* ]]; then exit 34; fi\nexit 0\n',
            34,
        ),
    ],
)
def test_critical_pipeline_propagates_left_side_failure(
    tmp_path: Path,
    step_name: str,
    fake_uv_body: str,
    expected_status: int,
) -> None:
    (tmp_path / "artifacts" / "historic-publish-recovery").mkdir(parents=True)
    environment = _fake_uv_environment(tmp_path, fake_uv_body)
    job = _only_job(_load(RECOVERY_WORKFLOW))

    result = _run_step_script(
        job,
        step_name,
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode == expected_status


@pytest.mark.parametrize(
    "payload",
    [
        "not-json",
        '[{"provider_id":"stm"}]\n[{"provider_id":"sto"}]',
        "{}",
        "[]",
        '[{"provider_id": "stm"}, {"provider_id": ""}]',
        '[{"provider_id": ""}]',
        '[{"provider_id": 1}]',
        "[{}]",
        '["stm"]',
    ],
)
def test_proof_step_rejects_invalid_or_empty_publish_results(
    tmp_path: Path,
    payload: str,
) -> None:
    artifact_dir = tmp_path / "artifacts" / "historic-publish-recovery"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "historic-publish.json").write_text(payload, encoding="utf-8")
    _write_provider_discovery(artifact_dir, ["stm"])
    _write_sync_receipt(artifact_dir, "stm", {"provider_id": "stm"})
    environment = _fake_uv_environment(tmp_path, PASSING_PROOF_UV_BODY)
    job = _only_job(_load(RECOVERY_WORKFLOW))

    result = _run_step_script(
        job,
        "Prove published historic snapshots",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode != 0


@pytest.mark.parametrize(
    ("fake_uv_body", "expected_error"),
    [
        (
            "exit 0\n",
            "is invalid or failed",
        ),
        (
            """\
if [[ "$*" == *"verify-historic-publish"* ]]; then
  : > artifacts/historic-publish-recovery/public-proof-stm.json
fi
exit 0
""",
            "did not write a nonempty report",
        ),
        (
            """\
if [[ "$*" == *"verify-historic-publish"* ]]; then
  printf 'not-json\\n' \\
    > artifacts/historic-publish-recovery/public-proof-stm.json
fi
exit 0
""",
            "is invalid or failed",
        ),
        (
            """\
if [[ "$*" == *"verify-historic-publish"* ]]; then
  printf '[{"provider_id":"stm","status":"pass"}]\\n' \\
    > artifacts/historic-publish-recovery/public-proof-stm.json
fi
exit 0
""",
            "is invalid or failed",
        ),
        (
            """\
if [[ "$*" == *"verify-historic-publish"* ]]; then
  printf '{"provider_id":"stm","status":"fail"}\\n' \\
    > artifacts/historic-publish-recovery/public-proof-stm.json
fi
exit 0
""",
            "is invalid or failed",
        ),
        (
            """\
if [[ "$*" == *"verify-historic-publish"* ]]; then
  printf '{"provider_id":"sto","status":"pass"}\\n' \\
    > artifacts/historic-publish-recovery/public-proof-stm.json
fi
exit 0
""",
            "is invalid or failed",
        ),
        (
            """\
if [[ "$*" == *"verify-historic-publish"* ]]; then
  printf '%s\\n%s\\n' \\
    '{"provider_id":"stm","status":"fail"}' \\
    '{"provider_id":"stm","status":"pass"}' \\
    > artifacts/historic-publish-recovery/public-proof-stm.json
fi
exit 0
""",
            "is invalid or failed",
        ),
    ],
    ids=[
        "missing-report",
        "empty-report",
        "malformed-report",
        "non-object-report",
        "failed-status",
        "provider-mismatch",
        "multiple-json-documents",
    ],
)
def test_proof_step_rejects_zero_exit_without_matching_passing_report(
    tmp_path: Path,
    fake_uv_body: str,
    expected_error: str,
) -> None:
    artifact_dir = tmp_path / "artifacts" / "historic-publish-recovery"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "historic-publish.json").write_text(
        '[{"provider_id": "stm"}]',
        encoding="utf-8",
    )
    _write_provider_discovery(artifact_dir, ["stm"])
    _write_sync_receipt(artifact_dir, "stm", {"provider_id": "stm"})
    environment = _fake_uv_environment(tmp_path, fake_uv_body)
    job = _only_job(_load(RECOVERY_WORKFLOW))

    result = _run_step_script(
        job,
        "Prove published historic snapshots",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode != 0
    assert expected_error in result.stderr


def test_proof_step_rejects_stale_passing_report_not_rewritten_by_verifier(
    tmp_path: Path,
) -> None:
    artifact_dir = tmp_path / "artifacts" / "historic-publish-recovery"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "historic-publish.json").write_text(
        '[{"provider_id": "stm"}]',
        encoding="utf-8",
    )
    (artifact_dir / "public-proof-stm.json").write_text(
        '{"provider_id":"stm","status":"pass"}\n',
        encoding="utf-8",
    )
    _write_provider_discovery(artifact_dir, ["stm"])
    _write_sync_receipt(artifact_dir, "stm", {"provider_id": "stm"})
    environment = _fake_uv_environment(tmp_path, "exit 0\n")
    job = _only_job(_load(RECOVERY_WORKFLOW))

    result = _run_step_script(
        job,
        "Prove published historic snapshots",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode != 0
    assert "is invalid or failed" in result.stderr
    payload = json.loads((artifact_dir / "public-proof-stm.json").read_text(encoding="utf-8"))
    assert payload["status"] == "fail"
    assert payload["failures"] == ["historic_proof_interrupted_before_completion"]


def test_proof_step_preseeds_nonempty_failure_receipt_before_verifier_runs(
    tmp_path: Path,
) -> None:
    artifact_dir = tmp_path / "artifacts" / "historic-publish-recovery"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "historic-publish.json").write_text(
        '[{"provider_id":"stm"}]',
        encoding="utf-8",
    )
    _write_provider_discovery(artifact_dir, ["stm"])
    _write_sync_receipt(artifact_dir, "stm", {"provider_id": "stm"})
    environment = _fake_uv_environment(
        tmp_path,
        'if [[ "$*" == *"verify-historic-publish"* ]]; then exit 124; fi\nexit 0\n',
    )
    job = _only_job(_load(RECOVERY_WORKFLOW))

    result = _run_step_script(
        job,
        "Prove published historic snapshots",
        cwd=tmp_path,
        environment=environment,
    )

    report_path = artifact_dir / "public-proof-stm.json"
    assert result.returncode == 124
    assert report_path.stat().st_size > 0
    payload = json.loads(report_path.read_text(encoding="utf-8"))
    assert payload["provider_id"] == "stm"
    assert payload["status"] == "fail"
    assert payload["failures"] == ["historic_proof_interrupted_before_completion"]
    assert payload["verified_at_utc"] is None
    for section in ("migration", "sync", "gate", "source_messages"):
        assert payload[section] == {"status": "unavailable"}
    assert payload["public"]["deadline"] == {
        "exceeded": True,
        "failure": "historic_proof_interrupted_before_completion",
        "receipt_source": "workflow_preseed",
    }


@pytest.mark.parametrize(
    "sync_receipts",
    [
        {},
        {"stm": "not-json"},
        {"stm": "[]"},
        {"stm": "{}"},
        {"stm": '{"provider_id":""}'},
        {"stm": '{"provider_id":"../stm"}'},
        {"stm": '{"provider_id":"stm","skipped_not_seeded":"true"}'},
        {"stm": '{"provider_id":"stm"}\n{"provider_id":"sto"}'},
        {
            "stm": '{"provider_id":"stm"}',
            "sto": '{"provider_id":"stm"}',
        },
        {
            "stm": ('{"provider_id":"stm"}\n{"provider_id":"sto","skipped_not_seeded":true}'),
            "sto": "",
        },
    ],
    ids=[
        "missing",
        "malformed",
        "non-object",
        "missing-provider",
        "empty-provider",
        "unsafe-provider",
        "invalid-skip-flag",
        "multiple-json-documents",
        "duplicate-active-provider",
        "compensating-document-counts",
    ],
)
def test_proof_step_rejects_invalid_sync_receipts(
    tmp_path: Path,
    sync_receipts: dict[str, str],
) -> None:
    artifact_dir = tmp_path / "artifacts" / "historic-publish-recovery"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "historic-publish.json").write_text(
        '[{"provider_id":"stm"}]',
        encoding="utf-8",
    )
    _write_provider_discovery(artifact_dir, list(sync_receipts) or ["stm"])
    for filename_provider, payload in sync_receipts.items():
        _write_sync_receipt(artifact_dir, filename_provider, payload)
    environment = _fake_uv_environment(tmp_path, PASSING_PROOF_UV_BODY)
    job = _only_job(_load(RECOVERY_WORKFLOW))

    result = _run_step_script(
        job,
        "Prove published historic snapshots",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode != 0


@pytest.mark.parametrize(
    ("sync_provider_ids", "published_provider_ids"),
    [
        (("stm", "sto"), ("stm",)),
        (("stm",), ("sto",)),
    ],
    ids=["synced-provider-not-published", "published-provider-not-synced"],
)
def test_proof_step_rejects_provider_set_mismatch(
    tmp_path: Path,
    sync_provider_ids: tuple[str, ...],
    published_provider_ids: tuple[str, ...],
) -> None:
    artifact_dir = tmp_path / "artifacts" / "historic-publish-recovery"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "historic-publish.json").write_text(
        json.dumps([{"provider_id": provider} for provider in published_provider_ids]),
        encoding="utf-8",
    )
    _write_provider_discovery(artifact_dir, list(sync_provider_ids))
    for provider in sync_provider_ids:
        _write_sync_receipt(artifact_dir, provider, {"provider_id": provider})
    environment = _fake_uv_environment(tmp_path, PASSING_PROOF_UV_BODY)
    job = _only_job(_load(RECOVERY_WORKFLOW))

    result = _run_step_script(
        job,
        "Prove published historic snapshots",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode != 0
    assert "provider set does not match active sync receipts" in result.stderr


@pytest.mark.parametrize(
    "discovery_payload",
    [
        None,
        "not-json",
        "{}",
        "[]",
        '["stm"]\n["sto"]',
        '["stm","stm"]',
        '["stm","../sto"]',
    ],
    ids=[
        "missing",
        "malformed",
        "non-array",
        "empty",
        "multiple-json-documents",
        "duplicate-provider",
        "unsafe-provider",
    ],
)
def test_proof_step_rejects_invalid_provider_discovery(
    tmp_path: Path,
    discovery_payload: str | None,
) -> None:
    artifact_dir = tmp_path / "artifacts" / "historic-publish-recovery"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "historic-publish.json").write_text(
        '[{"provider_id":"stm"}]',
        encoding="utf-8",
    )
    if discovery_payload is not None:
        _write_provider_discovery(artifact_dir, discovery_payload)
    _write_sync_receipt(artifact_dir, "stm", {"provider_id": "stm"})
    environment = _fake_uv_environment(tmp_path, PASSING_PROOF_UV_BODY)
    job = _only_job(_load(RECOVERY_WORKFLOW))

    result = _run_step_script(
        job,
        "Prove published historic snapshots",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode != 0


def test_proof_step_rejects_wrong_provider_in_skipped_receipt(tmp_path: Path) -> None:
    artifact_dir = tmp_path / "artifacts" / "historic-publish-recovery"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "historic-publish.json").write_text(
        '[{"provider_id":"stm"}]',
        encoding="utf-8",
    )
    _write_provider_discovery(artifact_dir, ["stm", "sto"])
    _write_sync_receipt(artifact_dir, "stm", {"provider_id": "stm"})
    _write_sync_receipt(
        artifact_dir,
        "sto",
        {
            "provider_id": "stm",
            "skipped_not_seeded": True,
            "step": "sync-alert-archive",
        },
    )
    environment = _fake_uv_environment(tmp_path, PASSING_PROOF_UV_BODY)
    job = _only_job(_load(RECOVERY_WORKFLOW))

    result = _run_step_script(
        job,
        "Prove published historic snapshots",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode != 0


def test_proof_step_rejects_missing_skipped_provider_receipt(tmp_path: Path) -> None:
    artifact_dir = tmp_path / "artifacts" / "historic-publish-recovery"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "historic-publish.json").write_text(
        '[{"provider_id":"stm"}]',
        encoding="utf-8",
    )
    _write_provider_discovery(artifact_dir, ["stm", "sto"])
    _write_sync_receipt(artifact_dir, "stm", {"provider_id": "stm"})
    environment = _fake_uv_environment(tmp_path, PASSING_PROOF_UV_BODY)
    job = _only_job(_load(RECOVERY_WORKFLOW))

    result = _run_step_script(
        job,
        "Prove published historic snapshots",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode != 0


def test_proof_step_allows_explicitly_skipped_sync_provider_to_be_absent(
    tmp_path: Path,
) -> None:
    artifact_dir = tmp_path / "artifacts" / "historic-publish-recovery"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "historic-publish.json").write_text(
        '[{"provider_id":"stm"}]',
        encoding="utf-8",
    )
    _write_provider_discovery(artifact_dir, ["stm", "sto"])
    _write_sync_receipt(artifact_dir, "stm", {"provider_id": "stm"})
    _write_sync_receipt(
        artifact_dir,
        "sto",
        {
            "provider_id": "sto",
            "skipped_not_seeded": True,
            "step": "sync-alert-archive",
        },
    )
    environment = _fake_uv_environment(tmp_path, PASSING_PROOF_UV_BODY)
    job = _only_job(_load(RECOVERY_WORKFLOW))

    result = _run_step_script(
        job,
        "Prove published historic snapshots",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode == 0


def test_proof_step_rejects_duplicate_published_provider(tmp_path: Path) -> None:
    artifact_dir = tmp_path / "artifacts" / "historic-publish-recovery"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "historic-publish.json").write_text(
        '[{"provider_id":"stm"},{"provider_id":"stm"}]',
        encoding="utf-8",
    )
    _write_provider_discovery(artifact_dir, ["stm"])
    _write_sync_receipt(artifact_dir, "stm", {"provider_id": "stm"})
    environment = _fake_uv_environment(tmp_path, PASSING_PROOF_UV_BODY)
    job = _only_job(_load(RECOVERY_WORKFLOW))

    result = _run_step_script(
        job,
        "Prove published historic snapshots",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode != 0


@pytest.mark.parametrize("provider_id", ["../stm", " "])
def test_proof_step_rejects_unsafe_published_provider_before_path_use(
    tmp_path: Path,
    provider_id: str,
) -> None:
    artifact_dir = tmp_path / "artifacts" / "historic-publish-recovery"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "historic-publish.json").write_text(
        json.dumps([{"provider_id": provider_id}]),
        encoding="utf-8",
    )
    calls = tmp_path / "uv-calls.txt"
    environment = _fake_uv_environment(
        tmp_path,
        'printf "%s\\n" "$*" >> "$UV_CALLS"\nexit 0\n',
    )
    environment["UV_CALLS"] = str(calls)
    job = _only_job(_load(RECOVERY_WORKFLOW))

    result = _run_step_script(
        job,
        "Prove published historic snapshots",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode != 0
    assert not calls.exists()


def test_proof_step_verifies_each_strictly_valid_published_provider(tmp_path: Path) -> None:
    artifact_dir = tmp_path / "artifacts" / "historic-publish-recovery"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "historic-publish.json").write_text(
        '[{"provider_id": "sto"}, {"provider_id": "stm"}]',
        encoding="utf-8",
    )
    _write_provider_discovery(artifact_dir, ["sto", "stm"])
    for provider in ("stm", "sto"):
        _write_sync_receipt(artifact_dir, provider, {"provider_id": provider})
    calls = tmp_path / "uv-calls.txt"
    environment = _fake_uv_environment(
        tmp_path,
        """\
printf '%s\\n' "$*" >> "$UV_CALLS"
"""
        + PASSING_PROOF_UV_BODY,
    )
    environment["UV_CALLS"] = str(calls)
    job = _only_job(_load(RECOVERY_WORKFLOW))

    result = _run_step_script(
        job,
        "Prove published historic snapshots",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode == 0
    assert [line.split()[5] for line in calls.read_text(encoding="utf-8").splitlines()] == [
        "stm",
        "sto",
    ]
    for provider in ("stm", "sto"):
        assert (artifact_dir / f"public-proof-{provider}.json").read_text(
            encoding="utf-8"
        ) == f'{{"provider_id":"{provider}","status":"pass"}}\n'


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
        "uses": "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
        "with": {
            "name": "historic-publish-recovery-${{ github.run_id }}",
            "path": "apps/db/artifacts/historic-publish-recovery/",
            "retention-days": 30,
            "if-no-files-found": "warn",
        },
    }
