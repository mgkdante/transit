import json
from contextlib import nullcontext
from datetime import timedelta
from importlib import import_module

import pytest
from sqlalchemy import text
from test_running_service_clock_real_db import DAY, _calendar, _edition, _instant, _trip

from transit_ops.health.checks import check_live_policy
from transit_ops.providers.live_policy import record_route_live_observations, sync_live_policy
from transit_ops.providers.registry import ProviderRegistry
from transit_ops.settings import Settings


@pytest.fixture
def conn(real_db_engine):
    with real_db_engine.connect() as connection, connection.begin() as transaction:
        yield connection
        transaction.rollback()


def _running(conn, provider, now):
    return (
        conn.execute(
            text("SELECT trip_id FROM gold.scheduled_running_trips_at(:p,:at)"),
            {"p": provider, "at": now},
        )
        .scalars()
        .all()
    )


@pytest.mark.parametrize(
    "provider,route,route_type",
    [
        ("stm", "metro-test", 1),
        ("octranspo", "1-373", 0),
        ("octranspo", "2-354", 0),
        ("octranspo", "4-354", 0),
    ],
)
@pytest.mark.parametrize("endpoint", ["vehicle_positions", "trip_updates"])
def test_declared_route_promotes_and_signals(
    conn, seed_provider, provider, route, route_type, endpoint
):
    edition = _edition(conn, seed_provider, provider=provider)
    _calendar(conn, edition)
    _trip(conn, edition)
    conn.execute(
        text("UPDATE gold.dim_route SET route_id=:route, route_type=:kind WHERE provider_id=:p"),
        {**edition, "route": route, "kind": route_type},
    )
    conn.execute(
        text("UPDATE gold.trip_service_span SET route_id=:route WHERE provider_id=:p"),
        {**edition, "route": route},
    )
    conn.execute(
        text(
            "INSERT INTO silver.routes (dataset_version_id, provider_id, route_id, route_type) "
            "VALUES (:d,:p,:route,:kind)"
        ),
        {**edition, "route": route, "kind": route_type},
    )
    conn.execute(
        text("UPDATE silver.trips SET route_id=:route WHERE provider_id=:p"),
        {**edition, "route": route},
    )
    manifest = ProviderRegistry.from_project_root().get_provider(provider)
    sync_live_policy(conn, manifest)
    now = _instant(DAY, "12:15:00")
    assert _running(conn, provider, now) == []
    sid = conn.execute(
        text("""
        INSERT INTO silver.rt_feed_snapshots
            (provider_id,feed_endpoint_id,ingestion_run_id,endpoint_key,captured_at_utc)
        VALUES (:p,:e,:run,:endpoint,:at) RETURNING rt_feed_snapshot_id
    """),
        {**edition, "endpoint": endpoint, "at": now},
    ).scalar_one()
    table, timestamp = {
        "vehicle_positions": ("rt_vehicle_positions", "vehicle_timestamp_utc"),
        "trip_updates": ("rt_trip_updates", "trip_update_timestamp_utc"),
    }[endpoint]
    conn.execute(
        text(
            "INSERT INTO silver.rt_entities "
            "(rt_feed_snapshot_id,entity_index,provider_id,entity_kind) "
            "VALUES (:sid,0,:p,:kind)"
        ),
        {
            "sid": sid,
            "p": provider,
            "kind": "vehicle_position" if endpoint == "vehicle_positions" else "trip_update",
        },
    )
    # Missing route_id exercises current static trip-id resolution.
    conn.execute(
        text(f"""
        INSERT INTO silver.{table}
            (provider_id,rt_feed_snapshot_id,entity_index,trip_id,{timestamp},captured_at_utc)
        VALUES (:p,:sid,0,'T',:at,:at)
    """),
        {"p": provider, "sid": sid, "at": now},
    )
    if endpoint == "vehicle_positions":
        conn.execute(
            text(f"UPDATE silver.{table} SET route_id=:route WHERE rt_feed_snapshot_id=:sid"),
            {"sid": sid, "route": route},
        )
    # A future entity timestamp must not promote the route.
    conn.execute(
        text(f"UPDATE silver.{table} SET {timestamp}=:future WHERE rt_feed_snapshot_id=:sid"),
        {"sid": sid, "future": now + timedelta(hours=1)},
    )
    record_route_live_observations(
        conn, provider_id=provider, snapshot_id=sid, endpoint_key=endpoint
    )
    assert _running(conn, provider, now) == []
    conn.execute(
        text(f"UPDATE silver.{table} SET {timestamp}=:at WHERE rt_feed_snapshot_id=:sid"),
        {"sid": sid, "at": now},
    )
    record_route_live_observations(
        conn, provider_id=provider, snapshot_id=sid, endpoint_key=endpoint
    )
    assert _running(conn, provider, now) == ["T"]
    assert _running(conn, provider, now + timedelta(minutes=15)) == ["T"]
    assert _running(conn, provider, now + timedelta(minutes=15, seconds=1)) == []
    assert _running(conn, provider, now - timedelta(seconds=1)) == []

    class Engine:
        def connect(self):
            return nullcontext(conn)

    signals = check_live_policy(
        Settings(DATABASE_URL="postgresql://unused/test"),
        engine_factory=lambda _: Engine(),
        now=now,
    )
    signal = next(s for s in signals if s.details.get("provider_id") == provider)
    assert signal.status == "degraded"
    assert route in signal.message and provider in signal.message and "outdated" in signal.message
    # Removing policy takes effect immediately and clears the warning.
    conn.execute(
        text("UPDATE core.providers SET lines_without_live_data='[]' WHERE provider_id=:p"),
        {"p": provider},
    )
    assert _running(conn, provider, now) == ["T"]


def test_migration_downgrade_upgrade(conn, monkeypatch):
    migration = import_module("transit_ops.db.migrations.versions.0096_provider_live_policy")
    monkeypatch.setattr(migration.op, "execute", conn.exec_driver_sql)
    with conn.begin_nested() as checkpoint:
        migration.downgrade()
        assert (
            conn.exec_driver_sql("SELECT to_regclass('core.route_live_observations')").scalar()
            is None
        )
        with conn.begin_nested() as interrupted:
            migration.upgrade()
            interrupted.rollback()
        migration.upgrade()
        assert conn.exec_driver_sql("SELECT to_regclass('core.route_live_observations')").scalar()
        checkpoint.rollback()


@pytest.mark.parametrize("provider", ["stm", "octranspo"])
def test_undeclared_route_unchanged_and_other_provider_evidence_isolated(
    conn, seed_provider, provider
):
    edition = _edition(conn, seed_provider, provider=provider)
    _calendar(conn, edition)
    _trip(conn, edition)
    now = _instant(DAY, "12:15:00")
    assert _running(conn, provider, now) == ["T"]
    conn.execute(
        text(
            "UPDATE core.providers SET lines_without_live_data=CAST(:policy AS jsonb) "
            "WHERE provider_id=:p"
        ),
        {"p": provider, "policy": json.dumps([{"route_ids": ["R"]}])},
    )
    other = "other_live_policy"
    seed_provider(conn, other, display_name=other)
    conn.execute(
        text("INSERT INTO core.route_live_observations VALUES (:p,'R',:at)"),
        {"p": other, "at": now},
    )
    assert _running(conn, provider, now) == []
