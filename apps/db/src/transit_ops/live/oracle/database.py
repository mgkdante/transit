from __future__ import annotations

import os
import re
from collections.abc import Collection, Iterator, Mapping
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import cast
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
_PINNED = ("now", "clock_timestamp", "statement_timestamp", "transaction_timestamp")
_KEYWORDS = ("current_date", "current_time", "current_timestamp", "localtime", "localtimestamp")
_CLOCK_FUNCTIONS = (*_PINNED, "timeofday", *_KEYWORDS)
_WORDS = {"now", "today", "tomorrow", "yesterday"}
_TOKEN = re.compile(r"'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|[\w$]+|::|[^\s]")
_IDENT = r'"(?:""|[^"])+"|[a-zA-Z_][\w$]*'
_TYPE = (
    rf"(?:{_IDENT})(?:\s*\.\s*(?:{_IDENT}))?(?:\s*\(\s*\d+\s*\))?"
    r"(?:\s+(?:with|without)\s+time\s+zone)?"
)
_CAST = re.compile(
    rf"(?P<value>'(?:''|[^'])*')(?P<text>(?:\s*\)*\s*::\s*text)*)\s*\)*\s*::\s*(?P<type>{_TYPE})",
    re.I,
)
_CALL = re.compile(
    rf'(?<![\w$])(?:(?P<schema>{_IDENT})\s*\.\s*)?(?P<name>"?(?:'
    + "|".join(_CLOCK_FUNCTIONS)
    + r')"?)\s*\(',
    re.I,
)
_CLOCK_OBJECTS_SQL = """
WITH objects AS (
 SELECT n.nspname AS schema, format('%I.%I',n.nspname,c.relname) AS name,
        'pg_rewrite'::regclass AS classid,r.oid AS objid,
        pg_catalog.pg_get_viewdef(c.oid) AS source,'expr' AS kind
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_rewrite r ON r.ev_class=c.oid AND r.rulename='_RETURN' WHERE c.relkind IN ('v','m')
 UNION ALL
 SELECT n.nspname,format('%I.%I.%I',n.nspname,c.relname,a.attname),'pg_attrdef'::regclass,d.oid,
        pg_catalog.pg_get_expr(d.adbin,d.adrelid),'expr'
 FROM pg_attrdef d JOIN pg_class c ON c.oid=d.adrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=d.adnum
 UNION ALL
 SELECT n.nspname,format('%I.%I.%I',n.nspname,COALESCE(c.relname,t.typname),d.conname),
        'pg_constraint'::regclass,d.oid,pg_catalog.pg_get_constraintdef(d.oid),'expr'
 FROM pg_constraint d JOIN pg_namespace n ON n.oid=d.connamespace
 LEFT JOIN pg_class c ON c.oid=d.conrelid LEFT JOIN pg_type t ON t.oid=d.contypid
 WHERE d.contype='c'
 UNION ALL
 SELECT n.nspname,format('%I.%I',n.nspname,t.typname),'pg_type'::regclass,t.oid,
        pg_catalog.pg_get_expr(t.typdefaultbin,0),'expr'
 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
 WHERE t.typtype='d' AND t.typdefaultbin IS NOT NULL
 UNION ALL
 SELECT n.nspname,format('%I.%I',n.nspname,p.proname),'pg_proc'::regclass,p.oid,
        pg_catalog.pg_get_expr(p.proargdefaults,0),'expr'
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proargdefaults IS NOT NULL
 UNION ALL
 SELECT n.nspname,format('%I.%I',n.nspname,p.proname),'pg_proc'::regclass,p.oid,
        pg_catalog.pg_get_functiondef(p.oid),'sql'
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prosqlbody IS NOT NULL
 UNION ALL
 SELECT n.nspname,format('%I.%I',n.nspname,p.proname),'pg_proc'::regclass,p.oid,
        array_to_string(p.proconfig,'; '),'config'
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE EXISTS(SELECT FROM unnest(p.proconfig) s WHERE s LIKE 'search_path=%')
)
SELECT o.name,o.source,o.kind,EXISTS(
 SELECT FROM pg_depend d JOIN pg_proc p ON p.oid=d.refobjid
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE d.classid=o.classid AND d.objid=o.objid AND d.refclassid='pg_proc'::regclass
 AND p.proname=ANY(:functions) AND NOT(n.nspname=:clock_schema AND p.proname=ANY(:pinned))
) AS dependency FROM objects o WHERE o.schema=ANY(:schemas)
"""


class UnpinnableClockError(RuntimeError):
    def __init__(
        self, objects: tuple[str, ...], *, expressions: tuple[tuple[str, str], ...] = ()
    ) -> None:
        self.objects = tuple(sorted(set(objects)))
        self.expressions = tuple(sorted(set(expressions)))
        details = self.expressions or tuple((name, "") for name in self.objects)
        super().__init__("Unpinnable clock in:\n" + "\n".join(f"{n}: {e}" for n, e in details))


def assert_ddl_clock_pinned(statement: str) -> None:
    # Cheap admission only; PostgreSQL's deparsed catalog is authoritative.
    view = re.fullmatch(r"\s*CREATE VIEW ([\w.]+) AS SELECT (.+?);?\s*", statement, re.I | re.S)
    word = r"'(?:now|today|tomorrow|yesterday)'"
    dtype = r"(?:date|time|timetz|timestamp|timestamptz)"
    if view and re.fullmatch(
        rf"(?:{word}::{dtype}|{dtype} {word}|CAST\({word} AS {dtype}\))",
        view[2],
        re.I,
    ):
        raise UnpinnableClockError((view[1],), expressions=((view[1], view[2]),))


def _identifier(token: str) -> str:
    return token[1:-1].replace('""', '"') if token.startswith('"') else token.lower()


def _code_reason(source: str) -> str:
    tokens = [m[0] for m in _TOKEN.finditer(source)]
    code = " ".join(t for t in tokens if not t.startswith("'"))
    if any(t.lower() in _KEYWORDS for t in tokens if not t.startswith(('"', "'"))):
        return "clock expression"
    for call in _CALL.finditer(code):
        schema = _identifier(call["schema"]) if call["schema"] else None
        if schema not in (None, CLOCK_SCHEMA) or _identifier(call["name"]) not in _PINNED:
            return "clock expression"
    return ""


def _date_kind(connection: Connection, typename: str, cache: dict[str, str | None]) -> str | None:
    if typename not in cache:
        cache[typename] = connection.execute(
            text("""
            WITH RECURSIVE types AS (
              SELECT oid,typbasetype FROM pg_type WHERE oid=pg_catalog.to_regtype(:type)
              UNION ALL SELECT p.oid,p.typbasetype FROM pg_type p
              JOIN types t ON p.oid=t.typbasetype
            ) SELECT k FROM types CROSS JOIN
              unnest(ARRAY['date','time','timetz','timestamp','timestamptz']) k
            WHERE types.oid=pg_catalog.to_regtype('pg_catalog.'||k)
        """),
            {"type": typename},
        ).scalar_one_or_none()
    return cache[typename]


def _literal_reason(
    connection: Connection, source: str, starts: Collection[datetime], cache: dict[str, str | None]
) -> str:
    strings = {m.start(): m[0] for m in _TOKEN.finditer(source) if m[0].startswith("'")}
    for match in _CAST.finditer(source):
        if strings.get(match.start()) != match["value"]:
            continue
        kind = _date_kind(connection, match["type"], cache)
        if not kind:
            continue
        value = match["value"][1:-1].replace("''", "'")
        if value.strip().lower() in _WORDS:
            return "clock literal cast"
        if not starts or match["text"]:
            continue
        values = list(starts)
        if kind not in ("time", "timetz"):
            values += [
                datetime.combine(
                    s.astimezone(UTC).date() + timedelta(days=d), datetime.min.time(), UTC
                )
                for s in starts
                for d in (-1, 0, 1)
            ]
        precision = re.search(r"\(\s*(\d+)\s*\)", match["type"])
        dtype = f"{kind}({precision[1]})" if precision else kind
        found = connection.execute(
            text(
                f"SELECT EXISTS(SELECT FROM unnest(CAST(:starts AS timestamptz[])) s "
                f"WHERE CAST(:value AS {dtype})=CAST(s AS {dtype}))"
            ),
            {"starts": values, "value": value},
        ).scalar_one()
        if found:
            return "clock literal resolved at DDL time"
    return ""


def assert_clock_pinned(
    connection: Connection, *, migration_starts: Collection[datetime] | None = None
) -> None:
    starts = (
        migration_starts
        if migration_starts is not None
        else connection.info.get("oracle_starts", ())
    )
    params = {
        "functions": list(_CLOCK_FUNCTIONS),
        "pinned": list(_PINNED),
        "schemas": ["core", "gold", "silver", "raw", "ops"],
        "clock_schema": CLOCK_SCHEMA,
    }
    findings: list[tuple[str, str]] = []
    cache: dict[str, str | None] = {}
    for name, source, kind, dependency in connection.execute(text(_CLOCK_OBJECTS_SQL), params):
        scan = source
        if kind == "sql":
            for token in _TOKEN.finditer(source):
                if token[0] in ("BEGIN", "RETURN"):
                    scan = source[token.start() :]
                    break
        reason = (
            "clock dependency"
            if dependency
            else ("function search_path" if kind == "config" else "")
        )
        reason = reason or _code_reason(scan) or _literal_reason(connection, scan, starts, cache)
        if reason:
            findings.append((str(name), f"{reason}: {source}"))
    if findings:
        raise UnpinnableClockError(tuple(n for n, _ in findings), expressions=tuple(findings))


@contextmanager
def _guard_sql(engine: Engine) -> Iterator[None]:
    starts: list[datetime] = []

    def begin(connection: Connection) -> None:
        if connection.engine.url == engine.url:
            connection.info["oracle_starts"] = starts
            driver = cast(
                DriverConnection[tuple[object, ...]], connection.connection.driver_connection
            )
            with driver.cursor() as cursor:
                cursor.execute("SELECT pg_catalog.transaction_timestamp()")
                row = cursor.fetchone()
                assert row is not None
                starts.append(cast(datetime, row[0]))

    def check(connection: Connection, _cursor: object, statement: str, *_unused: object) -> None:
        if connection.engine.url == engine.url:
            assert_ddl_clock_pinned(statement)

    event.listen(Engine, "begin", begin)
    event.listen(Engine, "before_cursor_execute", check)
    try:
        yield
    finally:
        event.remove(Engine, "before_cursor_execute", check)
        event.remove(Engine, "begin", begin)


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
        with _guard_sql(engine):
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
