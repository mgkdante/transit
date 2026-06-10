from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "validate-oracle-cutover.sh"


def _make_executable(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def _make_log_path(tmp_path: Path) -> Path:
    log_path = tmp_path / "commands.log"
    log_path.write_text("", encoding="utf-8")
    return log_path


def _read_log(path: Path) -> list[str]:
    return [line for line in path.read_text(encoding="utf-8").splitlines() if line]


def _stubbed_env(
    tmp_path: Path,
    *,
    include_gh: bool = True,
    include_psql: bool = True,
) -> dict[str, str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    (bin_dir / "bash").symlink_to("/usr/bin/bash")
    (bin_dir / "awk").symlink_to("/usr/bin/awk")
    (bin_dir / "cat").symlink_to("/bin/cat")
    _make_executable(
        bin_dir / "curl",
        "#!/usr/bin/env bash\n"
        "printf 'curl|%s\\n' \"$*\" >> \"$COMMAND_LOG\"\n"
        "if [[ -n \"${FAKE_CURL_FAIL_PATTERN:-}\" "
        "&& \"$*\" == *\"${FAKE_CURL_FAIL_PATTERN}\"* ]]; then\n"
        "  exit 22\n"
        "fi\n"
        "status=\"${FAKE_CURL_HTTP_CODE:-200}\"\n"
        "if [[ \"$*\" == *'/health/live'* ]]; then\n"
        "  status=\"${FAKE_HEALTH_LIVE_HTTP_CODE:-200}\"\n"
        "elif [[ \"$*\" == *'/health'* ]]; then\n"
        "  status=\"${FAKE_HEALTH_HTTP_CODE:-200}\"\n"
        "fi\n"
        "if [[ \"$*\" == *'--fail'* && \"$status\" =~ ^[45] ]]; then\n"
        "  exit 22\n"
        "fi\n"
        "if [[ \"$*\" == *'--write-out'* ]]; then\n"
        "  printf '\\n%s' \"$status\"\n"
        "fi\n"
        "exit 0\n",
    )
    _make_executable(
        bin_dir / "git",
        "#!/usr/bin/env bash\n"
        "printf 'git|%s\\n' \"$*\" >> \"$COMMAND_LOG\"\n"
        "case \"$*\" in\n"
        "  'branch --show-current') "
        "printf '%s\\n' \"${FAKE_GIT_BRANCH:-codex/slice-6.5-cutover-validation}\" ;;\n"
        "  'rev-parse --abbrev-ref --symbolic-full-name @{u}') "
        "printf '%s\\n' \"${FAKE_GIT_UPSTREAM:-origin/main}\" ;;\n"
        "  'rev-list --left-right --count @{u}...HEAD') "
        "printf '%s\\n' \"${FAKE_GIT_AHEAD_BEHIND:-0 0}\" ;;\n"
        "  'status --porcelain') printf '%s' \"${FAKE_GIT_STATUS:-}\" ;;\n"
        "  'merge-base --is-ancestor HEAD origin/main') "
        "exit \"${FAKE_ORIGIN_INCLUDES_HEAD_EXIT:-0}\" ;;\n"
        "  'merge-base --is-ancestor origin/main HEAD') "
        "exit \"${FAKE_HEAD_INCLUDES_ORIGIN_EXIT:-0}\" ;;\n"
        "  *) printf 'unexpected git command: %s\\n' \"$*\" >&2; exit 2 ;;\n"
        "esac\n",
    )
    _make_executable(
        bin_dir / "ssh",
        "#!/usr/bin/env bash\n"
        "printf 'ssh|%s\\n' \"$*\" >> \"$COMMAND_LOG\"\n"
        "exit_code=\"${FAKE_SSH_EXIT_CODE:-0}\"\n"
        "if [[ \"$exit_code\" != 0 ]]; then\n"
        "  exit \"$exit_code\"\n"
        "fi\n"
        "if [[ \"$*\" == *'--write-out'* ]]; then\n"
        "  if [[ \"$*\" == *'/health/live'* ]]; then\n"
        "    printf '\\n%s' \"${FAKE_HEALTH_LIVE_HTTP_CODE:-200}\"\n"
        "  else\n"
        "    printf '\\n%s' \"${FAKE_HEALTH_HTTP_CODE:-200}\"\n"
        "  fi\n"
        "fi\n"
        "exit 0\n",
    )
    if include_psql:
        _make_executable(
            bin_dir / "psql",
            "#!/usr/bin/env bash\n"
            "printf 'psql|%s\\n' \"$*\" >> \"$COMMAND_LOG\"\n"
            "printf 'BEGIN\\n'\n"
            "printf '%s\\n' \"${FAKE_PSQL_OUTPUT:-120|90|12|8}\"\n"
            "printf 'ROLLBACK\\n'\n"
            "exit \"${FAKE_PSQL_EXIT_CODE:-0}\"\n",
        )
    else:
        _make_executable(
            bin_dir / "uv",
            "#!/usr/bin/env bash\n"
            "printf 'uv|%s\\n' \"$*\" >> \"$COMMAND_LOG\"\n"
            "cat >/dev/null\n"
            "printf '%s\\n' \"${FAKE_UV_PYTHON_OUTPUT:-120|90|12|8}\"\n"
            "exit \"${FAKE_UV_EXIT_CODE:-0}\"\n",
        )
    if include_gh:
        _make_executable(
            bin_dir / "gh",
            "#!/usr/bin/env bash\n"
            "printf 'gh|%s\\n' \"$*\" >> \"$COMMAND_LOG\"\n"
            "if [[ \"$*\" == workflow\\ list* ]]; then\n"
            "  printf 'Daily Static Pipeline\\t%s\\t251852149\\n' "
            "\"${FAKE_GH_STATIC_WORKFLOW_STATE:-active}\"\n"
            "  printf 'Daily Warm Rollups\\t%s\\t252580003\\n' "
            "\"${FAKE_GH_WARM_WORKFLOW_STATE:-active}\"\n"
            "  exit 0\n"
            "fi\n"
            "if [[ \"$*\" == run\\ list* ]]; then\n"
            "  if [[ \"$*\" == *'Daily Warm Rollups'* ]]; then\n"
            "    printf '%s\\n' \"${FAKE_GH_WARM_RUN:-success|456|https://example.test/warm|2026-05-23T21:44:41Z}\"\n"
            "  else\n"
            "    printf '%s\\n' \"${FAKE_GH_STATIC_RUN:-success|123|https://example.test/static|2026-05-23T21:44:03Z}\"\n"
            "  fi\n"
            "  exit 0\n"
            "fi\n"
            "printf 'unexpected gh command: %s\\n' \"$*\" >&2\n"
            "exit 2\n",
        )

    env = os.environ.copy()
    env["PATH"] = (
        str(bin_dir)
        if not include_psql
        else f"{bin_dir}:{env['PATH']}"
        if include_gh
        else str(bin_dir)
    )
    env["COMMAND_LOG"] = str(_make_log_path(tmp_path))
    env["HEALTH_BASE_URL"] = "https://transit.example.com"
    env["POWERBI_REPORT_URL"] = "https://app.powerbi.com/view?r=report-id-example"
    env["DATABASE_URL"] = "postgresql://app:secret@example.com/transit"
    return env


def _run_script(
    tmp_path: Path,
    *,
    cwd: Path = REPO_ROOT,
    **env_overrides: str,
) -> subprocess.CompletedProcess[str]:
    env = _stubbed_env(tmp_path)
    env.update(env_overrides)
    return subprocess.run(
        ["bash", str(SCRIPT_PATH)],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def _run_script_without_psql(
    tmp_path: Path,
    **env_overrides: str,
) -> subprocess.CompletedProcess[str]:
    env = _stubbed_env(tmp_path, include_psql=False)
    env.update(env_overrides)
    return subprocess.run(
        ["bash", str(SCRIPT_PATH)],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_validate_oracle_cutover_reports_success_without_mutating_systems(
    tmp_path: Path,
) -> None:
    result = _run_script(tmp_path)

    assert result.returncode == 0, result.stderr
    assert "PASS Git readiness:" in result.stdout
    assert "PASS Health endpoint /health/live: reachable" in result.stdout
    assert "PASS Health endpoint /health: status ok" in result.stdout
    assert "PASS Realtime freshness: vehicle_age=120s, trip_age=90s" in (
        result.stdout
    )
    assert "vehicles=12, trips=8" in result.stdout
    assert "PASS GitHub workflow Daily Static Pipeline: active" in result.stdout
    assert "PASS GitHub workflow Daily Warm Rollups: active" in result.stdout
    assert "created_at=2026-05-23T21:44:41Z" in result.stdout
    assert "PASS Power BI report page: reachable" in result.stdout
    assert "PASS Rollback prereqs:" in result.stdout
    assert (
        "No rollback, merge, push, workflow trigger, docker compose, "
        "or database mutation was run."
    ) in result.stdout

    log_lines = _read_log(tmp_path / "commands.log")
    assert (
        "curl|--fail --silent --show-error --location --max-time 15 "
        "https://transit.example.com/health/live"
    ) in log_lines
    assert (
        "curl|--silent --show-error --location --max-time 15 "
        "--write-out \\n%{http_code} "
        "https://transit.example.com/health"
    ) in log_lines
    assert (
        "curl|--fail --silent --show-error --location --max-time 15 "
        "https://app.powerbi.com/view?r=report-id-example"
    ) in log_lines
    assert any(line.startswith("psql|") for line in log_lines)
    assert any("BEGIN READ ONLY" in line for line in log_lines)
    assert any("gold.latest_vehicle_snapshot" in line for line in log_lines)
    assert any("gold.latest_trip_delay_snapshot" in line for line in log_lines)
    assert not any("raw.realtime_snapshot_index" in line for line in log_lines)
    assert not any("core.feed_endpoints" in line for line in log_lines)
    assert any("gh|workflow list --repo mgkdante/transit" in line for line in log_lines)
    assert any("gh|run list --workflow Daily Warm Rollups" in line for line in log_lines)
    assert any("--branch main" in line for line in log_lines)

    forbidden_fragments = [
        "git|merge ",
        "git|push",
        "gh|workflow run",
        "gh|workflow enable",
        "gh|workflow disable",
        "docker|compose",
        "insert ",
        "update ",
        "delete ",
        "truncate ",
        "drop ",
        "alter ",
    ]
    lowered_log_lines = [line.lower() for line in log_lines]
    assert not any(
        fragment in line for fragment in forbidden_fragments for line in lowered_log_lines
    )


def test_validate_oracle_cutover_fails_when_required_inputs_are_missing(
    tmp_path: Path,
) -> None:
    env = _stubbed_env(tmp_path, include_gh=False)
    env.pop("HEALTH_BASE_URL")
    env.pop("POWERBI_REPORT_URL")
    env.pop("DATABASE_URL")

    result = subprocess.run(
        ["bash", str(SCRIPT_PATH)],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode != 0
    assert "FAIL Health endpoints: HEALTH_BASE_URL is required" in result.stdout
    assert "FAIL Realtime freshness: DATABASE_URL is required" in result.stdout
    assert "FAIL GitHub workflows: gh command is required" in result.stdout
    assert "FAIL Power BI report page: POWERBI_REPORT_URL is required" in result.stdout

    log_lines = _read_log(tmp_path / "commands.log")
    assert not any(line.startswith("psql|") for line in log_lines)
    assert not any(line.startswith("gh|") for line in log_lines)


def test_validate_oracle_cutover_can_check_health_through_ssh(
    tmp_path: Path,
) -> None:
    result = _run_script(
        tmp_path,
        HEALTH_BASE_URL="http://127.0.0.1:8080",
        HEALTH_SSH_TARGET="ubuntu@db.transit.yesid.dev",
        HEALTH_SSH_IDENTITY_FILE="/tmp/transit-key",
    )

    assert result.returncode == 0, result.stderr
    assert "PASS Health endpoint /health/live: reachable" in result.stdout
    assert "PASS Health endpoint /health: status ok" in result.stdout

    log_lines = _read_log(tmp_path / "commands.log")
    assert any(
        line.startswith("ssh|-i /tmp/transit-key -o BatchMode=yes -o ConnectTimeout=8 ")
        and "ubuntu@db.transit.yesid.dev" in line
        and "http://127.0.0.1:8080/health/live" in line
        for line in log_lines
    )
    assert any(
        line.startswith("ssh|-i /tmp/transit-key -o BatchMode=yes -o ConnectTimeout=8 ")
        and "ubuntu@db.transit.yesid.dev" in line
        and "http://127.0.0.1:8080/health" in line
        and "--write-out" in line
        for line in log_lines
    )


def test_validate_oracle_cutover_fails_when_health_report_needs_attention(
    tmp_path: Path,
) -> None:
    result = _run_script(tmp_path, FAKE_HEALTH_HTTP_CODE="503")

    assert result.returncode != 0
    assert "PASS Health endpoint /health/live: reachable" in result.stdout
    assert "FAIL Health endpoint /health: needs attention (HTTP 503)" in result.stdout


def test_validate_oracle_cutover_warns_but_exits_zero_for_dirty_worktree(
    tmp_path: Path,
) -> None:
    result = _run_script(tmp_path, FAKE_GIT_STATUS=" M README.md")

    assert result.returncode == 0, result.stderr
    assert "WARN Git readiness: working tree has uncommitted changes" in result.stdout
    assert "FAIL " not in result.stdout


def test_validate_oracle_cutover_fails_on_stale_realtime_and_failed_workflow(
    tmp_path: Path,
) -> None:
    result = _run_script(
        tmp_path,
        FAKE_PSQL_OUTPUT="240|90|12|8",
        FAKE_GH_WARM_RUN="failure|456|https://example.test/warm|2026-05-23T21:44:41Z",
    )

    assert result.returncode != 0
    assert (
        "FAIL Realtime freshness: Gold latest age exceeds threshold 180s "
        "(vehicle=240s, trip=90s)"
    ) in result.stdout
    assert "FAIL GitHub workflow Daily Warm Rollups: latest completed run failure" in result.stdout
    assert "PASS Health endpoint /health/live: reachable" in result.stdout


def test_validate_oracle_cutover_fails_when_workflow_run_predates_cutover_marker(
    tmp_path: Path,
) -> None:
    result = _run_script(
        tmp_path,
        MIN_WORKFLOW_RUN_CREATED_AT="2026-05-24T00:00:00Z",
        FAKE_GH_STATIC_RUN="success|123|https://example.test/static|2026-05-23T21:44:03Z",
    )

    assert result.returncode != 0
    assert (
        "FAIL GitHub workflow Daily Static Pipeline: latest completed main run "
        "created_at=2026-05-23T21:44:03Z predates required 2026-05-24T00:00:00Z"
    ) in result.stdout


def test_validate_oracle_cutover_fails_cleanly_for_invalid_freshness_threshold(
    tmp_path: Path,
) -> None:
    result = _run_script(tmp_path, MAX_REALTIME_AGE_SECONDS="abc")

    assert result.returncode != 0
    assert (
        "FAIL Realtime freshness: MAX_REALTIME_AGE_SECONDS must be a positive integer"
    ) in result.stdout
    assert "unbound variable" not in result.stderr


def test_validate_oracle_cutover_fails_when_gold_latest_table_is_empty(
    tmp_path: Path,
) -> None:
    result = _run_script(tmp_path, FAKE_PSQL_OUTPUT="120|90|0|8")

    assert result.returncode != 0
    assert "FAIL Realtime freshness: expected positive Gold row counts, got vehicles=0 trips=8" in (
        result.stdout
    )


def test_validate_oracle_cutover_fails_when_only_one_endpoint_is_stale(
    tmp_path: Path,
) -> None:
    result = _run_script(tmp_path, FAKE_PSQL_OUTPUT="120|240|12|8")

    assert result.returncode != 0
    assert (
        "FAIL Realtime freshness: Gold latest age exceeds threshold 180s "
        "(vehicle=120s, trip=240s)"
    ) in result.stdout


def test_validate_oracle_cutover_uses_uv_python_fallback_when_psql_is_missing(
    tmp_path: Path,
) -> None:
    result = _run_script_without_psql(tmp_path)

    assert result.returncode == 0, result.stderr
    assert "PASS Realtime freshness: vehicle_age=120s" in result.stdout
    log_lines = _read_log(tmp_path / "commands.log")
    assert not any(line.startswith("psql|") for line in log_lines)
    assert any(line == "uv|run python -" for line in log_lines)


def test_validate_oracle_cutover_fails_when_compose_database_url_is_comment_only(
    tmp_path: Path,
) -> None:
    runtime_root = tmp_path / "runtime-root"
    scripts_dir = runtime_root / "scripts"
    scripts_dir.mkdir(parents=True)
    (scripts_dir / "pause-pipeline.sh").write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    (scripts_dir / "resume-pipeline.sh").write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    (runtime_root / "Caddyfile").write_text(":80\n", encoding="utf-8")
    (runtime_root / "docker-compose.yml").write_text(
        "services:\n"
        "  worker:\n"
        "    environment:\n"
        "      # DATABASE_URL: postgresql://comment-only\n",
        encoding="utf-8",
    )

    result = _run_script(tmp_path, cwd=runtime_root)

    assert result.returncode != 0
    assert (
        "FAIL Rollback prereqs: missing or unconfigured "
        "docker-compose.yml DATABASE_URL"
    ) in result.stdout
