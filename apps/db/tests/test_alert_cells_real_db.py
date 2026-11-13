from importlib import import_module

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, ProgrammingError

migration = import_module("transit_ops.db.migrations.versions.0099_alert_cell_day")
TABLE = "gold.alert_cell_day"
INDEXES = ("gold.alert_cell_day_pkey", "gold.alert_cell_day_service_date_idx")
INSERT = f"""INSERT INTO {TABLE} VALUES
    ('network', 1, 'line', 'route', '2026-11-13', 'weather', 'delay',
     2, 1, 1, 9000000000, 1, 'approximate', 'at_close')"""


@pytest.fixture
def conn(real_db_engine):
    with real_db_engine.connect() as connection, connection.begin() as transaction:
        yield connection
        transaction.rollback()


def _assert_relations(conn, *, present):
    for relation in (TABLE, *INDEXES):
        exists = conn.execute(text("SELECT to_regclass(:r)"), {"r": relation}).scalar()
        assert (exists is not None) == present


def test_upgrade_creates_an_empty_table_and_downgrade_removes_it(conn, monkeypatch):
    monkeypatch.setattr(migration.op, "execute", conn.exec_driver_sql)
    with conn.begin_nested() as checkpoint:
        migration.downgrade()
        _assert_relations(conn, present=False)
        with conn.begin_nested() as interrupted:
            migration.upgrade()
            interrupted.rollback()
        _assert_relations(conn, present=False)
        migration.upgrade()
        _assert_relations(conn, present=True)
        assert conn.exec_driver_sql(f"SELECT count(*) FROM {TABLE}").scalar_one() == 0
        migration.downgrade()
        _assert_relations(conn, present=False)
        checkpoint.rollback()


def test_table_references_no_existing_table(conn):
    assert (
        conn.exec_driver_sql(
            "SELECT confrelid FROM pg_constraint "
            f"WHERE contype='f' AND conrelid='{TABLE}'::regclass"
        ).all()
        == []
    )


def test_key_holds_one_row_per_entity_day_cause_and_effect(conn):
    conn.exec_driver_sql(INSERT)
    with pytest.raises(IntegrityError) as error, conn.begin_nested():
        conn.exec_driver_sql(INSERT)
    assert error.value.orig.sqlstate == "23505"
    for old, new in (
        ("'weather'", "'construction'"),
        ("'delay'", "'detour'"),
        ("'network', 1", "'network', 2"),
        ("'line'", "'stop'"),
        ("'weather'", "'not_given'"),
    ):
        conn.exec_driver_sql(INSERT.replace(old, new))
    assert conn.exec_driver_sql(
        f"SELECT revision, scope, cause, effect FROM {TABLE} ORDER BY 1, 2, 3, 4"
    ).all() == [
        (1, "line", "construction", "delay"),
        (1, "line", "not_given", "delay"),
        (1, "line", "weather", "delay"),
        (1, "line", "weather", "detour"),
        (1, "stop", "weather", "delay"),
        (2, "line", "weather", "delay"),
    ]


def test_values_are_checked(conn):
    conn.exec_driver_sql(INSERT)
    for assignment in (
        "scope='other'",
        "cause=''",
        "effect=''",
        "alert_days_active=-1",
        "episodes_started=-1",
        "episodes_ended=-1",
        "active_seconds=-1",
        "episodes_open_at_day_start=-1",
        "attribution='other'",
        "built='other'",
        "scope='network'",
        "entity_id=''",
        "scope='stop', entity_id=''",
    ):
        with pytest.raises(IntegrityError) as error, conn.begin_nested():
            conn.exec_driver_sql(f"UPDATE {TABLE} SET {assignment}")
        assert error.value.orig.sqlstate == "23514"
    conn.exec_driver_sql(INSERT.replace("'line', 'route'", "'network', ''"))
    conn.exec_driver_sql(
        f"UPDATE {TABLE} SET attribution='exact', built='backfill', alert_days_active=0, "
        "episodes_started=0, episodes_ended=0, active_seconds=0, episodes_open_at_day_start=0 "
        "WHERE scope='network'"
    )
    assert conn.exec_driver_sql(
        f"SELECT scope, entity_id, active_seconds FROM {TABLE} ORDER BY scope"
    ).all() == [("line", "route", 9000000000), ("network", "", 0)]


@pytest.mark.parametrize("pipeline_creator", [False, True])
def test_privileges_hold_whoever_creates_the_table(conn, monkeypatch, pipeline_creator):
    monkeypatch.setattr(migration.op, "execute", conn.exec_driver_sql)
    with conn.begin_nested() as checkpoint:
        migration.downgrade()
        for role in ("transit_app", "transit-db"):
            if not conn.execute(
                text("SELECT 1 FROM pg_roles WHERE rolname=:r"), {"r": role}
            ).scalar():
                conn.exec_driver_sql(f'CREATE ROLE "{role}"')
        if pipeline_creator:
            conn.exec_driver_sql(
                "GRANT USAGE, CREATE ON SCHEMA gold TO transit_app WITH GRANT OPTION"
            )
            conn.exec_driver_sql("SET LOCAL ROLE transit_app")
        migration.upgrade()
        _assert_privileges(conn)
        if not pipeline_creator:
            conn.exec_driver_sql("SET LOCAL ROLE transit_app")
        assert conn.exec_driver_sql("SELECT current_user").scalar_one() == "transit_app"
        conn.exec_driver_sql(INSERT)
        assert conn.exec_driver_sql(f"UPDATE {TABLE} SET episodes_started=2").rowcount == 1
        assert conn.exec_driver_sql(f"DELETE FROM {TABLE}").rowcount == 1
        with pytest.raises(ProgrammingError) as error, conn.begin_nested():
            conn.exec_driver_sql(f"TRUNCATE {TABLE}")
        assert error.value.orig.sqlstate == "42501"
        checkpoint.rollback()


def _assert_privileges(conn):
    assert (
        conn.exec_driver_sql(f"""
        SELECT count(*) FROM pg_class c,
        LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
        WHERE c.oid='{TABLE}'::regclass AND a.grantee=0
    """).scalar_one()
        == 0
    )
    for role in ("transit_app", "transit-db"):
        assert conn.execute(
            text("SELECT has_schema_privilege(:r, 'gold', 'USAGE')"), {"r": role}
        ).scalar_one()
        for privilege in (
            "SELECT",
            "INSERT",
            "UPDATE",
            "DELETE",
            "TRUNCATE",
            "REFERENCES",
            "TRIGGER",
        ):
            expected = privilege == "SELECT" or (
                role == "transit_app" and privilege in ("INSERT", "UPDATE", "DELETE")
            )
            assert (
                conn.execute(
                    text("SELECT has_table_privilege(:r,:t,:p)"),
                    {"r": role, "t": TABLE, "p": privilege},
                ).scalar_one()
                == expected
            )
