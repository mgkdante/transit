"""Real-database ghost-trip regression tests for capped historic delay stats.

These tests run only against a disposable Postgres database with the full
Transit schema migrated to head:

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://repro@:55432/transit_repro?host=/tmp/i3repro" \
        uv run pytest tests/test_rollups_real_db_regression.py -v

Never point this at production.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine, text

from transit_ops.gold import rollups
from transit_ops.settings import Settings

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set - real-DB regression tests skipped",
)

PROVIDER = "stm_rollup_ghost_test"
ENDPOINT_ID = 991001
TORONTO = ZoneInfo("America/Toronto")


class _NoCommitEngine:
    def __init__(self, connection) -> None:  # noqa: ANN001
        self._connection = connection

    @contextmanager
    def begin(self):  # noqa: ANN201
        yield self._connection


@pytest.fixture()
def conn():
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        # Anchor in the provider timezone (America/Toronto) — the same calendar
        # the percentile rollup's closed-day filter uses (local_date < (now() AT
        # TIME ZONE provider)::date). A UTC-anchored base flakes at the UTC/Toronto
        # date boundary: once real Toronto time crosses midnight, base_local_date
        # (derived from UTC) lags the build's today_local, so the "today" open-day
        # seed rows fall on a day the build already treats as closed. Noon-today
        # local keeps base_local_date == today_local at any wall-clock hour.
        base_utc = (
            datetime.now(TORONTO)
            .replace(hour=12, minute=0, second=0, microsecond=0)
            .astimezone(UTC)
        )
        seed = _SeedData(base_utc)
        _seed(connection, seed)
        _build_rollups(connection)
        try:
            yield connection, seed
        finally:
            transaction.rollback()
        engine.dispose()


class _SeedData:
    def __init__(self, base_utc: datetime) -> None:
        self.base_utc = base_utc
        self.base_local_date = base_utc.astimezone(TORONTO).date()
        self.snapshot_id = 991100
        self.run_id = 992100

    def next_ids(self) -> tuple[int, int]:
        self.snapshot_id += 1
        self.run_id += 1
        return self.snapshot_id, self.run_id


def _seed(connection, seed: _SeedData) -> None:  # noqa: ANN001
    connection.execute(
        text(
            """
            INSERT INTO core.providers (provider_id, display_name, timezone, provider_key)
            VALUES (
                :provider_id,
                'STM capped ghost regression',
                'America/Toronto',
                :provider_id
            )
            """
        ),
        {"provider_id": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO core.feed_endpoints
                (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
            VALUES (
                :endpoint_id,
                :provider_id,
                'trip_updates',
                'trip_updates',
                'gtfs_rt_trip_updates'
            )
            """
        ),
        {"endpoint_id": ENDPOINT_ID, "provider_id": PROVIDER},
    )

    for idx in range(12):
        captured_at = seed.base_utc + timedelta(minutes=idx * 5)
        _insert_snapshot(connection, seed, captured_at, entity_count=6)
        _insert_trip_delay_rows(
            connection,
            seed.snapshot_id,
            captured_at,
            [
                ("G1", "51T", 25622, seed.base_local_date - timedelta(days=2), "S_A"),
                ("L1", "51T", 400, seed.base_local_date, "S_A"),
                ("O1", "51T", 120, seed.base_local_date, "S_A"),
                ("G2", "52T", 25622, seed.base_local_date - timedelta(days=2), "S_B"),
                ("O2", "52T", 120, seed.base_local_date, "S_B"),
            ],
        )

    for day_offset in (1, 2):
        captured_at = seed.base_utc - timedelta(days=day_offset)
        local_date = captured_at.astimezone(TORONTO).date()
        _insert_snapshot(connection, seed, captured_at, entity_count=2)
        _insert_trip_delay_rows(
            connection,
            seed.snapshot_id,
            captured_at,
            [
                ("G1", "51T", 25622, local_date - timedelta(days=2), "S_A"),
                ("L1", "51T", 400, local_date, "S_A"),
            ],
        )


def _insert_snapshot(
    connection,  # noqa: ANN001
    seed: _SeedData,
    captured_at: datetime,
    *,
    entity_count: int,
) -> None:
    snapshot_id, run_id = seed.next_ids()
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs
                (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
            VALUES (:run_id, :provider_id, :endpoint_id, 'trip_updates', 'succeeded')
            """
        ),
        {"run_id": run_id, "provider_id": PROVIDER, "endpoint_id": ENDPOINT_ID},
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.realtime_snapshot_index
                (realtime_snapshot_id, ingestion_run_id, provider_id, feed_endpoint_id,
                 feed_timestamp_utc, entity_count, captured_at_utc)
            VALUES (
                :snapshot_id,
                :run_id,
                :provider_id,
                :endpoint_id,
                :captured_at,
                :entity_count,
                :captured_at
            )
            """
        ),
        {
            "snapshot_id": snapshot_id,
            "run_id": run_id,
            "provider_id": PROVIDER,
            "endpoint_id": ENDPOINT_ID,
            "captured_at": captured_at,
            "entity_count": entity_count,
        },
    )


def _insert_trip_delay_rows(
    connection,  # noqa: ANN001
    snapshot_id: int,
    captured_at: datetime,
    rows: list[tuple[str, str, int, object, str]],
) -> None:
    snapshot_local_date = captured_at.astimezone(TORONTO).date()
    snapshot_date_key = int(snapshot_local_date.strftime("%Y%m%d"))
    for entity_index, (trip_id, route_id, delay_seconds, start_date, stop_id) in enumerate(rows):
        connection.execute(
            text(
                """
                INSERT INTO gold.fact_trip_delay_snapshot
                    (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                     snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
                     trip_id, route_id, direction_id, start_date, vehicle_id,
                     trip_schedule_relationship, delay_seconds, stop_time_update_count,
                     delay_stop_id, delay_stop_sequence)
                VALUES (
                    :provider_id,
                    :snapshot_id,
                    :entity_index,
                    :snapshot_date_key,
                    :snapshot_local_date,
                    :captured_at,
                    :captured_at,
                    :entity_id,
                    :trip_id,
                    :route_id,
                    0,
                    :start_date,
                    NULL,
                    NULL,
                    :delay_seconds,
                    1,
                    :stop_id,
                    :stop_sequence
                )
                """
            ),
            {
                "provider_id": PROVIDER,
                "snapshot_id": snapshot_id,
                "entity_index": entity_index,
                "snapshot_date_key": snapshot_date_key,
                "snapshot_local_date": snapshot_local_date,
                "captured_at": captured_at,
                "entity_id": f"{trip_id}-{snapshot_id}",
                "trip_id": trip_id,
                "route_id": route_id,
                "start_date": start_date,
                "delay_seconds": delay_seconds,
                "stop_id": stop_id,
                "stop_sequence": entity_index + 1,
            },
        )


def _build_rollups(connection) -> None:  # noqa: ANN001
    rollups.build_warm_rollups(
        PROVIDER,
        settings=Settings.model_construct(DATABASE_URL=None),
        engine=_NoCommitEngine(connection),
    )


def _one(connection, sql: str, params: dict[str, object]) -> dict[str, object]:  # noqa: ANN001
    row = connection.execute(text(sql), params).mappings().one()
    return dict(row)


def _scalar(connection, sql: str, params: dict[str, object]) -> object:  # noqa: ANN001
    return connection.execute(text(sql), params).scalar_one()


def _decimal(value: object) -> Decimal:
    assert value is not None
    return Decimal(str(value))


def test_ghost_trip_excluded_from_5m_hourly_and_stop_severe(conn) -> None:  # noqa: ANN001
    connection, seed = conn

    five_minute = _one(
        connection,
        """
        SELECT avg_delay_seconds, avg_delay_seconds_capped, outlier_count,
               max_delay_seconds, max_delay_seconds_capped
        FROM gold.trip_delay_summary_5m
        WHERE provider_id = :provider_id
          AND route_id = '51T'
          AND period_start_utc = :period_start_utc
        """,
        {"provider_id": PROVIDER, "period_start_utc": seed.base_utc},
    )
    assert _decimal(five_minute["avg_delay_seconds"]) > Decimal("1000")
    assert _decimal(five_minute["avg_delay_seconds_capped"]) == Decimal("260.00")
    assert five_minute["outlier_count"] == 1
    assert five_minute["max_delay_seconds"] == 25622
    assert five_minute["max_delay_seconds_capped"] == 400

    outlier_count = _scalar(
        connection,
        """
        SELECT SUM(outlier_count)::integer
        FROM gold.trip_delay_summary_5m
        WHERE provider_id = :provider_id
          AND route_id = '51T'
          AND period_start_utc >= :hour_start
          AND period_start_utc < :hour_end
        """,
        {
            "provider_id": PROVIDER,
            "hour_start": seed.base_utc,
            "hour_end": seed.base_utc + timedelta(hours=1),
        },
    )
    assert outlier_count == 12

    route_51 = _one(
        connection,
        """
        SELECT avg_delay_seconds, max_delay_seconds, severe_delay_count
        FROM gold.route_delay_hourly
        WHERE provider_id = :provider_id
          AND route_id = '51T'
          AND period_start_utc = :period_start_utc
        """,
        {"provider_id": PROVIDER, "period_start_utc": seed.base_utc},
    )
    assert _decimal(route_51["avg_delay_seconds"]) == Decimal("260.00")
    assert route_51["max_delay_seconds"] == 400
    assert route_51["severe_delay_count"] == 12

    route_52 = _one(
        connection,
        """
        SELECT max_delay_seconds
        FROM gold.route_delay_hourly
        WHERE provider_id = :provider_id
          AND route_id = '52T'
          AND period_start_utc = :period_start_utc
        """,
        {"provider_id": PROVIDER, "period_start_utc": seed.base_utc},
    )
    assert route_52["max_delay_seconds"] == 120

    stop_row = _one(
        connection,
        """
        SELECT observation_count, avg_arrival_delay_seconds, severe_delay_count
        FROM gold.stop_delay_hourly
        WHERE provider_id = :provider_id
          AND route_id = '52T'
          AND stop_id = 'S_B'
          AND period_start_utc = :period_start_utc
        """,
        {"provider_id": PROVIDER, "period_start_utc": seed.base_utc},
    )
    assert stop_row["observation_count"] == 12
    assert _decimal(stop_row["avg_arrival_delay_seconds"]) == Decimal("120.00")
    assert stop_row["severe_delay_count"] == 0

    daily = _one(
        connection,
        """
        SELECT affected_stop_count
        FROM gold.citizen_accountability_daily
        WHERE provider_id = :provider_id
          AND provider_local_date = :provider_local_date
        """,
        {"provider_id": PROVIDER, "provider_local_date": seed.base_local_date},
    )
    # Post-0034 per-stop attribution: L1 (delay 400s, severe, attributed to S_A on
    # the base date) makes S_A a genuinely affected stop — the pre-attribution
    # expectation of 0 reflected smear-era seeds, not ghost exclusion. The ghost
    # (base-2d) still contributes nothing to this date.
    assert daily["affected_stop_count"] == 1


def test_ghost_trip_excluded_from_day_of_week_and_repeat_offender(conn) -> None:  # noqa: ANN001
    connection, seed = conn
    day_of_week = seed.base_utc.astimezone(TORONTO).isoweekday()

    dow = _one(
        connection,
        """
        SELECT avg_delay_seconds, severe_delay_count
        FROM gold.route_delay_day_of_week
        WHERE provider_id = :provider_id
          AND route_id = '51T'
          AND day_of_week_iso = :day_of_week
        """,
        {"provider_id": PROVIDER, "day_of_week": day_of_week},
    )
    assert _decimal(dow["avg_delay_seconds"]) == Decimal("260.00")
    assert dow["severe_delay_count"] == 12

    ghost_count = _scalar(
        connection,
        """
        SELECT COUNT(*)
        FROM gold.repeat_offender
        WHERE provider_id = :provider_id
          AND entity_kind = 'trip'
          AND entity_id = 'G1'
        """,
        {"provider_id": PROVIDER},
    )
    assert ghost_count == 0

    late = _one(
        connection,
        """
        SELECT recurrence_days, window_days, avg_delay_seconds
        FROM gold.repeat_offender
        WHERE provider_id = :provider_id
          AND entity_kind = 'trip'
          AND entity_id = 'L1'
          AND route_id = '51T'
        """,
        {"provider_id": PROVIDER},
    )
    assert late["recurrence_days"] == 3
    assert late["window_days"] == 14
    assert _decimal(late["avg_delay_seconds"]) == Decimal("400.0")


def test_percentile_rollup_closed_days_exclude_ghosts_and_today(conn) -> None:  # noqa: ANN001
    connection, seed = conn
    today = seed.base_local_date

    rows = (
        connection.execute(
            text(
                """
                SELECT provider_local_date, p50_delay_seconds, p90_delay_seconds,
                       delay_observation_count
                FROM gold.route_delay_percentile_daily
                WHERE provider_id = :p AND route_id = '51T'
                ORDER BY provider_local_date
                """
            ),
            {"p": PROVIDER},
        )
        .mappings()
        .all()
    )
    dates = {r["provider_local_date"] for r in rows}
    # The open (current) local day is never built; both closed past days are.
    assert today not in dates
    assert today - timedelta(days=1) in dates
    assert today - timedelta(days=2) in dates
    # Ghost (|delay| > 3600) excluded — only the 400s observation survives, so
    # p50 == p90 == 400 over a single observation per closed day.
    for r in rows:
        assert r["delay_observation_count"] == 1
        assert _decimal(r["p50_delay_seconds"]) == Decimal("400.00")
        assert _decimal(r["p90_delay_seconds"]) == Decimal("400.00")

    # Both append-only percentile watermark kinds recorded.
    kinds = {
        k
        for (k,) in connection.execute(
            text(
                "SELECT DISTINCT rollup_kind FROM gold.warm_rollup_periods "
                "WHERE provider_id = :p"
            ),
            {"p": PROVIDER},
        )
    }
    assert {"route_percentile_daily", "stop_percentile_daily"} <= kinds

    # Stop percentile mirrors the closed-day set for the attributed stop.
    stop_dates = {
        r["provider_local_date"]
        for r in connection.execute(
            text(
                "SELECT provider_local_date FROM gold.stop_delay_percentile_daily "
                "WHERE provider_id = :p AND stop_id = 'S_A'"
            ),
            {"p": PROVIDER},
        ).mappings()
    }
    assert stop_dates == {today - timedelta(days=1), today - timedelta(days=2)}


def test_percentile_rollup_is_idempotent_on_rebuild(conn) -> None:  # noqa: ANN001
    connection, _seed = conn
    count_sql = (
        "SELECT count(*) FROM gold.route_delay_percentile_daily WHERE provider_id = :p"
    )
    before = connection.execute(text(count_sql), {"p": PROVIDER}).scalar_one()
    # Re-running skips already-watermarked days (append-only — no duplicate rows).
    rollups.build_warm_rollups(
        PROVIDER,
        settings=Settings.model_construct(DATABASE_URL=None),
        engine=_NoCommitEngine(connection),
    )
    after = connection.execute(text(count_sql), {"p": PROVIDER}).scalar_one()
    assert after == before


def test_granularity_shift_daytype_conserve_observations(conn) -> None:  # noqa: ANN001
    connection, _seed = conn
    hourly_obs = connection.execute(
        text(
            "SELECT COALESCE(SUM(observation_count), 0) FROM gold.route_delay_hourly "
            "WHERE provider_id = :p AND route_id = '51T'"
        ),
        {"p": PROVIDER},
    ).scalar_one()
    assert hourly_obs > 0

    for table, grain_col, vocab in (
        ("route_delay_by_shift", "shift", {"am_peak", "midday", "pm_peak", "evening", "night"}),
        ("route_delay_by_daytype", "day_type", {"weekday", "weekend"}),
    ):
        rows = connection.execute(
            text(
                f"SELECT {grain_col} AS grain, observation_count "
                f"FROM gold.{table} WHERE provider_id = :p AND route_id = '51T'"
            ),
            {"p": PROVIDER},
        ).mappings().all()
        assert rows, f"{table} should have rows for 51T"
        assert all(r["grain"] in vocab for r in rows), f"{table} grain out of vocabulary"
        # Regrouping the hourly spine conserves total observations.
        assert sum(r["observation_count"] for r in rows) == hourly_obs


def test_crosstab_shift_daytype_conserves_and_reconciles(conn) -> None:  # noqa: ANN001
    """Tier-3 2D crosstab: total obs == hourly spine, and each cell reconciles
    with the 1D by_shift marginal (summing the crosstab over day_type)."""
    connection, _seed = conn
    hourly_obs = connection.execute(
        text(
            "SELECT COALESCE(SUM(observation_count), 0) FROM gold.route_delay_hourly "
            "WHERE provider_id = :p AND route_id = '51T'"
        ),
        {"p": PROVIDER},
    ).scalar_one()
    assert hourly_obs > 0

    cells = connection.execute(
        text(
            "SELECT shift, day_type, observation_count "
            "FROM gold.route_delay_by_shift_daytype "
            "WHERE provider_id = :p AND route_id = '51T'"
        ),
        {"p": PROVIDER},
    ).mappings().all()
    assert cells, "crosstab should have rows for 51T"
    shift_vocab = {"am_peak", "midday", "pm_peak", "evening", "night"}
    daytype_vocab = {"weekday", "weekend"}
    assert all(c["shift"] in shift_vocab for c in cells), "shift out of vocabulary"
    assert all(c["day_type"] in daytype_vocab for c in cells), "day_type out of vocabulary"
    # PK uniqueness: at most one cell per (shift, day_type).
    assert len({(c["shift"], c["day_type"]) for c in cells}) == len(cells)
    # Regrouping the hourly spine conserves total observations.
    assert sum(c["observation_count"] for c in cells) == hourly_obs

    # Marginal reconciliation: summing the crosstab over day_type == the 1D
    # by_shift observation_count for that shift (same hourly spine, same CASE).
    by_shift = {
        r["shift"]: r["observation_count"]
        for r in connection.execute(
            text(
                "SELECT shift, observation_count FROM gold.route_delay_by_shift "
                "WHERE provider_id = :p AND route_id = '51T'"
            ),
            {"p": PROVIDER},
        ).mappings()
    }
    crosstab_by_shift: dict[str, int] = {}
    for c in cells:
        crosstab_by_shift[c["shift"]] = (
            crosstab_by_shift.get(c["shift"], 0) + c["observation_count"]
        )
    assert crosstab_by_shift == by_shift


# NOTE: per-direction headway is exercised in test_route_headway_real_db_regression.py
# (test_direction_headway_keeps_both_directions_and_weekends), which seeds trips at
# distinct times so real inter-trip gaps exist — the ghost-trip fixture here inserts
# every trip in every snapshot, so MIN(captured_at) per trip coincides (gap 0) and no
# headway rows are produced.
