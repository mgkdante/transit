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
