"""Stamp mutable snapshot envelopes while retaining immutable payload bytes."""

from collections.abc import Sequence

from transit_ops.snapshots.contract import (
    PAYLOAD_METHODOLOGY,
    TOP_LEVEL_MODELS,
    AlertArchivePage,
    HistoricHotspotsDay,
    HistoricRepeatOffendersDay,
    LineHistoryPartition,
    NetworkHistoryPartition,
    PayloadEnvelope,
    StopHistoryPartition,
)
from transit_ops.snapshots.protocols import PutItem

# Shared index wrapper classes use the first model-family mapping.
_METHODOLOGY_BY_MODEL: dict[type, str] = {
    model: PAYLOAD_METHODOLOGY[name]
    for name, model in TOP_LEVEL_MODELS.items()
    if name in PAYLOAD_METHODOLOGY
}


def publish_generation_id(provider_id: str, stamp: str) -> str:
    """Provider and tier timestamp label; historic runs on one UTC day share it.

    Immutable content hashes distinguish same-day historical corrections.
    """
    return f"{provider_id}@{stamp}"


def stamp_envelope(items: Sequence[PutItem], *, provider_id: str, stamp: str) -> None:
    """Add schema, methodology and provider/timestamp labels before gating.

    Immutable payloads retain their content-addressed bytes across runs.
    """
    generation_id = publish_generation_id(provider_id, stamp)
    for _rel_key, payload, _tier in items:
        if isinstance(payload, PayloadEnvelope):
            # Content-addressed payloads must remain byte-stable across runs; a
            # run generation id would invalidate their already-computed SHA/path.
            if isinstance(
                payload,
                AlertArchivePage
                | NetworkHistoryPartition
                | LineHistoryPartition
                | StopHistoryPartition
                | HistoricHotspotsDay
                | HistoricRepeatOffendersDay,
            ):
                continue
            payload.publish_generation_id = generation_id
            payload.methodology_version = _METHODOLOGY_BY_MODEL.get(type(payload))
