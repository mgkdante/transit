from datetime import datetime

import pytest
import revision_2_seed as seed
from snapshot_storage_fixtures import MemorySnapshotStore

from transit_ops import settings as settings_module
from transit_ops.gold import rollups
from transit_ops.snapshots import builders, historic_tier, publish
from transit_ops.snapshots.builders.historic import (
    line_history,
    network_history,
    network_trend,
    provenance,
    stop_history,
)

STAMP = "2025-09-02T00:00:00Z"
SURFACES = (
    builders.build_network_trend,
    builders.build_hotspots_history_plan,
    builders.build_repeat_offenders_history_plan,
    builders.build_all_route_reliability,
    builders.build_route_reliability,
    builders.build_stop_reliability,
    builders.build_alert_history,
    builders.build_provenance,
)


def _kwargs(build, provider_id):
    kwargs = {"provider_id": provider_id}
    if not build.__name__.endswith("_plan"):
        kwargs["generated_utc"] = STAMP
    if build is builders.build_route_reliability:
        kwargs["route_id"] = seed.ROUTES[0][0]
    return kwargs


@pytest.mark.parametrize("build", SURFACES, ids=lambda build: build.__name__)
def test_surface_refuses_naive_stamp_before_reading(build):
    with pytest.raises(ValueError, match="aware"):
        build(None, **_kwargs(build, "test"), as_of_utc=datetime(2025, 9, 2))


@pytest.fixture
def seeded(real_db_engine, tmp_path, monkeypatch):
    settings = seed.settings_for(tmp_path)
    monkeypatch.setattr(rollups, "PERCENTILE_LOOKBACK_DAYS", seed.RETENTION_DAYS - 1)
    for module in (line_history, network_history, network_trend, provenance, stop_history):
        monkeypatch.setattr(module, "get_settings", lambda: settings)
    monkeypatch.setattr(settings_module, "get_settings", lambda: settings)
    seed.delete_rows(real_db_engine)
    try:
        seed.seed_history(real_db_engine, settings, tmp_path)
        with seed.pinned_engine(real_db_engine, seed.HISTORY_CLOCK) as pinned:
            yield real_db_engine, pinned, settings
    finally:
        seed.delete_rows(real_db_engine)


def _materialize(value):
    if hasattr(value, "iter_days"):
        return list(value.iter_days())
    return value


def test_every_surface_builder_uses_the_stamp(seeded):
    engine, pinned, _settings = seeded
    for provider_id in seed.PROVIDERS.values():
        for build in SURFACES:
            kwargs = _kwargs(build, provider_id)
            with pinned.connect() as conn:
                expected = _materialize(build(conn, **kwargs))
            with engine.connect() as conn:
                actual = _materialize(build(conn, **kwargs, as_of_utc=seed.HISTORY_CLOCK))
            assert actual == expected, (provider_id, build.__name__)


def test_explicit_stamp_publishes_the_pinned_bytes(seeded, monkeypatch):
    engine, pinned, settings = seeded
    for module in (publish, historic_tier):
        monkeypatch.setattr(module, "utc_now", lambda: seed.HISTORY_CLOCK)
    for provider_id in seed.PROVIDERS.values():
        stores = []
        for source, kwargs in ((pinned, {}), (engine, {"as_of_utc": seed.HISTORY_CLOCK})):
            store = MemorySnapshotStore()
            with source.begin() as conn:
                historic_tier.publish(
                    conn, store, provider_id=provider_id, settings=settings, force=True, **kwargs
                )
            stores.append(store.objects)
        assert stores[0]
        assert "provenance.json" in stores[0]
        assert stores[1] == stores[0]
