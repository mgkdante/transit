"""GC2 H3 — daily == Σ hourly parity gate for the crowding spine (real DB).

The hour-grain gold.route_occupancy_band_hourly (migration 0074) must reduce the SAME
fact_vehicle_snapshot rows with the SAME band predicates as gold.route_occupancy_band_daily
(migration 0048), differing ONLY by the added hour_of_day_local GROUP-BY key. This test
seeds occupancy pings across MULTIPLE local hours + routes for one closed day, runs BOTH
UPSERT_ROUTE_OCCUPANCY_BAND_DAILY and UPSERT_ROUTE_OCCUPANCY_BAND_HOURLY, and asserts that
summing the 6 band counts over the hourly rows reproduces the daily row's counts EXACTLY,
per (provider, route, date), for all 6 count columns. This is the H3 hard bar.

Runs ONLY against a disposable Postgres migrated to head (incl. 0074); self-skips when
TRANSIT_TEST_DATABASE_URL is unset:

    PGB=/usr/lib/postgresql/16/bin
    "$PGB/initdb" -D <shortdir> ...  # listen 127.0.0.1, -p 55437, createdb, CREATE EXTENSION postgis
    DATABASE_URL=... TRANSIT_TEST_DATABASE_URL=... uv run alembic upgrade head
    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://postgres@127.0.0.1:55437/transit_test" \
        uv run pytest tests/test_occupancy_hourly_parity_real_db.py -v
"""

from __future__ import annotations

import os
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, text

from transit_ops.gold.rollups import (
    UPSERT_ROUTE_OCCUPANCY_BAND_DAILY,
    UPSERT_ROUTE_OCCUPANCY_BAND_HOURLY,
)

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set - occupancy hourly parity gate skipped",
)

PROVIDER = "stm_occ_hourly_test"
VP_ENDPOINT_ID = 994001
TORONTO = ZoneInfo("America/Toronto")
_ROUTES = ("77A", "77B")
# (local_hour, [occupancy_status codes]). Spread across hours so the hourly grain
# has >1 populated hour; codes exercise every band incl. the standing fold (3,4) and
# a NULL (should be excluded from observation_count in BOTH tables).
_PER_HOUR_OCCUPANCY = {
    7: [1, 1, 2, 5],
    10: [0, 3, 4, 3, None],   # 4 folds into standing with 3; None excluded
    17: [2, 2, 5, 0, 1],
    23: [3],
}


class _Counter:
    def __init__(self, start: int) -> None:
        self.value = start

    def next(self) -> int:
        self.value += 1
        return self.value


def _seed(connection, local_date: date) -> None:  # noqa: ANN001
    connection.execute(
        text(
            "INSERT INTO core.providers (provider_id, display_name, timezone, provider_key) "
            "VALUES (:p, 'STM occ hourly gate', 'America/Toronto', :p)"
        ),
        {"p": PROVIDER},
    )
    connection.execute(
        text(
            "INSERT INTO core.feed_endpoints "
            "(feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format) "
            "VALUES (:eid, :p, 'vehicle_positions', 'vehicle_positions', "
            "'gtfs_rt_vehicle_positions')"
        ),
        {"eid": VP_ENDPOINT_ID, "p": PROVIDER},
    )
    ids = _Counter(994100)
    for route in _ROUTES:
        for hour, codes in _PER_HOUR_OCCUPANCY.items():
            _insert_vehicle_snapshot(connection, ids, route, local_date, hour, codes)


def _insert_vehicle_snapshot(connection, ids, route, local_date, hour, codes) -> None:  # noqa: ANN001
    captured_at = datetime.combine(local_date, time(hour, 0), tzinfo=TORONTO).astimezone(UTC)
    sid, run_id = ids.next(), ids.next()
    connection.execute(
        text(
            "INSERT INTO raw.ingestion_runs "
            "(ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status) "
            "VALUES (:r, :p, :e, 'vehicle_positions', 'succeeded')"
        ),
        {"r": run_id, "p": PROVIDER, "e": VP_ENDPOINT_ID},
    )
    connection.execute(
        text(
            "INSERT INTO raw.realtime_snapshot_index "
            "(realtime_snapshot_id, ingestion_run_id, provider_id, feed_endpoint_id, "
            " feed_timestamp_utc, entity_count, captured_at_utc) "
            "VALUES (:s, :r, :p, :e, :ts, :n, :ts)"
        ),
        {"s": sid, "r": run_id, "p": PROVIDER, "e": VP_ENDPOINT_ID, "ts": captured_at,
         "n": len(codes)},
    )
    date_key = int(local_date.strftime("%Y%m%d"))
    for idx, code in enumerate(codes):
        connection.execute(
            text(
                """
                INSERT INTO gold.fact_vehicle_snapshot
                    (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                     snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
                     vehicle_id, trip_id, route_id, stop_id, current_stop_sequence,
                     current_status, occupancy_status, latitude, longitude, bearing, speed)
                VALUES (:p, :s, :ei, :dk, :sld, :ts, :ts, :entity, :veh, NULL, :route,
                        NULL, NULL, NULL, :occ, NULL, NULL, NULL, NULL)
                """
            ),
            {"p": PROVIDER, "s": sid, "ei": idx, "dk": date_key, "sld": local_date,
             "ts": captured_at, "entity": f"v{sid}-{idx}", "veh": f"V{sid}-{idx}",
             "route": route, "occ": code},
        )


_BANDS = (
    "observation_count", "empty_count", "many_seats_count",
    "few_seats_count", "standing_count", "full_count",
)


def test_daily_equals_sum_of_hourly_band_counts() -> None:
    local_date = datetime.now(TORONTO).date() - timedelta(days=1)
    date_key = int(local_date.strftime("%Y%m%d"))
    engine = create_engine(DB_URL)
    try:
        with engine.connect() as connection:
            _seed(connection, local_date)
            binds = {
                "provider_id": PROVIDER,
                "local_date": local_date,
                "date_key": date_key,
                "built_at_utc": datetime.now(UTC),
            }
            connection.execute(UPSERT_ROUTE_OCCUPANCY_BAND_DAILY, binds)
            connection.execute(UPSERT_ROUTE_OCCUPANCY_BAND_HOURLY, binds)

            daily = {
                r["route_id"]: r
                for r in connection.execute(
                    text(
                        "SELECT route_id, " + ", ".join(_BANDS)
                        + " FROM gold.route_occupancy_band_daily "
                        "WHERE provider_id = :p AND provider_local_date = :d"
                    ),
                    {"p": PROVIDER, "d": local_date},
                ).mappings()
            }
            hourly_sum = {
                r["route_id"]: r
                for r in connection.execute(
                    text(
                        "SELECT route_id, "
                        + ", ".join(f"SUM({b})::int AS {b}" for b in _BANDS)
                        + " FROM gold.route_occupancy_band_hourly "
                        "WHERE provider_id = :p AND provider_local_date = :d "
                        "GROUP BY route_id"
                    ),
                    {"p": PROVIDER, "d": local_date},
                ).mappings()
            }

            # Both tables emitted a row per seeded route, and no phantom routes.
            assert set(daily) == set(_ROUTES)
            assert set(hourly_sum) == set(_ROUTES)
            # daily == Σ hourly for EVERY band count on EVERY route (the H3 hard bar).
            for route in _ROUTES:
                for band in _BANDS:
                    assert daily[route][band] == hourly_sum[route][band], (
                        f"parity break: route={route} band={band} "
                        f"daily={daily[route][band]} sum_hourly={hourly_sum[route][band]}"
                    )
            # The hourly table has >1 populated hour per route (a real hour-grain).
            hours = connection.execute(
                text(
                    "SELECT route_id, COUNT(*) AS n FROM gold.route_occupancy_band_hourly "
                    "WHERE provider_id = :p AND provider_local_date = :d GROUP BY route_id"
                ),
                {"p": PROVIDER, "d": local_date},
            ).mappings()
            for r in hours:
                assert r["n"] == len(_PER_HOUR_OCCUPANCY), (
                    f"route {r['route_id']} expected {len(_PER_HOUR_OCCUPANCY)} hour rows, "
                    f"got {r['n']}"
                )
            # No hour_of_day_local out of the 0..23 range.
            bad = connection.execute(
                text(
                    "SELECT COUNT(*) FROM gold.route_occupancy_band_hourly "
                    "WHERE provider_id = :p AND (hour_of_day_local < 0 OR hour_of_day_local > 23)"
                ),
                {"p": PROVIDER},
            ).scalar_one()
            assert bad == 0
    finally:
        engine.dispose()
