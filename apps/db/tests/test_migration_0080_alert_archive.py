"""Migration contract for the retained Gold alert archive."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB


def _migration_path() -> Path:
    return (
        Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0080_alert_archive.py"
    )


def _source() -> str:
    path = _migration_path()
    assert path.exists(), "expected migration 0080_alert_archive.py"
    return path.read_text(encoding="utf-8")


def _load():
    path = _migration_path()
    spec = importlib.util.spec_from_file_location("m0080", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class _OperationRecorder:
    def __init__(self) -> None:
        self.table: sa.Table | None = None
        self.created_indexes: list[tuple[str, str, list[object], str | None]] = []
        self.dropped: list[tuple[str, str, str | None]] = []

    def create_table(self, name: str, *elements: object, schema: str | None = None):
        self.table = sa.Table(name, sa.MetaData(schema=schema), *elements)
        return self.table

    def create_index(
        self,
        name: str,
        table_name: str,
        columns: list[object],
        *,
        schema: str | None = None,
    ) -> None:
        self.created_indexes.append((name, table_name, columns, schema))

    def drop_index(
        self,
        name: str,
        *,
        table_name: str,
        schema: str | None = None,
    ) -> None:
        self.dropped.append(("index", name, schema))

    def drop_table(self, name: str, *, schema: str | None = None) -> None:
        self.dropped.append(("table", name, schema))

    def execute(self, statement: object) -> None:
        raise AssertionError(f"0080 must be DDL-only; unexpected op.execute({statement!r})")


def _run_upgrade():
    migration = _load()
    operations = _OperationRecorder()
    migration.op = operations
    migration.upgrade()
    assert operations.table is not None
    return migration, operations, operations.table


def test_0080_chain() -> None:
    migration = _load()
    assert migration.revision == "0080_alert_archive"
    assert migration.down_revision == "0079_alert_history_messages"
    assert migration.branch_labels is None
    assert migration.depends_on is None


def test_0080_creates_the_message_complete_archive_contract() -> None:
    _, operations, table = _run_upgrade()
    assert table.fullname == "gold.alert_archive_entry"
    assert list(table.columns) == [
        table.c.provider_id,
        table.c.alert_id,
        table.c.archive_month,
        table.c.header_text,
        table.c.header_text_en,
        table.c.description_text,
        table.c.description_text_en,
        table.c.severity,
        table.c.cause,
        table.c.effect,
        table.c.route_ids,
        table.c.stop_ids,
        table.c.start_utc,
        table.c.end_utc,
        table.c.active_periods,
        table.c.url,
        table.c.first_seen_utc,
        table.c.last_seen_utc,
        table.c.content_hash,
        table.c.updated_at_utc,
    ]

    assert table.primary_key.name == "pk_gold_alert_archive_entry"
    assert [column.name for column in table.primary_key.columns] == ["provider_id", "alert_id"]
    check = next(
        constraint for constraint in table.constraints if isinstance(constraint, sa.CheckConstraint)
    )
    assert check.name == "ck_gold_alert_archive_entry_month_start"
    assert str(check.sqltext) == "archive_month = date_trunc('month', archive_month)::date"

    assert len(operations.created_indexes) == 1
    name, table_name, columns, schema = operations.created_indexes[0]
    assert name == "ix_gold_alert_archive_entry_provider_month_start"
    assert table_name == "alert_archive_entry"
    assert schema == "gold"
    assert [str(column) for column in columns] == [
        "provider_id",
        "archive_month DESC",
        "start_utc DESC",
        "alert_id",
    ]


def test_0080_uses_honest_collection_defaults_without_backfill() -> None:
    _, _, table = _run_upgrade()

    required = {
        "provider_id",
        "alert_id",
        "archive_month",
        "route_ids",
        "stop_ids",
        "active_periods",
        "first_seen_utc",
        "last_seen_utc",
        "content_hash",
        "updated_at_utc",
    }
    assert all(not table.c[name].nullable for name in required)
    optional = set(table.c.keys()) - required
    assert all(table.c[name].nullable for name in optional)

    assert isinstance(table.c.provider_id.type, sa.Text)
    assert isinstance(table.c.alert_id.type, sa.Text)
    assert isinstance(table.c.archive_month.type, sa.Date)
    for name in ("header_text", "header_text_en", "description_text", "description_text_en"):
        assert isinstance(table.c[name].type, sa.Text)
    for name in ("route_ids", "stop_ids"):
        assert isinstance(table.c[name].type, ARRAY)
        assert isinstance(table.c[name].type.item_type, sa.Text)
        assert str(table.c[name].server_default.arg) == "'{}'::text[]"
    assert isinstance(table.c.active_periods.type, JSONB)
    assert str(table.c.active_periods.server_default.arg) == "'[]'::jsonb"
    assert str(table.c.updated_at_utc.server_default.arg) == "now()"
    assert table.c.first_seen_utc.server_default is None
    assert table.c.last_seen_utc.server_default is None
    assert table.c.content_hash.server_default is None


def test_0080_downgrade_removes_only_the_archive_table() -> None:
    migration = _load()
    operations = _OperationRecorder()
    migration.op = operations
    migration.downgrade()

    assert operations.dropped == [
        ("index", "ix_gold_alert_archive_entry_provider_month_start", "gold"),
        ("table", "alert_archive_entry", "gold"),
    ]
