
from __future__ import annotations

import os
import shutil
import sqlite3
import stat
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
GH_SCRIPTS_DIR = REPO_ROOT / ".github" / "scripts"
ALERT_ISSUE = GH_SCRIPTS_DIR / "alert-issue.sh"
FRESHNESS_PROBE = GH_SCRIPTS_DIR / "freshness-probe.sh"


def _make_executable(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8", newline="\n")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def _stubbed_env(tmp_path: Path) -> tuple[dict[str, str], Path]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)

    _make_executable(
        bin_dir / "gh",
        "#!/usr/bin/env bash\n"
        'if [[ -n "${COMMAND_LOG:-}" ]]; then\n'
        "  printf 'gh|%s\\n' \"$*\" >> \"$COMMAND_LOG\"\n"
        "fi\n"
        'if [[ -n "${GH_FAIL_PATTERN:-}" && "$*" == *"${GH_FAIL_PATTERN}"* ]]; then\n'
        '  printf \'gh forced failure for %s\\n\' "$*" >&2\n'
        "  exit 1\n"
        "fi\n"
        'if [[ "$1" == "issue" && "$2" == "list" ]]; then\n'
        '  printf \'%s\' "${GH_ISSUE_LIST_OUTPUT:-}"\n'
        "  exit 0\n"
        "fi\n"
        'printf \'gh %s\\n\' "$*"\n',
    )
    _make_executable(
        bin_dir / "curl",
        "#!/usr/bin/env bash\n"
        'if [[ -n "${COMMAND_LOG:-}" ]]; then\n'
        "  printf 'curl|%s\\n' \"$*\" >> \"$COMMAND_LOG\"\n"
        "fi\n"
        'if [[ -n "${CURL_FAIL_PATTERN:-}" && "$*" == *"${CURL_FAIL_PATTERN}"* ]]; then\n'
        "  exit 22\n"
        "fi\n"
        'printf \'%s\' "${CURL_OUTPUT:-}"\n',
    )
    _make_executable(
        bin_dir / "psql",
        "#!/usr/bin/env bash\n"
        'if [[ -n "${COMMAND_LOG:-}" ]]; then\n'
        "  printf 'psql|%s\\n' \"$*\" >> \"$COMMAND_LOG\"\n"
        "fi\n"
        'if [[ -n "${PSQL_FAIL_PATTERN:-}" && "$*" == *"${PSQL_FAIL_PATTERN}"* ]]; then\n'
        '  exit 2\n'
        "fi\n"
        'if [[ -n "${PSQL_FIXTURE_DB:-}" ]]; then\n'
        '  exec "$PSQL_PYTHON" "$PSQL_FIXTURE_RUNNER" "$@"\n'
        "fi\n"
        'state="${PSQL_STATE_FILE:?PSQL_STATE_FILE unset}"\n'
        'idx=$(cat "$state" 2>/dev/null || echo 0)\n'
        'mapfile -t outs <<< "${PSQL_OUTPUTS:-}"\n'
        'echo $((idx + 1)) > "$state"\n'
        'if [[ "${PSQL_FAIL_INDEX:-}" == "$idx" ]]; then exit 2; fi\n'
        'printf \'%s\\n\' "${outs[$idx]-0}"\n',
    )

    env = os.environ.copy()
    env["PATH"] = f"{bin_dir}{os.pathsep}{env['PATH']}"
    env["TEST_BIN_DIR"] = bin_dir.as_posix()
    env["PSQL_STATE_FILE"] = str(tmp_path / "psql_state")
    return env, bin_dir


def _stub_alert_issue(bin_dir: Path) -> None:
    _make_executable(
        bin_dir / "alert-issue.sh",
        "#!/usr/bin/env bash\n"
        'if [[ -n "${COMMAND_LOG:-}" ]]; then\n'
        "  printf 'alert-issue|%s\\n' \"$*\" >> \"$COMMAND_LOG\"\n"
        "fi\n"
        "exit 0\n",
    )


def _read_log(path: Path) -> list[str]:
    return [line for line in path.read_text(encoding="utf-8").splitlines() if line]


def _run(script: Path, args: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    env = env.copy()
    for key in ("COMMAND_LOG", "PSQL_STATE_FILE"):
        if key in env:
            env[key] = env[key].replace("\\", "/")
    bash = shutil.which("bash")
    if os.name == "nt":
        # Windows' system bash launches WSL. Keep execution on the native host.
        git_bash = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git/bin/bash.exe"
        bash = str(git_bash) if git_bash.is_file() else None
    if not bash:
        pytest.skip("native Bash is unavailable")
    bin_path = '$(cygpath -u "$TEST_BIN_DIR")' if os.name == "nt" else "$TEST_BIN_DIR"
    return subprocess.run(
        [bash, "-c", f'export PATH="{bin_path}:$PATH"; source "$@"',
         "alerting-test", script.as_posix(), *args],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def _provider_fixture_env(tmp_path: Path) -> tuple[dict[str, str], Path]:
    """Run the emitted SQL against isolated rows, translating only PG age syntax."""
    env, log = _probe_env(tmp_path)
    database = tmp_path / "freshness.sqlite"
    with sqlite3.connect(database) as conn:
        conn.executescript("""
            CREATE TABLE feed_endpoints (
                feed_endpoint_id INTEGER, provider_id TEXT, endpoint_key TEXT, is_enabled BOOLEAN
            );
            CREATE TABLE realtime_snapshot_index (
                feed_endpoint_id INTEGER, captured_at_utc INTEGER
            );
            CREATE TABLE i3_alert_snapshots (feed_endpoint_id INTEGER, captured_at_utc INTEGER);
            CREATE TABLE rt_feed_snapshots (
                provider_id TEXT, feed_endpoint_id INTEGER,
                endpoint_key TEXT, captured_at_utc INTEGER
            );
            CREATE TABLE ingestion_runs (provider_id TEXT, status TEXT, started_at_utc INTEGER);
            CREATE TABLE dataset_versions (
                provider_id TEXT, dataset_kind TEXT, is_current BOOLEAN, last_seen_at_utc INTEGER
            );
            CREATE TABLE snapshot_publish_state (
                provider_id TEXT, tier TEXT, updated_at_utc INTEGER
            );
        """)
        for provider, base in (("stm", 0), ("octranspo", 10)):
            for offset, endpoint in ((1, "trip_updates"), (2, "vehicle_positions")):
                endpoint_id = base + offset
                conn.execute("INSERT INTO feed_endpoints VALUES (?, ?, ?, true)",
                             (endpoint_id, provider, endpoint))
                conn.execute("INSERT INTO realtime_snapshot_index VALUES (?, 1999999880)",
                             (endpoint_id,))
                conn.execute("INSERT INTO rt_feed_snapshots VALUES (?, ?, ?, 1999999880)",
                             (provider, endpoint_id, endpoint))
            conn.execute("INSERT INTO dataset_versions "
                         "VALUES (?, 'static_schedule', true, 1999999880)",
                         (provider,))
            conn.execute("INSERT INTO snapshot_publish_state VALUES (?, 'historic', 1999999880)",
                         (provider,))
        conn.execute("INSERT INTO feed_endpoints VALUES (3, 'stm', 'i3_alerts', true)")
        conn.execute("INSERT INTO i3_alert_snapshots VALUES (3, 1999999880)")
    runner = tmp_path / "fixture_psql.py"
    runner.write_text('''import os
import re
import sqlite3
import sys

query = sys.argv[sys.argv.index("-c") + 1]
query = re.sub(r"\\b(?:core|raw|silver)\\.", "", query)
query = re.sub(
    r"EXTRACT\\(EPOCH FROM \\(now\\(\\) - (.*?)\\)\\)::bigint",
    r"age_seconds(\\1)", query, flags=re.S,
)
query = re.sub(r"make_interval\\(mins => (\\d+)\\)", r"(\\1 * 60)", query)
with sqlite3.connect(os.environ["PSQL_FIXTURE_DB"]) as conn:
    conn.create_function("now", 0, lambda: 2000000000)
    conn.create_function("age_seconds", 1,
                         lambda value: None if value is None else 2000000000 - value)
    print(conn.execute(query).fetchone()[0])
''', encoding="utf-8")
    env.update(
        PROVIDER_ID="octranspo",
        CURL_OUTPUT=_manifest_json(datetime.now(tz=UTC) - timedelta(seconds=60)),
        PSQL_FIXTURE_DB=database.as_posix(),
        PSQL_FIXTURE_RUNNER=runner.as_posix(),
        PSQL_PYTHON=Path(sys.executable).as_posix(),
    )
    return env, log


def test_alert_issue_fire_creates_labeled_issue_when_none_open(tmp_path) -> None:
    env, _bin = _stubbed_env(tmp_path)
    log = tmp_path / "cmd.log"
    log.write_text("", encoding="utf-8")
    env.update(
        COMMAND_LOG=str(log),
        GH_TOKEN="t",
        GH_REPO="mgkdante/transit",
        GH_ISSUE_LIST_OUTPUT="",
    )

    result = _run(ALERT_ISSUE, ["fire", "freshness", "[alert] stm stale", "details"], env)

    assert result.returncode == 0, result.stderr
    lines = _read_log(log)
    create = [ln for ln in lines if ln.startswith("gh|issue create")]
    assert len(create) == 1
    assert "pipeline-alert" in create[0]
    assert "alert:freshness" in create[0]


def test_alert_issue_fire_is_noop_when_issue_already_open(tmp_path) -> None:
    env, _bin = _stubbed_env(tmp_path)
    log = tmp_path / "cmd.log"
    log.write_text("", encoding="utf-8")
    env.update(
        COMMAND_LOG=str(log),
        GH_TOKEN="t",
        GH_REPO="mgkdante/transit",
        GH_ISSUE_LIST_OUTPUT="123",
    )

    result = _run(ALERT_ISSUE, ["fire", "freshness", "[alert] stm stale", "details"], env)

    assert result.returncode == 0, result.stderr
    lines = _read_log(log)
    assert not any(ln.startswith("gh|issue create") for ln in lines)


def test_alert_issue_resolve_comments_and_closes(tmp_path) -> None:
    env, _bin = _stubbed_env(tmp_path)
    log = tmp_path / "cmd.log"
    log.write_text("", encoding="utf-8")
    env.update(
        COMMAND_LOG=str(log),
        GH_TOKEN="t",
        GH_REPO="mgkdante/transit",
        GH_ISSUE_LIST_OUTPUT="123",
    )

    result = _run(ALERT_ISSUE, ["resolve", "freshness", "recovered"], env)

    assert result.returncode == 0, result.stderr
    lines = _read_log(log)
    assert any(ln.startswith("gh|issue comment 123") for ln in lines)
    assert any(ln.startswith("gh|issue close 123") for ln in lines)


def test_alert_issue_resolve_noop_without_open_issue(tmp_path) -> None:
    env, _bin = _stubbed_env(tmp_path)
    log = tmp_path / "cmd.log"
    log.write_text("", encoding="utf-8")
    env.update(
        COMMAND_LOG=str(log),
        GH_TOKEN="t",
        GH_REPO="mgkdante/transit",
        GH_ISSUE_LIST_OUTPUT="",
    )

    result = _run(ALERT_ISSUE, ["resolve", "freshness", "recovered"], env)

    assert result.returncode == 0, result.stderr
    lines = _read_log(log)
    assert not any(ln.startswith("gh|issue close") for ln in lines)
    assert not any(ln.startswith("gh|issue comment") for ln in lines)


def test_alert_issue_propagates_gh_failure(tmp_path) -> None:
    env, _bin = _stubbed_env(tmp_path)
    log = tmp_path / "cmd.log"
    log.write_text("", encoding="utf-8")
    env.update(
        COMMAND_LOG=str(log),
        GH_TOKEN="t",
        GH_REPO="mgkdante/transit",
        GH_ISSUE_LIST_OUTPUT="",
        GH_FAIL_PATTERN="issue create",
    )

    result = _run(ALERT_ISSUE, ["fire", "freshness", "[alert] stm stale", "details"], env)

    assert result.returncode != 0


def _manifest_json(live_generated_utc: datetime) -> str:
    def stamp(value: datetime) -> str:
        return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    return '{"files":{"live":{"generated_utc":"' + stamp(live_generated_utc) + '"}}}'


def _psql_outputs(
    *,
    static_heartbeat_age: int = 120,
    historic_heartbeat_age: int = 120,
    capture_age: int = 120,
    failed_runs: int = 0,
    silver_age: int = 120,
) -> str:
    return "\n".join(
        str(value)
        for value in (
            static_heartbeat_age,
            historic_heartbeat_age,
            capture_age,
            failed_runs,
            silver_age,
        )
    )


def _probe_env(tmp_path: Path):
    env, bin_dir = _stubbed_env(tmp_path)
    _stub_alert_issue(bin_dir)
    log = tmp_path / "cmd.log"
    log.write_text("", encoding="utf-8")
    env.update(
        COMMAND_LOG=str(log),
        GH_TOKEN="t",
        GH_REPO="mgkdante/transit",
        DATABASE_URL="postgresql://u:p@h/db",
        SNAPSHOT_PUBLIC_BASE_URL="https://transit.example/data",
        CHECK_GLOBAL_FAILED_RUNS="false",
    )
    return env, log


def test_freshness_probe_green_path_resolves_alert(tmp_path) -> None:
    env, log = _probe_env(tmp_path)
    env.update(
        CURL_OUTPUT=_manifest_json(datetime.now(tz=UTC) - timedelta(seconds=60)),
        PSQL_OUTPUTS=_psql_outputs(),
    )

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode == 0, result.stderr
    lines = _read_log(log)
    assert any(ln.startswith("alert-issue|resolve freshness") for ln in lines)
    assert not any(ln.startswith("alert-issue|fire") for ln in lines)


def test_freshness_probe_fires_on_stale_manifest(tmp_path) -> None:
    env, log = _probe_env(tmp_path)
    env.update(
        CURL_OUTPUT=_manifest_json(datetime.now(tz=UTC) - timedelta(seconds=1200)),
        PSQL_OUTPUTS=_psql_outputs(),
    )

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode != 0
    lines = _read_log(log)
    assert any(ln.startswith("alert-issue|fire freshness") for ln in lines)


def test_freshness_probe_fires_above_static_heartbeat_boundary(tmp_path) -> None:
    env, log = _probe_env(tmp_path)
    env.update(
        CURL_OUTPUT=_manifest_json(datetime.now(tz=UTC) - timedelta(seconds=60)),
        PSQL_OUTPUTS=_psql_outputs(static_heartbeat_age=129601),
    )

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode != 0
    assert "static_heartbeat: latest ingestion observation age 129601s > 129600s" in result.stderr
    lines = _read_log(log)
    assert len([ln for ln in lines if ln.startswith("alert-issue|fire freshness")]) == 1
    command_log = log.read_text(encoding="utf-8")
    assert command_log.count("core.dataset_versions") == 1
    assert "max(last_seen_at_utc)" in command_log
    assert "dataset_kind = 'static_schedule'" in command_log
    assert "is_current = true" in command_log


def test_freshness_probe_fires_above_historic_heartbeat_boundary(tmp_path) -> None:
    env, log = _probe_env(tmp_path)
    env.update(
        CURL_OUTPUT=_manifest_json(datetime.now(tz=UTC) - timedelta(seconds=60)),
        PSQL_OUTPUTS=_psql_outputs(historic_heartbeat_age=129601),
    )

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode != 0
    assert "historic_heartbeat: latest successful publish age 129601s > 129600s" in result.stderr
    lines = _read_log(log)
    assert len([ln for ln in lines if ln.startswith("alert-issue|fire freshness")]) == 1
    command_log = log.read_text(encoding="utf-8")
    assert command_log.count("core.snapshot_publish_state") == 1
    assert "max(updated_at_utc)" in command_log
    assert "tier = 'historic'" in command_log


def test_freshness_probe_allows_daily_heartbeats_at_36_hour_boundary(tmp_path) -> None:
    env, log = _probe_env(tmp_path)
    env.update(
        CURL_OUTPUT=_manifest_json(datetime.now(tz=UTC) - timedelta(seconds=60)),
        PSQL_OUTPUTS=_psql_outputs(
            static_heartbeat_age=129600,
            historic_heartbeat_age=129600,
        ),
    )

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode == 0, result.stderr
    lines = _read_log(log)
    assert any(ln.startswith("alert-issue|resolve freshness") for ln in lines)
    assert not any(ln.startswith("alert-issue|fire") for ln in lines)


def test_freshness_probe_fires_on_stale_db_capture(tmp_path) -> None:
    env, log = _probe_env(tmp_path)
    env.update(
        CURL_OUTPUT=_manifest_json(datetime.now(tz=UTC) - timedelta(seconds=60)),
        PSQL_OUTPUTS=_psql_outputs(capture_age=5000),
    )

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode != 0
    lines = _read_log(log)
    assert any(ln.startswith("alert-issue|fire freshness") for ln in lines)


def test_freshness_probe_fires_on_failed_run_burst(tmp_path) -> None:
    env, log = _probe_env(tmp_path)
    env.update(
        CURL_OUTPUT=_manifest_json(datetime.now(tz=UTC) - timedelta(seconds=60)),
        PSQL_OUTPUTS=_psql_outputs(failed_runs=42),
    )

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode != 0
    lines = _read_log(log)
    assert any(ln.startswith("alert-issue|fire freshness") for ln in lines)


@pytest.mark.parametrize("output,fail_index", [("", ""), ("invalid", ""), ("-1", ""), ("42", "3")])
def test_freshness_probe_never_resolves_an_unavailable_failed_run_count(
    tmp_path, output: str, fail_index: str,
) -> None:
    env, log = _probe_env(tmp_path)
    outputs = _psql_outputs().splitlines()
    outputs[3] = output
    env.update(
        CURL_OUTPUT=_manifest_json(datetime.now(tz=UTC) - timedelta(seconds=60)),
        PSQL_OUTPUTS="\n".join(outputs), PSQL_FAIL_INDEX=fail_index,
    )
    result = _run(FRESHNESS_PROBE, [], env)
    assert result.returncode == 1
    assert "failed_runs: count unavailable" in result.stderr
    assert "failed_runs=unavailable" in result.stdout
    lines = _read_log(log)
    assert any(ln.startswith("alert-issue|fire freshness") for ln in lines)
    assert not any(ln.startswith("alert-issue|resolve") for ln in lines)


@pytest.mark.parametrize(
    "failed_runs,live_age,failing",
    [(72, 832, True), (94, 60, True), (6, 60, False), (9, 60, False), (10, 60, True)],
)
def test_freshness_probe_keeps_burst_boundary_and_incident_readings(
    tmp_path, failed_runs: int, live_age: int, failing: bool,
) -> None:
    env, log = _probe_env(tmp_path)
    env.update(
        CURL_OUTPUT=_manifest_json(datetime.now(tz=UTC) - timedelta(seconds=live_age)),
        PSQL_OUTPUTS=_psql_outputs(failed_runs=failed_runs),
    )
    result = _run(FRESHNESS_PROBE, [], env)
    assert result.returncode == int(failing), result.stderr
    assert "freshness-probe: readings provider=stm" in result.stdout
    assert f"failed_runs={failed_runs}" in result.stdout
    assert "static_age_seconds=120 historic_age_seconds=120" in result.stdout
    action = "fire" if failing else "resolve"
    assert any(ln.startswith(f"alert-issue|{action} freshness") for ln in _read_log(log))


def test_freshness_probe_fires_on_unparseable_manifest(tmp_path) -> None:
    env, log = _probe_env(tmp_path)
    env.update(
        CURL_OUTPUT="<<not json>>",
        PSQL_OUTPUTS=_psql_outputs(),
    )

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode != 0
    lines = _read_log(log)
    assert any(ln.startswith("alert-issue|fire freshness") for ln in lines)


def test_freshness_probe_fires_on_manifest_fetch_failure(tmp_path) -> None:
    env, log = _probe_env(tmp_path)
    env.update(
        CURL_FAIL_PATTERN="manifest.json",
        PSQL_OUTPUTS=_psql_outputs(),
    )

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode != 0
    lines = _read_log(log)
    assert any(ln.startswith("alert-issue|fire freshness") for ln in lines)


@pytest.mark.parametrize("change", ["missing_provider", "stale_provider", "missing_endpoint"])
def test_freshness_probe_fails_for_ottawa_silver_while_stm_is_fresh(tmp_path, change) -> None:
    env, log = _provider_fixture_env(tmp_path)
    with sqlite3.connect(env["PSQL_FIXTURE_DB"]) as conn:
        if change == "missing_provider":
            conn.execute("DELETE FROM rt_feed_snapshots WHERE provider_id = 'octranspo'")
        elif change == "stale_provider":
            conn.execute("UPDATE rt_feed_snapshots SET captured_at_utc = 1999999000 "
                         "WHERE provider_id = 'octranspo'")
        else:
            conn.execute("DELETE FROM rt_feed_snapshots WHERE feed_endpoint_id = 12")

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode == 1, result.stdout + result.stderr
    assert "silver_stale:" in result.stderr
    assert "db_capture_age_seconds=120" in result.stdout
    assert any(line.startswith("alert-issue|fire freshness-octranspo ") for line in _read_log(log))
    assert not any(line.startswith("alert-issue|resolve") for line in _read_log(log))


def test_freshness_probe_fails_when_one_ottawa_capture_endpoint_is_missing(tmp_path) -> None:
    env, _ = _provider_fixture_env(tmp_path)
    with sqlite3.connect(env["PSQL_FIXTURE_DB"]) as conn:
        conn.execute("DELETE FROM realtime_snapshot_index WHERE feed_endpoint_id = 12")

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode == 1, result.stdout + result.stderr
    assert "db_capture: worst-endpoint age 999999s > 900s" in result.stderr


@pytest.mark.parametrize("failed_provider,expected_status", [("stm", 0), ("octranspo", 1)])
def test_freshness_probe_attributes_failed_runs_to_their_provider(
    tmp_path, failed_provider, expected_status,
) -> None:
    env, _ = _provider_fixture_env(tmp_path)
    with sqlite3.connect(env["PSQL_FIXTURE_DB"]) as conn:
        conn.executemany("INSERT INTO ingestion_runs VALUES (?, 'failed', 1999999880)",
                         [(failed_provider,)] * 10)

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode == expected_status, result.stdout + result.stderr
    assert f"failed_runs={10 if expected_status else 0}" in result.stdout


@pytest.mark.parametrize("table,signal", [
    ("core.dataset_versions", "static_heartbeat:"),
    ("core.snapshot_publish_state", "historic_heartbeat:"),
    ("raw.realtime_snapshot_index", "db_capture:"),
    ("raw.ingestion_runs", "failed_runs: count unavailable"),
    ("silver.rt_feed_snapshots", "silver_stale:"),
])
def test_freshness_probe_ottawa_query_errors_cannot_resolve_alerts(tmp_path, table, signal) -> None:
    env, log = _provider_fixture_env(tmp_path)
    env["PSQL_FAIL_PATTERN"] = table

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode == 1, result.stdout + result.stderr
    assert signal in result.stderr
    assert any(line.startswith("alert-issue|fire freshness-octranspo ") for line in _read_log(log))
    assert not any(line.startswith("alert-issue|resolve") for line in _read_log(log))


@pytest.mark.parametrize("provider", ["stm", "octranspo"])
def test_freshness_probe_recovery_only_addresses_its_provider_issue(tmp_path, provider) -> None:
    env, log = _provider_fixture_env(tmp_path)
    env.update(PROVIDER_ID=provider, ALERT_ISSUE_SCRIPT=ALERT_ISSUE.as_posix(),
               GH_ISSUE_LIST_OUTPUT="123")

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode == 0, result.stdout + result.stderr
    queries = [line for line in _read_log(log) if line.startswith("gh|issue list")]
    assert len(queries) == 1
    assert f"--label alert:freshness-{provider} " in queries[0]
    assert "--label alert:freshness " not in queries[0]
    assert any(line.startswith("gh|issue close 123 ") for line in _read_log(log))


@pytest.mark.parametrize("live_age,capture_age,silver_age,signal", [
    (300, 900, 900, None),
    (301, 900, 900, "manifest: live age 301s > 300s"),
    (300, 901, 900, "db_capture: worst-endpoint age 901s > 900s"),
    (300, 900, 901, "silver_stale: worst-endpoint silver snapshot age 901s > 900s"),
])
def test_freshness_probe_preserves_live_capture_and_silver_budgets(
    tmp_path, live_age, capture_age, silver_age, signal,
) -> None:
    env, _ = _probe_env(tmp_path)
    _make_executable(tmp_path / "bin" / "date", """#!/usr/bin/env bash
if [[ "$*" == '-u +%s' ]]; then
  echo 2000000000
else
  exec /usr/bin/date "$@"
fi
""")
    env.update(
        CURL_OUTPUT=_manifest_json(datetime.fromtimestamp(2000000000 - live_age, tz=UTC)),
        PSQL_OUTPUTS=_psql_outputs(capture_age=capture_age, silver_age=silver_age),
    )

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode == int(signal is not None), result.stdout + result.stderr
    if signal:
        assert signal in result.stderr


def test_freshness_probe_preserves_global_burst_for_six_failures_per_provider(tmp_path) -> None:
    env, log = _provider_fixture_env(tmp_path)
    env["CHECK_GLOBAL_FAILED_RUNS"] = "true"
    with sqlite3.connect(env["PSQL_FIXTURE_DB"]) as conn:
        conn.executemany("INSERT INTO ingestion_runs VALUES (?, 'failed', 1999999880)",
                         [("stm",)] * 6 + [("octranspo",)] * 6)

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode == 1, result.stdout + result.stderr
    assert "global_failed_runs: 12 failed runs in 30m >= 10" in result.stderr
    assert "global_readings checked=true failed_runs=12" in result.stdout
    assert "silver_age_seconds=120" in result.stdout
    alerts = [line for line in _read_log(log) if line.startswith("alert-issue|")]
    assert any(line.startswith("alert-issue|fire freshness-global-failures ") for line in alerts)
    assert any(line.startswith("alert-issue|resolve freshness-octranspo ") for line in alerts)
    assert not any(line.startswith("alert-issue|fire freshness-octranspo ") for line in alerts)


@pytest.mark.parametrize("output,fail_index", [("", ""), ("invalid", ""), ("-1", ""), ("0", "5")])
def test_freshness_probe_global_query_failure_cannot_resolve_global_alert(
    tmp_path, output, fail_index,
) -> None:
    env, log = _probe_env(tmp_path)
    env.update(CHECK_GLOBAL_FAILED_RUNS="true", PSQL_FAIL_INDEX=fail_index,
               CURL_OUTPUT=_manifest_json(datetime.now(tz=UTC) - timedelta(seconds=60)),
               PSQL_OUTPUTS=_psql_outputs() + "\n" + output)

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode == 1, result.stdout + result.stderr
    assert "global_failed_runs: count unavailable" in result.stderr
    assert "global_readings checked=true failed_runs=unavailable" in result.stdout
    alerts = [line for line in _read_log(log) if line.startswith("alert-issue|")]
    assert any(line.startswith("alert-issue|fire freshness-global-failures ") for line in alerts)
    assert not any(line.startswith("alert-issue|resolve freshness-global-failures ")
                   for line in alerts)
    assert any(line.startswith("alert-issue|resolve freshness-stm ") for line in alerts)


@pytest.mark.parametrize("enabled", ["true", "false"])
def test_freshness_probe_only_designated_global_writer_can_resolve_global_alert(tmp_path, enabled):
    env, log = _provider_fixture_env(tmp_path)
    env["CHECK_GLOBAL_FAILED_RUNS"] = enabled

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode == 0, result.stdout + result.stderr
    assert f"global_readings checked={enabled} failed_runs=" in result.stdout
    alerts = [line for line in _read_log(log) if line.startswith("alert-issue|")]
    global_resolves = [line for line in alerts
                       if line.startswith("alert-issue|resolve freshness-global-failures ")]
    assert len(global_resolves) == int(enabled == "true")
    assert not any(line.startswith("alert-issue|resolve freshness ") for line in alerts)


def test_freshness_probe_direct_invocation_preserves_global_detection_by_default(tmp_path) -> None:
    env, _ = _provider_fixture_env(tmp_path)
    env.pop("CHECK_GLOBAL_FAILED_RUNS")

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "global_readings checked=true failed_runs=0" in result.stdout


def test_freshness_probe_global_recovery_does_not_mask_provider_failure(tmp_path) -> None:
    env, log = _provider_fixture_env(tmp_path)
    env["CHECK_GLOBAL_FAILED_RUNS"] = "true"
    with sqlite3.connect(env["PSQL_FIXTURE_DB"]) as conn:
        conn.execute("DELETE FROM rt_feed_snapshots WHERE provider_id = 'octranspo'")

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode == 1, result.stdout + result.stderr
    alerts = [line for line in _read_log(log) if line.startswith("alert-issue|")]
    assert any(line.startswith("alert-issue|fire freshness-octranspo ") for line in alerts)
    assert any(line.startswith("alert-issue|resolve freshness-global-failures ") for line in alerts)
    assert not any(line.startswith("alert-issue|resolve freshness-octranspo ") for line in alerts)
