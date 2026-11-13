"""Build the storage that the archive verbs take, for a command or a hook."""

from transit_ops.ingestion.common import project_root
from transit_ops.ingestion.storage import BronzeStorageScope
from transit_ops.settings import Settings, get_settings


def history_storage(settings: Settings | None = None) -> BronzeStorageScope:
    """Return a storage scope; pass its resolve as storage, and close it when done."""
    return BronzeStorageScope(
        settings if settings is not None else get_settings(), project_root=project_root()
    )
