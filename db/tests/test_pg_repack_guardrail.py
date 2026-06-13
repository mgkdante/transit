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
            "printf 'pg_repack stub ok\\n'\n",
        )

    if with_psql:
        # Logs its args; emits the leftover count for the leftover-detection
        # query (recognised by 'repack' or 'nspname'), otherwise a size row.
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


# The 10 current churn tables the guardrail must repack — mirrors maintenance.py
# (REALTIME_SILVER_TABLES minus the 29GB stop_times, GOLD_FACT_TABLES, the
# gold.latest_* live tables, the two gold.*_summary_5m warm rollups).
CURRENT_DEFAULT_TABLES = (
    "silver.rt_trip_updates",
    "silver.rt_vehicle_positions",
    "silver.rt_entities",
    "silver.rt_feed_snapshots",
    "gold.fact_vehicle_snapshot",
    "gold.fact_trip_delay_snapshot",
    "gold.latest_vehicle_snapshot",
    "gold.latest_trip_delay_snapshot",
    "gold.vehicle_summary_5m",
    "gold.trip_delay_summary_5m",
)

# Names dropped by migration 0014 (or deliberately excluded) — the guardrail must
# NEVER target these. The first three are the exact relations the broken default
# named (gh run 27088244828: exit 21). The last is the 29GB table carved out of
# the CI default. None is a substring of any CURRENT_DEFAULT_TABLES entry.
FORBIDDEN_DEFAULT_TABLES = (
    "--table silver.trip_updates",
    "--table silver.trip_update_stop_time_updates",
    "--table silver.vehicle_positions",
    "--table silver.rt_trip_update_stop_times",
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
    # pg_repack's CREATE INDEX phase can spawn parallel maintenance workers that
    # each grab a DSM segment (0017 parallel-VACUUM crash precedent). The script
    # must export PGOPTIONS disabling them for every repack connection.
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


def test_pg_repack_guardrail_skips_size_report_without_psql(tmp_path: Path) -> None:
    # A size report path IS configured but psql is absent from PATH: the run must
    # succeed and note the capture was skipped (the guardrail never fails just
    # because reporting can't run). Build a minimal tools dir holding only the
    # shell utilities the script needs, so no real /usr/bin/psql leaks in.
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
