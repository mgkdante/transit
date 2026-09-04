#!/usr/bin/env python3

from __future__ import annotations

import ipaddress
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import time
from collections.abc import Mapping, Sequence
from pathlib import Path
from types import FrameType
from urllib.parse import urlsplit

DATABASE_USER = "transit_ci"
DATABASE_NAME = "transit_ci"
DISPOSABLE_CONFIRMATION = "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE"
CLEANUP_FAILURE_STATUS = 90
IDENTITY_ATTEMPTS = 8
SIGNAL_GRACE_SECONDS = 1.0
KILL_GRACE_SECONDS = 1.0
HANDLED_SIGNALS = (signal.SIGHUP, signal.SIGINT, signal.SIGTERM)
SIGNAL_STATUSES = {
    signal.SIGHUP: 129,
    signal.SIGINT: 130,
    signal.SIGTERM: 143,
}
LIBPQ_TARGET_VARIABLES = (
    "PGHOST",
    "PGHOSTADDR",
    "PGPORT",
    "PGDATABASE",
    "PGUSER",
    "PGSERVICE",
    "PGSERVICEFILE",
)

SCRIPT_DIR = Path(__file__).resolve().parent
DB_ROOT = SCRIPT_DIR.parent
COMPOSE_FILE = DB_ROOT / "docker-compose.real-db.yml"


class HandledSignal(Exception):
    def __init__(self, signal_number: int) -> None:
        self.signal_number = signal_number
        super().__init__(signal_number)


def _message(text: str) -> None:
    print(f"real-db verification: {text}", file=sys.stderr)


def _cleanup_message(text: str) -> None:
    print(f"real-db cleanup failed: {text}", file=sys.stderr)


def _shell_status(returncode: int) -> int:
    return 128 + abs(returncode) if returncode < 0 else returncode


def _one_line(output: str) -> str | None:
    if output.endswith("\n"):
        output = output[:-1]
        if output.endswith("\r"):
            output = output[:-1]
    if not output or "\n" in output or "\r" in output:
        return None
    return output


def _local_docker_endpoint(endpoint: str) -> bool:
    if "\n" in endpoint or "\r" in endpoint:
        return False
    try:
        parsed = urlsplit(endpoint)
    except ValueError:
        return False
    if parsed.scheme == "unix":
        return (
            not parsed.netloc
            and parsed.path.startswith("/")
            and parsed.path != "/"
            and not parsed.query
            and not parsed.fragment
        )
    if parsed.scheme != "tcp":
        return False
    if (
        parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or parsed.query
        or parsed.fragment
    ):
        return False
    try:
        host = parsed.hostname
        port = parsed.port
        address = ipaddress.ip_address(host) if host is not None else None
    except ValueError:
        return False
    return (
        address is not None
        and address.is_loopback
        and port is not None
        and 1 <= port <= 65535
    )


def _process_group_members(group_id: int) -> list[int]:
    members: list[int] = []
    for stat_path in Path("/proc").glob("[0-9]*/stat"):
        try:
            stat = stat_path.read_text(encoding="utf-8")
            fields = stat[stat.rfind(")") + 2 :].split()
            state = fields[0]
            process_group = int(fields[2])
            if process_group == group_id and state != "Z":
                members.append(int(stat_path.parent.name))
        except (FileNotFoundError, IndexError, PermissionError, ValueError):
            continue
    return members


class Lifecycle:
    def __init__(self) -> None:
        self.environment = os.environ.copy()
        self.project_name = ""
        self.volume_name = ""
        self.compose_command: list[str] = []
        self.cleanup_needed = False
        self.active_process: subprocess.Popen[bytes] | None = None
        self.active_group: int | None = None
        self.launching = False
        self.pending_signal: int | None = None
        self.group_termination_failed = False

    def install_signal_handlers(self) -> None:
        for signal_number in HANDLED_SIGNALS:
            signal.signal(signal_number, self._handle_signal)

    def ignore_handled_signals(self) -> None:
        for signal_number in HANDLED_SIGNALS:
            signal.signal(signal_number, signal.SIG_IGN)

    def _handle_signal(
        self,
        signal_number: int,
        _frame: FrameType | None,
    ) -> None:
        if self.pending_signal is None:
            self.pending_signal = signal_number
        if not self.launching:
            raise HandledSignal(self.pending_signal)

    def _run(
        self,
        arguments: Sequence[str],
        *,
        capture_output: bool = False,
        discard_output: bool = False,
        stderr_to_stdout: bool = False,
        environment: Mapping[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str] | None:
        stdout: int | None = None
        stderr: int | None = None
        if capture_output:
            stdout = subprocess.PIPE
            stderr = subprocess.STDOUT if stderr_to_stdout else subprocess.DEVNULL
        elif discard_output:
            stdout = subprocess.DEVNULL
            stderr = subprocess.DEVNULL
        try:
            return subprocess.run(
                list(arguments),
                cwd=DB_ROOT,
                env=dict(environment or self.environment),
                text=True,
                stdout=stdout,
                stderr=stderr,
                check=False,
                close_fds=True,
            )
        except OSError:
            return None

    def _run_to_stderr(self, arguments: Sequence[str]) -> None:
        try:
            subprocess.run(
                list(arguments),
                cwd=DB_ROOT,
                env=self.environment,
                text=True,
                stdout=sys.stderr,
                stderr=sys.stderr,
                check=False,
                close_fds=True,
            )
        except OSError:
            pass

    def _run_tracked(
        self,
        arguments: Sequence[str],
        *,
        environment: Mapping[str, str] | None = None,
    ) -> int:
        self.launching = True
        try:
            process = subprocess.Popen(
                list(arguments),
                cwd=DB_ROOT,
                env=dict(environment or self.environment),
                start_new_session=True,
                close_fds=True,
            )
            self.active_process = process
            self.active_group = process.pid
        finally:
            self.launching = False
        if self.pending_signal is not None:
            raise HandledSignal(self.pending_signal)
        os.waitid(os.P_PID, process.pid, os.WEXITED | os.WNOWAIT)
        if _process_group_members(process.pid):
            self.terminate_active_group(signal.SIGTERM)
            return _shell_status(
                process.returncode if process.returncode is not None else 1
            )
        return self._reap_active_process(process)

    def _reap_active_process(self, process: subprocess.Popen[bytes]) -> int:
        previous_mask = signal.pthread_sigmask(signal.SIG_BLOCK, HANDLED_SIGNALS)
        try:
            returncode = process.wait()
            self.active_process = None
            self.active_group = None
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)
        return _shell_status(returncode)

    def _wait_for_group_exit(self, group_id: int, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        while True:
            if not _process_group_members(group_id):
                return True
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.02)

    def terminate_active_group(self, signal_number: int) -> None:
        process = self.active_process
        group_id = self.active_group
        if process is None or group_id is None:
            return
        try:
            os.killpg(group_id, signal_number)
        except ProcessLookupError:
            pass
        group_dead = self._wait_for_group_exit(group_id, SIGNAL_GRACE_SECONDS)
        if not group_dead:
            try:
                os.killpg(group_id, signal.SIGKILL)
            except ProcessLookupError:
                pass
            group_dead = self._wait_for_group_exit(group_id, KILL_GRACE_SECONDS)
        if not group_dead:
            self.group_termination_failed = True
            _cleanup_message("tracked command process group did not terminate.")
            return
        self._reap_active_process(process)

    def preflight(self) -> int:
        for dependency in ("docker", "uv"):
            if shutil.which(dependency, path=self.environment.get("PATH")) is None:
                _message(f"required command '{dependency}' was not found.")
                return 2
        compose_version = self._run(
            ["docker", "compose", "version"],
            discard_output=True,
        )
        if compose_version is None or compose_version.returncode != 0:
            _message("Docker Compose v2 is required.")
            return 2
        compose_help = self._run(
            ["docker", "compose", "up", "--help"],
            capture_output=True,
            stderr_to_stdout=True,
        )
        if (
            compose_help is None
            or compose_help.returncode != 0
            or re.search(r"(^|\s)--wait(?:[=\s]|$)", compose_help.stdout) is None
        ):
            _message("Docker Compose up must support --wait.")
            return 2
        endpoint_status = self._verify_local_docker_endpoint()
        if endpoint_status != 0:
            return endpoint_status
        architecture = self._run(
            ["docker", "info", "--format", "{{.Architecture}}"],
            capture_output=True,
        )
        if architecture is None or architecture.returncode != 0:
            _message("could not verify Docker daemon architecture.")
            return 2
        architecture_name = _one_line(architecture.stdout)
        if architecture_name not in {"amd64", "x86_64"}:
            _message("a local amd64 Docker daemon is required.")
            return 2
        return 0

    def _verify_local_docker_endpoint(self) -> int:
        context = self.environment.get("DOCKER_CONTEXT", "")
        docker_host = self.environment.get("DOCKER_HOST", "")
        if context:
            if any(character.isspace() for character in context):
                _message("could not resolve the selected Docker context.")
                return 2
        elif docker_host:
            if not _local_docker_endpoint(docker_host):
                _message("a local Docker daemon is required.")
                return 2
            return 0
        else:
            current_context = self._run(
                ["docker", "context", "show"],
                capture_output=True,
            )
            if current_context is None or current_context.returncode != 0:
                _message("could not resolve the current Docker context.")
                return 2
            context = _one_line(current_context.stdout) or ""
            if not context or any(character.isspace() for character in context):
                _message("could not resolve the current Docker context.")
                return 2
        inspected = self._run(
            [
                "docker",
                "context",
                "inspect",
                "--format",
                "{{.Endpoints.docker.Host}}",
                context,
            ],
            capture_output=True,
        )
        if inspected is None or inspected.returncode != 0:
            _message("could not resolve the selected Docker context.")
            return 2
        endpoint = _one_line(inspected.stdout)
        if endpoint is None:
            _message("could not resolve the Docker context endpoint.")
            return 2
        if not _local_docker_endpoint(endpoint):
            _message("a local Docker daemon is required.")
            return 2
        return 0

    def _query(self, arguments: Sequence[str]) -> tuple[int, list[str]]:
        result = self._run(arguments, capture_output=True)
        if result is None:
            return 127, []
        return result.returncode, [line for line in result.stdout.splitlines() if line]

    def select_resource_identity(self) -> int:
        for _attempt in range(IDENTITY_ATTEMPTS):
            suffix = secrets.token_hex(16)
            self.project_name = f"transit-real-db-{suffix}"
            self.volume_name = f"{self.project_name}-data"
            self.compose_command = [
                "docker",
                "compose",
                "--project-name",
                self.project_name,
                "--file",
                str(COMPOSE_FILE),
            ]
            self.environment["TRANSIT_REAL_DB_VOLUME"] = self.volume_name

            container_status, containers = self._query(
                [
                    "docker",
                    "ps",
                    "--all",
                    "--quiet",
                    "--filter",
                    f"label=com.docker.compose.project={self.project_name}",
                ]
            )
            if container_status != 0:
                _message("could not verify Compose project ownership.")
                return 2
            volume_status, volumes = self._query(
                [
                    "docker",
                    "volume",
                    "ls",
                    "--quiet",
                    "--filter",
                    f"name=^{self.volume_name}$",
                ]
            )
            if volume_status != 0:
                _message("could not verify volume ownership.")
                return 2
            network_label_status, networks_by_label = self._query(
                [
                    "docker",
                    "network",
                    "ls",
                    "--quiet",
                    "--filter",
                    f"label=com.docker.compose.project={self.project_name}",
                ]
            )
            if network_label_status != 0:
                _message("could not verify network ownership.")
                return 2
            network_name_status, networks_by_name = self._query(
                [
                    "docker",
                    "network",
                    "ls",
                    "--quiet",
                    "--filter",
                    f"name=^{self.project_name}_default$",
                ]
            )
            if network_name_status != 0:
                _message("could not verify network ownership.")
                return 2
            if not any(
                (containers, volumes, networks_by_label, networks_by_name)
            ):
                return 0
        _message("could not prove a collision-free Docker resource identity.")
        return 2

    def execute(self) -> int:
        preflight_status = self.preflight()
        if preflight_status != 0:
            return preflight_status
        identity_status = self.select_resource_identity()
        if identity_status != 0:
            return identity_status

        password = secrets.token_hex(32)
        self.environment["TRANSIT_REAL_DB_PASSWORD"] = password
        self.environment["PGPASSWORD"] = password
        self.cleanup_needed = True

        startup_status = self._run_tracked(
            [
                *self.compose_command,
                "up",
                "--detach",
                "--wait",
                "--wait-timeout",
                "120",
                "postgres",
            ]
        )
        if startup_status != 0:
            self._run_to_stderr(
                [
                    *self.compose_command,
                    "logs",
                    "--no-color",
                    "--tail",
                    "200",
                    "postgres",
                ]
            )
            _message("PostGIS startup failed.")
            return startup_status

        port_result = self._run(
            [*self.compose_command, "port", "postgres", "5432"],
            capture_output=True,
        )
        if port_result is None or port_result.returncode != 0:
            _message("could not discover the disposable database port.")
            return 1
        endpoint = _one_line(port_result.stdout)
        match = re.fullmatch(r"127\.0\.0\.1:([0-9]{1,5})", endpoint or "")
        if match is None or not 1 <= int(match.group(1)) <= 65535:
            _message("Docker Compose returned an invalid loopback port.")
            return 1

        database_url = (
            f"postgresql+psycopg://{DATABASE_USER}@127.0.0.1:"
            f"{match.group(1)}/{DATABASE_NAME}"
        )
        self.environment["DATABASE_URL"] = database_url
        self.environment["TRANSIT_TEST_DATABASE_URL"] = database_url
        self.environment["TRANSIT_TEST_DATABASE_DISPOSABLE"] = DISPOSABLE_CONFIRMATION
        for variable in LIBPQ_TARGET_VARIABLES:
            self.environment.pop(variable, None)

        alembic_status = self._run_tracked(
            ["uv", "run", "alembic", "upgrade", "head"]
        )
        if alembic_status != 0:
            return alembic_status
        pytest_environment = self.environment.copy()
        pytest_environment["COLUMNS"] = "200"
        return self._run_tracked(
            ["uv", "run", "pytest", "tests"],
            environment=pytest_environment,
        )

    def cleanup(self) -> bool:
        if not self.cleanup_needed:
            return not self.group_termination_failed
        cleanup_failed = self.group_termination_failed
        down = self._run([*self.compose_command, "down", "--volumes", "--remove-orphans"])
        if down is None or down.returncode != 0:
            _cleanup_message("Docker Compose teardown failed.")
            cleanup_failed = True

        container_status, containers = self._query(
            [
                "docker",
                "ps",
                "--all",
                "--quiet",
                "--filter",
                f"label=com.docker.compose.project={self.project_name}",
            ]
        )
        if container_status != 0:
            _cleanup_message("could not verify project container removal.")
            cleanup_failed = True
        elif containers:
            _cleanup_message("project container still exists.")
            cleanup_failed = True

        network_label_status, networks_by_label = self._query(
            [
                "docker",
                "network",
                "ls",
                "--quiet",
                "--filter",
                f"label=com.docker.compose.project={self.project_name}",
            ]
        )
        if network_label_status != 0:
            _cleanup_message("could not verify project network removal.")
            cleanup_failed = True
        network_name_status, networks_by_name = self._query(
            [
                "docker",
                "network",
                "ls",
                "--quiet",
                "--filter",
                f"name=^{self.project_name}_default$",
            ]
        )
        if network_name_status != 0:
            _cleanup_message("could not verify project network removal.")
            cleanup_failed = True
        if (
            network_label_status == 0
            and network_name_status == 0
            and (networks_by_label or networks_by_name)
        ):
            _cleanup_message("project network still exists.")
            cleanup_failed = True

        volume_status, volumes = self._query(
            [
                "docker",
                "volume",
                "ls",
                "--quiet",
                "--filter",
                f"name=^{self.volume_name}$",
            ]
        )
        if volume_status != 0:
            _cleanup_message("could not verify data volume removal.")
            cleanup_failed = True
        elif volumes:
            _cleanup_message("data volume still exists.")
            cleanup_failed = True
        return not cleanup_failed


def run() -> int:
    lifecycle = Lifecycle()
    primary_status = 1
    lifecycle.install_signal_handlers()
    try:
        primary_status = lifecycle.execute()
    except HandledSignal as caught:
        lifecycle.ignore_handled_signals()
        lifecycle.terminate_active_group(caught.signal_number)
        primary_status = SIGNAL_STATUSES.get(
            signal.Signals(caught.signal_number),
            128 + caught.signal_number,
        )
    except Exception:
        lifecycle.ignore_handled_signals()
        lifecycle.terminate_active_group(signal.SIGTERM)
        _message("unexpected lifecycle failure.")
        primary_status = 1
    finally:
        lifecycle.ignore_handled_signals()
        cleanup_succeeded = lifecycle.cleanup()
    return primary_status if cleanup_succeeded else CLEANUP_FAILURE_STATUS


if __name__ == "__main__":
    raise SystemExit(run())
