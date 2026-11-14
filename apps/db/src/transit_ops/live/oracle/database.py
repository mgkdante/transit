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
_CLOCK_CALLS = re.compile(
    r'(?<![\w$])(?:(?P<schema>"(?:[^"]|"")+"|[\w$]+)\s*\.\s*)?'
    r'(?P<name>"?(?:' + "|".join(_CLOCK_FUNCTIONS) + r')"?)(?![\w$])\s*\(',
    re.IGNORECASE,
)
_SQL_TOKEN = re.compile(
    r"\s+|--[^\n]*|(?P<tag>\$(?:[A-Za-z_]\w*)?\$)(?P<body>.*?)(?P=tag)"
    r"|'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|::|[\w$]+|[^\s]",
    re.DOTALL,
)
_SPECIAL_VALUE = r"'\s*(?:now|today|tomorrow|yesterday)\s*'"
_TIME_TYPE = (
    r'(?<![\w$])(?:"?pg_catalog"?\s*\.\s*)?"?(?:date|timestamp|timestamptz|timetz|time)"?'
    r"(?:\s*\(\s*\d+\s*\))?(?:\s+(?:with|without)\s+time\s+zone)?(?![\w$])"
)
_LITERAL_CAST = re.compile(
    rf"{_SPECIAL_VALUE}\s*::\s*{_TIME_TYPE}|{_TIME_TYPE}\s*{_SPECIAL_VALUE}"
    rf"|CAST\s*\(\s*{_SPECIAL_VALUE}\s+AS\s+{_TIME_TYPE}\s*\)",
    re.IGNORECASE,
)
_SQL_IDENT = r'"(?:""|[^"])+"|[\w$]+'
_DDL_TARGET = re.compile(
    r"^(?:CREATE(?: OR REPLACE)?|ALTER) (?:UNLOGGED |TEMPORARY |TEMP )?"
    r"(?P<kind>MATERIALIZED VIEW|TABLE|VIEW|FUNCTION|PROCEDURE|DOMAIN) (?:ONLY |IF NOT EXISTS )?"
    rf"(?P<name>(?:{_SQL_IDENT})(?:\s*\.\s*(?:{_SQL_IDENT}))?)",
    re.IGNORECASE,
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
    SELECT n.nspname,
           format('%I.%I.%I', n.nspname, COALESCE(c.relname, t.typname), d.conname),
           'pg_constraint'::regclass, d.oid, d.conbin::text,
           pg_get_constraintdef(d.oid), false
    FROM pg_constraint d JOIN pg_namespace n ON n.oid = d.connamespace
    LEFT JOIN pg_class c ON c.oid = d.conrelid LEFT JOIN pg_type t ON t.oid = d.contypid
    WHERE d.contype = 'c'
    UNION ALL
    SELECT n.nspname, format('%I.%I', n.nspname, p.proname), 'pg_proc'::regclass, p.oid,
           p.prosqlbody::text,
           CASE WHEN l.lanname IN ('sql', 'plpgsql')
                THEN COALESCE(NULLIF(p.prosrc, ''), pg_get_functiondef(p.oid)) ELSE '' END
                || ' ' || COALESCE(array_to_string(p.proconfig, '; '), ''),
           EXISTS (SELECT FROM unnest(p.proconfig) setting WHERE setting LIKE 'search_path=%')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang WHERE p.prokind = 'f'
)
SELECT o.name, o.expression, o.source, o.own_path, EXISTS (
    SELECT FROM pg_depend d JOIN pg_proc p ON p.oid = d.refobjid
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE d.classid = o.classid AND d.objid = o.objid AND d.refclassid = 'pg_proc'::regclass
      AND p.proname = ANY(:functions)
      AND (n.nspname <> :clock_schema OR p.proname = 'timeofday')
) AS catalog_dependency
FROM objects o WHERE o.schema = ANY(:schemas)
"""


class UnpinnableClockError(RuntimeError):
    objects: tuple[str, ...]
    expressions: tuple[tuple[str, str], ...]

    def __init__(
        self, objects: tuple[str, ...], *, expressions: tuple[tuple[str, str], ...] = ()
    ) -> None:
        self.objects = tuple(sorted(set(objects)))
        self.expressions = tuple(sorted(set(expressions)))
        details = self.expressions or tuple((name, "") for name in self.objects)
        super().__init__("Unpinnable clock in:\n" + "\n".join(f"{n}: {e}" for n, e in details))


def _sql_tokens(sql: str) -> Iterator[str]:
    position = 0
    while position < len(sql):
        if sql.startswith("/*", position):
            depth, position = 1, position + 2
            while depth:
                marker = re.search(r"/\*|\*/", sql[position:])
                if marker is None:
                    raise ValueError("Unterminated SQL comment")
                depth += 1 if marker[0] == "/*" else -1
                position += marker.end()
            continue
        match = _SQL_TOKEN.match(sql, position)
        assert match is not None
        position = match.end()
        if not match[0].isspace() and not match[0].startswith("--"):
            yield match[0]


def _literal_source(sql: str, *, expand: bool = False) -> str:
    parts = []
    for token in _sql_tokens(sql):
        match = _SQL_TOKEN.fullmatch(token)
        assert match is not None
        if match["body"] is not None:
            parts.append(_literal_source(match["body"], expand=True) if expand else "''")
        else:
            special = re.fullmatch(_SPECIAL_VALUE, token, re.IGNORECASE)
            parts.append("''" if token.startswith("'") and not special else token)
    return " ".join(parts)


def assert_ddl_clock_pinned(statement: str) -> None:
    tokens: list[str] = []
    expressions: list[tuple[str, str]] = []
    for token in _sql_tokens(statement + ";"):
        if token != ";":
            tokens.append(token)
            continue
        source, tokens = " ".join(tokens), []
        target = _DDL_TARGET.match(source)
        expand = bool(target and target["kind"].upper() in {"FUNCTION", "PROCEDURE"})
        casts = tuple(_LITERAL_CAST.finditer(_literal_source(source, expand=expand)))
        if casts:
            name = re.sub(r"\s*\.\s*", ".", target["name"]) if target else "migration.statement"
            name = ".".join(str(_identifier(p[0])) for p in re.finditer(_SQL_IDENT, name))
            expressions.extend((name, cast[0]) for cast in casts)
    if expressions:
        raise UnpinnableClockError(tuple(n for n, _ in expressions), expressions=tuple(expressions))


@contextmanager
def _guard_sql(engine: Engine) -> Iterator[None]:
    def check(connection: Connection, _cursor: object, statement: str, *_unused: object) -> None:
        if connection.engine.url == engine.url:
            assert_ddl_clock_pinned(statement)

    event.listen(Engine, "before_cursor_execute", check)
    try:
        yield
    finally:
        event.remove(Engine, "before_cursor_execute", check)


def _identifier(value: str | None) -> str | None:
    if value is None:
        return None
    return value[1:-1].replace('""', '"') if value.startswith('"') else value.lower()


def _has_unpinned_call(source: str) -> bool:
    return any(
        _identifier(match["schema"]) not in (None, CLOCK_SCHEMA)
        or _identifier(match["name"]) not in _CLOCK_FUNCTIONS[:-1]
        for match in _CLOCK_CALLS.finditer(source)
    )


def assert_clock_pinned(connection: Connection) -> None:
    params = {
        "functions": list(_CLOCK_FUNCTIONS),
        "schemas": ["core", "gold", "silver", "raw", "ops"],
        "clock_schema": CLOCK_SCHEMA,
    }
    ids = connection.execute(
        text("""
        SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = ANY(:functions)
          AND (n.nspname <> :clock_schema OR p.proname = 'timeofday')
    """),
        params,
    ).scalars()
    # Dependencies on pinned built-ins are omitted; stored trees retain bound function OIDs.
    bound = re.compile(r":funcid (?:" + "|".join(str(oid) for oid in ids) + r")\b")
    expressions = tuple(
        (str(name), str(source))
        for name, expression, source, own_path, dependency in connection.execute(
            text(_CLOCK_OBJECTS_SQL), params
        )
        if own_path
        or dependency
        or bound.search(expression or "")
        or _CLOCK_KEYWORDS.search(source)
        or _has_unpinned_call(source)
        or _LITERAL_CAST.search(_literal_source(source, expand=True))
    )
    if expressions:
        raise UnpinnableClockError(tuple(n for n, _ in expressions), expressions=expressions)


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
