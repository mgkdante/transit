"""Owner-run passive Docker observations. Memory is Docker MemUsage, not Python RSS."""

import argparse
import json
import math
import os
import re
import signal
import subprocess
import sys
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml  # type: ignore[import-untyped]

SERVICES = tuple(
    yaml.safe_load((Path(__file__).parents[1] / "docker-compose.yml").read_text())["services"]
)
FIELDS = {
    "id": ".Id",
    "name": ".Name",
    "state": ".State.Status",
    "restarts": ".RestartCount",
    "started": ".State.StartedAt",
    "finished": ".State.FinishedAt",
    "oom": ".State.OOMKilled",
    "project": 'index .Config.Labels "com.docker.compose.project"',
    "service": 'index .Config.Labels "com.docker.compose.service"',
    "memory_limit": ".HostConfig.Memory",
    "nano_cpus": ".HostConfig.NanoCpus",
    "cpu_quota": ".HostConfig.CpuQuota",
    "cpu_period": ".HostConfig.CpuPeriod",
}
INSPECT = "{" + ",".join(f'"{key}":{{{{json ({value})}}}}' for key, value in FIELDS.items()) + "}"


class OutputLimit(RuntimeError):
    pass


class Jsonl:
    def __init__(self, out: Any, limit: int) -> None:
        if not 128 <= limit <= 64 * 1024 * 1024:
            raise ValueError("output limit must be between 128 and 67108864 bytes")
        self.out, self.limit, self.used, self.truncated = out, limit, 0, False
        self.finished = False
        self.corrected = False
        self.summary_start = 0

    def append(self, row: dict[str, Any]) -> None:
        data = (json.dumps(row, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")
        self.out.write(data)
        self.out.flush()
        os.fsync(self.out.fileno())
        self.used += len(data)

    def __call__(self, row: dict[str, Any]) -> None:
        if self.finished:
            # Permit one in-place cancellation correction, never a second terminal record.
            if self.corrected or row["kind"] != "summary" or row.get("interrupted") is not True:
                raise OutputLimit
            self.out.seek(self.summary_start)
            self.out.truncate()
            self.used, self.finished, self.corrected = self.summary_start, False, True
        size = len((json.dumps(row, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8"))
        summary = row["kind"] == "summary"
        if self.used + size > self.limit - (0 if summary else 128):
            if not self.truncated:
                self.append(dict(kind="truncation", limit_bytes=self.limit))
                self.truncated = True
            if not summary:
                raise OutputLimit
            row = dict(
                kind="summary",
                truncated=True,
                interrupted=row.get("interrupted", False),
                outcome=row["outcome"] if row.get("interrupted") else 2,
            )
        if summary:
            self.summary_start = self.used
        self.append(row)
        self.finished = summary


class Control:
    def __init__(
        self, deadline: float, clock: Callable[[], float], run: Callable[..., Any] | None
    ) -> None:
        self.deadline, self.clock, self.injected, self.signal = deadline, clock, run, 0

    def __enter__(self) -> "Control":
        self.previous = {s: signal.getsignal(s) for s in (signal.SIGINT, signal.SIGTERM)}
        for s in self.previous:
            # Never unwind Popen construction; polling owns cancellation and reaping.
            signal.signal(s, lambda number, frame: setattr(self, "signal", self.signal or number))
        return self

    def __exit__(self, *args: Any) -> None:
        for s, handler in self.previous.items():
            signal.signal(s, handler)

    def check(self) -> None:
        if self.signal:
            raise KeyboardInterrupt(self.signal)

    def run(self, args: list[str], **kwargs: Any) -> Any:
        self.check()
        timeout = min(10, self.deadline - self.clock())
        if timeout <= 0:
            raise TimeoutError("sample deadline")
        if self.injected is not None:
            result = self.injected(args, **(kwargs | dict(timeout=timeout)))
            self.check()
            if self.clock() >= self.deadline:
                raise TimeoutError("sample deadline")
            return result
        end = min(self.deadline, self.clock() + timeout)
        child = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            while True:
                self.check()
                left = end - self.clock()
                if left <= 0:
                    raise subprocess.TimeoutExpired(args, timeout)
                try:
                    stdout, _ = child.communicate(timeout=min(0.1, left))
                    break
                except subprocess.TimeoutExpired:
                    continue
            self.check()
            if self.clock() >= end:
                raise subprocess.TimeoutExpired(args, timeout)
            if child.returncode:
                raise subprocess.CalledProcessError(child.returncode, args)
            return subprocess.CompletedProcess(args, child.returncode, stdout)
        finally:
            if child.poll() is None:
                try:
                    child.terminate()
                    child.wait(timeout=0.2)
                except (subprocess.TimeoutExpired, OSError):
                    child.kill()
            child.wait()
            for pipe in (child.stdout, child.stderr):
                if pipe:
                    pipe.close()

    def sleep(self, seconds: float) -> None:
        end = min(self.deadline, self.clock() + seconds)
        while self.clock() < end:
            self.check()
            time.sleep(max(0, min(0.1, end - self.clock())))
        self.check()


def command(verb: str, project: str, ids: list[str]) -> list[str]:
    if verb not in ("ps", "inspect", "stats") or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", project):
        raise ValueError("unsupported command or project")
    if any(not re.fullmatch(r"[a-f0-9]{12,64}", value) for value in ids):
        raise ValueError("invalid container identity")
    if verb == "ps":
        return [
            "docker",
            "ps",
            "--all",
            "--filter",
            "label=com.docker.compose.project=" + project,
            "--format",
            "{{.ID}}",
            "--no-trunc",
        ]
    if not ids:
        raise ValueError("explicit container identities required")
    return [
        "docker",
        verb,
        "--format",
        INSPECT if verb == "inspect" else "{{json .}}",
        *(["--no-stream", "--no-trunc"] if verb == "stats" else []),
        *ids,
    ]


def call(verb: str, project: str, ids: list[str], run: Callable[..., Any]) -> list[str]:
    return str(
        run(
            command(verb, project, ids), capture_output=True, text=True, check=True, timeout=10
        ).stdout
    ).splitlines()


def discover(project: str, run: Callable[..., Any]) -> dict[str, dict[str, Any]]:
    ids = call("ps", project, [], run)
    if not ids or len(set(ids)) != len(ids):
        raise ValueError("missing or ambiguous project")
    rows = [
        {k: v for k, v in json.loads(row).items() if k in FIELDS}
        for row in call("inspect", project, ids, run)
    ]
    integers = {"restarts", "memory_limit", "nano_cpus", "cpu_quota", "cpu_period"}
    if any(
        type(v) is not (int if k in integers else bool if k == "oom" else str)
        for row in rows
        for k, v in row.items()
    ):
        raise ValueError("invalid inspect field type")
    if (
        len(rows) != len(SERVICES)
        or {r["id"] for r in rows} != set(ids)
        or {r["service"] for r in rows} != set(SERVICES)
        or any(r["project"] != project for r in rows)
    ):
        raise ValueError("unverified project or services")
    return {row["service"]: row for row in rows}


def units(value: str) -> float | None:
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*([kKMGT]?i?B)\s*", value)
    scales = {
        "B": 1,
        "kB": 1000,
        "MB": 1000**2,
        "GB": 1000**3,
        "TB": 1000**4,
        "KiB": 1024,
        "kiB": 1024,
        "MiB": 1024**2,
        "GiB": 1024**3,
        "TiB": 1024**4,
    }
    return float(match[1]) * scales[match[2]] if match and match[2] in scales else None


def metrics(row: dict[str, str]) -> dict[str, float | None]:
    if any(
        not isinstance(row.get(k, ""), str)
        for k in ("MemUsage", "NetIO", "BlockIO", "CPUPerc", "PIDs")
    ):
        raise ValueError("invalid stats field type")
    values: dict[str, float | None] = {}
    for field, names in (
        ("MemUsage", ("memory_bytes", "memory_limit_bytes")),
        ("NetIO", ("net_in_bytes", "net_out_bytes")),
        ("BlockIO", ("block_in_bytes", "block_out_bytes")),
    ):
        pair = row.get(field, "").split("/")
        values.update(
            {name: units(pair[i]) if len(pair) == 2 else None for i, name in enumerate(names)}
        )
    for field, name in (("CPUPerc", "cpu_percent"), ("PIDs", "pids")):
        raw = row.get(field, "").removesuffix("%")
        values[name] = float(raw) if re.fullmatch(r"\d+(\.\d+)?", raw) else None
    return {k: v if v is None or math.isfinite(v) else None for k, v in values.items()}


def describe(values: list[float]) -> dict[str, float] | None:
    if not values:
        return None
    ordered = sorted(values)
    return {
        "min": ordered[0],
        "max": ordered[-1],
        **{f"p{p}": ordered[math.ceil(len(ordered) * p / 100) - 1] for p in (50, 95, 99)},
    }


def sample(
    project: str,
    duration: float,
    interval: float,
    emit: Callable[[dict[str, Any]], None],
    run: Callable[..., Any] | None = None,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] | None = None,
) -> int:
    if not 0 < duration <= 86400 or not math.isfinite(interval) or interval < 60:
        raise ValueError("duration must be at most 86400 seconds; interval at least 60")
    started, status, slot = clock(), 1, 0
    pending: Exception | None = None
    history: dict[str, dict[str, Any]] = {
        s: {"samples": 0, "errors": 0, "restarts": 0, "values": {}} for s in SERVICES
    }
    with Control(started + duration, clock, run) as control:
        try:
            current = discover(project, control.run)
            while clock() - started < duration:
                slot = tick(
                    project, current, history, started, slot, interval, emit, control.run, clock
                )
                (sleep or control.sleep)(
                    max(0, min(duration, slot * interval) - (clock() - started))
                )
                control.check()
            status = 0
        except KeyboardInterrupt as exc:
            status = 128 + (exc.args[0] if exc.args else signal.SIGINT)
        except OutputLimit:
            status = 2
        except (ValueError, OSError, subprocess.SubprocessError) as exc:
            pending = exc
        finally:
            terminal = finish(history, duration, interval, emit, clock() - started, status, control)
            status = reconcile(control, emit, terminal, status)
    if control.signal and terminal["outcome"] != 128 + control.signal:
        with control:
            status = reconcile(control, emit, terminal, status)
    if pending is not None and not control.signal:
        raise pending
    return 128 + control.signal if control.signal else status


def reconcile(
    control: Control, emit: Callable[[dict[str, Any]], None], terminal: dict[str, Any], status: int
) -> int:
    status = 128 + control.signal if control.signal else status
    if terminal["outcome"] != status:
        terminal.update(outcome=status, interrupted=True)
        emit(terminal)
    return status


def finish(
    history: dict[str, Any],
    duration: float,
    interval: float,
    emit: Callable[[dict[str, Any]], None],
    elapsed: float,
    status: int,
    control: Control,
) -> dict[str, Any]:
    for summary in history.values():
        summary["metrics"] = {k: describe(v) for k, v in summary.pop("values").items()}
        summary["sample_fraction"] = summary["samples"] / math.ceil(duration / interval)
    status = 128 + control.signal if control.signal else status
    terminal = {
        "kind": "summary",
        "elapsed_seconds": elapsed,
        "interrupted": status >= 128,
        "outcome": status,
        "services": history,
        "expected_samples": math.ceil(duration / interval),
        "percentiles": "nearest rank",
        "memory_source": "docker stats MemUsage; not RSS",
        "units": "rounded Docker byte counters, CPU percent (may exceed 100), PID count",
    }
    emit(terminal)
    return terminal


def record(
    rows: list[dict[str, str]],
    ids: dict[str, str],
    current: dict[str, Any],
    history: dict[str, Any],
    emit: Callable[[dict[str, Any]], None],
    at: dict[str, Any],
) -> None:
    for row in rows:
        service, values = ids[row["ID"]], metrics(row)
        history[service]["samples"] += 1
        for key, value in values.items():
            if value is not None:
                history[service]["values"].setdefault(key, []).append(value)
        emit(
            dict(
                kind="sample",
                service=service,
                container=current[service],
                metrics=values,
                source="docker stats MemUsage",
                **at,
            )
        )
    for service in set(SERVICES) - {ids[r["ID"]] for r in rows}:
        history[service]["errors"] += 1
        emit(dict(kind="error", service=service, reason="missing stats row", **at))


def tick(
    project: str,
    current: dict[str, Any],
    history: dict[str, Any],
    start: float,
    slot: int,
    interval: float,
    emit: Callable[[dict[str, Any]], None],
    run: Callable[..., Any],
    clock: Callable[[], float],
) -> int:
    at = {"utc": datetime.now(UTC).isoformat(), "monotonic": clock()}
    try:
        observed = discover(project, run) if slot else current
        for service, row in observed.items():
            old = current[service]
            if row["id"] != old["id"] or row["restarts"] != old["restarts"]:
                history[service]["restarts"] += max(row["restarts"] - old["restarts"], 1)
                emit(dict(kind="restart", service=service, previous=old, current=row, **at))
        current.update(observed)
        ids = {row["id"]: service for service, row in current.items()}
        rows = [json.loads(r) for r in call("stats", project, list(ids), run)]
        if len({r["ID"] for r in rows}) != len(rows) or any(r["ID"] not in ids for r in rows):
            raise ValueError("unverified stats identity")
        record(rows, ids, current, history, emit, at)
    except (ValueError, KeyError, OSError, subprocess.SubprocessError):
        for summary in history.values():
            summary["errors"] += 1
        emit(dict(kind="error", reason="Docker observation failed; details withheld", **at))
    following = math.floor((clock() - start) / interval) + 1
    if following > slot + 1:
        emit(
            dict(
                kind="gap", missed=following - slot - 1, scheduled_from=(slot + 1) * interval, **at
            )
        )
    return following


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compose-project", default="transit")
    parser.add_argument("--duration-seconds", type=float, default=86400)
    parser.add_argument("--interval-seconds", type=float, default=60)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-output-bytes", type=int, default=64 * 1024 * 1024)
    args = parser.parse_args()
    try:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("xb") as out:
            emit = Jsonl(out, args.max_output_bytes)
            status = sample(
                args.compose_project, args.duration_seconds, args.interval_seconds, emit
            )
        return status or (2 if emit.truncated else 0)
    except OutputLimit:
        return 2
    except KeyboardInterrupt:
        return 130
    except (ValueError, OSError, subprocess.SubprocessError):
        sys.stderr.write("container sample failed; details withheld\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
