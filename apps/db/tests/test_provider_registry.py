from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError
from typer.testing import CliRunner

from transit_ops.cli import app
from transit_ops.core.errors import OptionalSourceUnavailable
from transit_ops.core.models import ProviderManifest
from transit_ops.ingestion.gis import build_gis_ingestion_config
from transit_ops.providers.registry import ProviderRegistry, load_provider_manifest
from transit_ops.settings import Settings

runner = CliRunner()


def test_oc_bounds_include_published_eastern_stops_and_route_geometry() -> None:
    config = load_provider_manifest(Path(__file__).parents[1] / "config/providers/octranspo.yaml")
    west, south, east, north = config.provider.bounds.bbox()
    for lon, lat in [(-75.34342, 45.44076), (-75.342938, 45.331639), (-75.34429, 45.518043)]:
        assert west <= lon <= east and south <= lat <= north
    assert config.public.enabled


def _provider_manifest_payload(*, gis: bool = True, realtime: bool = True) -> dict[str, object]:
    formats = {"static_schedule": "gtfs_schedule_zip"}
    if gis:
        formats["gis_static"] = "stm_gis_zip"
    if realtime:
        formats.update(
            trip_updates="gtfs_rt_trip_updates", vehicle_positions="gtfs_rt_vehicle_positions"
        )
    return {
        "provider": {
            "provider_id": "test",
            "display_name": "Test Provider",
            "timezone": "America/Toronto",
        },
        "feeds": {
            kind: {
                "endpoint_key": kind,
                "feed_kind": kind,
                "source_format": source_format,
                "source_url": f"https://example.test/{kind}",
                "auth": (
                    {
                        "auth_type": "api_key",
                        "credential_env_var": "STM_API_KEY",
                        "auth_header_name": "apiKey",
                    }
                    if source_format.startswith("gtfs_rt")
                    else {"auth_type": "none"}
                ),
                "refresh_interval_seconds": 30 if source_format.startswith("gtfs_rt") else 86400,
                "is_enabled": True,
            }
            for kind, source_format in formats.items()
        },
    }


def _gtfs_only_manifest_payload() -> dict[str, object]:
    return _provider_manifest_payload(gis=False)


def test_gtfs_only_manifest_validates_without_gis() -> None:
    manifest = ProviderManifest.model_validate(_gtfs_only_manifest_payload())

    assert set(manifest.feeds) == {
        "static_schedule",
        "trip_updates",
        "vehicle_positions",
    }
    assert manifest.gis_feed() is None


def _static_only_manifest_payload() -> dict[str, object]:
    return _provider_manifest_payload(gis=False, realtime=False)


def test_static_only_manifest_validates() -> None:
    manifest = ProviderManifest.model_validate(_static_only_manifest_payload())

    assert set(manifest.feeds) == {"static_schedule"}
    assert [
        seed.endpoint_key for seed in manifest.to_feed_endpoint_seeds(Settings(_env_file=None))
    ] == ["static_schedule"]


@pytest.mark.parametrize("realtime", [False, True])
def test_manifest_accepts_generic_service_alerts_feed(realtime) -> None:
    payload = _provider_manifest_payload(gis=False, realtime=realtime)
    feeds = payload["feeds"]
    assert isinstance(feeds, dict)
    feeds["service_alerts"] = {
        "endpoint_key": "service_alerts",
        "feed_kind": "service_alerts",
        "source_format": "gtfs_rt_service_alerts",
        "source_url": "https://example.test/alerts.pb",
        "auth": {"auth_type": "none"},
        "refresh_interval_seconds": 300,
        "is_enabled": True,
    }

    manifest = ProviderManifest.model_validate(payload)

    alerts = manifest.service_alerts_feed()
    assert alerts is not None
    assert alerts.source_format.value == "gtfs_rt_service_alerts"
    assert [
        seed.endpoint_key for seed in manifest.to_feed_endpoint_seeds(Settings(_env_file=None))
    ] == [
        "static_schedule",
        *(["trip_updates", "vehicle_positions"] if realtime else []),
        "service_alerts",
    ]


def test_manifest_missing_static_schedule_still_rejected() -> None:
    payload = _static_only_manifest_payload()
    feeds = payload["feeds"]
    assert isinstance(feeds, dict)
    del feeds["static_schedule"]

    with pytest.raises(ValidationError, match="Missing required feed definitions"):
        ProviderManifest.model_validate(payload)


def test_gtfs_only_feed_endpoint_seeds_omit_gis() -> None:
    manifest = ProviderManifest.model_validate(_gtfs_only_manifest_payload())

    seeds = manifest.to_feed_endpoint_seeds(Settings(_env_file=None))

    assert [seed.endpoint_key for seed in seeds] == [
        "static_schedule",
        "trip_updates",
        "vehicle_positions",
    ]


def test_only_static_schedule_is_universally_required() -> None:
    for optional_feed in ("trip_updates", "vehicle_positions"):
        payload = _gtfs_only_manifest_payload()
        feeds = payload["feeds"]
        assert isinstance(feeds, dict)
        del feeds[optional_feed]
        manifest = ProviderManifest.model_validate(payload)
        assert optional_feed not in manifest.feeds


def test_build_gis_ingestion_config_raises_when_no_gis_feed() -> None:
    manifest = ProviderManifest.model_validate(_gtfs_only_manifest_payload())

    with pytest.raises(OptionalSourceUnavailable):
        build_gis_ingestion_config(manifest, Settings(_env_file=None))


def test_stm_manifest_still_exposes_gis_feed() -> None:
    settings = Settings(_env_file=None)
    registry = ProviderRegistry.from_project_root(
        project_root=Path(__file__).resolve().parents[1],
        settings=settings,
    )
    provider = registry.get_provider("stm")

    gis_feed = provider.gis_feed()
    assert gis_feed is not None
    assert gis_feed.source_format.value == "stm_gis_zip"


def test_manifest_without_service_alerts_returns_none() -> None:
    manifest = ProviderManifest.model_validate(_gtfs_only_manifest_payload())
    assert manifest.service_alerts_feed() is None


def test_manifest_loading() -> None:
    settings = Settings(_env_file=None)
    registry = ProviderRegistry.from_project_root(
        project_root=Path(__file__).resolve().parents[1],
        settings=settings,
    )

    provider = registry.get_provider("stm")
    static_url = provider.feeds["static_schedule"].resolved_source_url(settings)
    gis_url = provider.feeds["gis_static"].resolved_source_url(settings)

    assert registry.list_provider_ids() == ["octranspo", "stm", "sto"]
    assert registry.list_active_provider_ids() == ["octranspo", "stm"]
    assert provider.provider.provider_id == "stm"
    assert static_url is not None
    assert static_url.endswith("/gtfs_stm.zip")
    assert "static_schedule_current_fallback" not in provider.feeds
    assert gis_url is not None
    assert gis_url.endswith("/stm_sig.zip")


def test_stm_manifest_has_live_current_static_gis_and_no_current_fallback() -> None:
    settings = Settings(_env_file=None)
    registry = ProviderRegistry.from_project_root(
        project_root=Path(__file__).resolve().parents[1],
        settings=settings,
    )
    provider = registry.get_provider("stm")

    assert set(provider.feeds) == {
        "static_schedule",
        "gis_static",
        "trip_updates",
        "vehicle_positions",
        "i3_alerts",
    }
    assert "static_schedule_current_fallback" not in provider.feeds
    assert provider.feeds["gis_static"].feed_kind.value == "gis_static"
    assert provider.feeds["gis_static"].source_format.value == "stm_gis_zip"
    assert provider.provider.default_language == "fr"
    assert provider.provider.default_currency == "CAD"
    assert provider.provider.bounds is not None
    assert provider.provider.bounds.min_longitude == -74.1
    assert provider.i3_alerts_feed().source_format.value == "api_i3_json"
    assert (
        provider.i3_alerts_feed().resolved_source_url(settings)
        == "https://api.stm.info/pub/od/i3/v2/messages/etatservice"
    )
    assert provider.i3_alerts_feed().refresh_interval_seconds == 300
    assert [seed.endpoint_key for seed in provider.to_feed_endpoint_seeds(settings)] == [
        "static_schedule",
        "gis_static",
        "trip_updates",
        "vehicle_positions",
        "i3_alerts",
    ]


def test_stm_display_name_is_accented() -> None:
    settings = Settings(_env_file=None)
    registry = ProviderRegistry.from_project_root(
        project_root=Path(__file__).resolve().parents[1],
        settings=settings,
    )
    provider = registry.get_provider("stm")

    assert provider.provider.display_name == "Société de transport de Montréal"


def test_sto_stays_inactive_until_source_date_and_bilingual_attribution_are_supported() -> None:
    settings = Settings(_env_file=None)
    registry = ProviderRegistry.from_project_root(
        project_root=Path(__file__).resolve().parents[1],
        settings=settings,
    )

    provider = registry.get_provider("sto").provider

    assert provider.is_active is False
    assert provider.attribution_text == (
        "This service incorporates the open data provided by the Société de "
        "transport de l'Outaouais (STO). The STO is not responsible for the "
        "accuracy of the information generated by this app. Last update: "
        "YYYY-MM-DD."
    )


def test_live_current_static_feed_is_seeded_as_canonical_static_schedule() -> None:
    settings = Settings(_env_file=None)
    registry = ProviderRegistry.from_project_root(
        project_root=Path(__file__).resolve().parents[1],
        settings=settings,
    )

    provider = registry.get_provider("stm")
    seeds = provider.to_feed_endpoint_seeds(settings)
    seeded_by_endpoint = {seed.endpoint_key: seed for seed in seeds}

    assert "static_schedule" in seeded_by_endpoint
    assert (seeded_by_endpoint["static_schedule"].source_url or "").endswith("/gtfs_stm.zip")
    assert "static_schedule_current_fallback" not in seeded_by_endpoint, (
        "Current GTFS is the live static source used to join realtime delay facts; "
        "do not seed it as a fallback endpoint."
    )


def test_feed_endpoint_seeds_include_disabled_manifest_feeds() -> None:
    payload = _provider_manifest_payload()
    feeds = payload["feeds"]
    assert isinstance(feeds, dict)
    gis_feed = feeds["gis_static"]
    assert isinstance(gis_feed, dict)
    gis_feed["is_enabled"] = False

    manifest = ProviderManifest.model_validate(payload)
    seeds = manifest.to_feed_endpoint_seeds(Settings(_env_file=None))

    assert [seed.endpoint_key for seed in seeds] == [
        "static_schedule",
        "gis_static",
        "trip_updates",
        "vehicle_positions",
    ]
    assert {seed.endpoint_key: seed.is_enabled for seed in seeds}["gis_static"] is False


def test_gis_static_rejects_gtfs_schedule_source_format() -> None:
    payload = _provider_manifest_payload()
    feeds = payload["feeds"]
    assert isinstance(feeds, dict)
    gis_feed = feeds["gis_static"]
    assert isinstance(gis_feed, dict)
    gis_feed["source_format"] = "gtfs_schedule_zip"

    with pytest.raises(ValidationError):
        ProviderManifest.model_validate(payload)


def test_trip_updates_rejects_vehicle_positions_source_format() -> None:
    payload = _provider_manifest_payload()
    feeds = payload["feeds"]
    assert isinstance(feeds, dict)
    trip_updates_feed = feeds["trip_updates"]
    assert isinstance(trip_updates_feed, dict)
    trip_updates_feed["source_format"] = "gtfs_rt_vehicle_positions"

    with pytest.raises(ValidationError):
        ProviderManifest.model_validate(payload)


def test_manifest_validation_rejects_missing_required_fields(tmp_path: Path) -> None:
    invalid_manifest_path = tmp_path / "invalid.yaml"
    invalid_manifest_path.write_text(
        yaml.safe_dump(
            {
                "provider": {
                    "provider_id": "bad",
                    "display_name": "Broken Provider",
                    "timezone": "America/Toronto",
                },
                "feeds": {},
            }
        ),
        encoding="utf-8",
    )

    try:
        load_provider_manifest(invalid_manifest_path)
    except ValidationError as exc:
        assert "Missing required feed definitions" in str(exc)
    else:
        raise AssertionError("Expected manifest validation to fail.")


def test_list_providers_command() -> None:
    result = runner.invoke(app, ["list-providers"])

    assert result.exit_code == 0
    assert result.stdout.strip().splitlines() == ["octranspo", "stm"]


def test_show_provider_command() -> None:
    result = runner.invoke(app, ["show-provider", "stm"])

    assert result.exit_code == 0
    assert '"provider_id": "stm"' in result.stdout
    assert '"static_schedule"' in result.stdout
    assert '"gis_static"' in result.stdout
    assert '"stm_gis_zip"' in result.stdout
    assert '"static_schedule_current_fallback"' not in result.stdout
    assert '"trip_updates"' in result.stdout
    assert '"vehicle_positions"' in result.stdout


def test_public_readiness_is_separate_from_ingestion() -> None:
    manifest = ProviderManifest.model_validate(_gtfs_only_manifest_payload())
    assert manifest.provider.is_active
    assert manifest.public.enabled is False


@pytest.mark.parametrize("provider_id", ["../stm", "a/b", "a?b", ""])
def test_provider_id_cannot_escape_its_namespace(provider_id: str) -> None:
    payload = _gtfs_only_manifest_payload()
    payload["provider"]["provider_id"] = provider_id
    with pytest.raises(ValidationError):
        ProviderManifest.model_validate(payload)


@pytest.fixture
def public_provider(tmp_path, monkeypatch):
    from transit_ops.ingestion.realtime_gtfs import build_realtime_ingestion_config
    from transit_ops.ingestion.static_gtfs import build_static_ingestion_config
    from transit_ops.snapshots.storage import LocalSnapshotStorage

    monkeypatch.setenv("TEST_PROVIDER_API_KEY", "synthetic-credential")
    settings = Settings(
        _env_file=None,
        SNAPSHOT_LOCAL_ROOT=str(tmp_path / "snapshots"),
        SNAPSHOT_PUBLIC_BASE_URL="https://transit.example/data",
    )
    payload = _gtfs_only_manifest_payload()
    for endpoint in ("trip_updates", "vehicle_positions"):
        payload["feeds"][endpoint]["auth"]["credential_env_var"] = "TEST_PROVIDER_API_KEY"
    payload["provider"].update(
        city="Test City",
        short_name="Test Transit",
        bounds=dict(min_latitude=10, max_latitude=11, min_longitude=20, max_longitude=21),
    )
    payload["public"] = {
        "enabled": True,
        "labels": {
            "en": {"city": "Test City", "operator": "Test Transit"},
            "fr": {"city": "Ville Test", "operator": "Transport Test"},
        },
        "basemap_url": "/data/v1/test/static/basemap/test.pmtiles",
    }
    config = tmp_path / "config"
    config.mkdir()
    manifest_path = config / "test.yaml"
    manifest_path.write_text(yaml.safe_dump(payload), encoding="utf-8")
    monkeypatch.setattr("transit_ops.cli.get_settings", lambda: settings)
    monkeypatch.setattr(
        "transit_ops.cli._provider_registry", lambda _: ProviderRegistry(config, settings=settings)
    )
    manifest = ProviderRegistry(config).get_provider("test")
    assert build_static_ingestion_config(manifest, settings).provider_id == "test"
    realtime = build_realtime_ingestion_config(manifest, settings, "trip_updates")
    assert realtime.provider_id == "test"
    assert realtime.request_headers["apiKey"] == "synthetic-credential"
    store = LocalSnapshotStorage(settings.SNAPSHOT_LOCAL_ROOT, "v1")
    store.put_json(
        "test/manifest.json",
        {
            "provider": "test",
            "publish_generation_id": "test@2026-10-03T00:00:00Z",
            "display_name": "Test Provider",
            "city": "Test City",
            "tz": "America/Toronto",
            "bbox": [20, 10, 21, 11],
            "attribution": "Test data",
            "dataset_version": "test-static",
            "labels": {},
            "surfaces": ["map"],
            "files": {
                "live": {"generated_utc": "2026-10-03T00:00:00Z"},
                "static": {"basemap": "static/basemap.json"},
            },
        },
        tier="live",
    )
    store.put_json(
        "test/static/basemap.json",
        {
            "url": payload["public"]["basemap_url"],
            "attribution": "Test map",
            "publish_generation_id": "test@2026-10-02T00:00:00Z",
            "generated_utc": "2026-10-03T00:00:00Z",
        },
        tier="static",
    )
    store.put_bytes("test/static/basemap/test.pmtiles", bytes(100001), tier="static")
    return store, manifest_path, payload


def test_catalog_publication_uses_configured_provider_without_credentials(public_provider) -> None:
    store, manifest_path, payload = public_provider
    result = runner.invoke(app, ["publish-providers", "--default-provider", "test"])
    assert result.exit_code == 0, result.output
    catalog = store.get_json("providers.json")
    assert catalog["default_provider"] == "test"
    assert [entry["id"] for entry in catalog["providers"]] == ["test"]
    entry = catalog["providers"][0]
    assert entry["labels"]["fr"]["city"] == "Ville Test"
    assert entry["inputs"]["trip_updates"] is True
    assert entry["inputs"]["service_alerts"] is False
    assert "synthetic-credential" not in str(catalog)
    assert "credential_env_var" not in str(catalog)
    payload["public"]["enabled"] = False
    manifest_path.write_text(yaml.safe_dump(payload), encoding="utf-8")
    result = runner.invoke(app, ["publish-providers", "--default-provider", "test"])
    assert result.exit_code != 0
    assert store.get_json("providers.json") == catalog


@pytest.mark.parametrize(
    "target, changes",
    [
        ("manifest", {"provider": "stm"}),
        (
            "manifest",
            {
                "files": {
                    "live": {"generated_utc": "2026-10-03T00:00:00Z"},
                    "static": {
                        "basemap": "https://foreign.example/data/v1/test/static/basemap.json"
                    },
                }
            },
        ),
        ("descriptor", {"url": "/data/v1/stm/static/basemap/montreal.pmtiles"}),
        ("descriptor", {"url": "https://foreign.example/data/v1/test/static/basemap/test.pmtiles"}),
        ("descriptor", {"url": "//foreign.example/data/v1/test/static/basemap/test.pmtiles"}),
        ("descriptor", {"url": "///data/v1/test/static/basemap/test.pmtiles"}),
        ("descriptor", {"url": "\x00///data/v1/test/static/basemap/test.pmtiles"}),
        ("descriptor", {"url": "/\t//data/v1/test/static/basemap/test.pmtiles"}),
        ("descriptor", {"url": r"/\data/v1/test/static/basemap/test.pmtiles"}),
        (
            "descriptor",
            {"url": "https://transit.example:0/data/v1/test/static/basemap/test.pmtiles"},
        ),
        ("descriptor", {"publish_generation_id": "stm@other"}),
        ("descriptor", {"publish_generation_id": ""}),
        (
            "public",
            {"basemap_url": "https://foreign.example/data/v1/test/static/basemap/test.pmtiles"},
        ),
        ("public", {"labels": {"fr": {"city": "", "operator": "Transport Test"}}}),
        ("public", {"labels": {"en": {"city": "Test City", "operator": ""}}}),
        (
            "public",
            {
                "fit_bounds": dict(
                    min_latitude=10, max_latitude=11, min_longitude=20, max_longitude=20
                )
            },
        ),
        (
            "public",
            {
                "max_bounds": dict(
                    min_latitude=10, max_latitude=10, min_longitude=20, max_longitude=21
                )
            },
        ),
        ("missing_asset", {}),
    ],
)
def test_catalog_rejects_unready_provider_without_replacing_discovery(
    public_provider, target, changes
) -> None:
    store, manifest_path, payload = public_provider
    assert runner.invoke(app, ["publish-providers", "--default-provider", "test"]).exit_code == 0
    catalog = store.get_json("providers.json")
    if target == "missing_asset":
        Path(store.full_key("test/static/basemap/test.pmtiles")).unlink()
    elif target == "public":
        payload["public"].update(changes)
        manifest_path.write_text(yaml.safe_dump(payload), encoding="utf-8")
    else:
        key = "test/manifest.json" if target == "manifest" else "test/static/basemap.json"
        document = store.get_json(key)
        document.update(changes)
        store.put_json(key, document, tier="static")
    result = runner.invoke(app, ["publish-providers", "--default-provider", "test"])
    assert result.exit_code != 0
    assert store.get_json("providers.json") == catalog


@pytest.mark.parametrize(
    "prefix",
    [
        "static/",
        "/v1/test/static/",
        "/data/v1/test/static/",
        "https://transit.example/data/v1/test/static/",
    ],
)
def test_catalog_accepts_owned_basemap_pointers(public_provider, prefix) -> None:
    store, manifest_path, payload = public_provider
    manifest = store.get_json("test/manifest.json")
    manifest["files"]["static"]["basemap"] = f"{prefix}basemap.json"
    store.put_json("test/manifest.json", manifest, tier="live")
    descriptor = store.get_json("test/static/basemap.json")
    descriptor["url"] = f"{prefix}basemap/test.pmtiles"
    descriptor.pop("publish_generation_id")
    store.put_json("test/static/basemap.json", descriptor, tier="static")
    payload["public"]["basemap_url"] = descriptor["url"]
    manifest_path.write_text(yaml.safe_dump(payload), encoding="utf-8")
    result = runner.invoke(app, ["publish-providers", "--default-provider", "test"])
    assert result.exit_code == 0, result.output
