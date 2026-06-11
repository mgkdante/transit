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


UV_STUB = (
    "#!/usr/bin/env bash\n"
    'if [[ -n "${COMMAND_LOG:-}" ]]; then\n'
    "  printf 'uv|%s\\n' \"$*\" >> \"$COMMAND_LOG\"\n"
    "fi\n"
    'if [[ "$*" == *download-latest-backup* ]]; then\n'
    '  dest=""\n'
    '  prev=""\n'
    '  for arg in "$@"; do\n'
    '    if [[ "$prev" == "--dest" ]]; then dest="$arg"; fi\n'
    '    prev="$arg"\n'
    "  done\n"
    '  mkdir -p "$(dirname "$dest")"\n'
    "  printf 'PGDMP-stub' > \"$dest\"\n"
    'elif [[ "$*" == *"alembic heads"* ]]; then\n'
    "  printf '0028_historic_promotion_marts (head)\\n'\n"
    "fi\n"
)


def _pg_tool_stub(name: str) -> str:
    fail_var = name.upper() + "_FAIL"
    return (
        "#!/usr/bin/env bash\n"
        'if [[ -n "${COMMAND_LOG:-}" ]]; then\n'
        f"  printf '{name}|%s\\n' \"$*\" >> \"$COMMAND_LOG\"\n"
        "fi\n"
        f'if [[ -n "${{{fail_var}:-}}" ]]; then\n'
        f"  printf '{name} forced failure\\n' >&2\n"
        "  exit 1\n"
        "fi\n"
        "exit 0\n"
    )


def _restore_env(tmp_path: Path) -> tuple[dict[str, str], Path]:
    bin_dir = tmp_path / "pgbin"
    bin_dir.mkdir(exist_ok=True)
    for tool in ("initdb", "pg_ctl", "createdb", "pg_restore", "psql"):
        _make_executable(bin_dir / tool, _pg_tool_stub(tool))
    _make_executable(bin_dir / "uv", UV_STUB)

    log_path = _make_log_path(tmp_path)
    env = os.environ.copy()
    env["PATH"] = f"{bin_dir}:{env['PATH']}"
    env.update(
        {
            "COMMAND_LOG": str(log_path),
            "PG_BIN": str(bin_dir),
            "RESTORE_WORKDIR": str(tmp_path / "restore-work"),
            "RESTORE_MIN_FREE_GB": "0",
        }
    )
    return env, log_path


def test_restore_proof_orders_initdb_restore_smoke(tmp_path: Path) -> None:
    env, log_path = _restore_env(tmp_path)

    result = _run_script("restore-backup-proof.sh", tmp_path, env=env)

    assert result.returncode == 0, result.stderr
    prefixes = [line.split("|", 1)[0] for line in _read_log(log_path)]
    for earlier, later in (
        ("uv", "initdb"),
        ("initdb", "pg_ctl"),
        ("pg_ctl", "createdb"),
        ("createdb", "pg_restore"),
        ("pg_restore", "psql"),
    ):
        assert prefixes.index(earlier) < prefixes.index(later), prefixes
    assert "RTO download_seconds=" in result.stdout


def test_restore_proof_uses_no_owner_no_privileges_parallel_jobs(tmp_path: Path) -> None:
    env, log_path = _restore_env(tmp_path)

    result = _run_script("restore-backup-proof.sh", tmp_path, env=env)

    assert result.returncode == 0, result.stderr
    restore_lines = [line for line in _read_log(log_path) if line.startswith("pg_restore|")]
    assert len(restore_lines) == 1
    assert "--no-owner" in restore_lines[0]
    assert "--no-privileges" in restore_lines[0]
    assert "--jobs=4" in restore_lines[0]


def test_restore_proof_smoke_uses_on_error_stop_and_checks_rt_stop_times_empty(
    tmp_path: Path,
) -> None:
    env, log_path = _restore_env(tmp_path)

    result = _run_script("restore-backup-proof.sh", tmp_path, env=env)

    assert result.returncode == 0, result.stderr
    psql_lines = [line for line in _read_log(log_path) if line.startswith("psql|")]
    assert psql_lines, "restore proof must run psql smoke checks"
    assert all("ON_ERROR_STOP=1" in line for line in psql_lines)
    exclusion_lines = [
        line for line in psql_lines if "silver.rt_trip_update_stop_times" in line
    ]
    assert exclusion_lines, "smoke must prove the excluded table restored empty"
    assert any("= 0" in line for line in exclusion_lines)
    assert any("alembic_version" in line for line in psql_lines)
    assert any("postgis" in line for line in psql_lines)


def test_restore_proof_fails_fast_when_pg_restore_fails(tmp_path: Path) -> None:
    env, log_path = _restore_env(tmp_path)
    env["PG_RESTORE_FAIL"] = "1"

    result = _run_script("restore-backup-proof.sh", tmp_path, env=env)

    assert result.returncode != 0
    log_lines = _read_log(log_path)
    assert any(line.startswith("pg_restore|") for line in log_lines)
    assert not any(line.startswith("psql|") for line in log_lines)


def test_restore_proof_reuses_existing_dump_file(tmp_path: Path) -> None:
    env, log_path = _restore_env(tmp_path)
    dump_file = tmp_path / "existing.dump"
    dump_file.write_bytes(b"PGDMP-existing")
    env["RESTORE_DUMP_FILE"] = str(dump_file)

    result = _run_script("restore-backup-proof.sh", tmp_path, env=env)

    assert result.returncode == 0, result.stderr
    uv_lines = [line for line in _read_log(log_path) if line.startswith("uv|")]
    assert not any("download-latest-backup" in line for line in uv_lines)
    restore_lines = [line for line in _read_log(log_path) if line.startswith("pg_restore|")]
    assert str(dump_file) in restore_lines[0]
