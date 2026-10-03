from datetime import UTC, datetime
from urllib.parse import unquote, urlsplit

from transit_ops.core.models import FeedKind, ProviderLabel
from transit_ops.providers.registry import ProviderRegistry
from transit_ops.snapshots.contract import (
    PAYLOAD_METHODOLOGY,
    BasemapFile,
    Manifest,
    PublicProvider,
    PublicProviderCatalog,
)
from transit_ops.snapshots.storage import LocalSnapshotStorage, SnapshotStorage


def provider_object_key(pointer: str, provider_id: str) -> str:
    url = urlsplit(pointer)
    path = unquote(url.path)
    if url.scheme not in ("", "https", "http") or "\\" in path:
        raise ValueError("Invalid snapshot pointer")
    for prefix in (f"/data/v1/{provider_id}/", f"/v1/{provider_id}/"):
        if path.startswith(prefix):
            path = path[len(prefix) :]
            break
    if path.startswith("/") or any(part in ("", ".", "..") for part in path.split("/")):
        raise ValueError("Snapshot pointer is outside the provider namespace")
    return f"{provider_id}/{path}"


def build_public_provider_catalog(
    registry: ProviderRegistry,
    storage: SnapshotStorage | LocalSnapshotStorage,
    *,
    default_provider: str,
) -> PublicProviderCatalog:
    providers = []
    for provider_id in registry.list_provider_ids():
        config = registry.get_provider(provider_id)
        public, identity = config.public, config.provider
        if not public.enabled:
            continue
        try:
            if not identity.is_active or not identity.bounds or not identity.city:
                raise ValueError("Active provider, city and bounds are required")
            manifest = Manifest.model_validate(storage.get_json(f"{provider_id}/manifest.json"))
            if (manifest.provider, manifest.tz, manifest.bbox) != (
                provider_id,
                identity.timezone,
                identity.bounds.bbox(),
            ):
                raise ValueError("Published identity/geography differs from configuration")
            if manifest.publish_generation_id and not manifest.publish_generation_id.startswith(
                f"{provider_id}@"
            ):
                raise ValueError("Published generation belongs to another provider")
            if not public.basemap_url or not manifest.files.static.basemap:
                raise ValueError("Provider basemap is required")
            descriptor = BasemapFile.model_validate(
                storage.get_json(provider_object_key(manifest.files.static.basemap, provider_id))
            )
            asset_key = provider_object_key(public.basemap_url, provider_id)
            if provider_object_key(descriptor.url, provider_id) != asset_key:
                raise ValueError("Published basemap differs from configuration")
            asset = storage.capture_object_version(asset_key)
            if asset is None or asset.size <= 100000:
                raise ValueError("Provider basemap archive is missing or incomplete")
            providers.append(
                PublicProvider(
                    id=provider_id,
                    labels={
                        language: public.labels.get(language)
                        or ProviderLabel(
                            city=identity.city,
                            operator=identity.short_name or identity.display_name,
                        )
                        for language in ("en", "fr")
                    },
                    bbox=identity.bounds.bbox(),
                    tz=identity.timezone,
                    default_lang=identity.default_language or "en",
                    attribution=identity.attribution_text or "",
                    website_url=str(identity.website_url) if identity.website_url else None,
                    fit_bounds=public.fit_bounds.bbox() if public.fit_bounds else None,
                    max_bounds=public.max_bounds.bbox() if public.max_bounds else None,
                    geocode_context=public.geocode_context,
                    basemap_url=public.basemap_url,
                    posters_url=public.posters_url,
                    alert_links={
                        language: str(url) for language, url in public.alert_links.items()
                    },
                    inputs={
                        kind.value: any(
                            feed.feed_kind == kind and feed.is_enabled
                            for feed in config.feeds.values()
                        )
                        for kind in FeedKind
                    },
                )
            )
        except (ValueError, TypeError) as exc:
            raise ValueError(f"Provider '{provider_id}' is not ready: {exc}") from exc
    if default_provider not in {provider.id for provider in providers}:
        raise ValueError(f"Default provider '{default_provider}' is not ready")
    generated_utc = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    return PublicProviderCatalog(
        generated_utc=generated_utc,
        methodology_version=PAYLOAD_METHODOLOGY["providers"],
        publish_generation_id=f"providers@{generated_utc}",
        default_provider=default_provider,
        providers=providers,
    )
