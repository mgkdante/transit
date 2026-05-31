from __future__ import annotations

import shlex
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, Protocol

RecoveryStatus = Literal["planned", "executed", "failed"]


class CompletedProcessLike(Protocol):
    returncode: int
    stdout: str
    stderr: str


Runner = Callable[..., CompletedProcessLike]


@dataclass(frozen=True)
class RecoveryActionSpec:
    action_id: str
    commands: tuple[str, ...]
    description: str


RECOVERY_ACTIONS: dict[str, RecoveryActionSpec] = {
    "restart-worker": RecoveryActionSpec(
        action_id="restart-worker",
        commands=("docker compose --env-file .env -f docker-compose.yml restart worker",),
        description="Restart the realtime worker container.",
    ),
    "restart-health": RecoveryActionSpec(
        action_id="restart-health",
        commands=("docker compose --env-file .env -f docker-compose.yml restart health",),
        description="Restart the health API container.",
    ),
    "restart-pipeline": RecoveryActionSpec(
        action_id="restart-pipeline",
        commands=("bash scripts/resume-pipeline.sh",),
        description="Bring schedules and worker process back to running.",
    ),
    "reboot-vm": RecoveryActionSpec(
        action_id="reboot-vm",
        commands=("sudo reboot",),
        description="Reboot the Oracle VM.",
    ),
}

RECOVERY_ACTION_IDS = tuple(RECOVERY_ACTIONS)


@dataclass(frozen=True)
class RecoveryActionResult:
    action_id: str
    execute: bool
    commands: tuple[str, ...]
    working_directory: Path
    status: RecoveryStatus
    return_code: int | None
    stdout: str | None
    stderr: str | None
    completed_at_utc: datetime

    def display_dict(self) -> dict[str, object]:
        return {
            "action_id": self.action_id,
            "execute": self.execute,
            "commands": list(self.commands),
            "working_directory": str(self.working_directory),
            "status": self.status,
            "return_code": self.return_code,
            "stdout": self.stdout,
            "stderr": self.stderr,
            "completed_at_utc": self.completed_at_utc.isoformat(),
        }


def run_recovery_action(
    action_id: str,
    *,
    execute: bool = False,
    confirmation: str | None = None,
    runner: Runner = subprocess.run,
    project_root: Path | None = None,
) -> RecoveryActionResult:
    spec = _get_action_spec(action_id)
    working_directory = project_root or _project_root()

    if not execute:
        return RecoveryActionResult(
            action_id=spec.action_id,
            execute=False,
            commands=spec.commands,
            working_directory=working_directory,
            status="planned",
            return_code=None,
            stdout=None,
            stderr=None,
            completed_at_utc=_utc_now(),
        )

    if confirmation != spec.action_id:
        raise ValueError(
            f"Executing {spec.action_id} requires --confirm {spec.action_id}."
        )

    stdout_parts: list[str] = []
    stderr_parts: list[str] = []
    last_return_code = 0

    for command in spec.commands:
        try:
            completed = runner(
                shlex.split(command),
                capture_output=True,
                text=True,
                check=False,
                cwd=working_directory,
            )
        except Exception as exc:  # noqa: BLE001
            return RecoveryActionResult(
                action_id=spec.action_id,
                execute=True,
                commands=spec.commands,
                working_directory=working_directory,
                status="failed",
                return_code=None,
                stdout="".join(stdout_parts),
                stderr="".join([*stderr_parts, str(exc)]),
                completed_at_utc=_utc_now(),
            )

        last_return_code = completed.returncode
        stdout_parts.append(completed.stdout)
        stderr_parts.append(completed.stderr)
        if completed.returncode != 0:
            break

    return RecoveryActionResult(
        action_id=spec.action_id,
        execute=True,
        commands=spec.commands,
        working_directory=working_directory,
        status="executed" if last_return_code == 0 else "failed",
        return_code=last_return_code,
        stdout="".join(stdout_parts),
        stderr="".join(stderr_parts),
        completed_at_utc=_utc_now(),
    )


def _get_action_spec(action_id: str) -> RecoveryActionSpec:
    try:
        return RECOVERY_ACTIONS[action_id]
    except KeyError as exc:
        choices = ", ".join(RECOVERY_ACTION_IDS)
        raise ValueError(f"Unknown recovery action {action_id!r}. Choices: {choices}.") from exc


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _utc_now() -> datetime:
    return datetime.now(UTC)
