"""Real publication remains coherent while a later correction awaits repair."""

import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic

import pytest
from historic_convergence_fixtures import ROOT_KEY
from historic_convergence_fixtures import history as history
from sqlalchemy import event, text
from sqlalchemy.exc import DBAPIError

from transit_ops.snapshots.serialization import snapshot_sha256
from transit_ops.sql_registry import query_name


def test_correction_during_publication_preserves_dirty_state_until_repaired(
    history, record_property
):
    ready, resume = Event(), Event()
    snapshots = []
    started = monotonic()

    def pause(conn, cursor, statement, params, context, many):
        if query_name(statement) == "rollup.delay_day.status" and not ready.is_set():
            snapshots.append(conn.execute(text("SELECT pg_current_snapshot()::text")).scalar_one())
            ready.set()
            assert resume.wait(15), "publication was never released"

    event.listen(history.engine, "after_cursor_execute", pause)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(history.publish)
            try:
                assert ready.wait(15), "publication never checked its source snapshot"
                history.capture(240)
                history.project()
                corrected_at = monotonic()
                assert history.dirty()["dirty_day_count"] == 1
            finally:
                resume.set()
            result = pending.result(timeout=30)
    finally:
        event.remove(history.engine, "after_cursor_execute", pause)
    assert result.gate_report["errors"] == 0
    assert history.network_day()["delay"]["sum_delay_seconds"] == 60
    assert history.network_day()["delay_percentiles"]["p90_delay_seconds"] == 60
    old_root = history.storage.get_json(ROOT_KEY)
    old_graph = history.graph_hashes()
    old_receipts = history.receipt_hashes()
    old_state = history.state()
    assert history.dirty()["dirty_day_count"] == 1
    with pytest.raises(ValueError, match="dirty"):
        history.publish()
    assert history.storage.get_json(ROOT_KEY) == old_root
    assert history.state() == old_state

    history.repair()
    assert history.dirty()["dirty_day_count"] == 0
    repaired = history.publish()
    assert repaired.gate_report["errors"] == 0
    assert history.network_day()["delay"]["sum_delay_seconds"] == 240
    new_root = history.storage.get_json(ROOT_KEY)
    new_graph = history.graph_hashes()
    new_receipts = history.receipt_hashes()
    assert snapshot_sha256(new_root) != snapshot_sha256(old_root)
    assert new_receipts != old_receipts
    assert new_root["publish_generation_id"] == old_root["publish_generation_id"]
    assert len(snapshots) == 1
    assert started < corrected_at < monotonic()
    record_property(
        "convergence",
        json.dumps(
            {
                "snapshot": snapshots[0],
                "old_graph": old_graph,
                "new_graph": new_graph,
                "old_receipts": old_receipts,
                "new_receipts": new_receipts,
                "elapsed_seconds": monotonic() - started,
                "correction_to_republished_seconds": monotonic() - corrected_at,
            }
        ),
    )


@pytest.mark.parametrize("failure_stage", ["state", "commit"])
@pytest.mark.parametrize("dirty_retry", [False, True])
def test_activated_root_survives_database_failure_and_retry_reconciles(
    history, failure_stage, dirty_retry, record_property
):
    history.publish()
    baseline_root = history.storage.get_json(ROOT_KEY)
    history.capture(240)
    history.project()
    history.repair()
    before_failure = history.state()
    failures = []

    def inject(conn, cursor, statement, params, context, many):
        if query_name(statement) != "publish.state.upsert":
            return
        failures.append(failure_stage)
        if failure_stage == "state":
            conn.exec_driver_sql("SELECT 1 / 0")
        else:
            conn.exec_driver_sql("""
                CREATE TEMP TABLE historic_convergence_commit_parent (
                    identity integer PRIMARY KEY
                ) ON COMMIT DROP
            """)
            conn.exec_driver_sql("""
                CREATE TEMP TABLE historic_convergence_commit_failure (
                    identity integer REFERENCES historic_convergence_commit_parent(identity)
                    DEFERRABLE INITIALLY DEFERRED
                ) ON COMMIT DROP
            """)
            conn.exec_driver_sql("""
                INSERT INTO historic_convergence_commit_failure VALUES (1)
            """)

    hook = "before_cursor_execute" if failure_stage == "state" else "after_cursor_execute"
    event.listen(history.engine, hook, inject)
    try:
        with pytest.raises(DBAPIError) as error:
            history.publish()
    finally:
        event.remove(history.engine, hook, inject)
    assert error.value.orig.sqlstate == ("22012" if failure_stage == "state" else "23503")
    assert failures == [failure_stage]
    assert history.state() == before_failure
    assert history.network_day()["delay"]["sum_delay_seconds"] == 240
    activated_root = history.storage.get_json(ROOT_KEY)
    activated_graph = history.graph_hashes()
    assert activated_root != baseline_root

    if dirty_retry:
        history.capture(420)
        history.project()
        assert history.dirty()["dirty_day_count"] == 1
        blocked_state = history.state()
        with pytest.raises(ValueError, match="dirty"):
            history.publish()
        assert history.state() == blocked_state
        assert history.graph_hashes() == activated_graph
        history.repair()

    result = history.publish()
    assert result.gate_report["errors"] == 0
    assert history.dirty()["dirty_day_count"] == 0
    assert history.network_day()["delay"]["sum_delay_seconds"] == (420 if dirty_retry else 240)
    reconciled_graph = history.graph_hashes()
    assert history.receipt_hashes()
    if not dirty_retry:
        assert reconciled_graph == activated_graph
    assert (
        history.state()["core.snapshot_publish_state"]
        != before_failure["core.snapshot_publish_state"]
    )
    record_property(
        "recovery",
        json.dumps(
            {
                "failure_stage": failure_stage,
                "dirty_retry": dirty_retry,
                "sqlstate": error.value.orig.sqlstate,
                "activated_graph": activated_graph,
                "reconciled_graph": reconciled_graph,
            }
        ),
    )
