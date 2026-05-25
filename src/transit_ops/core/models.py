from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import AnyHttpUrl, BaseModel, Field, PositiveInt, model_validator

from transit_ops.settings import Settings


class FeedKind(StrEnum):
    STATIC_SCHEDULE = "static_schedule"
    GIS_STATIC = "gis_static"
    TRIP_UPDATES = "trip_updates"
    VEHICLE_POSITIONS = "vehicle_positions"
    I3_ALERTS = "i3_alerts"


class SourceFormat(StrEnum):
    GTFS_SCHEDULE_ZIP = "gtfs_schedule_zip"
    STM_GIS_ZIP = "stm_gis_zip"
    GTFS_RT_TRIP_UPDATES = "gtfs_rt_trip_updates"
    GTFS_RT_VEHICLE_POSITIONS = "gtfs_rt_vehicle_positions"
    API_I3_JSON = "api_i3_json"


class StorageBackend(StrEnum):
    LOCAL = "local"
    S3 = "s3"


class AuthType(StrEnum):
    NONE = "none"
    API_KEY = "api_key"


class AuthConfig(BaseModel):
    auth_type: AuthType
    credential_env_var: str | None = None
    auth_header_name: str | None = None
    auth_query_param: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def validate_auth_shape(self) -> AuthConfig:
        if self.auth_type == AuthType.API_KEY:
            if not self.credential_env_var:
                raise ValueError("API-key auth requires credential_env_var.")
            if not self.auth_header_name and not self.auth_query_param:
                raise ValueError(
                    "API-key auth requires auth_header_name or auth_query_param."
                )
        return self


class ProviderBoundsConfig(BaseModel):
    min_latitude: float
    max_latitude: float
    min_longitude: float
    max_longitude: float

    @model_validator(mode="after")
    def validate_bounds_shape(self) -> ProviderBoundsConfig:
        if not (-90 <= self.min_latitude <= self.max_latitude <= 90):
            raise ValueError("Provider latitude bounds must be valid WGS84 values.")
        if not (-180 <= self.min_longitude <= self.max_longitude <= 180):
            raise ValueError("Provider longitude bounds must be valid WGS84 values.")
        return self


class ProviderConfig(BaseModel):
    provider_id: str
    display_name: str
    timezone: str
    default_language: str | None = None
    default_currency: str | None = None
    bounds: ProviderBoundsConfig | None = None
    attribution_text: str | None = None
    website_url: AnyHttpUrl | None = None
    is_active: bool = True


class FeedConfigBase(BaseModel):
    endpoint_key: str
    feed_kind: FeedKind
    source_format: SourceFormat
    source_url: AnyHttpUrl | None = None
    source_url_env_var: str | None = None
    documentation_url: AnyHttpUrl | None = None
    auth: AuthConfig
    refresh_interval_seconds: PositiveInt
    is_enabled: bool = True

    @model_validator(mode="after")
    def validate_source_location(self) -> FeedConfigBase:
        if not self.source_url and not self.source_url_env_var:
            raise ValueError("Each feed requires source_url, source_url_env_var, or both.")
        return self

    def resolved_source_url(self, settings: Settings | None = None) -> str | None:
        if settings and self.source_url_env_var:
            override = getattr(settings, self.source_url_env_var, None)
            if override:
                return override
        return str(self.source_url) if self.source_url else None


class StaticFeedConfig(FeedConfigBase):
    feed_kind: Literal[FeedKind.STATIC_SCHEDULE]
    source_format: Literal[SourceFormat.GTFS_SCHEDULE_ZIP]


class GisStaticFeedConfig(FeedConfigBase):
    feed_kind: Literal[FeedKind.GIS_STATIC]
    source_format: Literal[SourceFormat.STM_GIS_ZIP]


class TripUpdatesFeedConfig(FeedConfigBase):
    feed_kind: Literal[FeedKind.TRIP_UPDATES]
    source_format: Literal[SourceFormat.GTFS_RT_TRIP_UPDATES]


class VehiclePositionsFeedConfig(FeedConfigBase):
    feed_kind: Literal[FeedKind.VEHICLE_POSITIONS]
    source_format: Literal[SourceFormat.GTFS_RT_VEHICLE_POSITIONS]


class I3AlertsFeedConfig(FeedConfigBase):
    feed_kind: Literal[FeedKind.I3_ALERTS]
    source_format: Literal[SourceFormat.API_I3_JSON]


RealtimeFeedConfig = TripUpdatesFeedConfig | VehiclePositionsFeedConfig


FeedConfig = Annotated[
    StaticFeedConfig
    | GisStaticFeedConfig
    | TripUpdatesFeedConfig
    | VehiclePositionsFeedConfig
    | I3AlertsFeedConfig,
    Field(discriminator="feed_kind"),
]


@dataclass(frozen=True)
class ProviderSeed:
    provider_id: str
    provider_key: str
    display_name: str
    timezone: str
    default_language: str | None
    default_currency: str | None
    min_latitude: float | None
    max_latitude: float | None
    min_longitude: float | None
    max_longitude: float | None
    attribution_text: str
    website_url: str
    is_active: bool = True

    def as_params(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class FeedEndpointSeed:
    provider_id: str
    endpoint_key: str
    feed_kind: str
    source_format: str
    source_url: str | None
    auth_type: str
    refresh_interval_seconds: int
    is_enabled: bool = True

    def as_params(self) -> dict[str, object]:
        return asdict(self)


class ProviderManifest(BaseModel):
    provider: ProviderConfig
    feeds: dict[str, FeedConfig]

    @model_validator(mode="after")
    def validate_manifest_shape(self) -> ProviderManifest:
        required_feeds = {
            FeedKind.STATIC_SCHEDULE.value,
            FeedKind.GIS_STATIC.value,
            FeedKind.TRIP_UPDATES.value,
            FeedKind.VEHICLE_POSITIONS.value,
        }
        missing_feeds = required_feeds - set(self.feeds)
        if missing_feeds:
            missing_display = ", ".join(sorted(missing_feeds))
            raise ValueError(f"Missing required feed definitions: {missing_display}")

        for feed_key, feed in self.feeds.items():
            if feed.endpoint_key != feed_key:
                raise ValueError(
                    f"Feed manifest key '{feed_key}' must match endpoint_key '{feed.endpoint_key}'."
                )
        return self

    def static_feed(self) -> StaticFeedConfig:
        feed = self.feeds[FeedKind.STATIC_SCHEDULE.value]
        if not isinstance(feed, StaticFeedConfig):
            raise TypeError("Static schedule feed did not validate as StaticFeedConfig.")
        return feed

    def gis_feed(self) -> GisStaticFeedConfig:
        feed = self.feeds[FeedKind.GIS_STATIC.value]
        if not isinstance(feed, GisStaticFeedConfig):
            raise TypeError("GIS static feed did not validate as GisStaticFeedConfig.")
        return feed

    def i3_alerts_feed(self) -> I3AlertsFeedConfig:
        feed = self.feeds[FeedKind.I3_ALERTS.value]
        if not isinstance(feed, I3AlertsFeedConfig):
            raise TypeError("i3 alerts feed did not validate as I3AlertsFeedConfig.")
        return feed

    def realtime_feed(self, endpoint_key: str) -> RealtimeFeedConfig:
        if endpoint_key not in {
            FeedKind.TRIP_UPDATES.value,
            FeedKind.VEHICLE_POSITIONS.value,
        }:
            raise ValueError(f"Unsupported realtime endpoint '{endpoint_key}'.")
        feed = self.feeds[endpoint_key]
        if not isinstance(feed, RealtimeFeedConfig):
            raise TypeError(f"Realtime feed '{endpoint_key}' did not validate correctly.")
        return feed

    def to_provider_seed(self) -> ProviderSeed:
        bounds = self.provider.bounds
        return ProviderSeed(
            provider_id=self.provider.provider_id,
            provider_key=self.provider.provider_id,
            display_name=self.provider.display_name,
            timezone=self.provider.timezone,
            default_language=self.provider.default_language,
            default_currency=self.provider.default_currency,
            min_latitude=bounds.min_latitude if bounds else None,
            max_latitude=bounds.max_latitude if bounds else None,
            min_longitude=bounds.min_longitude if bounds else None,
            max_longitude=bounds.max_longitude if bounds else None,
            attribution_text=self.provider.attribution_text or "",
            website_url=str(self.provider.website_url) if self.provider.website_url else "",
            is_active=self.provider.is_active,
        )

    def to_feed_endpoint_seeds(self, settings: Settings) -> list[FeedEndpointSeed]:
        ordered_feed_keys = [
            FeedKind.STATIC_SCHEDULE.value,
            FeedKind.GIS_STATIC.value,
            FeedKind.TRIP_UPDATES.value,
            FeedKind.VEHICLE_POSITIONS.value,
        ]
        if FeedKind.I3_ALERTS.value in self.feeds:
            ordered_feed_keys.append(FeedKind.I3_ALERTS.value)

        feed_seeds: list[FeedEndpointSeed] = []
        for feed_key in ordered_feed_keys:
            feed = self.feeds[feed_key]
            feed_seeds.append(
                FeedEndpointSeed(
                    provider_id=self.provider.provider_id,
                    endpoint_key=feed.endpoint_key,
                    feed_kind=feed.feed_kind.value,
                    source_format=feed.source_format.value,
                    source_url=feed.resolved_source_url(settings),
                    auth_type=feed.auth.auth_type.value,
                    refresh_interval_seconds=feed.refresh_interval_seconds,
                    is_enabled=feed.is_enabled,
                )
            )
        return feed_seeds

    def to_display_dict(self, settings: Settings) -> dict[str, object]:
        manifest_dict = self.model_dump(mode="json")
        for feed_key, feed in self.feeds.items():
            manifest_dict["feeds"][feed_key]["resolved_source_url"] = (
                feed.resolved_source_url(settings)
            )
        return manifest_dict
