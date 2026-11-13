import pytest
import yaml
from sqlalchemy import text

from transit_ops.providers.live_policy import sync_live_policy
from transit_ops.providers.registry import ProviderRegistry


@pytest.mark.parametrize("source_id", ["stm", "octranspo", None])
def test_declared_gaps_json_equals_the_stored_jsonb_text(
    real_db_engine, seed_provider, tmp_path, monkeypatch, source_id
):
    from transit_ops.providers import declared

    registry = ProviderRegistry.from_project_root()
    manifest = registry.get_provider(source_id or "stm").model_copy(deep=True)
    provider_id = "declared_gaps"
    manifest.provider.provider_id = provider_id
    payload = manifest.model_dump(mode="json")
    if source_id is None:
        payload["realtime"]["lines_without_live_data"] = [
            {"gap_id": "rail_realtime", "route_ids": ["É1", "A1"], "route_types": [1, 0]},
            {"gap_id": "bus_realtime", "route_ids": ["Z2"], "route_types": []},
        ]
    (tmp_path / "provider.yaml").write_text(yaml.safe_dump(payload), encoding="utf-8")
    temporary_registry = ProviderRegistry(tmp_path)
    monkeypatch.setattr(declared.ProviderRegistry, "from_project_root", lambda: temporary_registry)
    with real_db_engine.connect() as connection, connection.begin() as transaction:
        seed_provider(connection, provider_id, display_name="Declared gaps test")
        sync_live_policy(connection, temporary_registry.get_provider(provider_id))
        stored = connection.execute(
            text(
                "SELECT lines_without_live_data::text FROM core.providers WHERE provider_id = :id"
            ),
            {"id": provider_id},
        ).scalar_one()
        assert stored == declared.lines_without_live_data_json(provider_id)
        transaction.rollback()
