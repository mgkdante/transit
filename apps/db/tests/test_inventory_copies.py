import hashlib
import importlib.util
import io
import json
import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from psycopg import errors, sql
from sqlalchemy import create_engine, event, text

from transit_ops.ingestion.common import build_bronze_object_storage_path
from transit_ops.settings import Settings


def load():
    spec = importlib.util.spec_from_file_location(
        "inventory", Path(__file__).parents[1] / "scripts/inventory_copies.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Store:
    def __init__(self):
        self.calls = []
        self.changed = False
        self.items = {"orphan/a": b"abc", "orphan/b": b"def"}

    def list_objects_v2(self, **kwargs):
        self.calls.append(("list", kwargs))
        offset = int(kwargs.get("ContinuationToken", 0))
        keys = sorted(self.items)[offset : offset + kwargs["MaxKeys"]]
        end = offset + len(keys)
        return {
            "Contents": [dict(Key=k, **self.head_object(Key=k)) for k in keys],
            "IsTruncated": end < len(self.items),
            "NextContinuationToken": str(end),
        }

    def head_object(self, **kwargs):
        key = kwargs["Key"]
        if key not in self.items:
            raise FileNotFoundError
        return {
            "ETag": "changed" if self.changed else "opaque-etag",
            "ContentLength": len(self.items[key]),
            "Size": len(self.items[key]),
            "LastModified": "2026-01-01T00:00:00Z",
        }

    def get_object(self, **kwargs):
        self.calls.append(("get", kwargs))
        assert kwargs["IfMatch"] == "opaque-etag"
        data = self.items[kwargs["Key"]]
        if "Range" in kwargs:
            start, end = map(int, kwargs["Range"].removeprefix("bytes=").split("-"))
            return {
                "Body": io.BytesIO(data[start : end + 1]),
                "ContentLength": end - start + 1,
                "ContentRange": f"bytes {start}-{end}/{len(data)}",
            }
        return {"Body": io.BytesIO(data), "ContentLength": len(data)}


def scan(tmp_path, store=None, **kwargs):
    module, store = load(), store or Store()
    output, cursor = tmp_path / "objects.jsonl", tmp_path / "cursor.json"
    result = module.objects(store, "alias", "published", output, cursor, **kwargs)
    return result, [json.loads(line) for line in output.read_text().splitlines()], store


def test_inventory_lists_all_pages_and_orphan_provider_roots(tmp_path):
    result, rows, store = scan(tmp_path, page_size=1)
    assert result["complete"]
    assert {r["key"] for r in rows if r["kind"] == "object"} == {"orphan/a", "orphan/b"}
    assert len([c for c in store.calls if c[0] == "list"]) == 2


def test_inventory_hashes_published_bytes_instead_of_etags(tmp_path):
    _, rows, _ = scan(tmp_path)
    row = next(r for r in rows if r["kind"] == "object")
    assert row["sha256"] == hashlib.sha256(b"abc").hexdigest()
    assert row["identity"][0] == "opaque-etag"


def test_inventory_marks_changed_and_disappeared_objects_for_delta_rescan(tmp_path):
    store = Store()
    original = store.get_object

    def get(**kwargs):
        result = original(**kwargs)
        store.changed = True
        return result

    store.get_object = get
    _, rows, _ = scan(tmp_path, store)
    assert any(r.get("verification") == "changed_during_scan" for r in rows)
    previous = tmp_path / "previous.jsonl"
    previous.write_text(json.dumps({"kind": "object", "key": "gone", "store": "published"}) + "\n")
    _, rows, _ = scan(tmp_path / "delta", rescan=previous)
    assert any(r.get("key") == "gone" and r.get("verification") == "disappeared" for r in rows)


def test_inventory_resumes_without_skipping_a_partial_page(tmp_path):
    result, _, store = scan(tmp_path, max_bytes=3)
    assert not result["complete"]
    result, rows, _ = scan(tmp_path, store)
    assert result["complete"]
    assert {r["key"] for r in rows if r["kind"] == "object"} == {"orphan/a", "orphan/b"}


def test_inventory_enforces_object_byte_and_database_time_budgets(tmp_path):
    result, _, store = scan(tmp_path, max_bytes=2)
    assert result["get_bytes"] == 2 and not result["complete"]
    assert any(c[1].get("Range") == "bytes=0-1" for c in store.calls)
    with pytest.raises(ValueError):
        scan(tmp_path, max_keys=10001)
    with pytest.raises(ValueError):
        load().database(
            None, Settings(_env_file=None), lambda _: None, datetime.now(UTC) - timedelta(seconds=1)
        )


def test_inventory_never_mutates_storage_database_or_restores_dumps(tmp_path):
    _, _, store = scan(tmp_path)
    assert {c[0] for c in store.calls} == {"list", "get"}


def test_inventory_redacts_connection_and_storage_errors(tmp_path, capsys):
    module = load()

    def fail():
        raise RuntimeError("postgresql://secret:password@private/bucket?token=secret")

    assert module.guarded(fail) == 1
    assert capsys.readouterr().err == "inventory failed; details withheld\n"


def assert_readonly_cursor(cursor):
    cursor.execute("SHOW transaction_read_only")
    assert cursor.fetchone()[0] == "on"
    cursor.execute("SHOW lock_timeout")
    assert cursor.fetchone()[0] == "1s"
    cursor.execute("SELECT extract(epoch FROM current_setting('statement_timeout')::interval)")
    assert 0 < cursor.fetchone()[0] <= 60


def test_inventory_database_is_read_only_and_includes_unclassified_tables(
    inventory_reader, monkeypatch
):
    real_db_engine, fixed, schema, expected = inventory_reader
    module = load()
    monkeypatch.setattr(module, "utc_now", lambda: fixed)
    monkeypatch.setenv("LS03_STATIC_WARM_FINISHED_AT", (fixed - timedelta(hours=1)).isoformat())
    rows, statements, blocked_writes = [], [], []
    with real_db_engine.connect():
        pass

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)
        if statement.lstrip().upper().startswith("SELECT"):
            assert_readonly_cursor(cursor)
            if schema + '."editions"' in statement:
                cursor.execute("SAVEPOINT readonly_proof")
                with pytest.raises(errors.ReadOnlySqlTransaction):
                    cursor.execute(f"INSERT INTO {schema}.editions VALUES ('blocked',99)")
                cursor.execute("ROLLBACK TO SAVEPOINT readonly_proof")
                blocked_writes.append(True)

    event.listen(real_db_engine, "before_cursor_execute", record)
    try:
        module.database(
            real_db_engine,
            Settings(_env_file=None),
            rows.append,
            fixed.replace(day=14, hour=5, minute=45),
        )
    finally:
        event.remove(real_db_engine, "before_cursor_execute", record)
    assert any(r.get("table") == "core.providers" for r in rows)
    assert not any(
        s.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")) for s in statements
    )
    assert any("READ ONLY" in s for s in statements)
    assert blocked_writes
    measured = [
        r
        for r in rows
        if r.get("kind") == "measurement" and r.get("table") == schema.strip('"') + ".editions"
    ]
    assert {r["dataset_version_id"] for r in measured} == {1, 2}
    with real_db_engine.connect() as conn:
        assert source_digests(conn) == expected


def seed_recovery_evidence(conn, provider, fixed):
    common = dict(p=provider, t=fixed, h="a" * 64, u=str(uuid4()))
    conn.execute(
        text("""INSERT INTO core.snapshot_historic_gc_marks
        (provider_id,object_key,etag,content_length,object_last_modified_utc,
         first_unreachable_utc,last_confirmed_unreachable_utc,last_scan_id)
        VALUES (:p,'historic/network/generations/example/index.json','opaque',123,:t,:t,:t,:u)"""),
        common,
    )
    conn.execute(
        text("""INSERT INTO core.snapshot_historic_receipts
        (provider_id,family,entity_key,receipt_schema_version,common_envelope,common_envelope_sha256,
         month_receipts,scope_count,first_scope_start,last_scope_end,entity_receipt_sha256,
         origin_publish_generation_id,activated_root_generation_id,created_at_utc,updated_at_utc)
        VALUES (:p,'network','',1,'{}',:h,'{}',1,
                '2026-11-13','2026-11-13',:h,'origin','active',:t,:t)"""),
        common,
    )
    conn.execute(
        text("""INSERT INTO core.history_event
        (at_utc,kind,dataset_id,provider_id,revision,window_key,actor)
        VALUES (:t,'hold','capture.vehicle_positions',:p,0,'2026-11-13','inventory-test')"""),
        common,
    )


def prepare_inventory_role(real_db_engine, seed_provider, token, fixed, role, password, schema):
    with real_db_engine.begin() as conn:
        with conn.connection.driver_connection.cursor() as cur:
            cur.execute(
                sql.SQL(
                    "CREATE ROLE {} LOGIN PASSWORD {} NOSUPERUSER NOINHERIT NOCREATEROLE NOCREATEDB"
                ).format(sql.Identifier(role), sql.Literal(password))
            )
        seed_provider(conn, token, display_name="Inventory test")
        conn.execute(text(f"CREATE SCHEMA {schema}"))
        conn.execute(
            text(f"CREATE TABLE {schema}.editions (provider_id text,dataset_version_id int)")
        )
        conn.execute(text(f"INSERT INTO {schema}.editions VALUES (:p,1),(:p,2)"), {"p": token})
        seed_recovery_evidence(conn, token, fixed)
        conn.execute(text(f"GRANT USAGE ON SCHEMA core,raw,silver,gold,public,{schema} TO {role}"))
        conn.execute(
            text(
                "GRANT SELECT ON ALL TABLES IN SCHEMA core,raw,silver,gold,public,"
                f"{schema} TO {role}"
            )
        )
        conn.execute(text(f"GRANT INSERT,UPDATE,DELETE ON {schema}.editions TO {role}"))
        return source_digests(conn)


@pytest.fixture
def inventory_reader(real_db_engine, seed_provider):
    token, fixed = uuid4().hex, datetime(2026, 11, 13, 9, tzinfo=UTC)
    role, password, schema = "ls03_" + token, uuid4().hex, '"ls03_' + token + '"'
    expected = prepare_inventory_role(
        real_db_engine, seed_provider, token, fixed, role, password, schema
    )
    url = real_db_engine.url.set(
        username=role,
        password=password,
        query={k: v for k, v in real_db_engine.url.query.items() if k not in ("user", "password")},
    )
    reader = create_engine(
        url, hide_parameters=True, connect_args={"options": "-c default_transaction_read_only=on"}
    )
    try:
        with reader.connect() as conn:
            proof = conn.execute(
                text(
                    "SELECT current_user,rolsuper,pg_has_role(current_user,'pg_monitor','MEMBER') "
                    "FROM pg_roles WHERE rolname=current_user"
                )
            ).one()
            assert tuple(proof) == (role, False, False)
        with reader.connect() as conn:
            conn.execute(text("SET TRANSACTION READ WRITE"))
            conn.execute(text(f"INSERT INTO {schema}.editions VALUES ('write-proof',99)"))
            conn.rollback()
        yield reader, fixed, schema, expected
    finally:
        reader.dispose()
        with real_db_engine.begin() as conn:
            conn.execute(text(f"DROP OWNED BY {role}"))
            conn.execute(text(f"DROP ROLE {role}"))
            conn.execute(text(f"DROP SCHEMA {schema} CASCADE"))
            for table in (
                "snapshot_historic_gc_marks",
                "snapshot_historic_receipts",
                "history_event",
                "providers",
            ):
                conn.execute(text(f"DELETE FROM core.{table} WHERE provider_id=:p"), {"p": token})


def test_recovery_evidence_values_survive_projection(inventory_reader, monkeypatch):
    engine, fixed, schema, _ = inventory_reader
    module, rows = load(), []
    monkeypatch.setattr(module, "utc_now", lambda: fixed)
    monkeypatch.setenv("LS03_STATIC_WARM_FINISHED_AT", (fixed - timedelta(hours=1)).isoformat())
    module.database(
        engine, Settings(_env_file=None), rows.append, fixed.replace(day=14, hour=5, minute=45)
    )

    def evidence(table):
        return [r for r in rows if r.get("kind") == "measurement" and r.get("table") == table]

    marks = [r for r in evidence("core.snapshot_historic_gc_marks") if r.get("etag") == "opaque"]
    assert any(
        r["content_length"] == 123
        and r["last_scan_id"]
        and all(
            datetime.fromisoformat(r[k]) == fixed
            for k in (
                "object_last_modified_utc",
                "first_unreachable_utc",
                "last_confirmed_unreachable_utc",
            )
        )
        for r in marks
    )
    receipts = evidence("core.snapshot_historic_receipts")
    assert any(
        r["family"] == "network"
        and r["entity_key"] == ""
        and r["receipt_schema_version"] == 1
        and str(r["first_scope_start"]) == "2026-11-13"
        and str(r["last_scope_end"]) == "2026-11-13"
        for r in receipts
    )
    assert any(datetime.fromisoformat(r["at_utc"]) == fixed for r in evidence("core.history_event"))


def test_inventory_distinguishes_estimates_counts_unknowns_and_expiry_rules():
    module, settings = load(), Settings(_env_file=None)
    assert module.policy("gold.fact_vehicle_snapshot", settings)["retention_days"] == 14
    assert module.policy("gold.route_delay_hourly", settings)["age_deletion"] == "disabled"
    assert module.policy("unknown.table", settings)["eligible_from"] is None


def test_inventory_includes_historic_receipts_gc_marks_and_all_static_editions(real_db_engine):
    rows = []
    load().database(
        real_db_engine,
        Settings(_env_file=None),
        rows.append,
        (datetime.now(UTC) + timedelta(days=1)).replace(hour=5, minute=45),
    )
    tables = {r.get("table") for r in rows}
    assert {
        "core.snapshot_historic_receipts",
        "core.snapshot_historic_gc_marks",
        "core.history_window",
        "core.history_archive_copy",
        "core.history_event",
        "core.pipeline_switches",
        "silver.trips",
        "silver.stop_times",
    } <= tables


def test_fact_inventory_uses_only_provider_index_bounds():
    module, calls = load(), []
    times = [datetime(2026, 11, 1, tzinfo=UTC), datetime(2026, 11, 2, tzinfo=UTC)]

    def read(sql, params=None, indexed=False):
        calls.append((sql, params, indexed))
        assert "COUNT(" not in sql.upper() and indexed
        assert "min(captured_at_utc)" in sql and "max(captured_at_utc)" in sql
        yield dict(first_observed=times[0], last_observed=times[1])

    row = module.fact_bounds(read, '"gold"."fact_vehicle_snapshot"', "literal'provider")
    assert (row["first_observed"], row["last_observed"]) == tuple(times)
    assert row["row_count"] is None
    assert all(c[1] == {"provider": "literal'provider"} for c in calls)


def test_ranged_hash_resumes_one_object_across_invocations(tmp_path):
    store = Store()
    store.items = {"orphan/large": b"abcdef"}
    for expected in (False, False, True):
        result, rows, _ = scan(tmp_path, store, max_bytes=2)
        assert result["complete"] is expected and result["get_bytes"] == 2
    assert rows[-3]["sha256"] == hashlib.sha256(b"abcdef").hexdigest()


def test_small_key_budget_makes_progress_and_rechecks_overlap(tmp_path):
    store, complete = Store(), False
    for _ in range(5):
        result, rows, _ = scan(tmp_path, store, max_keys=1, page_size=1)
        assert result["keys"] <= 1
        if result["complete"]:
            complete = True
            break
    assert complete
    copies = [r for r in rows if r["kind"] == "object"]
    assert [(r["key"], r["sha256"]) for r in copies] == [
        (key, hashlib.sha256(data).hexdigest()) for key, data in store.items.items()
    ]
    assert len([c for c in store.calls if c[0] == "list"]) > 2


def test_delta_budget_and_immutable_changes_are_failures(tmp_path):
    store = Store()
    store.items = {"orphan/generations/digest/index.json": b"abc"}
    scan(tmp_path / "first", store)
    previous = tmp_path / "first/objects.jsonl"
    store.items = {"orphan/generations/digest/index.json": b"def"}
    result, rows, _ = scan(tmp_path / "delta", store, rescan=previous, max_keys=1)
    assert not result["complete"] and result["keys"] <= 1
    assert any(r["kind"] == "immutable_content_failure" for r in rows)
    result, _, _ = scan(tmp_path / "delta", store, rescan=previous, max_keys=1)
    assert result["reconciliation_complete"] and not result["stable"]


def test_resume_recovers_uncheckpointed_tail_and_rejects_wrong_target(tmp_path):
    store = Store()
    scan(tmp_path, store, max_bytes=3)
    output = tmp_path / "objects.jsonl"
    with output.open("ab") as out:
        out.write(b'{"incomplete')
    result, _, _ = scan(tmp_path, store)
    assert result["complete"]
    with pytest.raises(ValueError):
        load().objects(store, "other-target", "published", output, tmp_path / "cursor.json")


def test_raw_objects_are_not_fetched_and_resume_is_deduplicated(tmp_path):
    module, store = load(), Store()
    output, cursor = tmp_path / "raw.jsonl", tmp_path / "raw.cursor"
    for _ in range(4):
        module.objects(store, "alias", "raw", output, cursor, max_keys=1)
    assert not any(c[0] == "get" for c in store.calls)
    copies = [r for r in module.records(output) if r["kind"] == "object"]
    assert {r["key"] for r in copies} == set(store.items) and len(copies) == len(store.items)


def test_read_only_budget_expires_before_a_connection_is_opened():
    with pytest.raises(TimeoutError):
        list(load().read_only(None, 10, lambda: 10, "SELECT 1"))


def test_discovered_inactive_provider_and_source_rows_unchanged(
    real_db_engine, seed_provider, monkeypatch
):
    module, rows = load(), []
    provider = uuid4().hex
    schema = '"ls03_' + provider + '"'
    fixed = datetime(2026, 11, 13, 9, tzinfo=UTC)
    monkeypatch.setattr(module, "utc_now", lambda: fixed)
    monkeypatch.setenv("LS03_STATIC_WARM_FINISHED_AT", (fixed - timedelta(hours=1)).isoformat())
    with real_db_engine.begin() as conn:
        seed_provider(conn, provider, display_name="Inventory fixture")
        conn.execute(
            text("UPDATE core.providers SET is_active=false WHERE provider_id=:p"), {"p": provider}
        )
        conn.execute(text(f"CREATE SCHEMA {schema}"))
        conn.execute(text(f'CREATE SCHEMA "ls03_empty_{provider}"'))
        conn.execute(
            text(f"CREATE TABLE {schema}.editions (provider_id text, dataset_version_id int)")
        )
        conn.execute(text(f"INSERT INTO {schema}.editions VALUES (:p,1),(:p,2)"), {"p": provider})
        before = source_digests(conn)
    try:
        module.database(
            real_db_engine,
            Settings(_env_file=None),
            rows.append,
            fixed.replace(day=14, hour=5, minute=45),
        )
        measured = [
            r
            for r in rows
            if r.get("table") == schema.strip('"') + ".editions" and r.get("kind") == "measurement"
        ]
        assert {r["dataset_version_id"] for r in measured} == {1, 2}
        assert all(r["row_count"] == 1 and r["row_count_basis"] == "exact count" for r in measured)
        assert any(r.get("provider_id") == provider and r.get("is_active") is False for r in rows)
        assert "ls03_empty_" + provider in rows[0]["schemas"]
        with real_db_engine.connect() as conn:
            assert source_digests(conn) == before
    finally:
        with real_db_engine.begin() as conn:
            conn.execute(text(f"DROP SCHEMA {schema} CASCADE"))
            conn.execute(text(f'DROP SCHEMA "ls03_empty_{provider}"'))
            conn.execute(text("DELETE FROM core.providers WHERE provider_id=:p"), {"p": provider})


def source_digests(conn):
    tables = (
        "core.providers",
        "core.history_window",
        "core.history_archive_copy",
        "core.history_event",
        "core.pipeline_switches",
    )
    return [
        conn.execute(
            text(f"SELECT md5(string_agg(t::text,'' ORDER BY t::text)) FROM {t} t")
        ).scalar_one()
        for t in tables
    ]


def test_object_request_boundary_refuses_non_read_verbs(tmp_path):
    module, store = load(), Store()
    reader = module.ObjectScan(
        store,
        "alias",
        "raw",
        tmp_path / "rows",
        tmp_path / "cursor",
        dict(keys=1, bytes=0, page=1),
        None,
    )
    for verb in ("PUT", "DELETE", "put_object", "delete_object", "create_bucket"):
        with pytest.raises(KeyError):
            reader.request(verb, Key="unclassified")
    assert store.calls == []


def test_inconsistent_get_length_never_becomes_a_verified_hash(tmp_path):
    store = Store()
    original = store.get_object

    def get(**kwargs):
        result = original(**kwargs)
        result["ContentLength"] += 1
        return result

    store.get_object = get
    result, rows, _ = scan(tmp_path, store)
    assert not result["complete"] and result["get_bytes"] == 0
    assert all(r["sha256"] is None for r in rows if r["kind"] == "object")


class ProbeConnection:
    def __init__(self):
        self.streaming, self.settings, self.pages = False, [], []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def begin(self):
        return self

    def execution_options(self, **options):
        self.streaming = options.get("stream_results", self.streaming)
        return self

    def exec_driver_sql(self, sql):
        self.settings.append(sql)

    def execute(self, query, params):
        if self.streaming:
            raise SyntaxError("DECLARE cursor FOR SHOW transaction_read_only")
        assert params == {"provider": "opaque"}
        assert "READ ONLY" in self.settings[0] and "REPEATABLE READ" in self.settings[0]
        assert "SET LOCAL lock_timeout='1s'" in self.settings
        assert any("statement_timeout=" in sql for sql in self.settings)
        limit, offset = map(int, re.search(r"LIMIT (\d+) OFFSET (\d+)", str(query)).groups())
        assert limit <= 1000 and "ORDER BY" in str(query)
        self.pages.append(offset)
        rows = [dict(value=i) for i in range(offset, min(2001, offset + limit))]
        return SimpleNamespace(mappings=lambda: SimpleNamespace(all=lambda: rows))


def test_read_only_uses_bounded_normal_cursors_for_setting_probes():
    conn = ProbeConnection()
    rows = list(
        load().read_only(
            SimpleNamespace(connect=lambda: conn),
            180,
            lambda: 0,
            "SELECT value FROM unclassified",
            {"provider": "opaque"},
        )
    )
    assert rows == [dict(value=i) for i in range(2001)]
    assert conn.pages == [0, 1000, 2000]


def test_partial_then_disappeared_is_reconciled_and_counted(tmp_path):
    store = Store()
    store.items = {"orphan/partial": b"abcdef"}
    scan(tmp_path / "initial", store, max_bytes=2)
    store.items.clear()
    result, rows, _ = scan(tmp_path / "delta", store, rescan=tmp_path / "initial/objects.jsonl")
    assert not result["complete"] and not result["stable"] and result["failures"] == 1
    assert result["HEAD"] == 1
    assert any(r.get("verification") == "disappeared" for r in rows)


@pytest.mark.parametrize("name", ("objects.jsonl", "cursor.part"))
def test_unrelated_evidence_paths_are_never_replaced(tmp_path, name):
    path = tmp_path / name
    path.write_bytes(b"PREEXISTING-UNRELATED-FILE")
    with pytest.raises((FileExistsError, ValueError)):
        scan(tmp_path)
    assert path.read_bytes() == b"PREEXISTING-UNRELATED-FILE"


def test_database_receipt_creation_is_exclusive_and_size_bounded(tmp_path):
    module, path = load(), tmp_path / "database.jsonl"
    path.write_bytes(b"UNRELATED")
    with pytest.raises(FileExistsError):
        module.receipt(path, {"kind": "data"})
    assert path.read_bytes() == b"UNRELATED"
    path = tmp_path / "bounded.jsonl"
    with pytest.raises(module.EvidenceLimit):
        module.receipt(path, {"payload": "x" * 2**21}, max_bytes=1024)
    assert path.stat().st_size <= 1024
    assert any(r["kind"] == "truncation" and r["complete"] is False for r in module.records(path))


def test_accumulated_spool_ceiling_during_resume_is_fatal(tmp_path):
    store = Store()
    store.items = {"orphan/partial": b"abcdef"}
    result, _, _ = scan(tmp_path, store, max_bytes=2, max_spool_bytes=3)
    assert not result["complete"]
    assert load().guarded(lambda: scan(tmp_path, store, max_bytes=2, max_spool_bytes=3)) == 1
    rows = list(load().records(tmp_path / "objects.jsonl"))
    assert any(r.get("reason") == "spool_limit" and r["kind"] == "truncation" for r in rows)
    assert sum(p.stat().st_size for p in (tmp_path / "cursor.part").glob("*.part")) <= 3


def test_receipt_ceiling_is_durable_and_resume_refuses_before_storage(tmp_path):
    module, store = load(), Store()
    output, cursor = tmp_path / "objects.jsonl", tmp_path / "cursor.json"
    with pytest.raises(module.EvidenceLimit):
        module.objects(store, "alias", "published", output, cursor, max_output_bytes=1024)
    path = tmp_path / "objects.jsonl"
    assert path.stat().st_size <= 1024
    assert any(r["kind"] == "truncation" for r in module.records(path))
    before = list(store.calls)
    with pytest.raises(module.EvidenceLimit):
        module.objects(store, "alias", "published", output, cursor, max_output_bytes=1024)
    assert store.calls == before


def test_existing_checkpoint_temporary_file_is_untouched(tmp_path):
    path = tmp_path / "cursor.tmp"
    path.write_bytes(b"UNRELATED")
    scan(tmp_path)
    assert path.read_bytes() == b"UNRELATED"


def test_retention_does_not_invent_silver_or_unclassified_fact_rules(monkeypatch):
    module, settings = load(), Settings(_env_file=None)
    rule = module.policy("silver.rt_trip_updates", settings)
    assert "STATIC_DATASET" not in str(rule) and rule["eligible_from"] is None
    fixed = datetime(2026, 11, 13, 12, tzinfo=UTC)
    monkeypatch.setattr(module, "utc_now", lambda: fixed)
    monkeypatch.setenv("LS03_STATIC_WARM_FINISHED_AT", fixed.isoformat())

    def read(sql, *args, **kwargs):
        if "pg_locks" in sql:
            return iter(())
        if "core.providers" in sql:
            return iter([{"provider_id": "arbitrary"}])
        return iter([dict(first_observed=fixed, last_observed=fixed)])

    row = dict(
        schema="unclassified",
        name="fact_custom",
        relkind="r",
        indexes=["(provider_id, captured_at_utc)"],
    )
    assert (
        list(module.measure_table(read, row, lambda s: s, settings))[0].get("eligible_from") is None
    )


def test_standard_raw_capture_key_uses_the_owning_builder(tmp_path):
    fixed = datetime(2026, 11, 13, tzinfo=UTC)
    key = build_bronze_object_storage_path(
        provider_id="declared-provider",
        endpoint_key="vehicle_positions",
        partition_label="capture_date",
        observed_at_utc=fixed,
        object_name="feed.pb",
        checksum_sha256="a" * 64,
    )
    module, store = load(), Store()
    store.items = {key: b"data"}
    module.objects(store, "alias", "raw", tmp_path / "raw", tmp_path / "cursor")
    row = next(r for r in module.records(tmp_path / "raw") if r["kind"] == "object")
    assert row["classification"] == "capture" and row["provider"] == "declared-provider"
    assert row["feed"] == "vehicle_positions" and row["day"] == "2026-11-13"
    assert row["dataset"] == "capture.vehicle_positions" and row["sha256"] is None


def test_static_archive_backup_and_orphan_classification():
    from transit_ops.history.seal_captures import _prefix
    from transit_ops.ingestion.static_gtfs import build_static_object_storage_path

    module, fixed = load(), datetime(2026, 11, 13, tzinfo=UTC)
    key = build_static_object_storage_path("network", "gtfs_schedule", fixed, "feed.zip", "a" * 64)
    assert module.classify(key)["classification"] == "edition"
    archive = _prefix("network", "vehicle_positions", fixed.date()) + "1.capture.pack"
    row = module.classify(archive)
    assert row["classification"] == "archive" and row["provider"] == "network"
    assert row["dataset"] == "capture.vehicle_positions" and row["day"] == "2026-11-13"
    assert (
        module.classify("backups/postgres/transit-20261113T000000Z.dump")["classification"]
        == "backup"
    )
    assert module.classify("orphan/unknown")["classification"] == "unknown"


@pytest.mark.parametrize(
    "name,fields",
    [
        (
            "snapshot_historic_gc_marks",
            "provider_id object_key etag content_length object_last_modified_utc "
            "first_unreachable_utc last_confirmed_unreachable_utc last_scan_id",
        ),
        (
            "snapshot_historic_receipts",
            "provider_id family entity_key receipt_schema_version scope_count "
            "first_scope_start last_scope_end entity_receipt_sha256",
        ),
        ("history_event", "event_id at_utc kind dataset_id provider_id revision window_key"),
    ],
)
def test_required_evidence_values_are_selected(name, fields):
    module = load()
    row = dict(schema="core", name=name, columns={k: "text" for k in fields.split()})
    sql = module.measurement_sql(row, lambda k: '"' + k + '"')
    assert all('"' + field + '"' in sql for field in fields.split())


@pytest.mark.parametrize(
    "admission,relkind,indexes,expected",
    [
        (None, "r", [], "missing_admission"),
        ("2026-11-12T08:00:00+00:00", "r", [], "stale_admission"),
        ("2026-11-13T08:00:00+00:00", "v", [], "unsupported_relation"),
        ("2026-11-13T08:00:00+00:00", "r", [], "missing_index"),
        ("2026-11-13T08:00:00+00:00", "r", ["(provider_id, captured_at_utc)"], "read_denied"),
    ],
)
def test_database_refusal_codes_are_distinct(monkeypatch, admission, relkind, indexes, expected):
    module, rows = load(), []
    fixed = datetime(2026, 11, 13, 9, tzinfo=UTC)
    monkeypatch.setattr(module, "utc_now", lambda: fixed)
    if admission:
        monkeypatch.setenv("LS03_STATIC_WARM_FINISHED_AT", admission)
    else:
        monkeypatch.delenv("LS03_STATIC_WARM_FINISHED_AT", raising=False)

    def read(engine, end, clock, sql, *args, **kwargs):
        if sql == module.CATALOG:
            return iter(
                [
                    dict(
                        schema="gold",
                        name="fact_custom",
                        relkind=relkind,
                        indexes=indexes,
                        columns={},
                        row_count=None,
                        byte_size=0,
                    )
                ]
            )
        if "pg_locks" in sql:
            return iter(())
        raise PermissionError("private connection details")

    monkeypatch.setattr(module, "read_only", read)
    engine = SimpleNamespace(
        dialect=SimpleNamespace(identifier_preparer=SimpleNamespace(quote_identifier=lambda s: s))
    )
    module.database(
        engine, Settings(_env_file=None), rows.append, fixed.replace(day=14, hour=5, minute=45)
    )
    refusal = next(r for r in rows if r["kind"] == "not_measured")
    assert refusal["reason"] == expected and "private" not in str(refusal)
