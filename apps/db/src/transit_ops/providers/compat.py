"""Project a validated declaration into the legacy manifest without resolving URLs."""

from transit_ops.core.models import (
    AuthConfig,
    AuthType,
    ProviderBoundsConfig,
    ProviderManifest,
    SignatureScheme,
)
from transit_ops.providers.declaration import Declaration, DeclarationError, FeedAuth, Overrides

_FORMATS = {
    ("geometry", "stm-gis-zip"): ("gis_static", "stm_gis_zip", 86400),
    ("alerts", "stm-etatservice-json"): ("i3_alerts", "api_i3_json", 300),
    ("schedule", "gtfs"): ("static_schedule", "gtfs_schedule_zip", 86400),
    ("trip_updates", "gtfs-rt"): ("trip_updates", "gtfs_rt_trip_updates", 30),
    ("vehicle_positions", "gtfs-rt"): ("vehicle_positions", "gtfs_rt_vehicle_positions", 30),
    ("alerts", "gtfs-rt"): ("service_alerts", "gtfs_rt_service_alerts", 300),
}


def _auth(auth: FeedAuth | None, provider_id: str, index: int) -> AuthConfig:
    if auth is None:
        return AuthConfig(auth_type=AuthType.NONE)
    signature = auth.signature
    if signature and auth.header is not None:
        raise DeclarationError(
            f"{provider_id}: feeds[{index}].auth.signature: "
            "signed compatibility auth requires query"
        )
    return AuthConfig(
        auth_type=AuthType.API_KEY_SIGNED if signature else AuthType.API_KEY,
        credential_env_var=auth.secret_env,
        auth_header_name=auth.header,
        auth_query_param=auth.query,
        signing_secret_env_var=signature.secret_env if signature else None,
        signature_query_param=signature.query if signature else None,
        signature_scheme=SignatureScheme(signature.scheme) if signature else None,
    )


def _bounds(box: tuple[float, float, float, float] | None) -> ProviderBoundsConfig | None:
    if box is None:
        return None
    west, south, east, north = box
    return ProviderBoundsConfig(
        min_longitude=west, min_latitude=south, max_longitude=east, max_latitude=north
    )


def _public(declaration: Declaration) -> dict[str, object]:
    overrides = declaration.overrides
    public: dict[str, object] = {
        "enabled": declaration.stage == "public",
        "labels": {k: v.model_dump() for k, v in declaration.labels.items()},
        "alert_links": dict(declaration.alert_links or {}),
    }
    if overrides:
        public.update(
            fit_bounds=_bounds(overrides.fit_bounds),
            max_bounds=_bounds(overrides.max_bounds),
            geocode_context=overrides.geocode_context,
        )
    if declaration.map:
        public.update(
            basemap_url=declaration.map.basemap_url,
            posters_url=declaration.map.posters_url,
            basemap_bounds=_bounds(declaration.map.basemap_bounds),
        )
    return public


def _feeds(declaration: Declaration) -> dict[str, object]:
    feeds: dict[str, object] = {}
    for index, feed in enumerate(declaration.feeds):
        format_name = feed.format or ("gtfs" if feed.family == "schedule" else "gtfs-rt")
        key, source_format, cadence = _FORMATS[feed.family, format_name]
        feeds[key] = {
            "endpoint_key": key,
            "feed_kind": key,
            "source_format": source_format,
            "source_url": feed.url,
            "source_url_env_var": feed.url_env,
            "documentation_url": declaration.licence.terms_url,
            "refresh_interval_seconds": feed.every_seconds
            if feed.every_seconds is not None
            else cadence,
            "refresh_phase_seconds": feed.phase_seconds,
            "auth": _auth(feed.auth, declaration.id, index),
        }
    return feeds


def manifest_from_declaration(declaration: Declaration) -> ProviderManifest:
    """Return a fresh legacy manifest, retaining declared URL override provenance."""
    label = declaration.labels[declaration.default_locale]
    overrides = declaration.overrides or Overrides()
    provider_overrides = overrides.model_dump(
        include={"max_vehicle_speed_kmh", "strict_gtfs"}, exclude_none=True
    )
    return ProviderManifest.model_validate(
        {
            "provider": {
                "provider_id": declaration.id,
                "display_name": declaration.name,
                "short_name": label.operator,
                "city": label.city,
                "timezone": declaration.timezone,
                "default_language": declaration.default_locale,
                "default_currency": declaration.currency,
                "website_url": declaration.website,
                "attribution_text": declaration.attribution[declaration.default_locale],
                "is_active": declaration.stage in ("capturing", "public"),
                "reading_population": declaration.reading_population,
                "bounds": _bounds(overrides.bounds),
                "live_source_lag_seconds": declaration.live_source_lag_seconds or 0,
                **provider_overrides,
            },
            "public": _public(declaration),
            "realtime": {
                "lines_without_live_data": [
                    g.model_dump(include={"gap_id", "route_ids", "route_types"})
                    for g in declaration.lines_without_live_data or []
                ]
            },
            "feeds": _feeds(declaration),
        }
    )
