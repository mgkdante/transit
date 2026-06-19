from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, cast

HealthStatus = Literal["ok", "degraded", "down"]

HEALTH_STATUSES: tuple[HealthStatus, HealthStatus, HealthStatus] = (
    "ok",
    "degraded",
    "down",
)


@dataclass(frozen=True)
class ComponentHealthResult:
    name: str
    status: HealthStatus
    message: str
    latency_ms: float | None = None
    checked_at_utc: datetime | None = None
    details: Mapping[str, object] | None = None

    def __post_init__(self) -> None:
        _validate_health_status(self.status)

    def display_dict(self) -> dict[str, object]:
        return {
            "name": self.name,
            "status": self.status,
            "message": self.message,
            "latency_ms": self.latency_ms,
            "checked_at_utc": (
                self.checked_at_utc.isoformat() if self.checked_at_utc else None
            ),
            "details": _json_safe_value(self.details),
        }

    def public_dict(self) -> dict[str, object]:
        """Minimal, anonymous-safe view of a single component.

        Exposes only the coarse name + status. Deliberately drops ``message``
        (raw DB/storage/feed error strings), ``details`` (configured feed URLs,
        DB DSNs, storage locations), and ``latency_ms`` (an internal timing
        signal) so the internet-facing /health cannot leak operational internals
        (audit x-security#4).
        """
        return {"name": self.name, "status": self.status}


@dataclass(frozen=True)
class OverallHealthResult:
    status: HealthStatus
    checked_at_utc: datetime
    components: list[ComponentHealthResult]

    def __post_init__(self) -> None:
        _validate_health_status(self.status)

    @classmethod
    def from_components(
        cls,
        *,
        checked_at_utc: datetime,
        components: Sequence[ComponentHealthResult],
    ) -> OverallHealthResult:
        component_list = list(components)
        if not component_list:
            component_list = [
                ComponentHealthResult(
                    name="components",
                    status="degraded",
                    message="No health components were checked.",
                    checked_at_utc=checked_at_utc,
                )
            ]

        return cls(
            status=aggregate_health_status(component_list),
            checked_at_utc=checked_at_utc,
            components=component_list,
        )

    def display_dict(self) -> dict[str, object]:
        return {
            "status": self.status,
            "checked_at_utc": self.checked_at_utc.isoformat(),
            "needs_attention": self.status != "ok",
            "component_counts": self.component_counts(),
            "components": [
                component.display_dict() for component in self.components
            ],
        }

    def public_dict(self) -> dict[str, object]:
        """Minimal, anonymous-safe view for the internet-facing /health.

        Returns the overall status, the attention flag, coarse per-component
        up/down, and a single non-sensitive freshness scalar (max realtime
        endpoint age in seconds). Drops every component message, detail block,
        feed URL, DB DSN, storage location, and latency that the full
        display_dict() carries (audit x-security#4). The detailed view stays in
        server logs / operator tooling, not on the public endpoint.
        """
        return {
            "status": self.status,
            "checked_at_utc": self.checked_at_utc.isoformat(),
            "needs_attention": self.status != "ok",
            "component_counts": self.component_counts(),
            "components": [component.public_dict() for component in self.components],
            "pipeline_freshness_age_seconds": self._pipeline_freshness_age_seconds(),
        }

    def _pipeline_freshness_age_seconds(self) -> int | None:
        """Max capture age (seconds) across every per-provider feed component.

        A non-sensitive operability scalar: it reveals how stale the freshest-
        lagging feed is across all providers without exposing provider ids,
        endpoint URLs, capture timestamps, or any configured internals. Each
        per-feed freshness component carries an ``age_seconds`` in its (redacted)
        details; this rolls them up to a single max. Returns None when no feed
        component reports an age (e.g. the freshness check failed, or no feed has
        ever been captured).
        """
        ages = [
            details["age_seconds"]
            for component in self.components
            if isinstance((details := component.details), Mapping)
            and isinstance(details.get("age_seconds"), int)
        ]
        return max(ages) if ages else None

    def component_counts(self) -> dict[HealthStatus, int]:
        counts: dict[HealthStatus, int] = {status: 0 for status in HEALTH_STATUSES}
        for component in self.components:
            counts[_validate_health_status(component.status)] += 1
        return counts


def aggregate_health_status(
    components: Sequence[ComponentHealthResult],
) -> HealthStatus:
    statuses = [_validate_health_status(component.status) for component in components]
    if "down" in statuses:
        return "down"
    if "degraded" in statuses or not statuses:
        return "degraded"
    return "ok"


def _validate_health_status(status: object) -> HealthStatus:
    if status not in HEALTH_STATUSES:
        raise ValueError(
            f"Unsupported health status '{status}'. Expected one of: "
            f"{', '.join(HEALTH_STATUSES)}."
        )
    return cast(HealthStatus, status)


def _json_safe_value(value: object) -> object:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {
            str(key): _json_safe_value(nested_value)
            for key, nested_value in value.items()
        }
    if isinstance(value, list | tuple):
        return [_json_safe_value(item) for item in value]
    return str(value)
