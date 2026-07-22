from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest
import yaml

WORKFLOW = Path(__file__).parents[3] / ".github/workflows/historic-snapshot-gc.yml"


def _workflow() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def _step(job: dict, name: str) -> dict:
    return next(step for step in job["steps"] if step.get("name") == name)


def _run_step(
    job: dict,
    name: str,
    *,
    cwd: Path,
    environment: dict[str, str],
    replacements: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    script = cwd / "github-step.sh"
    body = _step(job, name)["run"]
    for source, target in (replacements or {}).items():
        body = body.replace(source, target)
    script.write_text(body, encoding="utf-8")
    return subprocess.run(
        ["bash", "--noprofile", "--norc", "-eo", "pipefail", str(script)],
        cwd=cwd,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )


def _fake_uv_environment(tmp_path: Path, body: str) -> dict[str, str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fake_uv = bin_dir / "uv"
    fake_uv.write_text(f"#!/usr/bin/env bash\nset -eu\n{body}", encoding="utf-8")
    fake_uv.chmod(0o755)
    environment = os.environ.copy()
    environment["PATH"] = f"{bin_dir}:{environment['PATH']}"
    return environment


def test_historic_gc_workflow_is_weekly_and_mark_only_by_default() -> None:
    workflow = _workflow()
    triggers = workflow[True]

    assert triggers == {
        "schedule": [{"cron": "23 10 * * 1"}],
        "workflow_dispatch": {
            "inputs": {
                "mode": {
                    "description": "Non-destructive historic generation scan mode",
                    "required": True,
                    "type": "choice",
                    "default": "mark",
                    "options": ["dry-run", "mark"],
                }
            }
        },
    }
    assert "apply" not in WORKFLOW.read_text(encoding="utf-8")


def test_historic_gc_workflow_serializes_with_publication_and_keeps_provider_receipts() -> None:
    workflow = _workflow()
    assert set(workflow["jobs"]) == {"mark"}
    assert workflow["permissions"] == {"contents": "read"}
    assert workflow["concurrency"] == {
        "group": "daily-warm-rollups",
        "cancel-in-progress": False,
    }
    job = workflow["jobs"]["mark"]
    assert job["timeout-minutes"] == 300
    assert "strategy" not in job
    assert json.loads(job["env"]["PROVIDER_PLAN"]) == ["stm", "octranspo", "sto"]
    assert job["env"]["GC_MODE"] == (
        "${{ github.event_name == 'schedule' && 'mark' || inputs.mode }}"
    )
    assert job["env"]["BRONZE_S3_BUCKET"] == "transit-raw"
    assert job["env"]["BRONZE_S3_REGION"] == "auto"
    steps = job["steps"]
    initialize_index = next(
        index
        for index, step in enumerate(steps)
        if step.get("name") == "Initialize provider receipts"
    )
    setup_python_index = next(
        index
        for index, step in enumerate(steps)
        if str(step.get("uses", "")).startswith("actions/setup-python@")
    )
    migration_index = next(
        index for index, step in enumerate(steps) if step.get("name") == "Apply database migrations"
    )
    assert initialize_index < setup_python_index < migration_index
    rendered = WORKFLOW.read_text(encoding="utf-8")
    assert rendered.count("actions/setup-python@") == 1
    assert rendered.count("astral-sh/setup-uv@") == 1
    assert rendered.count("uv sync --locked") == 1
    assert rendered.count("transit_ops.cli init-db") == 1
    initialize = _step(job, "Initialize provider receipts")["run"]
    assert '"phase":"preflight"' in initialize
    assert "${{" not in initialize
    scan = _step(job, "Scan and mark unreachable generations")
    assert scan["timeout-minutes"] == 280
    assert 'timeout_limit="90m"' in scan["run"]
    assert 'timeout --signal=TERM --kill-after=1m "$timeout_limit"' in scan["run"]
    assert "gc-historic-snapshots" in scan["run"]
    assert 'exit "$aggregate_status"' in scan["run"]
    assert "${{" not in scan["run"]
    upload = _step(job, "Upload provider GC receipts")
    assert upload["if"] == "always()"
    assert upload["uses"] == "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"
    assert upload["with"]["name"] == "historic-gc-${{ github.run_id }}"
    assert upload["with"]["path"] == "apps/db/reports/historic-gc-*.json"
    assert upload["with"]["if-no-files-found"] == "error"
    assert upload["with"]["retention-days"] == 30
    assert "continue-on-error" not in upload
    assert sum(step.get("uses") == upload["uses"] for step in steps) == 1
    assert "matrix.provider" not in rendered
    assert len(json.loads(job["env"]["PROVIDER_PLAN"])) * 91 <= scan["timeout-minutes"]


def test_historic_gc_workflow_rewrites_only_scan_timeout_receipts() -> None:
    workflow = _workflow()
    scan_step = next(
        step
        for step in workflow["jobs"]["mark"]["steps"]
        if step.get("name") == "Scan and mark unreachable generations"
    )
    script = scan_step["run"]

    assert "set +e" in script
    assert 'scan_status="$?"' in script
    assert "set -e" in script
    assert (
        '[[ "$scan_status" -eq 124 || "$scan_status" -eq 137 || "$scan_status" -eq 143 ]]' in script
    )
    assert '"status":"fail"' in script
    assert '"phase":"scan"' in script
    assert '"failure_type":"timeout"' in script
    assert '"timeout_limit":"%s"' in script
    assert 'exit "$aggregate_status"' in script
    timeout_guard = (
        'if [[ "$scan_status" -eq 124 || "$scan_status" -eq 137 || "$scan_status" -eq 143 ]]; then'
    )
    guard_index = script.index(timeout_guard)
    printf_index = script.index("printf '", guard_index)
    assert guard_index < printf_index < script.index("\n  fi\n", printf_index)
    assert script.count('> "$report_path"') == 1


@pytest.mark.parametrize(
    "provider_plan",
    [
        "[",
        "{}",
        "[]",
        '["../sto"]',
        "[1]",
        '["stm","stm"]',
        '["stm"]\n["sto"]',
    ],
)
@pytest.mark.parametrize(
    "step_name",
    ["Initialize provider receipts", "Scan and mark unreachable generations"],
)
def test_historic_gc_rejects_invalid_provider_plans_before_commands(
    tmp_path: Path,
    provider_plan: str,
    step_name: str,
) -> None:
    calls = tmp_path / "uv-calls.txt"
    environment = _fake_uv_environment(
        tmp_path,
        'printf "%s\\n" "$*" >> "$UV_CALLS"\nexit 0\n',
    )
    environment["PROVIDER_PLAN"] = provider_plan
    environment["UV_CALLS"] = str(calls)
    job = _workflow()["jobs"]["mark"]
    if step_name == "Scan and mark unreachable generations":
        cwd = tmp_path / "apps" / "db"
        cwd.mkdir(parents=True)
    else:
        cwd = tmp_path

    result = _run_step(
        job,
        step_name,
        cwd=cwd,
        environment=environment,
        replacements={
            "${{ github.event_name == 'schedule' && 'mark' || inputs.mode }}": "mark",
            "${{ matrix.provider }}": "stm",
        },
    )

    assert result.returncode != 0
    assert not calls.exists()
    if step_name == "Initialize provider receipts":
        assert not list((tmp_path / "apps" / "db" / "reports").glob("historic-gc-*.json"))


@pytest.mark.parametrize(
    "step_name",
    ["Initialize provider receipts", "Scan and mark unreachable generations"],
)
def test_historic_gc_provider_extraction_propagates_failure_before_commands(
    tmp_path: Path,
    step_name: str,
) -> None:
    calls = tmp_path / "uv-calls.txt"
    environment = _fake_uv_environment(
        tmp_path,
        'printf "%s\\n" "$*" >> "$UV_CALLS"\nexit 0\n',
    )
    environment["PROVIDER_PLAN"] = '["stm"]'
    environment["UV_CALLS"] = str(calls)
    job = _workflow()["jobs"]["mark"]
    if step_name == "Scan and mark unreachable generations":
        cwd = tmp_path / "apps" / "db"
        cwd.mkdir(parents=True)
    else:
        cwd = tmp_path

    result = _run_step(
        job,
        step_name,
        cwd=cwd,
        environment=environment,
        replacements={
            "jq -r '.[]' <<< \"$provider_plan\"": ("jq -r '.[]' <<< \"$provider_plan\"; exit 73")
        },
    )

    assert result.returncode == 73
    assert not calls.exists()
    if step_name == "Initialize provider receipts":
        assert not list((tmp_path / "apps" / "db" / "reports").glob("historic-gc-*.json"))


def test_historic_gc_preserves_order_continues_and_returns_first_nonzero(
    tmp_path: Path,
) -> None:
    calls = tmp_path / "gc-calls.txt"
    environment = _fake_uv_environment(
        tmp_path,
        """\
provider=""
previous=""
for argument in "$@"; do
  if [[ "$previous" == "gc-historic-snapshots" ]]; then
    provider="$argument"
    break
  fi
  previous="$argument"
done
printf '%s\\n' "$provider" >> "$GC_CALLS"
report_path="${!#}"
status="pass"
if [[ "$provider" == "octranspo" || "$provider" == "sto" ]]; then status="fail"; fi
printf '{"provider_id":"%s","status":"%s","phase":"scan"}\\n' \
  "$provider" "$status" > "$report_path"
if [[ "$provider" == "octranspo" ]]; then exit 37; fi
if [[ "$provider" == "sto" ]]; then exit 43; fi
exit 0
""",
    )
    environment["PROVIDER_PLAN"] = '["stm","octranspo","sto"]'
    environment["GC_CALLS"] = str(calls)
    job = _workflow()["jobs"]["mark"]

    initialize = _run_step(
        job,
        "Initialize provider receipts",
        cwd=tmp_path,
        environment=environment,
    )
    assert initialize.returncode == 0, initialize.stderr
    scan = _run_step(
        job,
        "Scan and mark unreachable generations",
        cwd=tmp_path / "apps" / "db",
        environment=environment,
        replacements={"${{ github.event_name == 'schedule' && 'mark' || inputs.mode }}": "mark"},
    )

    assert scan.returncode == 37
    assert calls.read_text(encoding="utf-8") == "stm\noctranspo\nsto\n"
    reports = tmp_path / "apps" / "db" / "reports"
    for provider, status in (("stm", "pass"), ("octranspo", "fail"), ("sto", "fail")):
        receipt = json.loads((reports / f"historic-gc-{provider}.json").read_text(encoding="utf-8"))
        assert receipt == {"provider_id": provider, "status": status, "phase": "scan"}


@pytest.mark.parametrize("timeout_status", [124, 137, 143])
def test_historic_gc_rewrites_timeout_receipt_and_continues(
    tmp_path: Path,
    timeout_status: int,
) -> None:
    calls = tmp_path / "gc-calls.txt"
    environment = _fake_uv_environment(
        tmp_path,
        """\
provider=""
previous=""
for argument in "$@"; do
  if [[ "$previous" == "gc-historic-snapshots" ]]; then provider="$argument"; break; fi
  previous="$argument"
done
printf '%s\\n' "$provider" >> "$GC_CALLS"
printf '{"provider_id":"%s","status":"cli"}\\n' "$provider" > "${!#}"
if [[ "$provider" == "octranspo" ]]; then exit "$TIMEOUT_STATUS"; fi
exit 0
""",
    )
    environment["PROVIDER_PLAN"] = '["stm","octranspo","sto"]'
    environment["GC_CALLS"] = str(calls)
    environment["TIMEOUT_STATUS"] = str(timeout_status)
    job = _workflow()["jobs"]["mark"]
    initialize = _run_step(
        job,
        "Initialize provider receipts",
        cwd=tmp_path,
        environment=environment,
    )
    assert initialize.returncode == 0, initialize.stderr

    scan = _run_step(
        job,
        "Scan and mark unreachable generations",
        cwd=tmp_path / "apps" / "db",
        environment=environment,
        replacements={"${{ github.event_name == 'schedule' && 'mark' || inputs.mode }}": "mark"},
    )

    assert scan.returncode == timeout_status
    assert calls.read_text(encoding="utf-8") == "stm\noctranspo\nsto\n"
    reports = tmp_path / "apps" / "db" / "reports"
    timeout_receipt = json.loads(
        (reports / "historic-gc-octranspo.json").read_text(encoding="utf-8")
    )
    assert timeout_receipt == {
        "status": "fail",
        "phase": "scan",
        "failure_type": "timeout",
        "timeout_limit": "90m",
        "provider_id": "octranspo",
    }
    assert json.loads((reports / "historic-gc-sto.json").read_text(encoding="utf-8")) == {
        "provider_id": "sto",
        "status": "cli",
    }
