from __future__ import annotations

import hashlib
import os
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import create_engine, text

from transit_ops.settings import get_settings
from transit_ops.snapshots.builders import (
    STOP_HISTORY_METRICS,
    build_network_trend,
    build_route_reliability,
    build_stop_reliability,
)
from transit_ops.snapshots.builders.historic.line_history import build_line_history
from transit_ops.snapshots.builders.historic.network_history import build_network_history
from transit_ops.snapshots.builders.historic.stop_history import build_stop_history
from transit_ops.snapshots.contract import (
    ROUTE_RELIABILITY_BYTE_CEILING,
    NetworkTrend,
    OccupancyMix,
    TrendPoint,
)
from transit_ops.snapshots.publish import _entity_family_availability
from transit_ops.snapshots.serialization import snapshot_json_bytes

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set - partitioned history real-DB tests skipped",
)

PROVIDER = "stm_network_history_test"
OTHER_PROVIDER = "stm_network_history_other_test"
COMPAT_PROVIDER = "stm_network_history_compat_test"
LINE_PROVIDER = "stm_line_history_test"
LINE_OTHER_PROVIDER = "stm_line_history_other_test"
STOP_PROVIDER = "stm_stop_history_test"
STOP_OTHER_PROVIDER = "stm_stop_history_other_test"
TRIP_ENDPOINT_ID = 9_987_100
OTHER_TRIP_ENDPOINT_ID = 9_987_101
BASE_RUN_ID = 9_987_200
BASE_SNAPSHOT_ID = 9_987_300


def _insert_fact_snapshot(
    conn,  # noqa: ANN001
    *,
    provider_id: str,
    endpoint_id: int,
    captured_at: datetime,
    snapshot_id: int,
    rows: list[tuple[int, str | None]],
) -> None:
    run_id = BASE_RUN_ID + snapshot_id - BASE_SNAPSHOT_ID
    local_date = captured_at.date()
    conn.execute(
        text(
            "INSERT INTO raw.ingestion_runs "
            "(ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status) "
            "VALUES (:run_id, :provider_id, :endpoint_id, 'trip_updates', 'succeeded')"
        ),
        {
            "run_id": run_id,
            "provider_id": provider_id,
            "endpoint_id": endpoint_id,
        },
    )
    conn.execute(
        text(
            "INSERT INTO raw.realtime_snapshot_index "
            "(realtime_snapshot_id, ingestion_run_id, provider_id, feed_endpoint_id, "
            "feed_timestamp_utc, entity_count, captured_at_utc) "
            "VALUES (:snapshot_id, :run_id, :provider_id, :endpoint_id, "
            ":captured_at, :entity_count, :captured_at)"
        ),
        {
            "snapshot_id": snapshot_id,
            "run_id": run_id,
            "provider_id": provider_id,
            "endpoint_id": endpoint_id,
            "captured_at": captured_at,
            "entity_count": len(rows),
        },
    )
    for entity_index, (delay_seconds, vehicle_id) in enumerate(rows):
        conn.execute(
            text(
                "INSERT INTO gold.fact_trip_delay_snapshot "
                "(provider_id, realtime_snapshot_id, entity_index, snapshot_date_key, "
                "snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id, "
                "trip_id, route_id, direction_id, start_date, vehicle_id, "
                "trip_schedule_relationship, delay_seconds, stop_time_update_count) "
                "VALUES (:provider_id, :snapshot_id, :entity_index, :date_key, "
                ":local_date, :captured_at, :captured_at, :entity_id, :trip_id, 'A', 0, "
                ":local_date, :vehicle_id, 0, :delay_seconds, 0)"
            ),
            {
                "provider_id": provider_id,
                "snapshot_id": snapshot_id,
                "entity_index": entity_index,
                "date_key": int(local_date.strftime("%Y%m%d")),
                "local_date": local_date,
                "captured_at": captured_at,
                "entity_id": f"{provider_id}-{snapshot_id}-{entity_index}",
                "trip_id": f"trip-{snapshot_id}-{entity_index}",
                "vehicle_id": vehicle_id,
                "delay_seconds": delay_seconds,
            },
        )


@pytest.fixture()
def network_history_conn():
    engine = create_engine(DB_URL)
    with engine.connect() as conn:
        tx = conn.begin()
        for provider_id, timezone in (
            (PROVIDER, "America/Toronto"),
            (OTHER_PROVIDER, "America/Vancouver"),
            (COMPAT_PROVIDER, "America/Toronto"),
        ):
            conn.execute(
                text(
                    "INSERT INTO core.providers "
                    "(provider_id, display_name, timezone, provider_key) "
                    "VALUES (:provider_id, 'Network history regression', :timezone, "
                    ":provider_id)"
                ),
                {"provider_id": provider_id, "timezone": timezone},
            )
        for endpoint_id, provider_id in (
            (TRIP_ENDPOINT_ID, PROVIDER),
            (OTHER_TRIP_ENDPOINT_ID, OTHER_PROVIDER),
        ):
            conn.execute(
                text(
                    "INSERT INTO core.feed_endpoints "
                    "(feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format) "
                    "VALUES (:endpoint_id, :provider_id, 'trip_updates', 'trip_updates', "
                    "'gtfs_rt_trip_updates')"
                ),
                {"endpoint_id": endpoint_id, "provider_id": provider_id},
            )
        for local_date, route, obs, on_time, severe, delay_sum, built in (
            (date(2026, 5, 31), "A", 4, 3, 1, 120, datetime(2026, 6, 1, tzinfo=UTC)),
            (date(2026, 6, 1), "A", 5, 4, 0, 150, datetime(2026, 6, 2, tzinfo=UTC)),
        ):
            hist = [0] * 21
            hist[10] = obs
            conn.execute(
                text(
                    "INSERT INTO gold.route_delay_spine "
                    "(provider_id, route_id, provider_local_date, hour_of_day_local, direction_id, "
                    "observation_count, delay_observation_count, on_time_observation_count, "
                    "severe_delay_count, sum_delay_seconds, delay_histogram, built_at_utc) "
                    "VALUES (:p, :r, :d, 12, 0, :obs, :obs, :on_time, :severe, :delay_sum, "
                    "CAST(:hist AS smallint[]), :built)"
                ),
                {
                    "p": PROVIDER,
                    "r": route,
                    "d": local_date,
                    "obs": obs,
                    "on_time": on_time,
                    "severe": severe,
                    "delay_sum": delay_sum,
                    "hist": hist,
                    "built": built,
                },
            )
            conn.execute(
                text(
                    "INSERT INTO gold.route_cancellation_daily "
                    "(provider_id, provider_local_date, route_id, total_trip_days, "
                    "canceled_trip_days, cancellation_rate_pct, scheduled_trip_days, "
                    "delivered_trip_days, silent_trip_days, built_at_utc) "
                    "VALUES (:p, :d, :r, 10, 1, 10, 12, 9, 2, :built)"
                ),
                {"p": PROVIDER, "d": local_date, "r": route, "built": built},
            )
            conn.execute(
                text(
                    "INSERT INTO gold.route_occupancy_band_daily "
                    "(provider_id, provider_local_date, route_id, observation_count, empty_count, "
                    "many_seats_count, few_seats_count, standing_count, full_count, built_at_utc) "
                    "VALUES (:p, :d, :r, 3, 1, 1, 1, 0, 0, :built)"
                ),
                {"p": PROVIDER, "d": local_date, "r": route, "built": built},
            )
        foreign_hist = [0] * 21
        foreign_hist[10] = 100
        conn.execute(
            text(
                "INSERT INTO gold.route_delay_spine "
                "(provider_id, route_id, provider_local_date, hour_of_day_local, direction_id, "
                "observation_count, delay_observation_count, on_time_observation_count, "
                "severe_delay_count, sum_delay_seconds, delay_histogram, built_at_utc) "
                "VALUES (:p, 'FOREIGN', '2026-06-01', 12, 0, 100, 100, 100, 0, 9999, "
                "CAST(:hist AS smallint[]), '2026-06-03T00:00:00Z')"
            ),
            {"p": OTHER_PROVIDER, "hist": foreign_hist},
        )
        conn.execute(
            text(
                "INSERT INTO gold.route_cancellation_daily "
                "(provider_id, provider_local_date, route_id, total_trip_days, "
                "canceled_trip_days, cancellation_rate_pct, scheduled_trip_days, "
                "delivered_trip_days, silent_trip_days, built_at_utc) "
                "VALUES (:p, '2026-06-01', 'FOREIGN', 100, 99, 99, 100, 1, 0, "
                "'2026-06-03T00:00:00Z')"
            ),
            {"p": OTHER_PROVIDER},
        )
        conn.execute(
            text(
                "INSERT INTO gold.route_occupancy_band_daily "
                "(provider_id, provider_local_date, route_id, observation_count, empty_count, "
                "many_seats_count, few_seats_count, standing_count, full_count, built_at_utc) "
                "VALUES (:p, '2026-06-01', 'FOREIGN', 100, 0, 0, 0, 0, 100, "
                "'2026-06-03T00:00:00Z')"
            ),
            {"p": OTHER_PROVIDER},
        )
        conn.execute(
            text(
                "INSERT INTO gold.route_cancellation_daily "
                "(provider_id, provider_local_date, route_id, total_trip_days, "
                "canceled_trip_days, cancellation_rate_pct, scheduled_trip_days, "
                "delivered_trip_days, silent_trip_days, built_at_utc) "
                "VALUES (:p, '2020-01-02', 'COMPAT', 10, 1, 10, 12, 9, 2, "
                "'2020-01-03T00:00:00Z')"
            ),
            {"p": COMPAT_PROVIDER},
        )
        conn.execute(
            text(
                "INSERT INTO gold.route_occupancy_band_daily "
                "(provider_id, provider_local_date, route_id, observation_count, empty_count, "
                "many_seats_count, few_seats_count, standing_count, full_count, built_at_utc) "
                "VALUES (:p, '2020-01-02', 'COMPAT', 3, 1, 1, 1, 0, 0, "
                "'2020-01-03T00:00:00Z')"
            ),
            {"p": COMPAT_PROVIDER},
        )
        _insert_fact_snapshot(
            conn,
            provider_id=PROVIDER,
            endpoint_id=TRIP_ENDPOINT_ID,
            captured_at=datetime(2026, 6, 30, 16, tzinfo=UTC),
            snapshot_id=BASE_SNAPSHOT_ID,
            rows=[(0, "V1"), (100, "V2"), (1000, "V2")],
        )
        _insert_fact_snapshot(
            conn,
            provider_id=PROVIDER,
            endpoint_id=TRIP_ENDPOINT_ID,
            captured_at=datetime(2026, 7, 2, 16, tzinfo=UTC),
            snapshot_id=BASE_SNAPSHOT_ID + 1,
            rows=[(-100, "V3"), (200, "V4"), (500, None), (4001, "V-ghost")],
        )
        _insert_fact_snapshot(
            conn,
            provider_id=OTHER_PROVIDER,
            endpoint_id=OTHER_TRIP_ENDPOINT_ID,
            captured_at=datetime(2026, 6, 30, 16, tzinfo=UTC),
            snapshot_id=BASE_SNAPSHOT_ID + 2,
            rows=[(3600, "FOREIGN")],
        )
        try:
            yield conn
        finally:
            tx.rollback()
            engine.dispose()


def _extend_history_retention(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "GOLD_FACT_RETENTION_DAYS", 36_500)
    monkeypatch.setattr(settings, "GOLD_WARM_ROLLUP_RETENTION_DAYS", 36_500)


@pytest.fixture()
def line_history_conn():
    engine = create_engine(DB_URL)
    with engine.connect() as conn:
        tx = conn.begin()
        for provider_id in (LINE_PROVIDER, LINE_OTHER_PROVIDER):
            conn.execute(
                text(
                    "INSERT INTO core.providers "
                    "(provider_id, display_name, timezone, provider_key) "
                    "VALUES (:provider_id, 'Line history regression', 'America/Toronto', "
                    ":provider_id)"
                ),
                {"provider_id": provider_id},
            )
        for local_date, obs, on_time, severe, delay_sum, built in (
            (date(2026, 5, 31), 4, 3, 1, 120, datetime(2026, 6, 1, tzinfo=UTC)),
            (date(2026, 6, 1), 5, 4, 0, 150, datetime(2026, 6, 2, tzinfo=UTC)),
        ):
            histogram = [0] * 21
            histogram[10] = obs
            conn.execute(
                text(
                    "INSERT INTO gold.route_delay_spine "
                    "(provider_id, route_id, provider_local_date, hour_of_day_local, direction_id, "
                    "observation_count, delay_observation_count, on_time_observation_count, "
                    "severe_delay_count, sum_delay_seconds, delay_histogram, built_at_utc) "
                    "VALUES (:provider_id, 'A', :local_date, 12, 0, :obs, :obs, :on_time, "
                    ":severe, :delay_sum, CAST(:histogram AS smallint[]), :built)"
                ),
                {
                    "provider_id": LINE_PROVIDER,
                    "local_date": local_date,
                    "obs": obs,
                    "on_time": on_time,
                    "severe": severe,
                    "delay_sum": delay_sum,
                    "histogram": histogram,
                    "built": built,
                },
            )
            conn.execute(
                text(
                    "INSERT INTO gold.route_cancellation_daily "
                    "(provider_id, provider_local_date, route_id, total_trip_days, "
                    "canceled_trip_days, cancellation_rate_pct, scheduled_trip_days, "
                    "delivered_trip_days, silent_trip_days, built_at_utc) "
                    "VALUES (:provider_id, :local_date, 'A', 10, 1, 10, 12, 9, 2, :built)"
                ),
                {
                    "provider_id": LINE_PROVIDER,
                    "local_date": local_date,
                    "built": built,
                },
            )
        conn.execute(
            text(
                "INSERT INTO gold.route_delay_percentile_daily "
                "(provider_id, provider_local_date, route_id, delay_observation_count, "
                "p50_delay_seconds, p90_delay_seconds, built_at_utc) "
                "VALUES (:provider_id, '2026-05-31', 'A', 4, 30, 240, "
                "'2026-06-01T01:00:00Z')"
            ),
            {"provider_id": LINE_PROVIDER},
        )
        conn.execute(
            text(
                "INSERT INTO gold.route_service_span_daily "
                "(provider_id, provider_local_date, route_id, first_trip_start_utc, "
                "last_trip_start_utc, service_span_min, first_trip_delay_seconds, "
                "last_trip_delay_seconds, trip_count, built_at_utc) "
                "VALUES (:provider_id, '2026-06-01', 'A', '2026-06-01T09:00:00Z', "
                "'2026-06-02T03:00:00Z', 1080, 20, -10, 8, '2026-06-02T01:00:00Z')"
            ),
            {"provider_id": LINE_PROVIDER},
        )
        conn.execute(
            text(
                "INSERT INTO gold.route_occupancy_band_daily "
                "(provider_id, provider_local_date, route_id, observation_count, empty_count, "
                "many_seats_count, few_seats_count, standing_count, full_count, built_at_utc) "
                "VALUES (:provider_id, '2026-06-02', 'AUX/only', 2, 0, 0, 0, 2, 0, "
                "'2026-06-03T00:00:00Z')"
            ),
            {"provider_id": LINE_PROVIDER},
        )
        conn.execute(
            text(
                "INSERT INTO gold.route_skipped_stop_daily "
                "(provider_id, provider_local_date, route_id, stop_time_update_count, "
                "skipped_stop_count, skipped_stop_rate_pct, built_at_utc) "
                "VALUES (:provider_id, '2026-06-02', 'AUX/only', 10, 0, 0, "
                "'2026-06-03T01:00:00Z')"
            ),
            {"provider_id": LINE_PROVIDER},
        )
        conn.execute(
            text(
                "INSERT INTO gold.route_occupancy_band_daily "
                "(provider_id, provider_local_date, route_id, observation_count, empty_count, "
                "many_seats_count, few_seats_count, standing_count, full_count, built_at_utc) "
                "VALUES (:provider_id, '2026-06-02', 'AUX/only', 99, 0, 0, 0, 0, 99, "
                "'2026-06-03T00:00:00Z')"
            ),
            {"provider_id": LINE_OTHER_PROVIDER},
        )
        try:
            yield conn
        finally:
            tx.rollback()
            engine.dispose()


@pytest.fixture()
def stop_history_conn():
    engine = create_engine(DB_URL)
    with engine.connect() as conn:
        tx = conn.begin()
        for provider_id in (STOP_PROVIDER, STOP_OTHER_PROVIDER):
            conn.execute(
                text(
                    "INSERT INTO core.providers "
                    "(provider_id, display_name, timezone, provider_key) "
                    "VALUES (:provider_id, 'Stop history regression', 'America/Toronto', "
                    ":provider_id)"
                ),
                {"provider_id": provider_id},
            )
        main_stop = "A/B é雪"
        aux_stop = "aux/%雪"
        for local_date, route_id, obs, severe, delay_sum, built in (
            (
                date(2026, 5, 31),
                "A",
                4,
                0,
                120,
                datetime(2026, 6, 1, tzinfo=UTC),
            ),
            (
                date(2026, 5, 31),
                "__unrouted__",
                6,
                2,
                180,
                datetime(2026, 6, 1, 1, tzinfo=UTC),
            ),
            (
                date(2026, 6, 2),
                "B",
                5,
                0,
                -50,
                datetime(2026, 6, 3, tzinfo=UTC),
            ),
        ):
            conn.execute(
                text(
                    "INSERT INTO gold.stop_delay_spine "
                    "(provider_id, stop_id, route_id, provider_local_date, "
                    "observation_count, severe_delay_count, sum_delay_seconds, built_at_utc) "
                    "VALUES (:provider_id, :stop_id, :route_id, :local_date, :obs, :severe, "
                    ":delay_sum, :built)"
                ),
                {
                    "provider_id": STOP_PROVIDER,
                    "stop_id": main_stop,
                    "route_id": route_id,
                    "local_date": local_date,
                    "obs": obs,
                    "severe": severe,
                    "delay_sum": delay_sum,
                    "built": built,
                },
            )
        conn.execute(
            text(
                "INSERT INTO gold.stop_delay_percentile_daily "
                "(provider_id, provider_local_date, stop_id, delay_observation_count, "
                "p50_delay_seconds, p90_delay_seconds, built_at_utc) "
                "VALUES (:provider_id, '2026-05-31', :stop_id, 10, 30, 240, "
                "'2026-06-01T02:00:00Z'), "
                "(:provider_id, '2026-06-03', :aux_stop, 2, NULL, 180, "
                "'2026-06-04T00:00:00Z')"
            ),
            {
                "provider_id": STOP_PROVIDER,
                "stop_id": main_stop,
                "aux_stop": aux_stop,
            },
        )
        conn.execute(
            text(
                "INSERT INTO gold.stop_occupancy_band_daily "
                "(provider_id, provider_local_date, stop_id, observation_count, empty_count, "
                "many_seats_count, few_seats_count, standing_count, full_count, built_at_utc) "
                "VALUES (:provider_id, '2026-06-02', :stop_id, 4, 0, 1, 1, 1, 1, "
                "'2026-06-03T01:00:00Z'), "
                "(:provider_id, '2026-06-03', :aux_stop, 3, 0, 0, 0, 2, 1, "
                "'2026-06-04T01:00:00Z')"
            ),
            {
                "provider_id": STOP_PROVIDER,
                "stop_id": main_stop,
                "aux_stop": aux_stop,
            },
        )
        conn.execute(
            text(
                "INSERT INTO gold.stop_delay_spine "
                "(provider_id, stop_id, route_id, provider_local_date, observation_count, "
                "severe_delay_count, sum_delay_seconds, built_at_utc) "
                "VALUES (:provider_id, :stop_id, '__unrouted__', '2026-06-02', 99, 99, "
                "9999, '2026-06-03T00:00:00Z')"
            ),
            {"provider_id": STOP_OTHER_PROVIDER, "stop_id": main_stop},
        )
        conn.execute(
            text(
                "INSERT INTO gold.stop_occupancy_band_daily "
                "(provider_id, provider_local_date, stop_id, observation_count, empty_count, "
                "many_seats_count, few_seats_count, standing_count, full_count, built_at_utc) "
                "VALUES (:provider_id, '2026-06-03', :stop_id, 99, 0, 0, 0, 0, 99, "
                "'2026-06-04T00:00:00Z')"
            ),
            {"provider_id": STOP_OTHER_PROVIDER, "stop_id": aux_stop},
        )
        try:
            yield conn
        finally:
            tx.rollback()
            engine.dispose()


def test_network_history_real_db_matches_cross_month_sql(
    network_history_conn,
    monkeypatch: pytest.MonkeyPatch,
):
    stamp = "2026-07-13T00:00:00Z"
    _extend_history_retention(monkeypatch)
    bundle = build_network_history(
        network_history_conn,
        provider_id=PROVIDER,
        generated_utc=stamp,
    )

    direct = network_history_conn.execute(
        text(
            "SELECT SUM(delay_observation_count), SUM(on_time_observation_count), "
            "SUM(severe_delay_count), SUM(sum_delay_seconds) "
            "FROM gold.route_delay_spine WHERE provider_id = :p"
        ),
        {"p": PROVIDER},
    ).one()
    direct_inclamp = network_history_conn.execute(
        text(
            "SELECT SUM((SELECT COALESCE(SUM(x), 0) FROM unnest(delay_histogram) AS x)) "
            "FROM gold.route_delay_spine WHERE provider_id = :p"
        ),
        {"p": PROVIDER},
    ).scalar_one()
    direct_cancellation = network_history_conn.execute(
        text(
            "SELECT SUM(canceled_trip_days), SUM(total_trip_days), SUM(scheduled_trip_days), "
            "SUM(delivered_trip_days), SUM(silent_trip_days) "
            "FROM gold.route_cancellation_daily WHERE provider_id = :p"
        ),
        {"p": PROVIDER},
    ).one()
    direct_occupancy = network_history_conn.execute(
        text(
            "SELECT SUM(empty_count), SUM(many_seats_count), SUM(few_seats_count), "
            "SUM(standing_count), SUM(full_count) "
            "FROM gold.route_occupancy_band_daily WHERE provider_id = :p"
        ),
        {"p": PROVIDER},
    ).one()
    direct_facts = {
        row[0].isoformat(): (row[1], float(row[2]), row[3])
        for row in network_history_conn.execute(
            text(
                "SELECT timezone('America/Toronto', captured_at_utc)::date, COUNT(*), "
                "percentile_cont(0.9) WITHIN GROUP (ORDER BY delay_seconds), "
                "COUNT(DISTINCT vehicle_id) "
                "FROM gold.fact_trip_delay_snapshot "
                "WHERE provider_id = :p AND delay_seconds IS NOT NULL "
                "AND ABS(delay_seconds) <= 3600 "
                "GROUP BY timezone('America/Toronto', captured_at_utc)::date "
                "ORDER BY 1"
            ),
            {"p": PROVIDER},
        )
    }
    days = [day for partition in bundle.partitions for day in partition.days]
    days_by_date = {day.date: day for day in days}
    assert tuple(direct) == (9, 7, 1, 270)
    assert direct_inclamp == 9
    assert tuple(direct_cancellation) == (2, 20, 24, 18, 4)
    assert tuple(direct_occupancy) == (2, 2, 2, 0, 0)
    assert direct_facts == {
        "2026-06-30": (3, 820.0, 2),
        "2026-07-02": (3, 440.0, 2),
    }
    assert sum(day.delay.observation_count for day in days if day.delay) == direct[0]
    assert sum(day.delay.on_time_count for day in days if day.delay) == direct[1]
    assert sum(day.delay.severe_count for day in days if day.delay) == direct[2]
    assert sum(day.delay.sum_delay_seconds for day in days if day.delay) == direct[3]
    assert sum(day.delay.in_clamp_observation_count for day in days if day.delay) == direct_inclamp
    assert (
        sum(day.cancellation.canceled_trip_days for day in days if day.cancellation),
        sum(day.cancellation.total_trip_days for day in days if day.cancellation),
        sum(day.cancellation.scheduled_trip_days for day in days if day.cancellation),
        sum(day.cancellation.delivered_trip_days for day in days if day.cancellation),
        sum(day.cancellation.silent_trip_days for day in days if day.cancellation),
    ) == direct_cancellation
    assert (
        sum(day.occupancy.empty for day in days if day.occupancy),
        sum(day.occupancy.many_seats for day in days if day.occupancy),
        sum(day.occupancy.few_seats for day in days if day.occupancy),
        sum(day.occupancy.standing for day in days if day.occupancy),
        sum(day.occupancy.full for day in days if day.occupancy),
    ) == direct_occupancy
    for local_date, (observation_count, p90_delay_seconds, vehicles) in direct_facts.items():
        day = days_by_date[local_date]
        assert day.delay_percentiles is not None
        assert day.delay_percentiles.observation_count == observation_count
        assert day.delay_percentiles.p90_delay_seconds == p90_delay_seconds
        assert day.vehicles == vehicles
    assert [partition.month for partition in bundle.partitions] == [
        "2026-05",
        "2026-06",
        "2026-07",
    ]
    assert [partition.generated_utc for partition in bundle.partitions] == [
        "2026-06-01T00:00:00Z",
        "2026-06-30T16:00:00Z",
        "2026-07-02T16:00:00Z",
    ]


def test_network_history_real_db_preserves_fixed_compatibility_bytes(
    network_history_conn,
    monkeypatch: pytest.MonkeyPatch,
):
    stamp = "2026-07-13T00:00:00Z"
    one_third = 1 / 3
    mix = OccupancyMix(empty=one_third, many_seats=one_third, few_seats=one_third)
    expected = NetworkTrend(
        generated_utc=stamp,
        series=[
            TrendPoint(
                date="2020-01-02",
                cancellation_rate=10.0,
                service_completeness_rate=75.0,
                occupancy_mix=mix,
            )
        ],
        weekly=[
            TrendPoint(
                date="2019-12-30",
                cancellation_rate=10.0,
                service_completeness_rate=75.0,
                occupancy_mix=mix,
            )
        ],
        monthly=[
            TrendPoint(
                date="2020-01-01",
                cancellation_rate=10.0,
                service_completeness_rate=75.0,
                occupancy_mix=mix,
            )
        ],
    )
    expected_bytes = snapshot_json_bytes(expected)
    assert hashlib.sha256(expected_bytes).hexdigest() == (
        "d8b7045b9bf5ce9e210cbfd4a6d14da7391e90bbbdfcc1c95a234099f8a1571c"
    )

    _extend_history_retention(monkeypatch)
    before = snapshot_json_bytes(
        build_network_trend(
            network_history_conn,
            provider_id=COMPAT_PROVIDER,
            generated_utc=stamp,
        )
    )
    assert before == expected_bytes

    bundle = build_network_history(
        network_history_conn,
        provider_id=COMPAT_PROVIDER,
        generated_utc=stamp,
    )
    assert [partition.month for partition in bundle.partitions] == ["2020-01"]

    after = snapshot_json_bytes(
        build_network_trend(
            network_history_conn,
            provider_id=COMPAT_PROVIDER,
            generated_utc=stamp,
        )
    )
    assert after == expected_bytes


def test_line_history_real_db_matches_cross_month_sql_and_sparse_auxiliary_entities(
    line_history_conn,
    monkeypatch: pytest.MonkeyPatch,
):
    _extend_history_retention(monkeypatch)
    stamp = "2026-07-13T00:00:00Z"
    compatibility_before = snapshot_json_bytes(
        build_route_reliability(
            line_history_conn,
            provider_id=LINE_PROVIDER,
            route_id="A",
            generated_utc=stamp,
        )
    )
    assert len(compatibility_before) <= ROUTE_RELIABILITY_BYTE_CEILING
    bundle = build_line_history(
        line_history_conn,
        provider_id=LINE_PROVIDER,
        generated_utc=stamp,
    )

    assert [(partition.entity_id, partition.month) for partition in bundle.partitions] == [
        ("A", "2026-05"),
        ("A", "2026-06"),
        ("AUX/only", "2026-06"),
    ]
    direct_delay = line_history_conn.execute(
        text(
            "SELECT SUM(delay_observation_count), SUM(on_time_observation_count), "
            "SUM(severe_delay_count), SUM(sum_delay_seconds), "
            "SUM((SELECT COALESCE(SUM(x), 0) FROM unnest(delay_histogram) AS x)) "
            "FROM gold.route_delay_spine WHERE provider_id = :p AND route_id = 'A'"
        ),
        {"p": LINE_PROVIDER},
    ).one()
    a_days = [
        day
        for partition in bundle.partitions
        if partition.entity_id == "A"
        for day in partition.days
    ]
    assert (
        sum(day.delay.observation_count for day in a_days if day.delay),
        sum(day.delay.on_time_count for day in a_days if day.delay),
        sum(day.delay.severe_count for day in a_days if day.delay),
        sum(day.delay.sum_delay_seconds for day in a_days if day.delay),
        sum(day.delay.in_clamp_observation_count for day in a_days if day.delay),
    ) == tuple(direct_delay)
    assert a_days[0].delay_percentiles is not None
    assert a_days[0].delay_percentiles.p90_delay_seconds == 240
    assert a_days[1].service_span is not None
    assert a_days[1].service_span.first_trip_utc == "2026-06-01T09:00:00Z"
    direct_percentile = line_history_conn.execute(
        text(
            "SELECT delay_observation_count, p50_delay_seconds, p90_delay_seconds "
            "FROM gold.route_delay_percentile_daily "
            "WHERE provider_id = :p AND route_id = 'A'"
        ),
        {"p": LINE_PROVIDER},
    ).one()
    assert (
        a_days[0].delay_percentiles.observation_count,
        a_days[0].delay_percentiles.p50_delay_seconds,
        a_days[0].delay_percentiles.p90_delay_seconds,
    ) == (direct_percentile[0], float(direct_percentile[1]), float(direct_percentile[2]))
    direct_cancellation = line_history_conn.execute(
        text(
            "SELECT SUM(canceled_trip_days), SUM(total_trip_days), "
            "SUM(scheduled_trip_days), SUM(delivered_trip_days), SUM(silent_trip_days) "
            "FROM gold.route_cancellation_daily "
            "WHERE provider_id = :p AND route_id = 'A'"
        ),
        {"p": LINE_PROVIDER},
    ).one()
    assert (
        sum(day.cancellation.canceled_trip_days for day in a_days if day.cancellation),
        sum(day.cancellation.total_trip_days for day in a_days if day.cancellation),
        sum(day.cancellation.scheduled_trip_days for day in a_days if day.cancellation),
        sum(day.cancellation.delivered_trip_days for day in a_days if day.cancellation),
        sum(day.cancellation.silent_trip_days for day in a_days if day.cancellation),
    ) == tuple(direct_cancellation)
    direct_service = line_history_conn.execute(
        text(
            "SELECT trip_count, first_trip_start_utc, last_trip_start_utc, "
            "first_trip_delay_seconds, last_trip_delay_seconds "
            "FROM gold.route_service_span_daily "
            "WHERE provider_id = :p AND route_id = 'A'"
        ),
        {"p": LINE_PROVIDER},
    ).one()
    span = a_days[1].service_span
    assert span is not None
    assert (
        span.trip_count,
        span.first_trip_utc,
        span.last_trip_utc,
        span.first_trip_delay_seconds,
        span.last_trip_delay_seconds,
    ) == (
        direct_service[0],
        direct_service[1].astimezone(UTC).isoformat().replace("+00:00", "Z"),
        direct_service[2].astimezone(UTC).isoformat().replace("+00:00", "Z"),
        direct_service[3],
        direct_service[4],
    )

    auxiliary = next(
        partition for partition in bundle.partitions if partition.entity_id == "AUX/only"
    )
    assert auxiliary.days[0].delay is None
    assert auxiliary.days[0].delay_percentiles is None
    assert auxiliary.days[0].occupancy is not None
    direct_occupancy = line_history_conn.execute(
        text(
            "SELECT empty_count, many_seats_count, few_seats_count, standing_count, full_count "
            "FROM gold.route_occupancy_band_daily "
            "WHERE provider_id = :p AND route_id = 'AUX/only'"
        ),
        {"p": LINE_PROVIDER},
    ).one()
    assert (
        auxiliary.days[0].occupancy.empty,
        auxiliary.days[0].occupancy.many_seats,
        auxiliary.days[0].occupancy.few_seats,
        auxiliary.days[0].occupancy.standing,
        auxiliary.days[0].occupancy.full,
    ) == tuple(direct_occupancy)
    conflicting_provider = line_history_conn.execute(
        text(
            "SELECT empty_count, many_seats_count, few_seats_count, standing_count, full_count "
            "FROM gold.route_occupancy_band_daily "
            "WHERE provider_id = :p AND route_id = 'AUX/only'"
        ),
        {"p": LINE_OTHER_PROVIDER},
    ).one()
    assert tuple(conflicting_provider) == (0, 0, 0, 0, 99)
    assert tuple(direct_occupancy) != tuple(conflicting_provider)
    assert auxiliary.days[0].skipped_stops is not None
    assert auxiliary.days[0].skipped_stops.skipped_stop_count == 0
    direct_skips = line_history_conn.execute(
        text(
            "SELECT skipped_stop_count, stop_time_update_count "
            "FROM gold.route_skipped_stop_daily "
            "WHERE provider_id = :p AND route_id = 'AUX/only'"
        ),
        {"p": LINE_PROVIDER},
    ).one()
    assert (
        auxiliary.days[0].skipped_stops.skipped_stop_count,
        auxiliary.days[0].skipped_stops.stop_time_update_count,
    ) == tuple(direct_skips)
    assert [entry.entity_id for entry in bundle.directory.entities] == ["A", "AUX/only"]
    assert bundle.directory.entities[1].encoded_id == b"AUX/only".hex()
    aux_index = next(index for index in bundle.indexes if index.entity_id == "AUX/only")
    coverage = {metric.metric.value: metric for metric in aux_index.metrics}
    assert coverage["delay"].first_available_date is None
    assert coverage["occupancy"].first_available_date == "2026-06-02"
    assert coverage["skipped_stops"].first_available_date == "2026-06-02"
    assert auxiliary.days[0].occupancy.full == 0
    compatibility_after = snapshot_json_bytes(
        build_route_reliability(
            line_history_conn,
            provider_id=LINE_PROVIDER,
            route_id="A",
            generated_utc=stamp,
        )
    )
    assert compatibility_after == compatibility_before
    assert len(compatibility_after) <= ROUTE_RELIABILITY_BYTE_CEILING


def test_stop_history_real_db_reconciles_routes_auxiliary_sources_and_compatibility(
    stop_history_conn,
    monkeypatch: pytest.MonkeyPatch,
):
    _extend_history_retention(monkeypatch)
    stamp = "2026-07-13T00:00:00Z"
    compatibility_before = {
        stop_id: snapshot_json_bytes(payload)
        for stop_id, payload in build_stop_reliability(
            stop_history_conn,
            provider_id=STOP_PROVIDER,
            generated_utc=stamp,
        ).items()
    }
    bundle = build_stop_history(
        stop_history_conn,
        provider_id=STOP_PROVIDER,
        generated_utc=stamp,
    )

    main_stop = "A/B é雪"
    aux_stop = "aux/%雪"
    assert [(partition.entity_id, partition.month) for partition in bundle.partitions] == [
        (main_stop, "2026-05"),
        (main_stop, "2026-06"),
        (aux_stop, "2026-06"),
    ]
    main_days = [
        day
        for partition in bundle.partitions
        if partition.entity_id == main_stop
        for day in partition.days
    ]
    direct_delay = stop_history_conn.execute(
        text(
            "SELECT SUM(observation_count), SUM(severe_delay_count), "
            "SUM(sum_delay_seconds) FROM gold.stop_delay_spine "
            "WHERE provider_id = :provider_id AND stop_id = :stop_id"
        ),
        {"provider_id": STOP_PROVIDER, "stop_id": main_stop},
    ).one()
    assert (
        sum(day.delay.observation_count for day in main_days if day.delay),
        sum(day.delay.severe_count for day in main_days if day.delay),
        sum(day.delay.sum_delay_seconds for day in main_days if day.delay),
    ) == tuple(direct_delay)
    assert (
        sum(day.delay.in_clamp_observation_count for day in main_days if day.delay)
        == direct_delay[0]
    )
    assert all(day.delay.on_time_count is None for day in main_days if day.delay)
    assert main_days[1].delay.severe_count == 0
    first_day_routes = stop_history_conn.execute(
        text(
            "SELECT route_id, observation_count FROM gold.stop_delay_spine "
            "WHERE provider_id = :provider_id AND stop_id = :stop_id "
            "AND provider_local_date = '2026-05-31' ORDER BY route_id"
        ),
        {"provider_id": STOP_PROVIDER, "stop_id": main_stop},
    ).all()
    assert first_day_routes == [("A", 4), ("__unrouted__", 6)]
    assert main_days[0].delay.observation_count == sum(row[1] for row in first_day_routes)
    assert main_days[0].delay_percentiles is not None
    assert main_days[0].delay_percentiles.p90_delay_seconds == 240
    assert main_days[1].occupancy is not None
    assert main_days[1].occupancy.model_dump() == {
        "empty": 0,
        "many_seats": 1,
        "few_seats": 1,
        "standing": 1,
        "full": 1,
    }

    auxiliary = next(
        partition for partition in bundle.partitions if partition.entity_id == aux_stop
    )
    assert auxiliary.days[0].delay is None
    assert auxiliary.days[0].delay_percentiles is not None
    assert auxiliary.days[0].delay_percentiles.p90_delay_seconds == 180
    assert auxiliary.days[0].occupancy is not None
    assert auxiliary.days[0].occupancy.full == 1
    assert [entry.entity_id for entry in bundle.directory.entities] == [main_stop, aux_stop]
    assert bundle.directory.entities[0].encoded_id == main_stop.encode().hex()
    assert all(index.entity_id != "FOREIGN" for index in bundle.indexes)
    foreign = stop_history_conn.execute(
        text(
            "SELECT SUM(observation_count), SUM(severe_delay_count) "
            "FROM gold.stop_delay_spine WHERE provider_id = :provider_id"
        ),
        {"provider_id": STOP_OTHER_PROVIDER},
    ).one()
    assert tuple(foreign) == (99, 99)
    assert tuple(foreign) != tuple(direct_delay[:2])

    stop_family = _entity_family_availability(
        family="stops",
        directory=bundle.directory,
        indexes=bundle.indexes,
        metrics=STOP_HISTORY_METRICS,
    )
    assert stop_family.first_available_date == "2026-05-31"
    assert stop_family.last_available_date == "2026-06-03"
    assert [(gap.start_date, gap.end_date) for gap in stop_family.gaps] == [
        ("2026-06-01", "2026-06-01")
    ]
    assert {metric.metric.value for metric in stop_family.metrics} == {
        "delay",
        "delay_percentiles",
        "occupancy",
    }

    compatibility_after = {
        stop_id: snapshot_json_bytes(payload)
        for stop_id, payload in build_stop_reliability(
            stop_history_conn,
            provider_id=STOP_PROVIDER,
            generated_utc=stamp,
        ).items()
    }
    assert compatibility_after == compatibility_before
    main_compatibility = next(
        payload
        for stop_id, payload in build_stop_reliability(
            stop_history_conn,
            provider_id=STOP_PROVIDER,
            generated_utc=stamp,
        ).items()
        if stop_id == main_stop
    )
    assert [day.date for day in main_compatibility.daily] == ["2026-05-31", "2026-06-02"]


def test_route_reliability_batch_real_db_matches_standalone_bytes_and_scope(
    line_history_conn,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from transit_ops.snapshots.builders import build_all_route_reliability

    _extend_history_retention(monkeypatch)
    stamp = "2026-07-13T00:00:00Z"
    expected_route_ids = [
        str(row[0])
        for row in line_history_conn.execute(
            text(
                "SELECT DISTINCT route_id FROM gold.route_delay_spine "
                "WHERE provider_id = :provider_id AND route_id IS NOT NULL ORDER BY route_id"
            ),
            {"provider_id": LINE_PROVIDER},
        )
    ]

    batch = build_all_route_reliability(
        line_history_conn,
        provider_id=LINE_PROVIDER,
        generated_utc=stamp,
    )

    assert list(batch) == expected_route_ids
    for route_id, payload in batch.items():
        batched_bytes = snapshot_json_bytes(payload)
        standalone_bytes = snapshot_json_bytes(
            build_route_reliability(
                line_history_conn,
                provider_id=LINE_PROVIDER,
                route_id=route_id,
                generated_utc=stamp,
            )
        )
        assert batched_bytes == standalone_bytes
        assert hashlib.sha256(batched_bytes).hexdigest() == hashlib.sha256(
            standalone_bytes
        ).hexdigest()
        assert len(batched_bytes) <= ROUTE_RELIABILITY_BYTE_CEILING
