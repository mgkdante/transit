import json
import os
from pathlib import Path

import pytest

from transit_ops.providers.live_policy import sync_live_policy
from transit_ops.providers.registry import ProviderRegistry
from transit_ops.settings import Settings
from transit_ops.snapshots.providers import build_public_provider_catalog, provider_object_key
from transit_ops.snapshots.storage import LocalSnapshotStorage

GOLDEN_PATH = Path(__file__).parent / "fixtures" / "provider_baseline" / "golden.json"
PROVIDER_DIR = Path(__file__).parents[1] / "config" / "providers"
DISPLAY_KEYS = {
    "provider": ("provider_id", "is_active", "bounds", "website_url"),
    "public": (
        "enabled",
        "labels",
        "basemap_url",
        "basemap_bounds",
        "posters_url",
        "fit_bounds",
        "max_bounds",
    ),
}


class RecordingConnection:
    def __init__(self):
        self.params = []

    def execute(self, statement, params):
        self.params.append(params)


def _catalogue_entries(registry, settings):
    storage = LocalSnapshotStorage(settings.SNAPSHOT_LOCAL_ROOT, "v1")
    public_ids = []
    for provider_id in registry.list_provider_ids():
        config = registry.get_provider(provider_id)
        if not config.public.enabled:
            continue
        public_ids.append(provider_id)
        storage.put_json(
            f"{provider_id}/manifest.json",
            {
                "provider": provider_id,
                "display_name": config.provider.display_name,
                "city": config.provider.city,
                "tz": config.provider.timezone,
                "bbox": config.provider.bounds.bbox(),
                "attribution": config.provider.attribution_text,
                "dataset_version": "baseline-static",
                "labels": {},
                "surfaces": ["map"],
                "files": {
                    "live": {"generated_utc": "2026-10-03T00:00:00Z"},
                    "static": {"basemap": "static/basemap.json"},
                },
            },
            tier="live",
        )
        storage.put_json(
            f"{provider_id}/static/basemap.json",
            {
                "url": config.public.basemap_url,
                "attribution": config.provider.attribution_text,
                "generated_utc": "2026-10-03T00:00:00Z",
            },
            tier="static",
        )
        storage.put_bytes(
            provider_object_key(config.public.basemap_url, provider_id, None),
            bytes(100001),
            tier="static",
        )
    catalogue = build_public_provider_catalog(registry, storage, default_provider=public_ids[0])
    return {entry.id: entry.model_dump(mode="json") for entry in catalogue.providers}


@pytest.fixture
def baseline(tmp_path, monkeypatch):
    settings = Settings(_env_file=None, SNAPSHOT_LOCAL_ROOT=str(tmp_path))
    registry = ProviderRegistry.from_project_root(settings=settings)
    for provider_id in registry.list_provider_ids():
        for feed in registry.get_provider(provider_id).feeds.values():
            if feed.source_url_env_var:
                monkeypatch.delenv(feed.source_url_env_var, raising=False)
    # Rebuild typed settings after clearing overrides, as well as process-only values.
    settings = Settings(_env_file=None, SNAPSHOT_LOCAL_ROOT=str(tmp_path))
    registry = ProviderRegistry.from_project_root(settings=settings)
    entries = _catalogue_entries(registry, settings)
    result = {}
    for provider_id in registry.list_provider_ids():
        manifest = registry.get_provider(provider_id)
        connection = RecordingConnection()
        sync_live_policy(connection, manifest)
        display = manifest.to_display_dict(settings)
        result[provider_id] = {
            "provider_seed": manifest.to_provider_seed().as_params(),
            "feed_endpoint_seeds": [
                seed.as_params() for seed in manifest.to_feed_endpoint_seeds(settings)
            ],
            "live_policy_text": connection.params[0]["policy"],
            "show_provider": {
                section: {key: display.get(section, {}).get(key) for key in keys}
                for section, keys in DISPLAY_KEYS.items()
            },
        }
        if provider_id in entries:
            result[provider_id]["catalogue_entry"] = entries[provider_id]
    return result


def test_baseline_matches_golden(baseline):
    assert GOLDEN_PATH.exists(), "frozen golden missing: set PROVIDER_BASELINE_REGEN=1 to generate"
    golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    assert baseline.keys() == golden.keys(), "provider ids differ"
    for provider_id, expected in golden.items():
        actual = baseline[provider_id]
        assert actual.keys() == expected.keys(), f"{provider_id}: baseline keys differ"
        for key, value in expected.items():
            assert actual[key] == value, f"{provider_id}: {key} differs"


def test_golden_covers_every_provider_file():
    golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    assert set(golden) == {path.stem for path in PROVIDER_DIR.glob("*.yaml")}


@pytest.mark.skipif(
    os.environ.get("PROVIDER_BASELINE_REGEN") != "1",
    reason="set PROVIDER_BASELINE_REGEN=1 to regenerate the frozen golden",
)
def test_regenerate_provider_baseline(baseline):
    GOLDEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    GOLDEN_PATH.write_text(
        json.dumps(baseline, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
