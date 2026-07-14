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
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from transit_ops.db.connection import make_engine
from transit_ops.ingestion.common import utc_now
from transit_ops.settings import get_settings
from transit_ops.snapshots import builders, gate
from transit_ops.snapshots.builders.historic.history_common import (
    PointHistorySummary,
    history_coverage,
    history_date,
    history_metric_coverage,
    history_pointer_path,
    history_utc_timestamp,
    latest_history_timestamp,
    readdress_history_directory,
)
from transit_ops.snapshots.contract import (
    PAYLOAD_METHODOLOGY,
    TOP_LEVEL_MODELS,
    AlertArchiveIndex,
    AlertArchivePage,
    HistoricAvailabilityIndex,
    HistoricCollectionIndex,
    HistoricEntityDirectoryIndex,
    HistoricFamilyAvailability,
    HistoricHotspotsDay,
    HistoricRepeatOffendersDay,
    LineHistoryPartition,
    NetworkHistoryPartition,
    PayloadEnvelope,
    ReceiptAvailability,
    ReceiptsIndex,
    RouteReliabilityIndex,
    StopHistoryPartition,
)
from transit_ops.snapshots.serialization import snapshot_sha256
from transit_ops.snapshots.storage import (
    HashGatedStorage,
    build_snapshot_storage,
    state_fingerprint,
)
from transit_ops.sql_registry import named_query

logger = logging.getLogger(__name__)

# A work item handed to the parallel uploader: (rel_key, payload, tier).
_PutItem = "tuple[str, object, str]"
STOP_HISTORY_INDEX_UPLOAD_BATCH_SIZE = 100
POINT_HISTORY_UPLOAD_BATCH_SIZE = 32


@dataclass(frozen=True)
class HistoricPointPlanBundle:
    """Typed one-shot plans for the two retained point-date families."""

    hotspots: object
    repeat_offenders: object


def _build_historic_point_plans(conn: object, *, provider_id: str) -> HistoricPointPlanBundle:
    return HistoricPointPlanBundle(
        hotspots=builders.build_hotspots_history_plan(  # type: ignore[arg-type]
            conn,
            provider_id=provider_id,
        ),
        repeat_offenders=builders.build_repeat_offenders_history_plan(  # type: ignore[arg-type]
            conn,
            provider_id=provider_id,
        ),
    )


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
    "SELECT COALESCE(stable_files_total, files_total) FROM core.snapshot_publish_state "
    "WHERE provider_id = :provider_id AND tier = :tier",
)

_PUBLISH_LOCK_SQL = named_query(
    "publish.lock.try_acquire",
    "SELECT pg_try_advisory_xact_lock("
    "hashtext('transit.snapshot_publish:' || :provider_id), hashtext(:tier))",
)


class PublishLockUnavailableError(RuntimeError):
    """A static/historic provider lane already has an active publisher."""

    def __init__(self, *, provider_id: str, tier: str) -> None:
        super().__init__(
            f"snapshot publish already running for provider={provider_id!r}, tier={tier!r}"
        )
        self.provider_id = provider_id
        self.tier = tier


def _acquire_publish_lock(conn: object, *, provider_id: str, tier: str) -> None:
    """Fail fast unless this transaction owns the provider/tier publish lane."""

    acquired = conn.execute(  # type: ignore[attr-defined]
        _PUBLISH_LOCK_SQL,
        {"provider_id": provider_id, "tier": tier},
    ).scalar_one()
    if not acquired:
        raise PublishLockUnavailableError(provider_id=provider_id, tier=tier)


# GC2 H4 — model-class -> methodology-family string, so the publisher can stamp
# methodology_version by payload TYPE regardless of the rel_key path. The FIRST
# TOP_LEVEL_MODELS key that maps to a class wins (index.json wrappers share a class
# with their family, which is fine — same methodology token).
_METHODOLOGY_BY_MODEL: dict[type, str] = {
    model: PAYLOAD_METHODOLOGY[name]
    for name, model in TOP_LEVEL_MODELS.items()
    if name in PAYLOAD_METHODOLOGY
}


def _publish_generation_id(provider_id: str, stamp: str) -> str:
    """Deterministic dataset_version+generated_utc composite (DECISIONS #17).

    No new randomness: derived purely from the provider id + the per-run publish
    stamp (which is the generated_utc for live/historic and the dataset loaded_at_utc
    for static). Ties every file to the exact publish run that emitted it.
    """
    return f"{provider_id}@{stamp}"


def _receipts_collection_generation_id(receipts: Mapping[str, object]) -> str:
    """Hash exact Receipt semantics while excluding only run-volatile envelope fields."""

    canonical: list[dict[str, object]] = []
    for date_str, receipt in sorted(receipts.items()):
        if isinstance(receipt, PayloadEnvelope):
            payload = receipt.model_dump(mode="json")
        elif isinstance(receipt, Mapping):
            payload = dict(receipt)
        else:
            raise TypeError("Receipt collection values must be payload models or mappings")
        payload.pop("generated_utc", None)
        payload.pop("publish_generation_id", None)
        canonical.append({"date": date_str, "payload": payload})
    return snapshot_sha256({"receipts": canonical})


def _finalize_receipts_collection_generation(items: Sequence[tuple]) -> None:
    """Pin the Receipts index after every Receipt carries its published semantics."""

    receipts = {
        payload.date: payload
        for rel_key, payload, *_rest in items
        if rel_key.startswith("historic/receipts/")
        and rel_key != "historic/receipts/index.json"
        and hasattr(payload, "date")
    }
    index = next(
        (
            payload
            for rel_key, payload, *_rest in items
            if rel_key == "historic/receipts/index.json" and isinstance(payload, ReceiptsIndex)
        ),
        None,
    )
    if index is not None:
        index.collection_generation_id = _receipts_collection_generation_id(receipts)


def _valid_history_dates(values: Sequence[object]) -> list[str]:
    dates: set[str] = set()
    for value in values:
        try:
            dates.add(history_date(value, field="date"))
        except ValueError:
            continue
    return sorted(dates)


def _valid_history_timestamps(values: Sequence[object]) -> list[str]:
    timestamps: list[str] = []
    for value in values:
        try:
            timestamps.append(history_utc_timestamp(value, field="generated_utc"))
        except ValueError:
            continue
    return timestamps


def _entity_family_availability(
    *,
    family: str,
    directory: HistoricEntityDirectoryIndex,
    indexes: Sequence[HistoricCollectionIndex],
    metrics: Sequence[tuple[str, str]],
    index_path: str | None = None,
) -> HistoricFamilyAvailability:
    dates = sorted({date for index in indexes for date in index.available_dates})
    first, last, gaps = history_coverage(dates)
    metric_dates: dict[str, list[str]] = {name: [] for name, _aggregation in metrics}
    for index in indexes:
        for coverage in index.metrics:
            if coverage.metric.value not in metric_dates:
                continue
            metric_dates[coverage.metric.value].extend(
                date
                for date in index.available_dates
                if (
                    coverage.first_available_date is not None
                    and coverage.last_available_date is not None
                    and coverage.first_available_date <= date <= coverage.last_available_date
                    and not any(gap.start_date <= date <= gap.end_date for gap in coverage.gaps)
                )
            )
    return HistoricFamilyAvailability(
        family=family,
        selection_mode="range",
        index_path=index_path or f"historic/history/{family}/index.json",
        collection_generation_id=directory.collection_generation_id,
        first_available_date=first,
        last_available_date=last,
        gaps=gaps,
        metrics=[
            history_metric_coverage(name, aggregation, metric_dates[name])
            for name, aggregation in metrics
        ],
    )


def _build_history_availability_index(
    *,
    stamp: str,
    alert_index: AlertArchiveIndex,
    receipts_index: ReceiptsIndex,
    network_index: HistoricCollectionIndex,
    line_directory: HistoricEntityDirectoryIndex,
    line_indexes: Sequence[HistoricCollectionIndex],
    stop_directory: HistoricEntityDirectoryIndex,
    hotspots_index: HistoricCollectionIndex | None = None,
    repeat_offenders_index: HistoricCollectionIndex | None = None,
    stop_indexes: Sequence[HistoricCollectionIndex] | None = None,
    stop_family: HistoricFamilyAvailability | None = None,
    stop_generated_utc: str | None = None,
    alert_index_path: str = "historic/alerts/index.json",
    receipt_index_path: str = "historic/receipts/index.json",
    network_index_path: str = "historic/history/network/index.json",
    line_directory_path: str = "historic/history/lines/index.json",
    stop_directory_path: str = "historic/history/stops/index.json",
    hotspots_index_path: str | None = None,
    repeat_offenders_index_path: str | None = None,
) -> HistoricAvailabilityIndex:
    """Build the exact seven-family discovery root from already-built child truth."""

    if hotspots_index is None or repeat_offenders_index is None:
        raise RuntimeError("retained-history root requires both exact point history children")

    receipt_dates = _valid_history_dates(receipts_index.dates)
    receipt_first, receipt_last, receipt_gaps = history_coverage(receipt_dates)
    families = [
        HistoricFamilyAvailability(
            family="alerts",
            selection_mode="range",
            index_path=alert_index_path,
            collection_generation_id=alert_index.collection_generation_id,
            first_available_date=alert_index.first_available_date,
            last_available_date=alert_index.last_available_date,
        ),
        HistoricFamilyAvailability(
            family="hotspots",
            selection_mode="date",
            index_path=hotspots_index_path
            or history_pointer_path("historic/history/hotspots", hotspots_index),
            collection_generation_id=hotspots_index.collection_generation_id,
            first_available_date=hotspots_index.first_available_date,
            last_available_date=hotspots_index.last_available_date,
            gaps=[gap.model_copy(deep=True) for gap in hotspots_index.gaps],
        ),
        _entity_family_availability(
            family="lines",
            directory=line_directory,
            indexes=line_indexes,
            metrics=builders.LINE_HISTORY_METRICS,
            index_path=line_directory_path,
        ),
        HistoricFamilyAvailability(
            family="network",
            selection_mode="range",
            index_path=network_index_path,
            collection_generation_id=network_index.collection_generation_id,
            first_available_date=network_index.first_available_date,
            last_available_date=network_index.last_available_date,
            gaps=[gap.model_copy(deep=True) for gap in network_index.gaps],
            metrics=[metric.model_copy(deep=True) for metric in network_index.metrics],
        ),
        HistoricFamilyAvailability(
            family="repeat_offenders",
            selection_mode="date",
            index_path=repeat_offenders_index_path
            or history_pointer_path(
                "historic/history/repeat_offenders",
                repeat_offenders_index,
            ),
            collection_generation_id=repeat_offenders_index.collection_generation_id,
            first_available_date=repeat_offenders_index.first_available_date,
            last_available_date=repeat_offenders_index.last_available_date,
            gaps=[gap.model_copy(deep=True) for gap in repeat_offenders_index.gaps],
        ),
        HistoricFamilyAvailability(
            family="receipts",
            selection_mode="date",
            index_path=receipt_index_path,
            collection_generation_id=receipts_index.collection_generation_id,
            first_available_date=receipt_first,
            last_available_date=receipt_last,
            gaps=receipt_gaps,
        ),
        stop_family
        or _entity_family_availability(
            family="stops",
            directory=stop_directory,
            indexes=stop_indexes or (),
            metrics=builders.STOP_HISTORY_METRICS,
            index_path=stop_directory_path,
        ),
    ]
    timestamp_candidates: list[object] = []
    if alert_index.first_available_date is not None:
        timestamp_candidates.append(alert_index.generated_utc)
    if receipt_dates:
        timestamp_candidates.append(receipts_index.generated_utc)
    if network_index.available_dates:
        timestamp_candidates.append(network_index.generated_utc)
    if hotspots_index.available_dates:
        timestamp_candidates.append(hotspots_index.generated_utc)
    if repeat_offenders_index.available_dates:
        timestamp_candidates.append(repeat_offenders_index.generated_utc)
    timestamp_candidates.extend(index.generated_utc for index in line_indexes)
    if stop_indexes is not None:
        timestamp_candidates.extend(index.generated_utc for index in stop_indexes)
    elif stop_generated_utc is not None:
        timestamp_candidates.append(stop_generated_utc)
    return HistoricAvailabilityIndex(
        generated_utc=latest_history_timestamp(
            _valid_history_timestamps(timestamp_candidates),
            fallback=stamp,
        ),
        methodology_version="history-1",
        families=sorted(families, key=lambda family: family.family),
    )


def _stamp_envelope(items: list, *, provider_id: str, stamp: str) -> None:
    """Stamp the H4 in-band accountability fields on every PayloadEnvelope in *items*.

    Threaded ONCE per publish run: schema_version keeps its model default, methodology
    _version is looked up by payload type, and publish_generation_id is the one
    deterministic composite for the run — so every file in a snapshot carries the SAME
    generation id. Mutates payloads in place before the gate + upload. Non-envelope
    payloads (there should be none at the top level) are skipped defensively.
    """
    generation_id = _publish_generation_id(provider_id, stamp)
    for _rel_key, payload, _tier in items:
        if isinstance(payload, PayloadEnvelope):
            # Content-addressed payloads must remain byte-stable across runs; a
            # run generation id would invalidate their already-computed SHA/path.
            if isinstance(
                payload,
                AlertArchivePage
                | NetworkHistoryPartition
                | LineHistoryPartition
                | StopHistoryPartition
                | HistoricHotspotsDay
                | HistoricRepeatOffendersDay,
            ):
                continue
            payload.publish_generation_id = generation_id
            payload.methodology_version = _METHODOLOGY_BY_MODEL.get(type(payload))


def _concurrency(settings: object) -> int:
    """Resolve the bounded upload fan-out from settings (default 16, floor 1)."""
    value = getattr(settings, "SNAPSHOT_PUBLISH_CONCURRENCY", 16)
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return 16


def _parallel_put(
    storage: object,
    items: list,
    *,
    concurrency: int,
    write_mode: str = "normal",
) -> list[str]:
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
    if write_mode not in {"normal", "immutable"}:
        raise ValueError(f"unknown snapshot write mode {write_mode!r}")

    def put(item: tuple[str, object, str]) -> str:
        rel_key, payload, tier = item
        if write_mode == "immutable":
            return storage.put_immutable_json(rel_key, payload)  # type: ignore[attr-defined]
        return storage.put_json(rel_key, payload, tier=tier)  # type: ignore[attr-defined]

    if concurrency <= 1:
        return [put(item) for item in items]

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(put, item) for item in items]
        # Resolve in submission order; the first exception re-raises here, and
        # the `with` block still joins the remaining workers on the way out.
        return [future.result() for future in futures]


def _publish_stages(
    storage: object,
    stages: list,
    *,
    concurrency: int,
) -> list[str]:
    """Publish ordered stages, waiting for every child stage before its pointer."""

    written: list[str] = []
    for stage, write_mode in stages:
        written.extend(
            _parallel_put(
                storage,
                stage,
                concurrency=concurrency,
                write_mode=write_mode,
            )
        )
    return written


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
    "(provider_id, tier, generated_utc, files_written, files_skipped, files_total, "
    " stable_files_total, "
    " gate_checks_run, gate_errors, gate_warnings, gate_verdict, gate_generated_utc, "
    " updated_at_utc) "
    "VALUES (:provider_id, :tier, :generated_utc, :written, :skipped, :total, "
    " :stable_total, "
    " :gate_checks_run, :gate_errors, :gate_warnings, :gate_verdict, "
    " CAST(:gate_generated_utc AS timestamptz), now()) "
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
    "updated_at_utc = now()",
)


def _gate_summary(report: object | None) -> dict:  # type: ignore[type-arg]
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
    errors = int(report.get("errors") or 0)
    warnings = int(report.get("warnings") or 0)
    verdict = "fail" if errors > 0 else ("warn" if warnings > 0 else "pass")
    return {
        "gate_checks_run": report.get("checks_run"),
        "gate_errors": errors,
        "gate_warnings": warnings,
        "gate_verdict": verdict,
        "gate_generated_utc": report.get("generated_utc"),
    }


def _record_publish_state(
    conn: object,
    *,
    provider_id: str,
    tier: str,
    generated_utc: object,
    written: int,
    skipped: int,
    total: int,
    stable_total: int | None = None,
    gate_report: dict | None = None,  # type: ignore[type-arg]
) -> None:
    """Upsert the per-tier publish-state row inside the caller's transaction.

    *gate_report* is a GateReport.to_dict() dict (or None when the gate did not
    run); its counts + derived verdict are persisted alongside the file counts so
    the S11 data-health payload can serve the last gate outcome per lane.
    """

    conn.execute(  # type: ignore[attr-defined]
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
    "SELECT DISTINCT route_id FROM gold.route_delay_spine WHERE provider_id = :provider_id",
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

    row = (
        conn.execute(  # type: ignore[attr-defined]
            _STATIC_STAMP_SQL, {"provider_id": provider_id}
        )
        .mappings()
        .fetchone()
    )
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
        # S11 per-lane data-health (reads snapshot_publish_state; last-completed-
        # publish semantics — the live lane row it reads is from the PRIOR cycle,
        # persisted after this cycle's payloads are built). Before the manifest.
        (
            "status/data_health.json",
            builders.build_data_health(conn, provider_id=provider_id, generated_utc=gen),  # type: ignore[arg-type]
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
    gen: str | None = None,
) -> list[str]:
    """Build and upload all live-tier snapshot files; return the list of keys written.

    When *gate_report* is supplied the payloads are inspected before upload, but the
    live tier is WARN-ONLY (enforced with force=True by the caller) so a transient blip
    never aborts the ~57s cycle and blinds the map. Files upload sequentially in list
    order, manifest last.

    *gen* is the cycle's ONE publish stamp: the caller threads the same value it
    persists to snapshot_publish_state, so the manifest, envelope stamps, gate
    report, and the data-health lane row can never disagree by a second-boundary
    (S11 review F1 — two independent utc_now() reads used to race the clock).
    """
    if gen is None:
        gen = utc_now().strftime("%Y-%m-%dT%H:%M:%SZ")
    items = _build_live_items(conn, provider_id=provider_id, settings=settings, gen=gen)
    _stamp_envelope(items, provider_id=provider_id, stamp=gen)  # GC2 H4
    if gate_report is not None:
        # The live gate is best-effort observability only; a checker crash must NEVER
        # abort the ~57s cycle and blind the map, so record failures are logged and
        # swallowed (the cycle proceeds to upload regardless).
        for rel_key, payload, _tier in items:
            try:
                gate.record(gate_report, rel_key, payload)  # type: ignore[arg-type]
            except Exception:  # noqa: BLE001 — never let a gate crash abort the live cycle
                logger.exception(
                    "live gate check crashed for %s (skipped, cycle continues)", rel_key
                )
    written: list[str] = []
    for rel_key, payload, tier in items:
        written.append(storage.put_json(rel_key, payload, tier=tier))  # type: ignore[attr-defined]
    return written


def _build_historic_items(
    conn: object, *, provider_id: str, settings: object, stamp: str
) -> tuple[list, list, list, object]:
    """Build every historic-tier payload; return ``(items, route_items, stages)``.

    * *items* — the full ordered (rel_key, payload, tier) list, over which the gate
      runs a single build-then-gate pass (payload build precedes any upload).
    * *route_items* — the per-route subset (for the batch-level empty-route/coverage
      checks).
    * *stages* — ``(items, write_mode)`` pairs partitioning the ordered upload
      stages that MUST be
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
            builders.build_route_reliability(
                conn, provider_id=provider_id, route_id=str(route_id), generated_utc=stamp
            ),  # type: ignore[arg-type]
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
    all_stops_rel = builders.build_stop_reliability(
        conn, provider_id=provider_id, generated_utc=stamp
    )  # type: ignore[arg-type]
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
    # S13 (DECISIONS DB3): grow the index with per-date availability so the S8 picker
    # distinguishes a rich receipt from an alerts-only shell and a schedule-known day
    # from an empty one. `dates` stays BYTE-IDENTICAL; `available` is additive. has_data
    # = the receipt carries real reliability telemetry (affected routes/stops OR a
    # network OTP obs) vs an alerts-only shell (honest-NULL reliability inputs);
    # has_schedule = the day's scheduled universe is known. publish_generation_id is the
    # SAME run stamp the envelope carries (forward-compat; redundant in single-run).
    receipts_generation_id = _publish_generation_id(provider_id, stamp)
    receipts_available = [
        ReceiptAvailability(
            date=date_str,
            has_data=bool(
                receipt.affected_routes or receipt.affected_stops or receipt.otp_pct is not None
            ),
            has_schedule=bool(
                receipt.service_states is not None
                and receipt.service_states.scheduled_trip_days is not None
            ),
            publish_generation_id=receipts_generation_id,
        )
        for date_str, receipt in sorted(all_receipts.items())
    ]
    receipts_index_item = (
        "historic/receipts/index.json",
        ReceiptsIndex(
            dates=sorted(all_receipts),
            generated_utc=stamp,
            available=receipts_available,
        ),
        "historic",
    )

    # --- retained alert archive: immutable generation pages + stable pointer ---
    # The legacy newest-500 flat file above remains untouched. This collection is
    # built from the message-complete Gold archive and uploaded pointer-last.
    alert_archive = builders.build_alert_archive(
        conn,
        provider_id,
        generated_utc=stamp,  # type: ignore[arg-type]
    )
    alert_page_items = [
        (path, page, "historic_immutable") for path, page in alert_archive.page_items
    ]
    alert_index_item = (
        "historic/alerts/index.json",
        alert_archive.index,
        "historic",
    )

    # Ordered upload stages: each stage completes before the next; a discovery index
    # is a singleton stage after its per-entity stage (pointer-last invariant).
    stages: list = [
        (flat_items, "normal"),
        (route_items, "normal"),
        ([route_index_item], "normal"),
        (stop_items, "normal"),
        (receipt_items, "normal"),
        ([receipts_index_item], "normal"),
        (alert_page_items, "immutable"),
        ([alert_index_item], "normal"),
    ]
    for stage, _write_mode in stages:
        items.extend(stage)

    return items, route_items, stages, alert_archive


def _stable_item_total(items: list) -> int:
    """Logical surface count, excluding immutable generation objects."""

    return sum(1 for item in items if not _is_immutable_item(item[0], item[2]))


def _is_immutable_item(rel_key: str, tier: str | None = None) -> bool:
    """Recognize immutable items by declared tier or generation-path identity."""

    return tier == "historic_immutable" or "/generations/" in rel_key


def _stable_outcome_total(storage: object) -> int:
    """Count stable mutable outcomes while path-filtering mislabeled generations."""

    mutable_outcomes = [
        *storage.written,  # type: ignore[attr-defined]
        *storage.skipped,  # type: ignore[attr-defined]
    ]
    return sum(1 for rel_key in mutable_outcomes if not _is_immutable_item(rel_key))


def _find_network_trend(items: list) -> tuple[str, object] | None:
    """Return the (rel_key, payload) of the historic network_trend file, or None."""
    for rel_key, payload, *_ in items:
        if rel_key == "historic/network_trend.json":
            return (rel_key, payload)
    return None


def _publish_point_history_days(
    plan: object,
    *,
    family: str,
    storage: object,
    report: gate.GateReport,
    analytics_report: object | None,
    force: bool,
    concurrency: int,
) -> tuple[PointHistorySummary, list[str]]:
    """Gate and upload one point plan in bounded batches, retaining exact refs only."""

    summary = PointHistorySummary(family)
    written: list[str] = []
    batch: list[tuple[str, object, str]] = []
    batch_limit = min(POINT_HISTORY_UPLOAD_BATCH_SIZE, max(1, concurrency))

    def flush_batch() -> None:
        if not batch:
            return
        written.extend(
            _parallel_put(
                storage,
                batch,
                concurrency=concurrency,
                write_mode="immutable",
            )
        )
        batch.clear()

    for payload in plan.iter_days():  # type: ignore[attr-defined]
        ref = summary.observe(payload)
        if analytics_report is not None:
            gate.record(analytics_report, ref.path, payload)  # type: ignore[arg-type]
            report.results.extend(gate.check_point_history_day_ref(ref, payload, family=family))
            report.checks_run += 1
        else:
            report.results.extend(
                [
                    *gate.check_payload(ref.path, payload),
                    *gate.check_point_history_day_ref(ref, payload, family=family),
                ]
            )
            report.payload_sha256[ref.path] = ref.sha256 or snapshot_sha256(payload)
            report.payloads_checked += 1
            report.checks_run += 2
        gate.enforce(report, force=force)
        batch.append((ref.path, payload, "historic_immutable"))
        if len(batch) >= batch_limit:
            flush_batch()
    flush_batch()
    return summary, written


def _build_point_history_index_item(
    summary: PointHistorySummary,
    *,
    provider_id: str,
    stamp: str,
    report: gate.GateReport,
    analytics_report: object | None,
    force: bool,
) -> tuple[str, HistoricCollectionIndex, str]:
    index = summary.build_index(fallback_generated_utc=stamp)
    _stamp_envelope(
        [("unused", index, "historic")],
        provider_id=provider_id,
        stamp=stamp,
    )
    rel_key = history_pointer_path(f"historic/history/{summary.family}", index)
    findings = gate.check_point_history_index(
        index,
        rel_key=rel_key,
        family=summary.family,
        expected_refs=summary.refs,
        fallback_generated_utc=stamp,
    )
    if analytics_report is not None:
        gate.record(analytics_report, rel_key, index)  # type: ignore[arg-type]
        analytics_report.results.extend(findings)  # type: ignore[attr-defined]
        analytics_report.checks_run += 1  # type: ignore[attr-defined]
    else:
        report.results.extend([*gate.check_payload(rel_key, index), *findings])
        report.payload_sha256[rel_key] = snapshot_sha256(index)
        report.payloads_checked += 1
        report.checks_run += 2
    gate.enforce(report, force=force)
    return (rel_key, index, "historic_immutable")


def _validate_point_history_plan(
    plan: object,
    *,
    family: str,
    provider_id: str,
    stamp: str,
    report: gate.GateReport,
) -> tuple[PointHistorySummary, HistoricCollectionIndex, str]:
    """Consume a fresh one-shot point plan and record the publish-identical graph."""

    summary = PointHistorySummary(family)
    for payload in plan.iter_days():  # type: ignore[attr-defined]
        ref = summary.observe(payload)
        gate.record(report, ref.path, payload)
        report.results.extend(gate.check_point_history_day_ref(ref, payload, family=family))
        report.checks_run += 1
    index = summary.build_index(fallback_generated_utc=stamp)
    _stamp_envelope(
        [("unused", index, "historic")],
        provider_id=provider_id,
        stamp=stamp,
    )
    rel_key = history_pointer_path(f"historic/history/{family}", index)
    gate.record(report, rel_key, index)
    report.results.extend(
        gate.check_point_history_index(
            index,
            rel_key=rel_key,
            family=family,
            expected_refs=summary.refs,
            fallback_generated_utc=stamp,
        )
    )
    report.checks_run += 1
    return summary, index, rel_key


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

    Compatibility payloads remain one build/gate pass. Retained point-date families stream
    one day at a time and Network, Line, and Stop history stream one month at a time through
    structural gates and immutable storage. Only compact refs and coverage scalars survive
    between artifacts. Compatibility stages publish only after every retained immutable child
    succeeds. Every family index publishes before the exact seven-family root, which activates
    last. A failed run may leave harmless unreferenced immutable objects, but never a new parent
    pointing to incomplete children.

    Uploads run STAGED: within each stage puts fan out through a bounded thread pool,
    but a stage COMPLETES before the next begins, so a discovery index (its own stage)
    is only PUT after every per-entity file in the preceding stage finished — the
    pointer-last invariant. Only the upload is staged; the build+gate is one pass.
    """
    if stamp is None:
        stamp = _historic_stamp()

    concurrency = _concurrency(settings)
    root_rel_key = "historic/history/index.json"
    capture_stable_version = getattr(storage, "capture_stable_version", None)
    stable_activation_supported = getattr(storage, "stable_activation_supported", True)
    root_version = (
        capture_stable_version(root_rel_key)
        if stable_activation_supported and callable(capture_stable_version)
        else None
    )

    items, route_items, stages, alert_archive = _build_historic_items(
        conn, provider_id=provider_id, settings=settings, stamp=stamp
    )
    _stamp_envelope(items, provider_id=provider_id, stamp=stamp)  # GC2 H4
    _finalize_receipts_collection_generation(items)
    receipts_index = next(
        (
            payload
            for rel_key, payload, _tier in items
            if rel_key == "historic/receipts/index.json" and isinstance(payload, ReceiptsIndex)
        ),
        None,
    )
    receipt_items = [
        (rel_key, payload)
        for rel_key, payload, _tier in items
        if rel_key.startswith("historic/receipts/") and rel_key != "historic/receipts/index.json"
    ]
    receipt_findings = (
        gate.check_receipts_collection(receipts_index, receipt_items)
        if receipts_index is not None
        else []
    )

    network_history = builders.build_network_history_plan(
        conn,  # type: ignore[arg-type]
        provider_id=provider_id,
        generated_utc=stamp,
    )
    line_history = builders.build_line_history_plan(
        conn,  # type: ignore[arg-type]
        provider_id=provider_id,
        generated_utc=stamp,
    )
    stop_history = builders.build_stop_history_plan(
        conn,  # type: ignore[arg-type]
        provider_id=provider_id,
        generated_utc=stamp,
    )
    point_plans = _build_historic_point_plans(conn, provider_id=provider_id)
    effective_report = gate_report or gate.new_report(provider_id, "historic", stamp)
    alert_findings = gate.check_alert_archive_bundle(
        alert_archive.index,
        alert_archive.page_items,
        provider_timezone=alert_archive.provider_timezone,
    )

    if gate_report is not None:
        for rel_key, payload, _tier in items:
            gate.record(gate_report, rel_key, payload)  # type: ignore[arg-type]
        gate_report.results.extend([*alert_findings, *receipt_findings])  # type: ignore[attr-defined]
        gate_report.checks_run += 1  # type: ignore[attr-defined]
    else:
        effective_report.results.extend([*alert_findings, *receipt_findings])
        effective_report.payloads_checked = len(alert_archive.page_items) + 1
        effective_report.checks_run = 2
    gate.enforce(effective_report, force=force)  # type: ignore[arg-type]

    hotspot_summary, hotspot_keys = _publish_point_history_days(
        point_plans.hotspots,
        family="hotspots",
        storage=storage,
        report=effective_report,  # type: ignore[arg-type]
        analytics_report=gate_report,
        force=force,
        concurrency=concurrency,
    )
    repeat_offenders_summary, repeat_offender_keys = _publish_point_history_days(
        point_plans.repeat_offenders,
        family="repeat_offenders",
        storage=storage,
        report=effective_report,  # type: ignore[arg-type]
        analytics_report=gate_report,
        force=force,
        concurrency=concurrency,
    )
    hotspot_index_item = _build_point_history_index_item(
        hotspot_summary,
        provider_id=provider_id,
        stamp=stamp,
        report=effective_report,  # type: ignore[arg-type]
        analytics_report=gate_report,
        force=force,
    )
    repeat_offenders_index_item = _build_point_history_index_item(
        repeat_offenders_summary,
        provider_id=provider_id,
        stamp=stamp,
        report=effective_report,  # type: ignore[arg-type]
        analytics_report=gate_report,
        force=force,
    )
    hotspot_index_path, hotspots_index, _tier = hotspot_index_item
    repeat_offenders_index_path, repeat_offenders_index, _tier = repeat_offenders_index_item

    network_summary = gate.NetworkHistoryStreamSummary()
    network_keys: list[str] = []
    for ref, partition in network_history.iter_partition_items():
        if gate_report is not None:
            gate.record(gate_report, ref.path, partition)  # type: ignore[arg-type]
            partition_findings = []
        else:
            partition_findings = gate.check_network_history_partition(
                partition,
                rel_key=ref.path,
            )
            effective_report.payloads_checked += 1  # type: ignore[attr-defined]
            effective_report.checks_run += 2  # type: ignore[attr-defined]
        effective_report.results.extend(  # type: ignore[attr-defined]
            [
                *partition_findings,
                *gate.check_network_history_partition_ref(ref, partition),
            ]
        )
        gate.enforce(effective_report, force=force)  # type: ignore[arg-type]
        network_summary.observe(ref, partition)
        network_keys.append(storage.put_immutable_json(ref.path, partition))  # type: ignore[attr-defined]

    line_build_summary = builders.LineHistoryStreamSummary()
    line_gate_summary = gate.LineHistoryStreamSummary()
    line_keys: list[str] = []
    for ref, partition in line_history.iter_partition_items():
        if gate_report is not None:
            gate.record(gate_report, ref.path, partition)  # type: ignore[arg-type]
            partition_findings = []
        else:
            partition_findings = gate.check_line_history_partition(
                partition,
                rel_key=ref.path,
            )
            effective_report.payloads_checked += 1  # type: ignore[attr-defined]
            effective_report.checks_run += 2  # type: ignore[attr-defined]
        effective_report.results.extend(  # type: ignore[attr-defined]
            [
                *partition_findings,
                *gate.check_line_history_partition_ref(ref, partition),
            ]
        )
        gate.enforce(effective_report, force=force)  # type: ignore[arg-type]
        line_gate_summary.observe(ref, partition)
        line_build_summary.observe(ref, partition)
        line_keys.append(storage.put_immutable_json(ref.path, partition))  # type: ignore[attr-defined]

    stop_build_summary = builders.StopHistoryStreamSummary()
    stop_gate_summary = gate.StopHistoryStreamSummary()
    stop_keys: list[str] = []
    for ref, partition in stop_history.iter_partition_items():
        if gate_report is not None:
            gate.record(  # type: ignore[arg-type]
                gate_report,
                ref.path,
                partition,
                retain_sha=False,
            )
            partition_findings = []
        else:
            partition_findings = gate.check_stop_history_partition(
                partition,
                rel_key=ref.path,
            )
            effective_report.payloads_checked += 1  # type: ignore[attr-defined]
            effective_report.checks_run += 2  # type: ignore[attr-defined]
        effective_report.results.extend(  # type: ignore[attr-defined]
            [
                *partition_findings,
                *gate.check_stop_history_partition_ref(ref, partition),
            ]
        )
        gate.enforce(effective_report, force=force)  # type: ignore[arg-type]
        stop_gate_summary.observe(ref, partition)
        stop_build_summary.observe(ref, partition)
        stop_keys.append(storage.put_immutable_json(ref.path, partition))  # type: ignore[attr-defined]

    network_index = network_history.build_index(network_summary.detached_refs())
    _stamp_envelope(
        [("historic/history/network/index.json", network_index, "historic")],
        provider_id=provider_id,
        stamp=stamp,
    )
    network_index_path = history_pointer_path("historic/history/network", network_index)
    network_index_item = [(network_index_path, network_index, "historic_immutable")]
    stream_findings = gate.check_network_history_stream_index(
        network_index,
        network_summary,
        fallback_generated_utc=stamp,
    )
    if gate_report is not None:
        gate.record(  # type: ignore[arg-type]
            gate_report,
            network_index_path,
            network_index,
        )
        gate_report.results.extend(stream_findings)  # type: ignore[attr-defined]
        gate_report.checks_run += 1  # type: ignore[attr-defined]
    else:
        effective_report.results.extend(  # type: ignore[attr-defined]
            [
                *gate.check_network_history_index(
                    network_index,
                    rel_key=network_index_path,
                ),
                *stream_findings,
            ]
        )
        effective_report.payloads_checked += 1  # type: ignore[attr-defined]
        effective_report.checks_run += 2  # type: ignore[attr-defined]
    gate.enforce(effective_report, force=force)  # type: ignore[arg-type]

    line_indexes = line_build_summary.build_indexes(fallback_generated_utc=stamp)
    line_stamp_items = [
        (
            f"historic/history/lines/{index.entity_id.encode('utf-8').hex()}/index.json",
            index,
            "historic",
        )
        for index in line_indexes
        if index.entity_id
    ]
    _stamp_envelope(line_stamp_items, provider_id=provider_id, stamp=stamp)
    line_index_paths = {
        index.entity_id or "": history_pointer_path(
            f"historic/history/lines/{index.entity_id.encode('utf-8').hex()}",
            index,
        )
        for index in line_indexes
        if index.entity_id
    }
    line_index_items = [
        (line_index_paths[index.entity_id or ""], index, "historic_immutable")
        for index in line_indexes
        if index.entity_id
    ]
    line_stream_findings = gate.check_line_history_stream_indexes(
        line_indexes,
        line_gate_summary,
        fallback_generated_utc=stamp,
    )
    if gate_report is not None:
        for rel_key, payload, _tier in line_index_items:
            gate.record(gate_report, rel_key, payload)  # type: ignore[arg-type]
        gate_report.results.extend(line_stream_findings)  # type: ignore[attr-defined]
        gate_report.checks_run += 1  # type: ignore[attr-defined]
    else:
        effective_report.results.extend(  # type: ignore[attr-defined]
            [
                *(
                    finding
                    for rel_key, payload, _tier in line_index_items
                    for finding in gate.check_line_history_index(payload, rel_key=rel_key)
                ),
                *line_stream_findings,
            ]
        )
        effective_report.payloads_checked += len(line_index_items)  # type: ignore[attr-defined]
        effective_report.checks_run += len(line_index_items) + 1  # type: ignore[attr-defined]
    gate.enforce(effective_report, force=force)  # type: ignore[arg-type]

    stop_pointer_summary = builders.StopHistoryPointerSummary()
    stop_directory_summary = gate.StopHistoryDirectorySummary()
    stop_index_paths: dict[str, str] = {}
    for stop_index in stop_build_summary.iter_indexes(fallback_generated_utc=stamp):
        if not stop_index.entity_id:
            continue
        stop_stamp_item = [
            (
                f"historic/history/stops/{stop_index.entity_id.encode('utf-8').hex()}/index.json",
                stop_index,
                "historic",
            )
        ]
        _stamp_envelope(stop_stamp_item, provider_id=provider_id, stamp=stamp)
        rel_key = history_pointer_path(
            f"historic/history/stops/{stop_index.entity_id.encode('utf-8').hex()}",
            stop_index,
        )
        payload = stop_index
        stop_index_paths[stop_index.entity_id] = rel_key
        stop_stream_findings = gate.check_stop_history_stream_index(
            payload,
            stop_gate_summary,
            fallback_generated_utc=stamp,
        )
        if gate_report is not None:
            gate.record(gate_report, rel_key, payload)  # type: ignore[arg-type]
            gate_report.results.extend(stop_stream_findings)  # type: ignore[attr-defined]
            gate_report.checks_run += 1  # type: ignore[attr-defined]
        else:
            effective_report.results.extend(  # type: ignore[attr-defined]
                [
                    *gate.check_stop_history_index(payload, rel_key=rel_key),
                    *stop_stream_findings,
                ]
            )
            effective_report.payloads_checked += 1  # type: ignore[attr-defined]
            effective_report.checks_run += 2  # type: ignore[attr-defined]
        gate.enforce(effective_report, force=force)  # type: ignore[arg-type]
        stop_pointer_summary.observe(stop_index, index_path=rel_key)
        stop_directory_summary.observe(stop_index, index_path=rel_key)
    stop_complete_findings = gate.check_stop_history_stream_entities(
        stop_directory_summary,
        stop_gate_summary,
    )
    effective_report.results.extend(stop_complete_findings)  # type: ignore[attr-defined]
    effective_report.checks_run += 1  # type: ignore[attr-defined]
    gate.enforce(effective_report, force=force)  # type: ignore[arg-type]

    line_directory_summary = gate.LineHistoryDirectorySummary.from_indexes(
        [index.model_copy(deep=True) for index in line_indexes],
        index_paths=line_index_paths,
    )
    line_directory = readdress_history_directory(
        line_build_summary.build_directory(
            [index.model_copy(deep=True) for index in line_indexes],
            fallback_generated_utc=stamp,
        ),
        line_index_paths,
    )
    _stamp_envelope(
        [("historic/history/lines/index.json", line_directory, "historic")],
        provider_id=provider_id,
        stamp=stamp,
    )
    line_directory_path = history_pointer_path("historic/history/lines", line_directory)
    line_directory_item = [(line_directory_path, line_directory, "historic_immutable")]
    line_directory_findings = gate.check_line_history_stream_directory(
        line_directory,
        line_directory_summary,
        fallback_generated_utc=stamp,
    )
    if gate_report is not None:
        gate.record(  # type: ignore[arg-type]
            gate_report,
            line_directory_path,
            line_directory,
        )
        gate_report.results.extend(line_directory_findings)  # type: ignore[attr-defined]
        gate_report.checks_run += 1  # type: ignore[attr-defined]
    else:
        effective_report.results.extend(  # type: ignore[attr-defined]
            [
                *gate.check_line_history_directory(
                    line_directory,
                    rel_key=line_directory_path,
                ),
                *line_directory_findings,
            ]
        )
        effective_report.payloads_checked += 1  # type: ignore[attr-defined]
        effective_report.checks_run += 2  # type: ignore[attr-defined]
    gate.enforce(effective_report, force=force)  # type: ignore[arg-type]

    stop_directory = stop_pointer_summary.build_directory(fallback_generated_utc=stamp)
    _stamp_envelope(
        [("historic/history/stops/index.json", stop_directory, "historic")],
        provider_id=provider_id,
        stamp=stamp,
    )
    stop_directory_path = history_pointer_path("historic/history/stops", stop_directory)
    stop_directory_item = [(stop_directory_path, stop_directory, "historic_immutable")]
    stop_directory_findings = gate.check_stop_history_stream_directory(
        stop_directory,
        stop_directory_summary,
        fallback_generated_utc=stamp,
    )
    if gate_report is not None:
        gate.record(  # type: ignore[arg-type]
            gate_report,
            stop_directory_path,
            stop_directory,
        )
        gate_report.results.extend(stop_directory_findings)  # type: ignore[attr-defined]
        gate_report.checks_run += 1  # type: ignore[attr-defined]
    else:
        effective_report.results.extend(  # type: ignore[attr-defined]
            [
                *gate.check_stop_history_directory(
                    stop_directory,
                    rel_key=stop_directory_path,
                ),
                *stop_directory_findings,
            ]
        )
        effective_report.payloads_checked += 1  # type: ignore[attr-defined]
        effective_report.checks_run += 2  # type: ignore[attr-defined]
    gate.enforce(effective_report, force=force)  # type: ignore[arg-type]

    if receipts_index is None:
        raise RuntimeError("historic retained-history root requires the built ReceiptsIndex child")
    if not isinstance(alert_archive.index, AlertArchiveIndex):
        raise RuntimeError(
            "historic retained-history root requires the built AlertArchiveIndex child"
        )
    root_alert_index = alert_archive.index
    alert_index_path = history_pointer_path("historic/alerts", root_alert_index)
    receipt_index_path = history_pointer_path("historic/receipts", receipts_index)
    if gate_report is not None:
        gate.record(gate_report, alert_index_path, root_alert_index)  # type: ignore[arg-type]
        gate.record(gate_report, receipt_index_path, receipts_index)  # type: ignore[arg-type]
    else:
        effective_report.results.extend(  # type: ignore[attr-defined]
            [
                *gate.check_alert_archive_index(
                    root_alert_index,
                    rel_key=alert_index_path,
                ),
                *gate.check_receipts_index(
                    receipts_index,
                    rel_key=receipt_index_path,
                ),
            ]
        )
        effective_report.payloads_checked += 2  # type: ignore[attr-defined]
        effective_report.checks_run += 2  # type: ignore[attr-defined]
    gate.enforce(effective_report, force=force)  # type: ignore[arg-type]
    root = _build_history_availability_index(
        stamp=stamp,
        alert_index=root_alert_index,
        receipts_index=receipts_index,
        network_index=network_index,
        line_directory=line_directory,
        line_indexes=line_indexes,
        stop_directory=stop_directory,
        hotspots_index=hotspots_index,
        repeat_offenders_index=repeat_offenders_index,
        stop_family=stop_pointer_summary.build_family(
            stop_directory,
            index_path=stop_directory_path,
        ),
        stop_generated_utc=stop_pointer_summary.generated_utc,
        alert_index_path=alert_index_path,
        receipt_index_path=receipt_index_path,
        network_index_path=network_index_path,
        line_directory_path=line_directory_path,
        stop_directory_path=stop_directory_path,
        hotspots_index_path=hotspot_index_path,
        repeat_offenders_index_path=repeat_offenders_index_path,
    )
    root_item = [(root_rel_key, root, "historic")]
    _stamp_envelope(root_item, provider_id=provider_id, stamp=stamp)
    root_graph_findings = gate.check_history_availability_graph(
        root,
        alert_index=root_alert_index,
        receipts_index=receipts_index,
        network_index=network_index,
        line_directory=line_directory,
        line_indexes=[index.model_copy(deep=True) for index in line_indexes],
        stop_directory=stop_directory,
        hotspots_index=hotspots_index,
        repeat_offenders_index=repeat_offenders_index,
        stop_summary=stop_directory_summary,
        fallback_generated_utc=stamp,
        alert_index_path=alert_index_path,
        receipt_index_path=receipt_index_path,
        network_index_path=network_index_path,
        line_directory_path=line_directory_path,
        stop_directory_path=stop_directory_path,
        hotspots_index_path=hotspot_index_path,
        repeat_offenders_index_path=repeat_offenders_index_path,
    )
    if gate_report is not None:
        gate.record(gate_report, root_rel_key, root)  # type: ignore[arg-type]
        gate_report.results.extend(root_graph_findings)  # type: ignore[attr-defined]
        gate_report.checks_run += 1  # type: ignore[attr-defined]
    else:
        effective_report.results.extend(
            [
                *gate.check_history_availability_index(
                    root,
                    rel_key=root_rel_key,
                ),
                *root_graph_findings,
            ]
        )
        effective_report.payloads_checked += 1  # type: ignore[attr-defined]
        effective_report.checks_run += 2  # type: ignore[attr-defined]
    gate.enforce(effective_report, force=force)  # type: ignore[arg-type]

    if gate_report is not None:
        gate.finalize_batch(
            gate_report,  # type: ignore[arg-type]
            route_payloads=[(k, p) for (k, p, _t) in route_items],
            current_total=_stable_item_total(items) + 1,
            prior_files_total=prior_files_total,
            network_trend=_find_network_trend(items),
        )
    gate.enforce(effective_report, force=force)  # type: ignore[arg-type]

    point_index_keys = _parallel_put(
        storage,
        [hotspot_index_item, repeat_offenders_index_item],
        concurrency=concurrency,
        write_mode="immutable",
    )
    compatibility_keys = _publish_stages(
        storage,
        stages,
        concurrency=concurrency,
    )
    root_family_index_keys = _parallel_put(
        storage,
        [
            (alert_index_path, root_alert_index, "historic_immutable"),
            (receipt_index_path, receipts_index, "historic_immutable"),
            *network_index_item,
        ],
        concurrency=concurrency,
        write_mode="immutable",
    )
    line_index_keys = _parallel_put(
        storage,
        line_index_items,
        concurrency=concurrency,
        write_mode="immutable",
    )
    stop_index_keys: list[str] = []
    stop_index_batch: list[tuple[str, object, str]] = []
    for stop_index in stop_build_summary.iter_indexes(fallback_generated_utc=stamp):
        if not stop_index.entity_id:
            continue
        stop_index_batch.append(
            (
                stop_index_paths[stop_index.entity_id],
                stop_index,
                "historic_immutable",
            )
        )
        if len(stop_index_batch) >= STOP_HISTORY_INDEX_UPLOAD_BATCH_SIZE:
            _stamp_envelope(stop_index_batch, provider_id=provider_id, stamp=stamp)
            stop_index_keys.extend(
                _parallel_put(
                    storage,
                    stop_index_batch,
                    concurrency=concurrency,
                    write_mode="immutable",
                )
            )
            stop_index_batch = []
    if stop_index_batch:
        _stamp_envelope(stop_index_batch, provider_id=provider_id, stamp=stamp)
        stop_index_keys.extend(
            _parallel_put(
                storage,
                stop_index_batch,
                concurrency=concurrency,
                write_mode="immutable",
            )
        )
    line_directory_keys = _parallel_put(
        storage,
        line_directory_item,
        concurrency=concurrency,
        write_mode="immutable",
    )
    stop_directory_keys = _parallel_put(
        storage,
        stop_directory_item,
        concurrency=concurrency,
        write_mode="immutable",
    )
    activate_stable_json = getattr(storage, "activate_stable_json", None)
    if root_version is not None and callable(activate_stable_json):
        root_key = activate_stable_json(
            root_rel_key,
            root,
            expected_version=root_version,
            tier="historic",
        )
    else:
        root_key = storage.put_json(  # type: ignore[attr-defined]
            root_rel_key,
            root,
            tier="historic",
        )
    return [
        *hotspot_keys,
        *repeat_offender_keys,
        *network_keys,
        *line_keys,
        *stop_keys,
        *point_index_keys,
        *compatibility_keys,
        *root_family_index_keys,
        *line_index_keys,
        *stop_index_keys,
        *line_directory_keys,
        *stop_directory_keys,
        root_key,
    ]


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
        head_items.append(
            (
                f"labels/{lang}.json",
                builders.build_labels(
                    conn, provider_id=provider_id, lang=lang, generated_utc=stamp
                ),  # type: ignore[arg-type]
                "static",
            )
        )
    _stamp_envelope(head_items, provider_id=provider_id, stamp=stamp)  # GC2 H4
    written.extend(_parallel_put(storage, head_items, concurrency=concurrency))

    # --- per-route files (built sequentially on this conn, uploaded in pool) ---
    route_rows = conn.execute(  # type: ignore[attr-defined]
        _DIM_ROUTE_IDS_SQL,
        {"provider_id": provider_id},
    ).fetchall()
    route_items = [
        (
            f"static/routes/{route_id}.json",
            builders.build_route(
                conn, provider_id=provider_id, route_id=str(route_id), generated_utc=stamp
            ),  # type: ignore[arg-type]
            "static",
        )
        for (route_id,) in route_rows
    ]
    _stamp_envelope(route_items, provider_id=provider_id, stamp=stamp)  # GC2 H4
    written.extend(_parallel_put(storage, route_items, concurrency=concurrency))

    # --- per-stop files (reuse all_stops built above, parallel upload) ---
    stop_items = [
        (f"static/stops/{stop_id}.json", stop_file, "static")
        for stop_id, stop_file in sorted(all_stops.items())
    ]
    _stamp_envelope(stop_items, provider_id=provider_id, stamp=stamp)  # GC2 H4
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
            # ONE stamp per cycle: the same gen flows into the payload build (manifest
            # + envelope) AND the state row below (S11 review F1).
            keys = _publish_live(
                conn,
                storage,
                provider_id=provider_id,
                settings=settings,
                gate_report=live_report,
                gen=gen,
            )
            # Persist the live lane's last publish + gate outcome. Unlike static/
            # historic this row is NOT hash-gate bookkeeping (live is un-gated) — it
            # exists so the data-health payload can serve the live lane's freshness +
            # gate summary. The report is fully populated by _publish_live above (the
            # record loop ran); enforce() below only logs. The NEXT cycle's
            # build_data_health reads THIS row (last-completed-publish semantics).
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
            gate.enforce(live_report, force=True)  # WARN-only: never aborts live
        return PublishResult(
            provider_id=provider_id,
            tier=tier,
            keys_written=keys,
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
        _acquire_publish_lock(conn, provider_id=provider_id, tier=tier)
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
            # Historic gate: compatibility payloads are gated before their mutable stage,
            # while retained month partitions stream through the gate one at a time. A
            # later failure can leave harmless unreferenced immutable months, but no new
            # retained pointer is written. force bypasses ERROR abort (a logged override).
            # Coverage uses the prior publish's WHOLE-tier files_total (None on first run).
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
        physical_written = len(gated.written) + len(gated.immutable_written)
        physical_skipped = len(gated.skipped) + len(gated.immutable_skipped)
        physical_total = physical_written + physical_skipped
        stable_total = _stable_outcome_total(gated)
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
        )

    return PublishResult(
        provider_id=provider_id,
        tier=tier,
        keys_written=[*gated.written, *gated.immutable_written],
        keys_skipped=[*gated.skipped, *gated.immutable_skipped],
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

    def put_immutable_json(self, rel_key: str, payload: object) -> str:
        self.collected.append((rel_key, payload))
        return rel_key


def collect_payloads(
    provider_id: str,
    *,
    tier: str,
    settings: object = None,
    engine: object = None,
    include_archive_bundle: bool = False,
    include_network_bundle: bool = False,
    include_line_bundle: bool = False,
    include_stop_bundle: bool = False,
    include_point_bundle: bool = False,
    _historic_consumer: Callable[[tuple], object] | None = None,
) -> tuple | object:
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
            # Stamp the H4 envelope here too (mirrors _publish_live) so the pre-publish
            # audit inspects the SAME bytes a real publish uploads, not un-stamped ones.
            _stamp_envelope(items, provider_id=provider_id, stamp=gen)
            return ([(k, p) for (k, p, _t) in items], [], gen, None)

        if tier == "historic":
            stamp = _historic_stamp()
            items, route_items, _stages, _alert_archive = _build_historic_items(
                conn, provider_id=provider_id, settings=settings, stamp=stamp
            )
            # Stamp the H4 envelope here too (mirrors _publish_historic) so the audit
            # sees published bytes. (Static is already stamped inside _publish_static.)
            _stamp_envelope(items, provider_id=provider_id, stamp=stamp)
            _finalize_receipts_collection_generation(items)
            network_history = None
            if include_network_bundle:
                network_history = builders.build_network_history_plan(
                    conn,  # type: ignore[arg-type]
                    provider_id=provider_id,
                    generated_utc=stamp,
                )
            line_history = None
            if include_line_bundle:
                line_history = builders.build_line_history_plan(
                    conn,  # type: ignore[arg-type]
                    provider_id=provider_id,
                    generated_utc=stamp,
                )
            stop_history = None
            if include_stop_bundle:
                stop_history = builders.build_stop_history_plan(
                    conn,  # type: ignore[arg-type]
                    provider_id=provider_id,
                    generated_utc=stamp,
                )
            point_plans = (
                _build_historic_point_plans(conn, provider_id=provider_id)
                if include_point_bundle
                else None
            )
            prior_total = _prior_files_total(conn, provider_id=provider_id, tier=tier)
            result = (
                [(k, p) for (k, p, _t) in items],
                [(k, p) for (k, p, _t) in route_items],
                stamp,
                prior_total,
            )
            extras: list[object] = []
            if include_archive_bundle:
                extras.append(_alert_archive)
            if include_network_bundle:
                extras.append(network_history)
            if include_line_bundle:
                extras.append(line_history)
            if include_stop_bundle:
                extras.append(stop_history)
            if include_point_bundle:
                extras.append(point_plans)
            collected = (*result, *extras)
            if _historic_consumer is not None:
                return _historic_consumer(collected)
            return collected

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
    _collected: tuple | None = None,
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
    if not isinstance(collected, tuple):
        raise TypeError("snapshot collection must be a tuple")
    all_items, route_items, stamp, prior_total = collected[:4]
    alert_archive = collected[4] if len(collected) > 4 else None
    network_history = collected[5] if len(collected) > 5 else None
    line_history = collected[6] if len(collected) > 6 else None
    stop_history = collected[7] if len(collected) > 7 else None
    point_plans = next(
        (value for value in collected[4:] if isinstance(value, HistoricPointPlanBundle)),
        None,
    )
    report = gate.new_report(provider_id, tier, stamp)
    for rel_key, payload in all_items:
        gate.record(report, rel_key, payload)
    if tier == "historic":
        hotspot_summary: PointHistorySummary | None = None
        hotspots_index: HistoricCollectionIndex | None = None
        hotspots_index_path: str | None = None
        repeat_offenders_summary: PointHistorySummary | None = None
        repeat_offenders_index: HistoricCollectionIndex | None = None
        repeat_offenders_index_path: str | None = None
        if point_plans is not None:
            hotspot_summary, hotspots_index, hotspots_index_path = _validate_point_history_plan(
                point_plans.hotspots,
                family="hotspots",
                provider_id=provider_id,
                stamp=stamp,
                report=report,
            )
            repeat_offenders_summary, repeat_offenders_index, repeat_offenders_index_path = (
                _validate_point_history_plan(
                    point_plans.repeat_offenders,
                    family="repeat_offenders",
                    provider_id=provider_id,
                    stamp=stamp,
                    report=report,
                )
            )
        receipts_index = next(
            (
                payload
                for rel_key, payload in all_items
                if rel_key == "historic/receipts/index.json" and isinstance(payload, ReceiptsIndex)
            ),
            None,
        )
        receipt_items = [
            (rel_key, payload)
            for rel_key, payload in all_items
            if rel_key.startswith("historic/receipts/")
            and rel_key != "historic/receipts/index.json"
        ]
        if receipts_index is not None:
            report.results.extend(gate.check_receipts_collection(receipts_index, receipt_items))
            report.checks_run += 1
        if alert_archive is not None:
            report.results.extend(
                gate.check_alert_archive_bundle(
                    alert_archive.index,
                    alert_archive.page_items,
                    provider_timezone=alert_archive.provider_timezone,
                )
            )
        if network_history is not None:
            network_summary = gate.NetworkHistoryStreamSummary()
            for ref, payload in network_history.iter_partition_items():
                gate.record(report, ref.path, payload)
                report.results.extend(gate.check_network_history_partition_ref(ref, payload))
                network_summary.observe(ref, payload)
            network_index = network_history.build_index(network_summary.detached_refs())
            _stamp_envelope(
                [("historic/history/network/index.json", network_index, "historic")],
                provider_id=provider_id,
                stamp=stamp,
            )
            network_index_path = history_pointer_path(
                "historic/history/network",
                network_index,
            )
            gate.record(
                report,
                network_index_path,
                network_index,
            )
            report.results.extend(
                gate.check_network_history_stream_index(
                    network_index,
                    network_summary,
                    fallback_generated_utc=stamp,
                )
            )
            report.checks_run += 1
        line_indexes: list[HistoricCollectionIndex] = []
        line_directory: HistoricEntityDirectoryIndex | None = None
        if line_history is not None:
            line_build_summary = builders.LineHistoryStreamSummary()
            line_gate_summary = gate.LineHistoryStreamSummary()
            for ref, payload in line_history.iter_partition_items():
                gate.record(report, ref.path, payload)
                report.results.extend(gate.check_line_history_partition_ref(ref, payload))
                line_gate_summary.observe(ref, payload)
                line_build_summary.observe(ref, payload)
            line_indexes = line_build_summary.build_indexes(fallback_generated_utc=stamp)
            line_index_items = [
                (
                    f"historic/history/lines/{index.entity_id.encode('utf-8').hex()}/index.json",
                    index,
                    "historic",
                )
                for index in line_indexes
                if index.entity_id
            ]
            _stamp_envelope(line_index_items, provider_id=provider_id, stamp=stamp)
            line_index_paths = {
                index.entity_id or "": history_pointer_path(
                    f"historic/history/lines/{index.entity_id.encode('utf-8').hex()}",
                    index,
                )
                for index in line_indexes
                if index.entity_id
            }
            for payload in line_indexes:
                if not payload.entity_id:
                    continue
                rel_key = line_index_paths[payload.entity_id]
                gate.record(report, rel_key, payload)
            report.results.extend(
                gate.check_line_history_stream_indexes(
                    line_indexes,
                    line_gate_summary,
                    fallback_generated_utc=stamp,
                )
            )
            report.checks_run += 1
            directory_summary = gate.LineHistoryDirectorySummary.from_indexes(
                [index.model_copy(deep=True) for index in line_indexes],
                index_paths=line_index_paths,
            )
            line_directory = readdress_history_directory(
                line_build_summary.build_directory(
                    [index.model_copy(deep=True) for index in line_indexes],
                    fallback_generated_utc=stamp,
                ),
                line_index_paths,
            )
            _stamp_envelope(
                [("historic/history/lines/index.json", line_directory, "historic")],
                provider_id=provider_id,
                stamp=stamp,
            )
            line_directory_path = history_pointer_path(
                "historic/history/lines",
                line_directory,
            )
            gate.record(report, line_directory_path, line_directory)
            report.results.extend(
                gate.check_line_history_stream_directory(
                    line_directory,
                    directory_summary,
                    fallback_generated_utc=stamp,
                )
            )
            report.checks_run += 1

        stop_pointer_summary: builders.StopHistoryPointerSummary | None = None
        stop_directory_summary: gate.StopHistoryDirectorySummary | None = None
        stop_directory: HistoricEntityDirectoryIndex | None = None
        if stop_history is not None:
            stop_build_summary = builders.StopHistoryStreamSummary()
            stop_gate_summary = gate.StopHistoryStreamSummary()
            for ref, payload in stop_history.iter_partition_items():
                gate.record(report, ref.path, payload, retain_sha=False)
                report.results.extend(gate.check_stop_history_partition_ref(ref, payload))
                stop_gate_summary.observe(ref, payload)
                stop_build_summary.observe(ref, payload)
            stop_pointer_summary = builders.StopHistoryPointerSummary()
            stop_directory_summary = gate.StopHistoryDirectorySummary()
            for index in stop_build_summary.iter_indexes(fallback_generated_utc=stamp):
                if not index.entity_id:
                    continue
                index_item = [
                    (
                        f"historic/history/stops/{index.entity_id.encode('utf-8').hex()}/index.json",
                        index,
                        "historic",
                    )
                ]
                _stamp_envelope(index_item, provider_id=provider_id, stamp=stamp)
                _legacy_rel_key, payload, _tier = index_item[0]
                rel_key = history_pointer_path(
                    f"historic/history/stops/{index.entity_id.encode('utf-8').hex()}",
                    payload,
                )
                gate.record(report, rel_key, payload)
                report.results.extend(
                    gate.check_stop_history_stream_index(
                        payload,
                        stop_gate_summary,
                        fallback_generated_utc=stamp,
                    )
                )
                report.checks_run += 1
                stop_pointer_summary.observe(index, index_path=rel_key)
                stop_directory_summary.observe(index, index_path=rel_key)
            report.results.extend(
                gate.check_stop_history_stream_entities(
                    stop_directory_summary,
                    stop_gate_summary,
                )
            )
            report.checks_run += 1
            stop_directory = stop_pointer_summary.build_directory(fallback_generated_utc=stamp)
            _stamp_envelope(
                [("historic/history/stops/index.json", stop_directory, "historic")],
                provider_id=provider_id,
                stamp=stamp,
            )
            stop_directory_path = history_pointer_path(
                "historic/history/stops",
                stop_directory,
            )
            gate.record(report, stop_directory_path, stop_directory)
            report.results.extend(
                gate.check_stop_history_stream_directory(
                    stop_directory,
                    stop_directory_summary,
                    fallback_generated_utc=stamp,
                )
            )
            report.checks_run += 1

        if (
            alert_archive is not None
            and isinstance(alert_archive.index, AlertArchiveIndex)
            and network_history is not None
            and line_directory is not None
            and stop_directory is not None
        ):
            if receipts_index is None:
                raise RuntimeError("historic validation requires the built ReceiptsIndex child")
            if stop_pointer_summary is None or stop_directory_summary is None:
                raise RuntimeError("historic validation requires compact Stop pointer truth")
            alert_index_path = history_pointer_path("historic/alerts", alert_archive.index)
            receipt_index_path = history_pointer_path("historic/receipts", receipts_index)
            gate.record(report, alert_index_path, alert_archive.index)
            gate.record(report, receipt_index_path, receipts_index)
            root = _build_history_availability_index(
                stamp=stamp,
                alert_index=alert_archive.index,
                receipts_index=receipts_index,
                network_index=network_index,
                line_directory=line_directory,
                line_indexes=line_indexes,
                stop_directory=stop_directory,
                hotspots_index=hotspots_index,
                repeat_offenders_index=repeat_offenders_index,
                stop_family=stop_pointer_summary.build_family(
                    stop_directory,
                    index_path=stop_directory_path,
                ),
                stop_generated_utc=stop_pointer_summary.generated_utc,
                alert_index_path=alert_index_path,
                receipt_index_path=receipt_index_path,
                network_index_path=network_index_path,
                line_directory_path=line_directory_path,
                stop_directory_path=stop_directory_path,
                hotspots_index_path=hotspots_index_path,
                repeat_offenders_index_path=repeat_offenders_index_path,
            )
            _stamp_envelope(
                [("historic/history/index.json", root, "historic")],
                provider_id=provider_id,
                stamp=stamp,
            )
            gate.record(report, "historic/history/index.json", root)
            report.results.extend(
                gate.check_history_availability_graph(
                    root,
                    alert_index=alert_archive.index,
                    receipts_index=receipts_index,
                    network_index=network_index,
                    line_directory=line_directory,
                    line_indexes=[index.model_copy(deep=True) for index in line_indexes],
                    stop_directory=stop_directory,
                    hotspots_index=hotspots_index,
                    repeat_offenders_index=repeat_offenders_index,
                    stop_summary=stop_directory_summary,
                    fallback_generated_utc=stamp,
                    alert_index_path=alert_index_path,
                    receipt_index_path=receipt_index_path,
                    network_index_path=network_index_path,
                    line_directory_path=line_directory_path,
                    stop_directory_path=stop_directory_path,
                    hotspots_index_path=hotspots_index_path,
                    repeat_offenders_index_path=repeat_offenders_index_path,
                )
            )
            report.checks_run += 1
        gate.finalize_batch(
            report,
            route_payloads=route_items,
            current_total=(
                sum(1 for key, _payload in all_items if not _is_immutable_item(key))
                + (1 if line_directory is not None and stop_directory is not None else 0)
            ),
            prior_files_total=prior_total,
            network_trend=next(
                ((k, p) for (k, p) in all_items if k == "historic/network_trend.json"), None
            ),
        )
    return report
