"""Real-database test for the routes_index `reliability` availability flag.

build_routes_index sets RouteIndexEntry.reliability=True exactly for the routes
that appear in gold.route_reliability_weekly / route_reliability_monthly (the
SAME set publish.py uses to decide which historic/route_reliability/{id}.json
files to write), so the web loader can skip probing routes with no history and
the 404 flood disappears. This exercises that join against a live Postgres —
the FakeConn unit tests cannot prove the real DISTINCT/UNION over real tables.

Runs ONLY when TRANSIT_TEST_DATABASE_URL points at a disposable Postgres with
the transit schema at head 0057, e.g.:

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://postgres@localhost:5433/transit_ci" \
        uv run pytest tests/test_routes_index_reliability_flag_real_db.py -v

Each test runs inside one transaction and rolls back — nothing persists.
Never point this at production. (CI has no Postgres — skipped there.)
"""

from __future__ import annotations

import os
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import create_engine, text

from transit_ops.snapshots.builders import build_routes_index

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set — real-DB regression tests skipped",
)

PROVIDER = "stm_reliability_flag_test"
ENDPOINT_ID = 920_001
RUN_ID = 920_001
VERSION_ID = 920_001
# Route 100 HAS weekly reliability history; route 200 has none.
ROUTE_WITH = "100"
ROUTE_WITHOUT = "200"
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
            VALUES (:p, 'STM reliability-flag regression', 'America/Toronto', :p)
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
    # Two routes in the dimension; only one gets reliability history.
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
    # Spine rows for ROUTE_WITH only — this is what flips its flag True (S7-B:
    # build_routes_index enumerates routes from gold.route_delay_spine).
    connection.execute(
        text(
            """
            INSERT INTO gold.route_delay_spine
                (provider_id, route_id, service_local_date, hour_of_day_local,
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
    # The route with weekly history is flagged available.
    assert by_id[ROUTE_WITH].reliability is True
    # The route with NO history is flagged absent (the loader will skip it).
    assert by_id[ROUTE_WITHOUT].reliability is False


def test_unrouted_sentinel_never_flags_a_real_route(conn) -> None:
    # build_routes_index now enumerates from gold.route_delay_spine, which filters
    # route_id IS NOT NULL at build (no COALESCE -> no '__unrouted__'). A sentinel
    # row in the OLD route_reliability_monthly mart must therefore have zero effect.
    conn.execute(
        text(
            """
            INSERT INTO gold.route_reliability_monthly
                (provider_id, month_start_local, route_id, observation_count,
                 delayed_trip_count, severe_delay_count, delay_observation_count)
            VALUES (:p, :mo, '__unrouted__', 5, 1, 0, 5)
            """
        ),
        {"p": PROVIDER, "mo": date(2026, 5, 1)},
    )

    idx = build_routes_index(conn, provider_id=PROVIDER, generated_utc="t")
    by_id = {r.id: r for r in idx.routes}

    # The sentinel row in the legacy mart is ignored — it never appears in the index…
    assert "__unrouted__" not in by_id
    # …ROUTE_WITH (real spine history) is still flagged, ROUTE_WITHOUT is not.
    assert by_id[ROUTE_WITH].reliability is True
    assert by_id[ROUTE_WITHOUT].reliability is False
