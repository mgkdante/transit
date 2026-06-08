from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pytest

from transit_ops.recovery import RECOVERY_ACTIONS, run_recovery_action

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_recovery_actions_include_mobile_operator_targets() -> None:
    assert set(RECOVERY_ACTIONS) == {
        "restart-worker",
        "restart-health",
        "restart-pipeline",
        "reboot-vm",
    }


def test_recovery_dry_run_returns_planned_command_without_executing_runner() -> None:
    called = False

    def runner(*args, **kwargs):  # noqa: ANN002, ANN003
        nonlocal called
        called = True
        raise AssertionError("dry-run must not execute commands")

    result = run_recovery_action("restart-worker", runner=runner)

    assert called is False
    assert result.display_dict()["action_id"] == "restart-worker"
    assert result.display_dict()["execute"] is False
    assert result.display_dict()["status"] == "planned"
    assert result.display_dict()["commands"] == [
        "docker compose --env-file .env -f docker-compose.yml restart worker"
    ]
    assert result.display_dict()["working_directory"] == str(REPO_ROOT)
    assert result.display_dict()["return_code"] is None
    assert result.display_dict()["stdout"] is None
    assert result.display_dict()["stderr"] is None


def test_recovery_execute_requires_exact_confirmation_before_running() -> None:
    called = False

    def runner(*args, **kwargs):  # noqa: ANN002, ANN003
        nonlocal called
        called = True
        raise AssertionError("confirmation should be checked first")

    with pytest.raises(ValueError, match="confirm restart-health"):
        run_recovery_action(
            "restart-health",
            execute=True,
            confirmation="restart-worker",
            runner=runner,
        )

    assert called is False


@dataclass(frozen=True)
class FakeCompletedProcess:
    returncode: int
    stdout: str
    stderr: str


def test_recovery_execute_captures_success() -> None:
    calls: list[tuple[list[str], bool, bool, bool, Path]] = []

    def runner(
        command: list[str],
        *,
        capture_output: bool,
        text: bool,
        check: bool,
        cwd: Path,
    ) -> FakeCompletedProcess:
        calls.append((command, capture_output, text, check, cwd))
        return FakeCompletedProcess(returncode=0, stdout="restarted\n", stderr="")

    result = run_recovery_action(
        "restart-health",
        execute=True,
        confirmation="restart-health",
        runner=runner,
    )

    assert calls == [
        (
            [
                "docker",
                "compose",
                "--env-file",
                ".env",
                "-f",
                "docker-compose.yml",
                "restart",
                "health",
            ],
            True,
            True,
            False,
            REPO_ROOT,
        )
    ]
    assert result.display_dict()["status"] == "executed"
    assert result.display_dict()["return_code"] == 0
    assert result.display_dict()["stdout"] == "restarted\n"
    assert result.display_dict()["stderr"] == ""


def test_recovery_execute_captures_failure() -> None:
    def runner(
        command: list[str],
        *,
        capture_output: bool,
        text: bool,
        check: bool,
        cwd: Path,
    ) -> FakeCompletedProcess:
        assert cwd == REPO_ROOT
        return FakeCompletedProcess(returncode=1, stdout="", stderr="unit missing\n")

    result = run_recovery_action(
        "restart-pipeline",
        execute=True,
        confirmation="restart-pipeline",
        runner=runner,
    )

    assert result.display_dict()["status"] == "failed"
    assert result.display_dict()["return_code"] == 1
    assert result.display_dict()["commands"] == ["bash scripts/resume-pipeline.sh"]
    assert result.display_dict()["stderr"] == "unit missing\n"


def test_recovery_execute_uses_repo_root_when_called_from_other_directory(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    calls: list[Path] = []

    def runner(
        command: list[str],
        *,
        capture_output: bool,
        text: bool,
        check: bool,
        cwd: Path,
    ) -> FakeCompletedProcess:
        calls.append(cwd)
        return FakeCompletedProcess(returncode=0, stdout="", stderr="")

    monkeypatch.chdir(tmp_path)

    run_recovery_action(
        "restart-worker",
        execute=True,
        confirmation="restart-worker",
        runner=runner,
    )

    assert calls == [REPO_ROOT]
