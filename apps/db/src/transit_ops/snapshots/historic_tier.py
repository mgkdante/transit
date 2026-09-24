"""Collect, validate and publish historic graphs within the caller's database lifetime."""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import Literal, cast

from sqlalchemy.engine import Connection

from transit_ops.ingestion.common import utc_now
from transit_ops.settings import Settings
from transit_ops.snapshots import builders, envelope, gate, historic_compatibility, uploads
from transit_ops.snapshots import historic_receipts as _historic
from transit_ops.snapshots.builders.historic.history_common import (
    history_pointer_path,
)
from transit_ops.snapshots.contract import (
    AlertArchiveIndex,
    HistoricCollectionIndex,
    HistoricEntityDirectoryIndex,
    HistoricHotspotsDay,
    HistoricRepeatOffendersDay,
    ReceiptsIndex,
)
from transit_ops.snapshots.historic_graph import (
    HISTORY_ROOT_PATH,
    HistoricGraph,
    LineHistoryFamily,
    StopHistoryFamily,
)
from transit_ops.snapshots.historic_receipts import (
    _HistoricPublishRun,
    prepare_historic_receipt_preflight,
)
from transit_ops.snapshots.historic_streams import (
    HistoricParentComposer,
    HistoricPlans,
    PointDayPlan,
    consume_history_children,
    consume_point_days,
)
from transit_ops.snapshots.protocols import (
    CollectedItem,
    HistoricWriter,
    SnapshotPayload,
)
from transit_ops.snapshots.publication_lane import (
    PublishLockUnavailableError as PublishLockUnavailableError,
)
from transit_ops.sql_registry import named_query

type _LegacyCollected = tuple[list[CollectedItem], list[CollectedItem], str, int | None]
type HistoricInclude = Literal["archive", "network", "lines", "stops", "points"]
STOP_HISTORY_INDEX_UPLOAD_BATCH_SIZE = 100
HISTORY_PARTITION_UPLOAD_BATCH_SIZE = 32


@dataclass(frozen=True)
class HistoricPointPlanBundle:
    hotspots: PointDayPlan[HistoricHotspotsDay]
    repeat_offenders: PointDayPlan[HistoricRepeatOffendersDay]


@dataclass(frozen=True)
class HistoricValidationInputs:
    """Named optional historic bundles consumed before their DB connection closes."""

    all_items: list[tuple[str, object]]
    route_items: list[tuple[str, object]]
    stamp: str
    prior_total: int | None
    alert_archive: builders.AlertArchiveBundle | None = None
    network_history: builders.NetworkHistoryPlan | None = None
    line_history: builders.LineHistoryPlan | None = None
    stop_history: builders.StopHistoryPlan | None = None
    point_plans: HistoricPointPlanBundle | None = None


def _build_historic_point_plans(
    conn: Connection,
    *,
    provider_id: str,
) -> HistoricPointPlanBundle:
    hotspots = builders.build_hotspots_history_plan(
        conn,
        provider_id=provider_id,
    )
    return HistoricPointPlanBundle(
        hotspots=hotspots,
        repeat_offenders=builders.build_repeat_offenders_history_plan(
            conn,
            provider_id=provider_id,
            names=hotspots.names,
        ),
    )


_CLEAR_REFERENCED_HISTORIC_GC_MARKS_SQL = named_query(
    "publish.historic_gc.clear_referenced",
    "DELETE FROM core.snapshot_historic_gc_marks "
    "WHERE provider_id = :provider_id "
    "AND object_key = ANY(CAST(:object_keys AS text[]))",
)


def _clear_referenced_historic_gc_marks(
    conn: Connection,
    provider_id: str,
    object_keys: Sequence[str],
) -> None:
    """Reset continuous-unreachability age for every generation in the next graph."""

    keys = sorted(set(object_keys))
    if not keys:
        return
    conn.execute(
        _CLEAR_REFERENCED_HISTORIC_GC_MARKS_SQL,
        {"provider_id": provider_id, "object_keys": keys},
    )


def publication_stamp() -> str:
    """UTC day label; immutable hashes distinguish same-day historic corrections."""
    return utc_now().strftime("%Y-%m-%dT00:00:00Z")


def publish(
    conn: Connection,
    storage: HistoricWriter,
    *,
    provider_id: str,
    settings: Settings,
    stamp: str | None = None,
    gate_report: gate.GateReport | None = None,
    prior_files_total: int | None = None,
    force: bool = False,
    _historic_run: _HistoricPublishRun | None = None,
) -> list[str]:
    """Build, gate, and stage the complete historic snapshot graph.

    One provider executor serves every bounded upload batch. Each barrier drains
    before its parent advances, and the exact seven-family root activates last.
    Builders and gates still recompute the complete retained graph each run.
    """
    if not isinstance(storage, HistoricWriter):
        raise TypeError("historic publication requires a conditional historic writer")
    if stamp is None:
        stamp = publication_stamp()
    concurrency = uploads.concurrency(settings)
    with uploads.provider_executor(concurrency):
        _historic._activate_historic_phase(_historic_run, "parent_compose")
        root_rel_key = HISTORY_ROOT_PATH
        root_version = storage.capture_stable_version(root_rel_key)

        _historic._activate_historic_phase(_historic_run, "compatibility")
        compatibility = historic_compatibility.build(
            conn, provider_id=provider_id, settings=settings, stamp=stamp
        )
        items, route_items, stages, alert_archive = (
            compatibility.items,
            compatibility.routes,
            compatibility.stages,
            compatibility.alerts,
        )
        receipts_index = next(
            (
                payload
                for rel_key, payload, _tier in items
                if rel_key == "historic/receipts/index.json" and isinstance(payload, ReceiptsIndex)
            ),
            None,
        )
        receipt_items: list[CollectedItem] = [
            (rel_key, payload)
            for rel_key, payload, _tier in items
            if rel_key.startswith("historic/receipts/")
            and rel_key != "historic/receipts/index.json"
        ]
        receipt_findings = (
            gate.check_receipts_collection(receipts_index, receipt_items)
            if receipts_index is not None
            else []
        )

        network_history, line_history, stop_history = _historic._build_historic_history_plans(
            _historic_run,
            conn,
            provider_id,
            stamp,
            builders.build_network_history_plan,
            builders.build_line_history_plan,
            builders.build_stop_history_plan,
        )
        point_plans = _build_historic_point_plans(conn, provider_id=provider_id)
        effective_report = gate_report or gate.new_report(provider_id, "historic", stamp)
        alert_findings = gate.check_alert_archive_bundle(
            alert_archive.index,
            cast(list[tuple[str, object]], alert_archive.page_items),
            provider_timezone=alert_archive.provider_timezone,
        )

        if gate_report is not None:
            for rel_key, payload, _tier in items:
                gate.record(gate_report, rel_key, payload)
            gate_report.results.extend([*alert_findings, *receipt_findings])
            gate_report.checks_run += 1
        else:
            effective_report.results.extend([*alert_findings, *receipt_findings])
            effective_report.payloads_checked = len(alert_archive.page_items) + 1
            effective_report.checks_run = 2
        gate.enforce(effective_report, force=force)

        _historic._prepare_historic_receipt_run(
            _historic_run,
            conn,
            provider_id,
            (network_history, line_history, stop_history),
            prepare_historic_receipt_preflight,
        )

        hotspot_summary, hotspot_keys = consume_point_days(
            point_plans.hotspots,
            family="hotspots",
            storage=storage,
            report=effective_report,
            record_payloads=gate_report is not None,
            force=force,
            concurrency=concurrency,
        )
        repeat_offenders_summary, repeat_offender_keys = consume_point_days(
            point_plans.repeat_offenders,
            family="repeat_offenders",
            storage=storage,
            report=effective_report,
            record_payloads=gate_report is not None,
            force=force,
            concurrency=concurrency,
        )
        parents = HistoricParentComposer(
            provider_id,
            stamp,
            effective_report,
            record_payloads=gate_report is not None,
            force=force,
        )
        hotspot_index_path, hotspots_index = parents.point_index(hotspot_summary)
        repeat_offenders_index_path, repeat_offenders_index = parents.point_index(
            repeat_offenders_summary
        )
        hotspot_index_item = (hotspot_index_path, hotspots_index, "historic_immutable")
        repeat_offenders_index_item = (
            repeat_offenders_index_path,
            repeat_offenders_index,
            "historic_immutable",
        )

        _historic._activate_historic_phase(_historic_run, "other")

        def write_children(batch: Sequence[tuple[str, SnapshotPayload]]) -> list[str]:
            return uploads.put_batch(
                storage,
                [(path, payload, "historic_immutable") for path, payload in batch],
                concurrency=concurrency,
                write_mode="immutable",
            )

        children = consume_history_children(
            HistoricPlans(network_history, line_history, stop_history),
            effective_report,
            batch_size=HISTORY_PARTITION_UPLOAD_BATCH_SIZE,
            write_batch=write_children,
            record_payloads=gate_report is not None,
            force=force,
            run=_historic_run,
        )
        _historic._activate_historic_phase(_historic_run, "parent_compose")
        network_index_path, network_index = parents.network_index(network_history, children.network)
        line_parents = parents.line_indexes(children.lines, children.line_gate)
        stop_indexes = list(children.stops.iter_indexes(fallback_generated_utc=stamp))
        stop_parents = parents.stop_indexes(stop_indexes, children.stop_gate)
        stop_pointer_summary, stop_directory_summary = stop_parents.pointers, stop_parents.summary
        stop_index_paths: dict[str, str] = {}
        stop_referenced_generation_keys: set[str] = set()
        for stop_parent in stop_parents.items:
            stop_index_paths[stop_parent.entity_id] = stop_parent.path
            stop_referenced_generation_keys.add(stop_parent.path)
            stop_referenced_generation_keys.update(stop_parent.referenced_keys)
        line_directory_path, line_directory = parents.line_directory(line_parents, children.lines)
        stop_directory_path, stop_directory = parents.stop_directory(stop_parents)

        if receipts_index is None:
            raise RuntimeError(
                "historic retained-history root requires the built ReceiptsIndex child"
            )
        if not isinstance(alert_archive.index, AlertArchiveIndex):
            raise RuntimeError(
                "historic retained-history root requires the built AlertArchiveIndex child"
            )
        root_alert_index = alert_archive.index
        alert_index_path = history_pointer_path("historic/alerts", root_alert_index)
        receipt_index_path = history_pointer_path("historic/receipts", receipts_index)
        graph = HistoricGraph(
            alerts=(alert_index_path, root_alert_index),
            receipts=(receipt_index_path, receipts_index),
            network=(network_index_path, network_index),
            lines=LineHistoryFamily((line_directory_path, line_directory), line_parents),
            stops=StopHistoryFamily(
                (stop_directory_path, stop_directory),
                stop_pointer_summary,
                stop_directory_summary,
            ),
            hotspots=(hotspot_index_path, hotspots_index),
            repeat_offenders=(repeat_offenders_index_path, repeat_offenders_index),
        )
        root = graph.record(parents)

        if gate_report is not None:
            gate.finalize_batch(
                gate_report,
                route_payloads=[(k, p) for (k, p, _t) in route_items],
                current_total=uploads.stable_item_total(items) + 1,
                prior_files_total=prior_files_total,
                network_trend=historic_compatibility._find_network_trend(items),
            )
        gate.enforce(effective_report, force=force)

        _historic._finalize_historic_receipt_run(
            _historic_run,
            provider_id,
            envelope.publish_generation_id(provider_id, stamp),
            effective_report,
            gate_report is not None,
            force,
        )

        _historic._activate_historic_phase(_historic_run, "compatibility")
        point_index_keys = uploads.put_batch(
            storage,
            [hotspot_index_item, repeat_offenders_index_item],
            concurrency=concurrency,
            write_mode="immutable",
        )
        compatibility_keys = uploads.put_stages(
            storage,
            stages,
            concurrency=concurrency,
        )
        _historic._activate_historic_phase(_historic_run, "parent_compose")
        root_family_index_keys = uploads.put_batch(
            storage,
            [
                (alert_index_path, root_alert_index, "historic_immutable"),
                (receipt_index_path, receipts_index, "historic_immutable"),
                (network_index_path, network_index, "historic_immutable"),
            ],
            concurrency=concurrency,
            write_mode="immutable",
        )
        line_index_keys = uploads.put_batch(
            storage,
            [(path, index, "historic_immutable") for path, index in line_parents.items],
            concurrency=concurrency,
            write_mode="immutable",
        )
        stop_index_keys = uploads.put_batches(
            storage,
            (
                (stop_index_paths[index.entity_id], index, "historic_immutable")
                for index in stop_indexes
                if index.entity_id
            ),
            concurrency=concurrency,
            batch_size=STOP_HISTORY_INDEX_UPLOAD_BATCH_SIZE,
            write_mode="immutable",
        )
        line_directory_keys = uploads.put_batch(
            storage,
            [(line_directory_path, line_directory, "historic_immutable")],
            concurrency=concurrency,
            write_mode="immutable",
        )
        stop_directory_keys = uploads.put_batch(
            storage,
            [(stop_directory_path, stop_directory, "historic_immutable")],
            concurrency=concurrency,
            write_mode="immutable",
        )
        _clear_referenced_historic_gc_marks(
            conn,
            provider_id,
            graph.immutable_references(
                hotspot_refs=hotspot_summary.refs,
                repeat_offender_refs=repeat_offenders_summary.refs,
                stop_keys=stop_referenced_generation_keys,
            ),
        )
        root_key = storage.activate_stable_json(
            root_rel_key,
            root,
            expected_version=root_version,
            tier="historic",
        )
        _historic._activate_historic_phase(_historic_run, "other")
        return [
            *hotspot_keys,
            *repeat_offender_keys,
            *children.written_keys,
            *point_index_keys,
            *compatibility_keys,
            *root_family_index_keys,
            *line_index_keys,
            *stop_index_keys,
            *line_directory_keys,
            *stop_directory_keys,
            root_key,
        ]


def collect(
    conn: Connection,
    *,
    provider_id: str,
    settings: Settings,
    stamp: str,
    include: Collection[HistoricInclude],
) -> HistoricValidationInputs:
    """Build requested lazy plans; the caller must consume them before closing conn."""
    compatibility = historic_compatibility.build(
        conn, provider_id=provider_id, settings=settings, stamp=stamp
    )
    items, route_items, _alert_archive = (
        compatibility.items,
        compatibility.routes,
        compatibility.alerts,
    )
    network_history = None
    if "network" in include:
        network_history = builders.build_network_history_plan(
            conn,
            provider_id=provider_id,
            generated_utc=stamp,
        )
    line_history = None
    if "lines" in include:
        line_history = builders.build_line_history_plan(
            conn,
            provider_id=provider_id,
            generated_utc=stamp,
        )
    stop_history = None
    if "stops" in include:
        stop_history = builders.build_stop_history_plan(
            conn,
            provider_id=provider_id,
            generated_utc=stamp,
        )
    point_plans = (
        _build_historic_point_plans(conn, provider_id=provider_id) if "points" in include else None
    )
    return HistoricValidationInputs(
        all_items=[(k, p) for (k, p, _t) in items],
        route_items=[(k, p) for (k, p, _t) in route_items],
        stamp=stamp,
        prior_total=None,
        alert_archive=_alert_archive if "archive" in include else None,
        network_history=network_history,
        line_history=line_history,
        stop_history=stop_history,
        point_plans=point_plans,
    )


def validate(
    provider_id: str, collected: HistoricValidationInputs | _LegacyCollected
) -> gate.GateReport:
    """Consume collected history once and return findings without enforcing publication."""
    all_items: Sequence[tuple[str, object]]
    route_items: Sequence[tuple[str, object]]
    if isinstance(collected, HistoricValidationInputs):
        all_items = collected.all_items
        route_items = collected.route_items
        stamp = collected.stamp
        prior_total = collected.prior_total
        alert_archive = collected.alert_archive
        network_history = collected.network_history
        line_history = collected.line_history
        stop_history = collected.stop_history
        point_plans = collected.point_plans
    elif isinstance(collected, tuple):
        all_items, route_items, stamp, prior_total = collected[:4]
        alert_archive = None
        network_history = None
        line_history = None
        stop_history = None
        point_plans = None
    else:
        raise TypeError("snapshot collection must be a tuple or HistoricValidationInputs")
    report = gate.new_report(provider_id, "historic", stamp)
    for rel_key, payload in all_items:
        gate.record(report, rel_key, payload)
    parents = HistoricParentComposer(provider_id, stamp, report)
    hotspots_index: HistoricCollectionIndex | None = None
    hotspots_index_path: str | None = None
    repeat_offenders_index: HistoricCollectionIndex | None = None
    repeat_offenders_index_path: str | None = None
    if point_plans is not None:
        hotspot_summary, _ = consume_point_days(
            point_plans.hotspots, family="hotspots", report=report
        )
        hotspots_index_path, hotspots_index = parents.point_index(hotspot_summary)
        repeat_summary, _ = consume_point_days(
            point_plans.repeat_offenders, family="repeat_offenders", report=report
        )
        repeat_offenders_index_path, repeat_offenders_index = parents.point_index(repeat_summary)
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
        if rel_key.startswith("historic/receipts/") and rel_key != "historic/receipts/index.json"
    ]
    if receipts_index is not None:
        report.results.extend(gate.check_receipts_collection(receipts_index, receipt_items))
        report.checks_run += 1
    if alert_archive is not None:
        report.results.extend(
            gate.check_alert_archive_bundle(
                alert_archive.index,
                cast(list[tuple[str, object]], alert_archive.page_items),
                provider_timezone=alert_archive.provider_timezone,
            )
        )
    if network_history is not None:
        network_summary = consume_history_children(
            HistoricPlans(network=network_history),
            report,
            batch_size=HISTORY_PARTITION_UPLOAD_BATCH_SIZE,
        ).network
        network_index_path, network_index = parents.network_index(
            network_history,
            network_summary,
        )
    line_directory: HistoricEntityDirectoryIndex | None = None
    if line_history is not None:
        children = consume_history_children(
            HistoricPlans(lines=line_history),
            report,
            batch_size=HISTORY_PARTITION_UPLOAD_BATCH_SIZE,
        )
        line_parents = parents.line_indexes(children.lines, children.line_gate)
        line_directory_path, line_directory = parents.line_directory(
            line_parents,
            children.lines,
        )

    stop_pointer_summary: builders.StopHistoryPointerSummary | None = None
    stop_directory_summary: gate.StopHistoryDirectorySummary | None = None
    stop_directory: HistoricEntityDirectoryIndex | None = None
    if stop_history is not None:
        children = consume_history_children(
            HistoricPlans(stops=stop_history),
            report,
            batch_size=HISTORY_PARTITION_UPLOAD_BATCH_SIZE,
        )
        stop_parents = parents.stop_indexes(
            children.stops.iter_indexes(fallback_generated_utc=stamp),
            children.stop_gate,
        )
        for _item in stop_parents.items:
            pass
        stop_pointer_summary = stop_parents.pointers
        stop_directory_summary = stop_parents.summary
        stop_directory_path, stop_directory = parents.stop_directory(stop_parents)

    if (
        alert_archive is not None
        and isinstance(alert_archive.index, AlertArchiveIndex)
        and network_history is not None
        and line_directory is not None
        and stop_directory is not None
        and hotspots_index is not None
        and repeat_offenders_index is not None
    ):
        if receipts_index is None:
            raise RuntimeError("historic validation requires the built ReceiptsIndex child")
        if stop_pointer_summary is None or stop_directory_summary is None:
            raise RuntimeError("historic validation requires compact Stop pointer truth")
        alert_index_path = history_pointer_path("historic/alerts", alert_archive.index)
        receipt_index_path = history_pointer_path("historic/receipts", receipts_index)
        graph = HistoricGraph(
            alerts=(alert_index_path, alert_archive.index),
            receipts=(receipt_index_path, receipts_index),
            network=(network_index_path, network_index),
            lines=LineHistoryFamily((line_directory_path, line_directory), line_parents),
            stops=StopHistoryFamily(
                (stop_directory_path, stop_directory),
                stop_pointer_summary,
                stop_directory_summary,
            ),
            hotspots=(
                hotspots_index_path
                or history_pointer_path(
                    "historic/history/hotspots",
                    hotspots_index,
                ),
                hotspots_index,
            ),
            repeat_offenders=(
                repeat_offenders_index_path
                or history_pointer_path(
                    "historic/history/repeat_offenders",
                    repeat_offenders_index,
                ),
                repeat_offenders_index,
            ),
        )
        graph.record(parents)
    gate.finalize_batch(
        report,
        route_payloads=cast(list[tuple[str, object]], route_items),
        current_total=(
            sum(1 for key, _payload in all_items if not uploads.is_immutable_item(key))
            + (1 if line_directory is not None and stop_directory is not None else 0)
        ),
        prior_files_total=prior_total,
        network_trend=next(
            ((k, p) for (k, p) in all_items if k == "historic/network_trend.json"), None
        ),
    )
    return report
