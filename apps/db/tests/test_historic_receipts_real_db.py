from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from transit_ops.snapshots.builders.historic.history_common import (
    HistoryDigestCollector,
    HistoryDigestColumn,
    build_history_digest_query,
)
from transit_ops.snapshots.historic_receipts import (
    build_historic_common_envelope,
    build_historic_detached_contribution,
    build_historic_entity_receipt,
    build_historic_scope_receipt,
    persist_historic_receipts,
    validate_historic_entity_receipt,
)
from transit_ops.sql_registry import named_query

_REAL_DB_ROWS = named_query(
    "test.historic_receipts.real_db_rows",
    """
    SELECT entity_id, local_date, value_float, note, source_generated_utc
    FROM pg_temp.f7a_digest_rows
    WHERE provider_id = :provider_id
    ORDER BY entity_id, local_date
    """,
)
_REAL_DB_ROWS_DIGEST = build_history_digest_query(
    _REAL_DB_ROWS,
    wrapper_name="test.historic_receipts.real_db_rows_digest",
    source_name="rows",
    columns=(
        HistoryDigestColumn("entity_id", "text"),
        HistoryDigestColumn("local_date", "date"),
        HistoryDigestColumn("value_float", "float8"),
        HistoryDigestColumn("note", "text"),
        HistoryDigestColumn("source_generated_utc", "timestamptz"),
    ),
    entity_field="entity_id",
    order_by=("entity_id", "local_date"),
)


def _common(provider_id: str, family: str = "stops"):
    return build_historic_common_envelope(
        provider_id=provider_id,
        provider_timezone="America/Toronto",
        family=family,
        installed_code_sha256="1" * 64,
        family_manifest_sha256="2" * 64,
        named_query_sha256={"test.historic_receipts.real_db_rows_digest": "3" * 64},
        pyproject_sha256="4" * 64,
        uv_lock_sha256="5" * 64,
        schema_sha256="6" * 64,
        alembic_sha256="7" * 64,
        config_sha256="8" * 64,
        gate_sha256="9" * 64,
        runtime_sha256="a" * 64,
        repository_alembic_head="0083_snapshot_historic_receipts",
        database_alembic_head="0083_snapshot_historic_receipts",
        configuration={"open_window_days": 10, "retention_days": 730},
        runtime={"python": "CPython 3.12", "postgresql_major": 16},
        gate_values={},
    )


def _entity_receipt(
    provider_id: str,
    *,
    entity_key: str = "S1",
    month: str = "2026-07",
    months: tuple[str, ...] | None = None,
):
    common = _common(provider_id)
    scope_receipts = []
    for scope_month in months or (month,):
        collector = HistoryDigestCollector(
            provider_id=provider_id,
            family="stops",
            source_names=("rows",),
            named_query_sha256={},
        )
        scope_date = date.fromisoformat(f"{scope_month}-01")
        collector.consume_source_rows(
            "rows",
            [
                {
                    "stop_id": entity_key,
                    "local_date": scope_date,
                    "__f7_digest_entity_key": entity_key,
                    "__f7_digest_month": scope_date,
                    "__f7_digest_row_count": 1,
                    "__f7_digest_min_date": scope_date,
                    "__f7_digest_max_date": scope_date,
                    "__f7_digest_sha256": "b" * 64,
                }
            ],
            entity_field="stop_id",
        )
        scope = next(collector.iter_scope_evidence())
        artifact_ref = {
            "path": f"historic/history/stops/{entity_key}/{scope_month}.json",
            "coverage_start": scope_date.isoformat(),
            "coverage_end": scope_date.isoformat(),
            "count": 1,
            "sha256": "c" * 64,
            "byte_size": 10,
        }
        detached = build_historic_detached_contribution(
            family="stops",
            artifact_ref=artifact_ref,
            partition={
                "generated_utc": f"{scope_month}-02T00:00:00Z",
                "month": scope_month,
                "entity_id": entity_key,
                "days": [
                    {
                        "date": scope_date.isoformat(),
                        "delay": {"observation_count": 1},
                    }
                ],
            },
        )
        scope_receipts.append(
            build_historic_scope_receipt(
                common_envelope=common,
                source_evidence=scope,
                artifact_ref=artifact_ref,
                raw_day_count=1,
                detached_summary=detached,
                source_timestamps=(),
                origin_gate={
                    "enabled": True,
                    "force": False,
                    "verdict": "PASS",
                    "checks": 1,
                    "errors": 0,
                    "warnings": 0,
                    "complete": True,
                },
            )
        )
    return build_historic_entity_receipt(
        provider_id=provider_id,
        family="stops",
        entity_key=entity_key,
        common_envelope=common,
        scope_receipts=scope_receipts,
        origin_publish_generation_id="origin",
        activated_root_generation_id="root",
    )


def test_same_pass_digest_changes_for_insert_update_delete_and_stays_provider_scoped(
    real_db_engine,
):
    with real_db_engine.connect() as conn:
        tx = conn.begin()
        conn.execute(
            text(
                """
                CREATE TEMP TABLE f7a_digest_rows (
                    provider_id text NOT NULL,
                    entity_id text NOT NULL,
                    local_date date NOT NULL,
                    value_float double precision,
                    note text,
                    source_generated_utc timestamptz
                ) ON COMMIT DROP
                """
            )
        )
        conn.execute(
            text(
                """
                INSERT INTO f7a_digest_rows VALUES
                  ('a', 'E1', '2026-07-01', 1.5, NULL, '2026-07-02T00:00:00Z'),
                  ('b', 'E1', '2026-07-01', 9.5, 'other', '2026-07-02T00:00:00Z')
                """
            )
        )

        def digest(provider_id: str) -> tuple[str, list[dict[str, object]]]:
            collector = HistoryDigestCollector(
                provider_id=provider_id,
                family="lines",
                source_names=("rows",),
                named_query_sha256={},
            )
            rows = conn.execute(
                _REAL_DB_ROWS_DIGEST,
                {"provider_id": provider_id},
            ).mappings()
            plain = collector.consume_source_rows("rows", rows, entity_field="entity_id")
            evidence = next(collector.iter_scope_evidence())
            return evidence.combined_source_sha256, plain

        original, plain = digest("a")
        assert plain == [
            {
                "entity_id": "E1",
                "local_date": date(2026, 7, 1),
                "value_float": 1.5,
                "note": None,
                "source_generated_utc": datetime(2026, 7, 2, tzinfo=UTC),
            }
        ]
        conn.execute(
            text(
                "INSERT INTO f7a_digest_rows VALUES "
                "('a', 'E1', '2026-07-02', 2.5, 'insert', '2026-07-03T00:00:00Z')"
            )
        )
        inserted, _ = digest("a")
        assert inserted != original
        conn.execute(
            text(
                "UPDATE f7a_digest_rows SET note = 'update' "
                "WHERE provider_id = 'a' AND local_date = '2026-07-02'"
            )
        )
        updated, _ = digest("a")
        assert updated not in {original, inserted}
        conn.execute(
            text(
                "DELETE FROM f7a_digest_rows "
                "WHERE provider_id = 'a' AND local_date = '2026-07-02'"
            )
        )
        deleted, _ = digest("a")
        assert deleted == original
        before_other, _ = digest("a")
        conn.execute(text("UPDATE f7a_digest_rows SET note = 'foreign' WHERE provider_id = 'b'"))
        after_other, _ = digest("a")
        assert after_other == before_other
        tx.rollback()


def test_entity_receipt_reconcile_suppresses_identical_writes_and_removes_stale_state(
    real_db_engine,
    seed_provider,
):
    provider_id = "f7a-reconcile"
    with real_db_engine.connect() as conn:
        tx = conn.begin()
        seed_provider(conn, provider_id, display_name="F7a receipt reconciliation")
        first = _entity_receipt(
            provider_id,
            entity_key="S1",
            months=("2026-06", "2026-07"),
        )
        stale = _entity_receipt(provider_id, entity_key="S2", month="2026-06")

        seeded = persist_historic_receipts(
            conn,
            provider_id=provider_id,
            receipts=(first, stale),
            complete_families=("stops",),
        )
        assert seeded.rows_attempted == 2
        assert seeded.rows_changed == 2
        assert seeded.json_bytes_attempted > 0
        assert seeded.json_bytes_changed == seeded.json_bytes_attempted
        stored = conn.execute(
            text(
                "SELECT common_envelope, month_receipts "
                "FROM core.snapshot_historic_receipts "
                "WHERE provider_id = :provider_id "
                "AND family = 'stops' AND entity_key = 'S1'"
            ),
            {"provider_id": provider_id},
        ).mappings().one()
        assert stored["common_envelope"] == first.common_envelope
        assert stored["month_receipts"] == first.month_receipts

        unchanged = persist_historic_receipts(
            conn,
            provider_id=provider_id,
            receipts=(first, stale),
            complete_families=("stops",),
        )
        assert unchanged.rows_attempted == 2
        assert unchanged.rows_changed == 0
        assert unchanged.json_bytes_changed == 0

        july_only = _entity_receipt(provider_id, entity_key="S1", month="2026-07")
        month_reconciled = persist_historic_receipts(
            conn,
            provider_id=provider_id,
            receipts=(july_only, stale),
            complete_families=("stops",),
        )
        assert month_reconciled.rows_changed == 1
        assert month_reconciled.stale_months_deleted == 1
        assert conn.execute(
            text(
                "SELECT scope_count FROM core.snapshot_historic_receipts "
                "WHERE provider_id = :provider_id "
                "AND family = 'stops' AND entity_key = 'S1'"
            ),
            {"provider_id": provider_id},
        ).scalar_one() == 1

        reconciled = persist_historic_receipts(
            conn,
            provider_id=provider_id,
            receipts=(july_only,),
            complete_families=("stops",),
        )
        assert reconciled.stale_entities_deleted == 1
        assert conn.execute(
            text(
                "SELECT entity_key FROM core.snapshot_historic_receipts "
                "WHERE provider_id = :provider_id ORDER BY entity_key"
            ),
            {"provider_id": provider_id},
        ).scalars().all() == ["S1"]

        baseline_sha256 = july_only.entity_receipt_sha256
        conn.execute(
            text(
                """
                CREATE FUNCTION pg_temp.f7a_reject_s2_receipt()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $$
                BEGIN
                    IF NEW.entity_key = 'S2' THEN
                        RAISE EXCEPTION 'forced F7a receipt failure';
                    END IF;
                    RETURN NEW;
                END
                $$
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TRIGGER f7a_reject_s2_receipt
                BEFORE INSERT OR UPDATE
                ON core.snapshot_historic_receipts
                FOR EACH ROW
                EXECUTE FUNCTION pg_temp.f7a_reject_s2_receipt()
                """
            )
        )
        expanded = _entity_receipt(
            provider_id,
            entity_key="S1",
            months=("2026-06", "2026-07"),
        )
        with pytest.raises(DBAPIError):
            with conn.begin_nested():
                persist_historic_receipts(
                    conn,
                    provider_id=provider_id,
                    receipts=(expanded, stale),
                    complete_families=("stops",),
                )
        assert conn.execute(
            text(
                "SELECT entity_receipt_sha256 "
                "FROM core.snapshot_historic_receipts "
                "WHERE provider_id = :provider_id "
                "AND family = 'stops' AND entity_key = 'S1'"
            ),
            {"provider_id": provider_id},
        ).scalar_one() == baseline_sha256

        invalid = replace(july_only, scope_count=2)
        with pytest.raises(ValueError, match="scope_count"):
            with conn.begin_nested():
                persist_historic_receipts(
                    conn,
                    provider_id=provider_id,
                    receipts=(invalid,),
                    complete_families=("stops",),
                )
        assert conn.execute(
            text(
                "SELECT entity_receipt_sha256 FROM core.snapshot_historic_receipts "
                "WHERE provider_id = :provider_id AND family = 'stops' AND entity_key = 'S1'"
            ),
            {"provider_id": provider_id},
        ).scalar_one() == july_only.entity_receipt_sha256
        tx.rollback()


def test_real_db_constraints_and_writer_cardinality_pin_invalid_receipts(
    real_db_engine,
    seed_provider,
):
    provider_id = "f7a-constraints"
    valid = _entity_receipt(provider_id)
    with real_db_engine.connect() as conn:
        tx = conn.begin()
        seed_provider(conn, provider_id, display_name="F7a receipt constraints")
        params = valid.as_sql_params()

        invalid_cases = (
            {**params, "family": "alerts"},
            {**params, "entity_key": ""},
            {**params, "common_envelope": "[]"},
            {**params, "common_envelope_sha256": "bad"},
            {**params, "scope_count": 0},
            {
                **params,
                "first_scope_start": date(2026, 7, 2),
                "last_scope_end": date(2026, 7, 1),
            },
        )
        statement = text(
            """
            INSERT INTO core.snapshot_historic_receipts (
                provider_id, family, entity_key, receipt_schema_version,
                common_envelope, common_envelope_sha256, month_receipts,
                scope_count, first_scope_start, last_scope_end,
                entity_receipt_sha256, origin_publish_generation_id,
                activated_root_generation_id
            ) VALUES (
                :provider_id, :family, :entity_key, :receipt_schema_version,
                CAST(:common_envelope AS jsonb), :common_envelope_sha256,
                CAST(:month_receipts AS jsonb), :scope_count, :first_scope_start,
                :last_scope_end, :entity_receipt_sha256,
                :origin_publish_generation_id, :activated_root_generation_id
            )
            """
        )
        for invalid in invalid_cases:
            with pytest.raises(IntegrityError):
                with conn.begin_nested():
                    conn.execute(statement, invalid)

        with pytest.raises(ValueError, match="scope_count"):
            validate_historic_entity_receipt(replace(valid, scope_count=2))
        tx.rollback()
