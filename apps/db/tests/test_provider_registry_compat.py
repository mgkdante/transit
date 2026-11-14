import json
from pathlib import Path

import pytest
import yaml

from transit_ops.core.models import ProviderManifest
from transit_ops.providers.registry import ProviderRegistry, load_provider_manifest
from transit_ops.settings import Settings

FIXTURES = Path(__file__).parent / "fixtures" / "providers"


def write_provider(directory, legacy=False, name="fixture_city", **changes):
    source = "fixture_city_legacy.yaml" if legacy else "fixture_city.yaml"
    payload = yaml.safe_load((FIXTURES / source).read_text(encoding="utf-8"))
    if legacy:
        payload["provider"]["provider_id"] = name
    else:
        payload["id"] = name
    payload.update(changes)
    path = directory / f"{name}.yaml"
    path.write_text(yaml.safe_dump(payload), encoding="utf-8")
    return path


def test_registry_loads_a_declaration_beside_an_old_format_file(tmp_path):
    path = write_provider(tmp_path)
    write_provider(tmp_path, legacy=True, name="older")
    registry = ProviderRegistry(tmp_path, Settings(_env_file=None))
    assert registry.list_provider_ids() == ["fixture_city", "older"]
    assert registry.list_active_provider_ids() == []
    actual = registry.get_provider("fixture_city")
    assert isinstance(actual, ProviderManifest)
    assert actual == load_provider_manifest(FIXTURES / "fixture_city_legacy.yaml")
    assert load_provider_manifest(path) == actual
    assert (actual.provider.is_active, actual.public.enabled) == (False, False)
    assert list(actual.feeds) == [
        "static_schedule",
        "trip_updates",
        "vehicle_positions",
        "service_alerts",
    ]


@pytest.mark.parametrize("legacy", [False, True])
@pytest.mark.parametrize("lag", [0, 37])
def test_declared_accessors_read_either_format(tmp_path, monkeypatch, legacy, lag):
    from transit_ops.providers import declared

    gaps = [
        {"gap_id": "rail", "route_ids": ["Z", "A"], "route_types": [2, 1]},
        {"gap_id": "bus", "route_ids": ["9"], "route_types": []},
    ]
    path = write_provider(tmp_path, legacy=legacy)
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if legacy:
        payload["provider"]["live_source_lag_seconds"] = lag
        payload["realtime"] = {"lines_without_live_data": gaps}
    else:
        payload.update(
            live_source_lag_seconds=lag,
            lines_without_live_data=[
                {**g, "labels": {"en": {"short": "Rail"}, "fr": {"short": "Train"}}} for g in gaps
            ],
        )
    path.write_text(yaml.safe_dump(payload), encoding="utf-8")
    monkeypatch.setattr(
        ProviderRegistry,
        "from_project_root",
        classmethod(lambda cls: cls(tmp_path, Settings(_env_file=None))),
    )
    assert declared.reading_population("fixture_city") is None
    assert declared.live_source_lag_seconds("fixture_city") == lag
    assert declared.lines_without_live_data_json("fixture_city") == (
        '[{"gap_id": "rail", "route_ids": ["Z", "A"], "route_types": [2, 1]}, '
        '{"gap_id": "bus", "route_ids": ["9"], "route_types": []}]'
    )


@pytest.mark.parametrize(
    "changes,match",
    [
        ({"declaration": 3}, "declaration"),
        ({"declaration": None}, "declaration"),
        ({"id": "another"}, "id must equal"),
        ({"feeds": "private-payload"}, "feeds"),
        ({"provider": {"credential": "private-payload"}}, "mixed provider formats"),
    ],
)
def test_registry_rejects_mixed_or_invalid_declarations(tmp_path, changes, match):
    path = write_provider(tmp_path, **changes)
    if changes == {"declaration": None}:
        path.write_text(path.read_text().replace("declaration: null\n", ""), encoding="utf-8")
    with pytest.raises(ValueError, match=match) as error:
        load_provider_manifest(path)
    assert "private-payload" not in str(error.value)
    assert path.name in str(error.value)


def test_registry_refuses_duplicates_and_sanitizes_yaml(tmp_path):
    write_provider(tmp_path)
    path = write_provider(tmp_path, legacy=True, name="other")
    path.write_text(path.read_text().replace("provider_id: other", "provider_id: fixture_city"))
    with pytest.raises(ValueError, match="Duplicate provider_id"):
        ProviderRegistry(tmp_path, Settings(_env_file=None))
    path.write_text("id: [private-payload", encoding="utf-8")
    with pytest.raises(ValueError, match="other.yaml: file") as error:
        load_provider_manifest(path)
    assert "private-payload" not in str(error.value)


class RecordingEngine:
    def __init__(self):
        self.params = []

    def begin(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def execute(self, statement, params=None):
        if params is not None:
            self.params.append(params)
        return self

    def scalar_one(self):
        return 1


def test_declaration_keeps_seed_and_show_provider_values(tmp_path, monkeypatch):
    from typer.testing import CliRunner

    from transit_ops import cli

    settings = Settings(_env_file=None)
    engine = RecordingEngine()
    monkeypatch.setattr(cli, "get_settings", lambda: settings)
    monkeypatch.setattr(cli, "make_engine", lambda _: engine)
    monkeypatch.setattr(cli, "_provider_registry", lambda _: ProviderRegistry(tmp_path, settings))
    seeds = []
    for legacy in [True, False]:
        write_provider(tmp_path, legacy=legacy)
        engine.params.clear()
        result = CliRunner().invoke(cli.app, ["seed-core"])
        assert result.exit_code == 0, result.output
        assert "Providers=1, Feed endpoints=1" in result.output
        seeds.append(list(engine.params))
    assert seeds[0] == seeds[1]
    expected = load_provider_manifest(FIXTURES / "fixture_city_legacy.yaml")
    assert seeds[1][0] == expected.to_provider_seed().as_params()
    assert seeds[1][1] == {"provider_id": "fixture_city", "policy": "[]"}
    assert seeds[1][2:] == [s.as_params() for s in expected.to_feed_endpoint_seeds(settings)]
    write_provider(
        tmp_path,
        stage="public",
        reading_population="vehicle_evidence",
        overrides={"bounds": [-81, 41, -72, 49]},
        licence={"name": "Open", "terms_url": "https://example.org/licence", "review": "accepted"},
        map={
            "basemap_url": "map.json",
            "posters_url": "posters.json",
            "basemap_bounds": [-82, 40, -71, 50],
        },
    )
    result = CliRunner().invoke(cli.app, ["show-provider", "fixture_city"])
    assert result.exit_code == 0, result.output
    display = json.loads(result.stdout)
    assert display["provider"]["bounds"] == dict(
        min_longitude=-81, min_latitude=41, max_longitude=-72, max_latitude=49
    )
    assert display["public"]["basemap_url"] == "map.json"
    assert display["public"]["posters_url"] == "posters.json"
    assert display["public"]["basemap_bounds"] == dict(
        min_longitude=-82, min_latitude=40, max_longitude=-71, max_latitude=50
    )
