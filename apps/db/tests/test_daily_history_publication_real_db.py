from datetime import UTC, datetime

import pytest
from snapshot_storage_fixtures import MemorySnapshotStore
from sqlalchemy import text

from transit_ops.settings import Settings
from transit_ops.snapshots import historic_tier, publish

PROVIDER = "daily_publish_gate_test"
DAY = datetime(2026, 8, 30, tzinfo=UTC)


@pytest.fixture()
def engine(real_db_engine, seed_provider):
    with real_db_engine.begin() as connection:
        seed_provider(connection, PROVIDER, display_name="Daily publication gate")
        connection.execute(
            text("""
            INSERT INTO gold.warm_rollup_periods
                (provider_id, rollup_kind, period_start_utc, built_at_utc)
            VALUES (:provider, 'route_delay_spine', :day, :day)
        """),
            {"provider": PROVIDER, "day": DAY},
        )
    try:
        yield real_db_engine
    finally:
        with real_db_engine.begin() as connection:
            for table in (
                "core.snapshot_publish_state",
                "gold.warm_rollup_periods",
                "core.providers",
            ):
                connection.execute(
                    text(f"DELETE FROM {table} WHERE provider_id=:provider"), {"provider": PROVIDER}
                )


class ObservedStore(MemorySnapshotStore):
    def __init__(self):
        super().__init__()
        self.reads = []

    def get_json(self, key):
        self.reads.append(key)
        return super().get_json(key)


@pytest.mark.parametrize("force", [False, True])
@pytest.mark.parametrize("gate_enabled", [False, True])
def test_dirty_daily_history_stops_publication_before_storage_or_build(
    engine, monkeypatch, force, gate_enabled
):
    with engine.begin() as connection:
        connection.execute(
            text("""
            UPDATE gold.warm_rollup_periods SET invalidated_at_utc=clock_timestamp()
            WHERE provider_id=:provider
        """),
            {"provider": PROVIDER},
        )
    store = ObservedStore()
    store.objects["historic/history/index.json"] = b'{"previous":true}'
    original = dict(store.objects)

    def must_not_build(*args, **kwargs):
        pytest.fail("Dirty history reached its publisher")

    monkeypatch.setattr(historic_tier, "publish", must_not_build)
    with pytest.raises(ValueError, match="dirty"):
        publish.publish_snapshot(
            PROVIDER,
            tier="historic",
            settings=Settings(_env_file=None),
            engine=engine,
            storage=store,
            force=force,
            gate_enabled=gate_enabled,
        )
    assert store.reads == []
    assert store.objects == original
    with engine.connect() as connection:
        assert (
            connection.execute(
                text("""
            SELECT count(*) FROM core.snapshot_publish_state WHERE provider_id=:provider
        """),
                {"provider": PROVIDER},
            ).scalar_one()
            == 0
        )


@pytest.mark.parametrize("tier", ["static", "historic"])
def test_publication_uses_one_database_snapshot_across_concurrent_changes(
    engine, monkeypatch, tier
):
    observations = []
    statement = text("""
        SELECT invalidated_at_utc IS NULL FROM gold.warm_rollup_periods WHERE provider_id=:provider
    """)

    def build(connection, storage, **kwargs):
        observations.append(connection.execute(statement, {"provider": PROVIDER}).scalar_one())
        with engine.begin() as writer:
            writer.execute(
                text("""
                UPDATE gold.warm_rollup_periods SET invalidated_at_utc=clock_timestamp()
                WHERE provider_id=:provider
            """),
                {"provider": PROVIDER},
            )
        observations.append(connection.execute(statement, {"provider": PROVIDER}).scalar_one())
        storage.put_json(f"{tier}/proof.json", {"clean_at_snapshot": observations[-1]}, tier=tier)

    if tier == "historic":
        monkeypatch.setattr(historic_tier, "publish", build)
    else:
        monkeypatch.setattr(publish, f"_publish_{tier}", build)
    monkeypatch.setattr(publish, "_static_stamp", lambda *_args: "2026-08-30T00:00:00Z")
    store = MemorySnapshotStore()
    publish.publish_snapshot(
        PROVIDER,
        tier=tier,
        settings=Settings(_env_file=None),
        engine=engine,
        storage=store,
        gate_enabled=False,
    )
    assert observations == [True, True]
    assert store.get_json(f"{tier}/proof.json") == {"clean_at_snapshot": True}
    with engine.connect() as connection:
        assert connection.execute(statement, {"provider": PROVIDER}).scalar_one() is False
