import os
import re
from contextlib import contextmanager
from datetime import UTC, datetime
from types import SimpleNamespace

import psycopg
import pytest
from alembic import command
from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError, ProgrammingError

from transit_ops.live.oracle import database
from transit_ops.live.oracle.database import OracleDatabaseRefused, PinnedClock, oracle_database

CONFIRM = {"TRANSIT_TEST_DATABASE_DISPOSABLE": "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE"}
URL = "postgresql+psycopg://"
CLOCK = PinnedClock(datetime(2025, 1, 10, tzinfo=UTC))


class Server:
    fields = ("host", "hostaddr", "port", "user", "dbname")

    def __init__(self, monkeypatch):
        self.monkeypatch = monkeypatch
        self.databases, self.connections, self.drops = set(), [], []
        self.fault = None

    def execute(self, target, sql):
        if not sql.startswith(("CREATE DATABASE", "DROP DATABASE")):
            return
        row = (target, re.search(r'"([^"]+)"', sql)[1])
        if sql.startswith("CREATE DATABASE"):
            if self.fault == "collision":
                self.databases.add(row)
                raise ProgrammingError(sql, None, psycopg.errors.DuplicateDatabase("exists"))
            if self.fault != "lost_before_commit":
                self.databases.add(row)
            if self.fault in ("lost_ack", "lost_before_commit"):
                raise OperationalError(
                    sql, None, psycopg.OperationalError("reply lost"), connection_invalidated=True
                )
        else:
            self.drops.append(sql)
            if row not in self.databases and "IF EXISTS" not in sql:
                raise ProgrammingError(sql, None, psycopg.errors.InvalidCatalogName("absent"))
            self.databases.discard(row)

    def factory(self, url, **kwargs):
        engine = create_engine(url, **kwargs)

        @contextmanager
        def connection():
            args, params = engine.dialect.create_connect_args(engine.url)
            params.pop("context", None)
            parsed = psycopg.conninfo.conninfo_to_dict(
                psycopg.conninfo.make_conninfo(*args, **params)
            )
            identity = {
                key: parsed.get(key)
                or os.environ.get("PGDATABASE" if key == "dbname" else "PG" + key.upper())
                for key in self.fields
            }
            self.connections.append(identity)
            target = tuple(identity[key] for key in ("host", "hostaddr", "port"))
            yield SimpleNamespace(exec_driver_sql=lambda sql: self.execute(target, sql))

        self.monkeypatch.setattr(engine, "connect", connection)
        self.monkeypatch.setattr(engine, "begin", connection)
        return engine


@pytest.fixture
def server(monkeypatch):
    state = Server(monkeypatch)
    for key in list(os.environ):
        if key.startswith("PG"):
            monkeypatch.delenv(key)
    values = ("localhost", "127.0.0.1", "5432", "transit_ci", "transit_ci")
    for key, value in zip(Server.fields, values, strict=True):
        monkeypatch.setenv("PGDATABASE" if key == "dbname" else "PG" + key.upper(), value)
    monkeypatch.setattr(database, "create_engine", state.factory)
    monkeypatch.setattr(command, "upgrade", lambda *_: None)
    return state


@pytest.mark.parametrize(
    "key,value",
    [
        ("PGHOSTADDR", "300.1.1.1"),
        ("PGPORT", "55432"),
        ("PGHOST", "remote.invalid"),
        ("PGUSER", "other_role"),
        ("PGDATABASE", "other_database"),
    ],
)
def test_environment_change_never_redirects_cleanup(server, monkeypatch, key, value):
    try:
        with oracle_database(URL, clock=CLOCK, environment=CONFIRM):
            monkeypatch.setenv(key, value)
    except (OracleDatabaseRefused, ProgrammingError):
        pass
    for identity in server.connections:
        assert identity["host"] == "localhost"
        assert identity["hostaddr"] == "127.0.0.1"
        assert identity["port"] == "5432"
        assert identity["user"] == "transit_ci"
        assert identity["dbname"] == "transit_ci" or "_oracle_" in identity["dbname"]


@pytest.mark.parametrize("fault", ["lost_ack", "lost_before_commit"])
def test_unknown_create_outcome_is_compensated(server, fault):
    server.fault = fault
    with pytest.raises(OperationalError, match="reply lost"):
        with oracle_database(URL, clock=CLOCK, environment=CONFIRM):
            pytest.fail("unknown creation must not yield")
    assert not server.databases
    assert server.drops
    assert all(sql.startswith("DROP DATABASE IF EXISTS ") for sql in server.drops)


def test_known_create_collision_preserves_the_existing_database(server):
    server.fault = "collision"
    with pytest.raises(ProgrammingError):
        with oracle_database(URL, clock=CLOCK, environment=CONFIRM):
            pytest.fail("collision must not yield")
    assert server.databases
    assert not server.drops
