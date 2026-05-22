from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = REPO_ROOT / "scripts"


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
    _make_executable(
        bin_dir / "curl",
        "#!/usr/bin/env bash\n"
        "if [[ -n \"${FAKE_CURL_STDOUT:-}\" ]]; then\n"
        "  printf '%s' \"$FAKE_CURL_STDOUT\"\n"
        "fi\n"
        "if [[ -n \"${FAKE_CURL_STDERR:-}\" ]]; then\n"
        "  printf '%s' \"$FAKE_CURL_STDERR\" >&2\n"
        "fi\n"
        "exit \"${FAKE_CURL_EXIT_CODE:-0}\"\n",
    )

    env = os.environ.copy()
    env["PATH"] = f"{bin_dir}:{env['PATH']}"
    return env


def _run_shell(command: str, tmp_path: Path, **env_overrides: str) -> subprocess.CompletedProcess[str]:
    env = _stubbed_env(tmp_path)
    env.update(env_overrides)
    return subprocess.run(
        ["bash", "-lc", command],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def _run_script(script_name: str, tmp_path: Path, **env_overrides: str) -> subprocess.CompletedProcess[str]:
    env = _stubbed_env(tmp_path)
    env.update(env_overrides)
    return subprocess.run(
        ["bash", str(SCRIPTS_DIR / script_name)],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def _adapter_exports_snippet() -> str:
    return (
        'ADAPTER="$(database_compute_adapter_name | tr \'[:lower:]\' \'[:upper:]\')"; '
        'printf -v "${ADAPTER}_API_KEY" %s "test-key"; '
        'printf -v "${ADAPTER}_PROJECT_ID" %s "project-123"; '
        'printf -v "${ADAPTER}_ENDPOINT_ID" %s "endpoint-456"; '
        'export "${ADAPTER}_API_KEY" "${ADAPTER}_PROJECT_ID" "${ADAPTER}_ENDPOINT_ID"; '
    )


def test_database_compute_adapter_defaults_to_neon_and_exposes_contract(tmp_path: Path) -> None:
    result = _run_shell(
        "source scripts/lib/database-compute.sh && "
        "printf 'adapter=%s\\n' \"$(database_compute_adapter_name)\" && "
        "declare -F pause_database_compute >/dev/null && "
        "declare -F resume_database_compute >/dev/null",
        tmp_path,
    )

    assert result.returncode == 0, result.stderr
    assert "adapter=neon" in result.stdout


def test_database_compute_adapter_rejects_unsupported_adapters_cleanly(tmp_path: Path) -> None:
    result = _run_shell(
        "source scripts/lib/database-compute.sh",
        tmp_path,
        DATABASE_COMPUTE_ADAPTER="unsupported",
    )

    assert result.returncode != 0
    assert "Unsupported DATABASE_COMPUTE_ADAPTER: unsupported" in result.stderr


def test_pause_pipeline_delegates_to_adapter_without_provider_details_in_entrypoint(tmp_path: Path) -> None:
    result = _run_script("pause-pipeline.sh", tmp_path)

    assert result.returncode == 0, result.stderr
    assert "[3/3] Handing database compute to adapter 'neon'" in result.stdout
    assert "Database adapter credentials not set" in result.stdout
    assert "serviceInstanceSuspend" not in result.stdout


def test_resume_pipeline_delegates_to_adapter_without_provider_details_in_entrypoint(tmp_path: Path) -> None:
    result = _run_script("resume-pipeline.sh", tmp_path)

    assert result.returncode == 0, result.stderr
    assert "[3/3] Handing database compute to adapter 'neon'" in result.stdout
    assert "Database adapter credentials not set" in result.stdout
    assert "serviceInstanceRedeploy" not in result.stdout


def test_neon_pause_reports_registered_endpoint_when_status_check_succeeds(tmp_path: Path) -> None:
    result = _run_shell(
        "source scripts/lib/database-compute.sh && "
        f"{_adapter_exports_snippet()}"
        "pause_database_compute",
        tmp_path,
        FAKE_CURL_STDOUT='{"endpoints":[{"id":"endpoint-456"}]}',
    )

    assert result.returncode == 0, result.stderr
    assert "Database adapter endpoint endpoint-456 is registered" in result.stdout


def test_neon_pause_warns_when_endpoint_lookup_misses(tmp_path: Path) -> None:
    result = _run_shell(
        "source scripts/lib/database-compute.sh && "
        f"{_adapter_exports_snippet()}"
        "pause_database_compute",
        tmp_path,
        FAKE_CURL_STDOUT='{"endpoints":[{"id":"different-endpoint"}]}',
    )

    assert result.returncode == 0, result.stderr
    assert "WARNING: database adapter could not find endpoint endpoint-456" in result.stdout


def test_neon_resume_reports_restart_submission_when_api_call_succeeds(tmp_path: Path) -> None:
    result = _run_shell(
        "source scripts/lib/database-compute.sh && "
        f"{_adapter_exports_snippet()}"
        "resume_database_compute",
        tmp_path,
    )

    assert result.returncode == 0, result.stderr
    assert "Database adapter restart request submitted." in result.stdout


def test_neon_resume_warns_when_restart_api_call_fails(tmp_path: Path) -> None:
    result = _run_shell(
        "source scripts/lib/database-compute.sh && "
        f"{_adapter_exports_snippet()}"
        "resume_database_compute",
        tmp_path,
        FAKE_CURL_EXIT_CODE="22",
        FAKE_CURL_STDERR="boom",
    )

    assert result.returncode == 0, result.stderr
    assert "WARNING: database adapter restart failed: boom" in result.stdout
