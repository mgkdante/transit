
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
import real_db_seed as db_seed
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from transit_ops.gold.marts import (
    CLOSE_DIM_ROUTE_HISTORY,
    CLOSE_DIM_STOP_HISTORY,
    OPEN_DIM_ROUTE_HISTORY,
    OPEN_DIM_STOP_HISTORY,
)

PROVIDER = "stm_dimhist_test"
ENDPOINT_ID = 990024
RUN_IDS = (990201, 990202)
DSV1, DSV2 = 990301, 990302
T_OLD = datetime(2026, 6, 1, 6, 0, tzinfo=UTC)

V1_ROUTES = [
    {"route_id": "R1", "short": "51", "long": "Ligne Verte", "color": "00A650", "rtype": 3},
]
V2_ROUTES = [
    {"route_id": "R1", "short": "51", "long": "Ligne Verte Express", "color": "00A650", "rtype": 3},
]
V1_STOPS = [
    {"stop_id": "S1", "name": "Station Un", "lat": 45.50, "lon": -73.60},
    {"stop_id": "S2", "name": "Station Deux", "lat": 45.51, "lon": -73.61},
]
V2_STOPS = [
    {"stop_id": "S2", "name": "Station Deux", "lat": 45.51, "lon": -73.61},
    {"stop_id": "S3", "name": "Station Trois", "lat": 45.52, "lon": -73.62},
]


@pytest.fixture()
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        _seed(connection, seed_provider)
        try:
            yield connection
        finally:
            transaction.rollback()


def _seed(connection, seed_provider) -> None:
    seed_provider(connection, PROVIDER, display_name="STM dim history regression")
    db_seed.feed_endpoints(
        connection, {'e': ENDPOINT_ID, 'p': PROVIDER}, endpoint_key="'static_schedule'",
        feed_kind="'static_schedule'", source_format="'gtfs_schedule_zip'",
    )
    for run_id, dsv, content_hash, is_current in (
        (RUN_IDS[0], DSV1, "dimhist-h1", False),
        (RUN_IDS[1], DSV2, "dimhist-h2", True),
    ):
        db_seed.ingestion_runs(
            connection, {'r': run_id, 'p': PROVIDER, 'e': ENDPOINT_ID},
            run_kind="'static_schedule'",
        )
        db_seed.dataset_versions(
            connection,
            {
                "d": dsv,
                "p": PROVIDER,
                "e": ENDPOINT_ID,
                "r": run_id,
                "h": content_hash,
                "c": is_current,
            },
            dataset_kind=None, is_current=':c',
        )
    for dsv, routes in ((DSV1, V1_ROUTES), (DSV2, V2_ROUTES)):
        for r in routes:
            connection.execute(
                text(
                    """
                    INSERT INTO silver.routes
                        (dataset_version_id, provider_id, route_id,
                         route_short_name, route_long_name, route_type, route_color)
                    VALUES (:d, :p, :route_id, :short, :long, :rtype, :color)
                    """
                ),
                {"d": dsv, "p": PROVIDER, **r},
            )
    for dsv, stops in ((DSV1, V1_STOPS), (DSV2, V2_STOPS)):
        for s in stops:
            connection.execute(
                text(
                    """
                    INSERT INTO silver.stops
                        (dataset_version_id, provider_id, stop_id, stop_name, stop_lat, stop_lon)
                    VALUES (:d, :p, :stop_id, :name, :lat, :lon)
                    """
                ),
                {"d": dsv, "p": PROVIDER, **s},
            )


def _run_history_pairs(connection, dataset_version_id: int) -> None:
    params = {"provider_id": PROVIDER, "dataset_version_id": dataset_version_id}
    connection.execute(CLOSE_DIM_ROUTE_HISTORY, params)
    connection.execute(OPEN_DIM_ROUTE_HISTORY, params)
    connection.execute(CLOSE_DIM_STOP_HISTORY, params)
    connection.execute(OPEN_DIM_STOP_HISTORY, params)


def _seed_v1_history(connection) -> None:
    connection.execute(
        text(
            """
            INSERT INTO gold.dim_route_history
                (provider_id, route_id, route_short_name, route_long_name, route_color,
                 route_type, valid_from_utc, valid_to_utc, last_seen_dataset_version_id)
            VALUES (:p, 'R1', '51', 'Ligne Verte', '00A650', 3, :t, NULL, :d)
            """
        ),
        {"p": PROVIDER, "t": T_OLD, "d": DSV1},
    )
    for s in V1_STOPS:
        connection.execute(
            text(
                """
                INSERT INTO gold.dim_stop_history
                    (provider_id, stop_id, stop_name, stop_lat, stop_lon,
                     valid_from_utc, valid_to_utc, last_seen_dataset_version_id)
                VALUES (:p, :stop_id, :name, :lat, :lon, :t, NULL, :d)
                """
            ),
            {"p": PROVIDER, "t": T_OLD, "d": DSV1, **s},
        )


def _route_rows(connection) -> list[dict]:
    return [
        dict(row)
        for row in connection.execute(
            text(
                """
                SELECT route_id, route_long_name, valid_from_utc, valid_to_utc,
                       last_seen_dataset_version_id
                FROM gold.dim_route_history
                WHERE provider_id = :p
                ORDER BY route_id, valid_from_utc
                """
            ),
            {"p": PROVIDER},
        ).mappings()
    ]


def _stop_rows(connection) -> list[dict]:
    return [
        dict(row)
        for row in connection.execute(
            text(
                """
                SELECT stop_id, stop_name, valid_from_utc, valid_to_utc,
                       last_seen_dataset_version_id
                FROM gold.dim_stop_history
                WHERE provider_id = :p
                ORDER BY stop_id, valid_from_utc
                """
            ),
            {"p": PROVIDER},
        ).mappings()
    ]


def test_first_generation_opens_one_row_per_entity(conn) -> None:
    _run_history_pairs(conn, DSV1)

    routes = _route_rows(conn)
    assert [(r["route_id"], r["route_long_name"], r["valid_to_utc"]) for r in routes] == [
        ("R1", "Ligne Verte", None)
    ]
    assert routes[0]["last_seen_dataset_version_id"] == DSV1

    stops = _stop_rows(conn)
    assert [(s["stop_id"], s["valid_to_utc"]) for s in stops] == [("S1", None), ("S2", None)]


def test_rename_retire_unchanged_new_generations(conn) -> None:
    _seed_v1_history(conn)

    _run_history_pairs(conn, DSV2)

    routes = _route_rows(conn)
    assert len(routes) == 2
    closed = next(r for r in routes if r["valid_to_utc"] is not None)
    opened = next(r for r in routes if r["valid_to_utc"] is None)
    assert closed["route_long_name"] == "Ligne Verte"
    assert closed["valid_from_utc"] == T_OLD
    assert opened["route_long_name"] == "Ligne Verte Express"
    assert opened["valid_from_utc"] > T_OLD
    assert opened["last_seen_dataset_version_id"] == DSV2

    stops = {s["stop_id"]: s for s in _stop_rows(conn)}
    assert len(stops) == 3
    assert stops["S1"]["valid_to_utc"] is not None
    assert stops["S1"]["stop_name"] == "Station Un"
    assert stops["S2"]["valid_to_utc"] is None
    assert stops["S2"]["valid_from_utc"] == T_OLD
    assert stops["S3"]["valid_to_utc"] is None
    assert stops["S3"]["last_seen_dataset_version_id"] == DSV2


def test_rerun_same_generation_is_idempotent(conn) -> None:
    _run_history_pairs(conn, DSV2)
    before_routes = _route_rows(conn)
    before_stops = _stop_rows(conn)

    _run_history_pairs(conn, DSV2)

    assert _route_rows(conn) == before_routes
    assert _stop_rows(conn) == before_stops


def test_duplicate_open_row_rejected_then_dataset_version_still_prunable(conn) -> None:
    _seed_v1_history(conn)

    with pytest.raises(IntegrityError):
        with conn.begin_nested():
            conn.execute(
                text(
                    """
                    INSERT INTO gold.dim_stop_history
                        (provider_id, stop_id, stop_name, stop_lat, stop_lon,
                         valid_from_utc, valid_to_utc, last_seen_dataset_version_id)
                    VALUES (:p, 'S2', 'Station Deux bis', 45.51, -73.61, :t, NULL, :d)
                    """
                ),
                {"p": PROVIDER, "t": T_OLD + timedelta(hours=1), "d": DSV1},
            )

    for table in ("silver.stops", "silver.routes"):
        conn.execute(
            text(f"DELETE FROM {table} WHERE provider_id = :p AND dataset_version_id = :d"),  # noqa: S608
            {"p": PROVIDER, "d": DSV1},
        )
    deleted = conn.execute(
        text("DELETE FROM core.dataset_versions WHERE dataset_version_id = :d"),
        {"d": DSV1},
    )
    assert deleted.rowcount == 1

    assert any(r["last_seen_dataset_version_id"] == DSV1 for r in _stop_rows(conn))
