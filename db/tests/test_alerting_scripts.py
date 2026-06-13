"""PATH-stubbed bash tests for the alerting plane (slice-9.1.1o).

Two pure-bash scripts live at the REPO ROOT under .github/scripts (no uv, no
python — they run on ubuntu-latest with gh/curl/jq/psql preinstalled):

  alert-issue.sh    — open/close a labeled GitHub issue as the alert channel.
  freshness-probe.sh — manifest age + DB capture age + failed-run-burst probe,
                       firing/resolving via alert-issue.sh.

These tests stub gh / curl / psql / alert-issue.sh on PATH (harness cloned
from tests/test_pipeline_scripts.py) and assert the command stream + exit
codes — no network, no database, no GitHub.
"""

from __future__ import annotations

import os
import stat
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path

# REPO ROOT (parents[2] of db/tests/) — the scripts live under .github/scripts.
REPO_ROOT = Path(__file__).resolve().parents[2]
GH_SCRIPTS_DIR = REPO_ROOT / ".github" / "scripts"
ALERT_ISSUE = GH_SCRIPTS_DIR / "alert-issue.sh"
FRESHNESS_PROBE = GH_SCRIPTS_DIR / "freshness-probe.sh"


def _make_executable(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def _stubbed_env(tmp_path: Path) -> tuple[dict[str, str], Path]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)

    # gh stub: logs every call; honors GH_ISSUE_LIST_OUTPUT for the list query
    # (so a test can simulate "an issue is already open"), and GH_FAIL_PATTERN
    # to force a nonzero exit.
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
    # curl stub: emits CURL_OUTPUT verbatim (manifest JSON for the probe);
    # honors CURL_FAIL_PATTERN to force a nonzero exit (-f behavior).
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
    # psql stub: pops the next line from PSQL_OUTPUTS (newline-separated) per
    # invocation, simulating the two scalar queries the probe runs.
    _make_executable(
        bin_dir / "psql",
        "#!/usr/bin/env bash\n"
        'if [[ -n "${COMMAND_LOG:-}" ]]; then\n'
        "  printf 'psql|%s\\n' \"$*\" >> \"$COMMAND_LOG\"\n"
        "fi\n"
        'state="${PSQL_STATE_FILE:?PSQL_STATE_FILE unset}"\n'
        'idx=$(cat "$state" 2>/dev/null || echo 0)\n'
        'mapfile -t outs <<< "${PSQL_OUTPUTS:-}"\n'
        'printf \'%s\\n\' "${outs[$idx]:-0}"\n'
        'echo $((idx + 1)) > "$state"\n',
    )

    env = os.environ.copy()
    env["PATH"] = f"{bin_dir}:{env['PATH']}"
    env["PSQL_STATE_FILE"] = str(tmp_path / "psql_state")
    return env, bin_dir


def _stub_alert_issue(bin_dir: Path) -> None:
    """Replace alert-issue.sh with a logging stub for freshness-probe tests."""
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
    return subprocess.run(
        ["bash", str(script), *args],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


# --- alert-issue.sh ----------------------------------------------------------


def test_alert_issue_fire_creates_labeled_issue_when_none_open(tmp_path) -> None:
    env, _bin = _stubbed_env(tmp_path)
    log = tmp_path / "cmd.log"
    log.write_text("", encoding="utf-8")
    env.update(
        COMMAND_LOG=str(log),
        GH_TOKEN="t",
        GH_REPO="mgkdante/transit",
        GH_ISSUE_LIST_OUTPUT="",  # no open issue
    )

    result = _run(ALERT_ISSUE, ["fire", "freshness", "[alert] stm stale", "details"], env)

    assert result.returncode == 0, result.stderr
    lines = _read_log(log)
    create = [ln for ln in lines if ln.startswith("gh|issue create")]
    assert len(create) == 1
    # Both labels must be applied so resolve can find the issue later.
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
        GH_ISSUE_LIST_OUTPUT="123",  # an issue is already open
    )

    result = _run(ALERT_ISSUE, ["fire", "freshness", "[alert] stm stale", "details"], env)

    assert result.returncode == 0, result.stderr
    lines = _read_log(log)
    # No new issue, no comment spam during an ongoing outage.
    assert not any(ln.startswith("gh|issue create") for ln in lines)


def test_alert_issue_resolve_comments_and_closes(tmp_path) -> None:
    env, _bin = _stubbed_env(tmp_path)
    log = tmp_path / "cmd.log"
    log.write_text("", encoding="utf-8")
    env.update(
        COMMAND_LOG=str(log),
        GH_TOKEN="t",
        GH_REPO="mgkdante/transit",
        GH_ISSUE_LIST_OUTPUT="123",  # open issue to resolve
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
        GH_ISSUE_LIST_OUTPUT="",  # nothing open
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


# --- freshness-probe.sh ------------------------------------------------------


def _manifest_json(generated_utc: datetime) -> str:
    stamp = generated_utc.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    return '{"files":{"live":{"generated_utc":"' + stamp + '"}}}'


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
    )
    return env, log


def test_freshness_probe_green_path_resolves_alert(tmp_path) -> None:
    env, log = _probe_env(tmp_path)
    env.update(
        CURL_OUTPUT=_manifest_json(datetime.now(tz=UTC) - timedelta(seconds=60)),
        PSQL_OUTPUTS="120\n0",  # capture age 120s (< 900), 0 failed runs
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
        PSQL_OUTPUTS="120\n0",
    )

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode != 0
    lines = _read_log(log)
    assert any(ln.startswith("alert-issue|fire freshness") for ln in lines)


def test_freshness_probe_fires_on_stale_db_capture(tmp_path) -> None:
    env, log = _probe_env(tmp_path)
    env.update(
        CURL_OUTPUT=_manifest_json(datetime.now(tz=UTC) - timedelta(seconds=60)),
        PSQL_OUTPUTS="5000\n0",  # capture age 5000s > 900
    )

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode != 0
    lines = _read_log(log)
    assert any(ln.startswith("alert-issue|fire freshness") for ln in lines)


def test_freshness_probe_fires_on_failed_run_burst(tmp_path) -> None:
    env, log = _probe_env(tmp_path)
    env.update(
        CURL_OUTPUT=_manifest_json(datetime.now(tz=UTC) - timedelta(seconds=60)),
        PSQL_OUTPUTS="120\n42",  # 42 failed runs in window >= threshold 10
    )

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode != 0
    lines = _read_log(log)
    assert any(ln.startswith("alert-issue|fire freshness") for ln in lines)


def test_freshness_probe_fires_on_unparseable_manifest(tmp_path) -> None:
    env, log = _probe_env(tmp_path)
    env.update(
        CURL_OUTPUT="<<not json>>",
        PSQL_OUTPUTS="120\n0",
    )

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode != 0
    lines = _read_log(log)
    assert any(ln.startswith("alert-issue|fire freshness") for ln in lines)


def test_freshness_probe_fires_on_manifest_fetch_failure(tmp_path) -> None:
    env, log = _probe_env(tmp_path)
    env.update(
        CURL_FAIL_PATTERN="manifest.json",
        PSQL_OUTPUTS="120\n0",
    )

    result = _run(FRESHNESS_PROBE, [], env)

    assert result.returncode != 0
    lines = _read_log(log)
    assert any(ln.startswith("alert-issue|fire freshness") for ln in lines)
