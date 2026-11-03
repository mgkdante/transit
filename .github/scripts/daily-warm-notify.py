"""Daily Warm alert selection using only the system Python standard library."""

from __future__ import annotations

import os
import subprocess
from collections.abc import Callable, Mapping
from pathlib import Path


def _run(argv: tuple[str, ...]) -> int:
    return subprocess.run(argv, check=False).returncode


def notify(environ: Mapping[str, str], *, runner: Callable[[tuple[str, ...]], int] = _run) -> int:
    names = ("prepare", "rollups", "publish", "proof", "retention")
    results = {name: environ.get(f"{name.upper()}_RESULT", "") for name in names}
    historic = environ.get("HISTORIC_PUBLISH", "")
    historic_ok = results["publish"] == results["proof"] == "success" or (
        historic == "false" and results["publish"] == results["proof"] == "skipped"
    )
    success = historic_ok and all(
        results[name] == "success" for name in ("prepare", "rollups", "retention")
    )
    summary = ", ".join(f"{name}={value}" for name, value in results.items())
    summary += f", historic_publish={historic}"
    script = Path(__file__).resolve().with_name("alert-issue.sh")
    args: tuple[str, ...]
    if success:
        args = (
            "resolve",
            "daily-warm-rollups",
            f"recovered in run {environ.get('GITHUB_RUN_ID', '')} ({summary})",
        )
    else:
        url = (
            f"{environ.get('GITHUB_SERVER_URL', '')}/"
            f"{environ.get('GITHUB_REPOSITORY', '')}/actions/runs/"
            f"{environ.get('GITHUB_RUN_ID', '')}"
        )
        args = (
            "fire",
            "daily-warm-rollups",
            "[alert] Daily Warm Rollups failed",
            f"failed run {url} ({summary})",
        )
    return runner(("bash", str(script), *args))


if __name__ == "__main__":
    raise SystemExit(notify(os.environ))
