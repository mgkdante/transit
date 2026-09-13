from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from snapshot_storage_fixtures import MemorySnapshotStore
from sqlalchemy import text

from transit_ops.settings import Settings
from transit_ops.snapshots import publication_lane, publish

PROVIDER = "publication_lane_test"
OTHER_PROVIDER = "publication_lane_other"


@pytest.fixture()
def engine(real_db_engine, seed_provider):
    with real_db_engine.begin() as connection:
        for provider in (PROVIDER, OTHER_PROVIDER):
            seed_provider(connection, provider, display_name="before")
    try:
        yield real_db_engine
    finally:
        with real_db_engine.begin() as connection:
            for table in ("core.snapshot_publish_state", "core.providers"):
                connection.execute(
                    text(f"DELETE FROM {table} WHERE provider_id IN (:provider, :other)"),
                    {"provider": PROVIDER, "other": OTHER_PROVIDER},
                )


def settings():
    return Settings(_env_file=None, SNAPSHOT_PUBLISH_CONCURRENCY=1)


@pytest.mark.parametrize("fail_first", [False, True])
def test_overlapping_live_publish_stops_before_build_and_releases_lane(
    engine, monkeypatch, fail_first
):
    entered = Event()
    release = Event()
    builds = []

    def build(connection, *, provider_id, **kwargs):
        builds.append(provider_id)
        value = connection.execute(
            text("SELECT display_name FROM core.providers WHERE provider_id=:provider"),
            {"provider": provider_id},
        ).scalar_one()
        return [
            ("live/network.json", {"source": value}, "live"),
            ("manifest.json", {"source": value}, "live"),
        ]

    class PausingStore(MemorySnapshotStore):
        def put_json(self, rel_key, payload, *, tier):
            if not entered.is_set():
                entered.set()
                assert release.wait(5), "first writer was never released"
                if fail_first:
                    raise RuntimeError("first upload failed")
            return super().put_json(rel_key, payload, tier=tier)

    monkeypatch.setattr(publish, "_build_live_items", build)
    store = PausingStore()

    def run(provider=PROVIDER):
        return publish.publish_snapshot(
            provider,
            tier="live",
            settings=settings(),
            engine=engine,
            storage=store,
            gate_enabled=False,
        )

    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(run)
        try:
            assert entered.wait(5), "first writer never reached storage"
            with engine.begin() as connection:
                connection.execute(
                    text(
                        "UPDATE core.providers SET display_name='after' WHERE provider_id=:provider"
                    ),
                    {"provider": PROVIDER},
                )
            with pytest.raises(publish.PublishLockUnavailableError):
                run()
            assert builds == [PROVIDER]
            assert store.objects == {}
        finally:
            release.set()
        if fail_first:
            with pytest.raises(RuntimeError, match="first upload failed"):
                first.result(timeout=5)
        else:
            assert first.result(timeout=5).keys_written == ["live/network.json", "manifest.json"]
            assert store.get_json("manifest.json") == {"source": "before"}

    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT count(*) FROM core.snapshot_publish_state WHERE provider_id=:provider"),
            {"provider": PROVIDER},
        ).scalar_one() == (0 if fail_first else 1)
    run()
    assert store.get_json("live/network.json") == {"source": "after"}
    assert store.get_json("manifest.json") == {"source": "after"}


def test_live_builder_reads_one_snapshot_through_source_correction(engine, monkeypatch):
    reads = []

    def build(connection, *, provider_id, **kwargs):
        statement = text("SELECT display_name FROM core.providers WHERE provider_id=:provider")
        reads.append(connection.execute(statement, {"provider": provider_id}).scalar_one())
        with engine.begin() as writer:
            writer.execute(
                text("UPDATE core.providers SET display_name='after' WHERE provider_id=:provider"),
                {"provider": provider_id},
            )
        reads.append(connection.execute(statement, {"provider": provider_id}).scalar_one())
        return [
            ("live/network.json", {"source": reads[0]}, "live"),
            ("manifest.json", {"source": reads[1]}, "live"),
        ]

    monkeypatch.setattr(publish, "_build_live_items", build)
    store = MemorySnapshotStore()
    publish.publish_snapshot(
        PROVIDER,
        tier="live",
        settings=settings(),
        engine=engine,
        storage=store,
        gate_enabled=False,
    )
    assert reads == ["before", "before"]
    assert store.get_json("manifest.json") == {"source": "before"}
    with engine.connect() as connection:
        assert (
            connection.execute(
                text("SELECT display_name FROM core.providers WHERE provider_id=:provider"),
                {"provider": PROVIDER},
            ).scalar_one()
            == "after"
        )


@pytest.mark.parametrize("end", ["commit", "rollback"])
def test_lanes_isolate_provider_and_tier_and_release_with_transaction(engine, end):
    with engine.connect() as first, engine.connect() as second:
        transaction = first.begin()
        publication_lane.acquire_publication_lane(first, provider_id=PROVIDER, tier="live")
        with second.begin():
            with pytest.raises(publish.PublishLockUnavailableError):
                publication_lane.acquire_publication_lane(second, provider_id=PROVIDER, tier="live")
            for provider, tier in (
                (OTHER_PROVIDER, "live"),
                (PROVIDER, "static"),
                (PROVIDER, "historic"),
            ):
                publication_lane.acquire_publication_lane(second, provider_id=provider, tier=tier)
        getattr(transaction, end)()
        with second.begin():
            publication_lane.acquire_publication_lane(second, provider_id=PROVIDER, tier="live")
