"""Real-database test for the per-route file `type` (GTFS route_type) field.

build_route now emits RouteFile.type from gold.dim_route.route_type — the
self-describing mode field that lets the web detail surface infer "metro has no
realtime" (route_type 1 + the metro_realtime gap) without cross-referencing
routes_index. This exercises the real name+type SELECT against a live Postgres;
the FakeConn unit test cannot prove the column actually flows from dim_route.

Runs ONLY when TRANSIT_TEST_DATABASE_URL points at a disposable Postgres with
the transit schema at head 0057, e.g.:

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://postgres@localhost:5433/transit_ci" \
        uv run pytest tests/test_route_file_type_real_db.py -v

Each test runs inside one transaction and rolls back — nothing persists.
Never point this at production. (CI has no Postgres — skipped there.)
"""

from __future__ import annotations

import os
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, text

from transit_ops.snapshots.builders import build_route

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set — real-DB regression tests skipped",
)

PROVIDER = "stm_route_type_test"
ENDPOINT_ID = 930_001
RUN_ID = 930_001
VERSION_ID = 930_001
# A metro route (route_type 1) and a bus route (route_type 3).
ROUTE_METRO = "1"
ROUTE_BUS = "165"
LOADED = datetime(2026, 6, 1, 0, 0, tzinfo=UTC)


@pytest.fixture()
def conn():
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        _seed(connection)
        try:
            yield connection
        finally:
            transaction.rollback()
        engine.dispose()


def _seed(connection) -> None:
    connection.execute(
        text(
            """
            INSERT INTO core.providers (provider_id, display_name, timezone, provider_key)
            VALUES (:p, 'STM route-type regression', 'America/Toronto', :p)
            """
        ),
        {"p": PROVIDER},
    )
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
    # A metro route (route_type 1) and a bus route (route_type 3).
    for route_id, route_type, sort_order in ((ROUTE_METRO, 1, 1), (ROUTE_BUS, 3, 2)):
        connection.execute(
            text(
                """
                INSERT INTO gold.dim_route
                    (provider_id, dataset_version_id, route_id, route_short_name,
                     route_long_name, route_type, route_sort_order)
                VALUES (:p, :v, :route, :route, 'Route ' || :route, :rt, :sort)
                """
            ),
            {
                "p": PROVIDER,
                "v": VERSION_ID,
                "route": route_id,
                "rt": route_type,
                "sort": sort_order,
            },
        )


def test_route_file_emits_metro_route_type(conn) -> None:
    rf = build_route(conn, provider_id=PROVIDER, route_id=ROUTE_METRO, generated_utc="t")
    assert rf.id == ROUTE_METRO
    # The GTFS route_type (1 = metro) flows from gold.dim_route onto the route file —
    # the signal the web surface needs for the "metro has no realtime" inference.
    assert rf.type == 1


def test_route_file_emits_bus_route_type(conn) -> None:
    rf = build_route(conn, provider_id=PROVIDER, route_id=ROUTE_BUS, generated_utc="t")
    assert rf.id == ROUTE_BUS
    assert rf.type == 3


def test_route_file_type_is_none_for_unknown_route(conn) -> None:
    # An id not in dim_route has no name/type row — the additive-optional `type`
    # field stays None (never a fabricated default).
    rf = build_route(conn, provider_id=PROVIDER, route_id="does_not_exist", generated_utc="t")
    assert rf.type is None
