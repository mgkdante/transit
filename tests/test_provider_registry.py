from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError
from typer.testing import CliRunner

from transit_ops.cli import app
from transit_ops.core.models import ProviderManifest
from transit_ops.providers.registry import ProviderRegistry, load_provider_manifest
from transit_ops.settings import Settings

runner = CliRunner()


def _provider_manifest_payload() -> dict[str, object]:
    return {
        "provider": {
            "provider_id": "test",
            "display_name": "Test Provider",
            "timezone": "America/Toronto",
        },
        "feeds": {
            "static_schedule": {
                "endpoint_key": "static_schedule",
                "feed_kind": "static_schedule",
                "source_format": "gtfs_schedule_zip",
                "source_url": "https://example.test/static.zip",
                "auth": {"auth_type": "none"},
                "refresh_interval_seconds": 86400,
                "is_enabled": True,
            },
            "gis_static": {
                "endpoint_key": "gis_static",
                "feed_kind": "gis_static",
                "source_format": "stm_gis_zip",
                "source_url": "https://example.test/gis.zip",
                "auth": {"auth_type": "none"},
                "refresh_interval_seconds": 86400,
                "is_enabled": True,
            },
            "trip_updates": {
                "endpoint_key": "trip_updates",
                "feed_kind": "trip_updates",
                "source_format": "gtfs_rt_trip_updates",
                "source_url": "https://example.test/trip-updates.pb",
                "auth": {
                    "auth_type": "api_key",
                    "credential_env_var": "STM_API_KEY",
                    "auth_header_name": "apiKey",
                },
                "refresh_interval_seconds": 30,
                "is_enabled": True,
            },
            "vehicle_positions": {
                "endpoint_key": "vehicle_positions",
                "feed_kind": "vehicle_positions",
                "source_format": "gtfs_rt_vehicle_positions",
                "source_url": "https://example.test/vehicle-positions.pb",
                "auth": {
                    "auth_type": "api_key",
                    "credential_env_var": "STM_API_KEY",
                    "auth_header_name": "apiKey",
                },
                "refresh_interval_seconds": 30,
                "is_enabled": True,
            },
        },
    }


def test_manifest_loading() -> None:
    settings = Settings(_env_file=None)
    registry = ProviderRegistry.from_project_root(
        project_root=Path(__file__).resolve().parents[1],
        settings=settings,
    )

    provider = registry.get_provider("stm")
    static_url = provider.feeds["static_schedule"].resolved_source_url(settings)
    gis_url = provider.feeds["gis_static"].resolved_source_url(settings)

    assert registry.list_provider_ids() == ["stm"]
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
    assert provider.i3_alerts_feed().refresh_interval_seconds == 30
    assert [seed.endpoint_key for seed in provider.to_feed_endpoint_seeds(settings)] == [
        "static_schedule",
        "gis_static",
        "trip_updates",
        "vehicle_positions",
        "i3_alerts",
    ]


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
    assert result.stdout.strip().splitlines() == ["stm"]


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
