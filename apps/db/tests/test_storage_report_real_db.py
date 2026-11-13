import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import DBAPIError

from transit_ops import cli
from transit_ops.maintenance.storage_report import build_storage_report


def _seed_runs(conn, seed_provider):
    seed_provider(conn, "storage-test", display_name="Storage test")
    endpoints = [
        conn.execute(
            text("""
        INSERT INTO core.feed_endpoints
            (provider_id, endpoint_key, feed_kind, source_format)
        VALUES ('storage-test', :key, 'static_schedule', 'gtfs_schedule_zip')
        RETURNING feed_endpoint_id
    """),
            {"key": key},
        ).scalar_one()
        for key in ("a", "b", "empty")
    ]
    hour = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    runs = []
    for endpoint, kind, status, minute in (
        (endpoints[0], "static_schedule", "succeeded", 1),
        (endpoints[0], "static_schedule", "failed", 2),
        (endpoints[1], "static_schedule", "succeeded", 3),
        (endpoints[1], "silver_load", "succeeded", 4),
    ):
        runs.append(
            conn.execute(
                text("""
            INSERT INTO raw.ingestion_runs (provider_id, feed_endpoint_id, run_kind,
                status, started_at_utc, completed_at_utc)
            VALUES ('storage-test', :e, :kind, :status, :start, :end)
            RETURNING ingestion_run_id
        """),
                {
                    "e": endpoint,
                    "kind": kind,
                    "status": status,
                    "start": hour + timedelta(minutes=minute),
                    "end": hour + timedelta(minutes=minute, seconds=2.1234),
                },
            ).scalar_one()
        )
    return endpoints, hour, runs


def _seed_editions(conn, endpoint, runs):
    editions = []
    for index, run in enumerate(runs[:2]):
        version = conn.execute(
            text("""
            INSERT INTO core.dataset_versions (provider_id, feed_endpoint_id,
                source_ingestion_run_id, content_hash, is_current)
            VALUES ('storage-test', :e, :run, :hash, false) RETURNING dataset_version_id
        """),
            {"e": endpoint, "run": run, "hash": str(index)},
        ).scalar_one()
        editions.append(version)
        conn.execute(
            text("""
            INSERT INTO silver.routes (provider_id, dataset_version_id, route_id, route_type)
            VALUES ('storage-test', :v, 'route', 3)
        """),
            {"v": version},
        )
        conn.execute(
            text("""
            INSERT INTO silver.trips
                (provider_id, dataset_version_id, trip_id, route_id, service_id)
            SELECT 'storage-test', :v, i::text, 'route', 'service'
            FROM generate_series(1, :n) i
        """),
            {"v": version, "n": index + 1},
        )
    return editions


def test_report_lists_editions_dead_rows_index_use_and_raw_sizes(real_db_engine, seed_provider):
    with real_db_engine.connect() as conn, conn.begin() as transaction:
        endpoints, hour, runs = _seed_runs(conn, seed_provider)
        editions = _seed_editions(conn, endpoints[0], runs)
        report = build_storage_report(conn, limit=15, editions=True)
        assert [r for r in report["static_editions"] if r["provider_id"] == "storage-test"] == [
            {
                "table_name": "trips",
                "provider_id": "storage-test",
                "dataset_version_id": v,
                "count": n,
            }
            for n, v in enumerate(editions, 1)
        ]
        polls = [r for r in report["polls_by_feed_hour"] if r["provider_id"] == "storage-test"]
        assert [(r["attempted"], r["stored"]) for r in polls] == [(2, 1), (1, 1)]
        assert all(r["mean_capture_seconds"] == 2.123 for r in polls)
        assert all(r["hour"] == hour.isoformat() for r in polls)
        feeds = [r for r in report["feeds"] if r["provider_id"] == "storage-test"]
        for feed, first, last, count in zip(
            feeds, (1, 3, None), (2, 3, None), (2, 1, 0), strict=True
        ):
            assert feed["attempts"] == count
            for key, minute in (("first_attempt", first), ("last_attempt", last)):
                assert feed[key] == (
                    (hour + timedelta(minutes=minute)).isoformat() if minute else None
                )
        raw = next(r for r in report["raw_tables"] if r["relname"] == "ingestion_runs")
        assert all(isinstance(raw[k], int) for k in ("heap", "indexes", "toast", "rows_estimate"))
        assert report["secondary_indexes"]
        for index in report["secondary_indexes"]:
            assert index["indexrelname"]
            assert isinstance(index["bytes"], int) and isinstance(index["idx_scan"], int)
        assert any(
            r["schemaname"] == "raw" and r["relname"] == "ingestion_runs"
            for r in report["table_health"]
        )
        json.dumps(report)
        transaction.rollback()


def test_edition_counts_run_only_when_asked(real_db_engine):
    statements = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement.lower())

    with real_db_engine.connect() as conn, conn.begin() as transaction:
        event.listen(conn, "before_cursor_execute", record)
        try:
            assert "static_editions" not in build_storage_report(conn, limit=2)
        finally:
            event.remove(conn, "before_cursor_execute", record)
        assert not any(
            f"from silver.{table}" in sql
            for table in ("trips", "shapes", "stop_times")
            for sql in statements
        )
        transaction.rollback()


def test_report_runs_in_a_read_only_transaction(real_db_engine, monkeypatch):
    from transit_ops.maintenance import storage_report

    def refuse_write(connection, **kwargs):
        assert connection.execute(text("SHOW transaction_read_only")).scalar_one() == "on"
        assert connection.execute(text("SHOW statement_timeout")).scalar_one() == "7s"
        with pytest.raises(DBAPIError) as error:
            connection.execute(text("DELETE FROM core.providers WHERE false"))
        assert error.value.orig.sqlstate == "25006"
        connection.rollback()
        return {}

    monkeypatch.setattr(cli, "make_engine", lambda settings: real_db_engine)
    monkeypatch.setattr(storage_report, "build_storage_report", refuse_write)
    cli.db_storage_report_command(limit=2, editions=False, statement_timeout_seconds=7)
