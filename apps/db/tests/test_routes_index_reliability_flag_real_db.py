
from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import text

from transit_ops.snapshots.builders import build_routes_index

PROVIDER = "stm_reliability_flag_test"
ENDPOINT_ID = 920_001
RUN_ID = 920_001
VERSION_ID = 920_001
ROUTE_WITH = "100"
ROUTE_WITHOUT = "200"
LOADED = datetime(2026, 6, 1, 0, 0, tzinfo=UTC)


@pytest.fixture()
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        seed_provider(connection, PROVIDER, display_name="STM reliability-flag regression")
        _seed(connection)
        try:
            yield connection
        finally:
            transaction.rollback()


def _seed(connection) -> None:
    connection.execute(
        text(
            """
            INSERT INTO core.feed_endpoints
                (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
            VALUES (:e, :p, 'static_schedule', 'static_schedule', 'gtfs_schedule_zip')
            """
        ),
        {"e": ENDPOINT_ID, "p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
            VALUES (:r, :p, :e, 'static_schedule', 'succeeded')
            """
        ),
        {"r": RUN_ID, "p": PROVIDER, "e": ENDPOINT_ID},
    )
    connection.execute(
        text(
            """
            INSERT INTO core.dataset_versions
                (dataset_version_id, provider_id, feed_endpoint_id,
                 source_ingestion_run_id, dataset_kind, content_hash,
                 loaded_at_utc, is_current)
            VALUES (:v, :p, :e, :r, 'static_schedule', :h, :loaded, true)
            """
        ),
        {
            "v": VERSION_ID,
            "p": PROVIDER,
            "e": ENDPOINT_ID,
            "r": RUN_ID,
            "h": f"{PROVIDER}-hash",
            "loaded": LOADED,
        },
    )
    for route_id, sort_order in ((ROUTE_WITH, 1), (ROUTE_WITHOUT, 2)):
        connection.execute(
            text(
                """
                INSERT INTO gold.dim_route
                    (provider_id, dataset_version_id, route_id, route_short_name,
                     route_long_name, route_type, route_sort_order)
                VALUES (:p, :v, :route, :route, 'Route ' || :route, 3, :sort)
                """
            ),
            {"p": PROVIDER, "v": VERSION_ID, "route": route_id, "sort": sort_order},
        )
    connection.execute(
        text(
            """
            INSERT INTO gold.route_delay_spine
                (provider_id, route_id, provider_local_date, hour_of_day_local,
                 direction_id, observation_count, delay_observation_count,
                 severe_delay_count, sum_delay_seconds)
            VALUES (:p, :route, :d, 8, 0, 10, 10, 0, 1200)
            """
        ),
        {"p": PROVIDER, "d": date(2026, 5, 25), "route": ROUTE_WITH},
    )


def test_reliability_flag_true_only_for_routes_with_history(conn) -> None:
    idx = build_routes_index(conn, provider_id=PROVIDER, generated_utc="t")
    by_id = {r.id: r for r in idx.routes}

    assert set(by_id) == {ROUTE_WITH, ROUTE_WITHOUT}
    assert by_id[ROUTE_WITH].reliability is True
    assert by_id[ROUTE_WITHOUT].reliability is False
