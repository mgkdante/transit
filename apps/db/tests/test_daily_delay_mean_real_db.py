from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from importlib import import_module
from zoneinfo import ZoneInfo

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Connection, event, text

from transit_ops.gold import delay_sums, rollups
from transit_ops.snapshots.builders.historic.route_reliability import _route_periods
from transit_ops.snapshots.builders.historic.small_surfaces import _RECEIPTS_WORST_ROUTE_SQL

PROVIDER = "daily_mean_regression"
CAPTURED = datetime(2026, 9, 4, 12, tzinfo=UTC)


@pytest.fixture
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection, connection.begin() as transaction:
        seed_provider(connection, PROVIDER, display_name="Daily mean regression")
        try:
            yield connection
        finally:
            transaction.rollback()


def seed_delays(
    conn: Connection,
    delays: list[int | None],
    captured: datetime = CAPTURED,
    *,
    route_id: str = "51",
    feed_at: datetime | None = None,
) -> None:
    feed_at = feed_at or captured
    local_date = feed_at.astimezone(ZoneInfo("America/Toronto")).date()
    endpoint = conn.execute(
        text("""
            INSERT INTO core.feed_endpoints
                (provider_id, endpoint_key, feed_kind, source_format)
            VALUES (:provider, :key, 'trip_updates', 'gtfs_rt_trip_updates')
            RETURNING feed_endpoint_id
        """),
        {"provider": PROVIDER, "key": f"trip_updates_{captured.isoformat()}_{route_id}"},
    ).scalar_one()
    run = conn.execute(
        text("""
            INSERT INTO raw.ingestion_runs
                (provider_id, feed_endpoint_id, run_kind, status)
            VALUES (:provider, :endpoint, 'trip_updates', 'succeeded')
            RETURNING ingestion_run_id
        """),
        {"provider": PROVIDER, "endpoint": endpoint},
    ).scalar_one()
    snapshot = conn.execute(
        text("""
            INSERT INTO raw.realtime_snapshot_index
                (provider_id, feed_endpoint_id, ingestion_run_id, feed_timestamp_utc,
                 captured_at_utc, entity_count)
            VALUES (:provider, :endpoint, :run, :feed, :captured, :count)
            RETURNING realtime_snapshot_id
        """),
        {
            "provider": PROVIDER,
            "endpoint": endpoint,
            "run": run,
            "feed": feed_at,
            "captured": captured,
            "count": len(delays),
        },
    ).scalar_one()
    conn.execute(
        text("""
            INSERT INTO gold.fact_trip_delay_snapshot
                (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                 snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
                 trip_id, route_id, direction_id, start_date, vehicle_id,
                 trip_schedule_relationship, delay_seconds, stop_time_update_count)
            SELECT :provider, :snapshot, i, :date_key, :local_date, :feed, :captured,
                   i::text, i::text, :route, 0, :local_date, i::text, 0, delay, 1
            FROM unnest(CAST(:delays AS integer[])) WITH ORDINALITY AS f(delay, i)
        """),
        {
            "provider": PROVIDER,
            "snapshot": snapshot,
            "date_key": int(local_date.strftime("%Y%m%d")),
            "local_date": local_date,
            "feed": feed_at,
            "captured": captured,
            "route": route_id,
            "delays": delays,
        },
    )
    conn.execute(
        rollups.UPSERT_TRIP_DELAY_SUMMARY_5M,
        {
            "provider_id": PROVIDER,
            "period_start_utc": captured,
            "built_at_utc": captured,
        },
    )


def daily_rows(conn: Connection, now: datetime = CAPTURED + timedelta(hours=2)):
    conn.execute(
        rollups.UPSERT_ROUTE_DELAY_HOURLY,
        {
            "provider_id": PROVIDER,
            "built_at_utc": now,
            "open_window_days": 10,
        },
    )
    return (
        conn.execute(
            text("""
        SELECT * FROM gold.public_route_reliability_daily
        WHERE provider_id = :provider ORDER BY provider_local_date, route_id
    """),
            {"provider": PROVIDER},
        )
        .mappings()
        .all()
    )


@pytest.mark.parametrize(
    ("groups", "expected"),
    [
        ([[60] + [7200] * 100, [600]], Decimal("330.00")),
        ([[1] + [0] * 100, [0] * 100], Decimal("0.00")),
        ([[-1] + [0] * 100, [0] * 100], Decimal("0.00")),
        ([[1], [0] * 199], Decimal("0.01")),
        ([[-1], [0] * 199], Decimal("-0.01")),
        ([[-3600, 3600, -3601, 3601, None], [60]], Decimal("20.00")),
        ([[None, 7200], [600]], Decimal("600.00")),
        ([[None], [None]], None),
        ([[7200], [-7200]], None),
    ],
)
def test_daily_mean_pools_exact_usable_observations(conn, groups, expected):
    for hour, delays in enumerate(groups):
        seed_delays(conn, delays, CAPTURED + timedelta(hours=hour))
    row = daily_rows(conn)[0]
    observations = [value for group in groups for value in group]
    usable = [value for value in observations if value is not None and abs(value) <= 3600]
    average = row["avg_delay_seconds"]
    if expected is None:
        assert average is None
    else:
        assert average.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) == expected
        assert average == pytest.approx(
            Decimal(sum(usable)) / len(usable),
            rel=Decimal("1e-15"),
            abs=Decimal("1e-15"),
        )
    assert row["stop_time_observation_count"] == len(observations)
    assert row["delay_observation_count"] == sum(value is not None for value in observations)
    assert row["on_time_observation_count"] == sum(
        value is not None and -60 <= value < 300 for value in observations
    )


def test_daily_mean_keeps_partial_capture_day_and_provider_clock(conn):
    captured = datetime(2026, 9, 5, 4, tzinfo=UTC)
    seed_delays(conn, [120], captured, feed_at=captured - timedelta(seconds=30))
    rows = daily_rows(conn, captured + timedelta(minutes=5))
    assert [(row["provider_local_date"], row["avg_delay_seconds"]) for row in rows] == [
        (date(2026, 9, 5), Decimal("120.00")),
    ]


def seed_legacy_hour(conn: Connection, *, route_id: str = "legacy", known: int = 10):
    conn.execute(
        text("""
        INSERT INTO gold.route_delay_hourly
            (provider_id, period_start_utc, route_id, trip_count, observation_count,
             delay_observation_count, on_time_observation_count, avg_delay_seconds,
             max_delay_seconds, delayed_trip_count, severe_delay_count, built_at_utc)
        VALUES (:provider, :captured, :route, :known, :known, :known,
                0, 600, 600, :known, :known, :captured)
    """),
        {"provider": PROVIDER, "captured": CAPTURED, "route": route_id, "known": known},
    )


def test_retained_hourly_history_preserves_rows_and_counters_with_unknown_mean(conn):
    seed_legacy_hour(conn)
    row = (
        conn.execute(
            text("""
        SELECT * FROM gold.public_route_reliability_daily WHERE provider_id = :provider
    """),
            {"provider": PROVIDER},
        )
        .mappings()
        .one()
    )
    assert row["provider_local_date"] == date(2026, 9, 4)
    assert row["delay_observation_count"] == 10
    assert row["avg_delay_seconds"] is None
    assert conn.execute(
        text("""
        SELECT avg_delay_seconds FROM gold.route_delay_hourly WHERE provider_id = :provider
    """),
        {"provider": PROVIDER},
    ).scalar_one() == Decimal("600.00")


def test_receipt_does_not_rank_an_incomplete_route_comparison(conn):
    seed_delays(conn, [120])
    daily_rows(conn)
    seed_legacy_hour(conn)
    assert (
        conn.execute(
            _RECEIPTS_WORST_ROUTE_SQL,
            {
                "provider_id": PROVIDER,
                "receipt_start": date(2026, 9, 4),
                "receipt_end": date(2026, 9, 4),
            },
        ).all()
        == []
    )


class TransactionEngine:
    def __init__(self, conn):
        self.conn = conn

    @contextmanager
    def begin(self):
        yield self.conn


def recover(conn, *, dry_run=False, start=CAPTURED, end=CAPTURED + timedelta(hours=2)):
    return delay_sums.recover_delay_sums(
        PROVIDER,
        engine=TransactionEngine(conn),
        from_utc=start,
        until_utc=end,
        dry_run=dry_run,
    )


def remove_exact_state(conn):
    conn.execute(
        text("""
        UPDATE gold.trip_delay_summary_5m SET usable_delay_sum_seconds = NULL
        WHERE provider_id = :provider
    """),
        {"provider": PROVIDER},
    )
    conn.execute(
        text("""
        UPDATE gold.route_delay_hourly
        SET usable_delay_sum_seconds = NULL, usable_delay_observation_count = NULL
        WHERE provider_id = :provider
    """),
        {"provider": PROVIDER},
    )
    conn.execute(
        text("""
        INSERT INTO gold.warm_rollup_periods
            (provider_id, rollup_kind, period_start_utc, built_at_utc)
        SELECT DISTINCT provider_id, 'trip_delay_summary_5m', period_start_utc, :built
        FROM gold.trip_delay_summary_5m WHERE provider_id = :provider
    """),
        {"provider": PROVIDER, "built": CAPTURED},
    )


def retained_metrics(conn):
    return conn.execute(
        text("""
        SELECT grain, fields FROM (
        SELECT 'five_minute' AS grain,
               to_jsonb(b) - 'usable_delay_sum_seconds' AS fields
        FROM gold.trip_delay_summary_5m AS b WHERE provider_id = :provider
        UNION ALL
        SELECT 'hourly',
               to_jsonb(h) - 'usable_delay_sum_seconds' - 'usable_delay_observation_count'
        FROM gold.route_delay_hourly AS h WHERE provider_id = :provider
        UNION ALL
        SELECT 'watermark', to_jsonb(w)
        FROM gold.warm_rollup_periods AS w WHERE provider_id = :provider
        ) AS retained ORDER BY grain, fields::text
    """),
        {"provider": PROVIDER},
    ).all()


def test_recovery_previews_then_fills_exact_sums_without_rebuilding_history(conn):
    seed_delays(conn, [60] + [7200] * 100)
    seed_delays(conn, [600], CAPTURED + timedelta(hours=1))
    daily_rows(conn)
    remove_exact_state(conn)
    original = retained_metrics(conn)
    preview = recover(conn, dry_run=True)
    assert preview.recoverable == {"five_minute": 2, "hourly": 2}
    assert preview.recovered == {"five_minute": 0, "hourly": 0}
    assert (
        conn.execute(
            text("""
        SELECT avg_delay_seconds FROM gold.public_route_reliability_daily WHERE provider_id = :p
    """),
            {"p": PROVIDER},
        ).scalar_one()
        is None
    )
    result = recover(conn)
    assert result.recovered == preview.recoverable
    assert result.unknown == {"five_minute": 0, "hourly": 0}
    assert retained_metrics(conn) == original
    assert conn.execute(
        text("""
        SELECT avg_delay_seconds FROM gold.public_route_reliability_daily WHERE provider_id = :p
    """),
        {"p": PROVIDER},
    ).scalar_one() == Decimal("330.00")
    assert recover(conn).hours == 0


@pytest.mark.parametrize(
    "damage", ["partial_facts", "missing_facts", "changed_counter", "missing_bucket"]
)
def test_recovery_does_not_invent_unrecoverable_history(conn, damage):
    seed_delays(conn, [60, 120])
    seed_delays(conn, [180], CAPTURED + timedelta(minutes=5))
    daily_rows(conn)
    remove_exact_state(conn)
    if damage == "partial_facts":
        conn.execute(
            text(
                "DELETE FROM gold.fact_trip_delay_snapshot "
                "WHERE provider_id = :p AND delay_seconds = 60"
            ),
            {"p": PROVIDER},
        )
    elif damage == "missing_facts":
        conn.execute(
            text("DELETE FROM gold.fact_trip_delay_snapshot WHERE provider_id = :p"),
            {"p": PROVIDER},
        )
    elif damage == "changed_counter":
        conn.execute(
            text(
                "UPDATE gold.trip_delay_summary_5m SET trip_count = trip_count + 1 "
                "WHERE provider_id = :p"
            ),
            {"p": PROVIDER},
        )
    else:
        conn.execute(
            text(
                "DELETE FROM gold.trip_delay_summary_5m "
                "WHERE provider_id = :p AND period_start_utc = :at"
            ),
            {"p": PROVIDER, "at": CAPTURED},
        )
    original = retained_metrics(conn)
    result = recover(conn)
    assert result.unknown["hourly"] == 1
    assert result.recovered["hourly"] == 0
    assert retained_metrics(conn) == original


def test_zero_usable_history_needs_no_fact_replay_and_does_not_block_ranking(conn):
    seed_delays(conn, [None, 7200], route_id="empty")
    seed_delays(conn, [120])
    daily_rows(conn)
    remove_exact_state(conn)
    conn.execute(
        text(
            "DELETE FROM gold.fact_trip_delay_snapshot "
            "WHERE provider_id = :p AND route_id = 'empty'"
        ),
        {"p": PROVIDER},
    )
    result = recover(conn)
    assert result.recovered == {"five_minute": 2, "hourly": 2}
    rows = (
        conn.execute(
            _RECEIPTS_WORST_ROUTE_SQL,
            {
                "provider_id": PROVIDER,
                "receipt_start": CAPTURED.date(),
                "receipt_end": CAPTURED.date(),
            },
        )
        .mappings()
        .all()
    )
    assert [row["route_id"] for row in rows] == ["51"]


@pytest.mark.parametrize("preserve_count", [False, True])
def test_recovery_rejects_changed_source_distributions(conn, preserve_count):
    before = [-240, 240, -7200] if preserve_count else [60, 120, 240]
    after = [-120, 240, -120] if preserve_count else [60, 180, 240]
    seed_delays(conn, before)
    daily_rows(conn)
    known_count = conn.execute(
        text("""
        SELECT usable_delay_observation_count FROM gold.route_delay_hourly WHERE provider_id = :p
    """),
        {"p": PROVIDER},
    ).scalar_one()
    remove_exact_state(conn)
    if preserve_count:
        conn.execute(
            text("""
            UPDATE gold.route_delay_hourly SET usable_delay_observation_count = :count
            WHERE provider_id = :p
        """),
            {"p": PROVIDER, "count": known_count},
        )
    conn.execute(
        text("""
        UPDATE gold.fact_trip_delay_snapshot AS f SET delay_seconds = source.delay
        FROM unnest(CAST(:delays AS integer[])) WITH ORDINALITY AS source(delay, i)
        WHERE f.provider_id = :p AND f.entity_index = source.i
    """),
        {"p": PROVIDER, "delays": after},
    )
    conn.execute(
        rollups.UPSERT_TRIP_DELAY_SUMMARY_5M,
        {
            "provider_id": PROVIDER,
            "period_start_utc": CAPTURED,
            "built_at_utc": CAPTURED,
        },
    )
    result = recover(conn)
    assert result.recovered["hourly"] == 0
    assert result.unknown["hourly"] == 1
    assert (
        conn.execute(
            text("""
        SELECT usable_delay_sum_seconds FROM gold.route_delay_hourly WHERE provider_id = :p
    """),
            {"p": PROVIDER},
        ).scalar_one()
        is None
    )


def test_recovery_skips_target_changed_after_proposal(conn):
    seed_delays(conn, [60, 120])
    daily_rows(conn)
    remove_exact_state(conn)
    proposal = next(
        row
        for row in conn.execute(
            delay_sums._RECOVERABLE_SUMS,
            {
                "provider_id": PROVIDER,
                "hour": CAPTURED,
            },
        ).mappings()
        if row["grain"] == "hourly"
    )
    conn.execute(
        text("""
        UPDATE gold.route_delay_hourly SET observation_count = observation_count + 1
        WHERE provider_id = :p
    """),
        {"p": PROVIDER},
    )
    written = conn.execute(
        delay_sums._UPDATE_SUMS["hourly"],
        {
            **proposal,
            "provider_id": PROVIDER,
        },
    ).rowcount
    assert written == 0


def test_recovery_includes_retained_hours_outside_normal_refresh_window(conn):
    old = CAPTURED - timedelta(days=60)
    seed_delays(conn, [60, 120], old)
    daily_rows(conn, old + timedelta(hours=1))
    remove_exact_state(conn)
    assert recover(conn).hours == 0
    result = recover(conn, start=old, end=old + timedelta(hours=1))
    assert result.recovered == {"five_minute": 1, "hourly": 1}


@pytest.mark.parametrize(
    "start",
    [
        CAPTURED.replace(tzinfo=None),
        CAPTURED + timedelta(minutes=1),
        CAPTURED.replace(tzinfo=timezone(timedelta(hours=5, minutes=30))),
    ],
)
def test_recovery_rejects_partial_utc_hour_bounds(start):
    with pytest.raises(ValueError, match="whole UTC hours"):
        delay_sums.recover_delay_sums(
            PROVIDER, from_utc=start, until_utc=CAPTURED + timedelta(days=1)
        )


def test_daily_mean_does_not_ignore_an_unknown_contributing_hour(conn):
    seed_delays(conn, [120], CAPTURED + timedelta(hours=1))
    daily_rows(conn)
    seed_legacy_hour(conn, route_id="51")
    row = conn.execute(
        text("""
        SELECT avg_delay_seconds, delay_observation_count
        FROM gold.public_route_reliability_daily WHERE provider_id = :p
    """),
        {"p": PROVIDER},
    ).one()
    assert row == (None, 11)


def test_receipt_ranking_uses_exact_means_before_display_rounding(conn):
    seed_delays(conn, [3] * 499 + [2], route_id="a")
    seed_delays(conn, [3] * 999 + [2], route_id="b")
    daily_rows(conn)
    winner = (
        conn.execute(
            _RECEIPTS_WORST_ROUTE_SQL,
            {
                "provider_id": PROVIDER,
                "receipt_start": CAPTURED.date(),
                "receipt_end": CAPTURED.date(),
            },
        )
        .mappings()
        .one()
    )
    assert winner["route_id"] == "b"
    assert winner["avg_delay_seconds"] == Decimal("2.999")


@pytest.mark.parametrize("same_route", [False, True])
def test_legacy_default_zero_is_not_proof_of_an_empty_hour(conn, same_route):
    seed_delays(conn, [120], CAPTURED + timedelta(hours=1))
    daily_rows(conn)
    legacy_route = "51" if same_route else "legacy"
    seed_legacy_hour(conn, route_id=legacy_route, known=0)
    conn.execute(
        text("""
        UPDATE gold.route_delay_hourly
        SET observation_count = 10, trip_count = 10, on_time_observation_count = NULL
        WHERE provider_id = :p AND route_id = :route AND period_start_utc = :at
    """),
        {"p": PROVIDER, "route": legacy_route, "at": CAPTURED},
    )
    original = retained_metrics(conn)
    result = recover(conn)
    assert result.recovered["hourly"] == 0
    assert result.unknown["hourly"] == 1
    assert retained_metrics(conn) == original
    assert (
        conn.execute(
            text("""
        SELECT avg_delay_seconds FROM gold.public_route_reliability_daily
        WHERE provider_id = :p AND route_id = :route
    """),
            {"p": PROVIDER, "route": legacy_route},
        ).scalar_one()
        is None
    )
    assert (
        conn.execute(
            _RECEIPTS_WORST_ROUTE_SQL,
            {
                "provider_id": PROVIDER,
                "receipt_start": CAPTURED.date(),
                "receipt_end": CAPTURED.date(),
            },
        ).all()
        == []
    )


def test_coherently_empty_legacy_hour_can_contribute_zero(conn):
    seed_delays(conn, [120], CAPTURED + timedelta(hours=1))
    daily_rows(conn)
    seed_legacy_hour(conn, route_id="51", known=0)
    conn.execute(
        text("""
        UPDATE gold.route_delay_hourly SET avg_delay_seconds = NULL, max_delay_seconds = NULL
        WHERE provider_id = :p AND period_start_utc = :at
    """),
        {"p": PROVIDER, "at": CAPTURED},
    )
    assert recover(conn).recovered["hourly"] == 1
    assert conn.execute(
        text("""
        SELECT avg_delay_seconds FROM gold.public_route_reliability_daily WHERE provider_id = :p
    """),
        {"p": PROVIDER},
    ).scalar_one() == Decimal("120")


@pytest.mark.parametrize("sign", [-1, 1])
@pytest.mark.parametrize("offset", [-1, 0, 1])
def test_daily_and_spine_publication_round_once_at_minute_boundary(conn, sign, offset):
    seed_delays(conn, [3 * sign] * 249 + [(3 + offset) * sign])
    daily_rows(conn)
    conn.execute(
        rollups.UPSERT_ROUTE_DELAY_SPINE,
        {
            "provider_id": PROVIDER,
            "date_key": 20260904,
            "local_date": CAPTURED.date(),
            "built_at_utc": CAPTURED + timedelta(days=1),
        },
    )
    periods = _route_periods(conn, {"provider_id": PROVIDER, "route_id": "51"})
    expected = 0.0 if offset < 0 else 0.1 * sign
    by_grain = {
        row.grain: row.avg_delay_min for row in periods if row.grain in {"day", "week", "month"}
    }
    assert by_grain == {"day": expected, "week": expected, "month": expected}


@pytest.mark.parametrize(
    "captured",
    [
        datetime(2026, 3, 8, 6, tzinfo=UTC),
        datetime(2026, 11, 1, 5, tzinfo=UTC),
    ],
)
def test_daily_mean_preserves_dst_capture_day_population(conn, captured):
    seed_delays(conn, [60], captured)
    seed_delays(conn, [600], captured + timedelta(hours=1))
    rows = daily_rows(conn, captured + timedelta(hours=2))
    assert [(row["provider_local_date"], row["avg_delay_seconds"]) for row in rows] == [
        (captured.astimezone(ZoneInfo("America/Toronto")).date(), Decimal("330.00")),
    ]


def test_recovery_corrects_double_rounding_while_preserving_legacy_mean(conn):
    seed_delays(conn, [1] + [0] * 100)
    seed_delays(conn, [0] * 100, CAPTURED + timedelta(minutes=5))
    daily_rows(conn)
    remove_exact_state(conn)
    original = retained_metrics(conn)
    assert recover(conn).recovered == {"five_minute": 2, "hourly": 1}
    assert retained_metrics(conn) == original
    assert conn.execute(
        text("""
        SELECT avg_delay_seconds FROM gold.public_route_reliability_daily WHERE provider_id = :p
    """),
        {"p": PROVIDER},
    ).scalar_one() == pytest.approx(Decimal(1) / 201)
    assert conn.execute(
        text("""
        SELECT avg_delay_seconds FROM gold.route_delay_hourly WHERE provider_id = :p
    """),
        {"p": PROVIDER},
    ).scalar_one() == Decimal("0.01")


def test_migration_round_trip_preserves_daily_contract_and_retained_rows(conn):
    seed_delays(conn, [60] + [7200] * 100)
    seed_delays(conn, [600], CAPTURED + timedelta(hours=1))
    daily_rows(conn)
    original = retained_metrics(conn)
    columns = text("""
        SELECT column_name, data_type, ordinal_position FROM information_schema.columns
        WHERE table_schema = 'gold' AND table_name = 'public_route_reliability_daily'
        ORDER BY ordinal_position
    """)
    contract = conn.execute(columns).all()
    assert len(contract) == 8
    migration = import_module("transit_ops.db.migrations.versions.0087_exact_daily_delay_means")
    with Operations.context(MigrationContext.configure(conn)):
        migration.downgrade()
        assert conn.execute(
            text("""
            SELECT avg_delay_seconds FROM gold.public_route_reliability_daily WHERE provider_id = :p
        """),
            {"p": PROVIDER},
        ).scalar_one() == Decimal("65.29")
        migration.upgrade()
    assert conn.execute(columns).all() == contract
    assert retained_metrics(conn) == original
    assert recover(conn).recovered == {"five_minute": 2, "hourly": 2}


def test_recovery_commits_completed_hours_before_interruption(real_db_engine, seed_provider):
    def interrupt_second_hour(conn, clause, multiparams, params, options):
        if clause is delay_sums._RECOVERABLE_SUMS and params["hour"] > CAPTURED:
            raise RuntimeError("simulated interruption")

    try:
        with real_db_engine.begin() as connection:
            seed_provider(connection, PROVIDER, display_name="Recovery interruption")
            seed_delays(connection, [60])
            seed_delays(connection, [600], CAPTURED + timedelta(hours=1))
            daily_rows(connection)
            remove_exact_state(connection)
        event.listen(real_db_engine, "before_execute", interrupt_second_hour)
        try:
            with pytest.raises(RuntimeError, match="simulated interruption"):
                delay_sums.recover_delay_sums(
                    PROVIDER,
                    from_utc=CAPTURED,
                    until_utc=CAPTURED + timedelta(hours=2),
                    engine=real_db_engine,
                    dry_run=False,
                )
        finally:
            event.remove(real_db_engine, "before_execute", interrupt_second_hour)
        with real_db_engine.connect() as connection:
            assert connection.execute(
                text("""
                SELECT usable_delay_sum_seconds FROM gold.route_delay_hourly
                WHERE provider_id = :p ORDER BY period_start_utc
            """),
                {"p": PROVIDER},
            ).scalars().all() == [60, None]
        result = delay_sums.recover_delay_sums(
            PROVIDER,
            from_utc=CAPTURED,
            until_utc=CAPTURED + timedelta(hours=2),
            engine=real_db_engine,
            dry_run=False,
        )
        assert result.hours == 1
        assert result.recovered == {"five_minute": 1, "hourly": 1}
    finally:
        with real_db_engine.begin() as connection:
            for table in (
                "gold.fact_trip_delay_snapshot",
                "gold.trip_delay_summary_5m",
                "gold.route_delay_hourly",
                "gold.warm_rollup_periods",
                "raw.realtime_snapshot_index",
                "raw.ingestion_runs",
                "core.feed_endpoints",
                "core.providers",
            ):
                connection.execute(
                    text(f"DELETE FROM {table} WHERE provider_id = :p"), {"p": PROVIDER}
                )
