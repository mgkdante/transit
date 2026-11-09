import pytest
from pydantic import ValidationError

from transit_ops.core.models import ProviderRealtimeConfig
from transit_ops.providers.registry import ProviderRegistry
from transit_ops.snapshots.builders.historic.provenance import build_provenance


@pytest.mark.parametrize(
    "provider,gap,ids,types",
    [
        ("stm", "metro_realtime", [], [1]),
        ("octranspo", "otrain_realtime", ["1-373", "2-354", "4-354"], []),
    ],
)
def test_manifest_and_provenance_share_policy(provider, gap, ids, types):
    registry = ProviderRegistry.from_project_root()
    policy = registry.get_provider(provider).realtime.lines_without_live_data
    assert [(g.gap_id, g.route_ids, g.route_types) for g in policy] == [(gap, ids, types)]

    class EmptyResult:
        def mappings(self):
            return self

        def __iter__(self):
            return iter([])

        def first(self):
            return None

    class Connection:
        def execute(self, *args):
            return EmptyResult()

    assert build_provenance(Connection(), provider_id=provider, generated_utc="t").gaps == [gap]
    assert registry.get_provider("sto").realtime.lines_without_live_data == []


@pytest.mark.parametrize(
    "selector",
    [
        {},
        {"route_ids": [""]},
        {"route_ids": [1]},
        {"route_ids": [" "]},
        {"route_ids": ["1", "1"]},
        {"route_types": [-1]},
        {"route_types": [True]},
        {"route_types": [1, 1]},
        {"route_type": [1]},
    ],
)
def test_invalid_policy_is_rejected(selector):
    with pytest.raises(ValidationError):
        ProviderRealtimeConfig.model_validate(
            {"lines_without_live_data": [{"gap_id": "rail_realtime", **selector}]}
        )


def test_migration_graph_and_reversible_operations(monkeypatch):
    from importlib import import_module

    migration = import_module("transit_ops.db.migrations.versions.0096_provider_live_policy")
    calls = []
    monkeypatch.setattr(migration.op, "execute", calls.append)
    migration.upgrade()
    assert migration.RUNNING_FUNCTION in calls
    calls.clear()
    migration.downgrade()
    assert calls[1] == migration.PREVIOUS_FUNCTION
    assert calls[-1] == "ALTER TABLE core.providers DROP COLUMN lines_without_live_data"


@pytest.mark.parametrize("provider,route", [("stm", "metro-test"), ("octranspo", "1-373")])
def test_health_raises_existing_operations_signal(provider, route):
    from datetime import UTC, datetime

    from transit_ops.health.checks import check_live_policy
    from transit_ops.settings import Settings

    class Result:
        def mappings(self):
            return self

        def all(self):
            return [
                {
                    "provider_id": provider,
                    "route_id": route,
                    "last_seen_at": datetime(2026, 1, 1, tzinfo=UTC),
                }
            ]

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def execute(self, *args):
            return Result()

    class Engine:
        def connect(self):
            return Connection()

    signals = check_live_policy(
        Settings(DATABASE_URL="postgresql://unused/test"), engine_factory=lambda _: Engine()
    )
    assert len(signals) == 1
    assert signals[0].status == "degraded"
    assert provider in signals[0].message and route in signals[0].message
    assert "config is outdated" in signals[0].message
