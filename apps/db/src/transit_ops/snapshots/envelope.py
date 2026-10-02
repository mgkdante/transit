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

_METHODOLOGY_BY_MODEL: dict[type, str] = {
    model: PAYLOAD_METHODOLOGY[name]
    for name, model in TOP_LEVEL_MODELS.items()
    if name in PAYLOAD_METHODOLOGY
}


def publish_generation_id(provider_id: str, stamp: str) -> str:
    return f"{provider_id}@{stamp}"


def stamp_envelope(items: Sequence[PutItem], *, provider_id: str, stamp: str) -> None:
    generation_id = publish_generation_id(provider_id, stamp)
    for _rel_key, payload, _tier in items:
        if isinstance(payload, PayloadEnvelope):
            # Run generation IDs would invalidate immutable content-addressed hashes and paths.
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
