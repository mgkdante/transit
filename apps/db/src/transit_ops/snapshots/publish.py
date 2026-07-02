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

import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from transit_ops.db.connection import make_engine
from transit_ops.ingestion.common import utc_now
from transit_ops.settings import get_settings
from transit_ops.snapshots import builders, gate
from transit_ops.snapshots.contract import ReceiptsIndex, RouteReliabilityIndex
from transit_ops.snapshots.storage import (
    HashGatedStorage,
    build_snapshot_storage,
    state_fingerprint,
)
from transit_ops.sql_registry import named_query

logger = logging.getLogger(__name__)

# A work item handed to the parallel uploader: (rel_key, payload, tier).
_PutItem = "tuple[str, object, str]"

# Dataset-level skip probe (static tier only): is the LAST completed static publish for
# this provider already stamped at the current dataset version? generated_utc is stored as
# the static stamp (the dataset loaded_at_utc), so an exact timestamptz match means the
# bucket already holds the full, byte-identical static surface for this GTFS edition.
_STATIC_SKIP_MATCH_SQL = named_query(
    "publish.static_skip.match",
    "SELECT files_total FROM core.snapshot_publish_state "
    "WHERE provider_id = :provider_id AND tier = 'static' "
    "AND generated_utc = CAST(:stamp AS timestamptz) AND files_total > 0",
)

# Prior-generation coverage baseline for the publish gate (P0): the WHOLE-tier file
# count of the last successful publish for (provider_id, tier). One cheap indexed row
# lookup — never a bucket manifest read (a WAN round-trip defeats the daily-timeout
# fix). None (no prior row) => the gate's coverage-delta check is SKIPPED, so a
# first publish is never blocked.
_PRIOR_FILES_TOTAL_SQL = named_query(
    "publish.prior_files_total",
    "SELECT files_total FROM core.snapshot_publish_state "
    "WHERE provider_id = :provider_id AND tier = :tier",
)


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
    """Outcome of a :func:`publish_snapshot` call.

    ``gate_report`` carries the value-gate report dict for a SUCCESSFUL gated publish
    (None when the gate did not run — --no-gate, or a skipped/un-gated path), so CI /
    status can consume a report on success as well as on GateError.
    """

    provider_id: str
    tier: str
    keys_written: list[str] = field(default_factory=list)
    keys_skipped: list[str] = field(default_factory=list)
    gate_report: dict | None = None  # type: ignore[type-arg]

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
_RECORD_STATE_SQL = named_query(
    "publish.state.upsert",
    "INSERT INTO core.snapshot_publish_state "
    "(provider_id, tier, generated_utc, files_written, files_skipped, files_total, updated_at_utc) "
    "VALUES (:provider_id, :tier, :generated_utc, :written, :skipped, :total, now()) "
    "ON CONFLICT (provider_id, tier) DO UPDATE SET "
    "generated_utc = EXCLUDED.generated_utc, "
    "files_written = EXCLUDED.files_written, "
    "files_skipped = EXCLUDED.files_skipped, "
    "files_total = EXCLUDED.files_total, "
    "updated_at_utc = now()",
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

    conn.execute(  # type: ignore[attr-defined]
        _RECORD_STATE_SQL,
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

_STATIC_STAMP_SQL = named_query(
    "publish.static_stamp",
    "SELECT loaded_at_utc FROM core.dataset_versions "
    "WHERE provider_id = :provider_id AND dataset_kind = 'static_schedule' "
    "AND is_current = true ORDER BY loaded_at_utc DESC LIMIT 1",
)

# Routes that get a per-route reliability file. Sourced from the route delay spine
# (S7-B): the spine filters route_id IS NOT NULL at build, so the '__unrouted__'
# sentinel never appears and no historic/route_reliability/__unrouted__.json is
# published. Same route set as the (now-dropped) route_reliability_weekly/monthly
# marts, which derived from the same facts.
_DISTINCT_HISTORIC_ROUTE_IDS_SQL = named_query(
    "route.spine.route_ids",
    "SELECT DISTINCT route_id FROM gold.route_delay_spine"
    " WHERE provider_id = :provider_id",
)

# Per-route static-file enumerator: every route in the current dim.
_DIM_ROUTE_IDS_SQL = named_query(
    "static.dim_route_ids",
    "SELECT route_id FROM gold.dim_route WHERE provider_id = :provider_id ORDER BY route_id",
)


def _static_stamp(conn: object, provider_id: str) -> str:
    """Static-tier stamp = loaded_at_utc of the current static dataset version.

    Stable across unchanged daily reloads (the touch path never bumps
    loaded_at_utc), so static bytes only change when the dataset actually
    changes. Falls back to day-truncated now() when no version row exists.
    """

    row = conn.execute(  # type: ignore[attr-defined]
        _STATIC_STAMP_SQL, {"provider_id": provider_id}
    ).mappings().fetchone()
    if row is not None and row["loaded_at_utc"] is not None:
        return builders._iso(row["loaded_at_utc"])
    return utc_now().strftime("%Y-%m-%dT00:00:00Z")


def _historic_stamp() -> str:
    """Historic-tier stamp = day-truncated UTC (same-day re-runs become free skips)."""
    return utc_now().strftime("%Y-%m-%dT00:00:00Z")


def _build_live_items(conn: object, *, provider_id: str, settings: object, gen: str) -> list:
    """Build every live-tier payload into an ordered (rel_key, payload, tier) list.

    The manifest is LAST so its ``generated_utc`` (and the upload it drives) marks a
    complete, consistent snapshot rather than the start of the upload window.
    """
    return [
        (
            "live/vehicles.json",
            builders.build_vehicles(conn, provider_id=provider_id, generated_utc=gen),  # type: ignore[arg-type]
            "live",
        ),
        (
            "live/trips.json",
            builders.build_trips(conn, provider_id=provider_id, generated_utc=gen),  # type: ignore[arg-type]
            "live",
        ),
        (
            "live/alerts.json",
            builders.build_alerts(conn, provider_id=provider_id, generated_utc=gen),  # type: ignore[arg-type]
            "live",
        ),
        (
            "live/network.json",
            builders.build_network(conn, provider_id=provider_id, generated_utc=gen),  # type: ignore[arg-type]
            "live",
        ),
        (
            "live/stop_departures.json",
            builders.build_stop_departures(conn, provider_id=provider_id, generated_utc=gen),  # type: ignore[arg-type]
            "live",
        ),
        # manifest LAST — its generated_utc marks a fully-uploaded snapshot
        (
            "manifest.json",
            builders.build_manifest(
                conn,  # type: ignore[arg-type]
                provider_id=provider_id,
                generated_utc=gen,
                settings=settings,
            ),
            "live",
        ),
    ]


def _publish_live(
    conn: object,
    storage: object,
    *,
    provider_id: str,
    settings: object,
    gate_report: object | None = None,
) -> list[str]:
    """Build and upload all live-tier snapshot files; return the list of keys written.

    When *gate_report* is supplied the payloads are inspected before upload, but the
    live tier is WARN-ONLY (enforced with force=True by the caller) so a transient blip
    never aborts the ~57s cycle and blinds the map. Files upload sequentially in list
    order, manifest last.
    """
    gen = utc_now().strftime("%Y-%m-%dT%H:%M:%SZ")
    items = _build_live_items(conn, provider_id=provider_id, settings=settings, gen=gen)
    if gate_report is not None:
        # The live gate is best-effort observability only; a checker crash must NEVER
        # abort the ~57s cycle and blind the map, so record failures are logged and
        # swallowed (the cycle proceeds to upload regardless).
        for rel_key, payload, _tier in items:
            try:
                gate.record(gate_report, rel_key, payload)  # type: ignore[arg-type]
            except Exception:  # noqa: BLE001 — never let a gate crash abort the live cycle
                logger.exception("live gate check crashed for %s (skipped, cycle continues)", rel_key)
    written: list[str] = []
    for rel_key, payload, tier in items:
        written.append(storage.put_json(rel_key, payload, tier=tier))  # type: ignore[attr-defined]
    return written


def _build_historic_items(
    conn: object, *, provider_id: str, settings: object, stamp: str
) -> tuple[list, list, list]:
    """Build every historic-tier payload; return ``(items, route_items, stages)``.

    * *items* — the full ordered (rel_key, payload, tier) list, over which the gate
      runs a single build-then-gate pass (payload build precedes any upload).
    * *route_items* — the per-route subset (for the batch-level empty-route/coverage
      checks).
    * *stages* — the SAME items partitioned into ordered upload stages that MUST be
      uploaded one stage at a time, each stage COMPLETING before the next begins. A
      discovery index is its own singleton stage placed AFTER its per-entity stage, so
      it never advertises an entity whose file is still in flight (the pointer-last
      invariant). Concurrent upload within a stage is safe; across a stage boundary is
      not. The stage order is: flat files -> route files -> route index -> stop files
      -> receipt files -> receipts index.

    Per-entity files (route_reliability, stop_reliability, receipts) are BUILT
    sequentially on this thread — every builder touches the non-thread-safe DB *conn*.
    """

    items: list = []

    # --- flat historic files + provenance (small, fixed set) ---
    flat_items: list = [
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

    # --- per-route reliability files (routes that have history) ---
    route_rows = conn.execute(  # type: ignore[attr-defined]
        _DISTINCT_HISTORIC_ROUTE_IDS_SQL,
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

    # --- route-reliability discovery index (exact set published this run) ---
    # The always-current daily set of routes WITH a published reliability file — its
    # own upload stage AFTER the per-route stage (pointer-last) so it never advertises
    # a route whose file is still in flight. The web reads THIS (not the lag-prone
    # static routes_index `reliability` flag) to gate the list's reliability badges.
    route_index_item = (
        "historic/route_reliability/index.json",
        RouteReliabilityIndex(
            route_ids=sorted(str(route_id) for (route_id,) in route_rows if route_id is not None),
            generated_utc=stamp,
        ),
        "historic",
    )

    # --- per-stop reliability files (batched build) ---
    all_stops_rel = builders.build_stop_reliability(conn, provider_id=provider_id, generated_utc=stamp)  # type: ignore[arg-type]
    stop_items = [
        (f"historic/stop_reliability/{stop_id}.json", stop_rel, "historic")
        for stop_id, stop_rel in sorted(all_stops_rel.items())
    ]

    # --- per-date receipts (batched build) ---
    all_receipts = builders.build_receipts(conn, provider_id, generated_utc=stamp)  # type: ignore[arg-type]
    receipt_items = [
        (f"historic/receipts/{date_str}.json", receipt, "historic")
        for date_str, receipt in sorted(all_receipts.items())
    ]

    # --- receipts discovery index (exact set published this run) ---
    # Its own upload stage AFTER the receipt stage so it never references an in-flight
    # date — the same pointer-last invariant the manifest follows for the run.
    receipts_index_item = (
        "historic/receipts/index.json",
        ReceiptsIndex(dates=sorted(all_receipts), generated_utc=stamp),
        "historic",
    )

    # Ordered upload stages: each stage completes before the next; a discovery index
    # is a singleton stage after its per-entity stage (pointer-last invariant).
    stages: list = [
        flat_items,
        route_items,
        [route_index_item],
        stop_items,
        receipt_items,
        [receipts_index_item],
    ]
    for stage in stages:
        items.extend(stage)

    return items, route_items, stages


def _find_network_trend(items: list) -> tuple[str, object] | None:
    """Return the (rel_key, payload) of the historic network_trend file, or None."""
    for rel_key, payload, *_ in items:
        if rel_key == "historic/network_trend.json":
            return (rel_key, payload)
    return None


def _publish_historic(
    conn: object,
    storage: object,
    *,
    provider_id: str,
    settings: object,
    stamp: str | None = None,
    gate_report: object | None = None,
    prior_files_total: int | None = None,
    force: bool = False,
) -> list[str]:
    """Build and upload all historic-tier snapshot files; return the list of keys written.

    *stamp* is the day-truncated DATA-time stamp every artifact carries; when
    omitted (direct callers / older tests) it defaults to today's truncated UTC.

    When *gate_report* is supplied the FULL payload set is built into memory FIRST,
    the value gate runs over it (with the batch-level coverage/empty-route aggregates),
    then ``gate.enforce`` is called BEFORE any upload — so a failed gate uploads NOTHING
    (all-or-nothing) and the caller's transaction rolls back with state un-advanced.

    Uploads run STAGED: within each stage puts fan out through a bounded thread pool,
    but a stage COMPLETES before the next begins, so a discovery index (its own stage)
    is only PUT after every per-entity file in the preceding stage finished — the
    pointer-last invariant. Only the upload is staged; the build+gate is one pass.
    """
    if stamp is None:
        stamp = _historic_stamp()

    concurrency = _concurrency(settings)

    items, route_items, stages = _build_historic_items(
        conn, provider_id=provider_id, settings=settings, stamp=stamp
    )

    if gate_report is not None:
        for rel_key, payload, _tier in items:
            gate.record(gate_report, rel_key, payload)  # type: ignore[arg-type]
        gate.finalize_batch(
            gate_report,  # type: ignore[arg-type]
            route_payloads=[(k, p) for (k, p, _t) in route_items],
            current_total=len(items),
            prior_files_total=prior_files_total,
            network_trend=_find_network_trend(items),
        )
        # Enforce BEFORE the first put — a failed gate uploads nothing.
        gate.enforce(gate_report, force=force)  # type: ignore[arg-type]

    written: list[str] = []
    for stage in stages:
        written.extend(_parallel_put(storage, stage, concurrency=concurrency))
    return written


def _publish_static(
    conn: object, storage: object, *, provider_id: str, settings: object, stamp: str | None = None
) -> list[str]:
    """Build and upload all static-tier snapshot files; return the list of keys written.

    *stamp* is the dataset-loaded DATA-time every artifact carries; when omitted
    it is derived from the current static dataset version.
    """

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
            builders.build_labels(conn, provider_id=provider_id, lang=lang, generated_utc=stamp),  # type: ignore[arg-type]
            "static",
        ))
    written.extend(_parallel_put(storage, head_items, concurrency=concurrency))

    # --- per-route files (built sequentially on this conn, uploaded in pool) ---
    route_rows = conn.execute(  # type: ignore[attr-defined]
        _DIM_ROUTE_IDS_SQL,
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


def _prior_files_total(conn: object, *, provider_id: str, tier: str) -> int | None:
    """Return the last publish's WHOLE-tier files_total for the gate's coverage-delta.

    One cheap indexed row lookup; None when no prior row (first publish -> the gate
    skips the coverage-delta check, never blocks a first publish).
    """

    row = conn.execute(  # type: ignore[attr-defined]
        _PRIOR_FILES_TOTAL_SQL, {"provider_id": provider_id, "tier": tier}
    ).fetchone()
    if row is None:
        return None
    return row[0]


def publish_snapshot(
    provider_id: str,
    *,
    tier: str = "live",
    settings: object = None,
    registry: object = None,  # accepted for signature parity; reserved for route registry
    engine: object = None,
    storage: object = None,
    gate_enabled: bool = True,
    force: bool = False,
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
    gate_enabled:
        Run the value gate over the built payloads before upload (default True).
        On the HISTORIC tier a gate ERROR aborts the publish (rolls the txn back,
        state un-advanced) unless *force* is set. On the LIVE tier the gate is
        WARN-ONLY — it never aborts the ~57s cycle (findings are logged only). The
        STATIC tier registers only the universal sentinel/NaN scan.
    force:
        Publish even when the gate finds ERROR-severity issues (a logged
        "GATE OVERRIDDEN" warning lists them). Ignored on the live tier, which is
        already WARN-only.

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
        # The gate is WARN-ONLY here (records findings, never aborts the cycle).
        with engine.begin() as conn:  # type: ignore[attr-defined]
            gen = utc_now().strftime("%Y-%m-%dT%H:%M:%SZ")
            live_report = gate.new_report(provider_id, tier, gen) if gate_enabled else None
            keys = _publish_live(
                conn, storage, provider_id=provider_id, settings=settings, gate_report=live_report
            )
        if live_report is not None:
            gate.enforce(live_report, force=True)  # WARN-only: never aborts live
        return PublishResult(
            provider_id=provider_id, tier=tier, keys_written=keys,
            gate_report=live_report.to_dict() if live_report is not None else None,
        )

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
        # DATASET-LEVEL SKIP (static only): the static surface (routes / stops / shapes
        # indexes + per-route + per-stop files) is a PURE FUNCTION of the GTFS dataset
        # version. When the last COMPLETE static publish already used this exact stamp AND
        # the hash-state fingerprint still matches (cache-policy / format version unchanged),
        # every one of the ~9k payloads would rebuild byte-identical and the per-file gate
        # would skip all of them — so skip the whole rebuild, which otherwise re-queries the
        # entire surface over WAN every run (the daily 90-min static-publish timeout). A NEW
        # GTFS edition bumps the stamp -> no match -> full rebuild (a real schedule change
        # NEVER stalls); a cache/format change leaves fingerprint_matched False -> full
        # rebuild + re-stamp. Static-builder OUTPUT changes must bump the state_fingerprint
        # version so they invalidate this gate. Historic/live are excluded: their data
        # changes continuously for a fixed stamp, so they always rebuild.
        if tier == "static" and gated.fingerprint_matched:
            match = conn.execute(  # type: ignore[attr-defined]
                _STATIC_SKIP_MATCH_SQL,
                {"provider_id": provider_id, "stamp": stamp},
            ).fetchone()
            if match is not None:
                logger.info(
                    "static publish: dataset unchanged (stamp=%s) — skipped rebuild of %d files",
                    stamp,
                    match[0],
                )
                return PublishResult(
                    provider_id=provider_id, tier=tier, keys_written=[], keys_skipped=[]
                )
        report = None  # the value-gate report for a successful gated publish (FIX-6)
        if tier == "historic":
            # Historic gate: build the whole set, inspect it, enforce BEFORE the first
            # put so a failed gate uploads NOTHING and this txn rolls back with state
            # un-advanced. force bypasses ERROR abort (a logged override). The coverage
            # baseline is the prior publish's WHOLE-tier files_total (None on first run).
            report = gate.new_report(provider_id, tier, stamp) if gate_enabled else None
            prior_total = (
                _prior_files_total(conn, provider_id=provider_id, tier=tier)
                if gate_enabled
                else None
            )
            _publish_historic(
                conn,
                gated,
                provider_id=provider_id,
                settings=settings,
                stamp=stamp,
                gate_report=report,
                prior_files_total=prior_total,
                force=force,
            )
        elif tier == "static" and gate_enabled:
            # Static gate: build the surface once into a collector (no network), run the
            # universal sentinel/NaN scan over every payload, enforce BEFORE any upload
            # (all-or-nothing; force downgrades ERROR to a logged override), then upload
            # the ALREADY-BUILT payloads through the hash-gate — no second DB build.
            store = _CollectingStorage()
            _publish_static(conn, store, provider_id=provider_id, settings=settings, stamp=stamp)
            report = gate.new_report(provider_id, tier, stamp)
            for rel_key, payload in store.collected:
                gate.record(report, rel_key, payload)
            gate.enforce(report, force=force)
            _parallel_put(
                gated,
                [(k, p, "static") for (k, p) in store.collected],
                concurrency=_concurrency(settings),
            )
        else:
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
        gate_report=report.to_dict() if report is not None else None,
    )


# --- read-only pre-publish audit (validate-snapshots) ------------------------


class _CollectingStorage:
    """No-op storage that records ``(rel_key, payload)`` and uploads nothing.

    Drives the SAME per-tier build path as a real publish so validate-snapshots (and
    the pre-upload static gate) exercise every builder over the real DB but never touch
    the network. Only ``put_json`` is implemented — it records the payload and returns
    the key — because the publishers call nothing else on this storage; it is used
    directly (never wrapped in a HashGatedStorage), so no hash-gate methods are needed.
    """

    def __init__(self) -> None:
        self.collected: list[tuple[str, object]] = []

    def put_json(self, rel_key: str, payload: object, *, tier: str) -> str:  # noqa: ARG002
        self.collected.append((rel_key, payload))
        return rel_key


def collect_payloads(
    provider_id: str,
    *,
    tier: str,
    settings: object = None,
    engine: object = None,
) -> tuple[list[tuple[str, object]], list[tuple[str, object]], str, int | None]:
    """Build every payload for *tier* WITHOUT uploading; return the collected set.

    Returns ``(all_items, route_items, stamp, prior_files_total)`` — reusing the exact
    same build code the publisher runs, so a validate-snapshots audit sees what a real
    publish would. Reads run on a plain ``engine.connect()`` (no transaction opened),
    so nothing is ever committed and nothing is written to the bucket.
    """
    settings = settings or get_settings()
    engine = engine or make_engine(settings)  # type: ignore[arg-type]

    with engine.connect() as conn:  # type: ignore[attr-defined]
        if tier == "live":
            gen = utc_now().strftime("%Y-%m-%dT%H:%M:%SZ")
            items = _build_live_items(conn, provider_id=provider_id, settings=settings, gen=gen)
            return ([(k, p) for (k, p, _t) in items], [], gen, None)

        if tier == "historic":
            stamp = _historic_stamp()
            items, route_items, _stages = _build_historic_items(
                conn, provider_id=provider_id, settings=settings, stamp=stamp
            )
            prior_total = _prior_files_total(conn, provider_id=provider_id, tier=tier)
            return (
                [(k, p) for (k, p, _t) in items],
                [(k, p) for (k, p, _t) in route_items],
                stamp,
                prior_total,
            )

        if tier == "static":
            stamp = _static_stamp(conn, provider_id)
            store = _CollectingStorage()
            _publish_static(conn, store, provider_id=provider_id, settings=settings, stamp=stamp)
            return (list(store.collected), [], stamp, None)

        raise ValueError(f"unknown tier {tier!r} (expected live, static, historic)")


def validate_snapshots(
    provider_id: str,
    *,
    tier: str = "historic",
    settings: object = None,
    engine: object = None,
) -> gate.GateReport:
    """Read-only pre-publish audit: build every payload, run the gate, return the report.

    Never uploads and never raises on findings (the caller decides its exit code from
    the returned report). The historic tier additionally runs the batch-level
    coverage-delta + empty-route aggregates via ``gate.finalize_batch``.
    """
    all_items, route_items, stamp, prior_total = collect_payloads(
        provider_id, tier=tier, settings=settings, engine=engine
    )
    report = gate.new_report(provider_id, tier, stamp)
    for rel_key, payload in all_items:
        gate.record(report, rel_key, payload)
    if tier == "historic":
        gate.finalize_batch(
            report,
            route_payloads=route_items,
            current_total=len(all_items),
            prior_files_total=prior_total,
            network_trend=next(
                ((k, p) for (k, p) in all_items if k == "historic/network_trend.json"), None
            ),
        )
    return report
