"""Archive verbs that own their transactions."""

from sqlalchemy import Connection

from transit_ops.history import datasets
from transit_ops.history.ledger import ArchiveCopy
from transit_ops.history.seal_captures import seal_capture_day
from transit_ops.ingestion.storage import BronzeStorageResolver


def seal(
    connection: Connection,
    storage: BronzeStorageResolver,
    *,
    dataset_id: str,
    provider_id: str,
    window_key: str,
    revision: int = 0,
    archive_backend: str,
    sealed_by: str,
    actor: str | None = None,
) -> ArchiveCopy:
    if connection.in_transaction():
        raise ValueError("seal requires a connection without a transaction")
    dataset = datasets.get_dataset(dataset_id)
    start = datasets.window_start(dataset, window_key)
    if isinstance(dataset.source, datasets.TableSource):
        raise NotImplementedError("table seal requires H10a")
    if isinstance(dataset.source, datasets.ObjectSource):
        raise NotImplementedError("object seal requires H24")
    if revision != 0:
        raise ValueError("capture revision must be 0")
    assert start is not None
    return seal_capture_day(
        connection,
        storage,
        provider_id=provider_id,
        endpoint_key=dataset.source.endpoint_key,
        utc_date=start,
        archive_backend=archive_backend,
        sealed_by=sealed_by,
        actor=actor,
    )
