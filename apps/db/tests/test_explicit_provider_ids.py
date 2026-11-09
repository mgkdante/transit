from __future__ import annotations

import ast
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from typer.testing import CliRunner

from transit_ops import cli, orchestration, snapshots
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings


def test_snapshot_provider_ids_have_no_defaults():
    violations = []
    for path in Path(snapshots.__file__).parent.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                args = node.args
                positional = args.posonlyargs + args.args
                defaults = list(zip(positional[-len(args.defaults) :], args.defaults, strict=False))
                defaults += list(zip(args.kwonlyargs, args.kw_defaults, strict=True))
                for arg, default in defaults:
                    if arg.arg == "provider_id" and default is not None:
                        violations.append(f"{path.name}:{node.lineno}:{node.name}")
            if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                if node.target.id == "provider_id" and node.value is not None:
                    # Dataclass fields also generate constructor defaults.
                    if not isinstance(node.value, ast.Call) or any(
                        keyword.arg in ("default", "default_factory")
                        for keyword in node.value.keywords
                    ):
                        violations.append(f"{path.name}:{node.lineno}:provider_id")
    assert violations == []


def test_publish_providers_requires_explicit_default(monkeypatch):
    storage = Mock()
    monkeypatch.setattr(cli, "build_snapshot_storage", storage)
    result = CliRunner().invoke(cli.app, ["publish-providers"])
    assert result.exit_code == 2
    assert "--default-provider" in result.output
    storage.assert_not_called()


@pytest.mark.parametrize("provider_id,configured", [("octranspo", False), ("stm", True)])
def test_gis_configuration_distinguishes_absence_from_failure(
    monkeypatch, caplog, provider_id, configured
):
    settings = Settings()
    registry = ProviderRegistry(Path(__file__).parents[1] / "config/providers", settings=settings)
    ingest = Mock(side_effect=RuntimeError("GIS source down"))
    silver = Mock()
    monkeypatch.setattr(orchestration, "ingest_gis_feed", ingest)
    monkeypatch.setattr(orchestration, "load_latest_gis_to_silver", silver)
    outcome = orchestration._run_gis_steps_best_effort(
        provider_id, settings=settings, registry=registry, engine=object()
    )
    assert outcome.gis_status == ("failed" if configured else "not-configured")
    assert outcome.gis_ingestion is None
    assert outcome.gis_silver_load is None
    assert outcome.gis_ingestion_duration_seconds is None
    assert outcome.gis_silver_load_duration_seconds is None
    silver.assert_not_called()
    if configured:
        ingest.assert_called_once()
        assert outcome.gis_error_message == "ingest-gis failed: GIS source down"
        assert "GIS ingest failed" in caplog.text
    else:
        ingest.assert_not_called()
        assert outcome.gis_error_message is None
        assert not caplog.records

    monkeypatch.setattr(cli, "get_settings", lambda: settings)
    monkeypatch.setattr(cli, "_provider_registry", lambda _: registry)
    monkeypatch.setattr(
        cli,
        "run_static_pipeline",
        lambda *args, **kwargs: SimpleNamespace(
            display_dict=lambda: {"status": "succeeded", "gis_status": outcome.gis_status},
            gis_error_message=outcome.gis_error_message,
        ),
    )
    result = CliRunner().invoke(cli.app, ["run-static-pipeline", provider_id])
    assert result.exit_code == 0
    assert ("WARNING: GIS step failed" in result.output) == configured


def test_publish_providers_explicit_stm_preserves_current_catalog(monkeypatch):
    from datetime import UTC, datetime

    from transit_ops.snapshots import providers

    settings = Settings()
    registry = ProviderRegistry.from_project_root(settings=settings)
    documents = {}
    for provider_id in registry.list_provider_ids():
        manifest = registry.get_provider(provider_id)
        if not manifest.public.enabled:
            continue
        documents[f"{provider_id}/manifest.json"] = {
            "provider": provider_id,
            "display_name": manifest.provider.display_name,
            "city": manifest.provider.city,
            "tz": manifest.provider.timezone,
            "bbox": manifest.provider.bounds.bbox(),
            "attribution": "Test data",
            "dataset_version": "test-static",
            "labels": {},
            "surfaces": ["map"],
            "files": {
                "live": {"generated_utc": "2026-10-03T00:00:00Z"},
                "static": {"basemap": "static/basemap.json"},
            },
        }
        documents[f"{provider_id}/static/basemap.json"] = {
            "url": manifest.public.basemap_url,
            "attribution": "Test map",
            "generated_utc": "2026-10-03T00:00:00Z",
        }
    storage = Mock()
    storage.get_json.side_effect = documents.__getitem__
    storage.capture_object_version.return_value = SimpleNamespace(size=100001)
    clock = Mock()
    clock.now.return_value = datetime(2026, 11, 9, tzinfo=UTC)
    monkeypatch.setattr(providers, "datetime", clock)
    expected = providers.build_public_provider_catalog(registry, storage, default_provider="stm")
    monkeypatch.setattr(cli, "get_settings", lambda: settings)
    monkeypatch.setattr(cli, "_provider_registry", lambda _: registry)
    monkeypatch.setattr(cli, "build_snapshot_storage", lambda *a, **kw: storage)
    result = CliRunner().invoke(cli.app, ["publish-providers", "--default-provider", "stm"])
    assert result.exit_code == 0, result.output
    storage.put_json.assert_called_once_with("providers.json", expected, tier="live")
    assert expected.default_provider == "stm"
    assert {provider.id for provider in expected.providers} == {"stm", "octranspo"}
