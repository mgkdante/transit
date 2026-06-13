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
from transit_ops.snapshots.contract import ReceiptsIndex
from transit_ops.snapshots.storage import (
    HashGatedStorage,
    build_snapshot_storage,
    state_fingerprint,
)


@dataclass(frozen=True)
class PublishResult:
    """Outcome of a :func:`publish_snapshot` call."""

    provider_id: str
    tier: str
    keys_written: list[str] = field(default_factory=list)
    keys_skipped: list[str] = field(default_factory=list)

    def display_dict(self) -> dict:  # type: ignore[type-arg]
        return {
            "provider_id": self.provider_id,
            "tier": self.tier,
            "keys_written": self.keys_written,
            "files_written": len(self.keys_written),
            "files_skipped": len(self.keys_skipped),
        }


# --- per-tier publish-state upsert ------------------------------------------

# column-form ON CONFLICT (9.1.1h lesson — avoid constraint-name form). The row
# commits in the SAME engine.begin() block as the tier's uploads, so state only
# advances when the publish itself succeeded.
_RECORD_STATE_SQL = (
    "INSERT INTO core.snapshot_publish_state "
    "(provider_id, tier, generated_utc, files_written, files_skipped, files_total, updated_at_utc) "
    "VALUES (:provider_id, :tier, :generated_utc, :written, :skipped, :total, now()) "
    "ON CONFLICT (provider_id, tier) DO UPDATE SET "
    "generated_utc = EXCLUDED.generated_utc, "
    "files_written = EXCLUDED.files_written, "
    "files_skipped = EXCLUDED.files_skipped, "
    "files_total = EXCLUDED.files_total, "
    "updated_at_utc = now()"
)


def _record_publish_state(
    conn: object,
    *,
    provider_id: str,
    tier: str,
    generated_utc: object,
    written: int,
    skipped: int,
    total: int,
) -> None:
    """Upsert the per-tier publish-state row inside the caller's transaction."""
    from sqlalchemy import text as _text

    conn.execute(  # type: ignore[attr-defined]
        _text(_RECORD_STATE_SQL),
        {
            "provider_id": provider_id,
            "tier": tier,
            "generated_utc": generated_utc,
            "written": written,
            "skipped": skipped,
            "total": total,
        },
    )


# --- per-tier DATA-time stamps (NOT upload time, so they never defeat gating) -

_STATIC_STAMP_SQL = (
    "SELECT loaded_at_utc FROM core.dataset_versions "
    "WHERE provider_id = :provider_id AND dataset_kind = 'static_schedule' "
    "AND is_current = true ORDER BY loaded_at_utc DESC LIMIT 1"
)


def _static_stamp(conn: object, provider_id: str) -> str:
    """Static-tier stamp = loaded_at_utc of the current static dataset version.

    Stable across unchanged daily reloads (the touch path never bumps
    loaded_at_utc), so static bytes only change when the dataset actually
    changes. Falls back to day-truncated now() when no version row exists.
    """
    from sqlalchemy import text as _text

    row = conn.execute(  # type: ignore[attr-defined]
        _text(_STATIC_STAMP_SQL), {"provider_id": provider_id}
    ).mappings().fetchone()
    if row is not None and row["loaded_at_utc"] is not None:
        return builders._iso(row["loaded_at_utc"])
    return utc_now().strftime("%Y-%m-%dT00:00:00Z")


def _historic_stamp() -> str:
    """Historic-tier stamp = day-truncated UTC (same-day re-runs become free skips)."""
    return utc_now().strftime("%Y-%m-%dT00:00:00Z")


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
            builders.build_trips(conn, provider_id=provider_id, generated_utc=gen),  # type: ignore[arg-type]
            tier="live",
        )
    )
    written.append(
        storage.put_json(  # type: ignore[attr-defined]
            "live/alerts.json",
            builders.build_alerts(conn, provider_id=provider_id, generated_utc=gen),  # type: ignore[arg-type]
            tier="live",
        )
    )
    written.append(
        storage.put_json(  # type: ignore[attr-defined]
            "live/network.json",
            builders.build_network(conn, provider_id=provider_id, generated_utc=gen),  # type: ignore[arg-type]
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


def _publish_historic(
    conn: object, storage: object, *, provider_id: str, settings: object, stamp: str | None = None
) -> list[str]:
    """Build and upload all historic-tier snapshot files; return the list of keys written.

    *stamp* is the day-truncated DATA-time stamp every artifact carries; when
    omitted (direct callers / older tests) it defaults to today's truncated UTC.
    """
    from sqlalchemy import text as _text

    if stamp is None:
        stamp = _historic_stamp()

    written: list[str] = []

    # --- flat historic files ---
    written.append(storage.put_json(  # type: ignore[attr-defined]
        "historic/network_trend.json",
        builders.build_network_trend(conn, provider_id=provider_id, generated_utc=stamp),  # type: ignore[arg-type]
        tier="historic",
    ))
    written.append(storage.put_json(  # type: ignore[attr-defined]
        "historic/hotspots.json",
        builders.build_hotspots(conn, provider_id, generated_utc=stamp),  # type: ignore[arg-type]
        tier="historic",
    ))
    written.append(storage.put_json(  # type: ignore[attr-defined]
        "historic/repeat_offenders.json",
        builders.build_repeat_offenders(conn, provider_id, generated_utc=stamp),  # type: ignore[arg-type]
        tier="historic",
    ))
    written.append(storage.put_json(  # type: ignore[attr-defined]
        "historic/alert_history.json",
        builders.build_alert_history(conn, provider_id, generated_utc=stamp),  # type: ignore[arg-type]
        tier="historic",
    ))

    # --- provenance at top-level (not under historic/) ---
    written.append(storage.put_json(  # type: ignore[attr-defined]
        "provenance.json",
        builders.build_provenance(conn, provider_id, generated_utc=stamp),  # type: ignore[arg-type]
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
            builders.build_route_reliability(conn, provider_id=provider_id, route_id=str(route_id), generated_utc=stamp),  # type: ignore[arg-type]
            tier="historic",
        ))

    # --- per-stop reliability files (batched pass) ---
    all_stops_rel = builders.build_stop_reliability(conn, provider_id=provider_id, generated_utc=stamp)  # type: ignore[arg-type]
    for stop_id, stop_rel in sorted(all_stops_rel.items()):
        written.append(storage.put_json(  # type: ignore[attr-defined]
            f"historic/stop_reliability/{stop_id}.json",
            stop_rel,
            tier="historic",
        ))

    # --- per-date receipts ---
    all_receipts = builders.build_receipts(conn, provider_id, generated_utc=stamp)  # type: ignore[arg-type]
    for date_str, receipt in sorted(all_receipts.items()):
        written.append(storage.put_json(  # type: ignore[attr-defined]
            f"historic/receipts/{date_str}.json",
            receipt,
            tier="historic",
        ))

    # --- receipts discovery index (exact set published this run) ---
    written.append(storage.put_json(  # type: ignore[attr-defined]
        "historic/receipts/index.json",
        ReceiptsIndex(dates=sorted(all_receipts), generated_utc=stamp),
        tier="historic",
    ))

    return written


def _publish_static(
    conn: object, storage: object, *, provider_id: str, settings: object, stamp: str | None = None
) -> list[str]:
    """Build and upload all static-tier snapshot files; return the list of keys written.

    *stamp* is the dataset-loaded DATA-time every artifact carries; when omitted
    it is derived from the current static dataset version.
    """
    from sqlalchemy import text as _text

    if stamp is None:
        stamp = _static_stamp(conn, provider_id)

    written: list[str] = []

    # Indexes
    written.append(storage.put_json(  # type: ignore[attr-defined]
        "static/routes_index.json",
        builders.build_routes_index(conn, provider_id=provider_id, generated_utc=stamp),  # type: ignore[arg-type]
        tier="static",
    ))
    written.append(storage.put_json(  # type: ignore[attr-defined]
        "static/stops_index.json",
        builders.build_stops_index(conn, provider_id=provider_id, generated_utc=stamp),  # type: ignore[arg-type]
        tier="static",
    ))

    # Basemap pointer — only when SNAPSHOT_BASEMAP_PMTILES_URL is configured.
    bm = builders.build_basemap(settings, generated_utc=stamp)
    if bm is not None:
        written.append(storage.put_json(  # type: ignore[attr-defined]
            "static/basemap.json",
            bm,
            tier="static",
        ))

    # Labels
    for lang in ("fr", "en"):
        written.append(storage.put_json(  # type: ignore[attr-defined]
            f"labels/{lang}.json",
            builders.build_labels(conn, lang=lang, generated_utc=stamp),  # type: ignore[arg-type]
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
            builders.build_route(conn, provider_id=provider_id, route_id=str(route_id), generated_utc=stamp),  # type: ignore[arg-type]
            tier="static",
        ))

    # Per-stop files (one-pass batch)
    all_stops = builders.build_all_stops_data(conn, provider_id=provider_id, generated_utc=stamp)  # type: ignore[arg-type]
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
        # Live tier is NOT hash-gated: its 5 files' bytes change every cycle, so
        # a state GET/PUT per ~57s cycle would only add latency for zero savings.
        with engine.begin() as conn:  # type: ignore[attr-defined]
            keys = _publish_live(conn, storage, provider_id=provider_id, settings=settings)
        return PublishResult(provider_id=provider_id, tier=tier, keys_written=keys)

    if tier == "static":
        publisher = _publish_static
        stamp_fn = _static_stamp
    elif tier == "historic":
        publisher = _publish_historic
        stamp_fn = None
    else:
        raise ValueError(f"tier {tier!r} not implemented yet (live, static, historic)")

    # static / historic — hash-gated against a bucket-stored per-tier state object.
    with engine.begin() as conn:  # type: ignore[attr-defined]
        stamp = stamp_fn(conn, provider_id) if stamp_fn is not None else _historic_stamp()
        gated = HashGatedStorage(
            storage,
            state_rel_key=f"_meta/publish_state_{tier}.json",
            fingerprint=state_fingerprint(tier),
        )
        gated.load()
        publisher(conn, gated, provider_id=provider_id, settings=settings, stamp=stamp)
        gated.flush_state()
        _record_publish_state(
            conn,
            provider_id=provider_id,
            tier=tier,
            generated_utc=stamp,
            written=len(gated.written),
            skipped=len(gated.skipped),
            total=len(gated.written) + len(gated.skipped),
        )

    return PublishResult(
        provider_id=provider_id,
        tier=tier,
        keys_written=list(gated.written),
        keys_skipped=list(gated.skipped),
    )
