from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = REPO_ROOT / "scripts"


def _make_executable(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def _stubbed_env(tmp_path: Path) -> dict[str, str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    _make_executable(
        bin_dir / "gh",
        "#!/usr/bin/env bash\n"
        "if [[ -n \"${COMMAND_LOG:-}\" ]]; then\n"
        "  printf 'gh|%s\\n' \"$*\" >> \"$COMMAND_LOG\"\n"
        "fi\n"
        "if [[ -n \"${GH_FAIL_PATTERN:-}\" && \"$*\" == *\"${GH_FAIL_PATTERN}\"* ]]; then\n"
        "  printf 'gh forced failure for %s\\n' \"$*\" >&2\n"
        "  exit 1\n"
        "fi\n"
        "printf 'gh %s\\n' \"$*\"\n",
    )
    _make_executable(
        bin_dir / "docker",
        "#!/usr/bin/env bash\n"
        "if [[ -n \"${COMMAND_LOG:-}\" ]]; then\n"
        "  printf 'docker|%s\\n' \"$*\" >> \"$COMMAND_LOG\"\n"
        "fi\n"
        "if [[ -n \"${DOCKER_FAIL_PATTERN:-}\" && \"$*\" == *\"${DOCKER_FAIL_PATTERN}\"* ]]; then\n"
        "  printf 'docker forced failure for %s\\n' \"$*\" >&2\n"
        "  exit 1\n"
        "fi\n"
        "printf 'docker %s\\n' \"$*\"\n",
    )
    _make_executable(
        bin_dir / "curl",
        "#!/usr/bin/env bash\n"
        "if [[ -n \"${COMMAND_LOG:-}\" ]]; then\n"
        "  printf 'curl|%s\\n' \"$*\" >> \"$COMMAND_LOG\"\n"
        "fi\n"
        "printf 'curl %s\\n' \"$*\"\n",
    )

    env = os.environ.copy()
    env["PATH"] = f"{bin_dir}:{env['PATH']}"
    return env


def _make_log_path(tmp_path: Path, name: str = "commands.log") -> Path:
    log_path = tmp_path / name
    log_path.write_text("", encoding="utf-8")
    return log_path


def _read_log(path: Path) -> list[str]:
    return [line for line in path.read_text(encoding="utf-8").splitlines() if line]


def _run_shell(
    command: str,
    tmp_path: Path,
    **env_overrides: str,
) -> subprocess.CompletedProcess[str]:
    env = _stubbed_env(tmp_path)
    env.update(env_overrides)
    return subprocess.run(
        ["bash", "-c", command],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def _run_script(
    script_name: str,
    tmp_path: Path,
    **env_overrides: str,
) -> subprocess.CompletedProcess[str]:
    env = _stubbed_env(tmp_path)
    env.update(env_overrides)
    return subprocess.run(
        ["bash", str(SCRIPTS_DIR / script_name)],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_legacy_database_compute_adapter_files_are_removed() -> None:
    assert not (SCRIPTS_DIR / "lib" / "database-compute.sh").exists()
    assert not (SCRIPTS_DIR / "lib" / "database-compute-none.sh").exists()
    assert not (SCRIPTS_DIR / "lib" / ("database-compute-" + "ne" + "on.sh")).exists()


def test_pause_pipeline_leaves_oracle_postgres_running_without_external_compute_api(
    tmp_path: Path,
) -> None:
    log_path = _make_log_path(tmp_path)
    result = _run_script("pause-pipeline.sh", tmp_path, COMMAND_LOG=str(log_path))

    assert result.returncode == 0, result.stderr
    assert "[1/2] Disabling GitHub Actions schedules" in result.stdout
    assert "[2/2] Stopping local Compose worker" in result.stdout
    assert "Database: left running; no external compute API is used" in result.stdout
    assert "Database compute" not in result.stdout
    assert "serviceInstanceSuspend" not in result.stdout
    assert "Done. Pipeline is paused." in result.stdout

    log_lines = _read_log(log_path)
    assert log_lines == [
        "gh|workflow disable Daily Static Pipeline --repo mgkdante/transit",
        "gh|workflow disable Daily Warm Rollups --repo mgkdante/transit",
        "docker|compose --env-file .env -f docker-compose.yml stop worker",
    ]
    assert not any(line.startswith("curl|") for line in log_lines)


def test_resume_pipeline_leaves_oracle_postgres_running_without_external_compute_api(
    tmp_path: Path,
) -> None:
    log_path = _make_log_path(tmp_path)
    result = _run_script("resume-pipeline.sh", tmp_path, COMMAND_LOG=str(log_path))

    assert result.returncode == 0, result.stderr
    assert "[1/2] Enabling GitHub Actions schedules" in result.stdout
    assert "[2/2] Starting local Compose worker" in result.stdout
    assert "Database: already running; no external compute API is used" in result.stdout
    assert "Database compute" not in result.stdout
    assert "serviceInstanceRedeploy" not in result.stdout
    assert "Done. Pipeline is resumed." in result.stdout

    log_lines = _read_log(log_path)
    assert log_lines == [
        "gh|workflow enable Daily Static Pipeline --repo mgkdante/transit",
        "gh|workflow enable Daily Warm Rollups --repo mgkdante/transit",
        "docker|compose --env-file .env -f docker-compose.yml up -d worker",
    ]
    assert not any(line.startswith("curl|") for line in log_lines)


def test_pause_pipeline_fails_honestly_when_worker_pause_fails(tmp_path: Path) -> None:
    result = _run_script(
        "pause-pipeline.sh",
        tmp_path,
        COMMAND_LOG=str(_make_log_path(tmp_path)),
        DOCKER_FAIL_PATTERN="stop worker",
    )

    assert result.returncode != 0
    assert "ERROR: worker service pause failed" in result.stdout
    assert "Worker service: pause failed" in result.stdout
    assert "Done. Pipeline is paused." not in result.stdout


def test_resume_pipeline_fails_honestly_when_worker_resume_fails(tmp_path: Path) -> None:
    result = _run_script(
        "resume-pipeline.sh",
        tmp_path,
        COMMAND_LOG=str(_make_log_path(tmp_path)),
        DOCKER_FAIL_PATTERN="up -d worker",
    )

    assert result.returncode != 0
    assert "ERROR: worker service resume failed" in result.stdout
    assert "Worker service: resume failed" in result.stdout
    assert "Done. Pipeline is resumed." not in result.stdout


def test_pause_pipeline_fails_honestly_when_scheduler_disable_fails(tmp_path: Path) -> None:
    result = _run_script(
        "pause-pipeline.sh",
        tmp_path,
        GH_FAIL_PATTERN="Daily Warm Rollups",
    )

    assert result.returncode != 0
    assert "Done. Pipeline is paused." not in result.stdout
    assert "failed" in result.stdout.lower()


def test_pipeline_control_pauses_worker_with_compose_stop(tmp_path: Path) -> None:
    log_path = _make_log_path(tmp_path)
    result = _run_shell(
        "bash infra/pipeline-control.sh pause worker",
        tmp_path,
        COMMAND_LOG=str(log_path),
    )

    assert result.returncode == 0, result.stderr
    assert "Pausing Compose worker service" in result.stdout
    assert _read_log(log_path) == [
        "docker|compose --env-file .env -f docker-compose.yml stop worker"
    ]


def test_pipeline_control_resumes_worker_with_compose_up_detached(tmp_path: Path) -> None:
    log_path = _make_log_path(tmp_path)
    result = _run_shell(
        "bash infra/pipeline-control.sh resume worker",
        tmp_path,
        COMMAND_LOG=str(log_path),
    )

    assert result.returncode == 0, result.stderr
    assert "Resuming Compose worker service" in result.stdout
    assert _read_log(log_path) == [
        "docker|compose --env-file .env -f docker-compose.yml up -d worker"
    ]


def test_pipeline_control_rejects_unknown_target(tmp_path: Path) -> None:
    result = _run_shell(
        "bash infra/pipeline-control.sh pause database",
        tmp_path,
    )

    assert result.returncode == 2
    assert "Usage: bash infra/pipeline-control.sh pause|resume worker" in result.stderr
