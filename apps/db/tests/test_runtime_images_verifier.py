from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

DB_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = DB_ROOT / "scripts/verify-runtime-images.sh"
CADDY_IMAGE = (
    "caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648"
)
SUFFIX = "pytest-123"
WORKER_TAG = f"transit-runtime-verify-worker:{SUFFIX}"
HEALTH_TAG = f"transit-runtime-verify-health:{SUFFIX}"
POSTGRES_TAG = f"transit-runtime-verify-postgres:{SUFFIX}"


def _fake_docker(tmp_path: Path) -> tuple[Path, Path]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "docker.jsonl"
    fake = bin_dir / "docker"
    fake.write_text(
        """#!/usr/bin/env python3
import json
import os
import signal
import sys
import time

log = os.environ["FAKE_DOCKER_LOG"]
argv = sys.argv[1:]
with open(log, "a", encoding="utf-8") as handle:
    handle.write(json.dumps(argv) + "\\n")

rendered = " ".join(argv)
needle = os.environ.get("FAKE_DOCKER_FAIL_MATCH")
if needle and needle in rendered:
    raise SystemExit(int(os.environ.get("FAKE_DOCKER_FAIL_CODE", "37")))

signal_needle = os.environ.get("FAKE_DOCKER_SIGNAL_MATCH")
if signal_needle and signal_needle in rendered:
    signal_name = os.environ.get("FAKE_DOCKER_SIGNAL", "TERM")
    os.kill(os.getppid(), getattr(signal, f"SIG{signal_name}"))
    time.sleep(0.05)

if argv[:1] == ["version"]:
    output = "Docker Engine 99.0.0"
elif argv[:2] == ["compose", "version"]:
    output = "Docker Compose version v99.0.0"
elif "--entrypoint" in argv:
    entrypoint = argv[argv.index("--entrypoint") + 1]
    output = {
        "python": "Python 3.12.14",
        "uv": "uv 0.11.15 (fake-build)",
        "postgres": "postgres (PostgreSQL) 16.15 (Debian fake)",
        "pg_repack": "pg_repack 1.5.2",
        "dpkg-query": "fake-package=1.0",
        "caddy": "v2.11.4 h1:fake",
    }[entrypoint]
else:
    output = "fake-ok"

bad_needle = os.environ.get("FAKE_DOCKER_BAD_VERSION_MATCH")
if bad_needle and bad_needle in rendered:
    output = os.environ.get("FAKE_DOCKER_BAD_VERSION_OUTPUT", "unexpected-version")
print(output)
""",
        encoding="utf-8",
    )
    fake.chmod(0o755)
    return bin_dir, log


def _run(
    tmp_path: Path,
    *,
    fail_match: str | None = None,
    signal_match: str | None = None,
    signal_name: str = "TERM",
    bad_version_match: str | None = None,
    bad_version_output: str = "unexpected-version",
) -> tuple[subprocess.CompletedProcess[str], list[list[str]]]:
    bin_dir, log = _fake_docker(tmp_path)
    env = os.environ.copy()
    env.update(
        {
            "PATH": f"{bin_dir}:{env['PATH']}",
            "FAKE_DOCKER_LOG": str(log),
            "TRANSIT_RUNTIME_VERIFY_TAG_SUFFIX": SUFFIX,
        }
    )
    if fail_match is not None:
        env["FAKE_DOCKER_FAIL_MATCH"] = fail_match
    if signal_match is not None:
        env["FAKE_DOCKER_SIGNAL_MATCH"] = signal_match
        env["FAKE_DOCKER_SIGNAL"] = signal_name
    if bad_version_match is not None:
        env["FAKE_DOCKER_BAD_VERSION_MATCH"] = bad_version_match
        env["FAKE_DOCKER_BAD_VERSION_OUTPUT"] = bad_version_output
    result = subprocess.run(
        ["bash", str(SCRIPT)],
        cwd=DB_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    calls = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]
    return result, calls


def _expected_calls() -> list[list[str]]:
    package_format = r"${binary:Package}=${Version}\n"
    return [
        ["version", "--format", "Docker Engine {{.Server.Version}}"],
        ["compose", "version"],
        ["build", "--pull", "--file", "Dockerfile", "--tag", WORKER_TAG, "."],
        ["build", "--pull", "--file", "Dockerfile.health", "--tag", HEALTH_TAG, "."],
        ["build", "--pull", "--file", "Dockerfile.postgis", "--tag", POSTGRES_TAG, "."],
        ["run", "--rm", "--entrypoint", "python", WORKER_TAG, "--version"],
        ["run", "--rm", "--entrypoint", "uv", WORKER_TAG, "--version"],
        [
            "run",
            "--rm",
            "--entrypoint",
            "dpkg-query",
            WORKER_TAG,
            "-W",
            f"-f={package_format}",
            "ca-certificates",
            "postgresql-common",
            "postgresql-client-16",
        ],
        ["run", "--rm", "--entrypoint", "python", HEALTH_TAG, "--version"],
        ["run", "--rm", "--entrypoint", "uv", HEALTH_TAG, "--version"],
        ["run", "--rm", "--entrypoint", "postgres", POSTGRES_TAG, "--version"],
        ["run", "--rm", "--entrypoint", "pg_repack", POSTGRES_TAG, "--version"],
        [
            "run",
            "--rm",
            "--entrypoint",
            "dpkg-query",
            POSTGRES_TAG,
            "-W",
            f"-f={package_format}",
            "postgresql-16-postgis-3",
            "postgresql-16-postgis-3-scripts",
            "postgresql-16-repack",
        ],
        ["run", "--rm", "--entrypoint", "caddy", CADDY_IMAGE, "version"],
        ["image", "rm", "--force", WORKER_TAG, HEALTH_TAG, POSTGRES_TAG],
    ]


def test_runtime_verifier_uses_exact_build_probe_and_cleanup_argv(tmp_path: Path) -> None:
    result, calls = _run(tmp_path)

    assert result.returncode == 0, result.stderr
    assert calls == _expected_calls()


def test_runtime_verifier_never_starts_an_application_process(tmp_path: Path) -> None:
    result, calls = _run(tmp_path)

    assert result.returncode == 0, result.stderr
    run_calls = [call for call in calls if call[0] == "run"]
    assert all("--entrypoint" in call for call in run_calls)
    rendered = "\n".join(" ".join(call) for call in run_calls)
    assert "run-realtime-worker" not in rendered
    assert "run-pruner-loop" not in rendered
    assert "uvicorn" not in rendered
    assert "transit_ops" not in rendered


def test_runtime_verifier_propagates_failure_and_cleans_only_generated_tags(tmp_path: Path) -> None:
    result, calls = _run(tmp_path, fail_match="Dockerfile.health")

    assert result.returncode == 37
    assert calls == _expected_calls()[:4] + [_expected_calls()[-1]]
    assert calls[-1] == [
        "image",
        "rm",
        "--force",
        WORKER_TAG,
        HEALTH_TAG,
        POSTGRES_TAG,
    ]
    assert CADDY_IMAGE not in calls[-1]


def test_runtime_verifier_propagates_probe_failure_after_cleanup(tmp_path: Path) -> None:
    result, calls = _run(tmp_path, fail_match=f"python {WORKER_TAG}")

    assert result.returncode == 37
    assert calls == _expected_calls()[:6] + [_expected_calls()[-1]]


def test_runtime_verifier_propagates_cleanup_failure(tmp_path: Path) -> None:
    result, calls = _run(tmp_path, fail_match="image rm")

    assert result.returncode == 37
    assert calls == _expected_calls()


@pytest.mark.parametrize(("signal_name", "status"), [("INT", 130), ("TERM", 143)])
def test_runtime_verifier_preserves_signal_status_through_cleanup(
    tmp_path: Path, signal_name: str, status: int
) -> None:
    result, calls = _run(tmp_path, signal_match="Dockerfile.health", signal_name=signal_name)

    assert result.returncode == status
    assert calls == _expected_calls()[:4] + [_expected_calls()[-1]]


@pytest.mark.parametrize(
    ("bad_version_match", "label"),
    [
        (f"python {WORKER_TAG}", "Python"),
        (f"uv {WORKER_TAG}", "uv"),
        (f"postgres {POSTGRES_TAG}", "PostgreSQL"),
        (f"caddy {CADDY_IMAGE}", "Caddy"),
    ],
)
def test_runtime_verifier_rejects_versions_that_disagree_with_pins(
    tmp_path: Path, bad_version_match: str, label: str
) -> None:
    result, calls = _run(tmp_path, bad_version_match=bad_version_match)

    assert result.returncode != 0
    assert f"unexpected {label} version" in result.stderr
    assert calls[-1] == _expected_calls()[-1]


def test_runtime_verifier_rejects_an_older_supported_python_patch(tmp_path: Path) -> None:
    result, calls = _run(
        tmp_path,
        bad_version_match=f"python {WORKER_TAG}",
        bad_version_output="Python 3.12.13",
    )

    assert result.returncode != 0
    assert "unexpected Python version" in result.stderr
    assert calls[-1] == _expected_calls()[-1]


def test_runtime_verifier_rejects_an_invalid_tag_suffix_before_docker(tmp_path: Path) -> None:
    bin_dir, log = _fake_docker(tmp_path)
    env = os.environ.copy()
    env.update(
        {
            "PATH": f"{bin_dir}:{env['PATH']}",
            "FAKE_DOCKER_LOG": str(log),
            "TRANSIT_RUNTIME_VERIFY_TAG_SUFFIX": "bad/tag",
        }
    )

    result = subprocess.run(
        ["bash", str(SCRIPT)],
        cwd=DB_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode != 0
    assert "tag suffix" in result.stderr
    assert not log.exists()
