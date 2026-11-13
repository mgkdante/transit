from datetime import date, datetime, timedelta, timezone
from importlib import import_module

import pytest
from history_ledger_fixtures import pipeline_role
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, OperationalError, ProgrammingError

from transit_ops.history import ledger
from transit_ops.history.datasets import UndeclaredDataset

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
        # Roll back a complete upgrade, then prove retry; no mid-DDL failure is injected.
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


@pytest.mark.parametrize("stage", [0, 1, 2])
def test_copy_state_follows_its_timestamps(conn, stage):
    _window(conn)
    _copy(conn)
    assert conn.exec_driver_sql(
        "SELECT sealed_at_utc, verified_at_utc, rejected_at_utc FROM core.history_archive_copy"
    ).one() == (None, None, None)
    if stage >= 1:
        conn.exec_driver_sql(
            "UPDATE core.history_archive_copy SET sealed_at_utc=now() + interval '1 hour'"
        )
    if stage >= 2:
        conn.exec_driver_sql(
            "UPDATE core.history_archive_copy SET verified_at_utc=now() + interval '2 hours'"
        )
    row = conn.exec_driver_sql(
        "SELECT allocated_at_utc, sealed_at_utc, verified_at_utc FROM core.history_archive_copy"
    ).one()
    times = [timestamp for timestamp in row if timestamp is not None]
    assert times == sorted(times)
    for assignment in (
        "sealed_at_utc=NULL, verified_at_utc=now()",
        "sealed_at_utc=allocated_at_utc - interval '1 second'",
        "rejected_at_utc=now()",
        "reject_reason='bad'",
    ):
        _refused(conn, f"UPDATE core.history_archive_copy SET {assignment}")
    if stage >= 1:
        _refused(
            conn,
            "UPDATE core.history_archive_copy "
            "SET verified_at_utc=sealed_at_utc - interval '1 second'",
        )
    for column in ("allocated_at_utc", "sealed_at_utc", "verified_at_utc")[: stage + 1]:
        _refused(
            conn,
            "UPDATE core.history_archive_copy SET reject_reason='bad', "
            f"rejected_at_utc={column} - interval '1 second'",
        )
    conn.exec_driver_sql(
        "UPDATE core.history_archive_copy SET reject_reason='bad', "
        "rejected_at_utc=GREATEST(allocated_at_utc,sealed_at_utc,verified_at_utc) "
        "+ interval '1 second'"
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


@pytest.mark.parametrize("pipeline_creator", [False, True])
def test_pipeline_role_can_write_and_cannot_delete(conn, monkeypatch, pipeline_creator):
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
                "GRANT USAGE, CREATE ON SCHEMA core TO transit_app WITH GRANT OPTION"
            )
            conn.exec_driver_sql("SET LOCAL ROLE transit_app")
        migration.upgrade()
        if pipeline_creator:
            _pipeline_statements(conn)
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


def _pipeline_statements(conn):
    assert conn.exec_driver_sql("SELECT current_user").scalar_one() == "transit_app"
    _window(conn)
    _copy(conn)
    conn.exec_driver_sql(
        "INSERT INTO core.history_event "
        "(dataset_id,provider_id,revision,window_key,kind,actor) "
        f"VALUES ({KEY},'seal','test')"
    )
    conn.exec_driver_sql(
        "INSERT INTO core.pipeline_switches "
        "(switch_key,updated_at_utc,updated_by,reason) "
        "VALUES ('test',now(),'test','test')"
    )
    for table, assignment in (
        ("history_window", "working_state='partial'"),
        ("history_archive_copy", "details='{}'::jsonb"),
        ("pipeline_switches", "enabled=true"),
    ):
        assert conn.exec_driver_sql(f"UPDATE core.{table} SET {assignment}").rowcount == 1
    statements = ["UPDATE core.history_event SET actor='rewritten'"]
    statements += [
        f"{verb} core.{table}" for table in TABLES for verb in ("DELETE FROM", "TRUNCATE")
    ]
    for sql in statements:
        with pytest.raises(ProgrammingError) as error, conn.begin_nested():
            conn.exec_driver_sql(sql)
        assert error.value.orig.sqlstate == "42501"


IDENTITY = dict(dataset_id="capture.trip_updates", provider_id="network", window_key="2026-11-01")


def _ledger_row(conn):
    return (
        conn.execute(
            text(
                "SELECT * FROM core.history_window WHERE dataset_id=:dataset_id "
                "AND provider_id=:provider_id AND revision=0 AND window_key=:window_key"
            ),
            IDENTITY,
        )
        .mappings()
        .one()
    )


def test_versions_are_allocated_one_at_a_time_by_two_sessions(real_db_engine):
    with real_db_engine.connect() as a, real_db_engine.connect() as b:
        try:
            assert ledger.allocate_version(a, **IDENTITY) == 1
            b.exec_driver_sql("SET LOCAL lock_timeout = '100ms'")
            with pytest.raises(OperationalError) as error:
                ledger.allocate_version(b, **IDENTITY)
            assert error.value.orig.sqlstate == "55P03"
            b.rollback()
            other = {**IDENTITY, "window_key": "2026-11-02"}
            assert ledger.allocate_version(b, **other) == 1
            b.exec_driver_sql("SET LOCAL lock_timeout = '100ms'")
            with pytest.raises(OperationalError) as error:
                ledger.lock_window(b, **IDENTITY)
            assert error.value.orig.sqlstate == "55P03"
            b.rollback()
            assert ledger.allocate_version(a, **IDENTITY) == 2
            a.rollback()
            assert ledger.allocate_version(b, **IDENTITY) == 1
        finally:
            a.rollback()
            b.rollback()


def test_lock_window_marks_the_working_copy_changed(conn):
    ledger.lock_window(conn, **IDENTITY)
    row = _ledger_row(conn)
    assert row["working_state"] == "present"
    assert row["window_start"] == date(2026, 11, 1)
    assert conn.exec_driver_sql("SELECT kind FROM core.history_event").scalars().all() == [
        "changed"
    ]
    conn.exec_driver_sql(
        "UPDATE core.history_window SET working_state='trimmed', next_version=9, "
        "current_version=7, trimmed_at_utc=clock_timestamp(), "
        "working_changed_at_utc=clock_timestamp()-interval '1 day', "
        "hold_until_utc=clock_timestamp()+interval '1 day', hold_reason='test'"
    )
    before = _ledger_row(conn)
    ledger.lock_window(conn, **IDENTITY)
    after = _ledger_row(conn)
    assert after["working_state"] == "present"
    assert after["working_changed_at_utc"] > before["working_changed_at_utc"]
    assert after["working_changed_at_utc"] > row["working_changed_at_utc"]
    for field in (
        "next_version",
        "current_version",
        "trimmed_at_utc",
        "hold_until_utc",
        "hold_reason",
    ):
        assert after[field] == before[field]
    assert conn.exec_driver_sql("SELECT kind FROM core.history_event").scalars().all() == [
        "changed",
        "changed",
    ]


def _ledger_counts(conn):
    return [conn.exec_driver_sql(f"SELECT count(*) FROM core.{t}").scalar_one() for t in TABLES[:3]]


def test_undeclared_dataset_is_refused(conn):
    before = _ledger_counts(conn)
    identity = {**IDENTITY, "dataset_id": "capture.unknown"}
    for function, extra in (
        (ledger.lock_window, {}),
        (ledger.allocate_version, {}),
        (ledger.record_event, {"kind": "seal", "revision": 0}),
    ):
        with pytest.raises(UndeclaredDataset):
            function(conn, **identity, **extra)
    assert _ledger_counts(conn) == before


@pytest.mark.parametrize("invalid", [{"window_key": "2026-11"}, {"revision": 1}, {"revision": -1}])
def test_window_key_and_revision_must_fit_the_declaration(conn, invalid):
    before = _ledger_counts(conn)
    for function in (ledger.lock_window, ledger.allocate_version):
        with pytest.raises(ValueError):
            function(conn, **{**IDENTITY, **invalid})
    assert _ledger_counts(conn) == before


def test_allocation_starts_above_every_listed_version(conn):
    before = _ledger_counts(conn)
    with pytest.raises(ValueError):
        ledger.allocate_version(conn, **IDENTITY, above_version=-1)
    assert _ledger_counts(conn) == before
    for above, expected in ((5, 6), (2, 7), (0, 8)):
        assert ledger.allocate_version(conn, **IDENTITY, above_version=above) == expected
    row = _ledger_row(conn)
    assert (row["next_version"], row["working_state"]) == (9, "present")
    assert row["window_start"] == date(2026, 11, 1)
    assert _ledger_counts(conn)[1:] == before[1:]
    conn.exec_driver_sql("UPDATE core.history_window SET working_state='empty', hold_reason='keep'")
    before_row = dict(_ledger_row(conn))
    assert ledger.allocate_version(conn, **IDENTITY) == 9
    assert dict(_ledger_row(conn)) == {**before_row, "next_version": 10}


def test_events_carry_their_kind_details_and_actor(conn):
    conn.exec_driver_sql("SET LOCAL application_name = 'ledger-test'")
    for actor, expected in ((None, "ledger-test"), ("owner-command", "owner-command")):
        event_id = ledger.record_event(
            conn,
            **{**IDENTITY, "window_key": "2026-11"},
            revision=0,
            kind="fold_published",
            content_version=2,
            reason="checked",
            details={"rows": 3, "missing": None},
            actor=actor,
        )
        row = (
            conn.execute(
                text("SELECT * FROM core.history_event WHERE event_id=:id"), {"id": event_id}
            )
            .mappings()
            .one()
        )
        assert (row["kind"], row["content_version"], row["reason"], row["actor"]) == (
            "fold_published",
            2,
            "checked",
            expected,
        )
        assert row["details"] == {"rows": 3, "missing": None}
    conn.exec_driver_sql("SET LOCAL application_name = ''")
    event_id = ledger.record_event(conn, **IDENTITY, revision=0, kind="seal")
    assert (
        conn.execute(
            text("SELECT actor FROM core.history_event WHERE event_id=:id"), {"id": event_id}
        ).scalar_one()
        == conn.exec_driver_sql("SELECT current_user").scalar_one()
    )


@pytest.mark.parametrize(
    "invalid",
    [
        {"kind": "unknown"},
        {"content_version": 0},
        {"reason": ""},
        {"actor": ""},
        {"details": {"bad": object()}},
    ],
)
def test_event_invalid_values_are_refused_before_sql(conn, invalid):
    before = _ledger_counts(conn)
    with pytest.raises(TypeError if "details" in invalid else ValueError):
        ledger.record_event(conn, **{**IDENTITY, "revision": 0, "kind": "seal", **invalid})
    assert _ledger_counts(conn) == before


def test_ledger_calls_run_as_the_pipeline_role(conn, monkeypatch):
    with pipeline_role(conn, monkeypatch):
        assert conn.exec_driver_sql("SELECT current_user").scalar_one() == "transit_app"
        ledger.lock_window(conn, **IDENTITY)
        assert ledger.allocate_version(conn, **IDENTITY) == 1
        event_id = ledger.record_event(conn, **IDENTITY, revision=0, kind="seal")
        assert (
            conn.execute(
                text("SELECT kind FROM core.history_event WHERE event_id=:id"), {"id": event_id}
            ).scalar_one()
            == "seal"
        )


def test_hold_with_no_end_is_stored_as_infinity_and_read_back(conn):
    ledger.lock_window(conn, **IDENTITY)
    before = ledger.window_state(conn, **IDENTITY)
    ledger.hold(conn, **IDENTITY, until_utc=ledger.HOLD_NO_END, reason="rebuilt")
    assert (
        conn.exec_driver_sql(
            "SELECT hold_until_utc = 'infinity' FROM core.history_window"
        ).scalar_one()
        is True
    )
    assert ledger.window_state(conn, **IDENTITY).hold_until_utc == ledger.HOLD_NO_END
    until = datetime(2026, 12, 1, 12, 30, 0, 123456, tzinfo=timezone(timedelta(hours=2)))
    ledger.hold(conn, **IDENTITY, until_utc=until, reason="restored", actor="restore")
    assert ledger.window_state(conn, **IDENTITY).hold_until_utc == until
    ledger.hold(conn, **IDENTITY, until_utc=None, reason="released")
    after = ledger.window_state(conn, **IDENTITY)
    assert (after.hold_until_utc, after.hold_reason) == (None, None)
    assert after.working_changed_at_utc == before.working_changed_at_utc
    rows = conn.exec_driver_sql(
        "SELECT kind, reason, details FROM core.history_event ORDER BY event_id"
    ).all()
    assert rows == [
        ("changed", None, {}),
        ("hold", "rebuilt", {"until_utc": "infinity"}),
        ("hold", "restored", {"until_utc": "2026-12-01T10:30:00.123456Z"}),
        ("unhold", "released", {}),
    ]
    assert (
        conn.exec_driver_sql(
            "SELECT actor FROM core.history_event WHERE reason='restored'"
        ).scalar_one()
        == "restore"
    )


def test_hold_needs_an_existing_window_and_an_aware_time(conn):
    before = _ledger_counts(conn)
    with pytest.raises(ledger.WindowNotFound, match="2026-11-01"):
        ledger.hold(conn, **IDENTITY, until_utc=None, reason="missing")
    assert _ledger_counts(conn) == before
    for invalid in (
        {"until_utc": datetime(2026, 11, 1)},
        {"reason": ""},
        {"actor": ""},
        {"window_key": "2026-11"},
        {"revision": 1},
    ):
        with pytest.raises(ValueError):
            ledger.hold(None, **{**IDENTITY, "until_utc": None, "reason": "test", **invalid})
    assert _ledger_counts(conn) == before


def test_window_state_reads_the_row_and_the_remainder_of_the_newest_trim(conn):
    assert ledger.window_state(conn, **IDENTITY) is None
    ledger.lock_window(conn, **IDENTITY)
    row = _ledger_row(conn)
    assert ledger.window_state(conn, **IDENTITY) == ledger.WindowState(
        **row, remainder_fingerprint=None
    )
    for fingerprint in ("older", "newest"):
        ledger.record_event(
            conn,
            **IDENTITY,
            revision=0,
            kind="trim",
            details={"remainder_fingerprint": fingerprint},
        )
    ledger.record_event(conn, **IDENTITY, revision=0, kind="restore")
    for state in ("partial", "trimmed", "present", "empty"):
        conn.execute(text("UPDATE core.history_window SET working_state=:state"), {"state": state})
        assert ledger.window_state(conn, **IDENTITY).remainder_fingerprint == (
            "newest" if state in ("partial", "trimmed") else None
        )
    ledger.lock_window(conn, **{**IDENTITY, "window_key": "2026-11-02"})
    conn.exec_driver_sql("UPDATE core.history_window SET working_state='partial'")
    assert (
        ledger.window_state(conn, **{**IDENTITY, "window_key": "2026-11-02"}).remainder_fingerprint
        is None
    )


def _range_copies(conn):
    for day in (3, 2, 1):
        identity = {**IDENTITY, "window_key": f"2026-11-{day:02d}"}
        ledger.lock_window(conn, **identity)
        for version in (4, 3, 2, 1):
            conn.execute(
                text("""
                INSERT INTO core.history_archive_copy
                    (dataset_id,provider_id,revision,window_key,content_version,schema_version,
                     storage_backend,allocated_at_utc,sealed_at_utc,verified_at_utc,
                     rejected_at_utc,reject_reason,details)
                VALUES (:dataset_id,:provider_id,0,:window_key,:version,1,'local',now(),
                        CASE WHEN :version >= 2 THEN now() END,
                        CASE WHEN :version >= 3 THEN now() END,
                        CASE WHEN :version = 4 THEN now() END,
                        CASE WHEN :version = 4 THEN 'bad' END,'{"rows": 2}'::jsonb)
                """),
                {**identity, "version": version},
            )
    conn.exec_driver_sql("UPDATE core.history_window SET current_version=3")
    # Same dataset and dates, but a different provider or revision must not leak in.
    for provider, revision in (("elsewhere", 0), ("network", 1)):
        conn.execute(
            text("""
            INSERT INTO core.history_window
                (dataset_id,provider_id,revision,window_key,window_start,
                 working_state,working_changed_at_utc)
            VALUES (:dataset_id,:provider,:revision,'2026-11-01','2026-11-01','present',now())
            """),
            {"dataset_id": IDENTITY["dataset_id"], "provider": provider, "revision": revision},
        )
        _copy(conn, key=f"'capture.trip_updates','{provider}',{revision},'2026-11-01'")


def test_find_copies_lists_every_copy_of_the_windows_in_a_date_range(conn):
    _range_copies(conn)
    scope = dict(dataset_id=IDENTITY["dataset_id"], provider_id=IDENTITY["provider_id"])
    copies = ledger.find_copies(conn, **scope, start=date(2026, 11, 1), end=date(2026, 11, 2))
    assert [
        (c.window_start, c.window_key, c.content_version, c.state, c.is_current) for c in copies
    ] == [
        (date(2026, 11, day), f"2026-11-{day:02d}", version, state, version == 3)
        for day in (1, 2)
        for version, state in enumerate(("allocated", "sealed", "verified", "rejected"), 1)
    ]
    assert all(c.details == {"rows": 2} and c.byte_size is None for c in copies)
    assert all(c.allocated_at_utc.tzinfo is not None for c in copies)
    assert ledger.find_copies(conn, **scope, start=date(2026, 12, 1), end=date(2026, 12, 2)) == []
    with pytest.raises(ValueError):
        ledger.find_copies(None, **scope, start=date(2026, 11, 2), end=date(2026, 11, 1))


def test_state_reads_and_holds_refuse_an_undeclared_dataset(conn):
    identity = {**IDENTITY, "dataset_id": "capture.unknown"}
    with pytest.raises(UndeclaredDataset):
        ledger.hold(None, **identity, until_utc=None, reason="test")
    with pytest.raises(UndeclaredDataset):
        ledger.window_state(None, **identity)
    with pytest.raises(UndeclaredDataset):
        ledger.find_copies(
            None,
            dataset_id=identity["dataset_id"],
            provider_id=identity["provider_id"],
            start=date(2026, 11, 1),
            end=date(2026, 11, 2),
        )


def test_holds_and_reads_run_as_the_pipeline_role(conn, monkeypatch):
    with pipeline_role(conn, monkeypatch):
        ledger.lock_window(conn, **IDENTITY)
        ledger.hold(conn, **IDENTITY, until_utc=ledger.HOLD_NO_END, reason="rebuilt")
        assert ledger.window_state(conn, **IDENTITY).hold_until_utc == ledger.HOLD_NO_END
        ledger.hold(conn, **IDENTITY, until_utc=None, reason="released")
        _copy(conn, key="'capture.trip_updates','network',0,'2026-11-01'")
        copies = ledger.find_copies(
            conn,
            dataset_id=IDENTITY["dataset_id"],
            provider_id=IDENTITY["provider_id"],
            start=date(2026, 11, 1),
            end=date(2026, 11, 1),
        )
        assert len(copies) == 1 and copies[0].state == "allocated"
