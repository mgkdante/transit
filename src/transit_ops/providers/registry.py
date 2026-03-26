from __future__ import annotations

from pathlib import Path

import yaml

from transit_ops.core.models import ProviderManifest
from transit_ops.settings import Settings, get_settings


def load_provider_manifest(path: Path) -> ProviderManifest:
    """Load and validate a single provider manifest file."""

    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Provider manifest at {path} must contain a YAML mapping.")
    return ProviderManifest.model_validate(payload)


class ProviderRegistry:
    """Load provider manifests from a simple config directory."""

    def __init__(self, config_dir: Path, settings: Settings | None = None) -> None:
        self.config_dir = config_dir
        self.settings = settings or get_settings()
        self._providers = self._load_manifests()

    @classmethod
    def from_project_root(
        cls,
        project_root: Path | None = None,
        settings: Settings | None = None,
    ) -> ProviderRegistry:
        root = project_root or Path(__file__).resolve().parents[3]
        return cls(root / "config" / "providers", settings=settings)

    def _load_manifests(self) -> dict[str, ProviderManifest]:
        if not self.config_dir.exists():
            raise FileNotFoundError(f"Provider config directory not found: {self.config_dir}")

        manifests: dict[str, ProviderManifest] = {}
        for path in sorted(self.config_dir.glob("*.yaml")):
            manifest = load_provider_manifest(path)
            provider_id = manifest.provider.provider_id
            if provider_id in manifests:
                raise ValueError(f"Duplicate provider_id found in manifests: {provider_id}")
            manifests[provider_id] = manifest
        return manifests

    def list_provider_ids(self) -> list[str]:
        return list(self._providers.keys())

    def get_provider(self, provider_id: str) -> ProviderManifest:
        try:
            return self._providers[provider_id]
        except KeyError as exc:
            raise KeyError(f"No provider manifest found for provider_id='{provider_id}'.") from exc
