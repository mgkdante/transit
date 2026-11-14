from __future__ import annotations

import os
import re
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from datetime import UTC, datetime
from uuid import uuid4

from alembic import command
from alembic.config import Config
from psycopg import Connection as DriverConnection
from sqlalchemy import Connection, Engine, create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

from transit_ops.db.target_safety import assert_disposable_test_url
from transit_ops.ingestion.common import project_root

CLOCK_SCHEMA = "transit_oracle_clock"
CLOCK_SETTING = "transit_oracle.now"
_CLOCK_FUNCTIONS = (
    "now",
    "clock_timestamp",
    "statement_timestamp",
    "transaction_timestamp",
    "timeofday",
)
_CLOCK_KEYWORDS = re.compile(
    r"\b(current_date|current_time|current_timestamp|localtime|localtimestamp)\b", re.IGNORECASE
)
_CLOCK_OBJECTS_SQL = """
WITH objects AS (
    SELECT n.nspname AS schema, format('%I.%I', n.nspname, c.relname) AS name,
           'pg_rewrite'::regclass AS classid, r.oid AS objid,
           r.ev_action::text AS expression, pg_get_viewdef(c.oid) AS source, false AS own_path
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_rewrite r ON r.ev_class = c.oid AND r.rulename = '_RETURN'
    WHERE c.relkind IN ('v', 'm')
    UNION ALL
    SELECT n.nspname, format('%I.%I.%I', n.nspname, c.relname, a.attname),
           'pg_attrdef'::regclass, d.oid, d.adbin::text, pg_get_expr(d.adbin, d.adrelid), false
    FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.adnum
    UNION ALL
    SELECT n.nspname, format('%I.%I', n.nspname, p.proname), 'pg_proc'::regclass, p.oid,
           p.prosqlbody::text,
           CASE WHEN l.lanname IN ('sql', 'plpgsql')
                THEN COALESCE(NULLIF(p.prosrc, ''), pg_get_functiondef(p.oid)) ELSE '' END,
           EXISTS (SELECT FROM unnest(p.proconfig) setting WHERE setting LIKE 'search_path=%')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang WHERE p.prokind = 'f'
)
SELECT o.name, o.expression, o.source, o.own_path, EXISTS (
    SELECT FROM pg_depend d JOIN pg_proc p ON p.oid = d.refobjid
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE d.classid = o.classid AND d.objid = o.objid AND d.refclassid = 'pg_proc'::regclass
      AND n.nspname = 'pg_catalog' AND p.proname = ANY(:functions)
) AS catalog_dependency
FROM objects o WHERE o.schema = ANY(:schemas)
"""


class UnpinnableClockError(RuntimeError):
    objects: tuple[str, ...]

    def __init__(self, objects: tuple[str, ...]) -> None:
        self.objects = tuple(sorted(set(objects)))
        super().__init__("Unpinnable clock in: " + ", ".join(self.objects))


def assert_clock_pinned(connection: Connection) -> None:
    params = {
        "functions": list(_CLOCK_FUNCTIONS),
        "schemas": ["core", "gold", "silver", "raw", "ops"],
    }
    ids = connection.execute(
        text("""
        SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'pg_catalog' AND p.proname = ANY(:functions)
    """),
        params,
    ).scalars()
    # Dependencies on pinned built-ins are omitted; stored trees retain bound function OIDs.
    bound = re.compile(r":funcid (?:" + "|".join(str(oid) for oid in ids) + r")\b")
    catalog_call = re.compile(
        r'\b"?pg_catalog"?\s*\.\s*"?(?:' + "|".join(_CLOCK_FUNCTIONS) + r')"?\s*\(',
        re.IGNORECASE,
    )
    objects = tuple(
        str(name)
        for name, expression, source, own_path, dependency in connection.execute(
            text(_CLOCK_OBJECTS_SQL), params
        )
        if own_path
        or dependency
        or bound.search(expression or "")
        or _CLOCK_KEYWORDS.search(source)
        or catalog_call.search(source)
    )
    if objects:
        raise UnpinnableClockError(objects)


class OracleDatabaseRefused(RuntimeError):
    pass


class PinnedClock:
    def __init__(self, instant: datetime) -> None:
        self.set(instant)

    @property
    def instant(self) -> datetime:
        return self._instant

    def set(self, instant: datetime) -> None:
        if instant.utcoffset() is None:
            raise ValueError("Pinned clock requires an aware datetime")
        self._instant = instant.astimezone(UTC)


def _initialize(engine: Engine, database: str, admin: Engine, clock: PinnedClock) -> None:
    with engine.begin() as connection:
        connection.exec_driver_sql(f"CREATE SCHEMA {CLOCK_SCHEMA}")
        for name in ("now", "clock_timestamp", "statement_timestamp", "transaction_timestamp"):
            connection.exec_driver_sql(f"""
                CREATE FUNCTION {CLOCK_SCHEMA}.{name}() RETURNS timestamptz
                LANGUAGE sql STABLE AS $$
                    SELECT pg_catalog.current_setting('{CLOCK_SETTING}')::timestamptz
                $$
            """)
    with admin.connect() as connection:
        connection.exec_driver_sql(
            f"ALTER DATABASE {database} SET search_path = {CLOCK_SCHEMA}, pg_catalog, public"
        )
        connection.exec_driver_sql(f"ALTER DATABASE {database} SET timezone = 'UTC'")
        connection.exec_driver_sql(
            f"ALTER DATABASE {database} SET \"{CLOCK_SETTING}\" = '{clock.instant.isoformat()}'"
        )
    root = project_root()
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "src/transit_ops/db/migrations"))
    cfg.set_main_option(
        "sqlalchemy.url", engine.url.render_as_string(hide_password=False).replace("%", "%%")
    )
    command.upgrade(cfg, "head")


def _pin_connections(engine: Engine, clock: PinnedClock) -> None:
    @event.listens_for(engine, "connect")
    def configure(connection: DriverConnection[tuple[object, ...]], _record: object) -> None:
        with connection.cursor() as cursor:
            cursor.execute(f"SET search_path = {CLOCK_SCHEMA}, pg_catalog, public")
            cursor.execute(
                "SELECT pg_catalog.set_config(%s, %s, false)",
                (CLOCK_SETTING, clock.instant.isoformat()),
            )
            cursor.execute("SHOW TimeZone")
            zone = cursor.fetchone()
            if zone is None or zone[0] != "UTC":
                raise OracleDatabaseRefused("Oracle database TimeZone must be UTC")
        connection.commit()

    with engine.connect() as connection:
        assert_clock_pinned(connection)


@contextmanager
def oracle_database(
    admin_url: str, *, clock: PinnedClock, environment: Mapping[str, str], keep: bool = False
) -> Iterator[Engine]:
    confirmation = environment.get("TRANSIT_TEST_DATABASE_DISPOSABLE", "")
    environment = dict(os.environ, TRANSIT_TEST_DATABASE_DISPOSABLE=confirmation)
    try:
        assert_disposable_test_url(admin_url, environment)
        url = make_url(admin_url)
        base = url.query.get("dbname", url.database or environment.get("PGDATABASE", ""))
        if not isinstance(base, str):
            raise OracleDatabaseRefused("Oracle database requires one database name")
        base = re.sub(r"_xdist_[0-9a-f]{16}_gw[0-9]+$", "", base)
        name = f"{base}_oracle_{uuid4().hex[:16]}"
        query = dict(url.query)
        if "dbname" in query:
            query["dbname"] = name
        options = query.get("options", environment.get("PGOPTIONS", ""))
        if not isinstance(options, str):
            raise OracleDatabaseRefused("Oracle database requires one options string")
        query["options"] = (
            f"{options} -c search_path={CLOCK_SCHEMA},pg_catalog,public -c timezone=UTC"
        ).strip()
        oracle_url = url.set(database=name, query=query)
        assert_disposable_test_url(oracle_url.render_as_string(hide_password=False), environment)
    except RuntimeError as error:
        raise OracleDatabaseRefused(str(error)) from error
    admin = create_engine(url, poolclass=NullPool, isolation_level="AUTOCOMMIT")
    engine = create_engine(oracle_url, poolclass=NullPool)
    database = admin.dialect.identifier_preparer.quote_identifier(name)
    created = False
    try:
        with admin.connect() as connection:
            connection.exec_driver_sql(f"CREATE DATABASE {database} TEMPLATE template0")
            created = True
        _initialize(engine, database, admin, clock)
        _pin_connections(engine, clock)
        yield engine
    finally:
        try:
            engine.dispose()
        finally:
            try:
                if created and not keep:
                    with admin.connect() as connection:
                        connection.exec_driver_sql(f"DROP DATABASE {database} WITH (FORCE)")
            finally:
                admin.dispose()
