from __future__ import annotations

import importlib.util
import os
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ACCESS_DIR = REPO_ROOT / "infra" / "postgres-public-access"
HBA_RENDERER = ACCESS_DIR / "render-pg-hba.sh"
HARDEN_SQL = ACCESS_DIR / "harden-powerbi-reader.sql"
VERIFY_HELPER = ACCESS_DIR / "verify_powerbi_reader.py"


def _load_verify_module():
    spec = importlib.util.spec_from_file_location("verify_powerbi_reader", VERIFY_HELPER)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _active_lines(text: str) -> list[str]:
    return [
        " ".join(line.split("#", 1)[0].split())
        for line in text.splitlines()
        if line.split("#", 1)[0].strip()
    ]


def test_hba_renderer_limits_public_access_to_tls_powerbi_reader_and_app_owner() -> None:
    result = subprocess.run(
        ["bash", str(HBA_RENDERER)],
        check=True,
        text=True,
        capture_output=True,
    )
    lines = _active_lines(result.stdout)

    public_app_owner = "hostssl transit transit 0.0.0.0/0 scram-sha-256"
    public_reader = "hostssl transit powerbi_reader 0.0.0.0/0 scram-sha-256"
    public_reject = "hostssl all all 0.0.0.0/0 reject"

    assert public_app_owner in lines
    assert public_reader in lines
    assert "hostnossl all all 0.0.0.0/0 reject" in lines
    assert public_reject in lines
    assert lines.index(public_app_owner) < lines.index(public_reject)
    assert lines.index(public_reader) < lines.index(public_reject)
    assert "host all all 0.0.0.0/0 scram-sha-256" not in lines
    assert "host all transit 0.0.0.0/0 scram-sha-256" not in lines


def test_hba_renderer_accepts_explicit_database_app_role_and_reader_role() -> None:
    env = os.environ | {
        "POSTGRES_DB": "analytics",
        "POSTGRES_USER": "app_owner",
        "POWERBI_READER_ROLE": "bi_reader",
    }
    result = subprocess.run(
        ["bash", str(HBA_RENDERER)],
        check=True,
        text=True,
        capture_output=True,
        env=env,
    )
    lines = _active_lines(result.stdout)

    assert "host all app_owner 172.16.0.0/12 scram-sha-256" in lines
    assert "hostssl analytics app_owner 0.0.0.0/0 scram-sha-256" in lines
    assert "hostssl analytics bi_reader 0.0.0.0/0 scram-sha-256" in lines
    assert "hostssl all all 0.0.0.0/0 reject" in lines


def test_hba_renderer_rejects_invalid_policy_identifiers() -> None:
    for variable_name, value in (
        ("POSTGRES_DB", "all"),
        ("POSTGRES_USER", "app owner"),
        ("POWERBI_READER_ROLE", "all"),
        ("POWERBI_READER_ROLE", "reader\nhost all all 0.0.0.0/0 trust"),
    ):
        result = subprocess.run(
            ["bash", str(HBA_RENDERER)],
            text=True,
            capture_output=True,
            check=False,
            env=os.environ | {variable_name: value},
        )

        assert result.returncode != 0
        assert f"invalid {variable_name}" in result.stderr
        assert "0.0.0.0/0 trust" not in result.stdout


def test_hardening_sql_uses_variable_password_and_gold_only_grants() -> None:
    sql = HARDEN_SQL.read_text(encoding="utf-8")

    assert "SET password_encryption = 'scram-sha-256';" in sql
    assert "CREATE ROLE %I LOGIN" in sql
    assert ":'reader_role'" in sql
    assert ':"reader_role"' in sql
    assert "PASSWORD :'powerbi_reader_password'" in sql
    assert "REVOKE CONNECT ON DATABASE :\"database_name\" FROM PUBLIC;" in sql
    assert (
        "GRANT CONNECT, TEMPORARY ON DATABASE :\"database_name\" TO :\"app_owner\";"
        in sql
    )
    assert "GRANT CONNECT ON DATABASE :\"database_name\" TO :\"reader_role\";" in sql
    assert (
        "REVOKE TEMPORARY ON DATABASE :\"database_name\" FROM :\"reader_role\";"
        in sql
    )
    assert "REVOKE TEMPORARY ON DATABASE :\"database_name\" FROM PUBLIC;" in sql
    assert "REVOKE ALL ON SCHEMA %I FROM %s" in sql
    assert "REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %s" in sql
    assert "REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %s" in sql
    assert "REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM %s" in sql
    assert "GRANT USAGE ON SCHEMA gold TO :\"reader_role\";" in sql
    assert "GRANT SELECT ON ALL TABLES IN SCHEMA gold TO :\"reader_role\";" in sql
    assert (
        "ALTER DEFAULT PRIVILEGES FOR ROLE :\"app_owner\" IN SCHEMA gold "
        "GRANT SELECT ON TABLES TO :\"reader_role\";"
    ) in sql
    assert "All future Gold DDL is expected to run as app_owner" in sql
    assert "powerbi_reader_password =" not in sql


def test_verify_helper_redacts_passwords_from_connection_strings() -> None:
    module = _load_verify_module()

    redacted = module.redact_dsn(
        "could not connect to postgresql://powerbi_reader:secret@example.com:5432/transit"
    )

    assert "secret" not in redacted
    assert (
        "postgresql://powerbi_reader:<redacted>@example.com:5432/transit"
        in redacted
    )


def test_verify_helper_redacts_malformed_url_password_fragments_from_host_errors() -> None:
    module = _load_verify_module()

    redacted = module.redact_dsn(
        "failed to resolve host 's3cret-fragment@example.com': [Errno -2]"
    )

    assert "s3cret-fragment" not in redacted
    assert "failed to resolve host '<redacted>@example.com'" in redacted


def test_verify_helper_fails_without_printing_a_database_url_when_env_is_missing() -> None:
    result = subprocess.run(
        [
            "uv",
            "run",
            "python",
            str(VERIFY_HELPER),
            "--database-url-env",
            "MISSING_TRANSIT_POWERBI_URL",
        ],
        text=True,
        capture_output=True,
        check=False,
    )

    combined_output = result.stdout + result.stderr
    assert result.returncode == 2
    assert "MISSING_TRANSIT_POWERBI_URL is not set" in combined_output
    assert "postgresql://" not in combined_output


def test_verify_helper_bounds_connect_timeout_in_both_modes(monkeypatch) -> None:
    module = _load_verify_module()

    connect_kwargs = []

    class FakeCursor:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    class FakeConnection:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def cursor(self):
            return FakeCursor()

    def fake_positive_connect(*args, **kwargs):
        connect_kwargs.append(kwargs)
        return FakeConnection()

    monkeypatch.setattr(module.psycopg, "connect", fake_positive_connect)
    monkeypatch.setattr(module, "verify_current_user", lambda cur, expected_user: None)
    monkeypatch.setattr(module, "verify_tls", lambda cur: None)
    monkeypatch.setattr(module, "verify_gold_usage", lambda cur: None)
    monkeypatch.setattr(module, "verify_gold_select", lambda cur: None)
    monkeypatch.setattr(module, "verify_restricted_schema_usage", lambda cur: None)
    monkeypatch.setattr(module, "verify_read_only", lambda conn: None)

    assert module.run_positive_verification("postgresql://example/transit", "powerbi_reader") == 0

    def fake_failure_connect(*args, **kwargs):
        connect_kwargs.append(kwargs)
        raise RuntimeError("connection timed out")

    monkeypatch.setattr(module.psycopg, "connect", fake_failure_connect)

    assert module.run_expected_connect_failure("postgresql://example/transit") == 1
    assert connect_kwargs == [
        {"autocommit": True, "connect_timeout": module.CONNECT_TIMEOUT_SECONDS},
        {"connect_timeout": module.CONNECT_TIMEOUT_SECONDS},
    ]


def test_verify_statement_fails_only_passes_for_insufficient_privilege() -> None:
    module = _load_verify_module()

    class FakeInsufficientPrivilege(Exception):
        sqlstate = "42501"

    class FakeConnection:
        def __init__(self, exc):
            self.exc = exc

        def cursor(self):
            return self

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def execute(self, statement):
            raise self.exc

    module.verify_statement_fails(
        FakeConnection(FakeInsufficientPrivilege("permission denied")),
        "CREATE TABLE gold.probe(id integer)",
        "CREATE TABLE in gold fails",
    )

    try:
        module.verify_statement_fails(
            FakeConnection(RuntimeError("server closed the connection unexpectedly")),
            "CREATE TABLE gold.probe(id integer)",
            "CREATE TABLE in gold fails",
        )
    except RuntimeError as exc:
        assert "server closed the connection unexpectedly" in str(exc)
    else:
        raise AssertionError("non-privilege errors must not be reported as PASS")


def test_schema_exists_uses_catalog_visibility_not_information_schema() -> None:
    module = _load_verify_module()

    class FakeCursor:
        def __init__(self):
            self.executed = []

        def execute(self, statement, params=None):
            self.executed.append((statement, params))

        def fetchone(self):
            return (True,)

    cur = FakeCursor()

    assert module.schema_exists(cur, "silver") is True
    assert cur.executed == [
        (
            "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = %s)",
            ("silver",),
        )
    ]


def test_expected_connect_failure_passes_for_hba_rejection(monkeypatch) -> None:
    module = _load_verify_module()

    def fake_connect(*args, **kwargs):
        raise RuntimeError("no pg_hba.conf entry for host \"203.0.113.10\"")

    monkeypatch.setattr(module.psycopg, "connect", fake_connect)

    assert module.run_expected_connect_failure("postgresql://example/transit") == 0


def test_expected_connect_failure_passes_for_hba_tls_rejection(monkeypatch) -> None:
    module = _load_verify_module()

    def fake_connect(*args, **kwargs):
        raise RuntimeError("pg_hba.conf rejects connection for host, SSL off")

    monkeypatch.setattr(module.psycopg, "connect", fake_connect)

    assert module.run_expected_connect_failure("postgresql://example/transit") == 0


def test_expected_connect_failure_fails_for_password_auth_failure(monkeypatch) -> None:
    module = _load_verify_module()

    def fake_connect(*args, **kwargs):
        raise RuntimeError("password authentication failed for user \"powerbi_reader\"")

    monkeypatch.setattr(module.psycopg, "connect", fake_connect)

    assert module.run_expected_connect_failure("postgresql://example/transit") == 1


def test_expected_connect_failure_fails_for_missing_database(monkeypatch) -> None:
    module = _load_verify_module()

    def fake_connect(*args, **kwargs):
        raise RuntimeError("database \"transit\" does not exist")

    monkeypatch.setattr(module.psycopg, "connect", fake_connect)

    assert module.run_expected_connect_failure("postgresql://example/transit") == 1


def test_expected_connect_failure_fails_for_network_timeout(monkeypatch) -> None:
    module = _load_verify_module()

    def fake_connect(*args, **kwargs):
        raise RuntimeError("connection timeout expired")

    monkeypatch.setattr(module.psycopg, "connect", fake_connect)

    assert module.run_expected_connect_failure("postgresql://example/transit") == 1


def test_verify_helper_checks_select_on_every_gold_relation() -> None:
    source = VERIFY_HELPER.read_text(encoding="utf-8")

    assert "pg_catalog.pg_class" in source
    assert "pg_catalog.pg_namespace" in source
    assert "has_table_privilege(current_user, c.oid, 'SELECT')" in source
    assert "c.relkind IN ('r', 'p', 'v', 'm', 'f')" in source


def test_verify_gold_select_checks_all_gold_catalog_relations() -> None:
    module = _load_verify_module()

    class FakeCursor:
        def __init__(self):
            self._result = []
            self.executed = []

        def execute(self, statement, params=None):
            rendered = str(statement)
            self.executed.append((rendered, params))
            if "pg_catalog.pg_class" in rendered:
                self._result = [
                    ("daily_boardings", "r", True),
                    ("late_trips", "v", False),
                ]
                return
            if rendered.startswith("SELECT * FROM"):
                self._result = []
                return
            raise AssertionError(f"unexpected query: {rendered}")

        def fetchall(self):
            return self._result

    cur = FakeCursor()

    try:
        module.verify_gold_select(cur)
    except module.VerificationError as exc:
        assert "current user lacks SELECT on gold.late_trips" in str(exc)
    else:
        raise AssertionError("verify_gold_select should fail when any Gold relation lacks SELECT")
