import os
import subprocess
from pathlib import Path

import pytest
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

EXPECTED_STEP_NAMES = [
    "Check out repository",
    "Set up Python",
    "Set up uv",
    "Install project dependencies",
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
    # PyYAML 1.1 resolves the bare key `on:` to the boolean True.
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

    expected_sync = (
        'providers="$(uv run python -m transit_ops.cli list-providers)"\n'
        'if [[ -z "$providers" ]]; then\n'
        '  echo "Provider discovery returned no providers" >&2\n'
        "  exit 1\n"
        "fi\n"
        "while IFS= read -r provider; do\n"
        '  if [[ -z "$provider" ]]; then\n'
        '    echo "Provider discovery returned an empty provider id" >&2\n'
        "    exit 1\n"
        "  fi\n"
        '  uv run python -m transit_ops.cli sync-alert-archive "$provider" \\\n'
        '    | tee "artifacts/historic-publish-recovery/'
        'alert-archive-sync-${provider}.json"\n'
        'done <<< "$providers"'
    )
    assert _step(job, "Sync retained alert archive (all providers)")["run"].strip() == expected_sync

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
        'published_providers="$(\n'
        "  jq -er '\n"
        '    if type != "array" or length == 0 then\n'
        '      error("historic publish result must be a nonempty array")\n'
        "    elif any(\n"
        "      .[];\n"
        '      ((.provider_id | type) != "string" or (.provider_id | length) == 0)\n'
        "    ) then\n"
        '      error("every historic publish result needs a nonempty provider_id")\n'
        "    else\n"
        "      .[].provider_id\n"
        "    end\n"
        "  ' artifacts/historic-publish-recovery/historic-publish.json\n"
        ')"\n'
        'if [[ -z "$published_providers" ]]; then\n'
        '  echo "Historic publish result returned no provider ids" >&2\n'
        "  exit 1\n"
        "fi\n"
        "while IFS= read -r provider; do\n"
        '  if [[ -z "$provider" ]]; then\n'
        '    echo "Historic publish result returned an empty provider id" >&2\n'
        "    exit 1\n"
        "  fi\n"
        '  proof_path="artifacts/historic-publish-recovery/'
        'public-proof-${provider}.json"\n'
        '  : > "$proof_path"\n'
        '  uv run python -m transit_ops.cli verify-historic-publish "$provider" \\\n'
        '    --sync-report "artifacts/historic-publish-recovery/'
        'alert-archive-sync-${provider}.json" \\\n'
        '    --gate-report "artifacts/historic-publish-recovery/'
        'publish-gate-${provider}.json" \\\n'
        '    --report-path "$proof_path"\n'
        '  if [[ ! -s "$proof_path" ]]; then\n'
        '    echo "Historic publication proof for ${provider} did not write a '
        'nonempty report" >&2\n'
        "    exit 1\n"
        "  fi\n"
        '  if ! jq -e --arg provider "$provider" \'\n'
        '    type == "object"\n'
        "    and .provider_id == $provider\n"
        '    and .status == "pass"\n'
        '  \' "$proof_path" >/dev/null; then\n'
        '    echo "Historic publication proof report for ${provider} is '
        'invalid or failed" >&2\n'
        "    exit 1\n"
        "  fi\n"
        'done <<< "$published_providers"'
    )
    assert _step(job, "Prove published historic snapshots")["run"].strip() == expected_proof


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
        "{}",
        "[]",
        '[{"provider_id": "stm"}, {"provider_id": ""}]',
        '[{"provider_id": ""}]',
        '[{"provider_id": 1}]',
        "[{}]",
    ],
)
def test_proof_step_rejects_invalid_or_empty_publish_results(
    tmp_path: Path,
    payload: str,
) -> None:
    artifact_dir = tmp_path / "artifacts" / "historic-publish-recovery"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "historic-publish.json").write_text(payload, encoding="utf-8")
    environment = _fake_uv_environment(tmp_path, "exit 0\n")
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
            "did not write a nonempty report",
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
    ],
    ids=[
        "missing-report",
        "empty-report",
        "malformed-report",
        "non-object-report",
        "failed-status",
        "provider-mismatch",
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
    environment = _fake_uv_environment(tmp_path, "exit 0\n")
    job = _only_job(_load(RECOVERY_WORKFLOW))

    result = _run_step_script(
        job,
        "Prove published historic snapshots",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode != 0
    assert "did not write a nonempty report" in result.stderr


def test_proof_step_verifies_each_strictly_valid_published_provider(tmp_path: Path) -> None:
    artifact_dir = tmp_path / "artifacts" / "historic-publish-recovery"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "historic-publish.json").write_text(
        '[{"provider_id": "stm"}, {"provider_id": "sto"}]',
        encoding="utf-8",
    )
    calls = tmp_path / "uv-calls.txt"
    environment = _fake_uv_environment(
        tmp_path,
        """\
printf '%s\\n' "$*" >> "$UV_CALLS"
if [[ "$*" == *"verify-historic-publish"* ]]; then
  provider="$6"
  report_path="artifacts/historic-publish-recovery/public-proof-${provider}.json"
  printf '{"provider_id":"%s","status":"pass"}\\n' "$provider" > "$report_path"
fi
""",
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
        "uses": "actions/upload-artifact@v4",
        "with": {
            "name": "historic-publish-recovery-${{ github.run_id }}",
            "path": "apps/db/artifacts/historic-publish-recovery/",
            "retention-days": 30,
            "if-no-files-found": "warn",
        },
    }
