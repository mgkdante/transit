import os
import subprocess
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "daily-static-pipeline.yml"
PROVIDER_STEP_NAME = (
    "Run static + GIS Bronze -> Silver -> Gold pipeline (all providers)"
)


def _load_workflow() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def _step(job: dict, name: str) -> dict:
    return next(step for step in job["steps"] if step.get("name") == name)


def test_static_provider_failures_publish_before_refailing_the_bounded_job() -> None:
    job = _load_workflow()["jobs"]["run-static-pipeline"]
    steps = job["steps"]
    provider_step = _step(job, PROVIDER_STEP_NAME)
    provider_index = steps.index(provider_step)

    assert job["timeout-minutes"] == 110
    assert provider_step["id"] == "run-static-providers"
    assert provider_step["continue-on-error"] is True

    publish = _step(job, "Publish static /v1 snapshot to R2 (all providers)")
    publish_index = steps.index(publish)
    assert publish_index == provider_index + 1
    assert "if" not in publish

    refail = steps[publish_index + 1]
    assert refail["if"] == (
        "always() && steps.run-static-providers.outcome == 'failure'"
    )
    assert refail["run"].strip() == "exit 1"

    for name in ("Initialize database", "Seed core metadata"):
        assert "continue-on-error" not in _step(job, name)


def test_static_provider_loop_attempts_every_provider_and_returns_first_failure(
    tmp_path: Path,
) -> None:
    job = _load_workflow()["jobs"]["run-static-pipeline"]
    provider_step = _step(job, PROVIDER_STEP_NAME)
    publish_step = _step(job, "Publish static /v1 snapshot to R2 (all providers)")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    attempts = tmp_path / "attempts.txt"
    publish_calls = tmp_path / "publish-calls.txt"
    timeout_calls = tmp_path / "timeout-calls.txt"

    fake_uv = bin_dir / "uv"
    fake_uv.write_text(
        """\
#!/usr/bin/env bash
set -eu
if [[ "$*" == *"list-providers"* ]]; then
  printf 'octranspo\\nstm\\nsto\\n'
  exit 0
fi
if [[ "$*" == *"run-static-pipeline"* ]]; then
  provider="${!#}"
  printf '%s\\n' "$provider" >> "$ATTEMPTS"
  if [[ "$provider" == "octranspo" ]]; then
    exit 42
  fi
  if [[ "$provider" == "sto" ]]; then
    exit 43
  fi
  exit 0
fi
if [[ "$*" == *"publish-all --tier static"* ]]; then
  printf '%s\\n' "$*" >> "$PUBLISH_CALLS"
  exit 0
fi
exit 99
""",
        encoding="utf-8",
    )
    fake_uv.chmod(0o755)

    fake_timeout = bin_dir / "timeout"
    fake_timeout.write_text(
        """\
#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$TIMEOUT_CALLS"
[[ "$1" == "--signal=TERM" ]]
shift
[[ "$1" == "--kill-after=1m" ]]
shift
[[ "$1" == "30m" ]]
shift
exec "$@"
""",
        encoding="utf-8",
    )
    fake_timeout.chmod(0o755)

    script = tmp_path / "provider-step.sh"
    script.write_text(provider_step["run"], encoding="utf-8")
    environment = os.environ.copy()
    environment["PATH"] = f"{bin_dir}:{environment['PATH']}"
    environment["ATTEMPTS"] = str(attempts)
    environment["PUBLISH_CALLS"] = str(publish_calls)
    environment["TIMEOUT_CALLS"] = str(timeout_calls)

    result = subprocess.run(
        ["bash", "--noprofile", "--norc", "-eo", "pipefail", str(script)],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 42
    assert attempts.read_text(encoding="utf-8").splitlines() == [
        "octranspo",
        "stm",
        "sto",
    ]
    assert timeout_calls.read_text(encoding="utf-8").splitlines() == [
        (
            "--signal=TERM --kill-after=1m 30m uv run python -m "
            "transit_ops.cli run-static-pipeline octranspo"
        ),
        (
            "--signal=TERM --kill-after=1m 30m uv run python -m "
            "transit_ops.cli run-static-pipeline stm"
        ),
        (
            "--signal=TERM --kill-after=1m 30m uv run python -m "
            "transit_ops.cli run-static-pipeline sto"
        ),
    ]
    assert result.stdout.count("::endgroup::") == 3
    assert "provider=octranspo outcome=failure exit_code=42" in result.stdout
    assert "provider=stm outcome=success exit_code=0" in result.stdout
    assert "provider=sto outcome=failure exit_code=43" in result.stdout

    publish_script = tmp_path / "publish-step.sh"
    publish_script.write_text(publish_step["run"], encoding="utf-8")
    publish_result = subprocess.run(
        ["bash", "--noprofile", "--norc", "-eo", "pipefail", str(publish_script)],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert publish_result.returncode == 0
    assert publish_calls.read_text(encoding="utf-8").splitlines() == [
        "run python -m transit_ops.cli publish-all --tier static"
    ]

    refail_step = job["steps"][job["steps"].index(publish_step) + 1]
    refail_script = tmp_path / "refail-step.sh"
    refail_script.write_text(refail_step["run"], encoding="utf-8")
    refail_result = subprocess.run(
        ["bash", "--noprofile", "--norc", "-eo", "pipefail", str(refail_script)],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert refail_result.returncode == 1
