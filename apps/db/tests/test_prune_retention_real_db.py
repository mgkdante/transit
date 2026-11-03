from __future__ import annotations

from contextlib import nullcontext
from datetime import date
from types import SimpleNamespace

import pytest
from sqlalchemy import text
from test_bronze_prune_real_db import NOW, PROVIDER, REALTIME_ROWS, TU_OLD_A, TU_OLD_B, TU_OLD_C
from test_bronze_prune_real_db import conn as conn

from transit_ops.maintenance import (
    bronze,
)
from transit_ops.settings import Settings


class TransactionEngine:
    """Keep real SQL inside the fixture's rollback-only transaction."""

    def __init__(self, connection):
        self.connection = connection

    def begin(self):
        return nullcontext(self.connection)


@pytest.fixture
def retention(conn, tmp_path, monkeypatch):
    monkeypatch.setattr(bronze, "utc_now", lambda: NOW)
    conn.execute(
        text("UPDATE raw.ingestion_objects SET storage_backend='local' WHERE provider_id=:p"),
        {"p": PROVIDER},
    )
    for *_, path in REALTIME_ROWS:
        archive = tmp_path / path
        archive.parent.mkdir(parents=True, exist_ok=True)
        archive.write_bytes(b"retention fixture")
    settings = Settings(
        _env_file=None,
        DATABASE_URL=conn.engine.url.render_as_string(hide_password=False),
        BRONZE_STORAGE_BACKEND="local",
        BRONZE_LOCAL_ROOT=str(tmp_path),
        BRONZE_REALTIME_RETENTION_DAYS=30,
        BRONZE_STATIC_RETENTION_DAYS=30,
    )
    return settings, TransactionEngine(conn), tmp_path


@pytest.mark.parametrize(
    "max_objects,max_batches,deleted,batches,exhausted",
    [(2, 1, 2, 1, False), (2, 2, 3, 2, True), (1, 3, 3, 3, False), (1, 4, 3, 4, True)],
)
def test_bronze_pass_preserves_batch_budget_and_exhaustion(
    conn, retention, max_objects, max_batches, deleted, batches, exhausted
):
    settings, engine, root = retention
    result = bronze.prune_bronze_storage(
        PROVIDER,
        settings=settings,
        engine=engine,
        max_objects=max_objects,
        max_batches=max_batches,
    )
    assert result.deleted_object_counts == {"realtime": deleted, "static": 0}
    assert result.batch_counts == {"realtime": batches, "static": 1}
    assert result.exhausted is exhausted
    assert result.failed_object_counts == {"realtime": 0, "static": 0}
    remaining = set(
        conn.execute(
            text("SELECT ingestion_object_id FROM raw.ingestion_objects WHERE provider_id=:p"),
            {"p": PROVIDER},
        ).scalars()
    )
    assert remaining == {row[1] for row in REALTIME_ROWS[deleted:]}
    assert [not (root / row[5]).exists() for row in REALTIME_ROWS] == [
        index < deleted for index in range(len(REALTIME_ROWS))
    ]


def test_bronze_pass_excludes_failed_archive_and_processes_later_batches(conn, retention):
    settings, engine, root = retention
    # A directory cannot be unlinked as an archive on Windows or Linux.
    failed_path = root / TU_OLD_A[5]
    failed_path.unlink()
    failed_path.mkdir()
    result = bronze.prune_bronze_storage(
        PROVIDER,
        settings=settings,
        engine=engine,
        max_objects=2,
        max_batches=2,
    )
    assert result.deleted_object_counts == {"realtime": 2, "static": 0}
    assert result.failed_object_counts == {"realtime": 1, "static": 0}
    assert result.batch_counts == {"realtime": 2, "static": 1}
    assert result.exhausted is True
    assert failed_path.is_dir()
    assert not (root / TU_OLD_B[5]).exists()
    assert not (root / TU_OLD_C[5]).exists()
    assert (
        conn.execute(
            text("SELECT count(*) FROM raw.ingestion_objects WHERE ingestion_object_id=:id"),
            {"id": TU_OLD_A[1]},
        ).scalar_one()
        == 1
    )


def test_bronze_dry_run_reports_whole_backlog_without_archive_access(conn, retention):
    settings, engine, root = retention
    result = bronze.prune_bronze_storage(
        PROVIDER,
        settings=settings,
        engine=engine,
        dry_run=True,
        max_objects=1,
        max_batches=1,
    )
    assert result.deleted_object_counts == {"realtime": 3, "static": 0}
    assert result.batch_counts == {"realtime": 0, "static": 0}
    assert result.exhausted is False
    assert all((root / row[5]).exists() for row in REALTIME_ROWS)
    assert (
        conn.execute(
            text("SELECT count(*) FROM raw.ingestion_objects WHERE provider_id=:p"),
            {"p": PROVIDER},
        ).scalar_one()
        == 5
    )


def test_public_prune_returns_the_bounded_bronze_receipt(retention):
    from transit_ops.maintenance import (
        PruneBudget,
        RetentionPolicy,
        RetentionTier,
        prune,
    )

    settings, engine, root = retention
    receipt = prune(
        PROVIDER,
        RetentionPolicy(settings, tiers=frozenset({RetentionTier.BRONZE}), prove=False),
        PruneBudget(max_objects=2, max_batches=1),
        engine=engine,
    )
    result = receipt.results[RetentionTier.BRONZE]
    assert result.deleted_object_counts == {"realtime": 2, "static": 0}
    assert result.batch_counts == {"realtime": 1, "static": 1}
    assert result.exhausted is False
    assert receipt.is_complete
    assert receipt.proof is None
    assert not (root / TU_OLD_A[5]).exists()
    assert (root / TU_OLD_C[5]).exists()


@pytest.mark.parametrize("unified", [False, True])
def test_same_pass_removes_silver_and_gold_references_before_bronze(
    conn, retention, monkeypatch, unified
):
    from transit_ops.maintenance import RetentionPolicy, RetentionTier, gold, prune, silver

    settings, engine, root = retention
    monkeypatch.setattr(silver, "utc_now", lambda: NOW)
    monkeypatch.setattr(gold, "utc_now", lambda: NOW)
    for row in (TU_OLD_A, REALTIME_ROWS[3]):
        run_id, object_id, snapshot_id, endpoint_id, captured, _ = row
        conn.execute(
            text("""
            INSERT INTO silver.rt_feed_snapshots
                (rt_feed_snapshot_id, provider_id, feed_endpoint_id, ingestion_run_id,
                 ingestion_object_id, endpoint_key, source_realtime_snapshot_id, captured_at_utc)
            VALUES (:s, :p, :e, :r, :o, 'trip_updates', :s, :captured)
        """),
            {
                "s": snapshot_id,
                "p": PROVIDER,
                "e": endpoint_id,
                "r": run_id,
                "o": object_id,
                "captured": captured,
            },
        )
    for table in ("fact_vehicle_snapshot", "fact_trip_delay_snapshot"):
        extra_columns = ", stop_time_update_count" if table == "fact_trip_delay_snapshot" else ""
        extra_values = ", 0" if table == "fact_trip_delay_snapshot" else ""
        conn.execute(
            text(f"""
            INSERT INTO gold.{table}
                (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                 snapshot_local_date, feed_timestamp_utc, captured_at_utc{extra_columns})
            VALUES (:p, :s, 0, 20260101, '2026-01-01', :captured, :captured{extra_values})
        """),
            {"p": PROVIDER, "s": TU_OLD_B[2], "captured": TU_OLD_B[4]},
        )
    if unified:
        receipt = prune(
            PROVIDER,
            RetentionPolicy(
                settings,
                tiers=frozenset(
                    {
                        RetentionTier.BRONZE,
                        RetentionTier.GOLD,
                        RetentionTier.SILVER,
                    }
                ),
                prove=False,
            ),
            engine=engine,
        )
        assert list(receipt.results) == [
            RetentionTier.SILVER,
            RetentionTier.GOLD,
            RetentionTier.BRONZE,
        ]
        silver_result = receipt.results[RetentionTier.SILVER]
        gold_result = receipt.results[RetentionTier.GOLD]
        bronze_result = receipt.results[RetentionTier.BRONZE]
    else:
        silver_result = silver.prune_silver_storage(PROVIDER, settings=settings, engine=engine)
        gold_result = gold.prune_gold_storage(PROVIDER, settings=settings, engine=engine)
        bronze_result = bronze.prune_bronze_storage(PROVIDER, settings=settings, engine=engine)
    assert silver_result.deleted_row_counts["silver.rt_feed_snapshots"] == 1
    assert gold_result.deleted_row_counts == {
        "gold.fact_trip_delay_snapshot": 1,
        "gold.fact_vehicle_snapshot": 1,
    }
    assert bronze_result.deleted_object_counts == {"realtime": 3, "static": 0}
    assert not (root / TU_OLD_A[5]).exists()
    assert not (root / TU_OLD_B[5]).exists()
    assert not (root / TU_OLD_C[5]).exists()
    assert (root / REALTIME_ROWS[3][5]).exists()


@pytest.mark.parametrize("require_exhausted", [False, True])
@pytest.mark.parametrize("static_ok", [False, True])
def test_post_prune_proof_counts_residual_backlog_without_deleting_it(
    conn, retention, monkeypatch, require_exhausted, static_ok
):
    from transit_ops.maintenance import PruneBudget, RetentionPolicy, RetentionTier, i3, prune
    from transit_ops.validation import proof

    settings, engine, root = retention
    # Keep provider discovery/static HTTP outside this real retention test.
    monkeypatch.setattr(
        i3,
        "_provider_alert_archive_bounds",
        lambda *args: (
            date(2024, 1, 1),
            date(2026, 12, 1),
        ),
    )
    monkeypatch.setattr(
        proof,
        "validate_static_feeds",
        lambda *args, **kwargs: SimpleNamespace(
            display_dict=lambda: {
                "active_static": {"status": "ok" if static_ok else "unavailable"}
            },
        ),
    )
    receipt = prune(
        PROVIDER,
        RetentionPolicy(
            settings, tiers=frozenset({RetentionTier.BRONZE}), require_exhausted=require_exhausted
        ),
        PruneBudget(max_objects=2, max_batches=1),
        engine=engine,
    )
    assert receipt.is_complete is (static_ok and not require_exhausted)
    assert receipt.proof is not None
    assert receipt.proof.dry_runs["bronze"].result["deleted_object_counts"] == {
        "realtime": 1,
        "static": 0,
    }
    assert (root / TU_OLD_C[5]).exists()
    assert (
        conn.execute(
            text("SELECT count(*) FROM raw.ingestion_objects WHERE provider_id=:p"),
            {"p": PROVIDER},
        ).scalar_one()
        == 3
    )
    payload = receipt.display_dict()
    assert payload["is_complete"] is receipt.is_complete
    assert payload["proof"]["dry_runs"]["bronze"]["dry_run"] is True


def test_public_prune_preserves_failed_archive_and_never_claims_success(retention):
    from transit_ops.maintenance import PruneBudget, RetentionPolicy, RetentionTier, prune

    settings, engine, root = retention
    failed_path = root / TU_OLD_A[5]
    failed_path.unlink()
    failed_path.mkdir()
    receipt = prune(
        PROVIDER,
        RetentionPolicy(settings, tiers=frozenset({RetentionTier.BRONZE}), prove=False),
        PruneBudget(max_objects=2, max_batches=2),
        engine=engine,
    )
    assert not receipt.is_complete
    assert receipt.results[RetentionTier.BRONZE].failed_object_counts == {
        "realtime": 1,
        "static": 0,
    }
    assert failed_path.is_dir()
