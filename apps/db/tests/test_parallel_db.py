from __future__ import annotations

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
