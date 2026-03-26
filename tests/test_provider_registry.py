from pathlib import Path

import yaml
from pydantic import ValidationError
from typer.testing import CliRunner

from transit_ops.cli import app
from transit_ops.providers.registry import ProviderRegistry, load_provider_manifest
from transit_ops.settings import Settings

runner = CliRunner()


def test_manifest_loading() -> None:
    registry = ProviderRegistry.from_project_root(
        project_root=Path(__file__).resolve().parents[1],
        settings=Settings(_env_file=None),
    )

    provider = registry.get_provider("stm")
    static_url = provider.feeds["static_schedule"].resolved_source_url(Settings(_env_file=None))

    assert registry.list_provider_ids() == ["stm"]
    assert provider.provider.provider_id == "stm"
    assert static_url is not None
    assert static_url.startswith("https://www.stm.info/")


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
    assert '"trip_updates"' in result.stdout
    assert '"vehicle_positions"' in result.stdout
