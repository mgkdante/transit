from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
import real_db_seed as db_seed
from sqlalchemy import text

from transit_ops.maintenance.gold import (
    prune_gold_fact_history,
)

PROVIDER = "stm_goldfactprune_test"
ENDPOINT_ID = 992014
RUN_ID = 992101
OLD = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
NOW = datetime.now(UTC)


@pytest.fixture()
def conn(real_db_engine, seed_provider):  # noqa: ANN001, ANN201
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        _seed(connection, seed_provider)
        try:
            yield connection
        finally:
            transaction.rollback()


def _seed(connection, seed_provider) -> None:  # noqa: ANN001
    seed_provider(connection, PROVIDER, display_name="STM gold-fact prune regression")
    db_seed.feed_endpoints(connection, {"e": ENDPOINT_ID, "p": PROVIDER})
    db_seed.ingestion_runs(connection, {"r": RUN_ID, "p": PROVIDER, "e": ENDPOINT_ID})


def _insert_fact_rows(
    connection,
    *,
    snapshot_id: int,
    count: int,
    captured_at,
    table: str = "fact_trip_delay_snapshot",
) -> None:
    run_id = snapshot_id + 1_000_000
    db_seed.ingestion_runs(
        connection,
        {"r": run_id, "p": PROVIDER, "e": ENDPOINT_ID},
        ingestion_run_id="CAST(:r AS bigint)",
        feed_endpoint_id="CAST(:e AS bigint)",
    )
    db_seed.realtime_snapshot_index(
        connection,
        {"sid": snapshot_id, "r": run_id, "p": PROVIDER, "e": ENDPOINT_ID, "ts": captured_at},
        realtime_snapshot_id="CAST(:sid AS bigint)",
        ingestion_run_id="CAST(:r AS bigint)",
        feed_endpoint_id="CAST(:e AS bigint)",
        feed_timestamp_utc="CAST(:ts AS timestamptz)",
        entity_count=None,
        captured_at_utc=None,
    )
    extra_column = ", stop_time_update_count" if table == "fact_trip_delay_snapshot" else ""
    extra_value = ", 1" if table == "fact_trip_delay_snapshot" else ""
    connection.execute(
        text(
            f"""
            INSERT INTO gold.{table}
                (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                 snapshot_local_date, feed_timestamp_utc, captured_at_utc{extra_column})
            SELECT
                :p,
                CAST(:sid AS bigint),
                gs.i,
                20260101,
                DATE '2026-01-01',
                CAST(:ts AS timestamptz),
                CAST(:ts AS timestamptz){extra_value}
            FROM generate_series(0, CAST(:n AS integer) - 1) AS gs(i)
            """
        ),
        {"p": PROVIDER, "sid": snapshot_id, "ts": captured_at, "n": count},
    )


def _fact_count(connection, table="fact_trip_delay_snapshot") -> int:
    return int(
        connection.execute(
            text(
                f"""
                SELECT COUNT(*) FROM gold.{table}
                WHERE provider_id = :p
                """
            ),
            {"p": PROVIDER},
        ).scalar_one()
    )


@pytest.mark.parametrize("table", ["fact_trip_delay_snapshot", "fact_vehicle_snapshot"])
@pytest.mark.parametrize("batch", [0, 1, 2])
def test_gold_budget_floor_and_strict_cutoff_apply_to_both_fact_tables(conn, table, batch):
    cutoff = NOW - timedelta(days=14)
    _insert_fact_rows(
        conn,
        snapshot_id=992001,
        count=3,
        captured_at=cutoff - timedelta(microseconds=1),
        table=table,
    )
    _insert_fact_rows(conn, snapshot_id=992002, count=2, captured_at=cutoff, table=table)
    _, counts = prune_gold_fact_history(
        conn,
        provider_id=PROVIDER,
        retention_days=14,
        batch_size=batch,
        now_utc=NOW,
    )
    assert counts[f"gold.{table}"] == max(batch, 1)
    assert _fact_count(conn, table) == 5 - max(batch, 1)


def test_gold_fact_prune_caps_deletes_at_batch_per_cycle(conn) -> None:
    _insert_fact_rows(conn, snapshot_id=992001, count=25, captured_at=OLD)
    assert _fact_count(conn) == 25

    _cutoff, counts = prune_gold_fact_history(
        conn,
        provider_id=PROVIDER,
        retention_days=14,
        batch_size=10,
        now_utc=NOW,
    )

    assert counts["gold.fact_trip_delay_snapshot"] == 10
    assert _fact_count(conn) == 15


def test_gold_fact_prune_drains_backlog_over_multiple_cycles(conn) -> None:
    _insert_fact_rows(conn, snapshot_id=992001, count=25, captured_at=OLD)

    total_deleted = 0
    for _ in range(10):
        _cutoff, counts = prune_gold_fact_history(
            conn,
            provider_id=PROVIDER,
            retention_days=14,
            batch_size=10,
            now_utc=NOW,
        )
        total_deleted += counts["gold.fact_trip_delay_snapshot"]
        if _fact_count(conn) == 0:
            break

    assert total_deleted == 25
    assert _fact_count(conn) == 0


def test_gold_fact_prune_keeps_rows_inside_retention_window(conn) -> None:
    _insert_fact_rows(conn, snapshot_id=992001, count=5, captured_at=OLD)
    recent = NOW - timedelta(days=1)
    _insert_fact_rows(conn, snapshot_id=992002, count=5, captured_at=recent)
    assert _fact_count(conn) == 10

    _cutoff, counts = prune_gold_fact_history(
        conn,
        provider_id=PROVIDER,
        retention_days=14,
        batch_size=10000,
        now_utc=NOW,
    )

    assert counts["gold.fact_trip_delay_snapshot"] == 5
    assert _fact_count(conn) == 5


def test_gold_fact_prune_dry_run_reports_full_backlog_unbounded(conn) -> None:
    _insert_fact_rows(conn, snapshot_id=992001, count=25, captured_at=OLD)

    _cutoff, counts = prune_gold_fact_history(
        conn,
        provider_id=PROVIDER,
        retention_days=14,
        batch_size=10,
        dry_run=True,
        now_utc=NOW,
    )

    assert counts["gold.fact_trip_delay_snapshot"] == 25
    assert _fact_count(conn) == 25
