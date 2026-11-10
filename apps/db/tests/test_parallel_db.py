from __future__ import annotations

from contextlib import nullcontext
from types import SimpleNamespace

import parallel_db
import pytest
from sqlalchemy.engine import make_url

from transit_ops.db.target_safety import assert_disposable_test_url


@pytest.mark.parametrize(
    "base,role",
    [("transit_ci", "transit_ci"), ("transit_test", "postgres"), ("transit_repro", "repro")],
)
def test_worker_database_retains_disposable_guard(base: str, role: str) -> None:
    environment = {"TRANSIT_TEST_DATABASE_DISPOSABLE": "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE"}
    url = f"postgresql+psycopg://{role}@127.0.0.1/{base}_xdist_0123456789abcdef_gw0"
    assert_disposable_test_url(url, environment)
    with pytest.raises(RuntimeError):
        assert_disposable_test_url(url, {})
    with pytest.raises(RuntimeError):
        assert_disposable_test_url(url.replace("127.0.0.1", "remote.invalid"), environment)


@pytest.mark.parametrize(
    "name",
    [
        "transit_ci_xdist_bad_gw0",
        "production_xdist_0123456789abcdef_gw0",
        "transit_ci_xdist_0123456789abcdef_gw0_extra",
    ],
)
def test_arbitrary_worker_names_are_not_disposable(name: str) -> None:
    with pytest.raises(RuntimeError):
        assert_disposable_test_url(
            f"postgresql://transit_ci@localhost/{name}",
            {
                "TRANSIT_TEST_DATABASE_DISPOSABLE": "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE",
            },
        )


def test_clones_are_distinct_and_partial_setup_is_cleaned(monkeypatch: pytest.MonkeyPatch) -> None:
    base = "postgresql+psycopg://transit_ci@localhost/transit_ci?dbname=transit_ci"
    monkeypatch.setenv("TRANSIT_TEST_DATABASE_URL", base)
    monkeypatch.setenv(
        "TRANSIT_TEST_DATABASE_DISPOSABLE", "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE"
    )
    cleanups = []
    config = SimpleNamespace(stash={}, getoption=lambda *a, **kw: 3, add_cleanup=cleanups.append)
    statements = []

    def execute(url: str, statement: str) -> None:
        statements.append(statement)
        if len(statements) == 3:
            raise RuntimeError("create failed")

    monkeypatch.setattr(parallel_db, "_execute", execute)
    monkeypatch.setattr(parallel_db, "_database_settings", lambda _: [])
    with pytest.raises(RuntimeError, match="create failed"):
        parallel_db.pytest_configure(config)
    databases = config.stash[parallel_db._DATABASES]
    assert len(databases) == 2
    assert databases[0] != databases[1]
    for database in databases:
        assert database.query["dbname"] == database.database
        assert_disposable_test_url(
            database.render_as_string(hide_password=False),
            {
                "TRANSIT_TEST_DATABASE_DISPOSABLE": "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE",
            },
        )
    cleanups[0]()
    assert len(statements) == 5
    assert all(statement.startswith("DROP DATABASE") for statement in statements[3:])
    assert make_url(base).database == "transit_ci"


def test_cleanup_attempts_every_database_and_reports_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    base = "postgresql+psycopg://transit_ci@localhost/transit_ci"
    monkeypatch.setenv(
        "TRANSIT_TEST_DATABASE_DISPOSABLE", "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE"
    )
    databases = [make_url(f"{base}_xdist_0123456789abcdef_gw{i}") for i in range(3)]
    config = SimpleNamespace(stash={parallel_db._DATABASES: databases})
    statements = []

    def execute(url: str, statement: str) -> None:
        statements.append(statement)
        if "gw2" in statement:
            raise RuntimeError("drop failed")

    monkeypatch.setattr(parallel_db, "_execute", execute)
    with pytest.raises(ExceptionGroup, match="worker database cleanup"):
        parallel_db._cleanup(config, base)
    assert len(statements) == 3
    assert "gw2" in statements[0]
    assert "gw1" in statements[1]
    assert "gw0" in statements[2]


def test_parallel_database_refuses_unmanaged_worker_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "TRANSIT_TEST_DATABASE_URL", "postgresql+psycopg://transit_ci@localhost/transit_ci"
    )
    options = {"numprocesses": None, "dist": "load"}
    config = SimpleNamespace(getoption=lambda key, **kwargs: options[key])
    with pytest.raises(pytest.UsageError, match="worker count"):
        parallel_db.pytest_configure(config)


def test_database_profile_preserves_values_role_and_effective_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    base = "postgresql+psycopg://transit_ci@localhost/transit_ci"
    name = "transit_ci_xdist_0123456789abcdef_gw0"
    target = make_url(f"postgresql+psycopg://transit_ci@localhost/ignored?dbname={name}")
    monkeypatch.setenv(
        "TRANSIT_TEST_DATABASE_DISPOSABLE", "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE"
    )
    parameters, commands = [], []

    class Connection:
        def begin(self):
            return nullcontext()

        def execute(self, statement, values):
            parameters.append(values)

        def exec_driver_sql(self, statement):
            commands.append(statement)

    connection = Connection()
    disposed = []
    admin = SimpleNamespace(
        connect=lambda: nullcontext(connection), dispose=lambda: disposed.append(1)
    )
    monkeypatch.setattr(parallel_db, "_admin_engine", lambda _: admin)
    profile = [
        (None, "search_path", '"schema, name", public'),
        (None, "transit.profile", "a=b,c'quoted"),
        ('quoted"role', "work_mem", "7MB"),
    ]
    parallel_db._copy_database_settings(base, target, profile)
    assert parameters == [{"name": key, "value": value} for _, key, value in profile]
    assert commands == [
        f'ALTER DATABASE "{name}" SET "search_path" FROM CURRENT',
        f'ALTER DATABASE "{name}" SET "transit.profile" FROM CURRENT',
        f'ALTER ROLE "quoted""role" IN DATABASE "{name}" SET "work_mem" FROM CURRENT',
    ]
    assert disposed == [1]


def test_settings_copy_failure_cleans_up_the_created_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    base = "postgresql+psycopg://transit_ci@localhost/transit_ci"
    monkeypatch.setenv("TRANSIT_TEST_DATABASE_URL", base)
    monkeypatch.setenv(
        "TRANSIT_TEST_DATABASE_DISPOSABLE", "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE"
    )
    statements, cleanups = [], []
    config = SimpleNamespace(stash={}, getoption=lambda *a, **kw: 2, add_cleanup=cleanups.append)
    monkeypatch.setattr(parallel_db, "_execute", lambda base, sql: statements.append(sql))
    monkeypatch.setattr(parallel_db, "_database_settings", lambda _: [(None, "TimeZone", "UTC")])

    def fail(*args):
        raise RuntimeError("cannot copy database profile")

    monkeypatch.setattr(parallel_db, "_copy_database_settings", fail)
    with pytest.raises(RuntimeError, match="cannot copy database profile"):
        parallel_db.pytest_configure(config)
    assert len(config.stash[parallel_db._DATABASES]) == 1
    cleanups[0]()
    assert len(statements) == 2
    assert statements[0].startswith("CREATE DATABASE")
    assert statements[1].startswith("DROP DATABASE")
