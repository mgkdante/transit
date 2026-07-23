"""Real-database regression tests for the dim name-history writer (slice-9.1.1u).

These tests exercise the actual Postgres behavior that fake-connection tests
structurally cannot see: the partial unique index on open history rows, the
close-then-open statement pair against real silver rows across generations,
and the deliberate ABSENCE of an FK from history to core.dataset_versions
(the per-cycle silver prune deletes old dataset_versions rows and must never
be blocked by the append-only history tables).

They run ONLY when TRANSIT_TEST_DATABASE_URL points at a disposable Postgres
with the transit schema applied. Throwaway cluster recipe:

    /usr/lib/postgresql/16/bin/initdb -D /tmp/dimhist_pg
    pg_ctl -D /tmp/dimhist_pg -o '-k /tmp/dimhist_pg -p 55433 -c listen_addresses=' start
    createdb -h /tmp/dimhist_pg -p 55433 transit_repro
    # restore schema from prod (either AFTER prod ran migration 0029, or
    # restore the pre-0029 dump and then apply 0029 by hand:
    #   cd apps/db && DATABASE_URL=postgresql+psycopg://...55433/transit_repro \
    #       uv run python -m transit_ops.cli init-db
    psql -h /tmp/dimhist_pg -p 55433 transit_repro < schema_only_dump.sql

    TRANSIT_TEST_DATABASE_URL=\
        "postgresql+psycopg://$USER@:55433/transit_repro?host=/tmp/dimhist_pg" \
        uv run pytest tests/test_dim_history_real_db_regression.py -v

Each test runs inside one transaction and rolls back — nothing persists.
NOTE: Postgres now() is the TRANSACTION timestamp, so a v1 pair run and a v2
pair run cannot share one test transaction (a renamed id's closed row and its
replacement open row would collide on the (provider, id, valid_from) PK);
prior generations are therefore seeded with explicit timestamps instead.

Never point this at production.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from transit_ops.gold.dim_history import _backfill_on_connection, parse_gtfs_name_rows
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
    # renamed at the new GTFS edition
    {"route_id": "R1", "short": "51", "long": "Ligne Verte Express", "color": "00A650", "rtype": 3},
]
V1_STOPS = [
    {"stop_id": "S1", "name": "Station Un", "lat": 45.50, "lon": -73.60},
    {"stop_id": "S2", "name": "Station Deux", "lat": 45.51, "lon": -73.61},
]
V2_STOPS = [
    # S1 retired, S2 unchanged, S3 new
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
    for run_id, dsv, content_hash, is_current in (
        (RUN_IDS[0], DSV1, "dimhist-h1", False),
        (RUN_IDS[1], DSV2, "dimhist-h2", True),
    ):
        connection.execute(
            text(
                """
                INSERT INTO raw.ingestion_runs
                    (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
                VALUES (:r, :p, :e, 'static_schedule', 'succeeded')
                """
            ),
            {"r": run_id, "p": PROVIDER, "e": ENDPOINT_ID},
        )
        connection.execute(
            text(
                """
                INSERT INTO core.dataset_versions
                    (dataset_version_id, provider_id, feed_endpoint_id,
                     source_ingestion_run_id, content_hash, is_current)
                VALUES (:d, :p, :e, :r, :h, :c)
                """
            ),
            {
                "d": dsv,
                "p": PROVIDER,
                "e": ENDPOINT_ID,
                "r": run_id,
                "h": content_hash,
                "c": is_current,
            },
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
    """History state as the v1-generation run would have left it, with explicit
    timestamps (now() is txn-constant, so the v1 pair cannot run in-test)."""
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
    """Empty history + v1 silver -> exactly one open row per route/stop."""
    _run_history_pairs(conn, DSV1)

    routes = _route_rows(conn)
    assert [(r["route_id"], r["route_long_name"], r["valid_to_utc"]) for r in routes] == [
        ("R1", "Ligne Verte", None)
    ]
    assert routes[0]["last_seen_dataset_version_id"] == DSV1

    stops = _stop_rows(conn)
    assert [(s["stop_id"], s["valid_to_utc"]) for s in stops] == [("S1", None), ("S2", None)]


def test_rename_retire_unchanged_new_generations(conn) -> None:
    """THE drop-day scenario: renamed route -> closed+open rows; retired stop ->
    single closed row; unchanged stop -> single untouched open row; new stop ->
    one open row. Old silver rows are irrelevant (diff runs against v2 only)."""
    _seed_v1_history(conn)

    _run_history_pairs(conn, DSV2)

    # R1 renamed: old name closed, new name open
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
    # S1 retired: its only row is now closed — the name survives for fallback
    assert stops["S1"]["valid_to_utc"] is not None
    assert stops["S1"]["stop_name"] == "Station Un"
    # S2 unchanged: single open row, valid_from untouched
    assert stops["S2"]["valid_to_utc"] is None
    assert stops["S2"]["valid_from_utc"] == T_OLD
    # S3 new: one open row from the v2 generation
    assert stops["S3"]["valid_to_utc"] is None
    assert stops["S3"]["last_seen_dataset_version_id"] == DSV2


def test_rerun_same_generation_is_idempotent(conn) -> None:
    """Re-running the pairs for the same dataset version must change nothing."""
    _run_history_pairs(conn, DSV2)
    before_routes = _route_rows(conn)
    before_stops = _stop_rows(conn)

    _run_history_pairs(conn, DSV2)

    assert _route_rows(conn) == before_routes
    assert _stop_rows(conn) == before_stops


def test_duplicate_open_row_rejected_then_dataset_version_still_prunable(conn) -> None:
    """The partial unique index allows at most one OPEN row per natural key —
    and the IntegrityError, taken inside a SAVEPOINT, must not poison the
    transaction: the old core.dataset_versions row stays deletable afterwards
    (history has NO FK to it, by design)."""
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

    # Same still-healthy transaction: mimic the prune order (silver first,
    # then the dataset_versions row) — history must not block the delete.
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

    # The breadcrumb dangles on purpose — names must outlive the dataset row.
    assert any(r["last_seen_dataset_version_id"] == DSV1 for r in _stop_rows(conn))


def test_backfill_from_gtfs_zip_heals_missing_ids_only(conn, tmp_path) -> None:
    """The June-2026 heal path: an archived zip containing both tracked ids
    (R1/S1, already in history) and orphaned ids (R_GONE/S_GONE, names lost
    before 0029 existed) inserts CLOSED rows only for the orphans."""
    import zipfile

    _seed_v1_history(conn)

    zip_path = tmp_path / "old_edition.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        zf.writestr(
            "routes.txt",
            "route_id,route_short_name,route_long_name,route_type,route_color\n"
            "R1,51,Nom Perime,3,00A650\n"
            "R_GONE,77,Ancienne ligne,3,FF0000\n",
        )
        zf.writestr(
            "stops.txt",
            "stop_id,stop_name,stop_lat,stop_lon\n"
            "S1,Nom Perime,45.50,-73.60\n"
            "S_GONE,Ancien arret,45.49,-73.59\n",
        )
        zf.writestr(
            "feed_info.txt",
            "feed_publisher_name,feed_start_date,feed_end_date\nSTM,20251102,20260322\n",
        )

    counts = _backfill_on_connection(
        conn, provider_id=PROVIDER, parsed=parse_gtfs_name_rows(zip_path)
    )

    assert counts["dim_route_history_inserted"] == 1
    assert counts["dim_stop_history_inserted"] == 1

    routes = {(r["route_id"], r["route_long_name"]): r for r in _route_rows(conn)}
    # tracked id untouched (zip's stale name NOT applied), orphan healed closed
    assert ("R1", "Ligne Verte") in routes
    assert ("R1", "Nom Perime") not in routes
    healed = routes[("R_GONE", "Ancienne ligne")]
    assert healed["valid_to_utc"] is not None
    assert healed["valid_from_utc"] == datetime(2025, 11, 2, tzinfo=UTC)

    stops = {(s["stop_id"], s["stop_name"]): s for s in _stop_rows(conn)}
    assert ("S1", "Station Un") in stops
    assert ("S1", "Nom Perime") not in stops
    assert stops[("S_GONE", "Ancien arret")]["valid_to_utc"] is not None

    # rerun with the same zip: idempotent, nothing new
    rerun = _backfill_on_connection(
        conn, provider_id=PROVIDER, parsed=parse_gtfs_name_rows(zip_path)
    )
    assert rerun["dim_route_history_inserted"] == 0
    assert rerun["dim_stop_history_inserted"] == 0
