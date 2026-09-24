from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest
import test_restore_proof_real_db as restore_contract

DB_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = DB_ROOT / "scripts/restore-backup-proof.sh"
REVISION = "0087_exact_daily_delay_means"
SOURCE_REVISION = "0086_daily_warm_retention_indexes"

FAKE_TOOL = r"""#!/usr/bin/env python3
import json
import os
from pathlib import Path
import re
import signal
import sys

tool, args = Path(sys.argv[0]).name, sys.argv[1:]
workdir = Path(os.environ["RESTORE_WORKDIR"])
entry = {
    "tool": tool, "args": args,
    "hostaddr": os.environ.get("PGHOSTADDR"), "options": os.environ.get("PGOPTIONS"),
}
if workdir.exists():
    entry["mode"] = workdir.stat().st_mode & 0o777
if tool == "pg_ctl" and "start" in args:
    entry["config"] = (workdir / "pgdata/postgresql.conf").read_text()
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps(entry) + "\n")

if tool == "uv":
    if args == ["run", "alembic", "heads"]:
        if os.environ.get("FAKE_CREATE_DURING_PREFLIGHT"):
            workdir.mkdir()
            (workdir / "keep").write_text("created by someone else")
        print(os.environ.get("FAKE_HEADS", "0087_exact_daily_delay_means (head)"))
    elif "download-latest-backup" in args:
        Path(args[args.index("--dest") + 1]).write_bytes(b"PGDMP-fake")
elif tool == "initdb":
    data = Path(args[args.index("-D") + 1])
    data.mkdir(exist_ok=True)
    (data / "postgresql.conf").write_text("# initialized\n")
    if os.environ.get("FAKE_FAIL") == "initdb":
        sys.exit(17)
elif tool == "pg_ctl":
    data = Path(args[args.index("-D") + 1])
    pid = data / "postmaster.pid"
    if "start" in args:
        pid.write_text("999999\n")
        if os.environ.get("FAKE_FAIL") == "start":
            sys.exit(23)
    elif "stop" in args:
        if os.environ.get("FAKE_STOP_FAIL") == "1":
            sys.exit(19)
        pid.unlink(missing_ok=True)
    elif "status" in args:
        sys.exit(0 if pid.exists() else 3)
elif tool == "pg_restore":
    if os.environ.get("FAKE_REPLACE_WORKDIR"):
        workdir.rename(workdir.with_name("original"))
        workdir.mkdir()
        (workdir / "keep").write_text("replacement")
    if os.environ.get("FAKE_SIGNAL"):
        os.kill(os.getppid(), signal.SIGTERM)
    if os.environ.get("FAKE_FAIL") == "restore":
        sys.exit(37)
elif tool == "psql" and "-c" in args:
    query = args[args.index("-c") + 1]
    if "alembic_version" in query:
        expected = re.search(r"version_num\) = '([A-Za-z0-9_]+)'", query)
        actual = os.environ.get("FAKE_SOURCE_REVISION", "0087_exact_daily_delay_means")
        if expected and expected.group(1) != actual:
            sys.exit(3)
"""


@pytest.fixture
def harness(tmp_path: Path):
    binaries = tmp_path / "bin"
    binaries.mkdir()
    for tool in ("uv", "initdb", "pg_ctl", "createdb", "pg_restore", "psql"):
        executable = binaries / tool
        executable.write_text(FAKE_TOOL)
        executable.chmod(0o755)
    dump = tmp_path / "backup.dump"
    dump.write_bytes(b"PGDMP-fixture")
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("PG", "RESTORE_", "TRANSIT_RESTORE_", "FAKE_"))
        and key != "KEEP_RESTORE_WORKDIR"
    }
    env.update(
        PATH=f"{binaries}:{env['PATH']}",
        PG_BIN=str(binaries),
        RESTORE_WORKDIR=str(tmp_path / "work"),
        RESTORE_DUMP_FILE=str(dump),
        RESTORE_MIN_FREE_GB="0",
        FAKE_LOG=str(tmp_path / "calls.jsonl"),
    )
    return env


def run(harness, **overrides):
    env = {**harness, **overrides}
    result = subprocess.run(
        ["bash", str(SCRIPT)], cwd=DB_ROOT, env=env, text=True, capture_output=True, timeout=10
    )
    log = Path(env["FAKE_LOG"])
    calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
    return result, calls


@pytest.mark.parametrize("kind", ["directory", "file", "symlink", "dangling_symlink"])
def test_existing_workdir_is_never_claimed_or_deleted(harness, tmp_path, kind):
    workdir = Path(harness["RESTORE_WORKDIR"])
    protected = tmp_path / "protected"
    protected.mkdir()
    marker = protected / "keep"
    marker.write_text("retained")
    if kind == "directory":
        workdir.mkdir()
        (workdir / "keep").write_text("retained")
    elif kind == "file":
        workdir.write_text("retained")
    else:
        workdir.symlink_to(protected if kind == "symlink" else tmp_path / "missing")
    result, calls = run(harness)
    assert result.returncode != 0
    assert "already exists" in result.stderr
    assert workdir.exists() or workdir.is_symlink()
    assert marker.read_text() == "retained"
    assert calls == []


def test_success_uses_private_owned_directory_and_durable_configuration(harness):
    result, calls = run(harness)
    assert result.returncode == 0, result.stderr
    assert not Path(harness["RESTORE_WORKDIR"]).exists()
    started = next(call for call in calls if call["tool"] == "pg_ctl" and "start" in call["args"])
    assert started["mode"] == 0o700
    assert "-o" not in started["args"]
    assert "fsync = on" in started["config"]
    assert "full_page_writes = on" in started["config"]
    assert any(call["tool"] == "pg_ctl" and "stop" in call["args"] for call in calls)
    assert "restore proof green" in result.stdout
    assert "RTO download_seconds=" in result.stdout
    assert "TRANSIT_RESTORE_PROOF_DATABASE_URL" not in result.stdout


@pytest.mark.parametrize("failure,code", [("initdb", 17), ("start", 23), ("restore", 37)])
def test_failed_work_cleans_up_only_its_owned_directory(harness, failure, code):
    result, calls = run(harness, FAKE_FAIL=failure)
    assert result.returncode == code, result.stderr
    assert not Path(harness["RESTORE_WORKDIR"]).exists()
    assert "restore proof green" not in result.stdout
    stopped = any(call["tool"] == "pg_ctl" and "stop" in call["args"] for call in calls)
    assert stopped is (failure != "initdb")


@pytest.mark.parametrize("failure", ["", "restore"])
def test_stop_failure_preserves_owned_directory_and_fails(harness, failure):
    result, _ = run(harness, FAKE_FAIL=failure, FAKE_STOP_FAIL="1")
    assert result.returncode != 0
    assert Path(harness["RESTORE_WORKDIR"], "pgdata/postmaster.pid").exists()
    assert "stop failed" in result.stderr
    assert "preserved" in result.stderr
    assert "restore proof green" not in result.stdout


def test_keep_reports_running_cluster_and_matching_test_configuration(harness):
    result, calls = run(
        harness,
        KEEP_RESTORE_WORKDIR="1",
        RESTORE_EXPECTED_REVISION=SOURCE_REVISION,
        FAKE_SOURCE_REVISION=SOURCE_REVISION,
    )
    assert result.returncode == 0, result.stderr
    assert Path(harness["RESTORE_WORKDIR"], "pgdata/postmaster.pid").exists()
    assert "cluster is running" in result.stdout
    assert f"RESTORE_EXPECTED_REVISION={SOURCE_REVISION}" in result.stdout
    assert "TRANSIT_RESTORE_PROOF_DATABASE_URL" in result.stdout
    assert not any(call["tool"] == "pg_ctl" and "stop" in call["args"] for call in calls)
    assert not any(call["tool"] == "uv" for call in calls)


def test_keep_before_start_does_not_claim_a_running_cluster(harness):
    result, _ = run(harness, KEEP_RESTORE_WORKDIR="1", FAKE_FAIL="initdb")
    assert result.returncode == 17
    assert Path(harness["RESTORE_WORKDIR"]).is_dir()
    assert "cluster is not running" in result.stdout
    assert "cluster is running" not in result.stdout
    assert "restore proof green" not in result.stdout


def test_default_revision_is_unique_repo_head(harness):
    result, calls = run(harness)
    assert result.returncode == 0, result.stderr
    assert any(
        call["tool"] == "uv" and call["args"] == ["run", "alembic", "heads"] for call in calls
    )
    query = next(
        call["args"][-1]
        for call in calls
        if call["tool"] == "psql" and "alembic_version" in call["args"][-1]
    )
    assert REVISION in query
    assert "COUNT(*) = 1" in query


def test_source_revision_mismatch_fails_the_drill(harness):
    result, _ = run(harness, FAKE_SOURCE_REVISION=SOURCE_REVISION)
    assert result.returncode != 0
    assert "restore proof green" not in result.stdout


@pytest.mark.parametrize(
    "setting,value",
    [
        ("RESTORE_PORT", "0"),
        ("RESTORE_PORT", "65536"),
        ("RESTORE_PORT", "1+2"),
        ("RESTORE_JOBS", "0"),
        ("RESTORE_JOBS", "-1"),
        ("RESTORE_JOBS", "2147483648"),
        ("RESTORE_MIN_FREE_GB", "-1"),
        ("KEEP_RESTORE_WORKDIR", "yes"),
        ("RESTORE_WORKDIR", "relative/path"),
        ("RESTORE_WORKDIR", "/tmp/" + "r" * 100),
        ("RESTORE_WORKDIR", "/tmp/restore,second"),
        ("RESTORE_WORKDIR", "/tmp/restore\nsecond"),
        ("RESTORE_EXPECTED_REVISION", "head'; DROP TABLE x; --"),
    ],
)
def test_invalid_preflight_cannot_start_tools_or_create_workdir(harness, setting, value):
    result, calls = run(harness, **{setting: value})
    assert result.returncode != 0
    assert calls == []
    assert not Path(harness["RESTORE_WORKDIR"]).exists()


def test_multiple_repo_heads_fail_before_ownership(harness):
    result, calls = run(harness, FAKE_HEADS="first (head)\nsecond (head)")
    assert result.returncode != 0
    assert not Path(harness["RESTORE_WORKDIR"]).exists()
    assert [call["tool"] for call in calls] == ["uv"]


def test_gated_contract_uses_same_explicit_revision(monkeypatch):
    monkeypatch.setenv("RESTORE_EXPECTED_REVISION", SOURCE_REVISION)
    assert restore_contract.expected_restore_revision() == SOURCE_REVISION


def test_gated_contract_defaults_to_repo_head(monkeypatch):
    monkeypatch.delenv("RESTORE_EXPECTED_REVISION", raising=False)
    assert restore_contract.expected_restore_revision() == restore_contract.repo_alembic_head()


def test_gated_contract_rejects_unsafe_revision(monkeypatch):
    monkeypatch.setenv("RESTORE_EXPECTED_REVISION", "unsafe revision")
    with pytest.raises(ValueError, match="revision"):
        restore_contract.expected_restore_revision()


def test_atomic_creation_preserves_workdir_created_during_preflight(harness):
    result, calls = run(harness, FAKE_CREATE_DURING_PREFLIGHT="1")
    assert result.returncode != 0
    assert Path(harness["RESTORE_WORKDIR"], "keep").read_text() == "created by someone else"
    assert [call["tool"] for call in calls] == ["uv"]


def test_cleanup_refuses_a_replaced_workdir(harness):
    result, calls = run(harness, FAKE_REPLACE_WORKDIR="1")
    assert result.returncode != 0
    assert "ownership changed" in result.stderr
    assert Path(harness["RESTORE_WORKDIR"], "keep").read_text() == "replacement"
    original = Path(harness["RESTORE_WORKDIR"]).with_name("original")
    assert (original / "pgdata/postmaster.pid").exists()
    assert not any(call["tool"] == "pg_ctl" and "stop" in call["args"] for call in calls)


def test_interruption_stops_the_owned_cluster_and_preserves_failure(harness):
    result, calls = run(harness, FAKE_SIGNAL="1")
    assert result.returncode == 143
    assert not Path(harness["RESTORE_WORKDIR"]).exists()
    assert any(call["tool"] == "pg_ctl" and "stop" in call["args"] for call in calls)
    assert not any(call["tool"] == "psql" for call in calls)


def test_connection_environment_cannot_redirect_the_restore(harness):
    result, calls = run(harness, PGHOSTADDR="203.0.113.10", PGOPTIONS="unsafe options")
    assert result.returncode == 0, result.stderr
    assert all(call["hostaddr"] is None and call["options"] is None for call in calls)


def test_quoted_workdir_is_data_in_server_configuration(harness, tmp_path):
    workdir = tmp_path / "w' ;$(id)"
    result, calls = run(harness, RESTORE_WORKDIR=str(workdir))
    assert result.returncode == 0, result.stderr
    config = next(call["config"] for call in calls if "config" in call)
    expected = str(workdir / "sock").replace("'", "''")
    assert f"unix_socket_directories = '{expected}'" in config
    assert not workdir.exists()


def test_keep_after_restore_failure_reports_running_without_claiming_success(harness):
    result, calls = run(harness, KEEP_RESTORE_WORKDIR="1", FAKE_FAIL="restore")
    assert result.returncode == 37
    assert "cluster is running" in result.stdout
    assert "restore proof green" not in result.stdout
    assert "TRANSIT_RESTORE_PROOF_DATABASE_URL" not in result.stdout
    assert Path(harness["RESTORE_WORKDIR"], "pgdata/postmaster.pid").exists()
    assert not any(call["tool"] == "pg_ctl" and "stop" in call["args"] for call in calls)
