"""Owner-run passive Docker observations. Memory is Docker MemUsage, not Python RSS."""

import argparse
import json
import math
import os
import re
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
    rows = [json.loads(row) for row in call("inspect", project, ids, run)]
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
    return values


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
    run: Callable[..., Any] = subprocess.run,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> bool:
    if not 0 < duration <= 86400 or not math.isfinite(interval) or interval < 60:
        raise ValueError("duration must be at most 86400 seconds; interval at least 60")
    current = discover(project, run)
    started, interrupted, slot = clock(), False, 0
    history: dict[str, dict[str, Any]] = {
        s: {"samples": 0, "errors": 0, "restarts": 0, "values": {}} for s in SERVICES
    }
    try:
        while clock() - started < duration:
            slot = tick(project, current, history, started, slot, interval, emit, run, clock)
            sleep(max(0, min(duration, slot * interval) - (clock() - started)))
    except KeyboardInterrupt:
        interrupted = True
    finally:
        for summary in history.values():
            summary["metrics"] = {k: describe(v) for k, v in summary.pop("values").items()}
            summary["sample_fraction"] = summary["samples"] / math.ceil(duration / interval)
        emit(
            {
                "kind": "summary",
                "elapsed_seconds": clock() - started,
                "interrupted": interrupted,
                "services": history,
                "expected_samples": math.ceil(duration / interval),
                "percentiles": "nearest rank",
                "memory_source": "docker stats MemUsage; not RSS",
                "units": "rounded Docker byte counters, CPU percent (may exceed 100), PID count",
            }
        )
    return interrupted


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
                raw=row,
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
    args = parser.parse_args()
    try:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x", encoding="utf-8", newline="\n") as out:

            def emit(row: dict[str, Any]) -> None:
                out.write(json.dumps(row, sort_keys=True) + "\n")
                out.flush()
                os.fsync(out.fileno())

            interrupted = sample(
                args.compose_project, args.duration_seconds, args.interval_seconds, emit
            )
        return 130 if interrupted else 0
    except KeyboardInterrupt:
        return 130
    except (ValueError, OSError, subprocess.SubprocessError):
        sys.stderr.write("container sample failed; details withheld\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
