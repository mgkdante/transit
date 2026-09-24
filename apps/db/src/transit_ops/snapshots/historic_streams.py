"""Consume historic children and compose their checked parent graph."""

from collections.abc import Callable, Iterable, Iterator, Sequence
from dataclasses import dataclass, field
from typing import Literal, Protocol, TypeVar, cast

from transit_ops.snapshots import builders, envelope, gate, uploads
from transit_ops.snapshots import historic_receipts as receipts
from transit_ops.snapshots.builders.historic.history_common import (
    PointHistorySummary,
    history_pointer_path,
    readdress_history_directory,
)
from transit_ops.snapshots.contract import (
    HistoricCollectionIndex,
    HistoricEntityDirectoryIndex,
    HistoricHotspotsDay,
    HistoricPartitionRef,
    HistoricRepeatOffendersDay,
)
from transit_ops.snapshots.historic_receipts import _HistoricPublishRun
from transit_ops.snapshots.protocols import PayloadSink, PutItem, SnapshotPayload
from transit_ops.snapshots.serialization import snapshot_sha256

type ImmutableBatchWriter = Callable[[Sequence[tuple[str, SnapshotPayload]]], list[str]]

PointDayT = TypeVar("PointDayT", HistoricHotspotsDay, HistoricRepeatOffendersDay, covariant=True)


class PointDayPlan(Protocol[PointDayT]):
    """One-shot retained point days, consumed within their database connection."""

    def iter_days(self) -> Iterator[PointDayT]: ...


def consume_point_days(
    plan: PointDayPlan[HistoricHotspotsDay] | PointDayPlan[HistoricRepeatOffendersDay],
    *, family: str, report: gate.GateReport, storage: PayloadSink | None = None,
    record_payloads: bool = True, force: bool = False, concurrency: int = 1,
    batch_size: int = 32,
) -> tuple[PointHistorySummary, list[str]]:
    """Observe and check point days once; publication drains each bounded batch."""
    summary = PointHistorySummary(family)
    written: list[str] = []
    batch: list[PutItem] = []
    limit = min(batch_size, max(1, concurrency))
    if limit < 1:
        raise ValueError("Historic point batch size must be positive")

    def flush() -> None:
        if storage is not None and batch:
            written.extend(uploads.put_batch(
                storage, batch, concurrency=concurrency, write_mode="immutable",
            ))
            batch.clear()

    for payload in plan.iter_days():
        ref = summary.observe(payload)
        if record_payloads:
            gate.record(report, ref.path, payload)
            report.results.extend(gate.check_point_history_day_ref(ref, payload, family=family))
            report.checks_run += 1
        else:
            report.results.extend([
                *gate.check_payload(ref.path, payload),
                *gate.check_point_history_day_ref(ref, payload, family=family),
            ])
            report.payload_sha256[ref.path] = ref.sha256 or snapshot_sha256(payload)
            report.payloads_checked += 1
            report.checks_run += 2
        if storage is not None:
            gate.enforce(report, force=force)
            batch.append((ref.path, payload, "historic_immutable"))
            if len(batch) == limit:
                flush()
    flush()
    return summary, written


@dataclass(frozen=True)
class HistoricPlans:
    network: builders.NetworkHistoryPlan | None = None
    lines: builders.LineHistoryPlan | None = None
    stops: builders.StopHistoryPlan | None = None


@dataclass
class HistoricChildSummaries:
    network: gate.NetworkHistoryStreamSummary
    lines: builders.LineHistoryStreamSummary
    line_gate: gate.LineHistoryStreamSummary
    stops: builders.StopHistoryStreamSummary
    stop_gate: gate.StopHistoryStreamSummary
    written_keys: list[str] = field(default_factory=list)


class _PartitionCheck(Protocol):
    def __call__(self, payload: object, *, rel_key: str) -> list[gate.CheckResult]: ...


def consume_history_children(
    plans: HistoricPlans,
    report: gate.GateReport,
    *,
    batch_size: int,
    write_batch: ImmutableBatchWriter | None = None,
    record_payloads: bool = True,
    force: bool = False,
    run: _HistoricPublishRun | None = None,
) -> HistoricChildSummaries:
    """Consume lazy plans before their connection closes; retain only detached summaries.

    A supplied writer must drain submitted work before returning or raising.
    Without a writer this collects findings without publication enforcement.
    """
    if batch_size < 1:
        raise ValueError("Historic child batch size must be positive")
    result = HistoricChildSummaries(
        gate.NetworkHistoryStreamSummary(),
        builders.LineHistoryStreamSummary(),
        gate.LineHistoryStreamSummary(),
        builders.StopHistoryStreamSummary(),
        gate.StopHistoryStreamSummary(),
    )

    def consume[PartitionT: SnapshotPayload](
        family: Literal["network", "lines", "stops"],
        iterator: Iterator[tuple[HistoricPartitionRef, PartitionT]],
        check: _PartitionCheck,
        check_ref: Callable[[object, object], list[gate.CheckResult]],
        observers: Sequence[Callable[[HistoricPartitionRef, PartitionT], None]],
    ) -> None:
        batch: list[tuple[str, SnapshotPayload]] = []

        def flush() -> None:
            if write_batch is not None and batch:
                result.written_keys.extend(write_batch(batch))
                batch.clear()

        for ref, payload, scope_class in receipts._iter_historic_partitions(iterator, run, family):
            with receipts._historic_child_gate_phase(run, family, scope_class):
                if record_payloads:
                    gate.record(report, ref.path, payload, retain_sha=family != "stops")
                else:
                    report.results.extend(check(payload, rel_key=ref.path))
                    report.payloads_checked += 1
                    report.checks_run += 2
                report.results.extend(check_ref(ref, payload))
                if write_batch is not None:
                    gate.enforce(report, force=force)
                for observe in observers:
                    observe(ref, payload)
            if write_batch is not None:
                with receipts._historic_phase_context(run, "upload"):
                    batch.append((ref.path, payload))
                    if len(batch) >= batch_size:
                        flush()
        if write_batch is not None:
            with receipts._historic_phase_context(run, "upload"):
                flush()

    if plans.network is not None:
        consume(
            "network",
            iter(plans.network.iter_partition_items()),
            gate.check_network_history_partition,
            gate.check_network_history_partition_ref,
            (result.network.observe,),
        )
    if plans.lines is not None:
        consume(
            "lines",
            iter(plans.lines.iter_partition_items()),
            gate.check_line_history_partition,
            gate.check_line_history_partition_ref,
            (result.line_gate.observe, result.lines.observe),
        )
    if plans.stops is not None:
        consume(
            "stops",
            iter(plans.stops.iter_partition_items()),
            gate.check_stop_history_partition,
            gate.check_stop_history_partition_ref,
            (result.stop_gate.observe, result.stops.observe),
        )
    return result


type HistoryParent[PayloadT: SnapshotPayload] = tuple[str, PayloadT]


@dataclass
class LineParentIndexes:
    indexes: list[HistoricCollectionIndex]
    paths: dict[str, str]
    items: list[HistoryParent[HistoricCollectionIndex]]


@dataclass(frozen=True)
class StopParentIndex:
    path: str
    payload: HistoricCollectionIndex
    entity_id: str
    referenced_keys: tuple[str, ...]


@dataclass
class StopParentIndexes:
    items: Iterator[StopParentIndex]
    pointers: builders.StopHistoryPointerSummary
    summary: gate.StopHistoryDirectorySummary


@dataclass
class HistoricParentComposer:
    """Stamp and check the same parent objects that callers later activate.

    ``force=None`` collects validation findings without enforcing publication.
    Stop input is consumed lazily; the publisher retains its indexes for upload.
    """

    provider_id: str
    stamp: str
    report: gate.GateReport
    record_payloads: bool = True
    force: bool | None = None

    def _stamp[PayloadT: SnapshotPayload](
        self, base: str, payload: PayloadT,
    ) -> HistoryParent[PayloadT]:
        envelope.stamp_envelope(
            [(f"{base}/index.json", payload, "historic")],
            provider_id=self.provider_id, stamp=self.stamp,
        )
        return history_pointer_path(base, payload), payload

    def _check(
        self,
        items: Iterable[HistoryParent[SnapshotPayload]],
        check: _PartitionCheck,
        stream_check: Callable[[], list[gate.CheckResult]],
    ) -> None:
        # Publication checks stream truth before recording payloads; validation
        # records first. Preserve both report order and gate invocation order.
        findings = stream_check() if self.force is not None else []
        for path, payload in items:
            if self.record_payloads:
                gate.record(self.report, path, payload)
            else:
                self.report.results.extend(check(payload, rel_key=path))
                self.report.payloads_checked += 1
                self.report.checks_run += 1
        if self.force is None:
            findings = stream_check()
        self.report.results.extend(findings)
        self.report.checks_run += 1
        self._enforce()

    def _enforce(self) -> None:
        if self.force is not None:
            gate.enforce(self.report, force=self.force)

    def point_index(self, summary: PointHistorySummary) -> HistoryParent[HistoricCollectionIndex]:
        index = summary.build_index(fallback_generated_utc=self.stamp)
        envelope.stamp_envelope(
            [("unused", index, "historic")], provider_id=self.provider_id, stamp=self.stamp,
        )
        path = history_pointer_path(f"historic/history/{summary.family}", index)

        def check() -> list[gate.CheckResult]:
            return gate.check_point_history_index(
                index, rel_key=path, family=summary.family, expected_refs=summary.refs,
                fallback_generated_utc=self.stamp,
            )

        findings = check() if self.force is not None else []
        if self.record_payloads:
            gate.record(self.report, path, index)
        else:
            self.report.results.extend(gate.check_payload(path, index))
            self.report.payload_sha256[path] = snapshot_sha256(index)
            self.report.payloads_checked += 1
            self.report.checks_run += 1
        if self.force is None:
            findings = check()
        self.report.results.extend(findings)
        self.report.checks_run += 1
        self._enforce()
        return path, index

    def network_index(
        self, plan: builders.NetworkHistoryPlan, summary: gate.NetworkHistoryStreamSummary,
    ) -> HistoryParent[HistoricCollectionIndex]:
        item = self._stamp("historic/history/network", plan.build_index(summary.detached_refs()))
        self._check([item], gate.check_network_history_index, lambda: (
            gate.check_network_history_stream_index(
                item[1], summary, fallback_generated_utc=self.stamp,
            )
        ))
        return item

    def line_indexes(
        self, build: builders.LineHistoryStreamSummary, summary: gate.LineHistoryStreamSummary,
    ) -> LineParentIndexes:
        indexes = build.build_indexes(fallback_generated_utc=self.stamp)
        envelope.stamp_envelope(
            [(f"historic/history/lines/{index.entity_id.encode('utf-8').hex()}/index.json",
              index, "historic") for index in indexes if index.entity_id],
            provider_id=self.provider_id, stamp=self.stamp,
        )
        paths = {
            index.entity_id: history_pointer_path(
                f"historic/history/lines/{index.entity_id.encode('utf-8').hex()}", index,
            ) for index in indexes if index.entity_id
        }
        parents = LineParentIndexes(indexes, paths, [
            (paths[index.entity_id], index) for index in indexes if index.entity_id
        ])
        self._check(parents.items, gate.check_line_history_index, lambda: (
            gate.check_line_history_stream_indexes(
                indexes, summary, fallback_generated_utc=self.stamp,
            )
        ))
        return parents

    def stop_indexes(
        self, indexes: Iterable[HistoricCollectionIndex], summary: gate.StopHistoryStreamSummary,
    ) -> StopParentIndexes:
        pointers = builders.StopHistoryPointerSummary()
        directory_summary = gate.StopHistoryDirectorySummary()

        def consume() -> Iterator[StopParentIndex]:
            for index in indexes:
                if not index.entity_id:
                    continue
                item = self._stamp(
                    f"historic/history/stops/{index.entity_id.encode('utf-8').hex()}", index,
                )
                parent = StopParentIndex(
                    item[0], index, index.entity_id,
                    tuple(ref.path for ref in index.partitions) if self.force is not None else (),
                )

                def check_index(index: HistoricCollectionIndex = index) -> list[gate.CheckResult]:
                    return gate.check_stop_history_stream_index(
                        index, summary, fallback_generated_utc=self.stamp,
                    )

                self._check([item], gate.check_stop_history_index, check_index)
                pointers.observe(index, index_path=item[0])
                directory_summary.observe(index, index_path=item[0])
                yield parent
            self.report.results.extend(gate.check_stop_history_stream_entities(
                directory_summary, summary,
            ))
            self.report.checks_run += 1
            self._enforce()

        return StopParentIndexes(consume(), pointers, directory_summary)

    def line_directory(
        self, parents: LineParentIndexes, build: builders.LineHistoryStreamSummary,
    ) -> HistoryParent[HistoricEntityDirectoryIndex]:
        indexes = parents.indexes
        summary = gate.LineHistoryDirectorySummary.from_indexes(
            cast(list[object], [index.model_copy(deep=True) for index in indexes]
                 if self.force is None else indexes),
            index_paths=parents.paths,
        )
        directory = readdress_history_directory(build.build_directory(
            [index.model_copy(deep=True) for index in indexes]
            if self.force is None else indexes,
            fallback_generated_utc=self.stamp,
        ), parents.paths)
        item = self._stamp("historic/history/lines", directory)
        self._check([item], gate.check_line_history_directory, lambda: (
            gate.check_line_history_stream_directory(
                directory, summary, fallback_generated_utc=self.stamp,
            )
        ))
        return item

    def stop_directory(
        self, parents: StopParentIndexes,
    ) -> HistoryParent[HistoricEntityDirectoryIndex]:
        directory = parents.pointers.build_directory(fallback_generated_utc=self.stamp)
        item = self._stamp("historic/history/stops", directory)
        self._check([item], gate.check_stop_history_directory, lambda: (
            gate.check_stop_history_stream_directory(
                directory, parents.summary, fallback_generated_utc=self.stamp,
            )
        ))
        return item
