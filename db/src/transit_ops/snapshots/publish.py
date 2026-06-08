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


def _publish_historic(  # noqa: ARG001
    conn: object, storage: object, *, provider_id: str, settings: object
) -> list[str]:
    """Build and upload all historic-tier snapshot files; return the list of keys written."""
    from sqlalchemy import text as _text

    written: list[str] = []

    # --- flat historic files ---
    written.append(storage.put_json(  # type: ignore[attr-defined]
        "historic/network_trend.json",
        builders.build_network_trend(conn, provider_id=provider_id),  # type: ignore[arg-type]
        tier="historic",
    ))
    written.append(storage.put_json(  # type: ignore[attr-defined]
        "historic/hotspots.json",
        builders.build_hotspots(conn, provider_id),  # type: ignore[arg-type]
        tier="historic",
    ))
    written.append(storage.put_json(  # type: ignore[attr-defined]
        "historic/repeat_offenders.json",
        builders.build_repeat_offenders(conn, provider_id),  # type: ignore[arg-type]
        tier="historic",
    ))
    written.append(storage.put_json(  # type: ignore[attr-defined]
        "historic/alert_history.json",
        builders.build_alert_history(conn, provider_id),  # type: ignore[arg-type]
        tier="historic",
    ))

    # --- provenance at top-level (not under historic/) ---
    written.append(storage.put_json(  # type: ignore[attr-defined]
        "provenance.json",
        builders.build_provenance(conn, provider_id),  # type: ignore[arg-type]
        tier="historic",
    ))

    # --- per-route reliability files (routes that have history) ---
    route_rows = conn.execute(  # type: ignore[attr-defined]
        _text(
            "SELECT DISTINCT route_id FROM gold.route_reliability_weekly"
            " WHERE provider_id = :provider_id"
            " UNION"
            " SELECT DISTINCT route_id FROM gold.route_reliability_monthly"
            " WHERE provider_id = :provider_id"
        ),
        {"provider_id": provider_id},
    ).fetchall()
    for (route_id,) in route_rows:
        if route_id is None:
            continue
        written.append(storage.put_json(  # type: ignore[attr-defined]
            f"historic/route_reliability/{route_id}.json",
            builders.build_route_reliability(conn, provider_id=provider_id, route_id=str(route_id)),  # type: ignore[arg-type]
            tier="historic",
        ))

    # --- per-stop reliability files (batched pass) ---
    all_stops_rel = builders.build_stop_reliability(conn, provider_id=provider_id)  # type: ignore[arg-type]
    for stop_id, stop_rel in sorted(all_stops_rel.items()):
        written.append(storage.put_json(  # type: ignore[attr-defined]
            f"historic/stop_reliability/{stop_id}.json",
            stop_rel,
            tier="historic",
        ))

    # --- per-date receipts ---
    all_receipts = builders.build_receipts(conn, provider_id)  # type: ignore[arg-type]
    for date_str, receipt in sorted(all_receipts.items()):
        written.append(storage.put_json(  # type: ignore[attr-defined]
            f"historic/receipts/{date_str}.json",
            receipt,
            tier="historic",
        ))

    return written


def _publish_static(conn: object, storage: object, *, provider_id: str, settings: object) -> list[str]:
    """Build and upload all static-tier snapshot files; return the list of keys written."""
    from sqlalchemy import text as _text

    written: list[str] = []

    # Indexes
    written.append(storage.put_json(  # type: ignore[attr-defined]
        "static/routes_index.json",
        builders.build_routes_index(conn, provider_id=provider_id),  # type: ignore[arg-type]
        tier="static",
    ))
    written.append(storage.put_json(  # type: ignore[attr-defined]
        "static/stops_index.json",
        builders.build_stops_index(conn, provider_id=provider_id),  # type: ignore[arg-type]
        tier="static",
    ))

    # Labels
    for lang in ("fr", "en"):
        written.append(storage.put_json(  # type: ignore[attr-defined]
            f"labels/{lang}.json",
            builders.build_labels(conn, lang=lang),  # type: ignore[arg-type]
            tier="static",
        ))

    # Per-route files
    route_rows = conn.execute(  # type: ignore[attr-defined]
        _text("SELECT route_id FROM gold.dim_route WHERE provider_id = :provider_id ORDER BY route_id"),
        {"provider_id": provider_id},
    ).fetchall()
    for (route_id,) in route_rows:
        written.append(storage.put_json(  # type: ignore[attr-defined]
            f"static/routes/{route_id}.json",
            builders.build_route(conn, provider_id=provider_id, route_id=str(route_id)),  # type: ignore[arg-type]
            tier="static",
        ))

    # Per-stop files (one-pass batch)
    all_stops = builders.build_all_stops_data(conn, provider_id=provider_id)  # type: ignore[arg-type]
    for stop_id, stop_file in sorted(all_stops.items()):
        written.append(storage.put_json(  # type: ignore[attr-defined]
            f"static/stops/{stop_id}.json",
            stop_file,
            tier="static",
        ))

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
        Data tier to publish.  ``"live"`` (Phase 1) and ``"static"``
        (Phase 2) are implemented; any other value raises :exc:`ValueError`.
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

    engine = engine or make_engine(settings)  # type: ignore[arg-type]
    storage = storage or build_snapshot_storage(settings, provider_id=provider_id)  # type: ignore[arg-type]

    if tier == "live":
        with engine.begin() as conn:  # type: ignore[attr-defined]
            keys = _publish_live(conn, storage, provider_id=provider_id, settings=settings)
    elif tier == "static":
        with engine.begin() as conn:  # type: ignore[attr-defined]
            keys = _publish_static(conn, storage, provider_id=provider_id, settings=settings)
    elif tier == "historic":
        with engine.begin() as conn:  # type: ignore[attr-defined]
            keys = _publish_historic(conn, storage, provider_id=provider_id, settings=settings)
    else:
        raise ValueError(f"tier {tier!r} not implemented yet (live, static, historic)")

    return PublishResult(provider_id=provider_id, tier=tier, keys_written=keys)
