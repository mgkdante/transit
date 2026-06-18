"""Publish orchestrator — builds and uploads all snapshot tiers (live, static, historic).

Ties together:
  - :func:`transit_ops.snapshots.builders` — SQL -> Pydantic models
  - :func:`transit_ops.snapshots.storage.build_snapshot_storage` — PUT to R2 / local disk

Usage (programmatic)::

    from transit_ops.snapshots.publish import publish_snapshot
    result = publish_snapshot("stm")
    print(result.display_dict())

The ``registry`` parameter is accepted for signature parity with CLI / cycle
callers.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
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

# A work item handed to the parallel uploader: (rel_key, payload, tier).
_PutItem = "tuple[str, object, str]"


def _concurrency(settings: object) -> int:
    """Resolve the bounded upload fan-out from settings (default 16, floor 1)."""
    value = getattr(settings, "SNAPSHOT_PUBLISH_CONCURRENCY", 16)
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return 16


def _parallel_put(storage: object, items: list, *, concurrency: int) -> list[str]:
    """Upload every ``(rel_key, payload, tier)`` in *items* and return the keys.

    Uploads run through a bounded :class:`ThreadPoolExecutor` so the per-file
    network round-trips overlap — the new-GTFS-edition-day fix where the
    hash-gate skips nothing and all files must be re-PUT. Guarantees preserved:

    * The hash-gate still applies per file (a skipped file does no PUT) — that
      decision lives in ``HashGatedStorage.put_json``, which is thread-safe.
    * Every future is collected; the FIRST upload to raise propagates out (no
      silent swallowing) after the pool drains.
    * ``concurrency <= 1`` runs the puts sequentially (no pool) — used by tests
      and as an escape hatch.

    Returned keys are in the same order as *items* so callers keep deterministic
    result ordering regardless of thread completion order.
    """
    if not items:
        return []
    if concurrency <= 1:
        return [
            storage.put_json(rel_key, payload, tier=tier)  # type: ignore[attr-defined]
            for (rel_key, payload, tier) in items
        ]

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [
            pool.submit(storage.put_json, rel_key, payload, tier=tier)  # type: ignore[attr-defined]
            for (rel_key, payload, tier) in items
        ]
        # Resolve in submission order; the first exception re-raises here, and
        # the `with` block still joins the remaining workers on the way out.
        return [future.result() for future in futures]


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
    written.append(
        storage.put_json(  # type: ignore[attr-defined]
            "live/stop_departures.json",
            builders.build_stop_departures(conn, provider_id=provider_id, generated_utc=gen),  # type: ignore[arg-type]
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

    Per-entity files (route_reliability, stop_reliability, receipts) are BUILT
    sequentially on this thread — every builder touches the non-thread-safe DB
    *conn* — then UPLOADED concurrently through a bounded thread pool. The
    receipts discovery index is uploaded only after the receipt files complete,
    so it never advertises a date whose file is still in flight.
    """
    from sqlalchemy import text as _text

    if stamp is None:
        stamp = _historic_stamp()

    concurrency = _concurrency(settings)
    written: list[str] = []

    # --- flat historic files + provenance (small, fixed set) ---
    flat_items = [
        (
            "historic/network_trend.json",
            builders.build_network_trend(conn, provider_id=provider_id, generated_utc=stamp),  # type: ignore[arg-type]
            "historic",
        ),
        (
            "historic/hotspots.json",
            builders.build_hotspots(conn, provider_id, generated_utc=stamp),  # type: ignore[arg-type]
            "historic",
        ),
        (
            "historic/repeat_offenders.json",
            builders.build_repeat_offenders(conn, provider_id, generated_utc=stamp),  # type: ignore[arg-type]
            "historic",
        ),
        (
            "historic/alert_history.json",
            builders.build_alert_history(conn, provider_id, generated_utc=stamp),  # type: ignore[arg-type]
            "historic",
        ),
        # provenance at top-level (not under historic/)
        (
            "provenance.json",
            builders.build_provenance(conn, provider_id, generated_utc=stamp),  # type: ignore[arg-type]
            "historic",
        ),
    ]
    written.extend(_parallel_put(storage, flat_items, concurrency=concurrency))

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
    route_items = [
        (
            f"historic/route_reliability/{route_id}.json",
            builders.build_route_reliability(conn, provider_id=provider_id, route_id=str(route_id), generated_utc=stamp),  # type: ignore[arg-type]
            "historic",
        )
        for (route_id,) in route_rows
        if route_id is not None
    ]
    written.extend(_parallel_put(storage, route_items, concurrency=concurrency))

    # --- per-stop reliability files (batched build, parallel upload) ---
    all_stops_rel = builders.build_stop_reliability(conn, provider_id=provider_id, generated_utc=stamp)  # type: ignore[arg-type]
    stop_items = [
        (f"historic/stop_reliability/{stop_id}.json", stop_rel, "historic")
        for stop_id, stop_rel in sorted(all_stops_rel.items())
    ]
    written.extend(_parallel_put(storage, stop_items, concurrency=concurrency))

    # --- per-date receipts (batched build, parallel upload) ---
    all_receipts = builders.build_receipts(conn, provider_id, generated_utc=stamp)  # type: ignore[arg-type]
    receipt_items = [
        (f"historic/receipts/{date_str}.json", receipt, "historic")
        for date_str, receipt in sorted(all_receipts.items())
    ]
    written.extend(_parallel_put(storage, receipt_items, concurrency=concurrency))

    # --- receipts discovery index (exact set published this run) ---
    # Uploaded AFTER every receipt file lands so it never references an in-flight
    # date — same "pointer last" invariant the manifest follows for the run.
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

    concurrency = _concurrency(settings)
    written: list[str] = []

    # --- indexes + basemap + labels (small fixed set, built sequentially) ---
    # Build the routes index + all per-stop data FIRST so the stops index can
    # carry each stop's `mode` + short `routes` list with NO second heavy query:
    # the route_type map and routes-served map are derived in memory from these,
    # and all_stops is reused below for the per-stop uploads.
    routes_idx = builders.build_routes_index(  # type: ignore[arg-type]
        conn, provider_id=provider_id, generated_utc=stamp
    )
    all_stops = builders.build_all_stops_data(  # type: ignore[arg-type]
        conn, provider_id=provider_id, generated_utc=stamp
    )
    route_type_by_id = {e.id: e.type for e in routes_idx.routes}
    routes_served_by_stop = {sid: sf.routes_served for sid, sf in all_stops.items()}
    stops_index = builders.build_stops_index(
        conn,  # type: ignore[arg-type]
        provider_id=provider_id,
        generated_utc=stamp,
        routes_served_by_stop=routes_served_by_stop,
        route_type_by_id=route_type_by_id,
    )

    head_items: list = [
        ("static/routes_index.json", routes_idx, "static"),
        ("static/stops_index.json", stops_index, "static"),
    ]
    # Basemap pointer — only when SNAPSHOT_BASEMAP_PMTILES_URL is configured.
    bm = builders.build_basemap(settings, generated_utc=stamp)
    if bm is not None:
        head_items.append(("static/basemap.json", bm, "static"))
    for lang in ("fr", "en"):
        head_items.append((
            f"labels/{lang}.json",
            builders.build_labels(conn, lang=lang, generated_utc=stamp),  # type: ignore[arg-type]
            "static",
        ))
    written.extend(_parallel_put(storage, head_items, concurrency=concurrency))

    # --- per-route files (built sequentially on this conn, uploaded in pool) ---
    route_rows = conn.execute(  # type: ignore[attr-defined]
        _text("SELECT route_id FROM gold.dim_route WHERE provider_id = :provider_id ORDER BY route_id"),
        {"provider_id": provider_id},
    ).fetchall()
    route_items = [
        (
            f"static/routes/{route_id}.json",
            builders.build_route(conn, provider_id=provider_id, route_id=str(route_id), generated_utc=stamp),  # type: ignore[arg-type]
            "static",
        )
        for (route_id,) in route_rows
    ]
    written.extend(_parallel_put(storage, route_items, concurrency=concurrency))

    # --- per-stop files (reuse all_stops built above, parallel upload) ---
    stop_items = [
        (f"static/stops/{stop_id}.json", stop_file, "static")
        for stop_id, stop_file in sorted(all_stops.items())
    ]
    written.extend(_parallel_put(storage, stop_items, concurrency=concurrency))

    return written


def publish_snapshot(
    provider_id: str,
    *,
    tier: str = "live",
    settings: object = None,
    registry: object = None,  # accepted for signature parity; reserved for route registry
    engine: object = None,
    storage: object = None,
) -> PublishResult:
    """Publish all snapshot files for *provider_id* to the configured backend.

    Parameters
    ----------
    provider_id:
        Transit provider identifier, e.g. ``"stm"``.
    tier:
        Data tier to publish.  ``"live"``, ``"static"``, and ``"historic"``
        are implemented; any other value raises :exc:`ValueError`.
    settings:
        Application settings object.  When ``None`` the real
        :func:`~transit_ops.settings.get_settings` is called.
    registry:
        Reserved for future route-registry injection.
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
        raise ValueError(f"unknown tier {tier!r} (expected live, static, historic)")

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
