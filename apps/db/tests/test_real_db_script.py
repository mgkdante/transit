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


record(event)


def block_for_signal(label):
    def handle_signal(signum, _frame):
        record({
            "tool": f"{label}-signal",
            "signal": signum,
            "pid": os.getpid(),
            "pgid": os.getpgrp(),
        })
        raise SystemExit(128 + signum)

    for signum in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, handle_signal)
    record({
        "tool": f"{label}-ready",
        "pid": os.getpid(),
        "pgid": os.getpgrp(),
    })
    time.sleep(60)


scenario = os.environ.get("FAKE_SCENARIO", "success")
if tool == "docker":
    if arguments == ["compose", "version"]:
        raise SystemExit(0 if scenario != "missing-compose" else 1)
    if arguments == ["compose", "up", "--help"]:
        if scenario == "wait-timeout-only":
            print("Usage: docker compose up [OPTIONS]\n      --wait-timeout int")
        elif scenario != "missing-wait":
            print("Usage: docker compose up [OPTIONS] [SERVICE...]\n      --wait")
        raise SystemExit(0)
    if "up" in arguments and "--help" not in arguments:
        if scenario == "signal-during-startup":
            block_for_signal("docker-up")
        raise SystemExit(23 if scenario == "startup-failure" else 0)
    if "logs" in arguments:
        print("bounded fake startup log")
        raise SystemExit(0)
    if "port" in arguments:
        outputs = {
            "empty-port": "",
            "invalid-port": "127.0.0.1:70000",
            "non-loopback-port": "0.0.0.0:55432",
        }
        print(outputs.get(scenario, "127.0.0.1:55432"))
        raise SystemExit(0)
    if "down" in arguments:
        raise SystemExit(31 if scenario == "down-failure" else 0)
    if arguments[:2] == ["volume", "ls"]:
        if scenario in ("volume-list-failure", "alembic-and-volume-list-failure"):
            raise SystemExit(52)
        if scenario == "residual-volume":
            print(os.environ["TRANSIT_REAL_DB_VOLUME"])
        raise SystemExit(0)
    raise SystemExit(97)

if arguments == ["run", "alembic", "upgrade", "head"]:
    if scenario == "signal-during-alembic":
        block_for_signal("uv")
    raise SystemExit(
        41 if scenario in ("alembic-failure", "alembic-and-volume-list-failure") else 0
    )
if arguments == ["run", "pytest", "tests"]:
    raise SystemExit(42 if scenario == "pytest-failure" else 0)
raise SystemExit(98)
'''


def _install_fakes(
    fake_bin: Path,
    *,
    include_docker: bool = True,
    include_uv: bool = True,
    include_setsid: bool = True,
) -> None:
    fake_bin.mkdir()
    tools = ["bash", "dirname", "od", "tr"]
    if include_setsid:
        tools.append("setsid")
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


def _script_environment(
    fake_bin: Path, log_path: Path, scenario: str = "success"
) -> dict[str, str]:
    environment = os.environ.copy()
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
    include_setsid: bool = True,
) -> tuple[subprocess.CompletedProcess[str], list[dict[str, object]]]:
    fake_bin = tmp_path / "bin"
    log_path = tmp_path / "commands.jsonl"
    _install_fakes(
        fake_bin,
        include_docker=include_docker,
        include_uv=include_uv,
        include_setsid=include_setsid,
    )
    result = subprocess.run(
        ["bash", str(SCRIPT_PATH)],
        cwd=REPO_ROOT,
        env=_script_environment(fake_bin, log_path, scenario),
        text=True,
        capture_output=True,
        check=False,
    )
    events = _events(log_path) if log_path.exists() else []
    _assert_compose_prefixes(events)
    return result, events


def _operation(event: dict[str, object]) -> str:
    if str(event["tool"]).endswith(("-ready", "-signal")):
        return str(event["tool"])
    arguments = event["argv"]
    assert isinstance(arguments, list)
    if event["tool"] == "uv":
        return f"uv-{arguments[1]}"
    if arguments[:2] == ["compose", "version"]:
        return "compose-version"
    if arguments[:3] == ["compose", "up", "--help"]:
        return "compose-up-help"
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
        "up",
        "port",
        "uv-alembic",
        "uv-pytest",
        "down",
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


def test_script_refuses_missing_setsid_before_creating_resources(tmp_path: Path) -> None:
    result, events = _run_scenario(tmp_path, "success", include_setsid=False)

    assert result.returncode == 2
    assert "required command 'setsid' was not found" in result.stderr
    assert events == []


@pytest.mark.parametrize("scenario", ["empty-port", "invalid-port", "non-loopback-port"])
def test_script_rejects_invalid_port_and_cleans_up(tmp_path: Path, scenario: str) -> None:
    result, events = _run_scenario(tmp_path, scenario)

    assert result.returncode != 0
    assert "invalid loopback port" in result.stderr
    assert [_operation(event) for event in events] == [
        "compose-version",
        "compose-up-help",
        "up",
        "port",
        "down",
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
        "up",
        "logs",
        "down",
        "volume-list",
    ]
    log_event = next(event for event in events if _operation(event) == "logs")
    assert log_event["argv"][-5:] == ["logs", "--no-color", "--tail", "200", "postgres"]
    assert all(event["tool"] != "uv" for event in events)


def test_script_preserves_alembic_failure_and_skips_pytest(tmp_path: Path) -> None:
    result, events = _run_scenario(tmp_path, "alembic-failure")

    assert result.returncode == 41
    assert [_operation(event) for event in events][-3:] == [
        "uv-alembic",
        "down",
        "volume-list",
    ]
    assert "uv-pytest" not in [_operation(event) for event in events]


def test_script_preserves_pytest_failure_and_cleans_up(tmp_path: Path) -> None:
    result, events = _run_scenario(tmp_path, "pytest-failure")

    assert result.returncode == 42
    assert [_operation(event) for event in events][-4:] == [
        "uv-alembic",
        "uv-pytest",
        "down",
        "volume-list",
    ]


@pytest.mark.parametrize(
    ("signal_number", "expected_status"),
    [
        (signal.SIGHUP, 129),
        (signal.SIGINT, 130),
        (signal.SIGTERM, 143),
    ],
)
def test_script_forwards_wrapper_signal_and_promptly_cleans_up(
    tmp_path: Path, signal_number: signal.Signals, expected_status: int
) -> None:
    fake_bin = tmp_path / "bin"
    log_path = tmp_path / "commands.jsonl"
    _install_fakes(fake_bin)
    process = subprocess.Popen(
        ["bash", str(SCRIPT_PATH)],
        cwd=REPO_ROOT,
        env=_script_environment(fake_bin, log_path, "signal-during-alembic"),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if log_path.exists() and '"tool": "uv-ready"' in log_path.read_text(
            encoding="utf-8"
        ):
            break
        time.sleep(0.02)
    else:
        process.kill()
        pytest.fail("fake Alembic command did not start")

    uv_event = next(event for event in _events(log_path) if event["tool"] == "uv")
    child_pid = uv_event["pid"]
    assert isinstance(child_pid, int)
    started = time.monotonic()
    os.kill(process.pid, signal_number)
    try:
        _, stderr = process.communicate(timeout=3)
    except subprocess.TimeoutExpired:
        try:
            os.kill(child_pid, signal.SIGKILL)
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
        if event["tool"] not in ("uv-ready", "uv-signal")
    ]
    assert operations[-3:] == [
        "uv-alembic",
        "down",
        "volume-list",
    ]
    assert "uv-pytest" not in operations
    signal_events = [event for event in events if event["tool"] == "uv-signal"]
    assert [event for event in events if event["tool"] == "uv-ready"] == [
        {"tool": "uv-ready", "pid": child_pid, "pgid": child_pid}
    ]
    assert signal_events == [
        {
            "tool": "uv-signal",
            "signal": signal_number,
            "pid": child_pid,
            "pgid": child_pid,
        }
    ]
    with pytest.raises(ProcessLookupError):
        os.kill(child_pid, 0)
    assert "cleanup failed" not in stderr


@pytest.mark.parametrize(
    ("signal_number", "expected_status"),
    [
        (signal.SIGHUP, 129),
        (signal.SIGINT, 130),
        (signal.SIGTERM, 143),
    ],
)
def test_script_forwards_wrapper_signal_during_startup_and_cleans_up(
    tmp_path: Path, signal_number: signal.Signals, expected_status: int
) -> None:
    fake_bin = tmp_path / "bin"
    log_path = tmp_path / "commands.jsonl"
    _install_fakes(fake_bin)
    process = subprocess.Popen(
        ["bash", str(SCRIPT_PATH)],
        cwd=REPO_ROOT,
        env=_script_environment(fake_bin, log_path, "signal-during-startup"),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if log_path.exists() and '"tool": "docker-up-ready"' in log_path.read_text(
            encoding="utf-8"
        ):
            break
        time.sleep(0.02)
    else:
        process.kill()
        pytest.fail("fake Compose startup did not become signal-ready")

    up_event = next(event for event in _events(log_path) if _operation(event) == "up")
    child_pid = up_event["pid"]
    assert isinstance(child_pid, int)
    started = time.monotonic()
    os.kill(process.pid, signal_number)
    try:
        _, stderr = process.communicate(timeout=3)
    except subprocess.TimeoutExpired:
        try:
            os.kill(child_pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.kill()
        process.communicate(timeout=3)
        pytest.fail("wrapper did not promptly forward the startup signal and exit")
    events = _events(log_path)
    _assert_compose_prefixes(events)

    assert time.monotonic() - started < 3
    assert process.returncode == expected_status
    operations = [
        _operation(event)
        for event in events
        if event["tool"] not in ("docker-up-ready", "docker-up-signal")
    ]
    assert operations == [
        "compose-version",
        "compose-up-help",
        "up",
        "down",
        "volume-list",
    ]
    assert [event for event in events if event["tool"] == "docker-up-ready"] == [
        {"tool": "docker-up-ready", "pid": child_pid, "pgid": child_pid}
    ]
    assert [event for event in events if event["tool"] == "docker-up-signal"] == [
        {
            "tool": "docker-up-signal",
            "signal": signal_number,
            "pid": child_pid,
            "pgid": child_pid,
        }
    ]
    with pytest.raises(ProcessLookupError):
        os.kill(child_pid, 0)
    assert "cleanup failed" not in stderr


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
    assert [_operation(event) for event in events][-2:] == ["down", "volume-list"]


def test_script_fails_closed_when_volume_absence_query_fails(tmp_path: Path) -> None:
    result, events = _run_scenario(tmp_path, "volume-list-failure")

    assert result.returncode == 90
    assert "could not verify data volume removal" in result.stderr
    assert [_operation(event) for event in events][-2:] == ["down", "volume-list"]
    volume_event = events[-1]
    assert volume_event["argv"] == [
        "volume",
        "ls",
        "--quiet",
        "--filter",
        f"name={volume_event['volume']}",
    ]


def test_volume_query_failure_overrides_primary_failure(tmp_path: Path) -> None:
    result, events = _run_scenario(tmp_path, "alembic-and-volume-list-failure")

    assert result.returncode == 90
    assert "could not verify data volume removal" in result.stderr
    assert [_operation(event) for event in events][-3:] == [
        "uv-alembic",
        "down",
        "volume-list",
    ]
