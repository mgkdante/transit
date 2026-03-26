from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import AnyHttpUrl, BaseModel, Field, PositiveInt, model_validator

from transit_ops.settings import Settings


class FeedKind(StrEnum):
    STATIC_SCHEDULE = "static_schedule"
    TRIP_UPDATES = "trip_updates"
    VEHICLE_POSITIONS = "vehicle_positions"


class SourceFormat(StrEnum):
    GTFS_SCHEDULE_ZIP = "gtfs_schedule_zip"
    GTFS_RT_TRIP_UPDATES = "gtfs_rt_trip_updates"
    GTFS_RT_VEHICLE_POSITIONS = "gtfs_rt_vehicle_positions"


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


class ProviderConfig(BaseModel):
    provider_id: str
    display_name: str
    timezone: str
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


class RealtimeFeedConfig(FeedConfigBase):
    feed_kind: Literal[FeedKind.TRIP_UPDATES, FeedKind.VEHICLE_POSITIONS]


FeedConfig = Annotated[StaticFeedConfig | RealtimeFeedConfig, Field(discriminator="feed_kind")]


@dataclass(frozen=True)
class ProviderSeed:
    provider_id: str
    display_name: str
    timezone: str
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
        return ProviderSeed(
            provider_id=self.provider.provider_id,
            display_name=self.provider.display_name,
            timezone=self.provider.timezone,
            attribution_text=self.provider.attribution_text or "",
            website_url=str(self.provider.website_url) if self.provider.website_url else "",
            is_active=self.provider.is_active,
        )

    def to_feed_endpoint_seeds(self, settings: Settings) -> list[FeedEndpointSeed]:
        ordered_feed_keys = [
            FeedKind.STATIC_SCHEDULE.value,
            FeedKind.TRIP_UPDATES.value,
            FeedKind.VEHICLE_POSITIONS.value,
        ]
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
