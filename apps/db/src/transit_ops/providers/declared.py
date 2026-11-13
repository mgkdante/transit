"""Stable access to declared keys across provider file conversions.

Callers use these functions rather than reading the keys another way.
"""

import json

from transit_ops.core.models import ReadingPopulation as ReadingPopulation
from transit_ops.providers.registry import ProviderRegistry


def reading_population(provider_id: str) -> ReadingPopulation | None:
    return (
        ProviderRegistry.from_project_root().get_provider(provider_id).provider.reading_population
    )


def live_source_lag_seconds(provider_id: str) -> int:
    return (
        ProviderRegistry.from_project_root()
        .get_provider(provider_id)
        .provider.live_source_lag_seconds
    )


def lines_without_live_data_json(provider_id: str) -> str:
    manifest = ProviderRegistry.from_project_root().get_provider(provider_id)
    # This text must equal the stored column's jsonb text for declaration hashes.
    return json.dumps(
        [gap.model_dump() for gap in manifest.realtime.lines_without_live_data], ensure_ascii=False
    )
