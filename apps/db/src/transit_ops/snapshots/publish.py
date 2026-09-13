"""Build, gate, and upload live, static, and historic snapshot tiers."""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from typing import Any, cast

from sqlalchemy import bindparam
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import Connection, Engine

from transit_ops.db.connection import make_engine
from transit_ops.gold.delay_days import assert_daily_delay_history_clean
from transit_ops.gold.delay_hours import assert_historic_delay_means_current
from transit_ops.ingestion.common import utc_now
from transit_ops.settings import Settings, get_settings
from transit_ops.snapshots import builders, envelope, gate, historic_tier, uploads
from transit_ops.snapshots import historic_receipts as _historic
from transit_ops.snapshots.builders._helpers import _iso, _static_schedule_context
from transit_ops.snapshots.historic_receipts import (
    _HistoricPhaseLedger,
    _HistoricPublishRun,
)
from transit_ops.snapshots.historic_tier import HistoricValidationInputs
from transit_ops.snapshots.protocols import (
    CollectedItem,
    HistoricObjectStore,
    PayloadSink,
    PutItem,
    SnapshotObjectStore,
    SnapshotPayload,
)
from transit_ops.snapshots.publication_lane import (
    PublishLockUnavailableError as PublishLockUnavailableError,
)
from transit_ops.snapshots.publication_lane import acquire_publication_lane
from transit_ops.snapshots.storage import (
    HashGatedStorage,
    HistoricHashGatedStorage,
    build_snapshot_storage,
    state_fingerprint,
)
from transit_ops.sql_registry import named_query

logger = logging.getLogger(__name__)

type _LegacyCollected = tuple[list[CollectedItem], list[CollectedItem], str, int | None]


_REPEATABLE_READ_SQL = named_query(
    "publish.snapshot.repeatable_read",
    "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ",
)

_STATIC_SKIP_MATCH_SQL = named_query(
    "publish.static_skip.match",
    "SELECT files_total FROM core.snapshot_publish_state "
    "WHERE provider_id = :provider_id AND tier = 'static' "
    "AND generated_utc = CAST(:stamp AS timestamptz) AND files_total > 0",
)

# Coverage uses the previous whole-tier total; the first publish has no baseline.
_PRIOR_FILES_TOTAL_SQL = named_query(
    "publish.prior_files_total",
    "SELECT COALESCE(stable_files_total, files_total) FROM core.snapshot_publish_state "
    "WHERE provider_id = :provider_id AND tier = :tier",
)


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
    gate_report: dict[str, object] | None = None
    historic_telemetry: dict[str, object] | None = None

    def display_dict(self) -> dict[str, object]:
        result: dict[str, object] = {
            "provider_id": self.provider_id,
            "tier": self.tier,
            "keys_written": self.keys_written,
            "files_written": len(self.keys_written),
            "files_skipped": len(self.keys_skipped),
        }
        if self.historic_telemetry is not None:
            result["historic_telemetry"] = self.historic_telemetry
        return result


# Publish state commits after uploads in the owning database transaction.
_RECORD_STATE_SQL = named_query(
    "publish.state.upsert",
    "INSERT INTO core.snapshot_publish_state "
    "(provider_id, tier, generated_utc, files_written, files_skipped, files_total, "
    " stable_files_total, "
    " gate_checks_run, gate_errors, gate_warnings, gate_verdict, gate_generated_utc, "
    + _historic._HISTORIC_STATE_COLUMNS_SQL
    + "updated_at_utc) "
    "VALUES (:provider_id, :tier, :generated_utc, :written, :skipped, :total, "
    " :stable_total, "
    " :gate_checks_run, :gate_errors, :gate_warnings, :gate_verdict, "
    " CAST(:gate_generated_utc AS timestamptz), "
    + _historic._HISTORIC_STATE_VALUES_SQL
    + "now()) "
    "ON CONFLICT (provider_id, tier) DO UPDATE SET "
    "generated_utc = EXCLUDED.generated_utc, "
    "files_written = EXCLUDED.files_written, "
    "files_skipped = EXCLUDED.files_skipped, "
    "files_total = EXCLUDED.files_total, "
    "stable_files_total = EXCLUDED.stable_files_total, "
    "gate_checks_run = EXCLUDED.gate_checks_run, "
    "gate_errors = EXCLUDED.gate_errors, "
    "gate_warnings = EXCLUDED.gate_warnings, "
    "gate_verdict = EXCLUDED.gate_verdict, "
    "gate_generated_utc = EXCLUDED.gate_generated_utc, "
    + _historic._HISTORIC_STATE_UPDATES_SQL
    + "updated_at_utc = now()",
).bindparams(bindparam("historic_phase_detail", type_=JSONB(none_as_null=True)))


def _gate_summary(report: Mapping[str, object] | None) -> dict[str, object]:
    """Extract the persistable gate summary from a GateReport.to_dict() dict.

    verdict = 'fail' when any ERROR finding exists, else 'warn' when any WARN
    finding exists, else 'pass'. Returns all-None when *report* is None (the gate
    did not run for this tier — --no-gate, or a static dataset-level SKIP), so the
    honest-NULL boundary of migration 0078 is preserved (never a fabricated pass).
    """
    if report is None:
        return {
            "gate_checks_run": None,
            "gate_errors": None,
            "gate_warnings": None,
            "gate_verdict": None,
            "gate_generated_utc": None,
        }
    errors = int(cast(Any, report.get("errors") or 0))
    warnings = int(cast(Any, report.get("warnings") or 0))
    verdict = "fail" if errors > 0 else ("warn" if warnings > 0 else "pass")
    return {
        "gate_checks_run": report.get("checks_run"),
        "gate_errors": errors,
        "gate_warnings": warnings,
        "gate_verdict": verdict,
        "gate_generated_utc": report.get("generated_utc"),
    }


def _record_publish_state(
    conn: Connection,
    *,
    provider_id: str,
    tier: str,
    generated_utc: object,
    written: int,
    skipped: int,
    total: int,
    stable_total: int | None = None,
    gate_report: Mapping[str, object] | None = None,
    historic_telemetry: Mapping[str, object] | None = None,
) -> None:
    """Upsert the per-tier publish-state row inside the caller's transaction.

    *gate_report* is a GateReport.to_dict() dict (or None when the gate did not
    run); its counts + derived verdict are persisted alongside the file counts so
    the S11 data-health payload can serve the last gate outcome per lane.
    """

    conn.execute(
        _RECORD_STATE_SQL,
        {
            "provider_id": provider_id,
            "tier": tier,
            "generated_utc": generated_utc,
            "written": written,
            "skipped": skipped,
            "total": total,
            "stable_total": total if stable_total is None else stable_total,
            **_gate_summary(gate_report),
            **_historic._historic_publish_state_fields(
                tier=tier, historic_telemetry=historic_telemetry
            ),
        },
    )


_STATIC_STAMP_SQL = named_query(
    "publish.static_stamp",
    "SELECT loaded_at_utc FROM core.dataset_versions "
    "WHERE provider_id = :provider_id AND dataset_kind = 'static_schedule' "
    "AND is_current = true ORDER BY loaded_at_utc DESC LIMIT 1",
)

def _static_stamp(conn: Connection, provider_id: str) -> str:
    """Static-tier stamp = loaded_at_utc of the current static dataset version.

    Stable across unchanged daily reloads (the touch path never bumps
    loaded_at_utc), so static bytes only change when the dataset actually
    changes. Falls back to day-truncated now() when no version row exists.
    """

    row = (
        conn.execute(
            _STATIC_STAMP_SQL, {"provider_id": provider_id}
        )
        .mappings()
        .fetchone()
    )
    if row is not None and row["loaded_at_utc"] is not None:
        return _iso(row["loaded_at_utc"])
    return utc_now().strftime("%Y-%m-%dT00:00:00Z")


def _build_live_items(
    conn: Connection, *, provider_id: str, settings: Settings, gen: str) -> list[PutItem]:
    """Build every live-tier payload into an ordered (rel_key, payload, tier) list.

    Builders share the caller's database snapshot. The manifest uploads last;
    its timestamp is the build start, not proof of atomic multi-file visibility.
    """
    return [
        (
            "live/vehicles.json",
            builders.build_vehicles(conn, provider_id=provider_id, generated_utc=gen),
            "live",
        ),
        (
            "live/trips.json",
            builders.build_trips(conn, provider_id=provider_id, generated_utc=gen),
            "live",
        ),
        (
            "live/alerts.json",
            builders.build_alerts(conn, provider_id=provider_id, generated_utc=gen),
            "live",
        ),
        (
            "live/network.json",
            builders.build_network(conn, provider_id=provider_id, generated_utc=gen),
            "live",
        ),
        (
            "live/stop_departures.json",
            builders.build_stop_departures(conn, provider_id=provider_id, generated_utc=gen),
            "live",
        ),
        # Health reads the prior completed publish; this cycle saves its state after upload.
        (
            "status/data_health.json",
            builders.build_data_health(conn, provider_id=provider_id, generated_utc=gen),
            "live",
        ),
        # Upload the manifest after its referenced live files.
        (
            "manifest.json",
            builders.build_manifest(
                conn,
                provider_id=provider_id,
                generated_utc=gen,
                settings=settings,
            ),
            "live",
        ),
    ]


def _publish_live(
    conn: Connection,
    storage: PayloadSink,
    *,
    provider_id: str,
    settings: Settings,
    gate_report: gate.GateReport | None = None,
    gen: str | None = None,
) -> list[str]:
    """Build and upload all live-tier snapshot files; return the list of keys written.

    When *gate_report* is supplied the payloads are inspected before upload, but the
    live tier is WARN-ONLY (enforced with force=True by the caller) so a transient blip
    never aborts the realtime cycle. Child files upload through the
    bounded pool; the manifest starts only after they all finish successfully.

    *gen* is the cycle's ONE publish stamp: the caller threads the same value it
    persists to snapshot_publish_state, so the manifest, envelope stamps, gate
    report, and the data-health lane row use the same timestamp.
    """
    if gen is None:
        gen = utc_now().strftime("%Y-%m-%dT%H:%M:%SZ")
    items = _build_live_items(conn, provider_id=provider_id, settings=settings, gen=gen)
    envelope.stamp_envelope(items, provider_id=provider_id, stamp=gen)
    if gate_report is not None:
        # Live gate failures are recorded without blocking publication.
        for rel_key, payload, _tier in items:
            try:
                gate.record(gate_report, rel_key, payload)
            except Exception:  # noqa: BLE001 — never let a gate crash abort the live cycle
                logger.exception(
                    "live gate check crashed for %s (skipped, cycle continues)", rel_key
                )
    written = uploads.put_batch(
        storage,
        items[:-1],
        concurrency=uploads.concurrency(settings),
    )
    rel_key, payload, tier = items[-1]
    written.append(storage.put_json(rel_key, payload, tier=tier))
    return written


def _publish_static(
    conn: Connection, storage: PayloadSink, *,
    provider_id: str, settings: Settings, stamp: str | None = None,
) -> list[str]:
    """Build and upload all static-tier snapshot files; return the list of keys written.

    *stamp* is the dataset-loaded DATA-time every artifact carries; when omitted
    it is derived from the current static dataset version.
    """

    if stamp is None:
        stamp = _static_stamp(conn, provider_id)

    concurrency = uploads.concurrency(settings)
    written: list[str] = []
    static_context = _static_schedule_context(
        conn, provider_id=provider_id
    )

    # Reuse route and stop data for discovery fields and entity uploads.
    routes_idx = builders.build_routes_index(
        conn, provider_id=provider_id, generated_utc=stamp
    )
    all_stops = builders.build_all_stops_data(
        conn,
        provider_id=provider_id,
        generated_utc=stamp,
        static_context=static_context,
    )
    route_type_by_id = {e.id: e.type for e in routes_idx.routes}
    routes_served_by_stop = {sid: sf.routes_served for sid, sf in all_stops.items()}
    stops_index = builders.build_stops_index(
        conn,
        provider_id=provider_id,
        generated_utc=stamp,
        routes_served_by_stop=routes_served_by_stop,
        route_type_by_id=route_type_by_id,
    )

    head_items: list[PutItem] = [
        ("static/routes_index.json", routes_idx, "static"),
        ("static/stops_index.json", stops_index, "static"),
    ]
    bm = builders.build_basemap(settings, generated_utc=stamp)
    if bm is not None:
        head_items.append(("static/basemap.json", bm, "static"))
    for lang in ("fr", "en"):
        head_items.append(
            (
                f"labels/{lang}.json",
                builders.build_labels(
                    conn, provider_id=provider_id, lang=lang, generated_utc=stamp
                ),
                "static",
            )
        )
    envelope.stamp_envelope(head_items, provider_id=provider_id, stamp=stamp)
    written.extend(uploads.put_batch(storage, head_items, concurrency=concurrency))

    all_routes = builders.build_all_routes_data(
        conn,
        provider_id=provider_id,
        generated_utc=stamp,
        static_context=static_context,
    )
    route_items: list[PutItem] = [
        (
            f"static/routes/{route_id}.json",
            route_file,
            "static",
        )
        for route_id, route_file in sorted(all_routes.items())
    ]
    envelope.stamp_envelope(route_items, provider_id=provider_id, stamp=stamp)
    written.extend(uploads.put_batch(storage, route_items, concurrency=concurrency))

    stop_items: list[PutItem] = [
        (f"static/stops/{stop_id}.json", stop_file, "static")
        for stop_id, stop_file in sorted(all_stops.items())
    ]
    envelope.stamp_envelope(stop_items, provider_id=provider_id, stamp=stamp)
    written.extend(uploads.put_batch(storage, stop_items, concurrency=concurrency))

    return written


def _prior_files_total(conn: Connection, *, provider_id: str, tier: str) -> int | None:
    """Return the last publish's WHOLE-tier files_total for the gate's coverage-delta.

    One cheap indexed row lookup; None when no prior row (first publish -> the gate
    skips the coverage-delta check, never blocks a first publish).
    """

    row = conn.execute(
        _PRIOR_FILES_TOTAL_SQL, {"provider_id": provider_id, "tier": tier}
    ).fetchone()
    if row is None:
        return None
    return cast(int, row[0])


def publish_snapshot(
    provider_id: str,
    *,
    tier: str = "live",
    settings: Settings | None = None,
    registry: object = None,  # accepted for signature parity; reserved for route registry
    engine: Engine | None = None,
    storage: PayloadSink | SnapshotObjectStore | None = None,
    gate_enabled: bool = True,
    force: bool = False,
    full_historic_rebuild: bool = False,
) -> PublishResult:
    """Publish *provider_id* to the configured live, static, or historic tier.

    Missing settings, engine, and storage dependencies are constructed here.
    Historic payload quality-gate errors can be forced; dirty daily history
    cannot. Live quality gates are warn-only. Full rebuild is historic-only.
    """
    if full_historic_rebuild and tier != "historic":
        raise ValueError("--full-historic-rebuild requires tier='historic'")

    if tier == "historic" and storage is not None and not isinstance(storage, HistoricObjectStore):
        raise TypeError("historic storage requires immutable writes and conditional activation")
    settings = settings or get_settings()

    engine = engine or make_engine(settings)
    if storage is None:
        owned_storage = build_snapshot_storage(settings, provider_id=provider_id)
        try:
            return publish_snapshot(
                provider_id,
                tier=tier,
                settings=settings,
                registry=registry,
                engine=engine,
                storage=owned_storage,
                gate_enabled=gate_enabled,
                force=force,
                full_historic_rebuild=full_historic_rebuild,
            )
        finally:
            close = getattr(owned_storage, "close", None)
            if callable(close):
                close()

    if tier == "live":
        if not isinstance(storage, PayloadSink):
            raise TypeError("live publication requires a payload sink")
        # Live files change each cycle, so hash-state IO would add no reuse.
        with engine.begin() as conn:
            conn.execute(_REPEATABLE_READ_SQL)
            acquire_publication_lane(conn, provider_id=provider_id, tier=tier)
            gen = utc_now().strftime("%Y-%m-%dT%H:%M:%SZ")
            live_report = gate.new_report(provider_id, tier, gen) if gate_enabled else None
            keys = _publish_live(
                conn,
                storage,
                provider_id=provider_id,
                settings=settings,
                gate_report=live_report,
                gen=gen,
            )
            _record_publish_state(
                conn,
                provider_id=provider_id,
                tier=tier,
                generated_utc=gen,
                written=len(keys),
                skipped=0,
                total=len(keys),
                stable_total=len(keys),
                gate_report=live_report.to_dict() if live_report is not None else None,
            )
        if live_report is not None:
            gate.enforce(live_report, force=True)
        return PublishResult(
            provider_id=provider_id,
            tier=tier,
            keys_written=keys,
            gate_report=live_report.to_dict() if live_report is not None else None,
        )

    if tier == "static":
        stamp_fn = _static_stamp
    elif tier == "historic":
        stamp_fn = None
    else:
        raise ValueError(f"unknown tier {tier!r} (expected live, static, historic)")


    if not isinstance(storage, SnapshotObjectStore):
        raise TypeError("static publication requires a snapshot object store")
    historic_ledger = _HistoricPhaseLedger() if tier == "historic" else None
    historic_run: _HistoricPublishRun | None = None
    with _historic._historic_transaction_context(engine.begin(), historic_ledger) as conn:
        conn.execute(_REPEATABLE_READ_SQL)
        acquire_publication_lane(conn, provider_id=provider_id, tier=tier)
        if tier == "historic":
            assert_daily_delay_history_clean(conn, provider_id)
            assert_historic_delay_means_current(conn, provider_id)
        stamp = (
            stamp_fn(conn, provider_id)
            if stamp_fn is not None else historic_tier.publication_stamp()
        )
        historic_run = _historic._new_historic_publish_run(
            historic_ledger, settings, stamp, full_historic_rebuild,
            historic_tier.HISTORY_PARTITION_UPLOAD_BATCH_SIZE,
        )
        historic_gated = None
        gated: HashGatedStorage
        if tier == "historic":
            if not isinstance(storage, HistoricObjectStore):
                raise TypeError("historic storage requires conditional activation")
            historic_gated = HistoricHashGatedStorage(
                storage,
                state_rel_key=f"_meta/publish_state_{tier}.json",
                fingerprint=state_fingerprint(tier),
            )
            gated = historic_gated
        else:
            gated = HashGatedStorage(
                storage,
                state_rel_key=f"_meta/publish_state_{tier}.json",
                fingerprint=state_fingerprint(tier),
            )
        gated.load()
        # Static output changes must bump state_fingerprint even when the dataset is unchanged.
        if tier == "static" and gated.fingerprint_matched:
            match = conn.execute(
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
            # Gates precede pointer writes; failed streams may leave unreferenced immutable objects.
            report = gate.new_report(provider_id, tier, stamp) if gate_enabled else None
            prior_total = (
                _prior_files_total(conn, provider_id=provider_id, tier=tier)
                if gate_enabled
                else None
            )
            assert historic_gated is not None
            historic_tier.publish(
                conn,
                historic_gated,
                provider_id=provider_id,
                settings=settings,
                stamp=stamp,
                gate_report=report,
                prior_files_total=prior_total,
                force=force,
                _historic_run=historic_run,
            )
        elif tier == "static" and gate_enabled:
            # Validate collected static payloads before uploading those same bytes.
            store = _CollectingStorage()
            _publish_static(conn, store, provider_id=provider_id, settings=settings, stamp=stamp)
            report = gate.new_report(provider_id, tier, stamp)
            for rel_key, payload in store.collected:
                gate.record(report, rel_key, payload)
            gate.enforce(report, force=force)
            uploads.put_batch(
                gated,
                [(k, p, "static") for (k, p) in store.collected],
                concurrency=uploads.concurrency(settings),
            )
        else:
            _publish_static(conn, gated, provider_id=provider_id, settings=settings, stamp=stamp)
        with _historic._historic_phase_context(historic_run, "hash_state_flush"):
            gated.flush_state()
        physical_written = len(gated.written) + len(gated.immutable_written)
        physical_skipped = len(gated.skipped) + len(gated.immutable_skipped)
        physical_total = physical_written + physical_skipped
        stable_total = uploads.stable_outcome_total(gated)
        if historic_run is not None:
            _historic._persist_historic_receipt_run(conn, provider_id, historic_run)
            historic_state = _historic._snapshot_historic_telemetry(historic_run)
        else:
            historic_state = None
        with _historic._historic_phase_context(historic_run, "state_upsert"):
            _record_publish_state(
                conn,
                provider_id=provider_id,
                tier=tier,
                generated_utc=stamp,
                written=physical_written,
                skipped=physical_skipped,
                total=physical_total,
                stable_total=stable_total,
                gate_report=report.to_dict() if report is not None else None,
                historic_telemetry=historic_state,
            )

    historic_telemetry = _historic._finish_historic_telemetry(historic_run)
    return PublishResult(
        provider_id=provider_id,
        tier=tier,
        keys_written=[*gated.written, *gated.immutable_written],
        keys_skipped=[*gated.skipped, *gated.immutable_skipped],
        gate_report=report.to_dict() if report is not None else None,
        historic_telemetry=historic_telemetry,
    )


class _CollectingStorage:
    """No-op storage that records ``(rel_key, payload)`` and uploads nothing.

    Drives the SAME per-tier build path as a real publish so validate-snapshots (and
    the pre-upload static gate) exercise every builder over the real DB but never touch
    the network. Only ``put_json`` is implemented — it records the payload and returns
    the key — because the publishers call nothing else on this storage; it is used
    directly (never wrapped in a HashGatedStorage), so no hash-gate methods are needed.
    """

    def __init__(self) -> None:
        self.collected: list[CollectedItem] = []

    def put_json(self, rel_key: str, payload: SnapshotPayload, *, tier: str) -> str:  # noqa: ARG002
        self.collected.append((rel_key, payload))
        return rel_key


def collect_payloads(
    provider_id: str,
    *,
    tier: str,
    settings: Settings | None = None,
    engine: Engine | None = None,
    include_archive_bundle: bool = False,
    include_network_bundle: bool = False,
    include_line_bundle: bool = False,
    include_stop_bundle: bool = False,
    include_point_bundle: bool = False,
    _historic_consumer: Callable[[HistoricValidationInputs], object] | None = None,
) -> _LegacyCollected | HistoricValidationInputs | object:
    """Build every payload for *tier* WITHOUT uploading; return the collected set.

    Returns the legacy ``(all_items, route_items, stamp, prior_files_total)`` tuple when
    no optional historic bundle is requested; otherwise returns named
    ``HistoricValidationInputs``. Both paths reuse the exact build code the publisher
    runs, so validation sees publish-identical payloads. Reads run on a plain
    ``engine.connect()`` and never write to the bucket.
    """
    settings = settings or get_settings()
    engine = engine or make_engine(settings)

    with engine.connect() as conn:
        if tier == "live":
            gen = utc_now().strftime("%Y-%m-%dT%H:%M:%SZ")
            items = _build_live_items(conn, provider_id=provider_id, settings=settings, gen=gen)
            # Stamp audit payloads exactly as the live publisher does.
            envelope.stamp_envelope(items, provider_id=provider_id, stamp=gen)
            return ([(k, p) for (k, p, _t) in items], [], gen, None)

        if tier == "historic":
            include: set[historic_tier.HistoricInclude] = set()
            for family, enabled in (
                ("archive", include_archive_bundle), ("network", include_network_bundle),
                ("lines", include_line_bundle), ("stops", include_stop_bundle),
                ("points", include_point_bundle),
            ):
                if enabled:
                    include.add(cast(historic_tier.HistoricInclude, family))
            result = historic_tier.collect(
                conn, provider_id=provider_id, settings=settings,
                stamp=historic_tier.publication_stamp(), include=include,
            )
            result = replace(
                result, prior_total=_prior_files_total(conn, provider_id=provider_id, tier=tier),
            )
            if _historic_consumer is not None:
                return _historic_consumer(result)
            if include:
                return result
            return (result.all_items, result.route_items, result.stamp, result.prior_total)

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
    settings: Settings | None = None,
    engine: Engine | None = None,
    _collected: HistoricValidationInputs | _LegacyCollected | None = None,
) -> gate.GateReport:
    """Read-only pre-publish audit: build every payload, run the gate, return the report.

    Never uploads and never raises on findings (the caller decides its exit code from
    the returned report). The historic tier additionally runs the batch-level
    coverage-delta + empty-route aggregates via ``gate.finalize_batch``.
    """
    if _collected is None and tier == "historic":
        result = collect_payloads(
            provider_id,
            tier=tier,
            settings=settings,
            engine=engine,
            include_archive_bundle=True,
            include_network_bundle=True,
            include_line_bundle=True,
            include_stop_bundle=True,
            include_point_bundle=True,
            _historic_consumer=lambda collected: validate_snapshots(
                provider_id,
                tier=tier,
                settings=settings,
                engine=engine,
                _collected=collected,
            ),
        )
        if not isinstance(result, gate.GateReport):
            raise TypeError("historic validation consumer must return a GateReport")
        return result
    collected = _collected or collect_payloads(
        provider_id,
        tier=tier,
        settings=settings,
        engine=engine,
    )
    if tier == "historic":
        return historic_tier.validate(
            provider_id, cast(HistoricValidationInputs | _LegacyCollected, collected),
        )
    if isinstance(collected, HistoricValidationInputs):
        all_items, stamp = collected.all_items, collected.stamp
    elif isinstance(collected, tuple):
        all_items, _route_items, stamp, _prior_total = collected[:4]
    else:
        raise TypeError("snapshot collection must be a tuple or HistoricValidationInputs")
    report = gate.new_report(provider_id, tier, stamp)
    for rel_key, payload in all_items:
        gate.record(report, rel_key, payload)
    return report
