from __future__ import annotations

import os
import shutil
import stat
import subprocess
import time
from pathlib import Path

import pytest

DB_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = DB_ROOT / "scripts"

DOCKER_STUB = (
    "#!/usr/bin/env bash\n"
    "if [[ -n \"${COMMAND_LOG:-}\" ]]; then\n"
    "  printf 'docker|%s\\n' \"$*\" >> \"$COMMAND_LOG\"\n"
    "fi\n"
    "if [[ -n \"${DOCKER_FAIL_PATTERN:-}\" && \"$*\" == *\"${DOCKER_FAIL_PATTERN}\"* ]]; then\n"
    "  printf 'docker forced failure for %s\\n' \"$*\" >&2\n"
    "  exit 1\n"
    "fi\n"
    "printf 'docker %s\\n' \"$*\"\n"
)


def _make_executable(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def _stubbed_env(tmp_path: Path) -> dict[str, str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    _make_executable(bin_dir / "docker", DOCKER_STUB)

    env = os.environ.copy()
    env["PATH"] = f"{bin_dir}:{env['PATH']}"
    return env


def _env_without_docker(tmp_path: Path) -> dict[str, str]:
    """Minimal PATH carrying required tools but no docker, regardless of host."""

    bin_dir = tmp_path / "nodocker-bin"
    bin_dir.mkdir(exist_ok=True)
    for tool in ("bash", "flock", "date", "sleep", "true"):
        real = shutil.which(tool)
        assert real is not None, f"required tool {tool} missing from host"
        (bin_dir / tool).symlink_to(real)

    env = os.environ.copy()
    env["PATH"] = str(bin_dir)
    return env


def _make_log_path(tmp_path: Path, name: str = "commands.log") -> Path:
    log_path = tmp_path / name
    log_path.write_text("", encoding="utf-8")
    return log_path


def _read_log(path: Path) -> list[str]:
    return [line for line in path.read_text(encoding="utf-8").splitlines() if line]


def _run_script(
    script_name: str,
    tmp_path: Path,
    *,
    env: dict[str, str] | None = None,
    **env_overrides: str,
) -> subprocess.CompletedProcess[str]:
    resolved_env = env if env is not None else _stubbed_env(tmp_path)
    resolved_env.update(env_overrides)
    return subprocess.run(
        ["bash", str(SCRIPTS_DIR / script_name)],
        cwd=DB_ROOT,
        env=resolved_env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_backup_script_runs_compose_run_backup_database(tmp_path: Path) -> None:
    log_path = _make_log_path(tmp_path)

    result = _run_script(
        "backup-postgres.sh",
        tmp_path,
        COMMAND_LOG=str(log_path),
        BACKUP_LOCK_FILE=str(tmp_path / "backup.lock"),
    )

    assert result.returncode == 0, result.stderr
    assert _read_log(log_path) == [
        "docker|compose -p transit run --rm --no-deps -T worker backup-database"
    ]
    assert "transit backup start" in result.stdout
    assert "transit backup finish" in result.stdout


def test_backup_script_requires_docker_binary(tmp_path: Path) -> None:
    log_path = _make_log_path(tmp_path)

    result = _run_script(
        "backup-postgres.sh",
        tmp_path,
        env=_env_without_docker(tmp_path),
        COMMAND_LOG=str(log_path),
        BACKUP_LOCK_FILE=str(tmp_path / "backup.lock"),
    )

    assert result.returncode == 127
    assert "docker command not found" in result.stderr
    assert _read_log(log_path) == []


def test_backup_script_propagates_docker_failure(tmp_path: Path) -> None:
    log_path = _make_log_path(tmp_path)

    result = _run_script(
        "backup-postgres.sh",
        tmp_path,
        COMMAND_LOG=str(log_path),
        BACKUP_LOCK_FILE=str(tmp_path / "backup.lock"),
        DOCKER_FAIL_PATTERN="backup-database",
    )

    assert result.returncode == 1
    assert "transit backup finish" in result.stdout
    assert "exit=1" in result.stdout


def test_backup_script_skips_when_lock_held(tmp_path: Path) -> None:
    log_path = _make_log_path(tmp_path)
    lock_file = tmp_path / "backup.lock"
    holder = subprocess.Popen(
        ["flock", str(lock_file), "-c", "sleep 30"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            probe = subprocess.run(
                ["flock", "-n", str(lock_file), "true"],
                check=False,
                capture_output=True,
            )
            if probe.returncode != 0:
                break
            time.sleep(0.05)
        else:
            pytest.fail("lock holder never acquired the lock")

        result = _run_script(
            "backup-postgres.sh",
            tmp_path,
            COMMAND_LOG=str(log_path),
            BACKUP_LOCK_FILE=str(lock_file),
        )
    finally:
        holder.terminate()
        holder.wait()

    assert result.returncode == 75
    assert "skipping" in result.stderr
    assert _read_log(log_path) == []
