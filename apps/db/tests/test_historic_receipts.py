from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from dataclasses import replace
from datetime import UTC, date, datetime
from types import SimpleNamespace

import pytest

from transit_ops.snapshots import historic_receipts as receipts_module
from transit_ops.snapshots.builders.historic.history_common import (
    HistoryDigestCollector,
    HistoryDigestColumn,
    build_history_digest_query,
    build_history_inventory_digest_query,
    classify_historic_scope,
)
from transit_ops.snapshots.historic_receipts import (
    HistoricReceiptEvidenceError,
    build_historic_common_envelope,
    build_historic_detached_contribution,
    build_historic_entity_receipt,
    build_historic_scope_receipt,
    digest_file_manifest,
    prepare_historic_receipt_preflight,
    validate_historic_entity_receipt,
)
from transit_ops.sql_registry import named_query, query_name


def _digest_row(
    *,
    entity_key: str,
    month: date,
    row_count: int,
    minimum: date,
    maximum: date,
    sha256: str,
) -> dict[str, object]:
    return {
        "__f7_digest_entity_key": entity_key,
        "__f7_digest_month": month,
        "__f7_digest_row_count": row_count,
        "__f7_digest_min_date": minimum,
        "__f7_digest_max_date": maximum,
        "__f7_digest_sha256": sha256,
    }


def _common_envelope(
    *,
    provider_id: str = "receipt-unit",
    lock_sha: str = "6" * 64,
    schema_sha: str = "7" * 64,
    config_sha: str = "9" * 64,
):
    return build_historic_common_envelope(
        provider_id=provider_id,
        provider_timezone="America/Toronto",
        family="stops",
        installed_code_sha256="1" * 64,
        family_manifest_sha256="2" * 64,
        named_query_sha256={
            "history.stops.delay": "3" * 64,
            "history.stops.delay.inner": "4" * 64,
        },
        pyproject_sha256="5" * 64,
        uv_lock_sha256=lock_sha,
        schema_sha256=schema_sha,
        alembic_sha256="8" * 64,
        config_sha256=config_sha,
        gate_sha256="a" * 64,
        runtime_sha256="b" * 64,
        repository_alembic_head="0083_snapshot_historic_receipts",
        database_alembic_head="0083_snapshot_historic_receipts",
        configuration={"open_window_days": 10, "retention_days": 730},
        runtime={"python": "CPython 3.12.11", "postgresql_major": 16},
        gate_values={"GATE_SENTINEL_VALUE": 9999.9999},
    )


def _scope_evidence(
    scope_date: date = date(2026, 7, 1),
    *,
    dependency_dates: tuple[date, ...] | None = None,
    provider_id: str = "receipt-unit",
    entity_key: str = "S/1",
    source_sha256: str = "d" * 64,
):
    dates = dependency_dates or (scope_date,)
    collector = HistoryDigestCollector(
        provider_id=provider_id,
        family="stops",
        source_names=("delay", "percentiles", "occupancy"),
        named_query_sha256={"history.stops.delay": "4" * 64},
        inventory_required=True,
    )
    collector.consume_inventory_rows(
        [
            {
                "stop_id": entity_key,
                "__f7_inventory_row_count": 1,
                "__f7_inventory_sha256": "c" * 64,
                "__f7_inventory_sentinel": False,
            }
        ],
        entity_field="stop_id",
    )
    collector.consume_source_rows(
        "delay",
        [
            {
                "stop_id": entity_key,
                "local_date": local_date,
                "observation_count": 3,
                "source_generated_utc": datetime(2026, 7, 2, tzinfo=UTC),
                **(
                    _digest_row(
                        entity_key=entity_key,
                        month=scope_date.replace(day=1),
                        row_count=len(dates),
                        minimum=min(dates),
                        maximum=max(dates),
                        sha256=source_sha256,
                    )
                    if index == 0
                    else dict.fromkeys(
                        (
                            "__f7_digest_entity_key",
                            "__f7_digest_month",
                            "__f7_digest_row_count",
                            "__f7_digest_min_date",
                            "__f7_digest_max_date",
                            "__f7_digest_sha256",
                        )
                    )
                ),
            }
            for index, local_date in enumerate(dates)
        ],
        entity_field="stop_id",
    )
    collector.consume_source_rows("percentiles", [], entity_field="stop_id")
    collector.consume_source_rows("occupancy", [], entity_field="stop_id")
    return next(collector.iter_scope_evidence())


def _persistence_receipt(
    entity_key: str,
    *,
    revision: str = "a",
    padding_bytes: int = 0,
    scope_date: date = date(2026, 7, 1),
    provider_id: str = "receipt-unit",
):
    common = _common_envelope(provider_id=provider_id)
    source_sha256 = hashlib.sha256(
        f"source:{entity_key}:{scope_date:%Y-%m}:{revision}".encode()
    ).hexdigest()
    evidence = _scope_evidence(
        scope_date,
        provider_id=provider_id,
        entity_key=entity_key,
        source_sha256=source_sha256,
    )
    artifact_sha256 = hashlib.sha256(
        f"artifact:{entity_key}:{scope_date:%Y-%m}:{revision}".encode()
    ).hexdigest()
    artifact_ref = {
        "path": (
            "historic/history/stops/fixture/generations/"
            f"{artifact_sha256}/{scope_date:%Y-%m}.json"
        ),
        "coverage_start": scope_date.isoformat(),
        "coverage_end": scope_date.isoformat(),
        "count": 1,
        "sha256": artifact_sha256,
        "byte_size": 321 + padding_bytes,
    }
    detached = build_historic_detached_contribution(
        family="stops",
        artifact_ref=artifact_ref,
        partition={
            "generated_utc": "2026-07-02T00:00:00Z",
            "methodology_version": "history-1",
            "month": f"{scope_date:%Y-%m}",
            "entity_id": entity_key,
            "days": [
                {"date": scope_date.isoformat(), "delay": {"observation_count": 1}}
            ],
        },
    )
    scope = build_historic_scope_receipt(
        common_envelope=common,
        source_evidence=evidence,
        artifact_ref=artifact_ref,
        raw_day_count=1,
        detached_summary=detached,
        source_timestamps=evidence.source_timestamps,
        origin_gate={
            "enabled": True,
            "force": False,
            "verdict": "PASS",
            "checks": 12,
            "errors": 0,
            "warnings": 0,
            "complete": True,
        },
        diagnostics={"padding": "x" * padding_bytes},
    )
    return build_historic_entity_receipt(
        provider_id=provider_id,
        family="stops",
        entity_key=entity_key,
        common_envelope=common,
        scope_receipts=(scope,),
        origin_publish_generation_id="origin",
        activated_root_generation_id="root",
    )


def test_digest_wrappers_frame_typed_rows_and_strip_validated_sidecars():
    base = named_query(
        "test.historic_receipts.rows",
        """
        SELECT entity_id, local_date, value_float, note, source_generated_utc
        FROM test_rows
        WHERE provider_id = :provider_id
        ORDER BY entity_id, local_date
        """,
    )
    wrapped = build_history_digest_query(
        base,
        wrapper_name="test.historic_receipts.rows_digest",
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
    inventory = build_history_inventory_digest_query(
        named_query(
            "test.historic_receipts.ids",
            "SELECT entity_id FROM test_rows WHERE provider_id = :provider_id ORDER BY entity_id",
        ),
        wrapper_name="test.historic_receipts.ids_digest",
        source_name="ids",
        entity_field="entity_id",
    )

    rendered = str(wrapped)
    assert query_name(wrapped) == "test.historic_receipts.rows_digest"
    assert str(base) in rendered
    assert "encode(float8send(" in rendered
    assert 'COLLATE "C"' in rendered
    assert "SELECT f.*, d.*" not in rendered
    assert "__f7_month, __f7_month" not in rendered
    assert "UNION ALL" in str(inventory)

    collector = HistoryDigestCollector(
        provider_id="receipt-unit",
        family="lines",
        source_names=("rows",),
        named_query_sha256={},
    )
    plain = collector.consume_source_rows(
        "rows",
        [
            {
                "entity_id": "A",
                "local_date": date(2026, 7, 1),
                "value_float": 1.5,
                "note": None,
                "source_generated_utc": datetime(2026, 7, 2, tzinfo=UTC),
                **_digest_row(
                    entity_key="A",
                    month=date(2026, 7, 1),
                    row_count=1,
                    minimum=date(2026, 7, 1),
                    maximum=date(2026, 7, 1),
                    sha256="1" * 64,
                ),
            }
        ],
        entity_field="entity_id",
    )
    assert plain == [
        {
            "entity_id": "A",
            "local_date": date(2026, 7, 1),
            "value_float": 1.5,
            "note": None,
            "source_generated_utc": datetime(2026, 7, 2, tzinfo=UTC),
        }
    ]
    with pytest.raises(ValueError, match="partial digest sidecar"):
        collector.consume_source_rows(
            "rows",
            [{"entity_id": "B", "local_date": date(2026, 7, 1), "__f7_digest_month": None}],
            entity_field="entity_id",
        )
    mismatch = HistoryDigestCollector(
        provider_id="receipt-unit",
        family="lines",
        source_names=("rows",),
        named_query_sha256={},
    )
    with pytest.raises(ValueError, match="row count mismatch"):
        mismatch.consume_source_rows(
            "rows",
            [
                {
                    "entity_id": "A",
                    "local_date": date(2026, 7, 1),
                    **_digest_row(
                        entity_key="A",
                        month=date(2026, 7, 1),
                        row_count=2,
                        minimum=date(2026, 7, 1),
                        maximum=date(2026, 7, 1),
                        sha256="2" * 64,
                    ),
                }
            ],
            entity_field="entity_id",
        )
    conflicting = HistoryDigestCollector(
        provider_id="receipt-unit",
        family="lines",
        source_names=("rows",),
        named_query_sha256={},
    )
    with pytest.raises(ValueError, match="conflicting"):
        conflicting.consume_source_rows(
            "rows",
            [
                {
                    "entity_id": "A",
                    "local_date": date(2026, 7, 1),
                    **_digest_row(
                        entity_key="A",
                        month=date(2026, 7, 1),
                        row_count=2,
                        minimum=date(2026, 7, 1),
                        maximum=date(2026, 7, 2),
                        sha256="2" * 64,
                    ),
                },
                {
                    "entity_id": "A",
                    "local_date": date(2026, 7, 2),
                    **_digest_row(
                        entity_key="A",
                        month=date(2026, 7, 1),
                        row_count=2,
                        minimum=date(2026, 7, 1),
                        maximum=date(2026, 7, 2),
                        sha256="3" * 64,
                    ),
                },
            ],
            entity_field="entity_id",
        )


def test_inventory_scope_evidence_is_provider_scoped_and_classifies_partial_edges():
    evidence = _scope_evidence()
    assert evidence.entity_key == "S/1"
    assert evidence.month == "2026-07"
    assert evidence.scope_start == "2026-07-01"
    assert evidence.scope_end == "2026-07-01"
    assert [source.source_name for source in evidence.sources] == [
        "delay",
        "percentiles",
        "occupancy",
    ]
    assert evidence.sources[1].empty is True
    assert evidence.sources[2].empty is True

    other = HistoryDigestCollector(
        provider_id="other-provider",
        family="stops",
        source_names=("delay",),
        named_query_sha256={},
    )
    other.consume_source_rows(
        "delay",
        [
            {
                "stop_id": "S/1",
                "local_date": date(2026, 7, 1),
                **_digest_row(
                    entity_key="S/1",
                    month=date(2026, 7, 1),
                    row_count=1,
                    minimum=date(2026, 7, 1),
                    maximum=date(2026, 7, 1),
                    sha256="d" * 64,
                ),
            }
        ],
        entity_field="stop_id",
    )
    assert next(other.iter_scope_evidence()).combined_source_sha256 != (
        evidence.combined_source_sha256
    )

    empty = HistoryDigestCollector(
        provider_id="empty-provider",
        family="stops",
        source_names=("delay",),
        named_query_sha256={},
        inventory_required=True,
    )
    assert (
        empty.consume_inventory_rows(
            [
                {
                    "stop_id": None,
                    "__f7_inventory_row_count": 0,
                    "__f7_inventory_sha256": "e" * 64,
                    "__f7_inventory_sentinel": True,
                }
            ],
            entity_field="stop_id",
        )
        == ()
    )
    assert empty.scope_cardinality().dense_scope_count == 0

    today = date(2026, 7, 29)
    assert (
        classify_historic_scope(
            family="stops",
            scope_start=date(2024, 7, 29),
            scope_end=date(2024, 7, 31),
            today_local=today,
            open_window_days=10,
            fact_retention_days=14,
            retention_days=730,
        )
        == "retention_edge"
    )
    assert (
        classify_historic_scope(
            family="stops",
            scope_start=date(2024, 7, 30),
            scope_end=date(2024, 7, 31),
            today_local=today,
            open_window_days=10,
            fact_retention_days=14,
            retention_days=730,
        )
        == "retention_edge"
    )
    assert (
        classify_historic_scope(
            family="network",
            scope_start=date(2026, 7, 1),
            scope_end=date(2026, 7, 28),
            today_local=today,
            open_window_days=10,
            fact_retention_days=14,
            retention_days=730,
        )
        == "mutable_edge"
    )
    assert (
        classify_historic_scope(
            family="lines",
            scope_start=date(2026, 7, 1),
            scope_end=date(2026, 7, 5),
            today_local=today,
            open_window_days=10,
            fact_retention_days=14,
            retention_days=730,
        )
        == "mutable_edge"
    )
    assert (
        classify_historic_scope(
            family="lines",
            scope_start=date(2026, 6, 1),
            scope_end=date(2026, 6, 30),
            today_local=today,
            open_window_days=10,
            fact_retention_days=14,
            retention_days=730,
        )
        == "settled_candidate"
    )


def test_common_envelope_keeps_named_subdigests_and_fails_closed(tmp_path):
    runtime_sql = str(receipts_module._PROVIDER_RUNTIME_SQL)
    assert "current_setting('lc_collate')" not in runtime_sql
    assert "pg_database" in runtime_sql and "database_collation" in runtime_sql

    source = tmp_path / "transit_ops"
    source.mkdir()
    (source / "a.py").write_bytes(b"x = 1\n")
    first = digest_file_manifest(source, required_relative_paths=("a.py",))
    (source / "a.py").write_bytes(b"x = 2\n")
    second = digest_file_manifest(source, required_relative_paths=("a.py",))
    assert first != second
    with pytest.raises(HistoricReceiptEvidenceError, match="missing"):
        digest_file_manifest(source, required_relative_paths=("missing.py",))
    with pytest.raises(HistoricReceiptEvidenceError, match="escapes root"):
        digest_file_manifest(source, required_relative_paths=("../outside.py",))
    (source / "linked.py").symlink_to(source / "a.py")
    with pytest.raises(HistoricReceiptEvidenceError, match="symlink"):
        digest_file_manifest(source)

    common = _common_envelope()
    assert common.payload["installed_code_sha256"] == "1" * 64
    assert common.payload["family_manifest_sha256"] == "2" * 64
    assert common.payload["named_query_sha256"] == {
        "history.stops.delay": "3" * 64,
        "history.stops.delay.inner": "4" * 64,
    }
    assert common.payload["pyproject_sha256"] == "5" * 64
    assert common.payload["uv_lock_sha256"] == "6" * 64
    assert common.payload["schema_sha256"] == "7" * 64
    assert common.payload["alembic_sha256"] == "8" * 64
    assert common.payload["config_sha256"] == "9" * 64
    assert _common_envelope(lock_sha="0" * 64).sha256 != common.sha256
    assert _common_envelope(schema_sha="0" * 64).sha256 != common.sha256
    assert _common_envelope(config_sha="0" * 64).sha256 != common.sha256

    class PostgreSQLConnectionWithoutQueries:
        dialect = SimpleNamespace(name="postgresql")

        def begin_nested(self):
            raise AssertionError("query-name validation must happen before DB work")

        def execute(self, *_args, **_kwargs):
            raise AssertionError("query-name validation must happen before DB work")

    with pytest.raises(HistoricReceiptEvidenceError, match="named-query evidence"):
        prepare_historic_receipt_preflight(
            PostgreSQLConnectionWithoutQueries(),
            provider_id="receipt-unit",
            settings=object(),
            family="stops",
            named_query_sha256={"history.stops.ids": "1" * 64},
            partition_upload_batch_size=100,
        )


def test_scope_and_entity_receipts_bind_exact_artifact_and_order_month_maps():
    common = _common_envelope()
    evidence = _scope_evidence()
    detached = build_historic_detached_contribution(
        family="stops",
        artifact_ref={
            "path": "historic/history/stops/532f31/generations/abc/2026-07.json",
            "coverage_start": "2026-07-01",
            "coverage_end": "2026-07-03",
            "count": 2,
            "sha256": "f" * 64,
            "byte_size": 321,
        },
        partition={
            "generated_utc": "2026-07-04T00:00:00Z",
            "methodology_version": "history-1",
            "month": "2026-07",
            "entity_id": "S/1",
            "days": [
                {"date": "2026-07-01", "delay": {"observation_count": 1}},
                {"date": "2026-07-03", "occupancy": {"empty": 1}},
            ],
        },
    )
    builder_contribution = detached["builder_summary_contribution"]
    gate_contribution = detached["gate_summary_contribution"]
    assert builder_contribution["available_dates"] == [
        "2026-07-01",
        "2026-07-03",
    ]
    assert builder_contribution["gaps"] == [
        {"start_date": "2026-07-02", "end_date": "2026-07-02", "reason": None}
    ]
    assert builder_contribution["metric_dates"] == {
        "delay": ["2026-07-01"],
        "delay_percentiles": [],
        "occupancy": ["2026-07-03"],
    }
    assert gate_contribution["raw_day_count"] == 2
    assert gate_contribution["unique_day_count"] == 2
    assert gate_contribution["duplicate_dates"] is False
    assert gate_contribution["dates_strictly_increasing"] is True
    assert gate_contribution["available_date_mask"] == [
        "2026-07-01",
        "2026-07-03",
    ]
    duplicate_detached = build_historic_detached_contribution(
        family="network",
        artifact_ref={
            "path": "historic/history/network/generations/abc/2026-07.json",
            "coverage_start": "2026-07-01",
            "coverage_end": "2026-07-01",
            "count": 2,
            "sha256": "a" * 64,
            "byte_size": 200,
        },
        partition={
            "generated_utc": "2026-07-02T00:00:00Z",
            "month": "2026-07",
            "days": [
                {"date": "2026-07-01", "delay": {"observation_count": 1}},
                {"date": "2026-07-01", "vehicles": 1},
            ],
        },
    )
    duplicate_gate = duplicate_detached["gate_summary_contribution"]
    assert duplicate_gate["raw_day_count"] == 2
    assert duplicate_gate["unique_day_count"] == 1
    assert duplicate_gate["duplicate_dates"] is True
    assert duplicate_gate["dates_strictly_increasing"] is False
    july_ref = {
        "path": "historic/history/stops/532f31/generations/abc/2026-07.json",
        "coverage_start": "2026-07-01",
        "coverage_end": "2026-07-01",
        "count": 1,
        "sha256": "f" * 64,
        "byte_size": 321,
    }
    july_detached = build_historic_detached_contribution(
        family="stops",
        artifact_ref=july_ref,
        partition={
            "generated_utc": "2026-07-02T00:00:00Z",
            "methodology_version": "history-1",
            "month": "2026-07",
            "entity_id": "S/1",
            "days": [{"date": "2026-07-01", "delay": {"observation_count": 1}}],
        },
    )
    july = build_historic_scope_receipt(
        common_envelope=common,
        source_evidence=evidence,
        artifact_ref=july_ref,
        raw_day_count=1,
        detached_summary=july_detached,
        source_timestamps=evidence.source_timestamps,
        origin_gate={
            "enabled": True,
            "force": False,
            "verdict": "WARN",
            "checks": 12,
            "errors": 0,
            "warnings": 1,
            "complete": True,
        },
    )
    assert july.payload["detached_summary"] == july_detached
    filtered_evidence = _scope_evidence(
        dependency_dates=(date(2026, 7, 1), date(2026, 7, 3))
    )
    filtered_scope = build_historic_scope_receipt(
        common_envelope=common,
        source_evidence=filtered_evidence,
        artifact_ref=july_ref,
        raw_day_count=1,
        detached_summary=july_detached,
        source_timestamps=filtered_evidence.source_timestamps,
        origin_gate={
            "enabled": True,
            "force": False,
            "verdict": "PASS",
            "checks": 12,
            "errors": 0,
            "warnings": 0,
            "complete": True,
        },
    )
    assert filtered_scope.payload["scope_end"] == "2026-07-01"
    assert filtered_scope.payload["dependency_end"] == "2026-07-03"
    validate_historic_entity_receipt(
        build_historic_entity_receipt(
            provider_id="receipt-unit",
            family="stops",
            entity_key="S/1",
            common_envelope=common,
            scope_receipts=(filtered_scope,),
            origin_publish_generation_id="filtered-origin",
            activated_root_generation_id="filtered-root",
        )
    )
    outside_ref = {
        **july_ref,
        "coverage_start": "2026-07-02",
        "coverage_end": "2026-07-02",
    }
    outside_detached = build_historic_detached_contribution(
        family="stops",
        artifact_ref=outside_ref,
        partition={
            "generated_utc": "2026-07-03T00:00:00Z",
            "methodology_version": "history-1",
            "month": "2026-07",
            "entity_id": "S/1",
            "days": [{"date": "2026-07-02", "delay": {"observation_count": 1}}],
        },
    )
    with pytest.raises(
        HistoricReceiptEvidenceError,
        match="dependency coverage must contain artifact coverage",
    ):
        build_historic_scope_receipt(
            common_envelope=common,
            source_evidence=evidence,
            artifact_ref=outside_ref,
            raw_day_count=1,
            detached_summary=outside_detached,
            source_timestamps=evidence.source_timestamps,
            origin_gate={
                "enabled": True,
                "force": False,
                "verdict": "PASS",
                "checks": 12,
                "errors": 0,
                "warnings": 0,
                "complete": True,
            },
        )
    june_evidence = _scope_evidence(date(2026, 6, 30))
    june_ref = {
        "path": "historic/history/stops/532f31/generations/def/2026-06.json",
        "coverage_start": "2026-06-30",
        "coverage_end": "2026-06-30",
        "count": 1,
        "sha256": "e" * 64,
        "byte_size": 300,
    }
    june_detached = build_historic_detached_contribution(
        family="stops",
        artifact_ref=june_ref,
        partition={
            "generated_utc": "2026-07-01T00:00:00Z",
            "methodology_version": "history-1",
            "month": "2026-06",
            "entity_id": "S/1",
            "days": [{"date": "2026-06-30", "delay": {"observation_count": 1}}],
        },
    )
    june = build_historic_scope_receipt(
        common_envelope=common,
        source_evidence=june_evidence,
        artifact_ref=june_ref,
        raw_day_count=1,
        detached_summary=june_detached,
        source_timestamps=june_evidence.source_timestamps,
        origin_gate={
            "enabled": True,
            "force": False,
            "verdict": "PASS",
            "checks": 12,
            "errors": 0,
            "warnings": 0,
            "complete": True,
        },
    )
    first = build_historic_entity_receipt(
        provider_id="receipt-unit",
        family="stops",
        entity_key="S/1",
        common_envelope=common,
        scope_receipts=(july, june),
        origin_publish_generation_id="origin-1",
        activated_root_generation_id="root-1",
    )
    second = build_historic_entity_receipt(
        provider_id="receipt-unit",
        family="stops",
        entity_key="S/1",
        common_envelope=common,
        scope_receipts=(june, july),
        origin_publish_generation_id="origin-2",
        activated_root_generation_id="root-2",
    )
    july_with_new_diagnostics = replace(
        july,
        payload={
            **july.payload,
            "diagnostics": {
                "today_local": "2026-07-30",
                "scope_class": "mutable_edge",
            },
        },
    ).rehash()
    diagnostic_only_change = build_historic_entity_receipt(
        provider_id="receipt-unit",
        family="stops",
        entity_key="S/1",
        common_envelope=common,
        scope_receipts=(june, july_with_new_diagnostics),
        origin_publish_generation_id="origin-3",
        activated_root_generation_id="root-3",
    )

    assert list(first.month_receipts) == ["2026-06", "2026-07"]
    assert first.entity_receipt_sha256 == second.entity_receipt_sha256
    assert first.entity_receipt_sha256 == diagnostic_only_change.entity_receipt_sha256
    assert july.payload["artifact"] == {
        "path": "historic/history/stops/532f31/generations/abc/2026-07.json",
        "sha256": "f" * 64,
        "byte_size": 321,
        "day_count": 1,
    }
    assert july.payload["raw_day_count"] == 1
    assert (
        july.payload["detached_summary"]["gate_summary_contribution"][
            "duplicate_dates"
        ]
        is False
    )
    assert july.payload["source_timestamps"] == ["2026-07-02T00:00:00Z"]
    assert july.payload["origin_reusable"] is True
    with pytest.raises(ValueError, match="input/common envelope"):
        build_historic_entity_receipt(
            provider_id="receipt-unit",
            family="stops",
            entity_key="S/1",
            common_envelope=_common_envelope(lock_sha="0" * 64),
            scope_receipts=(july,),
            origin_publish_generation_id="origin-4",
            activated_root_generation_id="root-4",
        )


def test_origin_gate_evidence_is_fail_closed_and_writer_enforces_map_cardinality():
    common = _common_envelope()
    evidence = _scope_evidence()
    artifact_ref = {
        "path": "historic/history/stops/532f31/generations/abc/2026-07.json",
        "coverage_start": "2026-07-01",
        "coverage_end": "2026-07-01",
        "count": 1,
        "sha256": "f" * 64,
        "byte_size": 321,
    }
    detached = build_historic_detached_contribution(
        family="stops",
        artifact_ref=artifact_ref,
        partition={
            "generated_utc": "2026-07-02T00:00:00Z",
            "month": "2026-07",
            "entity_id": "S/1",
            "days": [{"date": "2026-07-01", "delay": {"observation_count": 1}}],
        },
    )
    kwargs = {
        "common_envelope": common,
        "source_evidence": evidence,
        "artifact_ref": artifact_ref,
        "raw_day_count": 1,
        "detached_summary": detached,
        "source_timestamps": evidence.source_timestamps,
    }
    no_gate = build_historic_scope_receipt(
        **kwargs,
        origin_gate={
            "enabled": False,
            "force": False,
            "verdict": None,
            "checks": 0,
            "errors": 0,
            "warnings": 0,
            "complete": False,
        },
    )
    forced_error = build_historic_scope_receipt(
        **kwargs,
        origin_gate={
            "enabled": True,
            "force": True,
            "verdict": "ERROR",
            "checks": 12,
            "errors": 1,
            "warnings": 0,
            "complete": True,
        },
    )
    forced_clean = build_historic_scope_receipt(
        **kwargs,
        origin_gate={
            "enabled": True,
            "force": True,
            "verdict": "PASS",
            "checks": 12,
            "errors": 0,
            "warnings": 0,
            "complete": True,
        },
    )
    assert no_gate.payload["origin_reusable"] is False
    assert forced_error.payload["origin_reusable"] is False
    assert forced_clean.payload["origin_reusable"] is True
    with pytest.raises(
        HistoricReceiptEvidenceError,
        match="origin gate evidence is inconsistent",
    ):
        build_historic_scope_receipt(
            **kwargs,
            origin_gate={
                "enabled": True,
                "force": False,
                "verdict": "PASS",
                "checks": 12,
                "errors": 1,
                "warnings": 0,
                "complete": True,
            },
        )

    entity = build_historic_entity_receipt(
        provider_id="receipt-unit",
        family="stops",
        entity_key="S/1",
        common_envelope=common,
        scope_receipts=(forced_clean,),
        origin_publish_generation_id="origin",
        activated_root_generation_id="root",
    )
    with pytest.raises(ValueError, match="scope_count"):
        validate_historic_entity_receipt(replace(entity, scope_count=2))
    with pytest.raises(ValueError, match="generation IDs"):
        validate_historic_entity_receipt(
            replace(entity, activated_root_generation_id="")
        )
    tampered_months = deepcopy(entity.month_receipts)
    tampered_scope = tampered_months["2026-07"]
    tampered_scope["dependency_start"] = "2026-07-02"
    tampered_scope["dependency_end"] = "2026-07-02"
    tampered_scope["scope_receipt_sha256"] = receipts_module._json_sha256(
        receipts_module._scope_semantic_payload(tampered_scope)
    )
    tampered_entity = replace(
        entity,
        month_receipts=tampered_months,
        entity_receipt_sha256=receipts_module._json_sha256(
            {
                "receipt_schema_version": entity.receipt_schema_version,
                "provider_id": entity.provider_id,
                "family": entity.family,
                "entity_key": entity.entity_key,
                "common_envelope_sha256": entity.common_envelope_sha256,
                "month_receipts": receipts_module._entity_semantic_months(
                    tampered_months
                ),
            }
        ),
    )
    with pytest.raises(ValueError, match="dependency coverage must contain"):
        validate_historic_entity_receipt(tampered_entity)
    with pytest.raises(ValueError, match="common envelope fields"):
        validate_historic_entity_receipt(
            replace(
                entity,
                common_envelope={
                    key: value
                    for key, value in entity.common_envelope.items()
                    if key != "installed_code_sha256"
                },
            )
        )
    contradictory_gate = replace(
        forced_clean,
        payload={**forced_clean.payload, "origin_reusable": False},
    ).rehash()
    with pytest.raises(ValueError, match="origin gate reuse"):
        build_historic_entity_receipt(
            provider_id="receipt-unit",
            family="stops",
            entity_key="S/1",
            common_envelope=common,
            scope_receipts=(contradictory_gate,),
            origin_publish_generation_id="origin-contradictory",
            activated_root_generation_id="root-contradictory",
        )
    detached_payload = deepcopy(forced_clean.payload)
    detached_payload["detached_summary"]["builder_summary_contribution"][
        "metric_dates"
    ]["delay"] = ["2026-07-02"]
    detached_payload["detached_summary"]["gate_summary_contribution"][
        "metric_date_masks"
    ]["delay"] = ["2026-07-02"]
    contradictory_detached = replace(
        forced_clean,
        payload=detached_payload,
    ).rehash()
    with pytest.raises(ValueError, match="detached dates"):
        build_historic_entity_receipt(
            provider_id="receipt-unit",
            family="stops",
            entity_key="S/1",
            common_envelope=common,
            scope_receipts=(contradictory_detached,),
            origin_publish_generation_id="origin-detached",
            activated_root_generation_id="root-detached",
        )


def test_receipt_persistence_prefilters_headers_and_batches_only_changed_rows():
    receipts = tuple(
        _persistence_receipt(f"S{position:04d}", revision="new", padding_bytes=256)
        for position in range(504)
    )
    unchanged = receipts[0]
    stale_json = {
        ("stops", "STALE-A"): (
            {"family": "stops", "padding": "a" * 800},
            {"2026-05": {"padding": "b" * 900}, "2026-06": {"v": 1}},
        ),
        ("stops", "STALE-B"): (
            {"family": "stops", "padding": "c" * 700},
            {"2026-07": {"padding": "d" * 600}},
        ),
    }
    existing_rows = [
        {
            "family": "stops",
            "entity_key": unchanged.entity_key,
            "entity_receipt_sha256": unchanged.entity_receipt_sha256,
            "month_keys": ["2026-07"],
            "common_envelope": unchanged.common_envelope,
            "month_receipts": unchanged.month_receipts,
        },
        {
            "family": "stops",
            "entity_key": receipts[1].entity_key,
            "entity_receipt_sha256": "0" * 64,
            "month_keys": ["2026-06", "2026-07"],
            "common_envelope": receipts[1].common_envelope,
            "month_receipts": {
                "2026-06": {"legacy": True},
                **receipts[1].month_receipts,
            },
        },
        *[
            {
                "family": family,
                "entity_key": entity_key,
                "entity_receipt_sha256": "f" * 64,
                "month_keys": list(month_receipts),
                "common_envelope": common_envelope,
                "month_receipts": month_receipts,
            }
            for (family, entity_key), (common_envelope, month_receipts) in stale_json.items()
        ],
    ]
    existing_digests = {
        (row["family"], row["entity_key"]): row["entity_receipt_sha256"]
        for row in existing_rows
    }

    class Result:
        def __init__(self, rows=(), *, rowcount=0):  # noqa: ANN001
            self._rows = tuple(rows)
            self.rowcount = rowcount

        def mappings(self):  # noqa: ANN201
            return self._rows

    class Connection:
        def __init__(self) -> None:
            self.statements: list[tuple[str, str]] = []
            self.upsert_batches: list[list[dict[str, object]]] = []
            self.stale_fetches: list[dict[str, object]] = []

        def execute(self, statement, parameters):  # noqa: ANN001, ANN201
            name = query_name(statement)
            self.statements.append((name, str(statement)))
            if name == "snapshot.historic_receipts.existing":
                return Result(existing_rows)
            if name == "snapshot.historic_receipts.stale_json":
                self.stale_fetches.append(dict(parameters))
                keys = set(parameters["entity_keys"])
                return Result(
                    {
                        "entity_key": entity_key,
                        "common_envelope": common_envelope,
                        "month_receipts": month_receipts,
                    }
                    for (family, entity_key), (
                        common_envelope,
                        month_receipts,
                    ) in stale_json.items()
                    if family == parameters["family"] and entity_key in keys
                )
            if name == "snapshot.historic_receipts.upsert":
                batch = parameters if isinstance(parameters, list) else [parameters]
                copied = [dict(item) for item in batch]
                self.upsert_batches.append(copied)
                changed = sum(
                    existing_digests.get((item["family"], item["entity_key"]))
                    != item["entity_receipt_sha256"]
                    for item in copied
                )
                return Result(rowcount=changed)
            if name == "snapshot.historic_receipts.delete_stale":
                current = set(parameters["entity_keys"])
                deleted = sum(
                    family == parameters["family"] and entity_key not in current
                    for family, entity_key in existing_digests
                )
                return Result(rowcount=deleted)
            raise AssertionError(name)

    connection = Connection()
    stats = receipts_module.persist_historic_receipts(
        connection,
        provider_id="receipt-unit",
        receipts=receipts,
        complete_families=("stops",),
    )

    canonical_size = lambda value: len(  # noqa: E731
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()
    )
    expected_attempted_bytes = sum(
        canonical_size(receipt.common_envelope) + canonical_size(receipt.month_receipts)
        for receipt in receipts
    )
    expected_changed_bytes = sum(
        canonical_size(receipt.common_envelope) + canonical_size(receipt.month_receipts)
        for receipt in receipts[1:]
    ) + sum(
        canonical_size(common_envelope) + canonical_size(month_receipts)
        for common_envelope, month_receipts in stale_json.values()
    )
    header_sql = next(
        sql
        for name, sql in connection.statements
        if name == "snapshot.historic_receipts.existing"
    )
    upserted_keys = [
        (item["family"], item["entity_key"])
        for batch in connection.upsert_batches
        for item in batch
    ]
    observed_shape = {
        "header_has_full_json": "common_envelope" in header_sql,
        "header_has_raw_month_receipts": "month_receipts"
        in {line.strip().rstrip(",") for line in header_sql.splitlines()},
        "header_has_month_keys": "jsonb_object_keys(month_receipts)" in header_sql,
        "stale_fetches": len(connection.stale_fetches),
        "upsert_batch_sizes": [len(batch) for batch in connection.upsert_batches],
        "unchanged_upserted": ("stops", unchanged.entity_key) in upserted_keys,
    }
    assert observed_shape == {
        "header_has_full_json": False,
        "header_has_raw_month_receipts": False,
        "header_has_month_keys": True,
        "stale_fetches": 1,
        "upsert_batch_sizes": [250, 250, 3],
        "unchanged_upserted": False,
    }, observed_shape
    assert stats == receipts_module.HistoricReceiptPersistenceStats(
        rows_attempted=504,
        rows_changed=505,
        json_bytes_attempted=expected_attempted_bytes,
        json_bytes_changed=expected_changed_bytes,
        stale_entities_deleted=2,
        stale_months_deleted=4,
    )
