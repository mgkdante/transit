"""Behavior pinned from daily-warm-rollups.yml at 32ecc433, before extraction."""

import json
import os
import runpy
import shutil
import subprocess
import sys
import threading
from datetime import UTC, datetime
from pathlib import Path

import pytest

from transit_ops.daily_run import DailyRun, Stage, StageResult

NOTIFY_SCRIPT = Path(__file__).resolve().parents[3] / ".github/scripts/daily-warm-notify.py"


def notify(environ, runner):
    return runpy.run_path(str(NOTIFY_SCRIPT))["notify"](environ, runner=runner)


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize(("retry", "expected"), [(0, 43), (41, 124), (124, 124)])
def test_rollups_defer_one_timeout_retry_and_preserve_actual_receipt(tmp_path, retry, expected):
    first_attempts = threading.Barrier(3)
    finished = set()
    lock = threading.Lock()
    calls = []

    def runner(stage: Stage) -> StageResult:
        provider = stage.argv[-1]
        assert stage.timeout_seconds == 4500
        assert stage.kill_after_seconds == 60
        assert stage.merge_stderr and stage.tee
        assert stage.env["PGAPPNAME"].startswith("dwr-r123-a2-p")
        with lock:
            calls.append((provider, stage.append))
        if stage.append:
            assert finished == {"stm", "oc", "sto"}
            return StageResult(retry)
        receipt = read(tmp_path / "rollups" / f"rollup-stage-{provider}.json")
        assert receipt == {
            "provider_id": provider,
            "status": "running",
            "started_utc": "2026-11-03T12:00:00Z",
            "attempt_exit_codes": [],
            "attempt_count": 0,
            "recovered_after_timeout": False,
        }
        first_attempts.wait(timeout=5)
        with lock:
            finished.add(provider)
        return StageResult({"stm": 124, "oc": 43, "sto": 124}[provider])

    daily = DailyRun(
        runner,
        artifact_root=tmp_path,
        environ={
            "PROVIDER_PLAN": '["stm","oc","sto"]',
            "GITHUB_RUN_ID": "123",
            "GITHUB_RUN_ATTEMPT": "2",
        },
        now=lambda: datetime(2026, 11, 3, 12, tzinfo=UTC),
    )
    assert daily.run("rollups") == expected
    assert calls[-1] == ("stm", True)
    assert len(calls) == 4
    for provider, attempts in (("stm", [124, retry]), ("oc", [43]), ("sto", [124])):
        receipt = read(tmp_path / "rollups" / f"rollup-stage-{provider}.json")
        assert list(receipt) == [
            "provider_id",
            "status",
            "started_utc",
            "completed_utc",
            "exit_code",
            "attempt_exit_codes",
            "attempt_count",
            "recovered_after_timeout",
        ]
        assert receipt == {
            "provider_id": provider,
            "status": "success" if attempts[-1] == 0 else "failure",
            "started_utc": "2026-11-03T12:00:00Z",
            "completed_utc": "2026-11-03T12:00:00Z",
            "exit_code": attempts[-1],
            "attempt_exit_codes": attempts,
            "attempt_count": len(attempts),
            "recovered_after_timeout": provider == "stm" and retry == 0,
        }
        assert (tmp_path / "rollups" / f"attempt-status-{provider}.txt").read_text().strip() == str(
            attempts[-1]
        )


@pytest.mark.parametrize("job", ["rollups", "publish", "retention"])
@pytest.mark.parametrize(
    "plan",
    ["", "null", "[]", '["stm","stm"]', '["../stm"]', '["stm",null]', '["stm"] []', '["stm\\n"]'],
)
def test_invalid_plans_fail_before_any_stage(tmp_path, job, plan):
    calls = []
    daily = DailyRun(
        lambda stage: calls.append(stage), artifact_root=tmp_path, environ={"PROVIDER_PLAN": plan}
    )
    assert daily.run(job) == 5
    assert calls == []


@pytest.mark.parametrize(("failure", "expected"), [(None, 0), ("stm", 124), ("oc", 1)])
def test_publish_parallel_budget_and_partial_aggregate(tmp_path, failure, expected):
    barrier = threading.Barrier(3)

    def runner(stage):
        assert stage.argv[5:8] == ("publish-all", "--tier", "historic")
        assert stage.timeout_seconds == 5400
        assert stage.kill_after_seconds == 30
        provider = stage.argv[9]
        barrier.wait(timeout=5)
        stage.output.write_text(json.dumps([{"provider_id": provider, "tier": "historic"}]))
        return StageResult(expected if provider == failure else 0)

    daily = DailyRun(
        runner, artifact_root=tmp_path, environ={"PROVIDER_PLAN": '["stm","oc","sto"]'}
    )
    assert daily.run("publish") == expected
    assert read(tmp_path / "publish/historic-publish.json") == [
        {"provider_id": p, "tier": "historic"} for p in ["stm", "oc", "sto"] if p != failure
    ]
    for provider in ["stm", "oc", "sto"]:
        assert (tmp_path / "publish" / f"elapsed-{provider}.txt").read_text().strip().isdigit()


def test_publish_refuses_four_providers(tmp_path):
    calls = []
    assert (
        DailyRun(
            lambda s: calls.append(s),
            artifact_root=tmp_path,
            environ={
                "PROVIDER_PLAN": '["a","b","c","d"]',
            },
        ).run("publish")
        == 5
    )
    assert not calls


@pytest.mark.parametrize(
    ("result", "expected"),
    [
        ("{}", 1),
        ('[{"provider_id":"wrong","tier":"historic"}]', 1),
        ('[{"provider_id":"stm","tier":"live"}]', 1),
        ("[] []", 1),
        ("", 1),
        ("{", 5),
    ],
)
def test_publish_rejects_invalid_success_output(tmp_path, result, expected):
    def runner(stage):
        stage.output.write_text(result)
        return StageResult(0)

    assert (
        DailyRun(runner, artifact_root=tmp_path, environ={"PROVIDER_PLAN": '["stm"]'}).run(
            "publish"
        )
        == expected
    )
    assert read(tmp_path / "publish/historic-publish.json") == []


@pytest.mark.parametrize(("catch_up", "batches", "budget"), [("0", "4", 1860), ("12", "12", 18000)])
def test_retention_order_budgets_and_proof_despite_prune_failure(
    tmp_path, catch_up, batches, budget
):
    calls = []

    def runner(stage):
        command, provider = stage.argv[5:7]
        calls.append((command, provider))
        assert stage.env["PGAPPNAME"].endswith("-pa1")
        assert stage.kill_after_seconds == 60
        if command == "prune-bronze-storage":
            assert stage.argv[7:] == ("--max-batches", batches, "--require-exhausted")
            assert stage.timeout_seconds == budget
        else:
            assert 299 <= stage.timeout_seconds <= 300
        return StageResult(29 if (command, provider) == ("prune-warm-rollup-storage", "oc") else 0)

    assert (
        DailyRun(
            runner,
            artifact_root=tmp_path,
            environ={
                "PROVIDER_PLAN": '["stm","oc","sto"]',
                "BRONZE_CATCH_UP_BATCHES": catch_up,
            },
        ).run("retention")
        == 29
    )
    assert calls == [
        ("prune-i3-storage", "stm"),
        ("prune-warm-rollup-storage", "stm"),
        ("prune-bronze-storage", "stm"),
        ("retention-proof-report", "stm"),
        ("prune-i3-storage", "oc"),
        ("prune-warm-rollup-storage", "oc"),
        ("retention-proof-report", "oc"),
        ("prune-i3-storage", "sto"),
        ("prune-warm-rollup-storage", "sto"),
        ("prune-bronze-storage", "sto"),
        ("retention-proof-report", "sto"),
    ]


@pytest.mark.parametrize("value", ["-1", "1000", "4.5", "abc"])
def test_retention_rejects_invalid_catchup(tmp_path, value):
    calls = []
    assert (
        DailyRun(
            lambda s: calls.append(s),
            artifact_root=tmp_path,
            environ={
                "PROVIDER_PLAN": '["stm"]',
                "BRONZE_CATCH_UP_BATCHES": value,
            },
        ).run("retention")
        == 1
    )
    assert not calls


@pytest.mark.parametrize("discovery", ["", "stm\nstm\n", "stm\n\noc\n", "../stm\n"])
def test_prepare_rejects_bad_discovery_before_sync(tmp_path, discovery):
    calls = []

    def runner(stage):
        calls.append(stage.argv)
        return StageResult(0, discovery if stage.argv[-1] == "list-providers" else "")

    assert DailyRun(runner, artifact_root=tmp_path, environ={}).run("prepare") == 1
    assert not any("sync-alert-archive" in argv for argv in calls)


def test_prepare_migration_order_and_compact_discovery_output(tmp_path):
    calls = []

    def runner(stage):
        calls.append(stage.argv[2:])
        if stage.argv[-1] == "list-providers":
            return StageResult(0, "stm\noc\n")
        return StageResult(0)

    output = tmp_path / "github-output"
    assert (
        DailyRun(runner, artifact_root=tmp_path, environ={"GITHUB_OUTPUT": str(output)}).run(
            "prepare"
        )
        == 0
    )
    assert calls == [
        ("python", "-m", "transit_ops.cli", "init-db"),
        ("alembic", "heads"),
        ("alembic", "current", "--check-heads"),
        ("python", "-m", "transit_ops.cli", "list-providers"),
        ("python", "-m", "transit_ops.cli", "sync-alert-archive", "stm"),
        ("python", "-m", "transit_ops.cli", "sync-alert-archive", "oc"),
    ]
    assert output.read_text() == 'providers=["stm","oc"]\n'
    assert read(tmp_path / "prepare/provider-discovery.json") == ["stm", "oc"]


@pytest.mark.parametrize("failure_at", ["init-db", "heads", "--check-heads", "list-providers"])
def test_prepare_propagates_failures_without_sync(tmp_path, failure_at):
    calls = []

    def runner(stage):
        calls.append(stage.argv[-1])
        return StageResult(23 if stage.argv[-1] == failure_at else 0)

    assert DailyRun(runner, artifact_root=tmp_path, environ={}).run("prepare") == 23
    assert calls[-1] == failure_at


def test_prepare_requires_output_handoff_before_sync(tmp_path):
    calls = []

    def runner(stage):
        calls.append(stage.argv[-1])
        return StageResult(0, "stm\n")

    assert DailyRun(runner, artifact_root=tmp_path, environ={}).run("prepare") == 1
    assert calls[-1] == "list-providers"


def proof_inputs(root):
    (root / "prepare").mkdir()
    (root / "publish").mkdir()
    for name, value in {
        "prepare/provider-discovery.json": ["stm", "oc", "sto"],
        "prepare/alert-archive-sync-stm.json": {"provider_id": "stm"},
        "prepare/alert-archive-sync-oc.json": {"provider_id": "oc", "skipped_not_seeded": False},
        "prepare/alert-archive-sync-sto.json": {"provider_id": "sto", "skipped_not_seeded": True},
        "publish/historic-publish.json": [{"provider_id": "oc"}, {"provider_id": "stm"}],
    }.items():
        (root / name).write_text(json.dumps(value))


@pytest.mark.parametrize("outcome", ["pass", "fail", "wrong", "empty", "cancelled"])
def test_proof_runs_active_providers_in_parallel_and_requires_fresh_matching_pass(
    tmp_path, outcome
):
    proof_inputs(tmp_path)
    barrier = threading.Barrier(2)

    def runner(stage):
        assert stage.argv[5] == "verify-historic-publish"
        provider = stage.argv[6]
        path = Path(stage.argv[-1])
        assert read(path) == {
            "provider_id": provider,
            "status": "fail",
            "failures": ["historic_proof_interrupted_before_completion"],
        }
        barrier.wait(timeout=5)
        if outcome == "cancelled":
            return StageResult(42)
        path.write_text(
            ""
            if outcome == "empty"
            else json.dumps(
                {
                    "provider_id": "wrong" if outcome == "wrong" else provider,
                    "status": outcome,
                }
            )
        )
        return StageResult(0)

    result = DailyRun(runner, artifact_root=tmp_path, environ={}).run("proof")
    assert (result == 0) == (outcome == "pass")
    if outcome == "cancelled":
        assert result == 42


@pytest.mark.parametrize(
    "mutation", ["missing", "extra", "duplicate", "unsafe", "sync", "nonboolean", "multiple"]
)
def test_proof_rejects_bad_provider_handoff_before_any_verification(tmp_path, mutation):
    proof_inputs(tmp_path)
    published = [{"provider_id": "stm"}, {"provider_id": "oc"}]
    if mutation == "missing":
        published.pop()
    elif mutation in {"extra", "duplicate", "unsafe"}:
        published.append(
            {"provider_id": {"extra": "extra", "duplicate": "stm", "unsafe": "../stm"}[mutation]}
        )
    else:
        path = tmp_path / "prepare/alert-archive-sync-stm.json"
        path.write_text(
            {
                "sync": '{"provider_id":"wrong"}',
                "nonboolean": '{"provider_id":"stm","skipped_not_seeded":null}',
                "multiple": '{"provider_id":"stm"} {}',
            }[mutation]
        )
    (tmp_path / "publish/historic-publish.json").write_text(json.dumps(published))
    calls = []
    assert DailyRun(lambda s: calls.append(s), artifact_root=tmp_path, environ={}).run("proof") != 0
    assert not calls


@pytest.mark.parametrize("producer", ["PREPARE", "PUBLISH"])
@pytest.mark.parametrize("value", ["", "0", "1,2", "../12", "123"])
def test_artifact_handoff_requires_positive_unambiguous_ids(tmp_path, producer, value):
    env = {"PREPARE_ARTIFACT_ID": "111", "PUBLISH_ARTIFACT_ID": "222"}
    env[producer + "_ARTIFACT_ID"] = value
    assert (
        DailyRun(lambda s: None, artifact_root=tmp_path, environ=env).run("check-handoff") == 0
    ) == (value == "123")


@pytest.mark.parametrize(
    ("publish", "proof", "historic", "action"),
    [
        ("success", "success", "true", "resolve"),
        ("skipped", "skipped", "false", "resolve"),
        ("success", "failure", "true", "fire"),
        ("skipped", "skipped", "true", "fire"),
        ("failure", "success", "true", "fire"),
        ("success", "cancelled", "true", "fire"),
    ],
)
def test_notify_uses_all_results(tmp_path, publish, proof, historic, action):
    calls = []
    env = {
        "PREPARE_RESULT": "success",
        "ROLLUPS_RESULT": "success",
        "PUBLISH_RESULT": publish,
        "PROOF_RESULT": proof,
        "HISTORIC_PUBLISH": historic,
        "RETENTION_RESULT": "success",
        "GITHUB_RUN_ID": "123",
        "GITHUB_SERVER_URL": "https://github.com",
        "GITHUB_REPOSITORY": "yesid-dev/transit",
    }
    assert notify(env, lambda argv: calls.append(argv) or 0) == 0
    assert calls[0][2:4] == (action, "daily-warm-rollups")
    assert Path(calls[0][1]) == NOTIFY_SCRIPT.with_name("alert-issue.sh")


def test_subprocess_runner_captures_discovery_and_streams_append_logs(tmp_path, capsys):
    from transit_ops.daily_run_process import run_stage

    result = run_stage(Stage((sys.executable, "-c", "print('stm')"), capture=True))
    assert result == StageResult(0, "stm\n")
    path = tmp_path / "rollup.log"
    for attempt in [False, True]:
        result = run_stage(
            Stage(
                (
                    sys.executable,
                    "-c",
                    "import os,sys; print(os.environ['DAILY_TEST']); print('err', file=sys.stderr)",
                ),
                output=path,
                merge_stderr=True,
                tee=True,
                append=attempt,
                env={"DAILY_TEST": "out"},
            )
        )
        assert result.exit_code == 0
    assert sorted(path.read_text().splitlines()) == ["err", "err", "out", "out"]
    assert capsys.readouterr().out.count("out") == 2


def test_subprocess_runner_bounds_stage_without_shell_or_gnu_timeout():
    from transit_ops.daily_run_process import run_stage

    result = run_stage(
        Stage(
            (sys.executable, "-c", "import time; time.sleep(30)"),
            timeout_seconds=0.1,
            kill_after_seconds=1,
        )
    )
    assert result.exit_code == 124


def test_subprocess_log_failure_is_a_stage_failure(tmp_path):
    from transit_ops.daily_run_process import run_stage

    result = run_stage(
        Stage((sys.executable, "-c", "print('ok')"), output=tmp_path, merge_stderr=True, tee=True)
    )
    assert result.exit_code == 1


@pytest.mark.parametrize("status", [0, 41, 52, 137])
def test_rollups_never_retry_a_non_timeout_or_a_log_failure(tmp_path, status):
    calls = []
    assert (
        DailyRun(
            lambda s: calls.append(s) or StageResult(status),
            artifact_root=tmp_path,
            environ={"PROVIDER_PLAN": '["stm"]'},
        ).run("rollups")
        == status
    )
    assert len(calls) == 1
    assert read(tmp_path / "rollups/rollup-stage-stm.json")["attempt_exit_codes"] == [status]


def test_database_identity_retains_hash_for_colliding_sanitized_provider_ids(tmp_path):
    names = []
    assert (
        DailyRun(
            lambda s: names.append(s.env["PGAPPNAME"]) or StageResult(0),
            artifact_root=tmp_path,
            environ={
                "PROVIDER_PLAN": '["a.b","a_b","shared-prefix-provider-alpha",'
                '"shared-prefix-provider-beta"]',
                "GITHUB_RUN_ID": "33279553860",
                "GITHUB_RUN_ATTEMPT": "2",
            },
        ).run("rollups")
        == 0
    )
    assert sorted(names) == sorted(
        [
            "dwr-r33279553860-a2-pa_b-h2e7336dc-crollup-pa1",
            "dwr-r33279553860-a2-pa_b-h648fa9b3-crollup-pa1",
            "dwr-r33279553860-a2-pshared-prefi-h625cafcd-crollup-pa1",
            "dwr-r33279553860-a2-pshared-prefi-h2e8b9bcd-crollup-pa1",
        ]
    )


@pytest.mark.parametrize(
    "failed_command", ["prune-i3-storage", "prune-bronze-storage", "retention-proof-report"]
)
def test_retention_preserves_first_failure_and_keeps_proving_later_providers(
    tmp_path, failed_command
):
    calls = []

    def runner(stage):
        command, provider = stage.argv[5:7]
        calls.append((command, provider))
        return StageResult(
            17 if provider == "stm" and command == failed_command else 31 if provider == "oc" else 0
        )

    assert (
        DailyRun(runner, artifact_root=tmp_path, environ={"PROVIDER_PLAN": '["stm","oc"]'}).run(
            "retention"
        )
        == 17
    )
    assert calls[-1] == ("retention-proof-report", "oc")
    assert ("retention-proof-report", "stm") in calls
    if failed_command == "prune-i3-storage":
        assert ("prune-warm-rollup-storage", "stm") not in calls


def test_retention_i3_and_warm_share_one_deadline(tmp_path):
    elapsed = [0.0]
    calls = []

    def runner(stage):
        command = stage.argv[5]
        calls.append(command)
        if command == "prune-i3-storage":
            assert stage.timeout_seconds == 300
            elapsed[0] = 250
        elif command == "prune-warm-rollup-storage":
            assert stage.timeout_seconds == 50
            return StageResult(124)
        return StageResult(0)

    assert (
        DailyRun(
            runner,
            artifact_root=tmp_path,
            clock=lambda: elapsed[0],
            environ={"PROVIDER_PLAN": '["stm"]'},
        ).run("retention")
        == 124
    )
    assert calls == ["prune-i3-storage", "prune-warm-rollup-storage", "retention-proof-report"]


@pytest.mark.parametrize("failed_job", ["PREPARE", "ROLLUPS", "RETENTION"])
def test_notify_fires_when_any_required_daily_job_fails(tmp_path, failed_job):
    calls = []
    env = {
        f"{job}_RESULT": "success"
        for job in ["PREPARE", "ROLLUPS", "PUBLISH", "PROOF", "RETENTION"]
    }
    env[failed_job + "_RESULT"] = "cancelled"
    assert notify(env, lambda argv: calls.append(argv) or 23) == 23
    assert calls[0][2:4] == ("fire", "daily-warm-rollups")


def test_cli_forwards_environment_and_job_exit_code(tmp_path, monkeypatch):
    from typer.testing import CliRunner

    import transit_ops.cli as cli

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("PROVIDER_PLAN", '["stm"]')
    monkeypatch.setattr(cli.SubprocessRunner, "__call__", lambda self, s: StageResult(41))
    result = CliRunner().invoke(cli.app, ["daily-run", "rollups"])
    assert result.exit_code == 41
    receipt = read(tmp_path / "artifacts/daily-warm-rollups/rollups/rollup-stage-stm.json")
    assert receipt["exit_code"] == 41


@pytest.mark.skipif(os.name == "nt", reason="POSIX TERM/grace/KILL process-group behavior")
def test_posix_timeout_kills_a_child_ignoring_term_even_after_its_parent_exits(tmp_path):
    from transit_ops.daily_run_process import run_stage

    # The child inherits the output pipe and outlives its parent after TERM.
    child = "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(10)"
    parent = (
        "import subprocess,sys,time; "
        f"subprocess.Popen([sys.executable, '-c', {child!r}]); time.sleep(10)"
    )
    result = run_stage(
        Stage(
            (sys.executable, "-c", parent),
            output=tmp_path / "log",
            tee=True,
            timeout_seconds=0.5,
            kill_after_seconds=1,
        )
    )
    assert result.exit_code == 124


@pytest.mark.skipif(os.name == "nt", reason="POSIX TERM/grace/KILL process-group behavior")
def test_posix_timeout_returns_137_when_direct_child_requires_kill():
    from transit_ops.daily_run_process import run_stage

    program = "import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(30)"
    result = run_stage(
        Stage((sys.executable, "-c", program), timeout_seconds=0.5, kill_after_seconds=1)
    )
    assert result.exit_code == 137


def test_notify_uses_only_stdlib_without_site_packages(tmp_path):
    harness = (
        "import os,runpy,subprocess,sys,types; "
        "os.environ.update(PREPARE_RESULT='success',ROLLUPS_RESULT='success',"
        "PUBLISH_RESULT='skipped',PROOF_RESULT='skipped',RETENTION_RESULT='success',"
        "HISTORIC_PUBLISH='false'); "
        "subprocess.run=lambda argv,**kw: types.SimpleNamespace(returncode="
        "0 if argv[2:4]==('resolve','daily-warm-rollups') else 9); "
        "runpy.run_path(sys.argv[1],run_name='__main__')"
    )
    result = subprocess.run(
        [sys.executable, "-I", "-S", "-c", harness, str(NOTIFY_SCRIPT)],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_missing_discovery_file_returns_jq_system_error(tmp_path):
    assert DailyRun(lambda s: None, artifact_root=tmp_path, environ={}).run("proof") == 2


@pytest.mark.skipif(sys.platform != "linux", reason="Ubuntu CI jq parity")
def test_installed_jq_malformed_json_and_missing_file_statuses(tmp_path):
    jq = shutil.which("jq")
    assert jq is not None, "Ubuntu runner must provide jq for legacy parity verification"
    malformed = subprocess.run(
        [jq, "-es", "."], input="{\n", capture_output=True, text=True, check=False
    )
    missing = subprocess.run(
        [jq, "-es", ".", str(tmp_path / "missing.json")],
        capture_output=True,
        text=True,
        check=False,
    )
    assert malformed.returncode == 5, malformed.stderr
    assert missing.returncode == 2, missing.stderr


def test_capture_replaces_invalid_utf8():
    from transit_ops.daily_run_process import run_stage

    result = run_stage(
        Stage((sys.executable, "-c", "import os; os.write(1,b'bad\\xff')"), capture=True)
    )
    assert result == StageResult(0, "bad\ufffd")


def test_tee_decodes_utf8_across_read_boundaries(tmp_path, capsys):
    from transit_ops.daily_run_process import run_stage

    program = "import os,time; os.write(1,b'caf\\xc3'); time.sleep(.15); os.write(1,b'\\xa9')"
    result = run_stage(Stage((sys.executable, "-c", program), output=tmp_path / "log", tee=True))
    assert result.exit_code == 0
    assert capsys.readouterr().out == "caf\u00e9"
    assert (tmp_path / "log").read_bytes() == b"caf\xc3\xa9"
