"""Archive verbs that own their transactions."""

from sqlalchemy import Connection

from transit_ops.history import datasets
from transit_ops.history.ledger import ArchiveCopy
from transit_ops.history.seal_captures import seal_capture_day
from transit_ops.history.verify import Verification, verify_capture_copy
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
        raise NotImplementedError("sealing a table dataset is not built")
    if isinstance(dataset.source, datasets.ObjectSource):
        raise NotImplementedError("sealing an archived object is not built")
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


def verify(
    connection: Connection, storage: BronzeStorageResolver, copy: ArchiveCopy,
    *, actor: str | None = None,
) -> Verification:
    if connection.in_transaction():
        raise ValueError("verify requires a connection without a transaction")
    dataset = datasets.get_dataset(copy.dataset_id)
    if isinstance(dataset.source, datasets.TableSource):
        raise NotImplementedError("verifying a copy of a table dataset is not built")
    if isinstance(dataset.source, datasets.ObjectSource):
        raise NotImplementedError("verifying an archived object is not built")
    return verify_capture_copy(connection, storage, copy, actor=actor)
