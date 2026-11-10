"""Clone the migrated disposable database before xdist starts any test workers.

Serial pytest keeps using TRANSIT_TEST_DATABASE_URL directly. Parallel pytest
requires the same migrated base and privileges to create databases and reproduce
its settings. Database defaults and role-in-database settings are copied
explicitly; extensions come from TEMPLATE.
No OS locks or tools.
"""

from __future__ import annotations

import os
from uuid import uuid4

import pytest
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.pool import NullPool

from transit_ops.db.target_safety import assert_disposable_test_url, parse_database_target

_DATABASES = pytest.StashKey[list[URL]]()
DatabaseSetting = tuple[str | None, str, str]


def _database_url(base: str, database: str) -> URL:
    # libpq query dbname overrides the URL path; replace both identities.
    url = make_url(base)
    query = dict(url.query)
    if "dbname" in query:
        query["dbname"] = database
    return url.set(database=database, query=query)


def _admin_engine(base: str, *, autocommit: bool = False) -> Engine:
    return create_engine(
        _database_url(base, "postgres"),
        poolclass=NullPool,
        hide_parameters=True,
        isolation_level="AUTOCOMMIT" if autocommit else "READ COMMITTED",
    )


def _execute(base: str, statement: str) -> None:
    admin = _admin_engine(base, autocommit=True)
    try:
        with admin.connect() as connection:
            connection.exec_driver_sql(statement)
    finally:
        admin.dispose()


def _database_settings(base: str) -> list[DatabaseSetting]:
    """These cluster-catalog entries are not copied by CREATE DATABASE TEMPLATE."""
    admin = _admin_engine(base)
    try:
        with admin.connect() as connection:
            rows = connection.execute(
                text("""
                SELECT roles.rolname, entry.setting
                FROM pg_catalog.pg_db_role_setting AS settings
                JOIN pg_catalog.pg_database AS databases ON databases.oid = settings.setdatabase
                LEFT JOIN pg_catalog.pg_roles AS roles ON roles.oid = settings.setrole
                CROSS JOIN LATERAL pg_catalog.unnest(settings.setconfig) AS entry(setting)
                WHERE databases.datname = :database
                ORDER BY settings.setrole, entry.setting
            """),
                {"database": parse_database_target(base).database},
            )
            return [(role, *setting.split("=", 1)) for role, setting in rows]
    finally:
        admin.dispose()


def _copy_database_settings(base: str, target: URL, settings: list[DatabaseSetting]) -> None:
    if not settings:
        return
    assert_disposable_test_url(base, os.environ)
    assert_disposable_test_url(target.render_as_string(hide_password=False), os.environ)
    quote = target.get_dialect()().identifier_preparer.quote_identifier
    database = quote(parse_database_target(target.render_as_string(hide_password=False)).database)
    admin = _admin_engine(base)
    try:
        with admin.connect() as connection:
            for role, name, value in settings:
                command = f"ALTER DATABASE {database}"
                if role is not None:
                    command = f"ALTER ROLE {quote(role)} IN DATABASE {database}"
                # LOCAL prevents one copied GUC changing the next admin transaction.
                # FROM CURRENT preserves list-valued settings such as search_path.
                with connection.begin():
                    connection.execute(
                        text("SELECT pg_catalog.set_config(:name, :value, true)"),
                        {"name": name, "value": value},
                    )
                    connection.exec_driver_sql(f"{command} SET {quote(name)} FROM CURRENT")
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
    settings = _database_settings(base)
    token = uuid4().hex[:16]
    quote = make_url(base).get_dialect()().identifier_preparer.quote_identifier
    for index in range(count):
        name = f"{template}_xdist_{token}_gw{index}"
        url = _database_url(base, name)
        assert_disposable_test_url(url.render_as_string(hide_password=False), os.environ)
        _execute(base, f"CREATE DATABASE {quote(name)} TEMPLATE {quote(template)}")
        config.stash[_DATABASES].append(url)
        _copy_database_settings(base, url, settings)


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
