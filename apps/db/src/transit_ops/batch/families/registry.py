from collections.abc import Mapping
from dataclasses import dataclass
from importlib import import_module
from types import MappingProxyType
from typing import cast


@dataclass(frozen=True)
class FamilySlot:
    packet_id: str
    display_name: str
    module_path: str


class UnknownFamilyError(LookupError):
    """The requested family has no reserved slot."""


FAMILIES: Mapping[str, FamilySlot] = MappingProxyType(
    {
        "route_spine_hours": FamilySlot(
            "LS2.5", "Route spine and hours", "transit_ops.batch.families.route_spine_hours"
        ),
        "stop_spine_hours": FamilySlot(
            "LS2.6", "Stop spine and hours", "transit_ops.batch.families.stop_spine_hours"
        ),
        "percentiles_histograms": FamilySlot(
            "LS2.7",
            "Percentiles and histograms",
            "transit_ops.batch.families.percentiles_histograms",
        ),
        "cancellations_service_states": FamilySlot(
            "LS2.8",
            "Cancellations and service states",
            "transit_ops.batch.families.cancellations_service_states",
        ),
        "headways": FamilySlot("LS2.9", "Headways", "transit_ops.batch.families.headways"),
        "span_skipped_stops": FamilySlot(
            "LS2.10", "Span and skipped stops", "transit_ops.batch.families.span_skipped_stops"
        ),
        "occupancy_crowding": FamilySlot(
            "LS2.11", "Occupancy and crowding", "transit_ops.batch.families.occupancy_crowding"
        ),
        "repeat_offenders": FamilySlot(
            "LS2.12", "Repeat offenders", "transit_ops.batch.families.repeat_offenders"
        ),
        "receipts": FamilySlot("LS2.13", "Receipts", "transit_ops.batch.families.receipts"),
        "hotspots": FamilySlot("LS2.14", "Hotspots", "transit_ops.batch.families.hotspots"),
        "trend_history_partitions": FamilySlot(
            "LS2.15",
            "Trend and history partitions",
            "transit_ops.batch.families.trend_history_partitions",
        ),
        "alerts_provenance": FamilySlot(
            "LS2.16", "Alerts and provenance", "transit_ops.batch.families.alerts_provenance"
        ),
    }
)


def resolve_builder(family_id: str) -> object | None:
    """Return the current builder lazily; None means not implemented."""
    try:
        slot = FAMILIES[family_id]
    except KeyError:
        raise UnknownFamilyError(f"Unknown family: {family_id}") from None
    return cast(object | None, import_module(slot.module_path).builder)
