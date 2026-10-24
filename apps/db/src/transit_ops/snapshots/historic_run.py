from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable, Iterator, Mapping
from contextlib import AbstractContextManager, contextmanager, nullcontext
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from time import perf_counter_ns
from types import TracebackType
from typing import TYPE_CHECKING, Any, cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel

from transit_ops.snapshots.builders.historic.history_common import (
    HistoricPartitionError,
    HistorySourceScopes,
    classify_historic_scope,
    encode_history_entity_id,
    history_coverage,
    history_utc_timestamp,
)

if TYPE_CHECKING:
    from sqlalchemy.engine import Connection

    from transit_ops.settings import Settings

logger = logging.getLogger(__name__)
_MONTH = re.compile(r"^[0-9]{4}-(?:0[1-9]|1[0-2])$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_HISTORIC_EXCLUSIVE_PHASES = (
    "source_digest",
    "build",
    "gate",
    "upload",
    "compatibility",
    "parent_compose",
    "hash_state_flush",
    "state_upsert",
    "transaction_commit",
    "other",
)
_HISTORIC_FAMILIES = ("network", "lines", "stops")
_HISTORIC_SCOPE_CLASSES = ("retention_edge", "mutable_edge", "settled_candidate")
_HISTORIC_SCOPE_METRICS = ("partition_materialize", "child_gate")


class _HistoricPhaseLedger:
    """Exclusive nanosecond ledger for one historic publish transaction."""

    def __init__(self, *, clock: Callable[[], int] = perf_counter_ns) -> None:
        self._clock = clock
        self._last_ns = clock()
        self._active_phase: str | None = "other"
        self._active_detail: tuple[str, str, str] | None = None
        self._finished = False
        self.phase_ns = {phase: 0 for phase in _HISTORIC_EXCLUSIVE_PHASES}
        self.scope_detail_ns = {
            family: {
                scope_class: {metric: 0 for metric in _HISTORIC_SCOPE_METRICS}
                for scope_class in _HISTORIC_SCOPE_CLASSES
            }
            for family in _HISTORIC_FAMILIES
        }
        self.scope_counts = {
            family: {scope_class: 0 for scope_class in _HISTORIC_SCOPE_CLASSES}
            for family in _HISTORIC_FAMILIES
        }

    def _switch(
        self,
        phase: str | None,
        detail: tuple[str, str, str] | None = None,
    ) -> tuple[str | None, tuple[str, str, str] | None]:
        if self._finished:
            raise RuntimeError("historic phase ledger is already finished")
        if phase is not None and phase not in self.phase_ns:
            raise ValueError(f"unknown historic publish phase {phase!r}")
        now = self._clock()
        elapsed = now - self._last_ns
        if elapsed < 0:
            raise RuntimeError("historic phase clock moved backwards")
        if self._active_phase is not None:
            self.phase_ns[self._active_phase] += elapsed
        if self._active_detail is not None:
            family, scope_class, metric = self._active_detail
            self.scope_detail_ns[family][scope_class][metric] += elapsed
        previous = (self._active_phase, self._active_detail)
        self._active_phase = phase
        self._active_detail = detail
        self._last_ns = now
        return previous

    @contextmanager
    def phase(
        self,
        phase: str,
        *,
        family: str | None = None,
        scope_class: str | None = None,
        scope_metric: str | None = None,
    ) -> Iterator[None]:

        detail: tuple[str, str, str] | None = None
        detail_values = (family, scope_class, scope_metric)
        if any(value is not None for value in detail_values):
            if not all(value is not None for value in detail_values):
                raise ValueError("historic scope detail requires family, class, and metric")
            if family not in _HISTORIC_FAMILIES:
                raise ValueError(f"unknown historic family {family!r}")
            if scope_class not in _HISTORIC_SCOPE_CLASSES:
                raise ValueError(f"unknown historic scope class {scope_class!r}")
            if scope_metric not in _HISTORIC_SCOPE_METRICS:
                raise ValueError(f"unknown historic scope metric {scope_metric!r}")
            detail = cast(tuple[str, str, str], detail_values)
        previous_phase, previous_detail = self._switch(phase, detail)
        try:
            yield
        finally:
            self._switch(previous_phase, previous_detail)

    def observe_scope(self, family: str, scope_class: str) -> None:
        if family not in _HISTORIC_FAMILIES:
            raise ValueError(f"unknown historic family {family!r}")
        if scope_class not in _HISTORIC_SCOPE_CLASSES:
            raise ValueError(f"unknown historic scope class {scope_class!r}")
        self.scope_counts[family][scope_class] += 1

    def activate(self, phase: str) -> None:
        self._switch(phase)

    def add_scope_detail_ns(
        self,
        family: str,
        scope_class: str,
        metric: str,
        elapsed_ns: int,
    ) -> None:
        if family not in _HISTORIC_FAMILIES:
            raise ValueError(f"unknown historic family {family!r}")
        if scope_class not in _HISTORIC_SCOPE_CLASSES:
            raise ValueError(f"unknown historic scope class {scope_class!r}")
        if metric not in _HISTORIC_SCOPE_METRICS:
            raise ValueError(f"unknown historic scope metric {metric!r}")
        if elapsed_ns < 0:
            raise ValueError("historic scope detail duration must be nonnegative")
        self.scope_detail_ns[family][scope_class][metric] += elapsed_ns

    def finish(self) -> int:
        if not self._finished:
            self._switch(None)
            self._finished = True
        return sum(self.phase_ns.values())

    def checkpoint(self) -> int:
        if self._finished:
            return sum(self.phase_ns.values())
        self._switch(self._active_phase, self._active_detail)
        return sum(self.phase_ns.values())

    def _render(self, total_ns: int, **extra: object) -> dict[str, object]:
        phase_ms = {
            f"{phase}_ms": duration / 1_000_000 for phase, duration in self.phase_ns.items()
        }
        family_scope_detail = {
            family: {
                scope_class: {
                    "scopes_rebuilt": self.scope_counts[family][scope_class],
                    **{
                        f"{metric}_ms": duration / 1_000_000 for metric, duration in metrics.items()
                    },
                }
                for scope_class, metrics in classes.items()
            }
            for family, classes in self.scope_detail_ns.items()
        }
        return {
            "schema_version": 1,
            "phase_ns": dict(self.phase_ns),
            **phase_ms,
            "publish_total_ns": total_ns,
            "publish_total_ms": total_ns / 1_000_000,
            "family_scope_detail": family_scope_detail,
            **extra,
        }

    def snapshot(self, **extra: object) -> dict[str, object]:
        return self._render(self.checkpoint(), **extra)

    def telemetry(self, **extra: object) -> dict[str, object]:
        return self._render(self.finish(), **extra)


class _TimedHistoricTransaction:
    """Charge transaction exit, including commit or rollback, to one phase."""

    def __init__(
        self,
        transaction: AbstractContextManager[Connection],
        ledger: _HistoricPhaseLedger,
    ) -> None:
        self._transaction = transaction
        self._ledger = ledger

    def __enter__(self) -> Connection:
        return self._transaction.__enter__()

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool | None:
        with self._ledger.phase("transaction_commit"):
            return self._transaction.__exit__(exc_type, exc_value, traceback)


@dataclass(frozen=True)
class _HistoricPartitionObservation:
    entity_key: str
    month: str
    coverage_start: date
    coverage_end: date


@dataclass
class _HistoricPublishRun:
    """Same-pass history guards and phase telemetry for one full publish."""

    ledger: _HistoricPhaseLedger
    settings: Settings
    stamp: str
    full_historic_rebuild: bool
    partition_upload_batch_size: int
    today_local: date | None = None
    provider_id: str = "stm"
    run_instant_utc: datetime = field(default_factory=lambda: datetime.now(UTC))
    plans: dict[str, object] = field(default_factory=dict)
    observations: dict[str, list[_HistoricPartitionObservation]] = field(
        default_factory=lambda: {family: [] for family in _HISTORIC_FAMILIES}
    )
    source_only_scope_count: dict[str, int] = field(default_factory=dict)

    @property
    def historic_scopes_rebuilt(self) -> int:
        return sum(len(values) for values in self.observations.values())

    def telemetry_fields(self, *, timing_complete: bool) -> dict[str, object]:
        return {
            "timing_complete": timing_complete,
            "full_historic_rebuild": self.full_historic_rebuild,
            "historic_files_reused": 0,
            "historic_scopes_reused": 0,
            "historic_scopes_rebuilt": self.historic_scopes_rebuilt,
            "source_only_scope_count": dict(self.source_only_scope_count),
            "partition_upload_batch_size": self.partition_upload_batch_size,
        }


def _provider_today_local(
    stamp: str,
    provider_timezone: str | None,
    run_instant_utc: datetime,
) -> date:
    utc_today = date.fromisoformat(stamp[:10])
    if not isinstance(provider_timezone, str):
        return utc_today
    try:
        timezone = ZoneInfo(provider_timezone)
        return run_instant_utc.astimezone(timezone).date()
    except (ValueError, ZoneInfoNotFoundError):
        return utc_today


def _prepare_historic_run(
    run: _HistoricPublishRun | None,
    plans: tuple[object, object, object],
    *,
    provider_timezone: str | None = None,
    provider_id: str = "stm",
) -> None:
    if run is None:
        return
    run.plans = dict(zip(_HISTORIC_FAMILIES, plans, strict=True))
    run.provider_id = provider_id
    run.today_local = _provider_today_local(run.stamp, provider_timezone, run.run_instant_utc)


def _activate_historic_phase(
    run: _HistoricPublishRun | None,
    phase: str,
) -> None:
    if run is not None:
        run.ledger.activate(phase)


def _historic_phase_context(
    run: _HistoricPublishRun | None,
    phase: str,
) -> AbstractContextManager[None]:
    if run is None:
        return nullcontext()
    return run.ledger.phase(phase)


def _historic_child_gate_phase(
    run: _HistoricPublishRun | None,
    family: str,
    scope_class: str | None,
) -> AbstractContextManager[None]:
    if run is None:
        return nullcontext()
    if scope_class is None:
        raise RuntimeError("historic child gate phase requires a scope class")
    return run.ledger.phase(
        "gate",
        family=family,
        scope_class=scope_class,
        scope_metric="child_gate",
    )


def _historic_transaction_context(
    transaction: AbstractContextManager[Connection],
    ledger: _HistoricPhaseLedger | None,
) -> AbstractContextManager[Connection]:
    if ledger is None:
        return transaction
    return _TimedHistoricTransaction(transaction, ledger)


def _new_historic_publish_run(
    ledger: _HistoricPhaseLedger | None,
    settings: Settings,
    stamp: str,
    full_historic_rebuild: bool,
    partition_upload_batch_size: int,
) -> _HistoricPublishRun | None:
    if ledger is None:
        return None
    return _HistoricPublishRun(
        ledger=ledger,
        settings=settings,
        stamp=stamp,
        full_historic_rebuild=full_historic_rebuild,
        partition_upload_batch_size=partition_upload_batch_size,
    )


def _build_historic_history_plans[NetworkPlanT, LinePlanT, StopPlanT](
    run: _HistoricPublishRun | None,
    conn: Connection,
    provider_id: str,
    stamp: str,
    build_network: Callable[..., NetworkPlanT],
    build_lines: Callable[..., LinePlanT],
    build_stops: Callable[..., StopPlanT],
) -> tuple[NetworkPlanT, LinePlanT, StopPlanT]:
    phase_context = run.ledger.phase if run is not None else None
    with _historic_phase_context(run, "build"):
        return (
            build_network(
                conn,
                provider_id=provider_id,
                generated_utc=stamp,
                phase_context=phase_context,
            ),
            build_lines(
                conn,
                provider_id=provider_id,
                generated_utc=stamp,
                phase_context=phase_context,
            ),
            build_stops(
                conn,
                provider_id=provider_id,
                generated_utc=stamp,
                phase_context=phase_context,
            ),
        )


def _next_historic_partition[HistoricRefT, HistoricPartitionT](
    iterator: Iterator[tuple[HistoricRefT, HistoricPartitionT]],
    run: _HistoricPublishRun | None,
) -> tuple[HistoricRefT, HistoricPartitionT, int]:

    if run is None:
        ref, partition = next(iterator)
        return ref, partition, 0
    before_build = run.ledger.phase_ns["build"]
    before_source_digest = run.ledger.phase_ns["source_digest"]
    with run.ledger.phase("build"):
        ref, partition = next(iterator)
    build_ns = run.ledger.phase_ns["build"] - before_build
    if run.ledger.phase_ns["source_digest"] > before_source_digest:
        build_ns = 0
    return ref, partition, build_ns


def _iter_historic_partitions[HistoricRefT, HistoricPartitionT](
    iterator: Iterator[tuple[HistoricRefT, HistoricPartitionT]],
    run: _HistoricPublishRun | None,
    family: str,
) -> Iterator[tuple[HistoricRefT, HistoricPartitionT, str | None]]:
    while True:
        try:
            ref, partition, build_ns = _next_historic_partition(iterator, run)
        except StopIteration:
            return
        yield (
            ref,
            partition,
            _observe_historic_partition(
                run,
                family,
                ref,
                partition,
                build_ns,
            ),
        )


def _partition_mapping(value: object) -> dict[str, Any]:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, Mapping):
        return dict(value)
    raise HistoricPartitionError("historic partition and ref must be objects")


def _validate_historic_partition(
    family: str,
    ref: object,
    partition: object,
) -> tuple[str, str, date, date]:
    value = _partition_mapping(partition)
    reference = _partition_mapping(ref)
    days = value.get("days")
    if not isinstance(days, list) or not days:
        raise HistoricPartitionError("historic partition requires days")
    dates = []
    for raw_day in days:
        day = _partition_mapping(raw_day)
        local_date = day.get("date")
        try:
            if (
                not isinstance(local_date, str)
                or date.fromisoformat(local_date).isoformat() != local_date
            ):
                raise ValueError("noncanonical date")
        except ValueError as exc:
            raise HistoricPartitionError(
                "historic partition day date must be canonical ISO"
            ) from exc
        dates.append(local_date)
    try:
        canonical_generated_utc = history_utc_timestamp(
            value.get("generated_utc"),
            field="generated_utc",
        )
    except ValueError as exc:
        raise HistoricPartitionError("historic partition generated_utc is invalid") from exc
    if value.get("generated_utc") != canonical_generated_utc:
        raise HistoricPartitionError("historic partition generated_utc must be canonical UTC")
    month = value.get("month")
    if not isinstance(month, str) or not _MONTH.fullmatch(month):
        raise HistoricPartitionError("historic partition month is invalid")
    if any(local_date[:7] != month for local_date in dates):
        raise HistoricPartitionError("historic partition dates escape its month")
    entity_key = "" if family == "network" else value.get("entity_id")
    if not isinstance(entity_key, str) or (family != "network" and not entity_key):
        raise HistoricPartitionError("historic partition entity identity is invalid")
    first, last, _gaps = history_coverage(dates)
    count = reference.get("count")
    size = reference.get("byte_size")
    digest = reference.get("sha256")
    if (
        not isinstance(count, int)
        or isinstance(count, bool)
        or count <= 0
        or not isinstance(size, int)
        or isinstance(size, bool)
        or size <= 0
        or not isinstance(digest, str)
        or not _SHA256.fullmatch(digest)
    ):
        raise HistoricPartitionError("historic partition ref count, size or digest is invalid")
    if (
        count != len(dates)
        or reference.get("coverage_start") != first
        or reference.get("coverage_end") != last
    ):
        raise HistoricPartitionError("historic partition ref does not match partition days")
    prefix = (
        "historic/history/network/generations/"
        if family == "network"
        else f"historic/history/{family}/{encode_history_entity_id(entity_key)}/generations/"
    )
    path = reference.get("path")
    if not isinstance(path, str) or not path.startswith(prefix):
        raise HistoricPartitionError("historic artifact entity path mismatch")
    assert first is not None and last is not None
    return entity_key, month, date.fromisoformat(first), date.fromisoformat(last)


def _observe_historic_partition(
    run: _HistoricPublishRun | None,
    family: str,
    ref: object,
    partition: object,
    build_ns: int,
) -> str | None:
    if run is None:
        return None
    with run.ledger.phase("other"):
        entity_key, month, scope_start, scope_end = _validate_historic_partition(
            family, ref, partition
        )
        scope_class = classify_historic_scope(
            family=family,
            scope_start=scope_start,
            scope_end=scope_end,
            today_local=run.today_local or date.fromisoformat(run.stamp[:10]),
            open_window_days=int(getattr(run.settings, "GOLD_REPORTING_OPEN_WINDOW_DAYS", 10)),
            fact_retention_days=int(getattr(run.settings, "GOLD_FACT_RETENTION_DAYS", 14)),
            retention_days=int(getattr(run.settings, "GOLD_WARM_ROLLUP_RETENTION_DAYS", 730)),
        )
        run.ledger.observe_scope(family, scope_class)
        run.ledger.add_scope_detail_ns(family, scope_class, "partition_materialize", build_ns)
        run.observations[family].append(
            _HistoricPartitionObservation(entity_key, month, scope_start, scope_end)
        )
    return scope_class


def _finalize_historic_run(run: _HistoricPublishRun | None) -> None:
    if run is None:
        return
    with run.ledger.phase("other"):
        for family in _HISTORIC_FAMILIES:
            source = getattr(run.plans[family], "source_scopes", None)
            if not isinstance(source, HistorySourceScopes):
                raise HistoricPartitionError(f"{family} plan has no source inventory")
            if source.provider_id != run.provider_id or source.family != family:
                raise HistoricPartitionError(f"{family} source provider/family identity mismatch")
            emitted = [(value.entity_key, value.month) for value in run.observations[family]]
            scopes = set(source.scopes)
            if len(scopes) != len(source.scopes):
                raise HistoricPartitionError(
                    f"{family} source contains duplicate entity-month scopes"
                )
            if len(set(emitted)) != len(emitted):
                raise HistoricPartitionError(f"{family} emitted duplicate entity-month partitions")
            if not set(emitted) <= scopes:
                raise HistoricPartitionError(
                    f"{family} emitted scopes lack same-pass source scopes"
                )
            for observation in run.observations[family]:
                bounds = source.bounds.get((observation.entity_key, observation.month))
                if bounds is None or not (
                    bounds[0] <= observation.coverage_start <= observation.coverage_end <= bounds[1]
                ):
                    raise HistoricPartitionError(
                        f"{family} source dependency coverage must contain artifact coverage"
                    )
            inventory = set(source.entity_ids)
            emitted_entities = {entity for entity, _month in emitted}
            source_entities = {entity for entity, _month in scopes}
            if (
                len(inventory) != len(source.entity_ids)
                or not emitted_entities <= inventory
                or not source_entities <= inventory
                or (family == "network" and source.entity_ids != ("",))
                or (family != "network" and len(inventory) > len(scopes))
            ):
                raise HistoricPartitionError(f"{family} source inventory cardinality mismatch")
            run.source_only_scope_count[family] = len(scopes - set(emitted))


def _snapshot_historic_telemetry(
    run: _HistoricPublishRun,
) -> dict[str, object]:
    return run.ledger.snapshot(**run.telemetry_fields(timing_complete=False))


def _finish_historic_telemetry(
    run: _HistoricPublishRun | None,
) -> dict[str, object] | None:
    if run is None:
        return None
    telemetry = run.ledger.telemetry(**run.telemetry_fields(timing_complete=True))
    logger.info(
        "historic publish telemetry: %s",
        json.dumps(telemetry, sort_keys=True, separators=(",", ":")),
    )
    return telemetry


def _historic_publish_state_fields(
    *,
    tier: str,
    historic_telemetry: Mapping[str, object] | None,
) -> dict[str, object]:
    state: dict[str, object] = {
        "historic_files_reused": None,
        "historic_scopes_reused": None,
        "historic_scopes_rebuilt": None,
        "historic_source_digest_ms": None,
        "historic_build_ms": None,
        "historic_gate_ms": None,
        "historic_upload_ms": None,
        "historic_parent_compose_ms": None,
        "historic_compatibility_ms": None,
        "historic_receipt_persist_ms": None,
        "historic_receipt_rows_attempted": None,
        "historic_receipt_rows_changed": None,
        "historic_phase_detail": None,
    }
    if historic_telemetry is None:
        return state
    if tier != "historic":
        raise ValueError("historic telemetry can only be recorded for the historic tier")
    state.update(
        {
            "historic_files_reused": int(cast(Any, historic_telemetry["historic_files_reused"])),
            "historic_scopes_reused": int(cast(Any, historic_telemetry["historic_scopes_reused"])),
            "historic_scopes_rebuilt": int(
                cast(Any, historic_telemetry["historic_scopes_rebuilt"])
            ),
            "historic_source_digest_ms": historic_telemetry["source_digest_ms"],
            "historic_build_ms": historic_telemetry["build_ms"],
            "historic_gate_ms": historic_telemetry["gate_ms"],
            "historic_upload_ms": historic_telemetry["upload_ms"],
            "historic_parent_compose_ms": historic_telemetry["parent_compose_ms"],
            "historic_compatibility_ms": historic_telemetry["compatibility_ms"],
            "historic_phase_detail": dict(historic_telemetry),
        }
    )
    return state


_HISTORIC_STATE_COLUMNS_SQL = (
    "historic_files_reused, historic_scopes_reused, historic_scopes_rebuilt, "
    "historic_source_digest_ms, historic_build_ms, historic_gate_ms, "
    "historic_upload_ms, historic_parent_compose_ms, historic_compatibility_ms, "
    "historic_receipt_persist_ms, historic_receipt_rows_attempted, "
    "historic_receipt_rows_changed, historic_phase_detail, "
)
_HISTORIC_STATE_VALUES_SQL = (
    ":historic_files_reused, :historic_scopes_reused, :historic_scopes_rebuilt, "
    ":historic_source_digest_ms, :historic_build_ms, :historic_gate_ms, "
    ":historic_upload_ms, :historic_parent_compose_ms, :historic_compatibility_ms, "
    ":historic_receipt_persist_ms, :historic_receipt_rows_attempted, "
    ":historic_receipt_rows_changed, CAST(:historic_phase_detail AS jsonb), "
)
_HISTORIC_STATE_UPDATES_SQL = (
    "historic_files_reused = EXCLUDED.historic_files_reused, "
    "historic_scopes_reused = EXCLUDED.historic_scopes_reused, "
    "historic_scopes_rebuilt = EXCLUDED.historic_scopes_rebuilt, "
    "historic_source_digest_ms = EXCLUDED.historic_source_digest_ms, "
    "historic_build_ms = EXCLUDED.historic_build_ms, "
    "historic_gate_ms = EXCLUDED.historic_gate_ms, "
    "historic_upload_ms = EXCLUDED.historic_upload_ms, "
    "historic_parent_compose_ms = EXCLUDED.historic_parent_compose_ms, "
    "historic_compatibility_ms = EXCLUDED.historic_compatibility_ms, "
    "historic_receipt_persist_ms = EXCLUDED.historic_receipt_persist_ms, "
    "historic_receipt_rows_attempted = EXCLUDED.historic_receipt_rows_attempted, "
    "historic_receipt_rows_changed = EXCLUDED.historic_receipt_rows_changed, "
    "historic_phase_detail = EXCLUDED.historic_phase_detail, "
)
