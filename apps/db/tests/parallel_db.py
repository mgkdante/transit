"""Clone the migrated disposable database before xdist starts any test workers.

Serial pytest keeps using TRANSIT_TEST_DATABASE_URL directly. Parallel pytest
requires the same migrated base plus CREATEDB privilege. No OS locks or tools.
"""

from __future__ import annotations

import os
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import URL, make_url
from sqlalchemy.pool import NullPool

from transit_ops.db.target_safety import assert_disposable_test_url, parse_database_target

_DATABASES = pytest.StashKey[list[URL]]()


def _database_url(base: str, database: str) -> URL:
    # libpq query dbname overrides the URL path; replace both identities.
    url = make_url(base)
    query = dict(url.query)
    if "dbname" in query:
        query["dbname"] = database
    return url.set(database=database, query=query)


def _execute(base: str, statement: str) -> None:
    admin = create_engine(
        _database_url(base, "postgres"), isolation_level="AUTOCOMMIT", poolclass=NullPool
    )
    try:
        with admin.connect() as connection:
            connection.exec_driver_sql(statement)
    finally:
        admin.dispose()


@pytest.hookimpl(trylast=True)
def pytest_configure(config: pytest.Config) -> None:
    workerinput = getattr(config, "workerinput", None)
    if workerinput is not None:
        if "transit_database_url" in workerinput:
            os.environ["TRANSIT_TEST_DATABASE_URL"] = workerinput["transit_database_url"]
        return
    base = os.environ.get("TRANSIT_TEST_DATABASE_URL")
    count = config.getoption("numprocesses", default=0)
    if not base:
        return
    if not count:
        if config.getoption("dist", default="no") != "no":
            raise pytest.UsageError("Parallel database tests require a local -n worker count")
        return
    assert_disposable_test_url(base, os.environ)
    template = parse_database_target(base).database
    if template is None or "_xdist_" in template:
        raise pytest.UsageError("Parallel tests require an approved base database")
    config.stash[_DATABASES] = []
    # Register immediately so a partially completed setup is cleaned on failure.
    config.add_cleanup(lambda: _cleanup(config, base))
    token = uuid4().hex[:16]
    quote = make_url(base).get_dialect()().identifier_preparer.quote_identifier
    for index in range(count):
        name = f"{template}_xdist_{token}_gw{index}"
        url = _database_url(base, name)
        assert_disposable_test_url(url.render_as_string(hide_password=False), os.environ)
        _execute(base, f"CREATE DATABASE {quote(name)} TEMPLATE {quote(template)}")
        config.stash[_DATABASES].append(url)


def _cleanup(config: pytest.Config, base: str) -> None:
    quote = make_url(base).get_dialect()().identifier_preparer.quote_identifier
    errors: list[Exception] = []
    for url in reversed(config.stash[_DATABASES]):
        try:
            rendered = url.render_as_string(hide_password=False)
            assert_disposable_test_url(rendered, os.environ)
            _execute(base, f"DROP DATABASE {quote(url.database)} WITH (FORCE)")
        except Exception as error:
            errors.append(error)
    if errors:
        raise ExceptionGroup("worker database cleanup failed", errors)


@pytest.hookimpl(optionalhook=True)
def pytest_configure_node(node) -> None:
    databases = node.config.stash.get(_DATABASES, [])
    if databases:
        index = int(node.gateway.id.removeprefix("gw"))
        node.workerinput["transit_database_url"] = databases[index].render_as_string(
            hide_password=False
        )
