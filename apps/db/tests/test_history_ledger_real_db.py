from importlib import import_module

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

migration = import_module("transit_ops.db.migrations.versions.0097_history_ledger")
TABLES = ("history_window", "history_archive_copy", "history_event", "pipeline_switches")
KEY = "'sample', 'network', 0, '2026-11'"


@pytest.fixture
def conn(real_db_engine):
    with real_db_engine.connect() as connection, connection.begin() as transaction:
        yield connection
        transaction.rollback()


def _exists(conn):
    return [conn.exec_driver_sql(f"SELECT to_regclass('core.{t}')").scalar() for t in TABLES]


def _refused(conn, sql):
    with pytest.raises(IntegrityError), conn.begin_nested():
        conn.exec_driver_sql(sql)


def _window(conn):
    conn.exec_driver_sql(
        "INSERT INTO core.history_window "
        "(dataset_id,provider_id,revision,window_key,working_state,working_changed_at_utc) "
        f"VALUES ({KEY},'present',now())"
    )


def _copy(conn, key=KEY):
    conn.exec_driver_sql(
        "INSERT INTO core.history_archive_copy "
        "(dataset_id,provider_id,revision,window_key,content_version,schema_version,"
        f"storage_backend,allocated_at_utc) VALUES ({key},1,1,'local',now())"
    )


def test_upgrade_creates_four_empty_tables_and_downgrade_removes_them(conn, monkeypatch):
    monkeypatch.setattr(migration.op, "execute", conn.exec_driver_sql)
    with conn.begin_nested() as checkpoint:
        migration.downgrade()
        assert _exists(conn) == [None] * 4
        with conn.begin_nested() as interrupted:
            migration.upgrade()
            interrupted.rollback()
        assert _exists(conn) == [None] * 4
        migration.upgrade()
        assert all(_exists(conn))
        for table in TABLES:
            assert conn.exec_driver_sql(f"SELECT count(*) FROM core.{table}").scalar() == 0
        checkpoint.rollback()


def test_ledger_tables_reference_no_existing_table(conn):
    rows = conn.execute(
        text("""
        SELECT conrelid::regclass::text, confrelid::regclass::text
        FROM pg_constraint WHERE contype='f' AND conrelid IN
        (SELECT oid FROM pg_class WHERE relnamespace='core'::regnamespace
         AND relname = ANY(:tables))
    """),
        {"tables": list(TABLES)},
    ).all()
    assert rows == [("core.history_archive_copy", "core.history_window")]


def test_copy_state_follows_its_timestamps(conn):
    _window(conn)
    _copy(conn)
    assert conn.exec_driver_sql(
        "SELECT sealed_at_utc, verified_at_utc, rejected_at_utc FROM core.history_archive_copy"
    ).one() == (None, None, None)
    conn.exec_driver_sql("UPDATE core.history_archive_copy SET sealed_at_utc=now()")
    conn.exec_driver_sql("UPDATE core.history_archive_copy SET verified_at_utc=now()")
    row = conn.exec_driver_sql(
        "SELECT allocated_at_utc, sealed_at_utc, verified_at_utc FROM core.history_archive_copy"
    ).one()
    assert row[0] <= row[1] <= row[2]
    for assignment in (
        "sealed_at_utc=NULL",
        "sealed_at_utc=allocated_at_utc - interval '1 second'",
        "verified_at_utc=sealed_at_utc - interval '1 second'",
        "rejected_at_utc=now()",
        "reject_reason='bad'",
    ):
        _refused(conn, f"UPDATE core.history_archive_copy SET {assignment}")
    conn.exec_driver_sql(
        "UPDATE core.history_archive_copy SET rejected_at_utc=now(), reject_reason='bad'"
    )


def test_event_kind_is_one_of_the_declared_kinds(conn):
    sql = (
        "INSERT INTO core.history_event "
        "(dataset_id,provider_id,revision,window_key,kind,actor) "
        f"VALUES ({KEY}, :kind, 'test') RETURNING kind"
    )
    kinds = (
        "seal verify reject current trim restore hold unhold changed close_runs "
        "fold_published processing_evidence rebuild"
    ).split()
    for kind in kinds:
        assert conn.execute(text(sql), {"kind": kind}).scalar_one() == kind
    with pytest.raises(IntegrityError), conn.begin_nested():
        conn.execute(text(sql), {"kind": "unknown"})


def test_window_and_copy_values_are_checked(conn):
    _window(conn)
    _refused(conn, "UPDATE core.history_window SET working_state='unknown'")
    with pytest.raises(IntegrityError), conn.begin_nested():
        _copy(conn, key="'missing','network',0,'2026-11'")
    _copy(conn)
    for assignment in (
        "content_version=0",
        "storage_backend='unknown'",
        "sha256='bad'",
        "manifest_sha256=repeat('A',64)",
        "content_sha256=repeat('a',63)",
        "poll_record_sha256=repeat('g',64)",
    ):
        _refused(conn, f"UPDATE core.history_archive_copy SET {assignment}")
    conn.exec_driver_sql("UPDATE core.history_archive_copy SET sha256=repeat('a',64)")


def test_new_switch_is_off_until_set(conn):
    value = conn.exec_driver_sql(
        "INSERT INTO core.pipeline_switches (switch_key,updated_at_utc,updated_by,reason) "
        "VALUES ('test',now(),'test','test') RETURNING enabled"
    ).scalar_one()
    assert value is False


def test_pipeline_role_can_write_and_cannot_delete(conn, monkeypatch):
    monkeypatch.setattr(migration.op, "execute", conn.exec_driver_sql)
    with conn.begin_nested() as checkpoint:
        migration.downgrade()
        for role in ("transit_app", "transit-db"):
            if not conn.execute(
                text("SELECT 1 FROM pg_roles WHERE rolname=:r"), {"r": role}
            ).scalar():
                conn.exec_driver_sql(f'CREATE ROLE "{role}"')
        migration.upgrade()
        for table in TABLES:
            assert (
                conn.execute(
                    text("""
                SELECT count(*) FROM pg_class c,
                LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
                WHERE c.oid=CAST(:t AS regclass) AND a.grantee=0
            """),
                    {"t": f"core.{table}"},
                ).scalar_one()
                == 0
            )
            for role in ("transit_app", "transit-db"):
                for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"):
                    expected = (
                        privilege == "SELECT"
                        or (role == "transit_app" and privilege == "INSERT")
                        or (
                            role == "transit_app"
                            and privilege == "UPDATE"
                            and table != "history_event"
                        )
                    )
                    assert (
                        conn.execute(
                            text("SELECT has_table_privilege(:r,:t,:p)"),
                            {"r": role, "t": f"core.{table}", "p": privilege},
                        ).scalar_one()
                        == expected
                    )
        checkpoint.rollback()
