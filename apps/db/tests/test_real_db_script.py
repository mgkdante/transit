import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest
import yaml

DB_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]
COMPOSE_PATH = DB_ROOT / "docker-compose.real-db.yml"
SCRIPT_PATH = DB_ROOT / "scripts/run-real-db-tests.sh"
PINNED_POSTGIS_IMAGE = (
    "postgis/postgis:16-3.4@"
    "sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5"
)

FAKE_PROGRAM = r'''
import hashlib
import json
import os
from pathlib import Path
import signal
import sys
import time


DEFAULT_COMPOSE_HELP = "Usage: docker compose up [OPTIONS] [SERVICE...]\n      --wait"
SCENARIO_BEHAVIORS = {
    "missing-compose": {"compose_version_status": 1},
    "missing-wait": {"compose_help": ""},
    "wait-timeout-only": {
        "compose_help": "Usage: docker compose up [OPTIONS]\n      --wait-timeout int"
    },
    "context-show-failure": {"context_show_status": 61},
    "empty-current-context": {"context_name": ""},
    "context-inspect-failure": {"context_inspect_status": 62},
    "daemon-info-failure": {"daemon_info_status": 65},
    "non-amd64-daemon": {"architecture": "arm64"},
    "container-query-failure": {
        "query_failures": {"precreation:container": 63}
    },
    "cleanup-container-query-failure": {
        "query_failures": {"cleanup:container": 66}
    },
    "volume-query-failure": {
        "query_failures": {"precreation:volume": 64}
    },
    "volume-list-failure": {
        "query_failures": {"cleanup:volume": 52}
    },
    "alembic-and-volume-list-failure": {
        "query_failures": {"cleanup:volume": 52},
        "alembic_status": 41,
    },
    "network-query-failure": {
        "query_failures": {
            "precreation:network-label": 67,
            "precreation:network-name": 67,
        }
    },
    "network-name-query-failure": {
        "query_failures": {"precreation:network-name": 67}
    },
    "cleanup-network-query-failure": {
        "query_failures": {
            "cleanup:network-label": 68,
            "cleanup:network-name": 68,
        }
    },
    "container-collision-once": {
        "collisions": {"container": ("once", "existing-container-id")}
    },
    "container-collision-exhaustion": {
        "collisions": {"container": ("always", "existing-container-id")}
    },
    "volume-collision-once": {
        "collisions": {"volume": ("once", "$volume")}
    },
    "volume-collision-exhaustion": {
        "collisions": {"volume": ("always", "$volume")}
    },
    "network-collision-once": {
        "collisions": {"network-label": ("once", "existing-network-id")}
    },
    "network-label-collision-once": {
        "collisions": {"network-label": ("once", "existing-labeled-network-id")}
    },
    "network-name-collision-once": {
        "collisions": {"network-name": ("once", "existing-named-network-id")}
    },
    "network-collision-exhaustion": {
        "collisions": {
            "network-label": ("always", "existing-network-id"),
            "network-name": ("always", "existing-network-id"),
        }
    },
    "cleanup-container-residual": {
        "cleanup_residue": {"container": "residual-container-id"}
    },
    "cleanup-network-residual": {
        "cleanup_residue": {
            "network-label": "residual-network-id",
            "network-name": "residual-network-id",
        }
    },
    "cleanup-network-label-residual": {
        "cleanup_residue": {"network-label": "residual-labeled-network-id"}
    },
    "cleanup-network-name-residual": {
        "cleanup_residue": {"network-name": "residual-named-network-id"}
    },
    "residual-volume": {"cleanup_residue": {"volume": "$volume"}},
    "signal-during-startup": {"startup_signal": True},
    "startup-failure": {"startup_status": 23},
    "empty-port": {"port_output": ""},
    "invalid-port": {"port_output": "127.0.0.1:70000"},
    "non-loopback-port": {"port_output": "0.0.0.0:55432"},
    "down-failure": {"down_status": 31},
    "signal-during-alembic": {"alembic_signal": True},
    "signal-ignoring-grandchild-during-alembic": {
        "alembic_signal": True,
        "ignoring_grandchild": True,
    },
    "alembic-failure": {"alembic_status": 41},
    "pytest-failure": {"pytest_status": 42},
}
scenario = os.environ.get("FAKE_SCENARIO", "success")
behavior = SCENARIO_BEHAVIORS.get(scenario, {})
tool = Path(sys.argv[0]).name
arguments = sys.argv[1:]
password = os.environ.get("PGPASSWORD", "")
transit_password = os.environ.get("TRANSIT_REAL_DB_PASSWORD", "")
event = {
    "tool": tool,
    "argv": arguments,
    "cwd": os.getcwd(),
    "password_set": bool(password),
    "passwords_match": bool(password) and password == transit_password,
    "password_fingerprint": hashlib.sha256(password.encode()).hexdigest() if password else "",
    "volume": os.environ.get("TRANSIT_REAL_DB_VOLUME"),
    "pid": os.getpid(),
    "pgid": os.getpgrp(),
}
if tool == "uv":
    event["environment"] = {
        key: os.environ.get(key)
        for key in (
            "DATABASE_URL",
            "TRANSIT_TEST_DATABASE_URL",
            "TRANSIT_TEST_DATABASE_DISPOSABLE",
            "COLUMNS",
            "PGHOST",
            "PGHOSTADDR",
            "PGPORT",
            "PGDATABASE",
            "PGUSER",
            "PGSERVICE",
            "PGSERVICEFILE",
        )
    }
def record(item):
    with Path(os.environ["FAKE_COMMAND_LOG"]).open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(item, sort_keys=True) + "\n")


def recorded_events():
    return [
        json.loads(line)
        for line in Path(os.environ["FAKE_COMMAND_LOG"]).read_text(
            encoding="utf-8"
        ).splitlines()
    ]


def query_surface(command_arguments):
    if command_arguments[:1] == ["ps"]:
        return "container"
    if command_arguments[:2] == ["volume", "ls"]:
        return "volume"
    if command_arguments[:2] != ["network", "ls"]:
        return None
    if any(
        str(argument).startswith("label=com.docker.compose.project=")
        for argument in command_arguments
    ):
        return "network-label"
    if any(str(argument).startswith("name=^") for argument in command_arguments):
        return "network-name"
    return None


def observed_identity(identity):
    return os.environ["TRANSIT_REAL_DB_VOLUME"] if identity == "$volume" else identity


def emit_query_behavior(surface):
    recorded = recorded_events()
    phase = (
        "cleanup"
        if any(
            item.get("tool") == "docker" and "down" in item.get("argv", [])
            for item in recorded
        )
        else "precreation"
    )
    failure_status = behavior.get("query_failures", {}).get(f"{phase}:{surface}")
    if failure_status is not None:
        raise SystemExit(failure_status)
    if phase == "precreation":
        collision = behavior.get("collisions", {}).get(surface)
        if collision is not None:
            frequency, identity = collision
            query_count = sum(
                1
                for item in recorded
                if item.get("tool") == "docker"
                and query_surface(item.get("argv", [])) == surface
            )
            if frequency == "always" or query_count == 1:
                print(observed_identity(identity))
    else:
        identity = behavior.get("cleanup_residue", {}).get(surface)
        if identity is not None:
            print(observed_identity(identity))
    raise SystemExit(0)


record(event)


def block_for_signal(label):
    sigint_handler = signal.getsignal(signal.SIGINT)
    sigint_disposition = (
        "ignored"
        if sigint_handler is signal.SIG_IGN
        else "default"
        if sigint_handler is signal.SIG_DFL
        else "handler"
    )
    if behavior.get("ignoring_grandchild", False):
        grandchild_pid = os.fork()
        if grandchild_pid == 0:
            for signum in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
                signal.signal(signum, signal.SIG_IGN)
            record({
                "tool": "grandchild-ready",
                "pid": os.getpid(),
                "pgid": os.getpgrp(),
            })
            time.sleep(60)
            raise SystemExit(0)
    record({
        "tool": f"{label}-ready",
        "pid": os.getpid(),
        "pgid": os.getpgrp(),
        "sigint_disposition": sigint_disposition,
    })
    time.sleep(60)

if tool == "docker":
    if arguments == ["compose", "version"]:
        raise SystemExit(behavior.get("compose_version_status", 0))
    if arguments == ["compose", "up", "--help"]:
        compose_help = behavior.get("compose_help", DEFAULT_COMPOSE_HELP)
        if compose_help:
            print(compose_help)
        raise SystemExit(0)
    if arguments == ["context", "show"]:
        context_show_status = behavior.get("context_show_status", 0)
        if context_show_status == 0:
            print(behavior.get("context_name", "default"))
        raise SystemExit(context_show_status)
    if arguments[:3] == ["context", "inspect", "--format"]:
        context_inspect_status = behavior.get("context_inspect_status", 0)
        if context_inspect_status == 0:
            print(os.environ.get("FAKE_CONTEXT_ENDPOINT", "unix:///var/run/docker.sock"))
        raise SystemExit(context_inspect_status)
    if arguments == ["info", "--format", "{{.Architecture}}"]:
        daemon_info_status = behavior.get("daemon_info_status", 0)
        if daemon_info_status == 0:
            print(behavior.get("architecture", "x86_64"))
        raise SystemExit(daemon_info_status)
    if arguments[:1] == ["ps"]:
        emit_query_behavior("container")
    if arguments[:2] == ["network", "ls"]:
        surface = query_surface(arguments)
        assert surface is not None
        emit_query_behavior(surface)
    if "up" in arguments and "--help" not in arguments:
        if behavior.get("startup_signal", False):
            block_for_signal("docker-up")
        raise SystemExit(behavior.get("startup_status", 0))
    if "logs" in arguments:
        print("bounded fake startup log")
        raise SystemExit(0)
    if "port" in arguments:
        print(behavior.get("port_output", "127.0.0.1:55432"))
        raise SystemExit(0)
    if "down" in arguments:
        raise SystemExit(behavior.get("down_status", 0))
    if arguments[:2] == ["volume", "ls"]:
        emit_query_behavior("volume")
    raise SystemExit(97)

if arguments == ["run", "alembic", "upgrade", "head"]:
    if behavior.get("alembic_signal", False):
        block_for_signal("uv")
    raise SystemExit(behavior.get("alembic_status", 0))
if arguments == ["run", "pytest", "tests"]:
    raise SystemExit(behavior.get("pytest_status", 0))
raise SystemExit(98)
'''

PYTHON_WRAPPER = r'''
import os
import signal
import sys


signal.signal(signal.SIGINT, signal.SIG_IGN)
os.execv(sys.executable, [sys.executable, *sys.argv[1:]])
'''


def _install_fakes(
    fake_bin: Path,
    *,
    include_docker: bool = True,
    include_uv: bool = True,
    include_python: bool = True,
) -> None:
    fake_bin.mkdir()
    tools = ["bash", "dirname"]
    for name in tools:
        source = shutil.which(name)
        assert source is not None
        (fake_bin / name).symlink_to(source)
    program = f"#!{sys.executable}\n{FAKE_PROGRAM}"
    for name, included in (("docker", include_docker), ("uv", include_uv)):
        if included:
            path = fake_bin / name
            path.write_text(program, encoding="utf-8")
            path.chmod(0o755)
    if include_python:
        python_path = fake_bin / "python3"
        python_path.write_text(f"#!{sys.executable}\n{PYTHON_WRAPPER}", encoding="utf-8")
        python_path.chmod(0o755)


def _script_environment(
    fake_bin: Path,
    log_path: Path,
    scenario: str = "success",
    environment_overrides: dict[str, str] | None = None,
) -> dict[str, str]:
    environment = os.environ.copy()
    environment.pop("DOCKER_CONTEXT", None)
    environment.pop("DOCKER_HOST", None)
    ambient_password = log_path.name
    environment.update(
        {
            "PATH": str(fake_bin),
            "FAKE_COMMAND_LOG": str(log_path),
            "FAKE_SCENARIO": scenario,
            "DATABASE_URL": "postgresql+psycopg://postgres@remote.example.invalid/production",
            "TRANSIT_TEST_DATABASE_URL": (
                "postgresql+psycopg://postgres@remote.example.invalid/production"
            ),
            "TRANSIT_TEST_DATABASE_DISPOSABLE": "wrong",
            "TRANSIT_REAL_DB_PASSWORD": ambient_password,
            "PGPASSWORD": ambient_password,
            "PGHOST": "remote.example.invalid",
            "PGHOSTADDR": "203.0.113.10",
            "PGPORT": "6543",
            "PGDATABASE": "production",
            "PGUSER": "postgres",
            "PGSERVICE": "production",
            "PGSERVICEFILE": "/tmp/production-pg-service.conf",
        }
    )
    if environment_overrides is not None:
        environment.update(environment_overrides)
    return environment


def _events(log_path: Path) -> list[dict[str, object]]:
    return [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]


def _assert_compose_prefixes(events: list[dict[str, object]]) -> None:
    for event in events:
        if event["tool"] != "docker":
            continue
        arguments = event["argv"]
        assert isinstance(arguments, list)
        if arguments in (["compose", "version"], ["compose", "up", "--help"]):
            continue
        if arguments[:1] != ["compose"]:
            continue
        project_name = arguments[2]
        assert isinstance(project_name, str)
        assert re.fullmatch(r"transit-real-db-[a-z0-9-]+", project_name)
        assert arguments[:5] == [
            "compose",
            "--project-name",
            project_name,
            "--file",
            str(COMPOSE_PATH),
        ]
        assert event["volume"] == f"{project_name}-data"


def _run_scenario(
    tmp_path: Path,
    scenario: str,
    *,
    include_docker: bool = True,
    include_uv: bool = True,
    include_python: bool = True,
    environment_overrides: dict[str, str] | None = None,
) -> tuple[subprocess.CompletedProcess[str], list[dict[str, object]]]:
    fake_bin = tmp_path / "bin"
    log_path = tmp_path / "commands.jsonl"
    _install_fakes(
        fake_bin,
        include_docker=include_docker,
        include_uv=include_uv,
        include_python=include_python,
    )
    result = subprocess.run(
        ["bash", str(SCRIPT_PATH)],
        cwd=REPO_ROOT,
        env=_script_environment(fake_bin, log_path, scenario, environment_overrides),
        text=True,
        capture_output=True,
        check=False,
    )
    events = _events(log_path) if log_path.exists() else []
    _assert_compose_prefixes(events)
    return result, events


def _operation(event: dict[str, object]) -> str:
    if "argv" not in event:
        return str(event["tool"])
    arguments = event["argv"]
    assert isinstance(arguments, list)
    if event["tool"] == "uv":
        return f"uv-{arguments[1]}"
    if arguments[:2] == ["compose", "version"]:
        return "compose-version"
    if arguments[:3] == ["compose", "up", "--help"]:
        return "compose-up-help"
    if arguments[:2] == ["context", "show"]:
        return "context-show"
    if arguments[:2] == ["context", "inspect"]:
        return "context-inspect"
    if arguments[:1] == ["info"]:
        return "daemon-info"
    if arguments[:1] == ["ps"]:
        return "container-list"
    if arguments[:2] == ["network", "ls"]:
        return "network-list"
    if arguments[:1] == ["volume"]:
        return "volume-list" if arguments[1] == "ls" else f"volume-{arguments[1]}"
    return next(
        operation
        for operation in ("up", "port", "logs", "down")
        if operation in arguments
    )


def test_compose_declares_only_disposable_postgis() -> None:
    document = yaml.safe_load(COMPOSE_PATH.read_text(encoding="utf-8"))

    assert set(document) == {"services", "volumes"}
    assert set(document["services"]) == {"postgres"}
    postgres = document["services"]["postgres"]
    assert postgres == {
        "image": PINNED_POSTGIS_IMAGE,
        "environment": {
            "POSTGRES_DB": "transit_ci",
            "POSTGRES_USER": "transit_ci",
            "POSTGRES_PASSWORD": (
                "${TRANSIT_REAL_DB_PASSWORD:?TRANSIT_REAL_DB_PASSWORD is required}"
            ),
        },
        "ports": ["127.0.0.1::5432"],
        "volumes": ["real_db_data:/var/lib/postgresql/data"],
        "healthcheck": {
            "test": ["CMD-SHELL", "pg_isready -U transit_ci -d transit_ci"],
            "interval": "10s",
            "timeout": "5s",
            "retries": 10,
        },
    }
    assert document["volumes"] == {
        "real_db_data": {
            "name": "${TRANSIT_REAL_DB_VOLUME:?TRANSIT_REAL_DB_VOLUME is required}"
        }
    }

    rendered = COMPOSE_PATH.read_text(encoding="utf-8")
    for forbidden in (
        "build:",
        "restart:",
        "depends_on:",
        "env_file:",
        "worker:",
        "pruner:",
        "health:",
        "caddy:",
        "transit-postgres-postgis",
    ):
        assert forbidden not in rendered


def test_script_owns_unique_happy_path_from_both_supported_directories(tmp_path: Path) -> None:
    fake_bin = tmp_path / "bin"
    log_path = tmp_path / "commands.jsonl"
    _install_fakes(fake_bin)
    environment = _script_environment(fake_bin, log_path)

    results = [
        subprocess.run(
            ["bash", str(SCRIPT_PATH)],
            cwd=cwd,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )
        for cwd in (REPO_ROOT, DB_ROOT)
    ]

    assert [result.returncode for result in results] == [0, 0]
    events = _events(log_path)
    _assert_compose_prefixes(events)
    operations = [_operation(event) for event in events]
    expected_run = [
        "compose-version",
        "compose-up-help",
        "context-show",
        "context-inspect",
        "daemon-info",
        "container-list",
        "volume-list",
        "network-list",
        "network-list",
        "up",
        "port",
        "uv-alembic",
        "uv-pytest",
        "down",
        "container-list",
        "network-list",
        "network-list",
        "volume-list",
    ]
    assert operations == expected_run * 2

    up_events = [event for event in events if _operation(event) == "up"]
    project_names: list[str] = []
    volume_names: list[str] = []
    password_fingerprints: list[str] = []
    for event in up_events:
        arguments = event["argv"]
        assert isinstance(arguments, list)
        assert arguments[-6:] == [
            "up",
            "--detach",
            "--wait",
            "--wait-timeout",
            "120",
            "postgres",
        ]
        project_name = arguments[arguments.index("--project-name") + 1]
        volume_name = event["volume"]
        fingerprint = event["password_fingerprint"]
        assert isinstance(project_name, str)
        assert isinstance(volume_name, str)
        assert isinstance(fingerprint, str)
        assert re.fullmatch(r"transit-real-db-[a-z0-9-]+", project_name)
        assert re.fullmatch(r"transit-real-db-[a-z0-9-]+-data", volume_name)
        assert event["password_set"] is True
        assert event["passwords_match"] is True
        project_names.append(project_name)
        volume_names.append(volume_name)
        password_fingerprints.append(fingerprint)

    assert len(set(project_names)) == 2
    assert len(set(volume_names)) == 2
    assert len(set(password_fingerprints)) == 2

    uv_events = [event for event in events if event["tool"] == "uv"]
    expected_url = "postgresql+psycopg://transit_ci@127.0.0.1:55432/transit_ci"
    for event in uv_events:
        assert event["cwd"] == str(DB_ROOT)
        assert event["pid"] == event["pgid"]
        assert event["password_set"] is True
        assert event["passwords_match"] is True
        environment_record = event["environment"]
        assert isinstance(environment_record, dict)
        columns = environment_record.pop("COLUMNS")
        if _operation(event) == "uv-pytest":
            assert columns == "200"
        expected_environment = {
            "DATABASE_URL": expected_url,
            "TRANSIT_TEST_DATABASE_URL": expected_url,
            "TRANSIT_TEST_DATABASE_DISPOSABLE": (
                "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE"
            ),
            "PGHOST": None,
            "PGHOSTADDR": None,
            "PGPORT": None,
            "PGDATABASE": None,
            "PGUSER": None,
            "PGSERVICE": None,
            "PGSERVICEFILE": None,
        }
        assert environment_record == expected_environment

    for event in events:
        arguments = event["argv"]
        assert isinstance(arguments, list)
        joined_arguments = " ".join(arguments)
        assert "docker-compose.yml" not in joined_arguments
        for forbidden_service in ("worker", "pruner", "health", "caddy"):
            assert forbidden_service not in arguments

    raw_log = log_path.read_text(encoding="utf-8")
    assert "TRANSIT_REAL_DB_PASSWORD" not in raw_log
    assert "PGPASSWORD" not in raw_log
    assert log_path.name not in raw_log
    for result in results:
        assert log_path.name not in result.stdout
        assert log_path.name not in result.stderr


def test_script_refuses_missing_docker_before_creating_resources(tmp_path: Path) -> None:
    result, events = _run_scenario(tmp_path, "success", include_docker=False)

    assert result.returncode == 2
    assert "required command 'docker' was not found" in result.stderr
    assert events == []


@pytest.mark.parametrize(
    ("scenario", "expected_message", "expected_operations"),
    [
        ("missing-compose", "Docker Compose v2 is required", ["compose-version"]),
        (
            "missing-wait",
            "Docker Compose up must support --wait",
            ["compose-version", "compose-up-help"],
        ),
        (
            "wait-timeout-only",
            "Docker Compose up must support --wait",
            ["compose-version", "compose-up-help"],
        ),
    ],
)
def test_script_refuses_incomplete_compose_before_creating_resources(
    tmp_path: Path,
    scenario: str,
    expected_message: str,
    expected_operations: list[str],
) -> None:
    result, events = _run_scenario(tmp_path, scenario)

    assert result.returncode == 2
    assert expected_message in result.stderr
    assert [_operation(event) for event in events] == expected_operations


def test_script_refuses_missing_uv_before_creating_resources(tmp_path: Path) -> None:
    result, events = _run_scenario(tmp_path, "success", include_uv=False)

    assert result.returncode == 2
    assert "required command 'uv' was not found" in result.stderr
    assert events == []


def test_script_refuses_missing_python_before_creating_resources(tmp_path: Path) -> None:
    result, events = _run_scenario(tmp_path, "success", include_python=False)

    assert result.returncode == 127
    assert "python3" in result.stderr
    assert "not found" in result.stderr
    assert events == []


@pytest.mark.parametrize(
    ("environment_overrides", "scenario", "secret", "expected_context_operations"),
    [
        (
            {"DOCKER_HOST": "tcp://daemon-user:host-secret@198.51.100.8:2376"},
            "success",
            "host-secret",
            [],
        ),
        (
            {
                "DOCKER_CONTEXT": "remote-secure",
                "FAKE_CONTEXT_ENDPOINT": "ssh://daemon-user:context-secret@remote.invalid",
            },
            "success",
            "context-secret",
            ["context-inspect"],
        ),
    ],
)
def test_script_refuses_remote_docker_endpoint_before_resource_access(
    tmp_path: Path,
    environment_overrides: dict[str, str],
    scenario: str,
    secret: str,
    expected_context_operations: list[str],
) -> None:
    result, events = _run_scenario(
        tmp_path,
        scenario,
        environment_overrides=environment_overrides,
    )

    assert result.returncode == 2
    assert "local Docker daemon is required" in result.stderr
    assert secret not in result.stdout
    assert secret not in result.stderr
    assert secret not in json.dumps(events)
    operations = [_operation(event) for event in events]
    assert operations == [
        "compose-version",
        "compose-up-help",
        *expected_context_operations,
    ]


@pytest.mark.parametrize(
    "environment_overrides",
    [
        {"DOCKER_HOST": "unix:///run/user/1000/docker.sock"},
        {"DOCKER_HOST": "tcp://127.0.0.1:2375"},
        {"DOCKER_HOST": "tcp://[::1]:2375"},
        {
            "DOCKER_CONTEXT": "local-context",
            "DOCKER_HOST": "tcp://198.51.100.8:2376",
            "FAKE_CONTEXT_ENDPOINT": "unix:///var/run/docker.sock",
        },
    ],
)
def test_script_preserves_local_docker_endpoints(
    tmp_path: Path, environment_overrides: dict[str, str]
) -> None:
    result, events = _run_scenario(
        tmp_path,
        "success",
        environment_overrides=environment_overrides,
    )

    assert result.returncode == 0
    assert "local Docker daemon is required" not in result.stderr
    assert "up" in [_operation(event) for event in events]


def test_script_rejects_zero_port_local_docker_endpoint(tmp_path: Path) -> None:
    result, events = _run_scenario(
        tmp_path,
        "success",
        environment_overrides={"DOCKER_HOST": "tcp://127.0.0.1:0"},
    )

    assert result.returncode == 2
    assert "local Docker daemon is required" in result.stderr
    assert [_operation(event) for event in events] == [
        "compose-version",
        "compose-up-help",
    ]


@pytest.mark.parametrize(
    ("scenario", "environment_overrides", "expected_context_operations"),
    [
        ("context-show-failure", {}, ["context-show"]),
        ("empty-current-context", {}, ["context-show"]),
        ("context-inspect-failure", {}, ["context-show", "context-inspect"]),
        (
            "success",
            {"DOCKER_CONTEXT": "empty-endpoint", "FAKE_CONTEXT_ENDPOINT": ""},
            ["context-inspect"],
        ),
        (
            "success",
            {"DOCKER_CONTEXT": "bad\ncontext"},
            [],
        ),
    ],
)
def test_script_fails_closed_for_unresolvable_or_malformed_context(
    tmp_path: Path,
    scenario: str,
    environment_overrides: dict[str, str],
    expected_context_operations: list[str],
) -> None:
    result, events = _run_scenario(
        tmp_path,
        scenario,
        environment_overrides=environment_overrides,
    )

    assert result.returncode == 2
    assert "Docker context" in result.stderr
    assert [_operation(event) for event in events] == [
        "compose-version",
        "compose-up-help",
        *expected_context_operations,
    ]


@pytest.mark.parametrize(
    ("scenario", "collision_operation"),
    [
        ("container-collision-once", "container-list"),
        ("volume-collision-once", "volume-list"),
        ("network-collision-once", "network-list"),
        ("network-label-collision-once", "network-list"),
        ("network-name-collision-once", "network-list"),
    ],
)
def test_script_regenerates_identity_after_owned_resource_collision(
    tmp_path: Path, scenario: str, collision_operation: str
) -> None:
    result, events = _run_scenario(tmp_path, scenario)

    assert result.returncode == 0
    up_event = next(event for event in events if _operation(event) == "up")
    up_arguments = up_event["argv"]
    assert isinstance(up_arguments, list)
    selected_project = up_arguments[up_arguments.index("--project-name") + 1]
    assert isinstance(selected_project, str)
    assert re.fullmatch(r"transit-real-db-[0-9a-f]{32}", selected_project)
    collision_events = [
        event for event in events if _operation(event) == collision_operation
    ]
    collided_project = str(collision_events[0]["volume"])[: -len("-data")]
    assert selected_project != collided_project
    up_index = events.index(up_event)
    ownership_projects = {
        str(event["volume"])[: -len("-data")]
        for event in events[:up_index]
        if _operation(event) == "container-list"
    }
    assert len(ownership_projects) == 2
    for event in events:
        arguments = event["argv"]
        assert isinstance(arguments, list)
        if _operation(event) == "container-list":
            candidate = str(event["volume"])[: -len("-data")]
            assert arguments == [
                "ps",
                "--all",
                "--quiet",
                "--filter",
                f"label=com.docker.compose.project={candidate}",
            ]
        elif _operation(event) == "volume-list":
            assert arguments == [
                "volume",
                "ls",
                "--quiet",
                "--filter",
                f"name=^{event['volume']}$",
            ]
        elif _operation(event) == "network-list":
            candidate = str(event["volume"])[: -len("-data")]
            assert arguments in (
                [
                    "network",
                    "ls",
                    "--quiet",
                    "--filter",
                    f"label=com.docker.compose.project={candidate}",
                ],
                [
                    "network",
                    "ls",
                    "--quiet",
                    "--filter",
                    f"name=^{candidate}_default$",
                ],
            )
    down_event = next(event for event in events if _operation(event) == "down")
    assert collided_project not in down_event["argv"]


@pytest.mark.parametrize(
    "scenario",
    [
        "container-collision-exhaustion",
        "volume-collision-exhaustion",
        "network-collision-exhaustion",
    ],
)
def test_script_fails_before_creation_when_identity_collisions_are_exhausted(
    tmp_path: Path, scenario: str
) -> None:
    result, events = _run_scenario(tmp_path, scenario)

    assert result.returncode == 2
    assert "collision-free Docker resource identity" in result.stderr
    operations = [_operation(event) for event in events]
    assert operations.count("container-list") == 8
    assert operations.count("volume-list") == 8
    assert operations.count("network-list") == 16
    assert "up" not in operations
    assert "down" not in operations


@pytest.mark.parametrize(
    ("scenario", "expected_message"),
    [
        ("container-query-failure", "could not verify Compose project ownership"),
        ("volume-query-failure", "could not verify volume ownership"),
        ("network-query-failure", "could not verify network ownership"),
        ("network-name-query-failure", "could not verify network ownership"),
    ],
)
def test_script_fails_closed_when_identity_query_fails(
    tmp_path: Path, scenario: str, expected_message: str
) -> None:
    result, events = _run_scenario(tmp_path, scenario)

    assert result.returncode == 2
    assert expected_message in result.stderr
    operations = [_operation(event) for event in events]
    assert operations[-4:] == [
        "container-list",
        "volume-list",
        "network-list",
        "network-list",
    ]
    assert "up" not in operations
    assert "down" not in operations


@pytest.mark.parametrize(
    ("scenario", "expected_message"),
    [
        ("non-amd64-daemon", "local amd64 Docker daemon is required"),
        ("daemon-info-failure", "could not verify Docker daemon architecture"),
    ],
)
def test_script_refuses_unverified_or_non_amd64_daemon_before_resource_access(
    tmp_path: Path, scenario: str, expected_message: str
) -> None:
    result, events = _run_scenario(tmp_path, scenario)

    assert result.returncode == 2
    assert expected_message in result.stderr
    operations = [_operation(event) for event in events]
    assert operations[-1] == "daemon-info"
    assert "container-list" not in operations
    assert "volume-list" not in operations
    assert "up" not in operations


@pytest.mark.parametrize("scenario", ["empty-port", "invalid-port", "non-loopback-port"])
def test_script_rejects_invalid_port_and_cleans_up(tmp_path: Path, scenario: str) -> None:
    result, events = _run_scenario(tmp_path, scenario)

    assert result.returncode != 0
    assert "invalid loopback port" in result.stderr
    assert [_operation(event) for event in events] == [
        "compose-version",
        "compose-up-help",
        "context-show",
        "context-inspect",
        "daemon-info",
        "container-list",
        "volume-list",
        "network-list",
        "network-list",
        "up",
        "port",
        "down",
        "container-list",
        "network-list",
        "network-list",
        "volume-list",
    ]
    assert all(event["tool"] != "uv" for event in events)


def test_script_reports_startup_logs_then_cleans_up_without_uv(tmp_path: Path) -> None:
    result, events = _run_scenario(tmp_path, "startup-failure")

    assert result.returncode == 23
    assert "bounded fake startup log" in result.stderr
    assert "PostGIS startup failed" in result.stderr
    assert [_operation(event) for event in events] == [
        "compose-version",
        "compose-up-help",
        "context-show",
        "context-inspect",
        "daemon-info",
        "container-list",
        "volume-list",
        "network-list",
        "network-list",
        "up",
        "logs",
        "down",
        "container-list",
        "network-list",
        "network-list",
        "volume-list",
    ]
    log_event = next(event for event in events if _operation(event) == "logs")
    assert log_event["argv"][-5:] == ["logs", "--no-color", "--tail", "200", "postgres"]
    assert all(event["tool"] != "uv" for event in events)


def test_script_preserves_alembic_failure_and_skips_pytest(tmp_path: Path) -> None:
    result, events = _run_scenario(tmp_path, "alembic-failure")

    assert result.returncode == 41
    assert [_operation(event) for event in events][-6:] == [
        "uv-alembic",
        "down",
        "container-list",
        "network-list",
        "network-list",
        "volume-list",
    ]
    assert "uv-pytest" not in [_operation(event) for event in events]


def test_script_preserves_pytest_failure_and_cleans_up(tmp_path: Path) -> None:
    result, events = _run_scenario(tmp_path, "pytest-failure")

    assert result.returncode == 42
    assert [_operation(event) for event in events][-7:] == [
        "uv-alembic",
        "uv-pytest",
        "down",
        "container-list",
        "network-list",
        "network-list",
        "volume-list",
    ]


def _wait_for_event(log_path: Path, tool: str) -> dict[str, object]:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if log_path.exists():
            for event in _events(log_path):
                if event["tool"] == tool:
                    return event
        time.sleep(0.02)
    pytest.fail(f"fake command did not publish {tool}")


def _live_process_group_members(group_id: int) -> list[int]:
    members: list[int] = []
    for stat_path in Path("/proc").glob("[0-9]*/stat"):
        try:
            stat = stat_path.read_text(encoding="utf-8")
            fields = stat[stat.rfind(")") + 2 :].split()
            if fields[0] != "Z" and int(fields[2]) == group_id:
                members.append(int(stat_path.parent.name))
        except (FileNotFoundError, IndexError, PermissionError, ValueError):
            continue
    return members


def _process_is_live(process_id: int) -> bool:
    try:
        stat = Path(f"/proc/{process_id}/stat").read_text(encoding="utf-8")
    except (FileNotFoundError, PermissionError):
        return False
    return stat[stat.rfind(")") + 2 :].split()[0] != "Z"


def _process_state(process_id: int) -> str | None:
    try:
        stat = Path(f"/proc/{process_id}/stat").read_text(encoding="utf-8")
    except (FileNotFoundError, PermissionError):
        return None
    return stat[stat.rfind(")") + 2 :].split()[0]


def _process_fd_targets(process_id: int) -> set[str]:
    targets: set[str] = set()
    for fd_path in Path(f"/proc/{process_id}/fd").iterdir():
        try:
            targets.add(os.readlink(fd_path))
        except FileNotFoundError:
            continue
    return targets


def _run_wrapper_signal_case(
    tmp_path: Path,
    *,
    scenario: str,
    ready_tool: str,
    signal_number: signal.Signals,
    expected_status: int,
    expected_operation_tail: list[str],
) -> tuple[list[dict[str, object]], int, str]:
    fake_bin = tmp_path / "bin"
    log_path = tmp_path / "commands.jsonl"
    _install_fakes(fake_bin)
    process = subprocess.Popen(
        ["bash", str(SCRIPT_PATH)],
        cwd=REPO_ROOT,
        env=_script_environment(fake_bin, log_path, scenario),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    ready_event = _wait_for_event(log_path, ready_tool)
    child_pid = ready_event["pid"]
    group_id = ready_event["pgid"]
    assert isinstance(child_pid, int)
    assert isinstance(group_id, int)
    started = time.monotonic()
    os.kill(process.pid, signal_number)
    try:
        _, stderr = process.communicate(timeout=3)
    except subprocess.TimeoutExpired:
        for member_pid in {*_live_process_group_members(group_id), child_pid}:
            try:
                os.kill(member_pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        process.kill()
        process.communicate(timeout=3)
        pytest.fail("wrapper did not promptly forward the signal and exit")
    events = _events(log_path)
    _assert_compose_prefixes(events)

    assert time.monotonic() - started < 3
    assert process.returncode == expected_status
    operations = [
        _operation(event)
        for event in events
        if not str(event["tool"]).endswith("-ready")
    ]
    assert operations[-len(expected_operation_tail) :] == expected_operation_tail
    assert "uv-pytest" not in operations
    assert "cleanup failed" not in stderr
    deadline = time.monotonic() + 1
    while time.monotonic() < deadline and _live_process_group_members(group_id):
        time.sleep(0.02)
    assert _live_process_group_members(group_id) == []
    return events, group_id, stderr


@pytest.mark.parametrize(
    ("stage", "scenario", "ready_tool", "expected_operation_tail"),
    [
        (
            "startup",
            "signal-during-startup",
            "docker-up-ready",
            [
                "up",
                "down",
                "container-list",
                "network-list",
                "network-list",
                "volume-list",
            ],
        ),
        (
            "alembic",
            "signal-during-alembic",
            "uv-ready",
            [
                "up",
                "port",
                "uv-alembic",
                "down",
                "container-list",
                "network-list",
                "network-list",
                "volume-list",
            ],
        ),
    ],
)
@pytest.mark.parametrize(
    ("signal_number", "expected_status"),
    [
        (signal.SIGHUP, 129),
        (signal.SIGINT, 130),
        (signal.SIGTERM, 143),
    ],
)
def test_script_forwards_wrapper_signal_to_each_tracked_stage_and_cleans_up(
    tmp_path: Path,
    stage: str,
    scenario: str,
    ready_tool: str,
    expected_operation_tail: list[str],
    signal_number: signal.Signals,
    expected_status: int,
) -> None:
    events, child_pid, _ = _run_wrapper_signal_case(
        tmp_path,
        scenario=scenario,
        ready_tool=ready_tool,
        signal_number=signal_number,
        expected_status=expected_status,
        expected_operation_tail=expected_operation_tail,
    )
    ready_event = next(event for event in events if event["tool"] == ready_tool)
    assert ready_event == {
        "tool": ready_tool,
        "pid": child_pid,
        "pgid": child_pid,
        "sigint_disposition": "handler",
    }, stage


@pytest.mark.parametrize(
    ("scenario", "ready_tool"),
    [
        ("signal-during-startup", "docker-up-ready"),
        ("signal-during-alembic", "uv-ready"),
    ],
)
def test_tracked_stage_does_not_inherit_an_unrelated_parent_descriptor(
    tmp_path: Path,
    scenario: str,
    ready_tool: str,
) -> None:
    fake_bin = tmp_path / "bin"
    log_path = tmp_path / "commands.jsonl"
    _install_fakes(fake_bin)
    read_fd, write_fd = os.pipe()
    sentinel_target = os.readlink(f"/proc/self/fd/{write_fd}")
    process = subprocess.Popen(
        ["bash", str(SCRIPT_PATH)],
        cwd=REPO_ROOT,
        env=_script_environment(fake_bin, log_path, scenario),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        pass_fds=(write_fd,),
    )
    os.close(write_fd)
    try:
        ready_event = _wait_for_event(log_path, ready_tool)
        child_pid = ready_event["pid"]
        assert isinstance(child_pid, int)
        child_fd_targets = _process_fd_targets(child_pid)
        os.kill(process.pid, signal.SIGTERM)
        _, stderr = process.communicate(timeout=3)
    finally:
        os.close(read_fd)
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=3)

    assert process.returncode == 143, stderr
    assert sentinel_target not in child_fd_targets


def test_group_leader_remains_unreaped_until_escalation_finishes(
    tmp_path: Path,
) -> None:
    fake_bin = tmp_path / "bin"
    log_path = tmp_path / "commands.jsonl"
    _install_fakes(fake_bin)
    process = subprocess.Popen(
        ["bash", str(SCRIPT_PATH)],
        cwd=REPO_ROOT,
        env=_script_environment(
            fake_bin,
            log_path,
            "signal-ignoring-grandchild-during-alembic",
        ),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    leader_event = _wait_for_event(log_path, "uv-ready")
    grandchild_event = _wait_for_event(log_path, "grandchild-ready")
    leader_pid = leader_event["pid"]
    grandchild_pid = grandchild_event["pid"]
    assert isinstance(leader_pid, int)
    assert isinstance(grandchild_pid, int)

    os.kill(process.pid, signal.SIGTERM)
    deadline = time.monotonic() + 0.7
    leader_state = _process_state(leader_pid)
    while leader_state not in {None, "Z"} and time.monotonic() < deadline:
        time.sleep(0.01)
        leader_state = _process_state(leader_pid)
    grandchild_was_live_during_grace = _process_is_live(grandchild_pid)
    try:
        _, stderr = process.communicate(timeout=3)
    except subprocess.TimeoutExpired:
        for member_pid in _live_process_group_members(int(leader_event["pgid"])):
            os.kill(member_pid, signal.SIGKILL)
        process.kill()
        process.communicate(timeout=3)
        pytest.fail("wrapper did not finish bounded group escalation")

    assert leader_state == "Z"
    assert grandchild_was_live_during_grace is True
    assert process.returncode == 143, stderr
    assert _live_process_group_members(int(leader_event["pgid"])) == []


def test_script_kills_signal_ignoring_grandchild_before_cleanup(tmp_path: Path) -> None:
    events, child_pid, _ = _run_wrapper_signal_case(
        tmp_path,
        scenario="signal-ignoring-grandchild-during-alembic",
        ready_tool="grandchild-ready",
        signal_number=signal.SIGTERM,
        expected_status=143,
        expected_operation_tail=[
            "up",
            "port",
            "uv-alembic",
            "down",
            "container-list",
            "network-list",
            "network-list",
            "volume-list",
        ],
    )

    grandchild = next(event for event in events if event["tool"] == "grandchild-ready")
    assert grandchild["pgid"] == child_pid
    assert grandchild["pid"] != child_pid


@pytest.mark.parametrize(
    ("scenario", "expected_message"),
    [
        ("down-failure", "Docker Compose teardown failed"),
        ("residual-volume", "data volume still exists"),
    ],
)
def test_script_cleanup_defects_override_success(
    tmp_path: Path, scenario: str, expected_message: str
) -> None:
    result, events = _run_scenario(tmp_path, scenario)

    assert result.returncode == 90
    assert expected_message in result.stderr
    assert [_operation(event) for event in events][-5:] == [
        "down",
        "container-list",
        "network-list",
        "network-list",
        "volume-list",
    ]


@pytest.mark.parametrize(
    ("scenario", "expected_message"),
    [
        ("cleanup-container-residual", "project container still exists"),
        ("cleanup-network-residual", "project network still exists"),
        ("cleanup-network-label-residual", "project network still exists"),
        ("cleanup-network-name-residual", "project network still exists"),
        (
            "cleanup-container-query-failure",
            "could not verify project container removal",
        ),
        ("cleanup-network-query-failure", "could not verify project network removal"),
    ],
)
def test_script_fails_closed_for_container_or_network_cleanup_defect(
    tmp_path: Path, scenario: str, expected_message: str
) -> None:
    result, events = _run_scenario(tmp_path, scenario)

    assert result.returncode == 90
    assert expected_message in result.stderr
    assert [_operation(event) for event in events][-5:] == [
        "down",
        "container-list",
        "network-list",
        "network-list",
        "volume-list",
    ]


def test_script_fails_closed_when_volume_absence_query_fails(tmp_path: Path) -> None:
    result, events = _run_scenario(tmp_path, "volume-list-failure")

    assert result.returncode == 90
    assert "could not verify data volume removal" in result.stderr
    assert [_operation(event) for event in events][-5:] == [
        "down",
        "container-list",
        "network-list",
        "network-list",
        "volume-list",
    ]
    volume_event = events[-1]
    assert volume_event["argv"] == [
        "volume",
        "ls",
        "--quiet",
        "--filter",
        f"name=^{volume_event['volume']}$",
    ]


def test_volume_query_failure_overrides_primary_failure(tmp_path: Path) -> None:
    result, events = _run_scenario(tmp_path, "alembic-and-volume-list-failure")

    assert result.returncode == 90
    assert "could not verify data volume removal" in result.stderr
    assert [_operation(event) for event in events][-6:] == [
        "uv-alembic",
        "down",
        "container-list",
        "network-list",
        "network-list",
        "volume-list",
    ]
