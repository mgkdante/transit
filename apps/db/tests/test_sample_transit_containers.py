import importlib.util
import json
import os
import signal
import subprocess
import sys
import time
from contextlib import suppress
from pathlib import Path
from types import SimpleNamespace

import pytest


def load():
    spec = importlib.util.spec_from_file_location(
        "sampler", Path(__file__).parents[1] / "scripts/sample_transit_containers.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_command_builder_only_allows_three_read_only_verbs():
    sampler = load()
    for verb in ("ps", "inspect", "stats"):
        args = sampler.command(verb, "transit", ["a" * 64])
        assert isinstance(args, list) and args[:2] == ["docker", verb]
        assert "--format" in args
        assert "Env" not in " ".join(args)
    for (
        verb
    ) in "exec logs events run start stop restart update compose prune --help stats;stop".split():
        with pytest.raises(ValueError):
            sampler.command(verb, "transit", ["a" * 64])
    assert "--no-stream" in sampler.command("stats", "transit", ["a" * 64])
    assert "label=com.docker.compose.project=transit" in sampler.command("ps", "transit", [])


def fake_run(sampler, *, missing=False, wrong=False, interrupt=False):
    calls, counter = [], [0]

    def run(args, **kwargs):
        calls.append(args)
        assert set(kwargs) == {"capture_output", "text", "check", "timeout"}
        assert kwargs["capture_output"] and kwargs["text"] and kwargs["check"]
        assert 0 < kwargs["timeout"] <= 10
        if interrupt and args[1] == "stats":
            raise KeyboardInterrupt
        if args[1] == "ps":
            generation = 0 if counter[0] == 0 else 1
            ids = [f"{generation * 16 + i:064x}" for i in range(len(sampler.SERVICES))]
            return SimpleNamespace(stdout="" if missing else "\n".join(ids))
        if args[1] == "inspect":
            counter[0] += 1
            rows = [
                {
                    "id": f"{(0 if counter[0] == 1 else 16) + i:064x}",
                    "name": "x",
                    "project": "other" if wrong else "transit",
                    "service": service,
                    "state": "running",
                    "restarts": counter[0] - 1,
                    "memory_limit": 100,
                    "nano_cpus": 0,
                    "cpu_quota": 0,
                    "cpu_period": 0,
                }
                for i, service in enumerate(sampler.SERVICES)
            ]
            return SimpleNamespace(stdout="\n".join(json.dumps(r) for r in rows))
        values = dict(
            CPUPerc="125%",
            MemUsage="10MiB / 1GiB",
            NetIO="2kB / 3kB",
            BlockIO="4kB / 5kB",
            PIDs="2",
        )
        ids = args[args.index("--no-trunc") + 1 :]
        return SimpleNamespace(stdout="\n".join(json.dumps(dict(ID=id, **values)) for id in ids))

    return run, calls


def test_sample_selects_only_verified_transit_service_labels():
    sampler = load()
    for config in ({"missing": True}, {"wrong": True}):
        run, calls = fake_run(sampler, **config)
        with pytest.raises(ValueError):
            sampler.discover("transit", run)
        assert all(c[1] != "stats" for c in calls)


def test_sample_uses_argument_arrays_and_never_reads_environment_fields():
    sampler = load()
    run, calls = fake_run(sampler)
    sampler.discover("transit", run)
    assert all(isinstance(c, list) and "Env" not in " ".join(c) for c in calls)


def test_sample_covers_24_hours_with_bounded_stats_calls():
    sampler, elapsed, rows = load(), [0.0], []
    run, calls = fake_run(sampler)

    def sleep(seconds):
        elapsed[0] += seconds

    sampler.sample("transit", 86400, 60, rows.append, run, lambda: elapsed[0], sleep)
    assert sum(c[1] == "stats" for c in calls) == 1440
    assert rows[-1]["elapsed_seconds"] == 86400
    assert rows[-1]["services"]["postgres"]["samples"] == 1440


def test_sample_records_restarts_gaps_and_unit_bases():
    sampler, elapsed, rows = load(), [0.0], []
    base, _ = fake_run(sampler)

    def run(args, **kwargs):
        result = base(args, **kwargs)
        if args[1] == "stats":
            elapsed[0] += 70
        return result

    sampler.sample(
        "transit",
        180,
        60,
        rows.append,
        run,
        lambda: elapsed[0],
        lambda seconds: elapsed.__setitem__(0, elapsed[0] + seconds),
    )
    assert any(r.get("kind") == "restart" for r in rows)
    assert any(r.get("kind") == "gap" for r in rows)
    assert any(r.get("source") == "docker stats MemUsage" for r in rows)


def test_sample_refuses_missing_project_and_exits_cleanly_on_interrupt():
    sampler, rows = load(), []
    run, _ = fake_run(sampler, interrupt=True)
    sampler.sample("transit", 60, 60, rows.append, run, lambda: 0, lambda _: None)
    assert rows[-1]["interrupted"] is True


def test_sample_units_unknowns_and_cpu_above_one_core():
    sampler = load()
    values = sampler.metrics({"CPUPerc": "125%", "MemUsage": "1KiB / 2MB", "PIDs": "--"})
    assert values["cpu_percent"] == 125
    assert values["memory_bytes"] == 1024 and values["memory_limit_bytes"] == 2000000
    assert values["pids"] is None and values["net_in_bytes"] is None
    assert sampler.describe([1, 2, 3, 4, 5]) == {"min": 1, "max": 5, "p50": 3, "p95": 5, "p99": 5}


def test_sample_rejects_ambiguous_or_unrelated_containers():
    sampler = load()
    base, _ = fake_run(sampler)

    def run(args, **kwargs):
        result = base(args, **kwargs)
        if args[1] == "inspect":
            rows = [json.loads(r) for r in result.stdout.splitlines()]
            rows[-1]["service"] = rows[0]["service"]
            result.stdout = "\n".join(json.dumps(row) for row in rows)
        return result

    with pytest.raises(ValueError):
        sampler.discover("transit", run)


def test_sample_rejects_option_ids_and_withholds_process_errors():
    sampler, rows, elapsed = load(), [], [0.0]
    for ids in ([], ["--all"], ["a; stop"]):
        with pytest.raises(ValueError):
            sampler.command("inspect", "transit", ids)
    template = sampler.command("inspect", "transit", ["a" * 64])[3]
    assert all(
        field not in template
        for field in (".Config.Env", ".Mounts", ".Config.Cmd", ".State.Health", ".Args")
    )
    base, _ = fake_run(sampler)

    def run(args, **kwargs):
        if args[1] == "stats":
            raise subprocess.TimeoutExpired(
                args, 10, output="private-output", stderr="private-error"
            )
        return base(args, **kwargs)

    sampler.sample(
        "transit",
        60,
        60,
        rows.append,
        run,
        lambda: elapsed[0],
        lambda seconds: elapsed.__setitem__(0, elapsed[0] + seconds),
    )
    assert rows[-1]["services"]["postgres"]["errors"] == 1
    assert "private-" not in json.dumps(rows)


def test_extra_stats_and_inspect_fields_are_never_emitted():
    sampler, rows, elapsed = load(), [], [0.0]
    base, _ = fake_run(sampler)

    def run(args, **kwargs):
        result = base(args, **kwargs)
        if args[1] != "ps":
            result.stdout = "\n".join(
                json.dumps(dict(json.loads(line), extra="EXTRA_SENTINEL"))
                for line in result.stdout.splitlines()
            )
        return result

    sampler.sample(
        "transit",
        60,
        60,
        rows.append,
        run,
        lambda: elapsed[0],
        lambda seconds: elapsed.__setitem__(0, elapsed[0] + seconds),
    )
    assert "EXTRA_SENTINEL" not in json.dumps(rows)
    assert all("raw" not in row for row in rows)


def test_discovery_uses_the_same_deadline_and_reports_all_elapsed_time():
    sampler, rows, elapsed, timeouts = load(), [], [0.0], []

    def run(args, **kwargs):
        timeouts.append(kwargs["timeout"])
        elapsed[0] += kwargs["timeout"]
        raise subprocess.TimeoutExpired(args, kwargs["timeout"])

    with pytest.raises((TimeoutError, subprocess.TimeoutExpired)):
        sampler.sample("transit", 1, 60, rows.append, run, lambda: elapsed[0], lambda _: None)
    assert timeouts == [1] and elapsed[0] == 1
    assert rows[-1]["kind"] == "summary" and rows[-1]["elapsed_seconds"] == 1


@pytest.mark.parametrize("limit", (128, 256))
def test_output_ceiling_keeps_a_marker_summary_and_nonzero_status(tmp_path, monkeypatch, limit):
    sampler = load()
    path = tmp_path / "bounded.jsonl"
    monkeypatch.setattr(
        "sys.argv", ["sampler", "--output", str(path), "--max-output-bytes", str(limit)]
    )

    run, _ = fake_run(sampler)
    monkeypatch.setattr(sampler.Control, "run", lambda self, args, **kwargs: run(args, **kwargs))
    assert sampler.main() == 2
    rows = [json.loads(line) for line in path.read_bytes().splitlines()]
    assert path.stat().st_size <= limit
    assert any(r["kind"] == "truncation" for r in rows) and rows[-1]["kind"] == "summary"


SIGNAL_HARNESS = r"""
import json, os, runpy, signal, subprocess, sys, threading, time
from pathlib import Path
test, folder, phase, signum = sys.argv[1:]
folder, signum = Path(folder), int(signum)
helpers = runpy.run_path(test)
sampler = helpers['load']()
base, _ = helpers['fake_run'](sampler)
real_popen, children = subprocess.Popen, []
original_run = sampler.Control.run
def run(self, args, **kwargs):
    if args[1] == phase:
        return original_run(self, args, **kwargs)
    self.check()
    return base(args, **kwargs)
sampler.Control.run = run
def popen(args, **kwargs):
    assert args[1] == phase
    child = real_popen([sys.executable, str(folder/'docker.py'), str(folder/'ready')], **kwargs)
    children.append(child)
    return child
sampler.subprocess.Popen = popen
if phase.startswith('summary'):
    active, fired = [], [False]
    enter, describe = sampler.Control.__enter__, sampler.describe
    emit, fsync = sampler.Jsonl.__call__, os.fsync
    writing = [False]
    def entered(self):
        active.append(self)
        return enter(self)
    sampler.Control.__enter__ = entered
    def cancel():
        if not fired[0]:
            fired[0] = True
            (folder/'ready').write_text('0')
            while not active[0].signal: time.sleep(.01)
    def prepare(values):
        if phase == 'summary_prepare': cancel()
        return describe(values)
    def output(self, row):
        writing[0] = row['kind'] == 'summary'
        try: return emit(self, row)
        finally: writing[0] = False
    def sync(fd):
        if writing[0] and phase in ('summary_write','summary_write_cap'): cancel()
        return fsync(fd)
    sampler.describe, sampler.Jsonl.__call__, sampler.os.fsync = prepare, output, sync
    if phase == 'summary_exit':
        exit = sampler.Control.__exit__
        def exiting(self, *args):
            cancel()
            return exit(self, *args)
        sampler.Control.__exit__ = exiting
if phase == 'sleep':
    original = sampler.Control.sleep
    def sleep(self, seconds):
        (folder/'ready').write_text('0')
        return original(self, seconds)
    sampler.Control.sleep = sleep
if os.name == 'nt':
    def deliver():
        while not (folder/'trigger').exists(): time.sleep(.01)
        signal.raise_signal(signum)
    threading.Thread(target=deliver, daemon=True).start()
duration = '.2' if phase.startswith('summary') else '30'
sys.argv = ['sampler','--duration-seconds',duration,'--output',str(folder/'samples.jsonl')]
if phase.endswith('_cap'): sys.argv += ['--max-output-bytes','128']
status = sampler.main()
reaped = all(p.returncode is not None for p in children)
if os.name != 'nt':
    for p in children:
        try: os.waitpid(p.pid, os.WNOHANG); reaped = False
        except ChildProcessError: pass
(folder/'proof').write_text(json.dumps(dict(reaped=reaped, codes=[p.returncode for p in children])))
sys.exit(status)
"""


def assert_terminal(path, signum):
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    assert rows[-1]["kind"] == "summary" and rows[-1]["interrupted"]
    assert rows[-1]["outcome"] == 128 + int(signum)
    assert sum(row["kind"] == "summary" for row in rows) == 1


@pytest.mark.parametrize("signum", (signal.SIGTERM, signal.SIGINT))
@pytest.mark.parametrize(
    "phase",
    (
        "ps",
        "inspect",
        "stats",
        "sleep",
        "summary_prepare",
        "summary_write",
        "summary_write_cap",
        "summary_exit",
    ),
)
def test_sample_cli_returns_interrupt_status(tmp_path, signum, phase):
    fake = "import os,signal,sys,time;from pathlib import Path\n"
    fake += "if os.name!='nt': signal.signal(signal.SIGTERM,signal.SIG_IGN)\n"
    fake += "Path(sys.argv[1]).write_text(str(os.getpid()));time.sleep(30)\n"
    (tmp_path / "docker.py").write_text(fake)
    args = [
        sys.executable,
        "-c",
        SIGNAL_HARNESS,
        str(Path(__file__)),
        str(tmp_path),
        phase,
        str(int(signum)),
    ]
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        until = time.monotonic() + 8
        while (
            not (tmp_path / "ready").exists() and proc.poll() is None and time.monotonic() < until
        ):
            time.sleep(0.02)
        if not (tmp_path / "ready").exists():
            diagnostic = (
                proc.communicate()[1].decode()
                if proc.poll() is not None
                else "harness still running"
            )
            pytest.fail(diagnostic)
        if os.name == "nt":
            (tmp_path / "trigger").touch()
        else:
            os.kill(proc.pid, signum)
        proc.communicate(timeout=5)
        assert proc.returncode == 128 + int(signum)
        proof = json.loads((tmp_path / "proof").read_text())
        assert proof["reaped"]
        if os.name != "nt" and phase in ("ps", "inspect", "stats"):
            assert -signal.SIGKILL in proof["codes"]
        assert_terminal(tmp_path / "samples.jsonl", signum)
        if phase.endswith("_cap"):
            assert (tmp_path / "samples.jsonl").stat().st_size <= 128
    finally:
        if not (tmp_path / "proof").exists() and (tmp_path / "ready").exists():
            if pid := int((tmp_path / "ready").read_text()):
                with suppress(OSError):
                    os.kill(pid, signal.SIGTERM if os.name == "nt" else signal.SIGKILL)
        if proc.poll() is None:
            proc.kill()
        proc.communicate()
