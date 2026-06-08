from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "run-pg-repack.sh"


def _make_executable(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def _stubbed_env(tmp_path: Path, *, with_pg_repack: bool = True) -> tuple[dict[str, str], Path]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    command_log = tmp_path / "pg_repack.log"
    command_log.write_text("", encoding="utf-8")

    if with_pg_repack:
        _make_executable(
            bin_dir / "pg_repack",
            "#!/usr/bin/env bash\n"
            "printf '%s\\n' \"$*\" >> \"$PG_REPACK_COMMAND_LOG\"\n"
            "printf 'pg_repack stub ok\\n'\n",
        )

    env = os.environ.copy()
    env["PATH"] = f"{bin_dir}:{env['PATH']}"
    env["DATABASE_URL"] = "postgresql://app:secret@example.com:5432/transit"
    env["PG_REPACK_COMMAND_LOG"] = str(command_log)
    return env, command_log


def _run_guardrail(
    tmp_path: Path,
    *,
    with_pg_repack: bool = True,
    **env_overrides: str,
) -> tuple[subprocess.CompletedProcess[str], Path]:
    env, command_log = _stubbed_env(tmp_path, with_pg_repack=with_pg_repack)
    env.update(env_overrides)
    result = subprocess.run(
        ["bash", str(SCRIPT)],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    return result, command_log


def test_pg_repack_guardrail_requires_database_url(tmp_path: Path) -> None:
    result, command_log = _run_guardrail(tmp_path, DATABASE_URL="")

    assert result.returncode == 2
    assert "DATABASE_URL is required" in result.stderr
    assert command_log.read_text(encoding="utf-8") == ""


def test_pg_repack_guardrail_requires_pg_repack_binary(tmp_path: Path) -> None:
    result, command_log = _run_guardrail(tmp_path, with_pg_repack=False)

    assert result.returncode == 127
    assert "pg_repack command not found" in result.stderr
    assert command_log.read_text(encoding="utf-8") == ""


def test_pg_repack_guardrail_defaults_to_table_scoped_dry_run(tmp_path: Path) -> None:
    result, command_log = _run_guardrail(tmp_path)

    assert result.returncode == 0, result.stderr
    assert "Mode: dry-run" in result.stdout
    assert "secret" not in result.stdout
    command = command_log.read_text(encoding="utf-8")
    assert "--dry-run" in command
    assert "--dbname postgresql://app:secret@example.com:5432/transit" in command
    assert "--table silver.trip_updates" in command
    assert "--table silver.vehicle_positions" in command
    assert "--table gold.fact_vehicle_snapshot" in command


def test_pg_repack_guardrail_live_mode_keeps_conservative_lock_policy(
    tmp_path: Path,
) -> None:
    result, command_log = _run_guardrail(
        tmp_path,
        PG_REPACK_DRY_RUN="false",
        PG_REPACK_JOBS="3",
        PG_REPACK_WAIT_TIMEOUT="90",
        PG_REPACK_TABLES="silver.trip_updates gold.fact_vehicle_snapshot",
    )

    assert result.returncode == 0, result.stderr
    assert "Mode: execute" in result.stdout
    command = command_log.read_text(encoding="utf-8")
    assert "--dry-run" not in command
    assert "--no-kill-backend" in command
    assert "--jobs 3" in command
    assert "--wait-timeout 90" in command
    assert "--table silver.trip_updates" in command
    assert "--table gold.fact_vehicle_snapshot" in command
