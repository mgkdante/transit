import importlib.util
import json
import subprocess
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
    for verb in (
        "exec",
        "logs",
        "events",
        "run",
        "start",
        "stop",
        "restart",
        "update",
        "compose",
        "prune",
        "--help",
        "stats;stop",
    ):
        with pytest.raises(ValueError):
            sampler.command(verb, "transit", ["abc"])
    assert "--no-stream" in sampler.command("stats", "transit", ["a" * 64])
    assert "label=com.docker.compose.project=transit" in sampler.command("ps", "transit", [])


def fake_run(sampler, *, missing=False, wrong=False, interrupt=False):
    calls, counter = [], [0]

    def run(args, **kwargs):
        calls.append(args)
        assert kwargs == {"capture_output": True, "text": True, "check": True, "timeout": 10}
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
        return SimpleNamespace(
            stdout="\n".join(
                json.dumps(
                    {
                        "ID": container_id,
                        "CPUPerc": "125%",
                        "MemUsage": "10MiB / 1GiB",
                        "NetIO": "2kB / 3kB",
                        "BlockIO": "4kB / 5kB",
                        "PIDs": "2",
                    }
                )
                for container_id in args[args.index("--no-trunc") + 1 :]
            )
        )

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


@pytest.mark.parametrize("stage", ("result", "discovery"))
def test_sample_cli_returns_interrupt_status(tmp_path, monkeypatch, stage):
    sampler = load()
    monkeypatch.setattr("sys.argv", ["sampler", "--output", str(tmp_path / "samples.jsonl")])
    if stage == "result":
        monkeypatch.setattr(sampler, "sample", lambda *args: True)
    else:

        def interrupt(*args):
            raise KeyboardInterrupt

        monkeypatch.setattr(sampler, "discover", interrupt)
    assert sampler.main() == 130


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
