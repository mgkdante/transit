from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]


def _read(path: str) -> str:
    return (REPO_ROOT / path).read_text(encoding="utf-8")


def _make_executable(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


def _stubbed_env(tmp_path: Path) -> dict[str, str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _make_executable(
        bin_dir / "gh",
        "#!/usr/bin/env bash\n"
        "printf 'gh %s\\n' \"$*\"\n",
    )
    _make_executable(
        bin_dir / "railway",
        "#!/usr/bin/env bash\n"
        "printf 'railway %s\\n' \"$*\"\n",
    )

    env = os.environ.copy()
    env["PATH"] = f"{bin_dir}:{env['PATH']}"
    return env


def _run_script(script_name: str, tmp_path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / script_name)],
        cwd=REPO_ROOT,
        env=_stubbed_env(tmp_path),
        capture_output=True,
        text=True,
        check=False,
    )


def test_database_compute_adapter_contract_keeps_provider_details_outside_generic_layer() -> None:
    adapter = _read("scripts/lib/database-compute.sh")
    implementation_files = sorted(
        path
        for path in (REPO_ROOT / "scripts" / "lib").glob("database-compute-*.sh")
        if path.name != "database-compute.sh"
    )

    assert "DATABASE_COMPUTE_ADAPTER" in adapter
    assert "database_compute_adapter_name" in adapter
    assert "pause_database_compute" in adapter
    assert "resume_database_compute" in adapter
    assert "database-compute-" in adapter
    assert "_API_KEY" not in adapter
    assert "curl" not in adapter

    assert implementation_files
    assert any("_API_KEY" in path.read_text(encoding="utf-8") for path in implementation_files)
    assert all("pause_database_compute" in path.read_text(encoding="utf-8") for path in implementation_files)
    assert all("resume_database_compute" in path.read_text(encoding="utf-8") for path in implementation_files)


def test_pause_pipeline_uses_generic_database_compute_contract(tmp_path: Path) -> None:
    script = _read("scripts/pause-pipeline.sh")

    assert "scripts/lib/database-compute.sh" in script
    assert "pause_database_compute" in script
    assert "database compute" in script.lower()
    assert "railway compute" not in script.lower()
    assert "neon compute" not in script.lower()
    assert "_API_KEY" not in script
    assert "serviceInstanceSuspend" not in script

    result = _run_script("pause-pipeline.sh", tmp_path)

    assert result.returncode == 0, result.stderr
    assert "database compute" in result.stdout.lower()
    assert "railway compute" not in result.stdout.lower()
    assert "neon compute" not in result.stdout.lower()


def test_resume_pipeline_uses_generic_database_compute_contract(tmp_path: Path) -> None:
    script = _read("scripts/resume-pipeline.sh")

    assert "scripts/lib/database-compute.sh" in script
    assert "resume_database_compute" in script
    assert "database compute" in script.lower()
    assert "railway compute" not in script.lower()
    assert "neon compute" not in script.lower()
    assert "_API_KEY" not in script
    assert "serviceInstanceRedeploy" not in script

    result = _run_script("resume-pipeline.sh", tmp_path)

    assert result.returncode == 0, result.stderr
    assert "database compute" in result.stdout.lower()
    assert "railway compute" not in result.stdout.lower()
    assert "neon compute" not in result.stdout.lower()
