"""Real-database regression tests for core.snapshot_publish_state (slice-9.1.1r).

These exercise the actual Postgres constraints that fake-connection tests
structurally cannot see — the (provider_id, tier) PK + ON CONFLICT upsert, the
FK to core.providers, and the tier CHECK — plus build_manifest reading real
tier-state rows.

They run ONLY when TRANSIT_TEST_DATABASE_URL points at a disposable Postgres
with the transit schema applied and migration 0042 present, e.g. a throwaway
local cluster restored from ``pg_dump --schema-only`` of prod then
``alembic upgrade head`` (which applies 0042 on top). Each test runs inside one
transaction and rolls back — nothing persists, reruns are idempotent.

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://repro@:55432/transit_repro\
?host=/tmp/snaprepro" \
        uv run pytest tests/test_snapshots_real_db_state.py -v

Never point this at production. (CI has no Postgres — skipped there.)
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from test_historic_receipts import _persistence_receipt

from transit_ops.snapshots import builders
from transit_ops.snapshots import historic_receipts as receipts_module
from transit_ops.snapshots.publish import _prior_files_total, _record_publish_state
from transit_ops.sql_registry import query_name

PROVIDER = "stm_snapstate_test"
T1 = datetime(2026, 6, 1, 0, 0, tzinfo=UTC)
T2 = datetime(2026, 6, 13, 0, 0, tzinfo=UTC)


@pytest.fixture()
def conn(real_db_engine, seed_provider):  # noqa: ANN001
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        seed_provider(connection, PROVIDER, display_name="STM snapshot-state regression")
        try:
            yield connection
        finally:
            transaction.rollback()


def _state_rows(connection) -> list[dict]:
    return [
        dict(row)
        for row in connection.execute(
            text(
                """
                SELECT provider_id, tier, generated_utc, files_written,
                       files_skipped, files_total, stable_files_total,
                       historic_files_reused, historic_scopes_reused,
                       historic_scopes_rebuilt, historic_source_digest_ms,
                       historic_build_ms, historic_gate_ms, historic_upload_ms,
                       historic_parent_compose_ms, historic_compatibility_ms,
                       historic_receipt_persist_ms,
                       historic_receipt_rows_attempted,
                       historic_receipt_rows_changed, historic_phase_detail,
                       updated_at_utc
                FROM core.snapshot_publish_state
                WHERE provider_id = :p
                ORDER BY tier
                """
            ),
            {"p": PROVIDER},
        ).mappings()
    ]


def test_state_upsert_is_idempotent(conn) -> None:
    """Calling _record_publish_state twice on (provider, tier) leaves one row;
    the second call's values win and updated_at_utc advances."""
    _record_publish_state(
        conn,
        provider_id=PROVIDER,
        tier="static",
        generated_utc=T1,
        written=9300,
        skipped=0,
        total=9300,
    )
    first = _state_rows(conn)
    assert len(first) == 1
    assert first[0]["files_written"] == 9300
    assert first[0]["stable_files_total"] == 9300
    first_updated = first[0]["updated_at_utc"]

    _record_publish_state(
        conn,
        provider_id=PROVIDER,
        tier="static",
        generated_utc=T2,
        written=20,
        skipped=9280,
        total=9300,
    )
    rows = _state_rows(conn)
    assert len(rows) == 1, "upsert must not insert a second row"
    assert rows[0]["files_written"] == 20
    assert rows[0]["files_skipped"] == 9280
    assert rows[0]["generated_utc"] == T2
    assert rows[0]["stable_files_total"] == 9300
    assert rows[0]["updated_at_utc"] >= first_updated


def test_state_fk_rejects_unknown_provider(conn) -> None:
    """A row for a provider absent from core.providers violates the FK."""
    from sqlalchemy.exc import IntegrityError

    with pytest.raises(IntegrityError):
        _record_publish_state(
            conn,
            provider_id="ghost_provider",
            tier="static",
            generated_utc=T1,
            written=0,
            skipped=0,
            total=0,
        )


def test_tier_check_constraint(conn) -> None:
    """tier outside {live,static,historic} violates the CHECK constraint."""
    from sqlalchemy.exc import IntegrityError

    with pytest.raises(IntegrityError):
        _record_publish_state(
            conn,
            provider_id=PROVIDER,
            tier="bogus",
            generated_utc=T1,
            written=0,
            skipped=0,
            total=0,
        )


def test_build_manifest_reads_tier_state(conn) -> None:
    """build_manifest fills files.static/historic generated_utc from the table."""
    _record_publish_state(
        conn,
        provider_id=PROVIDER,
        tier="static",
        generated_utc=T1,
        written=10,
        skipped=0,
        total=10,
    )
    _record_publish_state(
        conn,
        provider_id=PROVIDER,
        tier="historic",
        generated_utc=T2,
        written=5,
        skipped=0,
        total=5,
    )

    class _Settings:
        SNAPSHOT_PUBLIC_BASE_URL = "https://data.example.com"

    manifest = builders.build_manifest(
        conn, provider_id=PROVIDER, generated_utc="2026-06-13T12:00:00Z", settings=_Settings()
    )
    assert manifest.files.static.generated_utc == "2026-06-01T00:00:00Z"
    assert manifest.files.historic.generated_utc == "2026-06-13T00:00:00Z"
    assert manifest.basemap is None  # no PMTILES URL configured


def test_historic_state_tracks_physical_and_stable_totals_separately(conn) -> None:
    _record_publish_state(
        conn,
        provider_id=PROVIDER,
        tier="historic",
        generated_utc=T2,
        written=14,
        skipped=3,
        total=17,
        stable_total=12,
    )

    row = _state_rows(conn)[0]
    assert row["files_total"] == 17
    assert row["stable_files_total"] == 12
    assert _prior_files_total(conn, provider_id=PROVIDER, tier="historic") == 12


def test_pre_0081_null_stable_total_falls_back_to_physical_total(conn) -> None:
    conn.execute(
        text(
            """
            INSERT INTO core.snapshot_publish_state
                (provider_id, tier, generated_utc, files_written, files_skipped, files_total)
            VALUES (:provider, 'historic', :generated, 7, 2, 9)
            """
        ),
        {"provider": PROVIDER, "generated": T1},
    )

    row = _state_rows(conn)[0]
    assert row["stable_files_total"] is None
    assert _prior_files_total(conn, provider_id=PROVIDER, tier="historic") == 9


def test_f7a_historic_telemetry_is_zero_reuse_and_live_static_stay_null(conn) -> None:
    from sqlalchemy.exc import IntegrityError

    telemetry = {
        "historic_files_reused": 0,
        "historic_scopes_reused": 0,
        "historic_scopes_rebuilt": 4,
        "source_digest_ms": 1.25,
        "build_ms": 2.5,
        "gate_ms": 3.75,
        "upload_ms": 4.0,
        "parent_compose_ms": 5.25,
        "compatibility_ms": 6.5,
        "receipt_persist_ms": 0.75,
        "receipt_rows_attempted": 3,
        "receipt_rows_changed": 2,
        "receipt_persist_failed": False,
        "schema_version": 1,
    }
    _record_publish_state(
        conn,
        provider_id=PROVIDER,
        tier="historic",
        generated_utc=T2,
        written=12,
        skipped=5,
        total=17,
        historic_telemetry=telemetry,
    )
    for tier in ("live", "static"):
        _record_publish_state(
            conn,
            provider_id=PROVIDER,
            tier=tier,
            generated_utc=T2,
            written=7,
            skipped=2,
            total=9,
        )

    rows = {row["tier"]: row for row in _state_rows(conn)}
    historic = rows["historic"]
    assert historic["historic_files_reused"] == 0
    assert historic["historic_scopes_reused"] == 0
    assert historic["historic_scopes_rebuilt"] == 4
    assert historic["historic_source_digest_ms"] == pytest.approx(1.25)
    assert historic["historic_build_ms"] == pytest.approx(2.5)
    assert historic["historic_gate_ms"] == pytest.approx(3.75)
    assert historic["historic_upload_ms"] == pytest.approx(4.0)
    assert historic["historic_parent_compose_ms"] == pytest.approx(5.25)
    assert historic["historic_compatibility_ms"] == pytest.approx(6.5)
    assert historic["historic_receipt_persist_ms"] == pytest.approx(0.75)
    assert historic["historic_receipt_rows_attempted"] == 3
    assert historic["historic_receipt_rows_changed"] == 2
    assert historic["historic_phase_detail"]["receipt_persist_failed"] is False

    telemetry_columns = [name for name in historic if name.startswith("historic_")]
    assert all(
        rows[tier][column] is None
        for tier in ("live", "static")
        for column in telemetry_columns
    )
    sql_null_detail_tiers = set(
        conn.execute(
            text(
                "SELECT tier FROM core.snapshot_publish_state "
                "WHERE provider_id = :provider_id "
                "AND tier IN ('live', 'static') "
                "AND historic_phase_detail IS NULL"
            ),
            {"provider_id": PROVIDER},
        ).scalars()
    )
    assert sql_null_detail_tiers == {"live", "static"}
    for row in rows.values():
        assert row["files_total"] == (
            row["files_written"]
            + row["files_skipped"]
            + (row["historic_files_reused"] or 0)
        )

    with pytest.raises(IntegrityError):
        with conn.begin_nested():
            conn.execute(
                text(
                    "UPDATE core.snapshot_publish_state "
                    "SET historic_files_reused = 1 "
                    "WHERE provider_id = :provider_id AND tier = 'historic'"
                ),
                {"provider_id": PROVIDER},
            )


def test_historic_receipt_batches_and_later_batch_savepoint_rollback_real_db(conn) -> None:
    def receipt_json_bytes(receipt) -> int:  # noqa: ANN001
        return sum(
            len(
                json.dumps(
                    value,
                    ensure_ascii=False,
                    separators=(",", ":"),
                    sort_keys=True,
                ).encode()
            )
            for value in (receipt.common_envelope, receipt.month_receipts)
        )

    initial = tuple(
        _persistence_receipt(
            f"R{position:04d}",
            revision="initial",
            padding_bytes=2048,
            provider_id=PROVIDER,
        )
        for position in range(2005)
    )
    receipts_module.persist_historic_receipts(
        conn,
        provider_id=PROVIDER,
        receipts=initial,
        complete_families=("stops",),
    )
    candidate = (
        *initial[:1251],
        *(
            _persistence_receipt(
                f"R{position:04d}",
                revision="changed",
                padding_bytes=2048,
                provider_id=PROVIDER,
            )
            for position in range(1251, 2000)
        ),
        *(
            _persistence_receipt(
                f"R{position:04d}",
                revision="new",
                padding_bytes=2048,
                provider_id=PROVIDER,
            )
            for position in range(2005, 2256)
        ),
    )

    class RecordingConnection:
        def __init__(self, delegate) -> None:  # noqa: ANN001
            self.delegate = delegate
            self.upsert_batches: list[list[dict[str, object]]] = []

        def execute(self, statement, parameters):  # noqa: ANN001, ANN201
            if query_name(statement) == "snapshot.historic_receipts.upsert":
                assert isinstance(parameters, list)
                self.upsert_batches.append([dict(item) for item in parameters])
            return self.delegate.execute(statement, parameters)

    recording = RecordingConnection(conn)
    stats = receipts_module.persist_historic_receipts(
        recording,
        provider_id=PROVIDER,
        receipts=candidate,
        complete_families=("stops",),
    )
    upserted_keys = {
        item["entity_key"] for batch in recording.upsert_batches for item in batch
    }
    assert [len(batch) for batch in recording.upsert_batches] == [250, 250, 250, 250]
    assert not upserted_keys.intersection(f"R{position:04d}" for position in range(1251))
    assert stats.rows_attempted == 2251
    assert stats.rows_changed == 1005
    assert stats.stale_entities_deleted == 5
    assert stats.stale_months_deleted == 5
    assert stats.json_bytes_attempted == sum(receipt_json_bytes(receipt) for receipt in candidate)
    assert stats.json_bytes_changed == sum(
        receipt_json_bytes(receipt) for receipt in (*candidate[1251:], *initial[2000:])
    )
    row_count = conn.execute(
        text(
            "SELECT count(*) FROM core.snapshot_historic_receipts "
            "WHERE provider_id = :provider_id AND family = 'stops'"
        ),
        {"provider_id": PROVIDER},
    ).scalar_one()
    assert row_count == 2251

    before_failure = dict(
        conn.execute(
            text(
                "SELECT entity_key, entity_receipt_sha256 "
                "FROM core.snapshot_historic_receipts "
                "WHERE provider_id = :provider_id AND family = 'stops'"
            ),
            {"provider_id": PROVIDER},
        ).all()
    )
    assert before_failure == {
        receipt.entity_key: receipt.entity_receipt_sha256 for receipt in candidate
    }
    rollback_candidate = (
        *(
            _persistence_receipt(
                f"R{position:04d}",
                revision="rollback",
                padding_bytes=2048,
                provider_id=PROVIDER,
            )
            for position in range(501)
        ),
        *candidate[501:],
    )

    class LaterBatchFailure(RecordingConnection):
        def execute(self, statement, parameters):  # noqa: ANN001, ANN201
            if query_name(statement) == "snapshot.historic_receipts.upsert":
                assert isinstance(parameters, list)
                self.upsert_batches.append([dict(item) for item in parameters])
                if len(self.upsert_batches) == 2:
                    raise RuntimeError("injected later receipt batch failure")
                return self.delegate.execute(statement, parameters)
            return self.delegate.execute(statement, parameters)

    failing = LaterBatchFailure(conn)
    with pytest.raises(RuntimeError, match="later receipt batch failure"):
        with conn.begin_nested():
            receipts_module.persist_historic_receipts(
                failing,
                provider_id=PROVIDER,
                receipts=rollback_candidate,
                complete_families=("stops",),
            )
    assert [len(batch) for batch in failing.upsert_batches] == [250, 250]
    after_failure = dict(
        conn.execute(
            text(
                "SELECT entity_key, entity_receipt_sha256 "
                "FROM core.snapshot_historic_receipts "
                "WHERE provider_id = :provider_id AND family = 'stops'"
            ),
            {"provider_id": PROVIDER},
        ).all()
    )
    assert after_failure == before_failure
