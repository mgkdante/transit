from importlib import import_module

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, ProgrammingError

migration = import_module("transit_ops.db.migrations.versions.0098_network_vehicle_day")
TABLE = "gold.network_vehicle_day"
INSERT = f"INSERT INTO {TABLE} VALUES ('network', 1, '2026-11-13', 2, 2, 1, 'inputs')"


@pytest.fixture
def conn(real_db_engine):
    with real_db_engine.connect() as connection, connection.begin() as transaction:
        yield connection
        transaction.rollback()


def test_upgrade_creates_an_empty_table_and_downgrade_removes_it(conn, monkeypatch):
    monkeypatch.setattr(migration.op, "execute", conn.exec_driver_sql)
    with conn.begin_nested() as checkpoint:
        migration.downgrade()
        assert conn.exec_driver_sql(f"SELECT to_regclass('{TABLE}')").scalar() is None
        with conn.begin_nested() as interrupted:
            migration.upgrade()
            interrupted.rollback()
        assert conn.exec_driver_sql(f"SELECT to_regclass('{TABLE}')").scalar() is None
        migration.upgrade()
        assert conn.exec_driver_sql(f"SELECT count(*) FROM {TABLE}").scalar_one() == 0
        checkpoint.rollback()


def test_table_references_no_existing_table(conn):
    assert (
        conn.exec_driver_sql(
            "SELECT confrelid FROM pg_constraint "
            f"WHERE contype='f' AND conrelid='{TABLE}'::regclass"
        ).all()
        == []
    )


def test_counts_are_checked(conn):
    conn.exec_driver_sql(INSERT)
    for assignment in (
        "vehicles_reporting=-1",
        "vehicles_on_trip=-1",
        "captures_read=-1",
        "vehicles_on_trip=3",
    ):
        with pytest.raises(IntegrityError), conn.begin_nested():
            conn.exec_driver_sql(f"UPDATE {TABLE} SET {assignment}")
    assert conn.exec_driver_sql(
        f"SELECT vehicles_reporting, vehicles_on_trip FROM {TABLE}"
    ).one() == (2, 2)
    with pytest.raises(IntegrityError), conn.begin_nested():
        conn.exec_driver_sql(INSERT)
    conn.exec_driver_sql(
        f"INSERT INTO {TABLE} VALUES ('network', 2, '2026-11-13', 0, 0, 0, 'other')"
    )
    assert conn.exec_driver_sql(f"SELECT revision FROM {TABLE} ORDER BY revision").all() == [
        (1,),
        (2,),
    ]


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
        assert conn.exec_driver_sql(f"UPDATE {TABLE} SET captures_read=2").rowcount == 1
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
