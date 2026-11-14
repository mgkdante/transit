import os
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import MagicMock

import psycopg
import pytest
import real_db_seed as db_seed
from alembic import command
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from transit_ops.db.target_safety import assert_disposable_test_url
from transit_ops.live.oracle import database
from transit_ops.live.oracle.database import (
    OracleDatabaseRefused,
    PinnedClock,
    UnpinnableClockError,
    assert_clock_pinned,
    assert_ddl_clock_pinned,
    function_clock_reason,
    oracle_database,
)

ENVIRONMENT = {"TRANSIT_TEST_DATABASE_DISPOSABLE": "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE"}


def value(conn, sql, **params):
    return conn.execute(text(sql), params).scalar()


@pytest.mark.parametrize(
    "database",
    [
        "transit_ci_oracle_0123456789abcdef",
        "transit_ci_xdist_0123456789abcdef_gw2",
    ],
)
def test_oracle_names_pass_the_policy_only_for_approved_bases(database):
    assert_disposable_test_url(f"postgresql://transit_ci@localhost/{database}", ENVIRONMENT)


@pytest.mark.parametrize("database", ["other_oracle_0123456789abcdef", "transit_ci_oracle_XYZ"])
def test_unapproved_oracle_names_are_refused(database):
    with pytest.raises(RuntimeError, match="Disposable test database target policy failed"):
        assert_disposable_test_url(f"postgresql://transit_ci@localhost/{database}", ENVIRONMENT)


def test_clock_keeps_microseconds_and_rejects_naive_values():
    instant = datetime(2025, 1, 10, 12, 0, 0, 123456, timezone(timedelta(hours=-5)))
    clock = PinnedClock(instant)
    assert clock.instant == datetime(2025, 1, 10, 17, 0, 0, 123456, UTC)
    with pytest.raises(ValueError, match="aware"):
        clock.set(datetime(2025, 1, 10))
    assert clock.instant.microsecond == 123456
    with pytest.raises(ValueError, match="aware"):
        PinnedClock(datetime(2025, 1, 10))


@pytest.mark.parametrize(
    "url,environment",
    [
        ("postgresql://transit_ci@remote.invalid/transit_ci", ENVIRONMENT),
        ("postgresql://other@localhost/other", ENVIRONMENT),
        ("postgresql://transit_ci@localhost/transit_ci", {}),
    ],
)
def test_a_non_disposable_target_is_refused(url, environment, clock):
    with pytest.raises(OracleDatabaseRefused, match="Disposable test database target policy"):
        with oracle_database(url, clock=clock, environment=environment):
            pytest.fail("refused targets must not yield")


@pytest.fixture
def clock():
    return PinnedClock(datetime(2025, 1, 10, 17, 0, 0, 123456, UTC))


@pytest.fixture(params=["default", "url", "environment", "role"])
def oracle(real_db_engine, clock, request, monkeypatch):
    url = real_db_engine.url
    if request.param == "url":
        url = url.update_query_dict({"options": "-c search_path=public"})
    if request.param == "environment":
        monkeypatch.setenv("PGOPTIONS", "-c search_path=public")
    if request.param == "role":
        upgrade = command.upgrade

        def role_override(config, revision):
            target = create_engine(config.get_main_option("sqlalchemy.url"))
            try:
                with target.begin() as conn:
                    name = target.dialect.identifier_preparer.quote_identifier(target.url.database)
                    sql = f"ALTER ROLE CURRENT_USER IN DATABASE {name} SET search_path=public"
                    conn.exec_driver_sql(sql)
            finally:
                target.dispose()
            upgrade(config, revision)

        monkeypatch.setattr(command, "upgrade", role_override)
    admin_url = url.render_as_string(hide_password=False)
    with oracle_database(admin_url, clock=clock, environment=os.environ) as engine:
        yield engine


@pytest.mark.parametrize(
    "prefix,nested",
    [
        ("postgresql+psycopg://transit_ci@localhost/transit_ci", "hostaddr=203.0.113.10"),
        ("postgresql+psycopg://", "host=remote.invalid user=production dbname=production"),
    ],
)
def test_nested_connection_strings_never_reach_the_driver(prefix, nested, clock, monkeypatch):
    monkeypatch.setattr(psycopg, "connect", lambda *a, **k: pytest.fail("unsafe driver connection"))
    url = make_url(prefix).update_query_dict({"conninfo": nested})
    env = ENVIRONMENT | {"PGHOST": "localhost", "PGUSER": "transit_ci", "PGDATABASE": "transit_ci"}
    with pytest.raises(OracleDatabaseRefused):
        with oracle_database(
            url.render_as_string(hide_password=False), clock=clock, environment=env
        ):
            pytest.fail("nested connection string accepted")


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://transit_ci@localhost/transit_ci",
        "postgresql+psycopg://?passfile=x%00&host=localhost&hostaddr=127.0.0.1&user=transit_ci&dbname=transit_ci",
        "postgresql+psycopg://transit_ci:pw%00@localhost/transit_ci?hostaddr=127.0.0.1",
    ],
)
def test_libpq_effective_identity_is_refused_before_engines(url, clock, monkeypatch):
    fields = ("host", "hostaddr", "port", "user", "dbname")
    expected = ("localhost", "300.1.1.1", "1", "transit_ci", "transit_ci")
    defaults = dict(zip(fields, expected, strict=True))
    defaults.update(service="", servicefile="")
    for key, value in defaults.items():
        monkeypatch.setenv("PGDATABASE" if key == "dbname" else "PG" + key.upper(), value)
    parsed = make_url(url)
    args, kwargs = parsed.get_dialect()().create_connect_args(parsed)
    actual = psycopg.conninfo.conninfo_to_dict(psycopg.conninfo.make_conninfo(*args, **kwargs))
    resolved = tuple(actual.get(key) or defaults[key] for key in fields)
    assert resolved == expected
    monkeypatch.setattr(database, "create_engine", lambda *a, **k: pytest.fail("unsafe engine"))
    with pytest.raises(OracleDatabaseRefused):
        with oracle_database(url, clock=clock, environment=ENVIRONMENT):
            pytest.fail("unsafe identity accepted")


@pytest.mark.parametrize("fault", ["release", "dispose"])
def test_cleanup_survives_release_and_disposal_faults(fault, clock, monkeypatch):
    admin, engine = MagicMock(), MagicMock()
    engine.url = make_url("postgresql+psycopg://transit_ci@localhost/transit_ci")
    admin.dialect.identifier_preparer.quote_identifier.side_effect = lambda name: name
    create, drop = MagicMock(), MagicMock()
    admin.connect.side_effect = [create, drop]
    if fault == "release":
        create.__exit__.side_effect = RuntimeError("release failed")
    else:
        admin.connect.side_effect = [create, MagicMock(), drop]
        engine.dispose.side_effect = RuntimeError("dispose failed")
    monkeypatch.setattr(database, "create_engine", MagicMock(side_effect=[admin, engine]))
    monkeypatch.setattr(command, "upgrade", MagicMock(side_effect=RuntimeError("migration failed")))
    with pytest.raises(RuntimeError):
        with oracle_database(
            "postgresql+psycopg://transit_ci@localhost/transit_ci",
            clock=clock,
            environment=ENVIRONMENT,
        ):
            pytest.fail("fault must propagate")
    statements = drop.__enter__.return_value.exec_driver_sql.call_args_list
    assert any(call.args[0].startswith("DROP DATABASE ") for call in statements)
    admin.dispose.assert_called_once()


def test_migration_startup_options_enforce_the_clock_path(clock, monkeypatch):
    urls = []

    def factory(url, **kwargs):
        urls.append(url)
        engine = create_engine(url, **kwargs)
        monkeypatch.setattr(engine, "connect", MagicMock(side_effect=RuntimeError("stop")))
        return engine

    monkeypatch.setattr(database, "create_engine", factory)
    url = "postgresql+psycopg://transit_ci@localhost/transit_ci?options=-c%20search_path=public"
    with pytest.raises(RuntimeError, match="stop"):
        with oracle_database(url, clock=clock, environment=ENVIRONMENT):
            pytest.fail("connection was intercepted")
    assert (
        urls[1]
        .query["options"]
        .endswith("-c search_path=transit_oracle_clock,pg_catalog,public -c timezone=UTC")
    )


def test_views_follow_the_pinned_clock(oracle, clock, seed_provider):
    with oracle.begin() as conn:
        seed_provider(conn, "oracle_probe", display_name="Oracle probe")
        params = {"p": "oracle_probe", "e": 1, "r": 1, "s": 1, "ts": clock.instant, "n": 1}
        db_seed.feed_endpoints(conn, params)
        db_seed.ingestion_runs(conn, params)
        db_seed.realtime_snapshot_index(conn, params)
        conn.execute(
            text("""
            INSERT INTO gold.latest_trip_delay_snapshot
                (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                 snapshot_local_date, feed_timestamp_utc, captured_at_utc,
                 start_date, delay_seconds, stop_time_update_count)
            VALUES (:p, :s, 0, 20250110, '2025-01-10', :ts, :ts, '2025-01-10', 120, 1)
        """),
            params,
        )
        query = "SELECT avg_delay_seconds FROM gold.current_trip_delay_computed"
        assert value(conn, query) == Decimal("120.00")
    clock.set(clock.instant + timedelta(days=3))
    with oracle.connect() as conn:
        assert value(conn, query) is None


def test_builder_sql_and_defaults_read_the_pinned_clock(oracle, clock, seed_provider):
    with oracle.begin() as conn:
        keywords = conn.execute(
            text("SELECT CURRENT_DATE, CURRENT_TIMESTAMP, LOCALTIME, LOCALTIMESTAMP")
        ).one()
        assert keywords[0] != clock.instant.date()
        assert keywords[1] != clock.instant
        assert keywords[2] != clock.instant.time()
        assert keywords[3] != clock.instant.replace(tzinfo=None)
        query = "SELECT now(), clock_timestamp(), statement_timestamp(), transaction_timestamp()"
        assert tuple(conn.execute(text(query)).one()) == (clock.instant,) * 4
        seed_provider(conn, "oracle_probe", display_name="Oracle probe")
        stored = conn.execute(
            text("""
            INSERT INTO gold.realtime_serving_state (provider_id, endpoint_key)
            VALUES ('oracle_probe', 'trip_updates') RETURNING initialized_at_utc
        """)
        ).scalar_one()
        assert stored == clock.instant
    clock.set(clock.instant + timedelta(seconds=1))
    with oracle.connect() as conn:
        assert value(conn, "SELECT now()") == clock.instant


def test_feed_freshness_age_is_measured_from_the_pinned_clock(oracle, clock, seed_provider):
    with oracle.begin() as conn:
        seed_provider(conn, "oracle_probe", display_name="Oracle probe")
        completed = clock.instant - timedelta(seconds=90.4)
        params = {"p": "oracle_probe", "e": 1, "r": 1, "completed": completed}
        db_seed.feed_endpoints(conn, params)
        db_seed.ingestion_runs(conn, params, completed_at_utc=":completed")
        assert value(conn, "SELECT completed_age_seconds FROM gold.feed_freshness_current") == 90


@pytest.mark.parametrize("fail", [False, True])
def test_the_oracle_database_is_dropped_on_exit_and_on_failure(real_db_engine, clock, fail):
    name = None
    admin_url = real_db_engine.url.render_as_string(hide_password=False)
    try:
        with oracle_database(admin_url, clock=clock, environment=os.environ) as engine:
            name = engine.url.database
            with real_db_engine.connect() as conn:
                assert (
                    value(conn, "SELECT datname FROM pg_database WHERE datname=:name", name=name)
                    == name
                )
            if fail:
                raise ValueError("body failed")
    except ValueError as error:
        assert fail and str(error) == "body failed"
    with real_db_engine.connect() as conn:
        assert name is not None
        assert value(conn, "SELECT datname FROM pg_database WHERE datname=:name", name=name) is None


def test_migration_failure_drops_the_created_database(real_db_engine, clock, monkeypatch):
    names = []

    def fail_upgrade(config, revision):
        names.append(make_url(config.get_main_option("sqlalchemy.url")).database)
        raise RuntimeError("migration failed")

    monkeypatch.setattr(command, "upgrade", fail_upgrade)
    admin_url = real_db_engine.url.render_as_string(hide_password=False)
    with pytest.raises(RuntimeError, match="migration failed"):
        with oracle_database(admin_url, clock=clock, environment=os.environ):
            pytest.fail("failed migration must not yield")
    with real_db_engine.connect() as conn:
        assert names
        assert (
            value(conn, "SELECT datname FROM pg_database WHERE datname=:name", name=names[0])
            is None
        )


@pytest.fixture
def guard_oracle(real_db_engine, clock):
    with oracle_database(
        real_db_engine.url.render_as_string(hide_password=False),
        clock=clock,
        environment=os.environ,
    ) as engine:
        yield engine


@pytest.mark.parametrize(
    "expression", ["'now'::date", "TIMESTAMP 'today'", "CAST('yesterday' AS time)"]
)
def test_cheap_literal_precheck(expression):
    with pytest.raises(UnpinnableClockError):
        assert_ddl_clock_pinned(f"CREATE VIEW gold.probe AS SELECT {expression}")


@pytest.mark.parametrize(
    "ddl,owner",
    [
        ("CREATE VIEW gold.probe AS SELECT CURRENT_DATE", "gold.probe"),
        ("CREATE MATERIALIZED VIEW gold.probe AS SELECT CURRENT_TIME", "gold.probe"),
        ("CREATE TABLE gold.probe (at timestamptz DEFAULT pg_catalog.now())", "gold.probe.at"),
        ("CREATE TABLE gold.probe (at date CHECK(at < CURRENT_DATE))", "gold.probe.probe_at_check"),
        ("CREATE DOMAIN gold.probe AS date DEFAULT CURRENT_DATE", "gold.probe"),
        ("CREATE DOMAIN gold.probe AS date CHECK(VALUE<CURRENT_DATE)", "gold.probe.probe_check"),
        (
            "CREATE FUNCTION public.now() RETURNS int LANGUAGE sql IMMUTABLE AS $$SELECT 1$$;"
            "CREATE TABLE gold.probe(at int GENERATED ALWAYS AS(public.now()) STORED)",
            "gold.probe.at",
        ),
        (
            "CREATE FUNCTION gold.probe(d timestamptz DEFAULT pg_catalog.now()) "
            "RETURNS timestamptz LANGUAGE sql AS $$SELECT d$$",
            "gold.probe(timestamp with time zone)",
        ),
        (
            "CREATE FUNCTION gold.probe(d date DEFAULT CURRENT_DATE) "
            "RETURNS date LANGUAGE sql AS $$SELECT d$$",
            "gold.probe(date)",
        ),
        (
            "CREATE FUNCTION gold.probe() RETURNS date LANGUAGE sql "
            "BEGIN ATOMIC SELECT CURRENT_DATE; END",
            "gold.probe()",
        ),
        (
            "CREATE FUNCTION gold.probe() RETURNS int LANGUAGE sql "
            "SET search_path=public AS $$SELECT 1$$",
            "gold.probe()",
        ),
    ],
)
def test_deparsed_catalog_covers_each_owner(guard_oracle, ddl, owner):
    with guard_oracle.begin() as conn:
        conn.exec_driver_sql(ddl)
        with pytest.raises(UnpinnableClockError) as error:
            assert_clock_pinned(conn)
        assert error.value.objects == (owner,)
        assert dict(error.value.expressions)[owner]


def test_dependency_only_default_is_refused(guard_oracle):
    with guard_oracle.begin() as conn:
        conn.exec_driver_sql(
            "CREATE FUNCTION public.now() RETURNS timestamptz "
            "LANGUAGE sql AS $$SELECT pg_catalog.now()$$"
        )
        conn.exec_driver_sql(
            "CREATE FUNCTION gold.probe(d timestamptz DEFAULT public.now()) "
            "RETURNS timestamptz LANGUAGE sql AS $$SELECT d$$"
        )
        conn.exec_driver_sql("SET LOCAL search_path=public,pg_catalog")
        assert (
            value(
                conn,
                "SELECT pg_get_expr(proargdefaults,0) FROM pg_proc "
                "WHERE oid='gold.probe(timestamptz)'::regprocedure",
            )
            == "now()"
        )
        with pytest.raises(UnpinnableClockError) as error:
            assert_clock_pinned(conn)
        assert error.value.expressions == (
            ("gold.probe(timestamp with time zone)", "clock dependency: now()"),
        )


def test_runtime_cast_detector_is_independent(guard_oracle):
    with guard_oracle.begin() as conn:
        conn.exec_driver_sql("CREATE VIEW gold.probe AS SELECT 'now'::text::timestamptz")
        with pytest.raises(UnpinnableClockError, match="clock literal cast"):
            assert_clock_pinned(conn)


@pytest.mark.parametrize("offset", [0, -1, 1, 7])
def test_ddl_result_detector_is_independent(guard_oracle, offset):
    with guard_oracle.begin() as conn:
        start = value(conn, "SELECT pg_catalog.transaction_timestamp()")
        literal = (
            start.isoformat()
            if offset == 0
            else (start.date() + timedelta(days=offset)).isoformat()
        )
        kind = "timestamptz" if offset == 0 else "date"
        conn.exec_driver_sql(f"CREATE VIEW gold.probe AS SELECT '{literal}'::{kind}")
        if offset == 7:
            assert_clock_pinned(conn, migration_starts=[start])
        else:
            with pytest.raises(UnpinnableClockError, match="clock literal resolved at DDL time"):
                assert_clock_pinned(conn, migration_starts=[start])


@pytest.mark.parametrize(
    "expression",
    [
        "'CURRENT_DATE'::text",
        "'pg_catalog.now()'::text",
        '1 AS "current_time"',
        "1 /* pg_catalog.now() */",
        "1 -- CURRENT_DATE\n",
        "now()",
    ],
)
def test_deparsed_non_code_and_pinned_view_pass(guard_oracle, expression):
    with guard_oracle.begin() as conn:
        conn.exec_driver_sql(f"CREATE VIEW gold.probe AS SELECT {expression}")
        assert_clock_pinned(conn)


@pytest.mark.parametrize(
    "ddl,owner",
    [
        *[
            (f"CREATE VIEW gold.probe AS SELECT {expr}", "gold.probe")
            for expr in (
                "('now')::timestamptz",
                "CAST(('today') AS date)",
                "$$tomorrow$$::date",
                "date('yesterday')",
                r"E'tod\141y'::date",
                "'now'::text::timestamptz",
                r"(E'no\167')::time",
                r"(E'no\167')::timetz",
            )
        ],
        ("CREATE TABLE gold.probe (at timestamptz DEFAULT 'now')", "gold.probe.at"),
        ("CREATE TABLE gold.probe (at date CHECK(at > 'yesterday'))", "gold.probe.probe_at_check"),
        ("DO $$ BEGIN CREATE VIEW gold.probe AS SELECT DATE 'today'; END $$", "gold.probe"),
        (
            "CREATE FUNCTION gold.probe() RETURNS date LANGUAGE sql "
            "BEGIN ATOMIC SELECT 1; SELECT DATE 'today'; END",
            "gold.probe()",
        ),
    ],
)
def test_migration_spellings_are_refused_and_cleaned(
    real_db_engine, clock, monkeypatch, ddl, owner
):
    upgrade, names = command.upgrade, []

    def migrate(config, revision):
        upgrade(config, revision)
        engine = create_engine(config.get_main_option("sqlalchemy.url"))
        names.append(engine.url.database)
        try:
            with engine.begin() as conn:
                conn.exec_driver_sql(ddl)
        finally:
            engine.dispose()

    monkeypatch.setattr(command, "upgrade", migrate)
    with pytest.raises(UnpinnableClockError) as error:
        with oracle_database(
            real_db_engine.url.render_as_string(hide_password=False),
            clock=clock,
            environment=os.environ,
        ):
            pytest.fail("must refuse before yield")
    assert error.value.objects == (owner,)
    with real_db_engine.connect() as conn:
        assert value(conn, "SELECT datname FROM pg_database WHERE datname=:n", n=names[0]) is None


@pytest.mark.parametrize(
    "source,unsafe",
    [
        ("SELECT pg_catalog./* comment */now()", True),
        ("SELECT pg_catalog.now/* comment */()", True),
        ("SELECT pg_catalog -- comment\n .now()", True),
        ("SELECT CURRENT_DATE", True),
        ("SELECT CURRENT_TIME", True),
        ("SELECT CURRENT_TIMESTAMP", True),
        ("SELECT LOCALTIME", True),
        ("SELECT LOCALTIMESTAMP", True),
        ("BEGIN RETURN ('today')::date; END", True),
        ("BEGIN RETURN 'today'; END", True),
        ("SELECT 'now'::text::timestamptz", True),
        (r"SELECT E'tod\141y'", True),
        ("SELECT $$tomorrow$$", True),
        ("SELECT ' YeStErDaY '", True),
        (r"SELECT U&'t\006fday'", True),
        ("SELECT 'CURRENT_DATE'::text", False),
        ("SELECT 'pg_catalog.now()'::text", False),
        ("SELECT 1 -- CURRENT_DATE\n", False),
        ("SELECT 1 /* 'today' pg_catalog.now() */", False),
        ('SELECT 1 AS "current_time"', False),
        ('SELECT 1 AS "a(current_date())"', False),
        ('SELECT 1 /* nested /* CURRENT_DATE */ today */ AS "today"', False),
        (r'SELECT U&"current\005ftime"', False),
        (r'SELECT U&"pg_catalog".U&"n\006fw"()', True),
        (r"SELECT U&'t!006fday' UESCAPE '!'", True),
        ("SELECT now()", False),
        ("SELECT now_utc", False),
    ],
)
def test_function_lexer_public_boundary(source, unsafe):
    assert bool(function_clock_reason(source)) is unsafe


def test_function_lexer_respects_standard_strings():
    source = r"SELECT 'tod\141y'"
    assert not function_clock_reason(source, standard_strings=True)
    assert function_clock_reason(source, standard_strings=False) == "clock literal in function body"


@pytest.mark.parametrize(
    "body,dtype,unsafe",
    [
        ("LANGUAGE sql AS $$SELECT pg_catalog./* comment */now()::date$$", "date", True),
        ("LANGUAGE sql AS $$SELECT pg_catalog.now/* comment */()::date$$", "date", True),
        ("LANGUAGE plpgsql AS $$BEGIN RETURN 'today'; END$$", "date", True),
        (r"LANGUAGE sql AS $$SELECT E'tod\141y'::date$$", "date", True),
        (
            "LANGUAGE plpgsql SET standard_conforming_strings=off "
            r"AS $$BEGIN RETURN 'tod\141y'; END$$",
            "date",
            True,
        ),
        ("LANGUAGE sql AS $$SELECT 'now'::text::date$$", "date", True),
        ("LANGUAGE sql AS $$SELECT 'CURRENT_DATE'::text$$", "text", False),
        ("LANGUAGE sql AS $$SELECT 'pg_catalog.now()'::text$$", "text", False),
        ("LANGUAGE sql AS $$SELECT 1 -- CURRENT_DATE\n$$", "integer", False),
        ("LANGUAGE sql AS $$SELECT 1 /* pg_catalog.now() */$$", "integer", False),
        ('LANGUAGE sql AS $$SELECT 1 AS "current_time"$$', "integer", False),
    ],
)
def test_string_bodies_on_postgres(guard_oracle, body, dtype, unsafe):
    with guard_oracle.begin() as conn:
        conn.exec_driver_sql(f"CREATE FUNCTION gold.body_probe() RETURNS {dtype} {body}")
        if unsafe:
            with pytest.raises(UnpinnableClockError) as error:
                assert_clock_pinned(conn)
            assert error.value.objects == ("gold.body_probe()",)
            assert dict(error.value.expressions)["gold.body_probe()"]
        else:
            assert_clock_pinned(conn)


def test_overloads_have_individual_diagnostics(guard_oracle):
    with guard_oracle.begin() as conn:
        for dtype in ("integer", "text"):
            conn.exec_driver_sql(
                f"CREATE FUNCTION gold.overload({dtype}) RETURNS date "
                "LANGUAGE sql AS $$SELECT CURRENT_DATE$$"
            )
        with pytest.raises(UnpinnableClockError) as error:
            assert_clock_pinned(conn)
        assert error.value.objects == ("gold.overload(integer)", "gold.overload(text)")
        assert all("SELECT CURRENT_DATE" in expr for _, expr in error.value.expressions)


@pytest.mark.parametrize(
    "expression",
    [
        "CURRENT_DATE",
        "CURRENT_TIME",
        "CURRENT_TIMESTAMP(3)",
        "LOCALTIME",
        "LOCALTIMESTAMP",
        "pg_catalog.now()",
        "pg_catalog.clock_timestamp()",
        "pg_catalog.statement_timestamp()",
        "pg_catalog.transaction_timestamp()",
        "pg_catalog.timeofday()",
    ],
)
def test_each_deparsed_clock_form_is_scan_only(guard_oracle, expression):
    with guard_oracle.begin() as conn:
        conn.exec_driver_sql(f"CREATE VIEW gold.clock_form AS SELECT {expression}")
        with pytest.raises(UnpinnableClockError) as error:
            assert_clock_pinned(conn)
        assert error.value.objects == ("gold.clock_form",)
        assert dict(error.value.expressions)["gold.clock_form"].startswith("clock expression:")
