"""Historic publication must not mix repaired daily values with stale exact means."""

import json
from datetime import UTC, datetime, timedelta

import pytest
from historic_convergence_fixtures import PROVIDER
from historic_convergence_fixtures import history as history
from sqlalchemy import text

from transit_ops.gold import delay_days, delay_periods, rollups


def daily_repair(history):
    return rollups.rebuild_warm_rollups(
        PROVIDER,
        engine=history.engine,
        settings=history.settings,
        from_date=history.day,
        to_date=history.day,
        kinds=list(delay_days.DAILY_DELAY_TABLES),
    )


def source_state(history):
    with history.engine.connect() as conn:
        scalar = (
            conn.execute(
                text("""
                SELECT
                    (SELECT sum(delay_seconds) FROM gold.fact_trip_delay_snapshot
                     WHERE provider_id=:p) AS fact_sum_seconds,
                    (SELECT sum(sum_delay_seconds) FROM gold.route_delay_spine
                     WHERE provider_id=:p AND provider_local_date=:day) AS spine_sum_seconds,
                    (SELECT sum(usable_delay_sum_seconds) FROM gold.trip_delay_summary_5m
                     WHERE provider_id=:p) AS five_minute_sum_seconds,
                    (SELECT sum(usable_delay_sum_seconds) FROM gold.route_delay_hourly
                     WHERE provider_id=:p) AS hourly_sum_seconds,
                    (SELECT avg_delay_seconds FROM gold.public_route_reliability_daily
                     WHERE provider_id=:p AND route_id='51' AND provider_local_date=:day)
                     AS daily_mean_seconds,
                    (SELECT count(*) FROM gold.warm_rollup_periods
                     WHERE provider_id=:p AND rollup_kind='trip_delay_summary_5m'
                       AND invalidated_at_utc IS NOT NULL) AS dirty_five_minute_periods
            """),
                {"p": PROVIDER, "day": history.day},
            )
            .mappings()
            .one()
        )
        states = {
            table: conn.execute(
                text(
                    f"SELECT to_jsonb(t) FROM gold.{table} AS t WHERE provider_id=:p "
                    "ORDER BY to_jsonb(t)::text"
                ),
                {"p": PROVIDER},
            )
            .scalars()
            .all()
            for table in ("warm_rollup_periods", "trip_delay_summary_5m", "route_delay_hourly")
        }
    return {"values": dict(scalar), "rows": states}


def published_values(history):
    route = history.storage.get_json("historic/route_reliability/51.json")
    period = next(
        row
        for row in route["periods"]
        if row["grain"] == "day" and row["date"] == history.day.isoformat()
    )
    receipt = history.storage.get_json(f"historic/receipts/{history.day.isoformat()}.json")
    day = history.network_day()
    return {
        "network_sum_seconds": day["delay"]["sum_delay_seconds"],
        "network_p90_seconds": day["delay_percentiles"]["p90_delay_seconds"],
        "route_daily_mean_minutes": period["avg_delay_min"],
        "route_daily_p90_minutes": period["p90_min"],
        "receipt_network_mean_minutes": receipt["avg_delay_min"],
        "receipt_worst_route": receipt["worst_route"],
    }


@pytest.mark.parametrize("stage", ["daily_repaired", "five_minute_rebuilt"])
def test_intermediate_repair_never_publishes_stale_finite_mean(history, stage, record_property):
    history.publish()
    baseline = published_values(history)
    assert baseline["route_daily_mean_minutes"] == 1.0

    history.capture(240)
    history.project()
    daily_repair(history)
    assert history.dirty()["dirty_day_count"] == 0

    if stage == "five_minute_rebuilt":
        period = delay_periods.period_start(history.captured)
        assert (
            delay_periods.build_delay_periods(
                history.engine,
                provider_id=PROVIDER,
                since_utc=period,
                until_utc=period + timedelta(minutes=5),
                now=datetime.now(UTC),
                progress=delay_periods.PeriodBuildProgress(),
                retention_days=history.settings.GOLD_FACT_RETENTION_DAYS,
            )
            == 1
        )

    intermediate_source = source_state(history)
    values = intermediate_source["values"]
    assert values["fact_sum_seconds"] == values["spine_sum_seconds"] == 240
    assert values["five_minute_sum_seconds"] == (60 if stage == "daily_repaired" else 240)
    assert values["hourly_sum_seconds"] == values["daily_mean_seconds"] == 60
    assert values["dirty_five_minute_periods"] == (1 if stage == "daily_repaired" else 0)

    prior_graph, prior_state = history.graph_hashes(), history.state()
    try:
        result = history.publish()
    except ValueError as error:
        intermediate_publication = {"refused": str(error)}
        assert history.graph_hashes() == prior_graph
        assert history.state() == prior_state
        safe = True
    else:
        assert result.gate_report["errors"] == 0
        intermediate_publication = published_values(history)
        assert intermediate_publication["network_sum_seconds"] == 240
        assert intermediate_publication["route_daily_p90_minutes"] == 4.0
        safe = intermediate_publication["route_daily_mean_minutes"] in (None, 4.0)

    rollups.build_warm_rollups(PROVIDER, engine=history.engine, settings=history.settings)
    completed = history.publish()
    assert completed.gate_report["errors"] == 0
    final_publication = published_values(history)
    assert final_publication["network_sum_seconds"] == 240
    assert final_publication["route_daily_mean_minutes"] == 4.0
    assert final_publication["route_daily_p90_minutes"] == 4.0
    assert final_publication["receipt_network_mean_minutes"] == 4.0
    record_property(
        "mean_stage_consistency",
        json.dumps(
            {
                "stage": stage,
                "baseline": baseline,
                "intermediate_source": intermediate_source,
                "intermediate_publication": intermediate_publication,
                "completed_source": source_state(history),
                "completed_publication": final_publication,
            },
            default=str,
        ),
    )
    assert safe, (
        f"New daily values were published beside an old finite mean: {intermediate_publication}"
    )


def assert_ready(history):
    from transit_ops.gold.delay_hours import assert_historic_delay_means_current

    with history.engine.connect() as conn:
        assert_historic_delay_means_current(conn, PROVIDER)


@pytest.mark.parametrize(
    "force,gate_enabled", [(False, False), (False, True), (True, False), (True, True)]
)
def test_mean_readiness_is_mandatory_before_storage(history, force, gate_enabled):
    from transit_ops.snapshots.publish import publish_snapshot

    history.publish()
    history.capture(240)
    history.project()
    daily_repair(history)
    graph, state = history.graph_hashes(), history.state()
    with pytest.raises(ValueError, match="five-minute/hourly reporting refresh"):
        publish_snapshot(
            PROVIDER,
            tier="historic",
            engine=history.engine,
            storage=history.storage,
            settings=history.settings,
            force=force,
            gate_enabled=gate_enabled,
        )
    assert history.graph_hashes() == graph
    assert history.state() == state


def test_missing_hour_with_nonempty_children_requires_refresh(history):
    from transit_ops.gold.delay_hours import refresh_changed_delay_hours

    with history.engine.begin() as conn:
        conn.execute(
            text("DELETE FROM gold.route_delay_hourly WHERE provider_id=:p"), {"p": PROVIDER}
        )
    with pytest.raises(ValueError, match="reporting refresh"):
        assert_ready(history)
    assert (
        refresh_changed_delay_hours(
            history.engine, PROVIDER, history.captured, history.captured + timedelta(hours=1)
        )
        == 1
    )
    assert_ready(history)


@pytest.mark.parametrize("dirty", [False, True])
def test_empty_history_day_keeps_readiness_scope_without_requiring_an_empty_hour(history, dirty):
    with history.engine.begin() as conn:
        for table in ("route_delay_spine", "trip_delay_summary_5m", "route_delay_hourly"):
            conn.execute(text(f"DELETE FROM gold.{table} WHERE provider_id=:p"), {"p": PROVIDER})
        if dirty:
            conn.execute(
                text("""
                UPDATE gold.warm_rollup_periods SET invalidated_at_utc=clock_timestamp()
                WHERE provider_id=:p AND rollup_kind='trip_delay_summary_5m'
            """),
                {"p": PROVIDER},
            )
    if dirty:
        with pytest.raises(ValueError, match="reporting refresh"):
            assert_ready(history)
    else:
        assert_ready(history)


def test_unrepresented_current_day_does_not_block_retained_history(history):
    with history.engine.begin() as conn:
        conn.execute(
            text("""
            INSERT INTO gold.warm_rollup_periods
                (provider_id,rollup_kind,period_start_utc,built_at_utc,invalidated_at_utc)
            VALUES (:p,'trip_delay_summary_5m',date_trunc('hour',clock_timestamp()),
                    clock_timestamp(),clock_timestamp())
        """),
            {"p": PROVIDER},
        )
    assert_ready(history)
    assert history.publish().gate_report["errors"] == 0


def test_other_provider_pending_period_does_not_block_history(history, seed_provider):
    from transit_ops.gold.delay_hours import assert_historic_delay_means_current

    with history.engine.connect() as conn, conn.begin() as transaction:
        other = "historic_mean_other"
        seed_provider(conn, other, display_name="Other mean dependencies")
        conn.execute(
            text("""
            INSERT INTO gold.warm_rollup_periods
                (provider_id,rollup_kind,period_start_utc,built_at_utc,invalidated_at_utc)
            VALUES (:p,'trip_delay_summary_5m',:captured,clock_timestamp(),clock_timestamp()),
                   (:p,'route_delay_spine',:day,clock_timestamp(),NULL)
        """),
            {
                "p": other,
                "captured": history.captured,
                "day": datetime.combine(history.day, datetime.min.time(), UTC),
            },
        )
        with pytest.raises(ValueError, match="reporting refresh"):
            assert_historic_delay_means_current(conn, other)
        assert_historic_delay_means_current(conn, PROVIDER)
        transaction.rollback()


def test_rolled_back_invalidation_does_not_leave_pending_mean_state(history):
    from transit_ops.gold.delay_hours import assert_historic_delay_means_current

    with history.engine.connect() as conn, conn.begin() as transaction:
        conn.execute(
            text("""
            UPDATE gold.warm_rollup_periods SET invalidated_at_utc=clock_timestamp()
            WHERE provider_id=:p AND rollup_kind='trip_delay_summary_5m'
        """),
            {"p": PROVIDER},
        )
        with pytest.raises(ValueError, match="reporting refresh"):
            assert_historic_delay_means_current(conn, PROVIDER)
        transaction.rollback()
    assert_ready(history)


def test_pruned_child_markers_do_not_invent_a_pending_dependency(history):
    with history.engine.begin() as conn:
        conn.execute(
            text("""
            DELETE FROM gold.warm_rollup_periods
            WHERE provider_id=:p AND rollup_kind='trip_delay_summary_5m'
        """),
            {"p": PROVIDER},
        )
    assert_ready(history)
