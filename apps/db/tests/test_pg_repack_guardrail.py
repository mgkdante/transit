from __future__ import annotations

import os
import shutil
import stat
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "run-pg-repack.sh"


def _make_executable(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def _stubbed_env(
    tmp_path: Path,
    *,
    with_pg_repack: bool = True,
    with_psql: bool = False,
) -> tuple[dict[str, str], Path]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    command_log = tmp_path / "pg_repack.log"
    command_log.write_text("", encoding="utf-8")
    psql_log = tmp_path / "psql.log"
    psql_log.write_text("", encoding="utf-8")

    if with_pg_repack:
        _make_executable(
            bin_dir / "pg_repack",
            "#!/usr/bin/env bash\n"
            "printf '%s\\n' \"$*\" >> \"$PG_REPACK_COMMAND_LOG\"\n"
            'printf "PGOPTIONS=%s\\n" "${PGOPTIONS:-}" >> "$PG_REPACK_COMMAND_LOG"\n'
            "printf 'pg_repack stub ok\\n'\n"
            'exit "${PG_REPACK_STUB_EXIT:-0}"\n',
        )

    if with_psql:
        _make_executable(
            bin_dir / "psql",
            "#!/usr/bin/env bash\n"
            'printf "%s\\n" "$*" >> "$PSQL_COMMAND_LOG"\n'
            'if [[ "$*" == *repack* || "$*" == *nspname* ]]; then\n'
            '  printf "%s\\n" "${PSQL_STUB_LEFTOVER_COUNT:-0}"\n'
            "else\n"
            '  printf "tbl|12345|12 MB\\n"\n'
            "fi\n",
        )

    env = os.environ.copy()
    env["PATH"] = f"{bin_dir}:{env['PATH']}"
    env["DATABASE_URL"] = "postgresql://app:secret@example.com:5432/transit"
    env["PG_REPACK_COMMAND_LOG"] = str(command_log)
    env["PSQL_COMMAND_LOG"] = str(psql_log)
    return env, command_log


def _run_guardrail(
    tmp_path: Path,
    *,
    with_pg_repack: bool = True,
    with_psql: bool = False,
    **env_overrides: str,
) -> tuple[subprocess.CompletedProcess[str], Path]:
    env, command_log = _stubbed_env(
        tmp_path, with_pg_repack=with_pg_repack, with_psql=with_psql
    )
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


CURRENT_DEFAULT_TABLES = (
    "silver.rt_trip_updates",
    "silver.rt_vehicle_positions",
    "silver.rt_entities",
    "silver.rt_feed_snapshots",
    "gold.latest_vehicle_snapshot",
    "gold.latest_trip_delay_snapshot",
    "gold.trip_delay_summary_5m",
)

FORBIDDEN_DEFAULT_TABLES = (
    "--table silver.trip_updates",
    "--table silver.trip_update_stop_time_updates",
    "--table silver.vehicle_positions",
    "--table silver.rt_trip_update_stop_times",
    "--table gold.fact_vehicle_snapshot",
    "--table gold.fact_trip_delay_snapshot",
)


def test_pg_repack_guardrail_defaults_to_table_scoped_dry_run(tmp_path: Path) -> None:
    result, command_log = _run_guardrail(tmp_path)

    assert result.returncode == 0, result.stderr
    assert "Mode: dry-run" in result.stdout
    assert "secret" not in result.stdout
    command = command_log.read_text(encoding="utf-8")
    assert "--dry-run" in command
    assert "--dbname postgresql://app:secret@example.com:5432/transit" in command
    for table in CURRENT_DEFAULT_TABLES:
        assert f"--table {table}" in command, table
    for forbidden in FORBIDDEN_DEFAULT_TABLES:
        assert forbidden not in command, forbidden


def test_pg_repack_guardrail_live_mode_keeps_conservative_lock_policy(
    tmp_path: Path,
) -> None:
    result, command_log = _run_guardrail(
        tmp_path,
        with_psql=True,
        PG_REPACK_DRY_RUN="false",
        PG_REPACK_JOBS="3",
        PG_REPACK_WAIT_TIMEOUT="90",
        PG_REPACK_TABLES="silver.rt_trip_updates gold.fact_vehicle_snapshot",
    )

    assert result.returncode == 0, result.stderr
    assert "Mode: execute" in result.stdout
    command = command_log.read_text(encoding="utf-8")
    assert "--dry-run" not in command
    assert "--no-kill-backend" in command
    assert "--jobs 3" in command
    assert "--wait-timeout 90" in command
    assert "--table silver.rt_trip_updates" in command
    assert "--table gold.fact_vehicle_snapshot" in command


def test_pg_repack_guardrail_disables_parallel_maintenance_workers(
    tmp_path: Path,
) -> None:
    result, command_log = _run_guardrail(tmp_path)

    assert result.returncode == 0, result.stderr
    command = command_log.read_text(encoding="utf-8")
    assert "PGOPTIONS=" in command
    assert "max_parallel_maintenance_workers=0" in command


def test_pg_repack_guardrail_writes_before_after_size_report(tmp_path: Path) -> None:
    report = tmp_path / "sizes.txt"
    result, _ = _run_guardrail(
        tmp_path,
        with_psql=True,
        PG_REPACK_DRY_RUN="false",
        PG_REPACK_SIZE_REPORT=str(report),
        PG_REPACK_TABLES="silver.rt_trip_updates",
    )

    assert result.returncode == 0, result.stderr
    report_text = report.read_text(encoding="utf-8")
    assert "== before ==" in report_text
    assert "== after ==" in report_text
    psql_log = (tmp_path / "psql.log").read_text(encoding="utf-8")
    assert "pg_total_relation_size" in psql_log
    assert "to_regclass" in psql_log


def test_pg_repack_guardrail_dry_run_captures_only_before(tmp_path: Path) -> None:
    report = tmp_path / "sizes.txt"
    result, _ = _run_guardrail(
        tmp_path,
        with_psql=True,
        PG_REPACK_DRY_RUN="true",
        PG_REPACK_SIZE_REPORT=str(report),
        PG_REPACK_TABLES="silver.rt_trip_updates",
    )

    assert result.returncode == 0, result.stderr
    report_text = report.read_text(encoding="utf-8")
    assert "== before ==" in report_text
    assert "== after ==" not in report_text


def test_pg_repack_guardrail_fails_when_repack_leftovers_detected(
    tmp_path: Path,
) -> None:
    result, _ = _run_guardrail(
        tmp_path,
        with_psql=True,
        PG_REPACK_DRY_RUN="false",
        PG_REPACK_TABLES="silver.rt_trip_updates",
        PSQL_STUB_LEFTOVER_COUNT="2",
    )

    assert result.returncode == 3, result.stdout
    assert "orphaned repack objects" in result.stderr
    assert "DROP EXTENSION pg_repack CASCADE" in result.stderr


def test_pg_repack_guardrail_runs_leftover_sweep_when_repack_fails(
    tmp_path: Path,
) -> None:
    result, _ = _run_guardrail(
        tmp_path,
        with_psql=True,
        PG_REPACK_DRY_RUN="false",
        PG_REPACK_TABLES="silver.rt_trip_updates",
        PG_REPACK_STUB_EXIT="1",
        PSQL_STUB_LEFTOVER_COUNT="3",
    )

    assert result.returncode == 3, result.stdout
    assert "orphaned repack objects" in result.stderr
    assert "DROP EXTENSION pg_repack CASCADE" in result.stderr


def test_pg_repack_guardrail_propagates_repack_failure_without_leftovers(
    tmp_path: Path,
) -> None:
    result, _ = _run_guardrail(
        tmp_path,
        with_psql=True,
        PG_REPACK_DRY_RUN="false",
        PG_REPACK_TABLES="silver.rt_trip_updates",
        PG_REPACK_STUB_EXIT="5",
        PSQL_STUB_LEFTOVER_COUNT="0",
    )

    assert result.returncode == 5, result.stdout
    psql_log = (tmp_path / "psql.log").read_text(encoding="utf-8")
    assert "repack" in psql_log or "nspname" in psql_log


def test_pg_repack_guardrail_skips_size_report_without_psql(tmp_path: Path) -> None:
    tools = tmp_path / "tools"
    tools.mkdir()
    for util in ("bash", "tr", "env", "command", "printf", "cat", "wget", "rm"):
        src = shutil.which(util)
        if src:
            (tools / util).symlink_to(src)

    report = tmp_path / "sizes.txt"
    result, _ = _run_guardrail(
        tmp_path,
        with_psql=False,
        PG_REPACK_DRY_RUN="true",
        PG_REPACK_SIZE_REPORT=str(report),
        PG_REPACK_TABLES="silver.rt_trip_updates",
        PATH=f"{tmp_path / 'bin'}:{tools}",
    )

    assert result.returncode == 0, result.stderr
    assert "skipping before/after size report capture" in result.stderr
    assert not report.exists()
