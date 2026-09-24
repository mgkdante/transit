"""One transaction-scoped lane shared by publishers and historic collection."""

from sqlalchemy.engine import Connection

from transit_ops.sql_registry import named_query

_PUBLISH_LOCK_SQL = named_query(
    "publish.lock.try_acquire",
    "SELECT pg_try_advisory_xact_lock("
    "hashtext('transit.snapshot_publish:' || :provider_id), hashtext(:tier))",
)


class PublishLockUnavailableError(RuntimeError):
    """A provider/tier lane already has an active publisher."""

    def __init__(self, *, provider_id: str, tier: str) -> None:
        super().__init__(
            f"snapshot publish already running for provider={provider_id!r}, tier={tier!r}"
        )
        self.provider_id = provider_id
        self.tier = tier


def acquire_publication_lane(conn: Connection, *, provider_id: str, tier: str) -> None:
    """Fail fast unless this transaction owns the provider/tier publish lane."""

    acquired = conn.execute(
        _PUBLISH_LOCK_SQL,
        {"provider_id": provider_id, "tier": tier},
    ).scalar_one()
    if not acquired:
        raise PublishLockUnavailableError(provider_id=provider_id, tier=tier)
