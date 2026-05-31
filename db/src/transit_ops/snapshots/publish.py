"""Publish orchestrator — builds and uploads all live-tier snapshot files.

Ties together:
  - :func:`transit_ops.snapshots.builders` — SQL -> Pydantic models
  - :func:`transit_ops.snapshots.storage.build_snapshot_storage` — PUT to R2 / local disk

Usage (programmatic)::

    from transit_ops.snapshots.publish import publish_snapshot
    result = publish_snapshot("stm")
    print(result.display_dict())

The ``registry`` parameter is accepted for future signature-compatibility with
CLI / cycle callers even though the live tier does not use it in Phase 1.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from transit_ops.db.connection import make_engine
from transit_ops.ingestion.common import utc_now
from transit_ops.settings import get_settings
from transit_ops.snapshots import builders
from transit_ops.snapshots.storage import build_snapshot_storage


@dataclass(frozen=True)
class PublishResult:
    """Outcome of a :func:`publish_snapshot` call."""

    provider_id: str
    tier: str
    keys_written: list[str] = field(default_factory=list)

    def display_dict(self) -> dict:  # type: ignore[type-arg]
        return {
            "provider_id": self.provider_id,
            "tier": self.tier,
            "keys_written": self.keys_written,
        }


def _publish_live(conn: object, storage: object, *, provider_id: str, settings: object) -> list[str]:
    """Build and upload all live-tier snapshot files; return the list of keys written.

    The manifest is uploaded *last* so its ``generated_utc`` reflects a
    complete, consistent snapshot rather than the start of the upload window.
    """
    gen = utc_now().strftime("%Y-%m-%dT%H:%M:%SZ")
    written: list[str] = []

    written.append(
        storage.put_json(  # type: ignore[attr-defined]
            "live/vehicles.json",
            builders.build_vehicles(conn, provider_id=provider_id, generated_utc=gen),  # type: ignore[arg-type]
            tier="live",
        )
    )
    written.append(
        storage.put_json(  # type: ignore[attr-defined]
            "live/trips.json",
            builders.build_trips(conn, provider_id=provider_id),  # type: ignore[arg-type]
            tier="live",
        )
    )
    written.append(
        storage.put_json(  # type: ignore[attr-defined]
            "live/alerts.json",
            builders.build_alerts(conn, provider_id=provider_id),  # type: ignore[arg-type]
            tier="live",
        )
    )
    written.append(
        storage.put_json(  # type: ignore[attr-defined]
            "live/network.json",
            builders.build_network(conn, provider_id=provider_id),  # type: ignore[arg-type]
            tier="live",
        )
    )
    # manifest LAST — its generated_utc marks a fully-uploaded snapshot
    written.append(
        storage.put_json(  # type: ignore[attr-defined]
            "manifest.json",
            builders.build_manifest(
                conn,  # type: ignore[arg-type]
                provider_id=provider_id,
                generated_utc=gen,
                settings=settings,
            ),
            tier="live",
        )
    )
    return written


def publish_snapshot(
    provider_id: str,
    *,
    tier: str = "live",
    settings: object = None,
    registry: object = None,  # accepted for signature-compatibility; unused in Phase 1
    engine: object = None,
    storage: object = None,
) -> PublishResult:
    """Publish all snapshot files for *provider_id* to the configured backend.

    Parameters
    ----------
    provider_id:
        Transit provider identifier, e.g. ``"stm"``.
    tier:
        Data tier to publish.  Only ``"live"`` is implemented in Phase 1;
        passing any other value raises :exc:`ValueError`.
    settings:
        Application settings object.  When ``None`` the real
        :func:`~transit_ops.settings.get_settings` is called.
    registry:
        Unused in Phase 1; reserved for future route-registry injection.
    engine:
        SQLAlchemy engine.  When ``None`` a real engine is created from
        *settings*.
    storage:
        Storage backend instance.  When ``None`` one is built from *settings*.

    Returns
    -------
    PublishResult
        Metadata about the completed publish operation.
    """
    settings = settings or get_settings()

    if tier != "live":
        raise ValueError(f"tier {tier!r} not implemented in Phase 1")

    engine = engine or make_engine(settings)  # type: ignore[arg-type]
    storage = storage or build_snapshot_storage(settings, provider_id=provider_id)  # type: ignore[arg-type]

    with engine.begin() as conn:  # type: ignore[attr-defined]
        keys = _publish_live(conn, storage, provider_id=provider_id, settings=settings)

    return PublishResult(provider_id=provider_id, tier=tier, keys_written=keys)
