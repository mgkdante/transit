import os
import subprocess
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "daily-static-pipeline.yml"
PROVIDER_STEP_NAME = (
    "Run static + GIS Bronze -> Silver -> Gold pipeline (all active providers)"
)


def _load_workflow() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def _step(job: dict, name: str) -> dict:
    return next(step for step in job["steps"] if step.get("name") == name)


def test_static_publication_requires_successful_providers_before_the_refail_step() -> None:
    job = _load_workflow()["jobs"]["run-static-pipeline"]
    steps = job["steps"]
    provider_step = _step(job, PROVIDER_STEP_NAME)
    provider_index = steps.index(provider_step)

    assert job["timeout-minutes"] == 110
    assert provider_step["id"] == "run-static-providers"
    assert provider_step["continue-on-error"] is True

    publish = _step(job, "Publish static /v1 snapshot to R2 (all active providers)")
    publish_index = steps.index(publish)
    assert publish_index == provider_index + 1
    assert publish["if"] == "steps.run-static-providers.outcome == 'success'"

    refail = steps[publish_index + 1]
    assert refail["if"] == (
        "always() && steps.run-static-providers.outcome == 'failure'"
    )
    assert refail["run"].strip() == "exit 1"

    for name in ("Initialize database", "Seed core metadata"):
        assert "continue-on-error" not in _step(job, name)


@pytest.mark.parametrize(
    "octranspo_status,stm_status,publish_status",
    [(42, 0, 0), (0, 43, 0), (42, 43, 0), (124, 0, 0), (0, 0, 0), (0, 0, 31)],
)
def test_static_workflow_attempts_every_provider_and_publishes_only_after_success(
    tmp_path: Path, octranspo_status: int, stm_status: int, publish_status: int,
) -> None:
    job = _load_workflow()["jobs"]["run-static-pipeline"]
    provider_step = _step(job, PROVIDER_STEP_NAME)
    publish_step = _step(job, "Publish static /v1 snapshot to R2 (all active providers)")
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
  printf 'octranspo\\nstm\\n'
  exit 0
fi
if [[ "$*" == *"run-static-pipeline"* ]]; then
  provider="${!#}"
  printf '%s\\n' "$provider" >> "$ATTEMPTS"
  if [[ "$provider" == "octranspo" ]]; then
    exit "$OCTRANSPO_STATUS"
  fi
  exit "$STM_STATUS"
fi
if [[ "$*" == *"publish-all --tier static"* ]]; then
  printf '%s\\n' "$*" >> "$PUBLISH_CALLS"
  exit "$PUBLISH_STATUS"
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
    environment["OCTRANSPO_STATUS"] = str(octranspo_status)
    environment["STM_STATUS"] = str(stm_status)
    environment["PUBLISH_STATUS"] = str(publish_status)

    result = subprocess.run(
        ["bash", "--noprofile", "--norc", "-eo", "pipefail", str(script)],
        cwd=tmp_path,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == (octranspo_status or stm_status)
    assert attempts.read_text(encoding="utf-8").splitlines() == [
        "octranspo",
        "stm",
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
    ]
    assert result.stdout.count("::endgroup::") == 2
    for provider, status in (("octranspo", octranspo_status), ("stm", stm_status)):
        outcome = "success" if status == 0 else "failure"
        assert f"provider={provider} outcome={outcome} exit_code={status}" in result.stdout

    provider_outcome = "success" if result.returncode == 0 else "failure"
    publish_result = None
    if publish_step.get("if") in (
        None, f"steps.run-static-providers.outcome == '{provider_outcome}'",
    ):
        publish_result = subprocess.run(
            ["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", publish_step["run"]],
            cwd=tmp_path,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )

    if result.returncode != 0:
        assert publish_result is None
        assert not publish_calls.exists()
    else:
        assert publish_result is not None
        assert publish_result.returncode == publish_status
        assert publish_calls.read_text(encoding="utf-8").splitlines() == [
            "run python -m transit_ops.cli publish-all --tier static"
        ]

    refail_step = job["steps"][job["steps"].index(publish_step) + 1]
    if refail_step["if"] == (
        f"always() && steps.run-static-providers.outcome == '{provider_outcome}'"
    ):
        refail_result = subprocess.run(
            ["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", refail_step["run"]],
            cwd=tmp_path,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        assert refail_result.returncode == 1
        assert result.returncode != 0
    else:
        assert result.returncode == 0
