"""Compose the seven-family historic root and its exact immutable reference inventory."""

from collections.abc import Sequence, Set
from dataclasses import dataclass
from typing import cast

from transit_ops.snapshots import builders, envelope, gate
from transit_ops.snapshots.builders.historic.history_common import (
    history_coverage,
    history_date,
    history_metric_coverage,
    history_utc_timestamp,
    latest_history_timestamp,
)
from transit_ops.snapshots.contract import (
    AlertArchiveIndex,
    HistoricAvailabilityIndex,
    HistoricCollectionIndex,
    HistoricEntityDirectoryIndex,
    HistoricFamilyAvailability,
    HistoricPartitionRef,
    HistorySelectionMode,
    ReceiptsIndex,
)
from transit_ops.snapshots.historic_streams import (
    HistoricParentComposer,
    HistoryParent,
    LineParentIndexes,
)

HISTORY_ROOT_PATH = "historic/history/index.json"


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
        selection_mode=HistorySelectionMode.range,
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



@dataclass(frozen=True)
class LineHistoryFamily:
    index: HistoryParent[HistoricEntityDirectoryIndex]
    children: LineParentIndexes


@dataclass(frozen=True)
class StopHistoryFamily:
    index: HistoryParent[HistoricEntityDirectoryIndex]
    pointers: builders.StopHistoryPointerSummary
    summary: gate.StopHistoryDirectorySummary


@dataclass(frozen=True, kw_only=True)
class HistoricGraph:
    alerts: HistoryParent[AlertArchiveIndex]
    receipts: HistoryParent[ReceiptsIndex]
    network: HistoryParent[HistoricCollectionIndex]
    lines: LineHistoryFamily
    stops: StopHistoryFamily
    hotspots: HistoryParent[HistoricCollectionIndex]
    repeat_offenders: HistoryParent[HistoricCollectionIndex]

    def build_root(self, stamp: str) -> HistoricAvailabilityIndex:
        alert_index_path, alert_index = self.alerts
        receipt_index_path, receipts_index = self.receipts
        network_index_path, network_index = self.network
        line_directory_path, line_directory = self.lines.index
        stop_directory_path, stop_directory = self.stops.index
        hotspots_index_path, hotspots_index = self.hotspots
        repeat_offenders_index_path, repeat_offenders_index = self.repeat_offenders
        line_indexes = self.lines.children.indexes
        stop_generated_utc = self.stops.pointers.generated_utc
        receipt_dates = _valid_history_dates(receipts_index.dates)
        receipt_first, receipt_last, receipt_gaps = history_coverage(receipt_dates)
        families = [
            HistoricFamilyAvailability(
                family="alerts",
                selection_mode=HistorySelectionMode.range,
                index_path=alert_index_path,
                collection_generation_id=alert_index.collection_generation_id,
                first_available_date=alert_index.first_available_date,
                last_available_date=alert_index.last_available_date,
            ),
            HistoricFamilyAvailability(
                family="hotspots",
                selection_mode=HistorySelectionMode.date,
                index_path=hotspots_index_path,
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
                selection_mode=HistorySelectionMode.range,
                index_path=network_index_path,
                collection_generation_id=network_index.collection_generation_id,
                first_available_date=network_index.first_available_date,
                last_available_date=network_index.last_available_date,
                gaps=[gap.model_copy(deep=True) for gap in network_index.gaps],
                metrics=[metric.model_copy(deep=True) for metric in network_index.metrics],
            ),
            HistoricFamilyAvailability(
                family="repeat_offenders",
                selection_mode=HistorySelectionMode.date,
                index_path=repeat_offenders_index_path,
                collection_generation_id=repeat_offenders_index.collection_generation_id,
                first_available_date=repeat_offenders_index.first_available_date,
                last_available_date=repeat_offenders_index.last_available_date,
                gaps=[gap.model_copy(deep=True) for gap in repeat_offenders_index.gaps],
            ),
            HistoricFamilyAvailability(
                family="receipts",
                selection_mode=HistorySelectionMode.date,
                index_path=receipt_index_path,
                collection_generation_id=receipts_index.collection_generation_id,
                first_available_date=receipt_first,
                last_available_date=receipt_last,
                gaps=receipt_gaps,
            ),
            self.stops.pointers.build_family(stop_directory, index_path=stop_directory_path),
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
        if stop_generated_utc is not None:
            timestamp_candidates.append(stop_generated_utc)
        return HistoricAvailabilityIndex(
            generated_utc=latest_history_timestamp(
                _valid_history_timestamps(timestamp_candidates),
                fallback=stamp,
            ),
            methodology_version="history-1",
            families=sorted(families, key=lambda family: family.family),
        )

    def check(
        self, root: HistoricAvailabilityIndex, stamp: str, *, detached_lines: bool = False,
    ) -> list[gate.CheckResult]:
        indexes = self.lines.children.indexes
        return gate.check_history_availability_graph(
            root,
            alert_index=self.alerts[1],
            receipts_index=self.receipts[1],
            network_index=self.network[1],
            line_directory=self.lines.index[1],
            line_indexes=cast(list[object], [index.model_copy(deep=True) for index in indexes]
                              if detached_lines else indexes),
            stop_directory=self.stops.index[1],
            hotspots_index=self.hotspots[1],
            repeat_offenders_index=self.repeat_offenders[1],
            stop_summary=self.stops.summary,
            fallback_generated_utc=stamp,
            alert_index_path=self.alerts[0],
            receipt_index_path=self.receipts[0],
            network_index_path=self.network[0],
            line_directory_path=self.lines.index[0],
            stop_directory_path=self.stops.index[0],
            hotspots_index_path=self.hotspots[0],
            repeat_offenders_index_path=self.repeat_offenders[0],
        )

    def record(self, parents: HistoricParentComposer) -> HistoricAvailabilityIndex:
        report = parents.report
        if parents.record_payloads:
            gate.record(report, *self.alerts)
            gate.record(report, *self.receipts)
        else:
            report.results.extend(gate.check_alert_archive_index(
                self.alerts[1], rel_key=self.alerts[0],
            ))
            report.results.extend(gate.check_receipts_index(
                self.receipts[1], rel_key=self.receipts[0],
            ))
            report.payloads_checked += 2
            report.checks_run += 2
        if parents.force is not None:
            gate.enforce(report, force=parents.force)
        root = self.build_root(parents.stamp)
        envelope.stamp_envelope(
            [(HISTORY_ROOT_PATH, root, "historic")],
            provider_id=parents.provider_id, stamp=parents.stamp,
        )
        findings = self.check(root, parents.stamp) if parents.force is not None else []
        if parents.record_payloads:
            gate.record(report, HISTORY_ROOT_PATH, root)
        else:
            report.results.extend(gate.check_history_availability_index(
                root, rel_key=HISTORY_ROOT_PATH,
            ))
            report.payloads_checked += 1
            report.checks_run += 1
        if parents.force is None:
            findings = self.check(root, parents.stamp, detached_lines=True)
        report.results.extend(findings)
        report.checks_run += 1
        if parents.force is not None:
            gate.enforce(report, force=parents.force)
        return root

    def immutable_references(
        self, *, hotspot_refs: Sequence[HistoricPartitionRef],
        repeat_offender_refs: Sequence[HistoricPartitionRef], stop_keys: Set[str],
    ) -> list[str]:
        keys = {
            self.hotspots[0], self.repeat_offenders[0], self.network[0],
            self.lines.index[0], self.stops.index[0], self.alerts[0], self.receipts[0],
            *(ref.path for ref in hotspot_refs),
            *(ref.path for ref in repeat_offender_refs),
            *(ref.path for ref in self.network[1].partitions),
            *self.lines.children.paths.values(),
            *(ref.path for index in self.lines.children.indexes for ref in index.partitions),
            *stop_keys,
            *(ref.path for month in self.alerts[1].months for ref in month.pages),
        }
        if not all("/generations/" in path for path in keys):
            raise RuntimeError("historic GC mark clearing requires only immutable generation keys")
        return sorted(keys)
