"""Value-level publish gate — inspects built /v1 payloads BEFORE any upload.

The contract models (:mod:`transit_ops.snapshots.contract`) only enforce Pydantic
TYPE coercion at construction; nothing inspects the VALUES a builder produced. This
module is a pure-Python, no-DB inspector that walks the in-memory payloads (Pydantic
models or plain dicts) for out-of-range rates, negative counts, sentinel/NaN/Inf
leaks, broken invariants (on_time<=observations, sum(non_responding_by_route)==
non_responding, rank 1..N, ...), and coverage regressions. ERROR-severity findings
abort a static/historic publish (unless --force); WARN findings are logged only.

Honest-NULL law: None is a legitimate value on an empty denominator (contract.py
NetworkFile + every *_pct/observation_count on the historic models), so EVERY check
skips None leaves — a None is never flagged as a violation and never coerced to 0.

No maintenance/gold.py registry entry is needed: this module creates NO tables and
reads NO new tables. Prior-generation coverage baseline reuses the already-persisted
core.snapshot_publish_state.files_total (migration 0042), passed in by the caller.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
from dataclasses import dataclass, field
from datetime import date
from enum import Enum

from pydantic import BaseModel, ValidationError

from transit_ops.snapshots.builders.historic.history_common import (
    HistoryDateMask,
    decode_history_entity_id,
    encode_history_entity_id,
    history_coverage,
    history_date,
    history_entity_directory_generation_id,
    history_index_generation_id,
    history_metric_coverage,
    history_utc_timestamp,
    latest_history_timestamp,
)
from transit_ops.snapshots.contract import (
    HistoricAvailabilityIndex,
    HistoricCollectionIndex,
    HistoricEntityDirectoryIndex,
    HistoricEntityIndexRef,
    HistoricPartitionRef,
    LineHistoryPartition,
    NetworkHistoryPartition,
    StopHistoryPartition,
)
from transit_ops.snapshots.serialization import snapshot_json_bytes, snapshot_sha256

logger = logging.getLogger(__name__)

# --- tunable constants (config-free — trust-gate thresholds) ------------------
# Catches ONLY the historical Numeric(8,4) overflow sentinel 9999.9999 (a float leaf
# within GATE_SENTINEL_EPS of it). It is NOT a magnitude band: legitimate large leaves
# exist (observation_count ~1.7M, alert duration_min ~108k, a ~9999-minute ≈7-day alert
# duration), so any |v|>=9999 band would false-flag real data. NaN/Inf stay universal.
GATE_SENTINEL_VALUE = 9999.9999  # the Numeric(8,4) overflow sentinel (exact float family)
GATE_SENTINEL_EPS = 1e-6  # float tolerance around GATE_SENTINEL_VALUE
GATE_DELAY_MIN_ABS = 90.0  # signed-delay minutes cap (fact cap 3600s=60min + margin)
GATE_MIX_SUM_TOL = 0.01  # occupancy-mix share sum tolerance around 1.0
GATE_ROUTE_DROP_FRACTION = 0.30  # total-file-count drop that fires the coverage-delta ERROR
GATE_EMPTY_ROUTE_WARN_FRACTION = 0.50  # >half empty route files -> coverage-regression WARN
# GC2 DECISIONS #12 — trip-id drift detector. When RT-observed trip-days exceed the
# scheduled universe on > this fraction of scheduled route-days, silent_trip_days was
# systematically clamped to 0 (see the read-time completeness clamp in
# route_reliability / network_trend): the scheduled and RT trip_id namespaces are
# drifting apart, so silent counts UNDER-report. WARN (not ERROR) — over-delivery is
# legitimate per-day; only the systemic share is a data-quality signal.
GATE_ID_DRIFT_WARN_FRACTION = 0.05

# Occupancy bands shared with OccupancyMix / route_occupancy_band_daily.
_MIX_BANDS = ("empty", "many_seats", "few_seats", "standing", "full")
_CROWDING_BANDS = frozenset(_MIX_BANDS)
_SENTINEL_ENTITY_IDS = frozenset({"__unrouted__", "__unknown_stop__"})
_DELAY_LO, _DELAY_HI = -GATE_DELAY_MIN_ABS, GATE_DELAY_MIN_ABS


class Severity(str, Enum):
    ERROR = "error"  # aborts publish (unless --force)
    WARN = "warn"  # logged + in report, never aborts


@dataclass(frozen=True)
class CheckResult:
    check: str  # stable id, e.g. "rate_range"
    kind: str  # payload kind, e.g. "historic_route_reliability"
    rel_key: str  # "historic/route_reliability/51.json" (or "<batch>" pre-key)
    severity: Severity
    message: str  # human-readable, includes offending field + value
    field_path: str | None = None  # e.g. "periods[2].otp_pct"
    value: object | None = None

    def to_dict(self) -> dict:  # type: ignore[type-arg]
        return {
            "check": self.check,
            "kind": self.kind,
            "rel_key": self.rel_key,
            "severity": self.severity.value,
            "message": self.message,
            "field_path": self.field_path,
            "value": self.value,
        }


@dataclass
class GateReport:
    provider_id: str
    tier: str
    generated_utc: str
    checks_run: int = 0
    payloads_checked: int = 0
    results: list[CheckResult] = field(default_factory=list)
    payload_sha256: dict[str, str] = field(default_factory=dict)

    @property
    def errors(self) -> list[CheckResult]:
        return [r for r in self.results if r.severity is Severity.ERROR]

    @property
    def warnings(self) -> list[CheckResult]:
        return [r for r in self.results if r.severity is Severity.WARN]

    @property
    def passed(self) -> bool:
        return not self.errors

    def to_dict(self) -> dict:  # type: ignore[type-arg]
        return {
            "provider_id": self.provider_id,
            "tier": self.tier,
            "generated_utc": self.generated_utc,
            "checks_run": self.checks_run,
            "payloads_checked": self.payloads_checked,
            "errors": len(self.errors),
            "warnings": len(self.warnings),
            "results": [r.to_dict() for r in self.results],
            "payload_sha256": dict(sorted(self.payload_sha256.items())),
        }


class GateError(RuntimeError):
    """Raised by enforce() when errors exist and force is False."""

    def __init__(self, report: GateReport) -> None:
        self.report = report
        super().__init__(
            f"publish gate FAILED: {len(report.errors)} error(s) "
            f"across {report.payloads_checked} payload(s) "
            f"[{report.provider_id}/{report.tier}]"
        )


# --- coercion + shared range helpers -----------------------------------------


def _as_dict(payload: object) -> object:
    """Normalize a Pydantic model to a native dict (enums/None preserved); pass dicts through."""
    if isinstance(payload, BaseModel):
        return payload.model_dump(mode="python")
    return payload


def _payload_bytes(payload: object) -> int | None:
    """The exact publisher byte size, or ``None`` for unsupported test stubs."""
    try:
        if isinstance(payload, BaseModel | dict):
            return len(snapshot_json_bytes(payload))
    except (TypeError, ValueError):
        return None
    return None


def _is_number(v: object) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool)


def _in_range(v: object, lo: float, hi: float) -> bool:
    """True when v is a number inside [lo, hi]. None-safe (None -> True: skip)."""
    if v is None or not _is_number(v):
        return True
    return lo <= v <= hi


def _nonneg(v: object) -> bool:
    """True when v is a non-negative number. None-safe (None -> True: skip)."""
    if v is None or not _is_number(v):
        return True
    return v >= 0


def _le(a: object, b: object) -> bool:
    """True when a <= b (both numbers). None-safe: if either is None -> True (skip)."""
    if a is None or b is None or not _is_number(a) or not _is_number(b):
        return True
    return a <= b


def _is_neg(v: object) -> bool:
    """True only when v is a NUMBER strictly below zero (None-safe: None -> False)."""
    return _is_number(v) and v < 0


def _mix_ok(mix: object) -> tuple[bool, bool]:
    """Return (all buckets in [0,1], sum within tolerance of 1.0). None mix -> (True, True)."""
    if mix is None or not isinstance(mix, dict):
        return (True, True)
    total = 0.0
    buckets_ok = True
    any_value = False
    for band in _MIX_BANDS:
        v = mix.get(band)
        if v is None or not _is_number(v):
            continue
        any_value = True
        total += v
        if not (0.0 <= v <= 1.0):
            buckets_ok = False
    sum_ok = (not any_value) or abs(total - 1.0) <= GATE_MIX_SUM_TOL
    return (buckets_ok, sum_ok)


# --- emitter: binds (kind, rel_key) so per-check call sites stay compact ------


class _Emitter:
    """Collects CheckResults for one payload, closing over its kind + rel_key.

    Every checker takes an emitter and calls the small typed helpers below; the
    range/count helpers None-skip so honest-NULL never produces a finding.
    """

    def __init__(self, kind: str, rel_key: str) -> None:
        self.kind = kind
        self.rel_key = rel_key
        self.out: list[CheckResult] = []

    def err(self, check: str, fp: str, value: object, msg: str) -> None:
        self.out.append(
            CheckResult(
                check=check,
                kind=self.kind,
                rel_key=self.rel_key,
                severity=Severity.ERROR,
                message=msg,
                field_path=fp,
                value=value,
            )
        )

    def warn(self, check: str, fp: str, value: object, msg: str) -> None:
        self.out.append(
            CheckResult(
                check=check,
                kind=self.kind,
                rel_key=self.rel_key,
                severity=Severity.WARN,
                message=msg,
                field_path=fp,
                value=value,
            )
        )

    # typed guards -----------------------------------------------------------
    def rate(self, d: dict, fp: str, lo: float = 0, hi: float = 100) -> None:
        v = d.get(fp)
        if not _in_range(v, lo, hi):
            self.err("rate_range", fp, v, f"{fp}={v} out of [{lo},{hi}]")

    def delay(self, d: dict, fp: str) -> None:
        v = d.get(fp)
        if not _in_range(v, _DELAY_LO, _DELAY_HI):
            self.err("delay_range", fp, v, f"{fp}={v} beyond +-{GATE_DELAY_MIN_ABS} min")

    def count(self, d: dict, fp: str) -> None:
        v = d.get(fp)
        if not _nonneg(v):
            self.err("count_negative", fp, v, f"{fp}={v} < 0")

    def wilson(self, d: dict) -> None:
        lo, hi = d.get("wilson_lo"), d.get("wilson_hi")
        if not _in_range(lo, 0, 100):
            self.err("rate_range", "wilson_lo", lo, f"wilson_lo={lo} out of [0,100]")
        if not _in_range(hi, 0, 100):
            self.err("rate_range", "wilson_hi", hi, f"wilson_hi={hi} out of [0,100]")
        if not _le(lo, hi):
            self.warn("wilson_order", "wilson_lo", lo, f"wilson_lo>wilson_hi ({lo}>{hi})")

    def mix(self, mix: object, fp: str) -> None:
        buckets_ok, sum_ok = _mix_ok(mix)
        if not buckets_ok:
            self.err("mix_bucket", fp, mix, f"{fp} has an occupancy bucket outside [0,1]")
        if not sum_ok:
            self.warn("mix_sum", fp, mix, f"{fp} occupancy-mix shares do not sum to ~1.0")

    def nonempty(self, d: dict, fp: str) -> None:
        v = d.get(fp)
        if not (isinstance(v, str) and v.strip()):
            self.err("empty_grain", fp, v, f"{fp} is empty")


def _prefixed(emit: _Emitter, prefix: str) -> _Emitter:
    """A view of *emit* whose helpers prepend *prefix* to every field path."""
    return _PrefixEmitter(emit, prefix)


class _PrefixEmitter(_Emitter):
    """Delegates to a parent emitter, prefixing field paths (e.g. 'periods[2].')."""

    def __init__(self, parent: _Emitter, prefix: str) -> None:
        self._parent = parent
        self._prefix = prefix
        self.kind = parent.kind
        self.rel_key = parent.rel_key

    @property  # keep .out pointing at the parent's list
    def out(self) -> list[CheckResult]:  # type: ignore[override]
        return self._parent.out

    def err(self, check: str, fp: str, value: object, msg: str) -> None:
        self._parent.err(check, f"{self._prefix}{fp}", value, f"{self._prefix}{msg}")

    def warn(self, check: str, fp: str, value: object, msg: str) -> None:
        self._parent.warn(check, f"{self._prefix}{fp}", value, f"{self._prefix}{msg}")


# --- universal sentinel / NaN scan (runs on EVERY payload) -------------------


def _walk_numbers(node: object, path: str):  # noqa: ANN201
    """Yield (field_path, value) for every numeric leaf in a nested dict/list/model dump."""
    if isinstance(node, dict):
        for key, val in node.items():
            child = f"{path}.{key}" if path else str(key)
            yield from _walk_numbers(val, child)
    elif isinstance(node, list | tuple):
        for i, val in enumerate(node):
            yield from _walk_numbers(val, f"{path}[{i}]")
    elif _is_number(node):
        yield (path, node)


def _universal_scan(rel_key: str, kind: str, as_dict: object) -> list[CheckResult]:
    """Flag the exact 9999.9999 Numeric(8,4) overflow sentinel + NaN/Inf. None skipped.

    Only float leaves within GATE_SENTINEL_EPS of GATE_SENTINEL_VALUE are flagged — a
    magnitude band would false-flag legitimate large integers (observation counts,
    alert durations). NaN/Inf is a universal ERROR on any float leaf.
    """
    emit = _Emitter(kind, rel_key)
    for fpath, v in _walk_numbers(as_dict, ""):
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            emit.err("nan_inf", fpath, None, f"{fpath} is NaN/Inf ({v!r})")
        elif isinstance(v, float) and abs(v - GATE_SENTINEL_VALUE) < GATE_SENTINEL_EPS:
            emit.err("sentinel", fpath, v, f"{fpath}={v} is the 9999.9999 Numeric(8,4) sentinel")
    return emit.out


# --- per-kind checkers -------------------------------------------------------
# Rates are PERCENT 0..100 unless noted; counts are integers >= 0; None always skipped.


def _check_habits(emit: _Emitter, habits: object, prefix: str) -> None:
    if not isinstance(habits, dict):
        return
    for r, row in enumerate(habits.get("matrix") or []):
        if not isinstance(row, list):
            continue
        for c, cell in enumerate(row):
            if cell is None:
                continue
            if _is_number(cell) and not (0.0 <= cell <= 1.0):
                fp = f"{prefix}.matrix[{r}][{c}]"
                emit.err("habits_range", fp, cell, f"{fp}={cell} out of [0,1]")


def check_network(payload: object, *, rel_key: str) -> list[CheckResult]:
    emit = _Emitter("live_network", rel_key)
    d = _as_dict(payload)
    if not isinstance(d, dict):
        return emit.out
    emit.rate(d, "on_time_pct")
    emit.rate(d, "coverage_pct")
    emit.count(d, "vehicles_in_service")
    emit.count(d, "non_responding")
    sd = d.get("status_dist")
    if isinstance(sd, dict):
        sd_emit = _prefixed(emit, "status_dist.")
        for k in ("on_time", "late", "severe", "early", "unknown"):
            sd_emit.count(sd, k)
    emit.mix(d.get("occupancy_mix"), "occupancy_mix")
    hist = d.get("delay_histogram")
    if isinstance(hist, list):
        total = 0
        for i, b in enumerate(hist):
            if not isinstance(b, dict):
                continue
            _prefixed(emit, f"delay_histogram[{i}].").count(b, "count")
            if _is_number(b.get("count")):
                total += b["count"]
            lo, hi = b.get("lo_min"), b.get("hi_min")
            if not _le(lo, hi):
                emit.err(
                    "edge_order",
                    f"delay_histogram[{i}].lo_min",
                    lo,
                    f"delay_histogram[{i}] lo_min>hi_min ({lo}>{hi})",
                )
        if total < 1:
            emit.warn(
                "empty_histogram",
                "delay_histogram",
                total,
                "delay_histogram present but all-zero counts",
            )
    nrr = d.get("non_responding_by_route")
    if isinstance(nrr, list):
        total = 0
        for i, r in enumerate(nrr):
            if not isinstance(r, dict):
                continue
            _prefixed(emit, f"non_responding_by_route[{i}].").count(r, "count")
            if _is_number(r.get("count")):
                total += r["count"]
        nr = d.get("non_responding")
        if _is_number(nr) and total != nr:
            emit.err(
                "sum_mismatch",
                "non_responding_by_route",
                total,
                f"sum(non_responding_by_route.count)={total} != non_responding={nr}",
            )
    emit.delay(d, "delay_p50_min")
    emit.delay(d, "delay_p90_min")
    if not _le(d.get("delay_p50_min"), d.get("delay_p90_min")):
        emit.warn(
            "percentile_order",
            "delay_p50_min",
            d.get("delay_p50_min"),
            "delay_p50_min > delay_p90_min",
        )
    return emit.out


def _check_trend_point(emit: _Emitter, p: dict) -> None:
    emit.rate(p, "otp_pct")
    emit.delay(p, "avg_delay_min")
    emit.delay(p, "p90_min")
    emit.count(p, "vehicles")
    emit.rate(p, "cancellation_rate")
    emit.rate(p, "service_completeness_rate")  # GC2 H1 (None-skip on pre-0073 history)
    emit.count(p, "observation_count")
    emit.wilson(p)
    emit.mix(p.get("occupancy_mix"), "occupancy_mix")


def check_network_trend(payload: object, *, rel_key: str) -> list[CheckResult]:
    # The empty-series decision is prior-aware (WARN on a first publish, ERROR once a
    # prior publish existed for this provider/tier) so it is routed through
    # finalize_batch, NOT emitted here where prior state is unknown.
    emit = _Emitter("historic_network_trend", rel_key)
    d = _as_dict(payload)
    if not isinstance(d, dict):
        return emit.out
    for grain in ("series", "weekly", "monthly"):
        for i, p in enumerate(d.get(grain) or []):
            if isinstance(p, dict):
                _check_trend_point(_prefixed(emit, f"{grain}[{i}]."), p)
    for grain in ("by_shift", "by_daytype"):
        for i, s in enumerate(d.get(grain) or []):
            if not isinstance(s, dict):
                continue
            sub = _prefixed(emit, f"{grain}[{i}].")
            sub.nonempty(s, "grain")
            sub.rate(s, "otp_pct")
            sub.delay(s, "avg_delay_min")
            sub.rate(s, "severe_pct")
            sub.count(s, "observation_count")
            sub.wilson(s)
    return emit.out


def _check_reliability_period(emit: _Emitter, p: dict) -> None:
    emit.rate(p, "otp_pct")
    emit.delay(p, "avg_delay_min")
    emit.delay(p, "p50_min")
    emit.delay(p, "p90_min")
    emit.rate(p, "severe_pct")
    emit.count(p, "observation_count")
    emit.count(p, "on_time")
    if not _le(p.get("on_time"), p.get("observation_count")):
        emit.err("invariant", "on_time", p.get("on_time"), "on_time > observation_count")
    emit.wilson(p)
    hist = p.get("delay_histogram")
    if isinstance(hist, list):
        for j, b in enumerate(hist):
            if not isinstance(b, dict):
                continue
            _prefixed(emit, f"delay_histogram[{j}].").count(b, "count")
            if not _le(b.get("lo_sec"), b.get("hi_sec")):
                emit.err(
                    "edge_order",
                    f"delay_histogram[{j}].lo_sec",
                    b.get("lo_sec"),
                    f"delay_histogram[{j}] lo_sec>hi_sec",
                )
    emit.rate(p, "prior_otp_pct")
    emit.count(p, "prior_on_time")
    if not _le(p.get("prior_on_time"), p.get("prior_observation_count")):
        emit.err(
            "invariant",
            "prior_on_time",
            p.get("prior_on_time"),
            "prior_on_time > prior_observation_count",
        )


def _check_headway(emit: _Emitter, h: dict) -> None:
    emit.count(h, "scheduled_min")
    emit.count(h, "observed_min")
    emit.count(h, "cov")
    emit.count(h, "observation_count")
    if _is_neg(h.get("excess_wait_min")):
        emit.err(
            "clamp_invariant",
            "excess_wait_min",
            h.get("excess_wait_min"),
            "excess_wait_min < 0 (clamp violated)",
        )
    emit.rate(h, "bunched_pct")


def _check_weak_stop(emit: _Emitter, w: dict) -> None:
    emit.delay(w, "avg_delay_min")
    emit.count(w, "observation_count")
    emit.rate(w, "severe_pct")
    emit.wilson(w)


def _check_crowding_cell(emit: _Emitter, c: dict) -> None:
    band = c.get("band")
    if band is not None and band not in _CROWDING_BANDS:
        emit.err("unknown_band", "band", band, f"band={band!r} not a known occupancy band")
    emit.delay(c, "avg_delay_min")
    emit.delay(c, "p50_min")
    emit.count(c, "observation_count")
    emit.count(c, "day_count")


def _check_crosstab_cell(emit: _Emitter, c: dict) -> None:
    emit.nonempty(c, "shift")
    emit.nonempty(c, "day_type")
    emit.rate(c, "otp_pct")
    emit.rate(c, "severe_pct")
    emit.delay(c, "avg_delay_min")
    emit.count(c, "observation_count")


def check_route_reliability(payload: object, *, rel_key: str) -> list[CheckResult]:
    emit = _Emitter("historic_route_reliability", rel_key)
    d = _as_dict(payload)
    if not isinstance(d, dict):
        return emit.out
    if not (d.get("id") or "").strip():
        emit.err("empty_id", "id", d.get("id"), "route reliability id is empty")
    for i, p in enumerate(d.get("periods") or []):
        if isinstance(p, dict):
            _check_reliability_period(_prefixed(emit, f"periods[{i}]."), p)
    for i, h in enumerate(d.get("headway") or []):
        if isinstance(h, dict):
            _check_headway(_prefixed(emit, f"headway[{i}]."), h)
    for i, hg in enumerate(d.get("headway_by_grain") or []):
        if not isinstance(hg, dict):
            continue
        for j, h in enumerate(hg.get("headway") or []):
            if isinstance(h, dict):
                _check_headway(_prefixed(emit, f"headway_by_grain[{i}].headway[{j}]."), h)
    _check_habits(emit, d.get("habits"), "habits")
    for i, hg in enumerate(d.get("habits_by_grain") or []):
        if isinstance(hg, dict):
            _check_habits(emit, hg.get("habits"), f"habits_by_grain[{i}].habits")
    for i, c in enumerate(d.get("cancellations") or []):
        if not isinstance(c, dict):
            continue
        sub = _prefixed(emit, f"cancellations[{i}].")
        sub.rate(c, "cancellation_rate_pct")
        sub.count(c, "canceled_trip_days")
        sub.count(c, "total_trip_days")
        if not _le(c.get("canceled_trip_days"), c.get("total_trip_days")):
            sub.err(
                "invariant",
                "canceled_trip_days",
                c.get("canceled_trip_days"),
                "canceled_trip_days > total_trip_days",
            )
        # Scheduled-universe split (GC2 H1). All None-skip (honest-unknown on pre-0073
        # history). Invariants: delivered<=total (RT-observed subset), silent<=scheduled
        # (silent is a subset of the scheduled universe), delivered+canceled==total.
        sub.count(c, "scheduled_trip_days")
        sub.count(c, "delivered_trip_days")
        sub.count(c, "silent_trip_days")
        sub.rate(c, "service_completeness_pct")
        if not _le(c.get("delivered_trip_days"), c.get("total_trip_days")):
            sub.err(
                "invariant",
                "delivered_trip_days",
                c.get("delivered_trip_days"),
                "delivered_trip_days > total_trip_days",
            )
        if not _le(c.get("silent_trip_days"), c.get("scheduled_trip_days")):
            sub.err(
                "invariant",
                "silent_trip_days",
                c.get("silent_trip_days"),
                "silent_trip_days > scheduled_trip_days",
            )
        _delivered = c.get("delivered_trip_days")
        _canceled = c.get("canceled_trip_days")
        _total = c.get("total_trip_days")
        if (
            _is_number(_delivered)
            and _is_number(_canceled)
            and _is_number(_total)
            and _delivered + _canceled != _total
        ):
            sub.err(
                "invariant",
                "delivered_trip_days",
                _delivered,
                "delivered_trip_days + canceled_trip_days != total_trip_days",
            )
    for i, s in enumerate(d.get("skipped_stops") or []):
        if not isinstance(s, dict):
            continue
        sub = _prefixed(emit, f"skipped_stops[{i}].")
        sub.rate(s, "skipped_stop_rate_pct")
        sub.count(s, "skipped_stop_count")
        sub.count(s, "stop_time_update_count")
        if not _le(s.get("skipped_stop_count"), s.get("stop_time_update_count")):
            sub.err(
                "invariant",
                "skipped_stop_count",
                s.get("skipped_stop_count"),
                "skipped_stop_count > stop_time_update_count",
            )
    for i, w in enumerate(d.get("weak_stops") or []):
        if isinstance(w, dict):
            _check_weak_stop(_prefixed(emit, f"weak_stops[{i}]."), w)
    for i, wg in enumerate(d.get("weak_stops_by_grain") or []):
        if not isinstance(wg, dict):
            continue
        for j, w in enumerate(wg.get("stops") or []):
            if isinstance(w, dict):
                _check_weak_stop(_prefixed(emit, f"weak_stops_by_grain[{i}].stops[{j}]."), w)
    for i, c in enumerate(d.get("delay_by_crowding") or []):
        if isinstance(c, dict):
            _check_crowding_cell(_prefixed(emit, f"delay_by_crowding[{i}]."), c)
    for i, c in enumerate(d.get("by_shift_daytype") or []):
        if isinstance(c, dict):
            _check_crosstab_cell(_prefixed(emit, f"by_shift_daytype[{i}]."), c)
    for i, pg in enumerate(d.get("periods_by_grain") or []):
        if not isinstance(pg, dict):
            continue
        for j, c in enumerate(pg.get("by_shift_daytype") or []):
            if isinstance(c, dict):
                _check_crosstab_cell(
                    _prefixed(emit, f"periods_by_grain[{i}].by_shift_daytype[{j}]."), c
                )
    for i, o in enumerate(d.get("occupancy_by_grain") or []):
        if isinstance(o, dict):
            emit.mix(o.get("mix"), f"occupancy_by_grain[{i}].mix")
    for i, o in enumerate(d.get("occupancy_by_dow") or []):
        if not isinstance(o, dict):
            continue
        emit.mix(o.get("mix"), f"occupancy_by_dow[{i}].mix")
        _prefixed(emit, f"occupancy_by_dow[{i}].").count(o, "n")
    for i, o in enumerate(d.get("occupancy_by_hour") or []):  # GC2 H3
        if not isinstance(o, dict):
            continue
        emit.mix(o.get("mix"), f"occupancy_by_hour[{i}].mix")
        _prefixed(emit, f"occupancy_by_hour[{i}].").count(o, "n")
    emit.mix(d.get("occupancy_mix"), "occupancy_mix")
    return emit.out


def check_stop_reliability(payload: object, *, rel_key: str) -> list[CheckResult]:
    emit = _Emitter("historic_stop_reliability", rel_key)
    d = _as_dict(payload)
    if not isinstance(d, dict):
        return emit.out
    if not (d.get("id") or "").strip():
        emit.err("empty_id", "id", d.get("id"), "stop reliability id is empty")
    for i, p in enumerate(d.get("periods") or []):
        if not isinstance(p, dict):
            continue
        sub = _prefixed(emit, f"periods[{i}].")
        sub.rate(p, "otp_pct")
        sub.delay(p, "avg_delay_min")
        sub.delay(p, "p50_min")
        sub.delay(p, "p90_min")
        sub.rate(p, "severe_pct")
        sub.count(p, "observation_count")
        sub.wilson(p)
    _check_habits(emit, d.get("habits"), "habits")
    for i, dw in enumerate(d.get("day_of_week") or []):
        if not isinstance(dw, dict):
            continue
        sub = _prefixed(emit, f"day_of_week[{i}].")
        sub.delay(dw, "avg_delay_min")
        sub.rate(dw, "severe_pct")
        sub.count(dw, "observation_count")
    for i, br in enumerate(d.get("by_route") or []):
        if isinstance(br, dict):
            _prefixed(emit, f"by_route[{i}].").delay(br, "avg_delay_min")
    emit.mix(d.get("occupancy_mix"), "occupancy_mix")
    # S8 per-day series (SERVE-THE-COUNTS): counts non-negative, severe<=obs (the
    # served ingredients must be poolable into an honest rate), severe_pct in
    # [0,100], avg_delay_min bounded. None-safe so honest-NULL never trips a finding.
    for i, dp in enumerate(d.get("daily") or []):
        if not isinstance(dp, dict):
            continue
        sub = _prefixed(emit, f"daily[{i}].")
        sub.count(dp, "observation_count")
        sub.count(dp, "severe_count")
        obs, severe = dp.get("observation_count"), dp.get("severe_count")
        if not _le(severe, obs):
            sub.err(
                "severe_gt_obs",
                "severe_count",
                severe,
                f"severe_count={severe} > observation_count={obs}",
            )
        sub.rate(dp, "severe_pct")
        sub.delay(dp, "avg_delay_min")
    return emit.out


def _check_hotspot_entry(emit: _Emitter, h: dict) -> None:
    """The shared per-entry checks for a by_grain HotspotEntry (S12). Deliberately does
    NOT assert rank sequence: a by_grain ladder is ranked independently THEN truncated,
    so its ranks need not be a globally-sequential run (only the scalar hotspots[] does)."""
    if h.get("type") not in ("route", "stop"):
        emit.err(
            "unknown_type", "type", h.get("type"), f"type={h.get('type')!r} not in {{route,stop}}"
        )
    if h.get("id") in _SENTINEL_ENTITY_IDS:
        emit.err("sentinel_entity", "id", h.get("id"), f"id={h.get('id')!r} is a sentinel entity")
    emit.rate(h, "otp_delta_pts", -100, 100)
    emit.rate(h, "severe_pct")
    emit.delay(h, "avg_delay_min")
    emit.count(h, "observation_count")
    emit.count(h, "severe_count")
    emit.count(h, "issue_count")
    emit.wilson(h)


def check_hotspots(payload: object, *, rel_key: str) -> list[CheckResult]:
    emit = _Emitter("historic_hotspots", rel_key)
    d = _as_dict(payload)
    if not isinstance(d, dict):
        return emit.out
    for i, h in enumerate(d.get("hotspots") or []):
        if not isinstance(h, dict):
            continue
        sub = _prefixed(emit, f"hotspots[{i}].")
        expected = i + 1
        if h.get("rank") != expected:
            sub.err(
                "rank_sequence",
                "rank",
                h.get("rank"),
                f"rank={h.get('rank')} not sequential (expected {expected})",
            )
        if h.get("type") not in ("route", "stop"):
            sub.err(
                "unknown_type",
                "type",
                h.get("type"),
                f"type={h.get('type')!r} not in {{route,stop}}",
            )
        if h.get("id") in _SENTINEL_ENTITY_IDS:
            sub.err(
                "sentinel_entity", "id", h.get("id"), f"id={h.get('id')!r} is a sentinel entity"
            )
        sub.rate(h, "otp_delta_pts", -100, 100)
    # S12 by_grain ladders: walk entries + tray, reusing the sub.rate/delay/wilson checks;
    # NO rank_sequence inside a ladder (ranked-then-truncated), so the scalar list above
    # keeps its sequential-rank invariant and the ladders do not inherit it.
    for i, hg in enumerate(d.get("by_grain") or []):
        if not isinstance(hg, dict):
            continue
        for j, h in enumerate(hg.get("entries") or []):
            if isinstance(h, dict):
                _check_hotspot_entry(_prefixed(emit, f"by_grain[{i}].entries[{j}]."), h)
        for j, h in enumerate(hg.get("tray") or []):
            if isinstance(h, dict):
                _check_hotspot_entry(_prefixed(emit, f"by_grain[{i}].tray[{j}]."), h)
    return emit.out


def _check_offender_entry(emit: _Emitter, o: dict) -> None:
    """The shared per-entry checks for a by_grain RepeatOffenderEntry (S14), mirroring
    _check_hotspot_entry. Deliberately does NOT assert rank sequence: a by_grain ladder is
    ranked PER KIND independently THEN truncated, so ranks restart per kind (no globally-
    sequential run). type is the offender discriminator trip|vehicle (NOT route|stop). No
    rank field is asserted here (the ladders carry per-kind rank, not a global sequence)."""
    if o.get("type") not in ("trip", "vehicle"):
        emit.err(
            "unknown_type", "type", o.get("type"), f"type={o.get('type')!r} not in {{trip,vehicle}}"
        )
    if o.get("id") in _SENTINEL_ENTITY_IDS:
        emit.err("sentinel_entity", "id", o.get("id"), f"id={o.get('id')!r} is a sentinel entity")
    if o.get("route") in _SENTINEL_ENTITY_IDS:
        emit.err(
            "sentinel_entity",
            "route",
            o.get("route"),
            f"route={o.get('route')!r} is a sentinel entity",
        )
    emit.rate(o, "severe_pct")
    emit.delay(o, "avg_delay_min")
    emit.count(o, "observation_count")
    emit.count(o, "severe_count")
    emit.count(o, "recurrence_days")
    emit.count(o, "observed_days")
    emit.wilson(o)


def check_repeat_offenders(payload: object, *, rel_key: str) -> list[CheckResult]:
    emit = _Emitter("historic_repeat_offenders", rel_key)
    d = _as_dict(payload)
    if not isinstance(d, dict):
        return emit.out
    for i, o in enumerate(d.get("offenders") or []):
        if not isinstance(o, dict):
            continue
        sub = _prefixed(emit, f"offenders[{i}].")
        if o.get("type") not in ("trip", "vehicle", "route", "stop"):
            sub.err(
                "unknown_type",
                "type",
                o.get("type"),
                f"type={o.get('type')!r} not a known offender type",
            )
        sub.delay(o, "avg_delay_min")
        # S14 additive scalar twins: recurrence_days is a non-negative distinct-day count.
        sub.count(o, "recurrence_days")
        if o.get("id") in _SENTINEL_ENTITY_IDS:
            sub.err("sentinel_entity", "id", o.get("id"), "id is a sentinel entity")
        if o.get("route") in _SENTINEL_ENTITY_IDS:
            sub.err("sentinel_entity", "route", o.get("route"), "route is a sentinel entity")
    # S14 by_grain recurrence ladders: walk entries + tray, reusing the sub.rate/delay/count/
    # wilson checks; NO rank_sequence inside a ladder (ranked-then-truncated PER KIND), so the
    # scalar offenders[] list above keeps its own invariants and the ladders do not inherit one.
    for i, og in enumerate(d.get("by_grain") or []):
        if not isinstance(og, dict):
            continue
        for j, o in enumerate(og.get("entries") or []):
            if isinstance(o, dict):
                _check_offender_entry(_prefixed(emit, f"by_grain[{i}].entries[{j}]."), o)
        for j, o in enumerate(og.get("tray") or []):
            if isinstance(o, dict):
                _check_offender_entry(_prefixed(emit, f"by_grain[{i}].tray[{j}]."), o)
    return emit.out


def _iso_le(a: object, b: object) -> bool:
    """True when ISO-8601 strings a <= b (lexicographic on normalized UTC). None
    on either side skips (honest-NULL: an open-ended window is not an ordering
    violation). Unparseable strings skip rather than false-flag."""
    if not isinstance(a, str) or not isinstance(b, str):
        return True
    try:
        from datetime import datetime

        da = datetime.fromisoformat(a.replace("Z", "+00:00"))
        db = datetime.fromisoformat(b.replace("Z", "+00:00"))
    except ValueError:
        return True
    return da <= db


def check_alert_history(payload: object, *, rel_key: str) -> list[CheckResult]:
    emit = _Emitter("historic_alert_history", rel_key)
    d = _as_dict(payload)
    if not isinstance(d, dict):
        return emit.out
    # S15 window disclosure: window_start <= window_end (both ISO dates when
    # present); total_in_window >= the emitted count when truncated (the cap
    # cannot hide fewer alerts than it shows).
    win_start, win_end = d.get("window_start"), d.get("window_end")
    if not _iso_le(win_start, win_end):
        emit.err(
            "window_order",
            "window_start",
            win_start,
            f"window_start={win_start!r} > window_end={win_end!r}",
        )
    alerts = d.get("alerts") or []
    total = d.get("total_in_window")
    if d.get("truncated") is True and isinstance(total, int) and total < len(alerts):
        emit.err(
            "window_total",
            "total_in_window",
            total,
            f"total_in_window={total} < emitted alerts ({len(alerts)}) while truncated",
        )
    # S15 byte ceiling: a runaway window must not bloat the file.
    from transit_ops.snapshots.contract import ALERT_HISTORY_BYTE_CEILING

    size = _payload_bytes(payload)
    if size is not None and size > ALERT_HISTORY_BYTE_CEILING:
        emit.err(
            "byte_ceiling",
            "",
            size,
            f"alert_history payload {size}B exceeds ceiling {ALERT_HISTORY_BYTE_CEILING}B",
        )
    for i, a in enumerate(alerts):
        if not isinstance(a, dict):
            continue
        _check_alert_entry(emit, a, prefix=f"alerts[{i}].")
    breakdown = d.get("breakdown")
    if isinstance(breakdown, dict):
        for group in ("by_cause", "by_effect", "by_severity"):
            for i, b in enumerate(breakdown.get(group) or []):
                if not isinstance(b, dict):
                    continue
                sub = _prefixed(emit, f"breakdown.{group}[{i}].")
                sub.count(b, "count")
                if _is_neg(b.get("median_duration_min")):
                    sub.err(
                        "count_negative",
                        "median_duration_min",
                        b.get("median_duration_min"),
                        "median_duration_min < 0",
                    )
    return emit.out


def _check_alert_entry(emit: _Emitter, alert: dict, *, prefix: str) -> None:  # type: ignore[type-arg]
    """Shared alert invariants for legacy history and retained archive pages."""
    sub = _prefixed(emit, prefix)
    if _is_neg(alert.get("duration_min")):
        sub.err(
            "count_negative",
            "duration_min",
            alert.get("duration_min"),
            "duration_min < 0",
        )
    sub.count(alert, "impact_passages")
    url = alert.get("url")
    if url is not None and not isinstance(url, str):
        sub.err("not_string", "url", url, f"url={url!r} is not a string")
    for j, period in enumerate(alert.get("active_periods") or []):
        if not isinstance(period, dict):
            continue
        start, end = period.get("start_utc"), period.get("end_utc")
        if not _iso_le(start, end):
            _prefixed(emit, f"{prefix}active_periods[{j}].").err(
                "window_order",
                "start_utc",
                start,
                f"start_utc={start!r} > end_utc={end!r}",
            )


_ARCHIVE_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
_ARCHIVE_PAGE_PATH_RE = re.compile(
    r"^historic/alerts/generations/([0-9a-f]{64})/(\d{4}-\d{2})/page-(\d{4})\.json$"
)


def _serialized_body(payload: object) -> bytes | None:
    try:
        if isinstance(payload, BaseModel | dict):
            return snapshot_json_bytes(payload)
    except (TypeError, ValueError):
        return None
    return None


def _archive_entry_key(entry: dict) -> tuple[str, str, str]:  # type: ignore[type-arg]
    return (
        str(entry.get("start_utc") or entry.get("first_seen_utc") or ""),
        str(entry.get("last_seen_utc") or ""),
        str(entry.get("id") or ""),
    )


def _archive_page_coverage(
    payload: object,
    *,
    provider_timezone: str,
) -> tuple[str, str] | None:
    from datetime import datetime
    from zoneinfo import ZoneInfo

    def local_date(value: str) -> str:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=ZoneInfo("UTC"))
        return parsed.astimezone(ZoneInfo(provider_timezone)).date().isoformat()

    page = _as_dict(payload)
    if not isinstance(page, dict):
        return None
    bounds: list[str] = []
    for entry in page.get("alerts") or []:
        if not isinstance(entry, dict):
            continue
        for key in ("first_seen_utc", "last_seen_utc"):
            if isinstance(entry.get(key), str):
                bounds.append(entry[key])
        for period in entry.get("active_periods") or []:
            if not isinstance(period, dict):
                continue
            for key in ("start_utc", "end_utc"):
                if isinstance(period.get(key), str):
                    bounds.append(period[key])
    if not bounds:
        return None
    dates = [local_date(value) for value in bounds]
    return min(dates), max(dates)


def check_alert_archive_page(payload: object, *, rel_key: str) -> list[CheckResult]:
    from transit_ops.snapshots.contract import (
        ALERT_ARCHIVE_PAGE_BYTE_CEILING,
        ALERT_ARCHIVE_PAGE_ENTRY_CAP,
    )

    emit = _Emitter("historic_alert_archive_page", rel_key)
    page = _as_dict(payload)
    if not isinstance(page, dict):
        return emit.out
    alerts = page.get("alerts")
    if not isinstance(alerts, list) or not alerts:
        emit.err("page_count", "alerts", 0, "archive page must contain at least one alert")
        alerts = []
    elif len(alerts) > ALERT_ARCHIVE_PAGE_ENTRY_CAP:
        emit.err(
            "page_count",
            "alerts",
            len(alerts),
            f"archive page has {len(alerts)} alerts; cap is {ALERT_ARCHIVE_PAGE_ENTRY_CAP}",
        )
    body = _serialized_body(payload)
    if body is not None and len(body) > ALERT_ARCHIVE_PAGE_BYTE_CEILING:
        emit.err(
            "byte_ceiling",
            "",
            len(body),
            f"archive page {len(body)}B exceeds ceiling {ALERT_ARCHIVE_PAGE_BYTE_CEILING}B",
        )
    month = page.get("month")
    page_number = page.get("page")
    match = _ARCHIVE_PAGE_PATH_RE.fullmatch(rel_key)
    if not isinstance(month, str) or not _ARCHIVE_MONTH_RE.fullmatch(month):
        emit.err("page_month", "month", month, f"malformed archive month {month!r}")
    if not isinstance(page_number, int) or page_number < 1:
        emit.err("page_number", "page", page_number, f"invalid page number {page_number!r}")
    if match is None:
        emit.err("page_path", "", rel_key, f"malformed archive generation path {rel_key!r}")
    else:
        digest, path_month, path_page = match.groups()
        if path_month != month or int(path_page) != page_number:
            emit.err("page_path", "", rel_key, "archive path month/page does not match payload")
        if body is not None and hashlib.sha256(body).hexdigest() != digest:
            emit.err("page_sha256", "", digest, "archive path SHA does not match page bytes")
    keys = [_archive_entry_key(alert) for alert in alerts if isinstance(alert, dict)]
    # Timestamps newest-first. Stable ids are the deterministic tie breaker.
    expected = sorted(keys, key=lambda key: key[2])
    expected.sort(key=lambda key: key[:2], reverse=True)
    if keys != expected:
        emit.err("entry_order", "alerts", None, "archive alerts are not newest-first")
    for index, alert in enumerate(alerts):
        if isinstance(alert, dict):
            _check_alert_entry(emit, alert, prefix=f"alerts[{index}].")
    return emit.out


def check_alert_archive_index(payload: object, *, rel_key: str) -> list[CheckResult]:
    emit = _Emitter("historic_alert_archive_index", rel_key)
    index = _as_dict(payload)
    if not isinstance(index, dict):
        return emit.out
    months = index.get("months") or []
    month_names = [month.get("month") for month in months if isinstance(month, dict)]
    if all(isinstance(name, str) for name in month_names) and month_names != sorted(
        set(month_names), reverse=True
    ):
        emit.err("month_order", "months", month_names, "archive months must be unique newest-first")
    counted_total = 0
    for month_index, month in enumerate(months):
        if not isinstance(month, dict):
            continue
        name = month.get("month")
        if not isinstance(name, str) or not _ARCHIVE_MONTH_RE.fullmatch(name):
            emit.err("month_format", f"months[{month_index}].month", name, "malformed month")
        pages = month.get("pages") or []
        page_numbers = [page.get("page") for page in pages if isinstance(page, dict)]
        if page_numbers != list(range(1, len(page_numbers) + 1)):
            emit.err(
                "page_order",
                f"months[{month_index}].pages",
                page_numbers,
                "pages are not sequential",
            )
        ref_total = sum(
            page.get("count", 0)
            for page in pages
            if isinstance(page, dict) and isinstance(page.get("count"), int)
        )
        if month.get("total_alerts") != ref_total:
            emit.err(
                "month_total",
                f"months[{month_index}].total_alerts",
                month.get("total_alerts"),
                f"month total does not match page refs ({ref_total})",
            )
        counted_total += ref_total
        for page_index, ref in enumerate(pages):
            if not isinstance(ref, dict):
                continue
            if not _iso_le(ref.get("coverage_start"), ref.get("coverage_end")):
                emit.err(
                    "coverage_order",
                    f"months[{month_index}].pages[{page_index}].coverage_start",
                    ref.get("coverage_start"),
                    "page coverage is inverted",
                )
    if index.get("total_alerts") != counted_total:
        emit.err(
            "archive_total",
            "total_alerts",
            index.get("total_alerts"),
            f"archive total does not match refs ({counted_total})",
        )
    if counted_total == 0 and (
        index.get("first_available_date") is not None
        or index.get("last_available_date") is not None
    ):
        emit.err(
            "empty_coverage",
            "first_available_date",
            None,
            "empty archive has fabricated coverage",
        )
    if not _iso_le(index.get("first_available_date"), index.get("last_available_date")):
        emit.err(
            "coverage_order",
            "first_available_date",
            index.get("first_available_date"),
            "archive coverage is inverted",
        )
    generation_basis = {
        "first_available_date": index.get("first_available_date"),
        "last_available_date": index.get("last_available_date"),
        "months": months,
    }
    expected_generation = snapshot_sha256(generation_basis)
    if index.get("collection_generation_id") != expected_generation:
        emit.err(
            "collection_generation_id",
            "collection_generation_id",
            index.get("collection_generation_id"),
            "collection generation id does not match canonical ordered refs",
        )
    _check_versioned_pointer_digest(
        emit,
        payload,
        re.fullmatch(r"historic/alerts/generations/([0-9a-f]{64})/index\.json", rel_key),
    )
    return emit.out


def check_alert_archive_bundle(
    index: object,
    page_items: list[tuple[str, object]],
    *,
    provider_timezone: str = "UTC",
) -> list[CheckResult]:
    """Cross-check the stable index against the exact page bytes that will upload."""
    findings = check_alert_archive_index(index, rel_key="historic/alerts/index.json")
    built: dict[str, object] = {}
    duplicate_built: set[str] = set()
    for path, page in page_items:
        if path in built:
            duplicate_built.add(path)
        built[path] = page
    for path in duplicate_built:
        emit = _Emitter("historic_alert_archive_bundle", path)
        emit.err("duplicate_built_path", "path", path, "archive page path was built twice")
        findings.extend(emit.out)
    referenced: set[str] = set()
    index_dict = _as_dict(index)
    if not isinstance(index_dict, dict):
        return findings
    for month in index_dict.get("months") or []:
        if not isinstance(month, dict):
            continue
        for ref in month.get("pages") or []:
            if not isinstance(ref, dict) or not isinstance(ref.get("path"), str):
                continue
            path = ref["path"]
            if path in referenced:
                emit = _Emitter("historic_alert_archive_bundle", path)
                emit.err(
                    "duplicate_ref_path",
                    "path",
                    path,
                    "archive page path is referenced twice",
                )
                findings.extend(emit.out)
            referenced.add(path)
            page = built.get(path)
            emit = _Emitter("historic_alert_archive_bundle", path)
            if page is None:
                emit.err("missing_page", "path", path, "referenced archive page was not built")
                findings.extend(emit.out)
                continue
            findings.extend(check_alert_archive_page(page, rel_key=path))
            body = _serialized_body(page)
            page_dict = _as_dict(page)
            alerts = page_dict.get("alerts") if isinstance(page_dict, dict) else []
            if isinstance(page_dict, dict) and (
                page_dict.get("month") != month.get("month")
                or page_dict.get("page") != ref.get("page")
            ):
                emit.err(
                    "ref_page_metadata",
                    "path",
                    path,
                    "parent month/ref page does not match page payload",
                )
            if ref.get("count") != len(alerts or []):
                emit.err("ref_count", "count", ref.get("count"), "ref count does not match page")
            if body is not None and ref.get("byte_size") != len(body):
                emit.err(
                    "ref_byte_size",
                    "byte_size",
                    ref.get("byte_size"),
                    "ref byte size does not match page",
                )
            digest = hashlib.sha256(body).hexdigest() if body is not None else None
            if digest is not None and ref.get("sha256") != digest:
                emit.err("ref_sha256", "sha256", ref.get("sha256"), "ref SHA does not match page")
            coverage = _archive_page_coverage(
                page,
                provider_timezone=provider_timezone,
            )
            if (
                coverage is not None
                and (ref.get("coverage_start"), ref.get("coverage_end")) != coverage
            ):
                emit.err("ref_coverage", "coverage_start", None, "ref coverage does not match page")
            findings.extend(emit.out)
    for path in built.keys() - referenced:
        emit = _Emitter("historic_alert_archive_bundle", path)
        emit.err("unreferenced_page", "path", path, "built archive page is not referenced")
        findings.extend(emit.out)
    return findings


_NETWORK_HISTORY_PARTITION_PATH_RE = re.compile(
    r"historic/history/network/generations/([0-9a-f]{64})/(\d{4}-(?:0[1-9]|1[0-2]))\.json"
)
_NETWORK_HISTORY_INDEX_PATH = "historic/history/network/index.json"
_NETWORK_HISTORY_VERSIONED_INDEX_PATH_RE = re.compile(
    r"historic/history/network/generations/([0-9a-f]{64})/index\.json"
)
_NETWORK_HISTORY_METRICS = (
    ("delay", "additive"),
    ("delay_percentiles", "daily_only"),
    ("vehicles", "daily_only"),
    ("cancellation", "additive"),
    ("occupancy", "additive"),
)


def _history_model_error(emit: _Emitter, exc: ValidationError) -> None:
    emit.err("contract", "", None, f"retained history payload violates its contract: {exc}")


def _check_versioned_pointer_digest(
    emit: _Emitter,
    payload: object,
    match: re.Match[str] | None,
    *,
    group: int = 1,
) -> None:
    if match is None:
        return
    expected = snapshot_sha256(payload)  # type: ignore[arg-type]
    if match.group(group) != expected:
        emit.err(
            "pointer_sha256",
            "",
            match.group(group),
            "versioned pointer path SHA does not match exact payload bytes",
        )


def _check_network_history_day(emit: _Emitter, day: dict, index: int) -> None:  # type: ignore[type-arg]
    prefix = f"days[{index}]."
    delay = day.get("delay")
    if isinstance(delay, dict):
        observation_count = delay.get("observation_count")
        for field in ("in_clamp_observation_count", "on_time_count", "severe_count"):
            value = delay.get(field)
            if not _le(value, observation_count):
                emit.err(
                    "metric_range",
                    f"{prefix}delay.{field}",
                    value,
                    f"{field} cannot exceed delay observation_count",
                )
        in_clamp = delay.get("in_clamp_observation_count")
        on_time = delay.get("on_time_count")
        severe = delay.get("severe_count")
        in_clamp_bound = in_clamp if _is_number(in_clamp) else 0
        for field, value in (("on_time_count", on_time), ("severe_count", severe)):
            if _is_number(value) and value > in_clamp_bound:
                emit.err(
                    "delay_in_clamp_count",
                    f"{prefix}delay.{field}",
                    value,
                    f"{field} cannot exceed the in-clamp observation count",
                )
        if _is_number(on_time) and _is_number(severe) and on_time + severe > in_clamp_bound:
            emit.err(
                "delay_in_clamp_partition",
                f"{prefix}delay.on_time_count",
                on_time + severe,
                "on-time and severe counts cannot exceed the disjoint in-clamp population",
            )
        delay_sum = delay.get("sum_delay_seconds")
        if _is_number(delay_sum) and _is_number(in_clamp) and abs(delay_sum) > 3600 * in_clamp:
            emit.err(
                "delay_sum_bound",
                f"{prefix}delay.sum_delay_seconds",
                delay_sum,
                "absolute delay sum exceeds the capped in-clamp population",
            )
        if delay.get("sum_delay_seconds") is not None and delay.get(
            "in_clamp_observation_count"
        ) in (None, 0):
            emit.err(
                "metric_range",
                f"{prefix}delay.sum_delay_seconds",
                delay.get("sum_delay_seconds"),
                "delay sum requires a positive in-clamp denominator",
            )
    percentile = day.get("delay_percentiles")
    if isinstance(percentile, dict):
        p50 = percentile.get("p50_delay_seconds")
        p90 = percentile.get("p90_delay_seconds")
        for field, value in (("p50_delay_seconds", p50), ("p90_delay_seconds", p90)):
            if not _in_range(value, -3600, 3600):
                emit.err(
                    "metric_range",
                    f"{prefix}delay_percentiles.{field}",
                    value,
                    f"{field} is outside the capped raw fact range",
                )
        if not _le(p50, p90):
            emit.err(
                "metric_range",
                f"{prefix}delay_percentiles.p50_delay_seconds",
                p50,
                "p50 delay cannot exceed p90 delay",
            )
    vehicles = day.get("vehicles")
    if _is_number(vehicles) and vehicles <= 0:
        emit.err(
            "metric_range",
            f"{prefix}vehicles",
            vehicles,
            "vehicle count must be positive when emitted",
        )
    if (
        _is_number(vehicles)
        and isinstance(percentile, dict)
        and _is_number(percentile.get("observation_count"))
        and vehicles > percentile["observation_count"]
    ):
        emit.err(
            "vehicle_observation_bound",
            f"{prefix}vehicles",
            vehicles,
            "distinct vehicles cannot exceed raw percentile observations",
        )

    cancellation = day.get("cancellation")
    if isinstance(cancellation, dict):
        scheduled = cancellation.get("scheduled_trip_days")
        delivered = cancellation.get("delivered_trip_days")
        silent = cancellation.get("silent_trip_days")
        total = cancellation.get("total_trip_days")
        if scheduled is None and (delivered is not None or silent is not None):
            emit.err(
                "cancellation_universe",
                f"{prefix}cancellation.scheduled_trip_days",
                scheduled,
                "delivered and silent counts require a known scheduled universe",
            )
        delivered_cap = (
            total - cancellation.get("canceled_trip_days")
            if _is_number(total) and _is_number(cancellation.get("canceled_trip_days"))
            else None
        )
        if not _le(delivered, delivered_cap):
            emit.err(
                "cancellation_invariant",
                f"{prefix}cancellation.delivered_trip_days",
                delivered,
                "delivered trip-days cannot exceed total minus canceled trip-days",
            )
        if not _le(silent, scheduled):
            emit.err(
                "cancellation_invariant",
                f"{prefix}cancellation.silent_trip_days",
                silent,
                "silent trip-days cannot exceed scheduled trip-days",
            )


def check_network_history_partition(payload: object, *, rel_key: str) -> list[CheckResult]:
    """Validate one Network month payload, including its content-addressed path."""

    emit = _Emitter("historic_network_history_partition", rel_key)
    partition = _as_dict(payload)
    if not isinstance(partition, dict):
        emit.err("contract", "", payload, "network history partition must be an object")
        return emit.out
    try:
        NetworkHistoryPartition.model_validate(partition)
    except ValidationError as exc:
        _history_model_error(emit, exc)

    match = _NETWORK_HISTORY_PARTITION_PATH_RE.fullmatch(rel_key)
    if match is None:
        emit.err("partition_path", "", rel_key, "malformed Network history generation path")
    else:
        path_sha, path_month = match.groups()
        if partition.get("month") != path_month:
            emit.err(
                "partition_month",
                "month",
                partition.get("month"),
                "partition month does not match its generation path",
            )
        body = _serialized_body(payload)
        if body is not None and hashlib.sha256(body).hexdigest() != path_sha:
            emit.err(
                "partition_sha256",
                "",
                path_sha,
                "generation path SHA does not match exact partition bytes",
            )

    if partition.get("methodology_version") != "history-1":
        emit.err(
            "partition_envelope",
            "methodology_version",
            partition.get("methodology_version"),
            "immutable Network partition methodology_version must be history-1",
        )
    if partition.get("publish_generation_id") is not None:
        emit.err(
            "partition_envelope",
            "publish_generation_id",
            partition.get("publish_generation_id"),
            "immutable Network partition cannot carry a run generation stamp",
        )
    try:
        normalized_generated = history_utc_timestamp(
            partition.get("generated_utc"), field="generated_utc"
        )
    except ValueError:
        emit.err(
            "generated_utc",
            "generated_utc",
            partition.get("generated_utc"),
            "partition generated_utc is not an aware ISO timestamp",
        )
    else:
        if partition.get("generated_utc") != normalized_generated:
            emit.err(
                "partition_envelope",
                "generated_utc",
                partition.get("generated_utc"),
                "immutable Network partition timestamp must be canonical UTC Z",
            )
    days = partition.get("days") if isinstance(partition.get("days"), list) else []
    dates = [day.get("date") for day in days if isinstance(day, dict)]
    string_dates = [value for value in dates if isinstance(value, str)]
    if len(string_dates) != len(set(string_dates)):
        emit.err("duplicate_date", "days", dates, "partition contains a duplicate date")
    if dates != sorted(string_dates):
        emit.err("date_order", "days", dates, "partition dates must be strictly ascending")
    for index, day in enumerate(days):
        if isinstance(day, dict):
            _check_network_history_day(emit, day, index)
    return emit.out


def _coverage_dict(value: object) -> object:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, list):
        return [_coverage_dict(item) for item in value]
    if isinstance(value, dict):
        return {key: _coverage_dict(item) for key, item in value.items()}
    if isinstance(value, Enum):
        return value.value
    return value


@dataclass
class NetworkHistoryStreamSummary:
    """Compact truth accumulated while Network month payloads stream past the gate."""

    refs: list[HistoricPartitionRef] = field(default_factory=list)
    available_dates: list[str] = field(default_factory=list)
    metric_dates: dict[str, list[str]] = field(
        default_factory=lambda: {metric: [] for metric, _aggregation in _NETWORK_HISTORY_METRICS}
    )
    generated_timestamps: list[str] = field(default_factory=list)

    def observe(self, ref: object, partition: object) -> None:
        """Retain only one compact ref and structural scalars from a streamed month."""

        try:
            retained_ref = HistoricPartitionRef.model_validate(_coverage_dict(ref))
        except (TypeError, ValidationError):
            pass
        else:
            self.refs.append(retained_ref)
        value = _as_dict(partition)
        if not isinstance(value, dict):
            return
        generated_utc = value.get("generated_utc")
        if isinstance(generated_utc, str):
            self.generated_timestamps.append(generated_utc)
        days = value.get("days") if isinstance(value.get("days"), list) else []
        for day in days:
            if not isinstance(day, dict):
                continue
            local_date = day.get("date")
            if not isinstance(local_date, str):
                continue
            self.available_dates.append(local_date)
            for metric in self.metric_dates:
                if day.get(metric) is not None:
                    self.metric_dates[metric].append(local_date)

    def detached_refs(self) -> list[HistoricPartitionRef]:
        """Give an index builder copies that cannot rewrite the streamed truth."""

        return [ref.model_copy(deep=True) for ref in self.refs]


def check_network_history_stream_index(
    payload: object,
    summary: NetworkHistoryStreamSummary,
    *,
    fallback_generated_utc: str,
) -> list[CheckResult]:
    """Cross-check the final pointer against exactly the children streamed this run."""

    emit = _Emitter("historic_network_history_stream", _NETWORK_HISTORY_INDEX_PATH)
    index = _as_dict(payload)
    if not isinstance(index, dict):
        emit.err("contract", "", payload, "network history index must be an object")
        return emit.out

    expected_refs = [_coverage_dict(ref) for ref in summary.refs]
    actual_refs = _coverage_dict(index.get("partitions") or [])
    if actual_refs != expected_refs:
        emit.err(
            "stream_partitions",
            "partitions",
            actual_refs,
            "Network index refs do not exactly match streamed partition refs",
        )

    expected_dates = sorted(summary.available_dates)
    actual_dates = index.get("available_dates")
    if actual_dates != expected_dates:
        emit.err(
            "stream_available_dates",
            "available_dates",
            actual_dates,
            "Network index dates do not exactly match streamed partition days",
        )
    first, last, gaps = history_coverage(expected_dates)
    expected_coverage = (first, last, _coverage_dict(gaps))
    actual_coverage = (
        index.get("first_available_date"),
        index.get("last_available_date"),
        _coverage_dict(index.get("gaps") or []),
    )
    if actual_coverage != expected_coverage:
        emit.err(
            "stream_coverage",
            "available_dates",
            actual_coverage,
            "Network index coverage does not match streamed partition days",
        )

    expected_metrics = _coverage_dict(
        [
            history_metric_coverage(metric, aggregation, summary.metric_dates[metric])
            for metric, aggregation in _NETWORK_HISTORY_METRICS
        ]
    )
    actual_metrics = _coverage_dict(index.get("metrics") or [])
    if actual_metrics != expected_metrics:
        emit.err(
            "stream_metrics",
            "metrics",
            actual_metrics,
            "Network metric coverage does not match streamed partition days",
        )

    try:
        expected_generated_utc = latest_history_timestamp(
            summary.generated_timestamps,
            fallback=fallback_generated_utc,
        )
    except ValueError:
        expected_generated_utc = None
    if index.get("generated_utc") != expected_generated_utc:
        emit.err(
            "stream_generated_utc",
            "generated_utc",
            index.get("generated_utc"),
            "Network index timestamp does not match streamed partition provenance",
        )
    return emit.out


def check_network_history_index(payload: object, *, rel_key: str) -> list[CheckResult]:
    """Validate the stable Network pointer's self-contained invariants."""

    emit = _Emitter("historic_network_history_index", rel_key)
    index = _as_dict(payload)
    if not isinstance(index, dict):
        emit.err("contract", "", payload, "network history index must be an object")
        return emit.out
    try:
        HistoricCollectionIndex.model_validate(index)
    except ValidationError as exc:
        _history_model_error(emit, exc)
    versioned_match = _NETWORK_HISTORY_VERSIONED_INDEX_PATH_RE.fullmatch(rel_key)
    if rel_key != _NETWORK_HISTORY_INDEX_PATH and versioned_match is None:
        emit.err("index_path", "", rel_key, "Network history index uses a malformed path")
    _check_versioned_pointer_digest(emit, payload, versioned_match)
    if (
        index.get("family") != "network"
        or index.get("selection_mode") != "range"
        or index.get("entity_id") is not None
    ):
        emit.err(
            "index_identity",
            "family",
            index.get("family"),
            "Network history index must identify the network/range family",
        )
    try:
        normalized_generated = history_utc_timestamp(
            index.get("generated_utc"), field="generated_utc"
        )
    except ValueError:
        normalized_generated = None
    if index.get("generated_utc") != normalized_generated:
        emit.err(
            "generated_utc",
            "generated_utc",
            index.get("generated_utc"),
            "Network index timestamp must be canonical UTC Z",
        )

    dates = index.get("available_dates") if isinstance(index.get("available_dates"), list) else []
    try:
        first, last, gaps = history_coverage(dates)
    except ValueError:
        emit.err("available_dates", "available_dates", dates, "index dates are malformed")
    else:
        if dates != sorted(set(dates)):
            emit.err(
                "available_dates",
                "available_dates",
                dates,
                "index available_dates must be sorted and unique",
            )
        expected = (first, last, _coverage_dict(gaps))
        actual = (
            index.get("first_available_date"),
            index.get("last_available_date"),
            _coverage_dict(index.get("gaps") or []),
        )
        if actual != expected:
            emit.err(
                "available_dates",
                "available_dates",
                dates,
                "index coverage/gaps do not match available_dates",
            )

    refs = index.get("partitions") if isinstance(index.get("partitions"), list) else []
    ref_paths = [ref.get("path") for ref in refs if isinstance(ref, dict)]
    string_ref_paths = [path for path in ref_paths if isinstance(path, str)]
    if len(string_ref_paths) != len(set(string_ref_paths)):
        emit.err(
            "duplicate_ref_path",
            "partitions",
            ref_paths,
            "partition path is referenced twice",
        )
    months: list[str] = []
    for position, ref in enumerate(refs):
        if not isinstance(ref, dict):
            continue
        match = _NETWORK_HISTORY_PARTITION_PATH_RE.fullmatch(str(ref.get("path") or ""))
        if match is None:
            emit.err(
                "ref_path",
                f"partitions[{position}].path",
                ref.get("path"),
                "partition ref path is malformed",
            )
            continue
        path_sha, month = match.groups()
        months.append(month)
        if ref.get("sha256") != path_sha:
            emit.err(
                "ref_path",
                f"partitions[{position}].sha256",
                ref.get("sha256"),
                "partition ref SHA does not match its path",
            )
    if len(months) != len(set(months)):
        emit.err("duplicate_month", "partitions", months, "Network month is referenced twice")
    if months != sorted(months):
        emit.err("partition_order", "partitions", months, "Network partitions are not month-sorted")

    metrics = index.get("metrics") if isinstance(index.get("metrics"), list) else []
    identity = [
        (metric.get("metric"), metric.get("aggregation"))
        for metric in metrics
        if isinstance(metric, dict)
    ]
    if identity != list(_NETWORK_HISTORY_METRICS):
        emit.err(
            "metric_vocabulary",
            "metrics",
            identity,
            "Network metric order or aggregation class is not canonical",
        )
    expected_generation = history_index_generation_id(index)
    if index.get("collection_generation_id") != expected_generation:
        emit.err(
            "collection_generation_id",
            "collection_generation_id",
            index.get("collection_generation_id"),
            "collection generation does not match canonical Network index semantics",
        )
    return emit.out


def check_network_history_partition_ref(ref: object, partition: object) -> list[CheckResult]:
    """Cross-check one compact ref against the exact month payload before upload."""

    ref_dict = _as_dict(ref)
    if not isinstance(ref_dict, dict):
        emit = _Emitter("historic_network_history_partition_ref", _NETWORK_HISTORY_INDEX_PATH)
        emit.err("contract", "partition", ref, "Network partition ref must be an object")
        return emit.out
    path = ref_dict.get("path")
    emit = _Emitter(
        "historic_network_history_partition_ref",
        path if isinstance(path, str) else _NETWORK_HISTORY_INDEX_PATH,
    )
    if not isinstance(path, str):
        emit.err("ref_path", "path", path, "partition ref path must be a string")
        return emit.out

    partition_dict = _as_dict(partition)
    if not isinstance(partition_dict, dict):
        emit.err("contract", "partition", partition, "Network partition must be an object")
        return emit.out
    body = _serialized_body(partition)
    if body is not None:
        digest = hashlib.sha256(body).hexdigest()
        if ref_dict.get("sha256") != digest:
            emit.err("ref_sha256", "sha256", ref_dict.get("sha256"), "ref SHA mismatches bytes")
        if ref_dict.get("byte_size") != len(body):
            emit.err(
                "ref_byte_size",
                "byte_size",
                ref_dict.get("byte_size"),
                "ref byte size mismatches bytes",
            )

    path_match = _NETWORK_HISTORY_PARTITION_PATH_RE.fullmatch(path)
    path_month = path_match.group(2) if path_match else None
    if path_match is None:
        emit.err("ref_path", "path", path, "partition ref path is malformed")
    elif ref_dict.get("sha256") != path_match.group(1):
        emit.err(
            "ref_path",
            "sha256",
            ref_dict.get("sha256"),
            "partition ref SHA does not match its path",
        )
    if partition_dict.get("month") != path_month:
        emit.err(
            "partition_month",
            "month",
            partition_dict.get("month"),
            "partition month mismatches ref path",
        )

    days = partition_dict.get("days") if isinstance(partition_dict.get("days"), list) else []
    dates = [day.get("date") for day in days if isinstance(day, dict)]
    if ref_dict.get("count") != len(days):
        emit.err("ref_count", "count", ref_dict.get("count"), "ref count mismatches partition")
    if days:
        coverage = (dates[0], dates[-1])
        if (ref_dict.get("coverage_start"), ref_dict.get("coverage_end")) != coverage:
            emit.err(
                "ref_coverage",
                "coverage_start",
                None,
                "ref coverage mismatches partition",
            )
    return emit.out


def check_network_history_bundle(
    index: object,
    partition_items: list[tuple[str, object]],
    *,
    include_payload_checks: bool = True,
) -> list[CheckResult]:
    """Cross-check the Network index against the exact immutable month bytes."""

    findings = (
        check_network_history_index(index, rel_key=_NETWORK_HISTORY_INDEX_PATH)
        if include_payload_checks
        else []
    )
    index_dict = _as_dict(index)
    if not isinstance(index_dict, dict):
        return findings

    built: dict[str, object] = {}
    for path, partition in partition_items:
        if path in built:
            emit = _Emitter("historic_network_history_bundle", path)
            emit.err("duplicate_built_path", "path", path, "partition path was built twice")
            findings.extend(emit.out)
        built[path] = partition

    refs = index_dict.get("partitions") or []
    referenced: set[str] = set()
    all_dates: list[str] = []
    metric_dates = {metric: [] for metric, _aggregation in _NETWORK_HISTORY_METRICS}
    partition_timestamps: list[str] = []
    for ref in refs:
        if not isinstance(ref, dict) or not isinstance(ref.get("path"), str):
            continue
        path = ref["path"]
        if path in referenced:
            emit = _Emitter("historic_network_history_bundle", path)
            emit.err("duplicate_ref_path", "path", path, "partition ref path occurs twice")
            findings.extend(emit.out)
        referenced.add(path)
        partition = built.get(path)
        emit = _Emitter("historic_network_history_bundle", path)
        if partition is None:
            emit.err("missing_partition", "path", path, "referenced partition was not built")
            findings.extend(emit.out)
            continue
        if include_payload_checks:
            findings.extend(check_network_history_partition(partition, rel_key=path))
        partition_dict = _as_dict(partition)
        if not isinstance(partition_dict, dict):
            continue
        body = _serialized_body(partition)
        if body is not None:
            digest = hashlib.sha256(body).hexdigest()
            if ref.get("sha256") != digest:
                emit.err("ref_sha256", "sha256", ref.get("sha256"), "ref SHA mismatches bytes")
            if ref.get("byte_size") != len(body):
                emit.err(
                    "ref_byte_size",
                    "byte_size",
                    ref.get("byte_size"),
                    "ref byte size mismatches bytes",
                )
        path_match = _NETWORK_HISTORY_PARTITION_PATH_RE.fullmatch(path)
        path_month = path_match.group(2) if path_match else None
        if partition_dict.get("month") != path_month:
            emit.err(
                "partition_month",
                "month",
                partition_dict.get("month"),
                "partition month mismatches ref path",
            )
        days = partition_dict.get("days") if isinstance(partition_dict.get("days"), list) else []
        dates = [day.get("date") for day in days if isinstance(day, dict)]
        all_dates.extend(value for value in dates if isinstance(value, str))
        if ref.get("count") != len(days):
            emit.err("ref_count", "count", ref.get("count"), "ref count mismatches partition")
        if days:
            coverage = (dates[0], dates[-1])
            if (ref.get("coverage_start"), ref.get("coverage_end")) != coverage:
                emit.err(
                    "ref_coverage",
                    "coverage_start",
                    None,
                    "ref coverage mismatches partition",
                )
        for day in days:
            if not isinstance(day, dict) or not isinstance(day.get("date"), str):
                continue
            for metric in metric_dates:
                if day.get(metric) is not None:
                    metric_dates[metric].append(day["date"])
        try:
            partition_timestamps.append(
                history_utc_timestamp(partition_dict.get("generated_utc"), field="generated_utc")
            )
        except ValueError:
            pass
        findings.extend(emit.out)

    for path in built.keys() - referenced:
        emit = _Emitter("historic_network_history_bundle", path)
        emit.err("unreferenced_partition", "path", path, "built partition is not referenced")
        findings.extend(emit.out)
    if len(all_dates) != len(set(all_dates)):
        emit = _Emitter("historic_network_history_bundle", _NETWORK_HISTORY_INDEX_PATH)
        emit.err(
            "duplicate_date",
            "available_dates",
            all_dates,
            "date occurs in multiple partitions",
        )
        findings.extend(emit.out)

    emit = _Emitter("historic_network_history_bundle", _NETWORK_HISTORY_INDEX_PATH)
    expected_dates = sorted(set(all_dates))
    if index_dict.get("available_dates") != expected_dates:
        emit.err(
            "available_dates",
            "available_dates",
            index_dict.get("available_dates"),
            "index dates do not match its partitions",
        )
    try:
        first, last, gaps = history_coverage(expected_dates)
    except ValueError:
        first, last, gaps = None, None, []
        emit.err(
            "available_dates",
            "available_dates",
            expected_dates,
            "partition dates are not valid canonical calendar dates",
        )
    else:
        if (
            index_dict.get("first_available_date"),
            index_dict.get("last_available_date"),
            _coverage_dict(index_dict.get("gaps") or []),
        ) != (first, last, _coverage_dict(gaps)):
            emit.err(
                "available_dates",
                "first_available_date",
                index_dict.get("first_available_date"),
                "index family coverage does not match partition days",
            )
    actual_metrics = index_dict.get("metrics") or []
    try:
        expected_metrics = [
            history_metric_coverage(metric, aggregation, metric_dates[metric])
            for metric, aggregation in _NETWORK_HISTORY_METRICS
        ]
    except ValueError:
        expected_metrics = []
        emit.err(
            "metric_coverage",
            "metrics",
            metric_dates,
            "metric dates are not valid canonical calendar dates",
        )
    if expected_metrics and _coverage_dict(actual_metrics) != _coverage_dict(expected_metrics):
        emit.err(
            "metric_coverage",
            "metrics",
            actual_metrics,
            "metric coverage/gaps do not match emitted metric days",
        )
    if partition_timestamps:
        expected_generated = latest_history_timestamp(partition_timestamps)
        try:
            actual_generated = history_utc_timestamp(
                index_dict.get("generated_utc"), field="generated_utc"
            )
        except ValueError:
            actual_generated = None
        if actual_generated != expected_generated:
            emit.err(
                "generated_utc",
                "generated_utc",
                index_dict.get("generated_utc"),
                "index timestamp is not the latest referenced partition timestamp",
            )
    findings.extend(emit.out)
    return findings


_LINE_HISTORY_PARTITION_PATH_RE = re.compile(
    r"historic/history/lines/((?:[0-9a-f]{2})+)/generations/"
    r"([0-9a-f]{64})/(\d{4}-(?:0[1-9]|1[0-2]))\.json"
)
_LINE_HISTORY_ENTITY_INDEX_PATH_RE = re.compile(
    r"historic/history/lines/((?:[0-9a-f]{2})+)/index\.json"
)
_LINE_HISTORY_VERSIONED_ENTITY_INDEX_PATH_RE = re.compile(
    r"historic/history/lines/((?:[0-9a-f]{2})+)/generations/([0-9a-f]{64})/index\.json"
)
_LINE_HISTORY_DIRECTORY_PATH = "historic/history/lines/index.json"
_LINE_HISTORY_VERSIONED_DIRECTORY_PATH_RE = re.compile(
    r"historic/history/lines/generations/([0-9a-f]{64})/index\.json"
)
_LINE_HISTORY_METRICS = (
    ("delay", "additive"),
    ("delay_percentiles", "daily_only"),
    ("cancellation", "additive"),
    ("occupancy", "additive"),
    ("service_span", "daily_only"),
    ("skipped_stops", "additive"),
)


def _check_line_history_day(emit: _Emitter, day: dict, index: int) -> None:  # type: ignore[type-arg]
    """Apply shared retained-metric checks plus Line-only daily invariants."""

    _check_network_history_day(emit, day, index)
    prefix = f"days[{index}]."
    service_span = day.get("service_span")
    if isinstance(service_span, dict):
        normalized: dict[str, str | None] = {}
        for field_name in ("first_trip_utc", "last_trip_utc"):
            value = service_span.get(field_name)
            if value is None:
                normalized[field_name] = None
                continue
            try:
                canonical = history_utc_timestamp(value, field=field_name)
            except ValueError:
                canonical = None
            normalized[field_name] = canonical
            if value != canonical:
                emit.err(
                    "service_span_timestamp",
                    f"{prefix}service_span.{field_name}",
                    value,
                    f"{field_name} must be an aware canonical UTC Z timestamp",
                )
        first = normalized.get("first_trip_utc")
        last = normalized.get("last_trip_utc")
        if first is not None and last is not None and not _iso_le(first, last):
            emit.err(
                "service_span_order",
                f"{prefix}service_span.first_trip_utc",
                first,
                "first Line trip timestamp cannot be after the last trip timestamp",
            )


def check_line_history_partition(payload: object, *, rel_key: str) -> list[CheckResult]:
    """Validate one content-addressed Line month and its exact path identity."""

    emit = _Emitter("historic_line_history_partition", rel_key)
    partition = _as_dict(payload)
    if not isinstance(partition, dict):
        emit.err("contract", "", payload, "Line history partition must be an object")
        return emit.out
    try:
        LineHistoryPartition.model_validate(partition)
    except ValidationError as exc:
        _history_model_error(emit, exc)

    match = _LINE_HISTORY_PARTITION_PATH_RE.fullmatch(rel_key)
    if match is None:
        emit.err("partition_path", "", rel_key, "malformed Line history generation path")
        path_entity = path_sha = path_month = None
    else:
        encoded_id, path_sha, path_month = match.groups()
        try:
            path_entity = decode_history_entity_id(encoded_id)
        except ValueError:
            path_entity = None
            emit.err(
                "partition_entity",
                "entity_id",
                encoded_id,
                "Line history path does not contain canonical UTF-8 entity identity",
            )
    if partition.get("entity_id") != path_entity:
        emit.err(
            "partition_entity",
            "entity_id",
            partition.get("entity_id"),
            "Line partition entity_id does not match its encoded path identity",
        )
    if partition.get("month") != path_month:
        emit.err(
            "partition_month",
            "month",
            partition.get("month"),
            "Line partition month does not match its generation path",
        )
    body = _serialized_body(payload)
    if body is not None and path_sha is not None and hashlib.sha256(body).hexdigest() != path_sha:
        emit.err(
            "partition_sha256",
            "",
            path_sha,
            "Line generation path SHA does not match exact partition bytes",
        )

    if partition.get("methodology_version") != "history-1":
        emit.err(
            "partition_envelope",
            "methodology_version",
            partition.get("methodology_version"),
            "immutable Line partition methodology_version must be history-1",
        )
    if partition.get("publish_generation_id") is not None:
        emit.err(
            "partition_envelope",
            "publish_generation_id",
            partition.get("publish_generation_id"),
            "immutable Line partition cannot carry a run generation stamp",
        )
    try:
        normalized_generated = history_utc_timestamp(
            partition.get("generated_utc"), field="generated_utc"
        )
    except ValueError:
        normalized_generated = None
    if partition.get("generated_utc") != normalized_generated:
        emit.err(
            "partition_envelope",
            "generated_utc",
            partition.get("generated_utc"),
            "Line partition timestamp must be canonical UTC Z",
        )

    days = partition.get("days") if isinstance(partition.get("days"), list) else []
    dates = [day.get("date") for day in days if isinstance(day, dict)]
    string_dates = [value for value in dates if isinstance(value, str)]
    if len(string_dates) != len(set(string_dates)):
        emit.err("duplicate_date", "days", dates, "Line partition contains a duplicate date")
    if dates != sorted(string_dates):
        emit.err("date_order", "days", dates, "Line partition dates must be ascending")
    for position, day in enumerate(days):
        if isinstance(day, dict):
            unexpected = sorted(
                set(day)
                - {
                    "date",
                    "delay",
                    "delay_percentiles",
                    "cancellation",
                    "occupancy",
                    "service_span",
                    "skipped_stops",
                },
                key=str,
            )
            if unexpected:
                emit.err(
                    "line_metric_vocabulary",
                    f"days[{position}]",
                    unexpected,
                    "Line history day contains fabricated current-only fields",
                )
            _check_line_history_day(emit, day, position)
    return emit.out


def check_line_history_partition_ref(ref: object, partition: object) -> list[CheckResult]:
    """Cross-check one Line ref against exact immutable bytes and entity identity."""

    ref_dict = _as_dict(ref)
    partition_dict = _as_dict(partition)
    path = ref_dict.get("path") if isinstance(ref_dict, dict) else None
    emit = _Emitter(
        "historic_line_history_partition_ref",
        path if isinstance(path, str) else _LINE_HISTORY_DIRECTORY_PATH,
    )
    if not isinstance(ref_dict, dict):
        emit.err("contract", "ref", ref, "Line partition ref must be an object")
        return emit.out
    if not isinstance(partition_dict, dict):
        emit.err("contract", "partition", partition, "Line partition must be an object")
        return emit.out
    if not isinstance(path, str):
        emit.err("ref_path", "path", path, "Line partition ref path must be a string")
        return emit.out

    match = _LINE_HISTORY_PARTITION_PATH_RE.fullmatch(path)
    if match is None:
        emit.err("ref_path", "path", path, "Line partition ref path is malformed")
        path_entity = path_sha = path_month = None
    else:
        encoded_id, path_sha, path_month = match.groups()
        try:
            path_entity = decode_history_entity_id(encoded_id)
        except ValueError:
            path_entity = None
    if partition_dict.get("entity_id") != path_entity:
        emit.err(
            "ref_entity",
            "entity_id",
            partition_dict.get("entity_id"),
            "Line partition entity_id mismatches the ref path",
        )
    if partition_dict.get("month") != path_month:
        emit.err(
            "ref_month",
            "month",
            partition_dict.get("month"),
            "Line partition month mismatches the ref path",
        )

    body = _serialized_body(partition)
    if body is not None:
        digest = hashlib.sha256(body).hexdigest()
        if ref_dict.get("sha256") != digest:
            emit.err("ref_sha256", "sha256", ref_dict.get("sha256"), "ref SHA mismatches bytes")
        if ref_dict.get("byte_size") != len(body):
            emit.err(
                "ref_byte_size",
                "byte_size",
                ref_dict.get("byte_size"),
                "ref byte size mismatches bytes",
            )
        if path_sha is not None and ref_dict.get("sha256") != path_sha:
            emit.err(
                "ref_path",
                "sha256",
                ref_dict.get("sha256"),
                "Line ref SHA does not match its generation path",
            )
    days = partition_dict.get("days") if isinstance(partition_dict.get("days"), list) else []
    dates = [day.get("date") for day in days if isinstance(day, dict)]
    if ref_dict.get("count") != len(days):
        emit.err("ref_count", "count", ref_dict.get("count"), "ref count mismatches partition")
    if days and (ref_dict.get("coverage_start"), ref_dict.get("coverage_end")) != (
        dates[0],
        dates[-1],
    ):
        emit.err(
            "ref_coverage",
            "coverage_start",
            None,
            "Line ref coverage mismatches its partition",
        )
    return emit.out


@dataclass
class _LineEntityStream:
    refs: list[HistoricPartitionRef] = field(default_factory=list)
    available_dates: list[str] = field(default_factory=list)
    metric_dates: dict[str, list[str]] = field(
        default_factory=lambda: {metric: [] for metric, _aggregation in _LINE_HISTORY_METRICS}
    )
    generated_timestamps: list[str] = field(default_factory=list)


@dataclass
class LineHistoryStreamSummary:
    """Independent compact truth retained while Line month payloads stream."""

    entities: dict[str, _LineEntityStream] = field(default_factory=dict)

    def observe(self, ref: object, partition: object) -> None:
        value = _as_dict(partition)
        if not isinstance(value, dict) or not isinstance(value.get("entity_id"), str):
            return
        entity_id = value["entity_id"]
        summary = self.entities.setdefault(entity_id, _LineEntityStream())
        try:
            retained_ref = HistoricPartitionRef.model_validate(_coverage_dict(ref))
        except (TypeError, ValidationError):
            pass
        else:
            summary.refs.append(retained_ref)
        generated_utc = value.get("generated_utc")
        if isinstance(generated_utc, str):
            summary.generated_timestamps.append(generated_utc)
        days = value.get("days") if isinstance(value.get("days"), list) else []
        for day in days:
            if not isinstance(day, dict) or not isinstance(day.get("date"), str):
                continue
            local_date = day["date"]
            summary.available_dates.append(local_date)
            for metric in summary.metric_dates:
                if day.get(metric) is not None:
                    summary.metric_dates[metric].append(local_date)


def _expected_line_index(
    entity_id: str,
    summary: _LineEntityStream,
    *,
    fallback_generated_utc: str,
) -> dict:  # type: ignore[type-arg]
    dates = sorted(summary.available_dates)
    first, last, gaps = history_coverage(dates)
    value = {
        "generated_utc": latest_history_timestamp(
            summary.generated_timestamps,
            fallback=fallback_generated_utc,
        ),
        "family": "lines",
        "selection_mode": "range",
        "entity_id": entity_id,
        "first_available_date": first,
        "last_available_date": last,
        "available_dates": dates,
        "gaps": _coverage_dict(gaps),
        "partitions": _coverage_dict(summary.refs),
        "metrics": _coverage_dict(
            [
                history_metric_coverage(metric, aggregation, summary.metric_dates[metric])
                for metric, aggregation in _LINE_HISTORY_METRICS
            ]
        ),
    }
    value["collection_generation_id"] = history_index_generation_id(value)
    return value


def check_line_history_stream_indexes(
    payloads: object,
    summary: LineHistoryStreamSummary,
    *,
    fallback_generated_utc: str,
) -> list[CheckResult]:
    """Reject any mutable Line index graph that differs from streamed children."""

    emit = _Emitter("historic_line_history_stream", _LINE_HISTORY_DIRECTORY_PATH)
    if not isinstance(payloads, list):
        emit.err("line_stream_indexes", "indexes", payloads, "Line indexes must be a list")
        return emit.out
    actual_by_entity: dict[str, dict] = {}  # type: ignore[type-arg]
    duplicates: list[str] = []
    for payload in payloads:
        value = _as_dict(payload)
        if not isinstance(value, dict) or not isinstance(value.get("entity_id"), str):
            emit.err(
                "line_stream_indexes",
                "indexes",
                value,
                "every Line index must carry a raw entity_id",
            )
            continue
        entity_id = value["entity_id"]
        if entity_id in actual_by_entity:
            duplicates.append(entity_id)
        actual_by_entity[entity_id] = value
    expected_entities = sorted(summary.entities)
    if duplicates or sorted(actual_by_entity) != expected_entities:
        emit.err(
            "line_stream_indexes",
            "indexes",
            sorted(actual_by_entity),
            "Line index entities do not exactly match streamed partition entities",
        )
    for entity_id in expected_entities:
        actual = actual_by_entity.get(entity_id)
        if actual is None:
            continue
        expected = _expected_line_index(
            entity_id,
            summary.entities[entity_id],
            fallback_generated_utc=fallback_generated_utc,
        )
        fields = (
            "generated_utc",
            "family",
            "selection_mode",
            "entity_id",
            "collection_generation_id",
            "first_available_date",
            "last_available_date",
            "available_dates",
            "gaps",
            "partitions",
            "metrics",
        )
        actual_semantics = {
            field_name: _coverage_dict(actual.get(field_name)) for field_name in fields
        }
        expected_semantics = {
            field_name: _coverage_dict(expected.get(field_name)) for field_name in fields
        }
        if actual_semantics != expected_semantics:
            emit.err(
                "line_stream_indexes",
                f"indexes[{entity_id}]",
                actual_semantics,
                "Line entity index does not exactly match its streamed partitions",
            )
    return emit.out


@dataclass
class LineHistoryDirectorySummary:
    """Detached exact child-index edges used to gate the final Lines directory."""

    entities: list[HistoricEntityIndexRef] = field(default_factory=list)
    available_dates: list[str] = field(default_factory=list)
    generated_timestamps: list[str] = field(default_factory=list)

    @classmethod
    def from_indexes(
        cls,
        indexes: list[object],
        *,
        index_paths: dict[str, str] | None = None,
    ) -> LineHistoryDirectorySummary:
        summary = cls()
        for payload in indexes:
            value = _as_dict(payload)
            if not isinstance(value, dict) or not isinstance(value.get("entity_id"), str):
                continue
            entity_id = value["entity_id"]
            encoded_id = encode_history_entity_id(entity_id)
            summary.entities.append(
                HistoricEntityIndexRef(
                    entity_id=entity_id,
                    encoded_id=encoded_id,
                    index_path=(index_paths or {}).get(
                        entity_id,
                        f"historic/history/lines/{encoded_id}/index.json",
                    ),
                    collection_generation_id=str(value.get("collection_generation_id") or ""),
                    first_available_date=value.get("first_available_date"),
                    last_available_date=value.get("last_available_date"),
                )
            )
            summary.available_dates.extend(
                value.get("available_dates")
                if isinstance(value.get("available_dates"), list)
                else []
            )
            if isinstance(value.get("generated_utc"), str):
                summary.generated_timestamps.append(value["generated_utc"])
        summary.entities.sort(key=lambda item: item.entity_id)
        return summary


def check_line_history_stream_directory(
    payload: object,
    summary: LineHistoryDirectorySummary,
    *,
    fallback_generated_utc: str,
) -> list[CheckResult]:
    """Cross-check the Lines directory against detached, already-gated child edges."""

    emit = _Emitter("historic_line_history_stream", _LINE_HISTORY_DIRECTORY_PATH)
    directory = _as_dict(payload)
    if not isinstance(directory, dict):
        emit.err(
            "line_stream_directory",
            "directory",
            payload,
            "Lines directory must be an object",
        )
        return emit.out
    dates = sorted(set(summary.available_dates))
    first, last, _gaps = history_coverage(dates)
    expected = {
        "generated_utc": latest_history_timestamp(
            summary.generated_timestamps,
            fallback=fallback_generated_utc,
        ),
        "family": "lines",
        "selection_mode": "range",
        "first_available_date": first,
        "last_available_date": last,
        "entities": _coverage_dict(summary.entities),
    }
    expected["collection_generation_id"] = history_entity_directory_generation_id(expected)
    fields = (
        "generated_utc",
        "family",
        "selection_mode",
        "collection_generation_id",
        "first_available_date",
        "last_available_date",
        "entities",
    )
    actual = {field_name: _coverage_dict(directory.get(field_name)) for field_name in fields}
    if actual != expected:
        emit.err(
            "line_stream_directory",
            "entities",
            actual,
            "Lines directory does not exactly match the gated entity indexes",
        )
    return emit.out


def check_line_history_index(payload: object, *, rel_key: str) -> list[CheckResult]:
    """Validate one nonempty stable per-Line collection index."""

    emit = _Emitter("historic_line_history_index", rel_key)
    index = _as_dict(payload)
    if not isinstance(index, dict):
        emit.err("contract", "", payload, "Line history index must be an object")
        return emit.out
    try:
        HistoricCollectionIndex.model_validate(index)
    except ValidationError as exc:
        _history_model_error(emit, exc)

    match = _LINE_HISTORY_ENTITY_INDEX_PATH_RE.fullmatch(rel_key)
    versioned_match = _LINE_HISTORY_VERSIONED_ENTITY_INDEX_PATH_RE.fullmatch(rel_key)
    if match is None and versioned_match is None:
        emit.err("index_path", "", rel_key, "Line entity index uses a malformed path")
        path_entity = encoded_id = None
    else:
        encoded_id = (match or versioned_match).group(1)  # type: ignore[union-attr]
        try:
            path_entity = decode_history_entity_id(encoded_id)
        except ValueError:
            path_entity = None
    _check_versioned_pointer_digest(emit, payload, versioned_match, group=2)
    entity_id = index.get("entity_id")
    if (
        index.get("family") != "lines"
        or index.get("selection_mode") != "range"
        or not isinstance(entity_id, str)
        or not entity_id
        or entity_id != path_entity
    ):
        emit.err(
            "index_identity",
            "entity_id",
            entity_id,
            "Line index family/range/raw identity must match its encoded path",
        )
    try:
        normalized_generated = history_utc_timestamp(
            index.get("generated_utc"), field="generated_utc"
        )
    except ValueError:
        normalized_generated = None
    if index.get("generated_utc") != normalized_generated:
        emit.err(
            "generated_utc",
            "generated_utc",
            index.get("generated_utc"),
            "Line index timestamp must be canonical UTC Z",
        )

    dates = index.get("available_dates") if isinstance(index.get("available_dates"), list) else []
    refs = index.get("partitions") if isinstance(index.get("partitions"), list) else []
    if not dates or not refs:
        emit.err(
            "empty_entity",
            "partitions",
            refs,
            "a Line entity index cannot advertise an empty retained collection",
        )
    try:
        first, last, gaps = history_coverage(dates)
    except ValueError:
        emit.err("available_dates", "available_dates", dates, "Line index dates are malformed")
    else:
        expected_coverage = (first, last, _coverage_dict(gaps))
        actual_coverage = (
            index.get("first_available_date"),
            index.get("last_available_date"),
            _coverage_dict(index.get("gaps") or []),
        )
        if dates != sorted(set(dates)) or actual_coverage != expected_coverage:
            emit.err(
                "available_dates",
                "available_dates",
                dates,
                "Line index dates/coverage/gaps are not canonical",
            )

    paths: list[object] = []
    months: list[str] = []
    for position, ref in enumerate(refs):
        if not isinstance(ref, dict):
            continue
        path = ref.get("path")
        paths.append(path)
        ref_match = _LINE_HISTORY_PARTITION_PATH_RE.fullmatch(str(path or ""))
        if ref_match is None:
            emit.err(
                "ref_path",
                f"partitions[{position}].path",
                path,
                "Line partition ref path is malformed",
            )
            continue
        ref_encoded, path_sha, month = ref_match.groups()
        months.append(month)
        if ref_encoded != encoded_id:
            emit.err(
                "ref_entity",
                f"partitions[{position}].path",
                path,
                "Line partition ref belongs to another entity",
            )
        if ref.get("sha256") != path_sha:
            emit.err(
                "ref_path",
                f"partitions[{position}].sha256",
                ref.get("sha256"),
                "Line partition ref SHA does not match its path",
            )
    string_paths = [path for path in paths if isinstance(path, str)]
    if len(string_paths) != len(set(string_paths)):
        emit.err("duplicate_ref_path", "partitions", paths, "Line partition path is repeated")
    if len(months) != len(set(months)):
        emit.err("duplicate_month", "partitions", months, "Line month is referenced twice")
    if months != sorted(months):
        emit.err("partition_order", "partitions", months, "Line partitions are not month-sorted")

    metrics = index.get("metrics") if isinstance(index.get("metrics"), list) else []
    identity = [
        (metric.get("metric"), metric.get("aggregation"))
        for metric in metrics
        if isinstance(metric, dict)
    ]
    if identity != list(_LINE_HISTORY_METRICS):
        emit.err(
            "metric_vocabulary",
            "metrics",
            identity,
            "Line metric order or aggregation class is not canonical",
        )
    expected_generation = history_index_generation_id(index)
    if index.get("collection_generation_id") != expected_generation:
        emit.err(
            "collection_generation_id",
            "collection_generation_id",
            index.get("collection_generation_id"),
            "Line collection generation does not match exact index semantics",
        )
    return emit.out


def check_line_history_directory(payload: object, *, rel_key: str) -> list[CheckResult]:
    """Validate the stable Lines entity directory and every child-generation edge."""

    emit = _Emitter("historic_line_history_directory", rel_key)
    directory = _as_dict(payload)
    if not isinstance(directory, dict):
        emit.err("contract", "", payload, "Lines directory must be an object")
        return emit.out
    try:
        HistoricEntityDirectoryIndex.model_validate(directory)
    except ValidationError as exc:
        _history_model_error(emit, exc)
    versioned_match = _LINE_HISTORY_VERSIONED_DIRECTORY_PATH_RE.fullmatch(rel_key)
    if rel_key != _LINE_HISTORY_DIRECTORY_PATH and versioned_match is None:
        emit.err("directory_path", "", rel_key, "Lines directory uses a malformed path")
    _check_versioned_pointer_digest(emit, payload, versioned_match)
    if directory.get("family") != "lines" or directory.get("selection_mode") != "range":
        emit.err(
            "directory_identity",
            "family",
            directory.get("family"),
            "Lines directory must identify the lines/range family",
        )
    try:
        normalized_generated = history_utc_timestamp(
            directory.get("generated_utc"), field="generated_utc"
        )
    except ValueError:
        normalized_generated = None
    if directory.get("generated_utc") != normalized_generated:
        emit.err(
            "generated_utc",
            "generated_utc",
            directory.get("generated_utc"),
            "Lines directory timestamp must be canonical UTC Z",
        )

    entities = directory.get("entities") if isinstance(directory.get("entities"), list) else []
    raw_ids = [item.get("entity_id") for item in entities if isinstance(item, dict)]
    encoded_ids = [item.get("encoded_id") for item in entities if isinstance(item, dict)]
    index_paths = [item.get("index_path") for item in entities if isinstance(item, dict)]
    string_raw_ids = [value for value in raw_ids if isinstance(value, str)]
    if len(string_raw_ids) != len(raw_ids) or raw_ids != sorted(string_raw_ids):
        emit.err("entity_order", "entities", raw_ids, "Lines directory entities are not sorted")
    if len(string_raw_ids) != len(set(string_raw_ids)):
        emit.err("duplicate_entity_id", "entities", raw_ids, "raw Line entity ID is repeated")
    string_encoded_ids = [value for value in encoded_ids if isinstance(value, str)]
    if len(string_encoded_ids) != len(set(string_encoded_ids)):
        emit.err(
            "duplicate_encoded_id",
            "entities",
            encoded_ids,
            "encoded Line entity ID is repeated",
        )
    string_index_paths = [value for value in index_paths if isinstance(value, str)]
    if len(string_index_paths) != len(set(string_index_paths)):
        emit.err("duplicate_index_path", "entities", index_paths, "Line index path is repeated")
    first_values: list[str] = []
    last_values: list[str] = []
    for position, item in enumerate(entities):
        if not isinstance(item, dict):
            continue
        entity_id = item.get("entity_id")
        try:
            expected_encoded = encode_history_entity_id(entity_id)
        except (AttributeError, TypeError, ValueError):
            expected_encoded = None
        legacy_path = (
            f"historic/history/lines/{expected_encoded}/index.json"
            if expected_encoded is not None
            else None
        )
        versioned_path = (
            re.fullmatch(
                rf"historic/history/lines/{expected_encoded}/generations/"
                r"[0-9a-f]{64}/index\.json",
                item.get("index_path"),
            )
            if expected_encoded is not None and isinstance(item.get("index_path"), str)
            else None
        )
        if item.get("encoded_id") != expected_encoded or (
            item.get("index_path") != legacy_path and versioned_path is None
        ):
            emit.err(
                "entity_identity",
                f"entities[{position}]",
                item,
                "Lines directory raw, encoded, and index-path identity disagree",
            )
        if not item.get("collection_generation_id"):
            emit.err(
                "entity_generation",
                f"entities[{position}].collection_generation_id",
                item.get("collection_generation_id"),
                "Lines directory child must pin a collection generation",
            )
        if isinstance(item.get("first_available_date"), str):
            first_values.append(item["first_available_date"])
        if isinstance(item.get("last_available_date"), str):
            last_values.append(item["last_available_date"])
    expected_coverage = (
        min(first_values) if first_values else None,
        max(last_values) if last_values else None,
    )
    if (
        directory.get("first_available_date"),
        directory.get("last_available_date"),
    ) != expected_coverage:
        emit.err(
            "directory_coverage",
            "first_available_date",
            directory.get("first_available_date"),
            "Lines directory coverage does not match its entity indexes",
        )
    expected_generation = history_entity_directory_generation_id(directory)
    if directory.get("collection_generation_id") != expected_generation:
        emit.err(
            "collection_generation_id",
            "collection_generation_id",
            directory.get("collection_generation_id"),
            "Lines directory generation does not match exact child edges",
        )
    return emit.out


_STOP_HISTORY_PARTITION_PATH_RE = re.compile(
    r"historic/history/stops/((?:[0-9a-f]{2})+)/generations/"
    r"([0-9a-f]{64})/(\d{4}-(?:0[1-9]|1[0-2]))\.json"
)
_STOP_HISTORY_ENTITY_INDEX_PATH_RE = re.compile(
    r"historic/history/stops/((?:[0-9a-f]{2})+)/index\.json"
)
_STOP_HISTORY_VERSIONED_ENTITY_INDEX_PATH_RE = re.compile(
    r"historic/history/stops/((?:[0-9a-f]{2})+)/generations/([0-9a-f]{64})/index\.json"
)
_STOP_HISTORY_DIRECTORY_PATH = "historic/history/stops/index.json"
_STOP_HISTORY_VERSIONED_DIRECTORY_PATH_RE = re.compile(
    r"historic/history/stops/generations/([0-9a-f]{64})/index\.json"
)
_STOP_HISTORY_ROOT_PATH = "historic/history/index.json"
_STOP_HISTORY_METRICS = (
    ("delay", "additive"),
    ("delay_percentiles", "daily_only"),
    ("occupancy", "additive"),
)


def check_stop_history_partition(payload: object, *, rel_key: str) -> list[CheckResult]:
    """Validate one content-addressed Stop month and its exact raw-ID path."""

    emit = _Emitter("historic_stop_history_partition", rel_key)
    partition = _as_dict(payload)
    if not isinstance(partition, dict):
        emit.err("contract", "", payload, "Stop history partition must be an object")
        return emit.out
    try:
        StopHistoryPartition.model_validate(partition)
    except ValidationError as exc:
        _history_model_error(emit, exc)

    match = _STOP_HISTORY_PARTITION_PATH_RE.fullmatch(rel_key)
    if match is None:
        emit.err("partition_path", "", rel_key, "malformed Stop history generation path")
        path_entity = path_sha = path_month = None
    else:
        encoded_id, path_sha, path_month = match.groups()
        try:
            path_entity = decode_history_entity_id(encoded_id)
        except ValueError:
            path_entity = None
            emit.err(
                "partition_entity",
                "entity_id",
                encoded_id,
                "Stop history path does not contain canonical UTF-8 identity",
            )
    if partition.get("entity_id") != path_entity:
        emit.err(
            "partition_entity",
            "entity_id",
            partition.get("entity_id"),
            "Stop partition entity_id does not match its encoded path",
        )
    if partition.get("month") != path_month:
        emit.err(
            "partition_month",
            "month",
            partition.get("month"),
            "Stop partition month does not match its path",
        )
    body = _serialized_body(payload)
    if body is not None and path_sha is not None and hashlib.sha256(body).hexdigest() != path_sha:
        emit.err(
            "partition_sha256",
            "",
            path_sha,
            "Stop generation path SHA does not match exact partition bytes",
        )
    if partition.get("methodology_version") != "history-1":
        emit.err(
            "partition_envelope",
            "methodology_version",
            partition.get("methodology_version"),
            "immutable Stop partition methodology_version must be history-1",
        )
    if partition.get("publish_generation_id") is not None:
        emit.err(
            "partition_envelope",
            "publish_generation_id",
            partition.get("publish_generation_id"),
            "immutable Stop partition cannot carry a run generation stamp",
        )
    try:
        normalized_generated = history_utc_timestamp(
            partition.get("generated_utc"), field="generated_utc"
        )
    except ValueError:
        normalized_generated = None
    if partition.get("generated_utc") != normalized_generated:
        emit.err(
            "partition_envelope",
            "generated_utc",
            partition.get("generated_utc"),
            "Stop partition timestamp must be canonical UTC Z",
        )
    days = partition.get("days") if isinstance(partition.get("days"), list) else []
    dates = [day.get("date") for day in days if isinstance(day, dict)]
    string_dates = [value for value in dates if isinstance(value, str)]
    if len(string_dates) != len(set(string_dates)):
        emit.err("duplicate_date", "days", dates, "Stop partition contains a duplicate date")
    if dates != sorted(string_dates):
        emit.err("date_order", "days", dates, "Stop partition dates must be ascending")
    for position, day in enumerate(days):
        if isinstance(day, dict):
            unexpected = sorted(set(day) - {"date", "delay", "delay_percentiles", "occupancy"})
            if unexpected:
                emit.err(
                    "stop_metric_vocabulary",
                    f"days[{position}]",
                    unexpected,
                    "Stop history day contains fabricated current-only or Line-only fields",
                )
            _check_network_history_day(emit, day, position)
            delay = day.get("delay")
            if isinstance(delay, dict):
                if delay.get("on_time_count") is not None:
                    emit.err(
                        "stop_delay_semantics",
                        f"days[{position}].delay.on_time_count",
                        delay.get("on_time_count"),
                        "Stop history cannot publish route-style OTP counts",
                    )
                if delay.get("in_clamp_observation_count") != delay.get("observation_count"):
                    emit.err(
                        "stop_delay_semantics",
                        f"days[{position}].delay.in_clamp_observation_count",
                        delay.get("in_clamp_observation_count"),
                        "Stop in-clamp denominator must equal its spine observation count",
                    )
    return emit.out


def check_stop_history_partition_ref(ref: object, partition: object) -> list[CheckResult]:
    """Cross-check one Stop ref against exact bytes and path identity."""

    ref_dict = _as_dict(ref)
    partition_dict = _as_dict(partition)
    path = ref_dict.get("path") if isinstance(ref_dict, dict) else None
    emit = _Emitter(
        "historic_stop_history_partition_ref",
        path if isinstance(path, str) else _STOP_HISTORY_DIRECTORY_PATH,
    )
    if not isinstance(ref_dict, dict) or not isinstance(partition_dict, dict):
        emit.err("contract", "ref", ref, "Stop ref and partition must be objects")
        return emit.out
    if not isinstance(path, str):
        emit.err("ref_path", "path", path, "Stop partition ref path must be a string")
        return emit.out
    match = _STOP_HISTORY_PARTITION_PATH_RE.fullmatch(path)
    if match is None:
        emit.err("ref_path", "path", path, "Stop partition ref path is malformed")
        path_entity = path_sha = path_month = None
    else:
        encoded_id, path_sha, path_month = match.groups()
        try:
            path_entity = decode_history_entity_id(encoded_id)
        except ValueError:
            path_entity = None
    if partition_dict.get("entity_id") != path_entity:
        emit.err(
            "ref_entity", "entity_id", partition_dict.get("entity_id"), "Stop ref entity mismatch"
        )
    if partition_dict.get("month") != path_month:
        emit.err("ref_month", "month", partition_dict.get("month"), "Stop ref month mismatch")
    body = _serialized_body(partition)
    if body is not None:
        digest = hashlib.sha256(body).hexdigest()
        if ref_dict.get("sha256") != digest:
            emit.err("ref_sha256", "sha256", ref_dict.get("sha256"), "ref SHA mismatches bytes")
        if ref_dict.get("byte_size") != len(body):
            emit.err(
                "ref_byte_size", "byte_size", ref_dict.get("byte_size"), "ref size mismatches bytes"
            )
        if path_sha is not None and ref_dict.get("sha256") != path_sha:
            emit.err("ref_path", "sha256", ref_dict.get("sha256"), "Stop ref SHA mismatches path")
    days = partition_dict.get("days") if isinstance(partition_dict.get("days"), list) else []
    dates = [day.get("date") for day in days if isinstance(day, dict)]
    if ref_dict.get("count") != len(days):
        emit.err("ref_count", "count", ref_dict.get("count"), "Stop ref count mismatches partition")
    if len(dates) != len(days) or (
        dates
        and (ref_dict.get("coverage_start"), ref_dict.get("coverage_end")) != (dates[0], dates[-1])
    ):
        emit.err("ref_coverage", "coverage_start", None, "Stop ref coverage mismatches partition")
    return emit.out


@dataclass
class _StopEntityStream:
    partition_ref_digest: bytes = b""
    partition_count: int = 0
    available_dates: HistoryDateMask = field(default_factory=HistoryDateMask)
    metric_dates: dict[str, HistoryDateMask] = field(
        default_factory=lambda: {
            metric: HistoryDateMask() for metric, _aggregation in _STOP_HISTORY_METRICS
        }
    )
    generated_utc: str | None = None


@dataclass
class StopHistoryStreamSummary:
    """Independent compact truth retained while Stop months stream."""

    entities: dict[str, _StopEntityStream] = field(default_factory=dict)

    def observe(self, ref: object, partition: object) -> None:
        value = _as_dict(partition)
        if not isinstance(value, dict) or not isinstance(value.get("entity_id"), str):
            return
        summary = self.entities.setdefault(value["entity_id"], _StopEntityStream())
        try:
            retained_ref = HistoricPartitionRef.model_validate(_coverage_dict(ref))
        except (TypeError, ValidationError):
            pass
        else:
            ref_digest = hashlib.sha256(snapshot_json_bytes(retained_ref)).digest()
            summary.partition_ref_digest = hashlib.sha256(
                summary.partition_ref_digest + ref_digest
            ).digest()
            summary.partition_count += 1
        if isinstance(value.get("generated_utc"), str):
            try:
                summary.generated_utc = latest_history_timestamp(
                    candidate
                    for candidate in (summary.generated_utc, value["generated_utc"])
                    if candidate is not None
                )
            except ValueError:
                pass
        days = value.get("days") if isinstance(value.get("days"), list) else []
        for day in days:
            if not isinstance(day, dict) or not isinstance(day.get("date"), str):
                continue
            try:
                summary.available_dates.add(day["date"])
            except ValueError:
                continue
            for metric in summary.metric_dates:
                if day.get(metric) is not None:
                    summary.metric_dates[metric].add(day["date"])


def _expected_stop_index(
    entity_id: str,
    summary: _StopEntityStream,
    *,
    fallback_generated_utc: str,
) -> dict:  # type: ignore[type-arg]
    dates = list(summary.available_dates)
    first, last, gaps = history_coverage(summary.available_dates)
    value = {
        "generated_utc": latest_history_timestamp(
            (() if summary.generated_utc is None else (summary.generated_utc,)),
            fallback=fallback_generated_utc,
        ),
        "family": "stops",
        "selection_mode": "range",
        "entity_id": entity_id,
        "first_available_date": first,
        "last_available_date": last,
        "available_dates": dates,
        "gaps": _coverage_dict(gaps),
        "metrics": _coverage_dict(
            [
                history_metric_coverage(metric, aggregation, summary.metric_dates[metric])
                for metric, aggregation in _STOP_HISTORY_METRICS
            ]
        ),
    }
    return value


def _stop_partition_ref_sequence(payload: object) -> tuple[bytes, int, bool]:
    refs = payload if isinstance(payload, list) else []
    malformed = not isinstance(payload, list)
    digest = b""
    count = 0
    for ref in refs:
        try:
            value = HistoricPartitionRef.model_validate(_coverage_dict(ref))
        except (TypeError, ValidationError):
            malformed = True
            continue
        ref_digest = hashlib.sha256(snapshot_json_bytes(value)).digest()
        digest = hashlib.sha256(digest + ref_digest).digest()
        count += 1
    return digest, count, malformed


def check_stop_history_stream_index(
    payload: object,
    summary: StopHistoryStreamSummary,
    *,
    fallback_generated_utc: str,
) -> list[CheckResult]:
    value = _as_dict(payload)
    entity_id = value.get("entity_id") if isinstance(value, dict) else None
    rel_key = (
        f"historic/history/stops/{encode_history_entity_id(entity_id)}/index.json"
        if isinstance(entity_id, str) and entity_id
        else _STOP_HISTORY_DIRECTORY_PATH
    )
    emit = _Emitter("historic_stop_history_stream", rel_key)
    if not isinstance(value, dict) or not isinstance(entity_id, str):
        emit.err("stop_stream_indexes", "index", payload, "Stop index must be an object")
        return emit.out
    expected_summary = summary.entities.get(entity_id)
    if expected_summary is None:
        emit.err(
            "stop_stream_indexes",
            "entity_id",
            entity_id,
            "Stop index has no streamed partition truth",
        )
        return emit.out
    expected = _expected_stop_index(
        entity_id,
        expected_summary,
        fallback_generated_utc=fallback_generated_utc,
    )
    fields = (
        "generated_utc",
        "family",
        "selection_mode",
        "entity_id",
        "first_available_date",
        "last_available_date",
        "available_dates",
        "gaps",
        "metrics",
    )
    actual_ref_digest, actual_ref_count, malformed_refs = _stop_partition_ref_sequence(
        value.get("partitions")
    )
    if (
        {field: _coverage_dict(value.get(field)) for field in fields}
        != {field: _coverage_dict(expected.get(field)) for field in fields}
        or malformed_refs
        or actual_ref_count != expected_summary.partition_count
        or actual_ref_digest != expected_summary.partition_ref_digest
        or value.get("collection_generation_id") != history_index_generation_id(value)
    ):
        emit.err(
            "stop_stream_indexes",
            f"indexes[{entity_id}]",
            value,
            "Stop entity index does not match its streamed partitions",
        )
    return emit.out


def check_stop_history_stream_indexes(
    payloads: object,
    summary: StopHistoryStreamSummary,
    *,
    fallback_generated_utc: str,
) -> list[CheckResult]:
    emit = _Emitter("historic_stop_history_stream", _STOP_HISTORY_DIRECTORY_PATH)
    if not isinstance(payloads, list):
        emit.err("stop_stream_indexes", "indexes", payloads, "Stop indexes must be a list")
        return emit.out
    actual_by_entity: dict[str, dict] = {}  # type: ignore[type-arg]
    for payload in payloads:
        value = _as_dict(payload)
        if isinstance(value, dict) and isinstance(value.get("entity_id"), str):
            if value["entity_id"] in actual_by_entity:
                emit.err(
                    "stop_stream_indexes", "indexes", value["entity_id"], "duplicate Stop index"
                )
            actual_by_entity[value["entity_id"]] = value
    expected_entities = sorted(summary.entities)
    if sorted(actual_by_entity) != expected_entities:
        emit.err(
            "stop_stream_indexes",
            "indexes",
            sorted(actual_by_entity),
            "Stop index entities do not exactly match streamed partitions",
        )
    for entity_id in expected_entities:
        actual = actual_by_entity.get(entity_id)
        if actual is None:
            continue
        emit.out.extend(
            check_stop_history_stream_index(
                actual,
                summary,
                fallback_generated_utc=fallback_generated_utc,
            )
        )
    return emit.out


@dataclass
class StopHistoryDirectorySummary:
    entities: list[HistoricEntityIndexRef] = field(default_factory=list)
    available_dates: HistoryDateMask = field(default_factory=HistoryDateMask)
    metric_dates: dict[str, HistoryDateMask] = field(
        default_factory=lambda: {
            metric: HistoryDateMask() for metric, _aggregation in _STOP_HISTORY_METRICS
        }
    )
    generated_utc: str | None = None

    def observe(self, payload: object, *, index_path: str | None = None) -> None:
        value = _as_dict(payload)
        if not isinstance(value, dict) or not isinstance(value.get("entity_id"), str):
            return
        entity_id = value["entity_id"]
        try:
            encoded_id = encode_history_entity_id(entity_id)
            entity = HistoricEntityIndexRef(
                entity_id=entity_id,
                encoded_id=encoded_id,
                index_path=index_path or f"historic/history/stops/{encoded_id}/index.json",
                collection_generation_id=str(value.get("collection_generation_id") or ""),
                first_available_date=value.get("first_available_date"),
                last_available_date=value.get("last_available_date"),
            )
        except (TypeError, ValueError, ValidationError):
            return
        self.entities.append(entity)
        available = value.get("available_dates")
        valid_dates = (
            [item for item in available if isinstance(item, str)]
            if isinstance(available, list)
            else []
        )
        for local_date in valid_dates:
            try:
                self.available_dates.add(local_date)
            except ValueError:
                continue
        metrics = value.get("metrics") if isinstance(value.get("metrics"), list) else []
        for coverage in metrics:
            if not isinstance(coverage, dict) or coverage.get("metric") not in self.metric_dates:
                continue
            first = coverage.get("first_available_date")
            last = coverage.get("last_available_date")
            gaps = coverage.get("gaps") if isinstance(coverage.get("gaps"), list) else []
            for local_date in valid_dates:
                if not isinstance(first, str) or not isinstance(last, str):
                    continue
                if not first <= local_date <= last:
                    continue
                malformed_gap = False
                inside_gap = False
                for gap in gaps:
                    if not isinstance(gap, dict):
                        malformed_gap = True
                        continue
                    start = gap.get("start_date")
                    end = gap.get("end_date")
                    if not isinstance(start, str) or not isinstance(end, str):
                        malformed_gap = True
                        continue
                    inside_gap = inside_gap or start <= local_date <= end
                if not malformed_gap and not inside_gap:
                    self.metric_dates[coverage["metric"]].add(local_date)
        if isinstance(value.get("generated_utc"), str):
            try:
                self.generated_utc = latest_history_timestamp(
                    candidate
                    for candidate in (self.generated_utc, value["generated_utc"])
                    if candidate is not None
                )
            except ValueError:
                pass

    @classmethod
    def from_indexes(
        cls,
        indexes: list[object],
        *,
        index_paths: dict[str, str] | None = None,
    ) -> StopHistoryDirectorySummary:
        summary = cls()
        for payload in indexes:
            value = _as_dict(payload)
            entity_id = value.get("entity_id") if isinstance(value, dict) else None
            summary.observe(
                payload,
                index_path=(index_paths or {}).get(entity_id)
                if isinstance(entity_id, str)
                else None,
            )
        summary.entities.sort(key=lambda item: item.entity_id)
        return summary

    def family_dict(
        self,
        directory: object,
        *,
        index_path: str = "historic/history/stops/index.json",
    ) -> dict:  # type: ignore[type-arg]
        directory_dict = _as_dict(directory)
        first, last, gaps = history_coverage(self.available_dates)
        return {
            "family": "stops",
            "selection_mode": "range",
            "index_path": index_path,
            "collection_generation_id": (
                directory_dict.get("collection_generation_id")
                if isinstance(directory_dict, dict)
                else None
            ),
            "first_available_date": first,
            "last_available_date": last,
            "gaps": _coverage_dict(gaps),
            "metrics": _coverage_dict(
                [
                    history_metric_coverage(metric, aggregation, self.metric_dates[metric])
                    for metric, aggregation in _STOP_HISTORY_METRICS
                ]
            ),
        }


def check_stop_history_stream_entities(
    actual: StopHistoryDirectorySummary,
    expected: StopHistoryStreamSummary,
) -> list[CheckResult]:
    emit = _Emitter("historic_stop_history_stream", _STOP_HISTORY_DIRECTORY_PATH)
    actual_ids = [entity.entity_id for entity in actual.entities]
    expected_ids = sorted(expected.entities)
    if actual_ids != expected_ids:
        emit.err(
            "stop_stream_indexes",
            "indexes",
            actual_ids,
            "Stop index entities do not exactly match streamed partitions",
        )
    return emit.out


def check_stop_history_stream_directory(
    payload: object,
    summary: StopHistoryDirectorySummary,
    *,
    fallback_generated_utc: str,
) -> list[CheckResult]:
    emit = _Emitter("historic_stop_history_stream", _STOP_HISTORY_DIRECTORY_PATH)
    directory = _as_dict(payload)
    if not isinstance(directory, dict):
        emit.err("stop_stream_directory", "directory", payload, "Stops directory must be an object")
        return emit.out
    first, last, _gaps = history_coverage(summary.available_dates)
    expected = {
        "generated_utc": latest_history_timestamp(
            (() if summary.generated_utc is None else (summary.generated_utc,)),
            fallback=fallback_generated_utc,
        ),
        "family": "stops",
        "selection_mode": "range",
        "first_available_date": first,
        "last_available_date": last,
        "entities": _coverage_dict(summary.entities),
    }
    expected["collection_generation_id"] = history_entity_directory_generation_id(expected)
    fields = (
        "generated_utc",
        "family",
        "selection_mode",
        "collection_generation_id",
        "first_available_date",
        "last_available_date",
        "entities",
    )
    if {field: _coverage_dict(directory.get(field)) for field in fields} != expected:
        emit.err(
            "stop_stream_directory",
            "entities",
            directory,
            "Stops directory does not match the gated entity indexes",
        )
    return emit.out


def check_stop_history_index(payload: object, *, rel_key: str) -> list[CheckResult]:
    emit = _Emitter("historic_stop_history_index", rel_key)
    index = _as_dict(payload)
    if not isinstance(index, dict):
        emit.err("contract", "", payload, "Stop history index must be an object")
        return emit.out
    try:
        HistoricCollectionIndex.model_validate(index)
    except ValidationError as exc:
        _history_model_error(emit, exc)
    match = _STOP_HISTORY_ENTITY_INDEX_PATH_RE.fullmatch(rel_key)
    versioned_match = _STOP_HISTORY_VERSIONED_ENTITY_INDEX_PATH_RE.fullmatch(rel_key)
    try:
        path_entity = (
            decode_history_entity_id((match or versioned_match).group(1))
            if (match or versioned_match)
            else None
        )
    except ValueError:
        path_entity = None
    _check_versioned_pointer_digest(emit, payload, versioned_match, group=2)
    if (
        index.get("family") != "stops"
        or index.get("selection_mode") != "range"
        or index.get("entity_id") != path_entity
    ):
        emit.err(
            "index_identity",
            "entity_id",
            index.get("entity_id"),
            "Stop index identity/path mismatch",
        )
    dates = index.get("available_dates") if isinstance(index.get("available_dates"), list) else []
    refs = index.get("partitions") if isinstance(index.get("partitions"), list) else []
    if not dates or not refs:
        emit.err("empty_entity", "partitions", refs, "a Stop entity index cannot be empty")
    try:
        first, last, gaps = history_coverage(dates)
    except ValueError:
        emit.err("available_dates", "available_dates", dates, "Stop dates are malformed")
    else:
        if dates != sorted(set(dates)) or (
            index.get("first_available_date"),
            index.get("last_available_date"),
            _coverage_dict(index.get("gaps") or []),
        ) != (first, last, _coverage_dict(gaps)):
            emit.err("available_dates", "available_dates", dates, "Stop coverage is not canonical")
    months: list[str] = []
    paths: list[str] = []
    encoded_id = (match or versioned_match).group(1) if (match or versioned_match) else None
    for position, ref in enumerate(refs):
        if not isinstance(ref, dict):
            continue
        path = str(ref.get("path") or "")
        paths.append(path)
        ref_match = _STOP_HISTORY_PARTITION_PATH_RE.fullmatch(path)
        if ref_match is None:
            emit.err("ref_path", f"partitions[{position}].path", path, "Stop ref path is malformed")
            continue
        ref_encoded, path_sha, month = ref_match.groups()
        months.append(month)
        if ref_encoded != encoded_id:
            emit.err(
                "ref_entity",
                f"partitions[{position}].path",
                path,
                "Stop ref belongs to another entity",
            )
        if ref.get("sha256") != path_sha:
            emit.err(
                "ref_path",
                f"partitions[{position}].sha256",
                ref.get("sha256"),
                "Stop ref SHA/path mismatch",
            )
    if len(paths) != len(set(paths)) or len(months) != len(set(months)) or months != sorted(months):
        emit.err(
            "partition_order", "partitions", paths, "Stop refs must be unique and month-sorted"
        )
    metrics = index.get("metrics") if isinstance(index.get("metrics"), list) else []
    identity = [
        (metric.get("metric"), metric.get("aggregation"))
        for metric in metrics
        if isinstance(metric, dict)
    ]
    if identity != list(_STOP_HISTORY_METRICS):
        emit.err(
            "metric_vocabulary", "metrics", identity, "Stop metric vocabulary is not canonical"
        )
    if index.get("collection_generation_id") != history_index_generation_id(index):
        emit.err(
            "collection_generation_id",
            "collection_generation_id",
            index.get("collection_generation_id"),
            "Stop generation mismatches exact semantics",
        )
    return emit.out


def check_stop_history_directory(payload: object, *, rel_key: str) -> list[CheckResult]:
    emit = _Emitter("historic_stop_history_directory", rel_key)
    directory = _as_dict(payload)
    if not isinstance(directory, dict):
        emit.err("contract", "", payload, "Stops directory must be an object")
        return emit.out
    try:
        HistoricEntityDirectoryIndex.model_validate(directory)
    except ValidationError as exc:
        _history_model_error(emit, exc)
    versioned_match = _STOP_HISTORY_VERSIONED_DIRECTORY_PATH_RE.fullmatch(rel_key)
    if rel_key != _STOP_HISTORY_DIRECTORY_PATH and versioned_match is None:
        emit.err("directory_path", "", rel_key, "Stops directory uses a malformed path")
    _check_versioned_pointer_digest(emit, payload, versioned_match)
    if directory.get("family") != "stops" or directory.get("selection_mode") != "range":
        emit.err(
            "directory_identity",
            "family",
            directory.get("family"),
            "Stops directory identity is wrong",
        )
    entities = directory.get("entities") if isinstance(directory.get("entities"), list) else []
    raw_ids = [item.get("entity_id") for item in entities if isinstance(item, dict)]
    string_ids = [value for value in raw_ids if isinstance(value, str)]
    if (
        len(string_ids) != len(raw_ids)
        or raw_ids != sorted(string_ids)
        or len(string_ids) != len(set(string_ids))
    ):
        emit.err(
            "entity_order", "entities", raw_ids, "Stop directory IDs must be unique and sorted"
        )
    first_values: list[str] = []
    last_values: list[str] = []
    for position, item in enumerate(entities):
        if not isinstance(item, dict):
            continue
        entity_id = item.get("entity_id")
        if isinstance(entity_id, str):
            try:
                encoded = encode_history_entity_id(entity_id)
            except ValueError:
                encoded = None
        else:
            encoded = None
        legacy_path = f"historic/history/stops/{encoded}/index.json" if encoded else None
        versioned_path = (
            re.fullmatch(
                rf"historic/history/stops/{encoded}/generations/"
                r"[0-9a-f]{64}/index\.json",
                item.get("index_path"),
            )
            if encoded and isinstance(item.get("index_path"), str)
            else None
        )
        if item.get("encoded_id") != encoded or (
            item.get("index_path") != legacy_path and versioned_path is None
        ):
            emit.err(
                "entity_identity",
                f"entities[{position}]",
                item,
                "Stop raw/encoded/path identity disagrees",
            )
        if not item.get("collection_generation_id"):
            emit.err(
                "entity_generation",
                f"entities[{position}]",
                item,
                "Stop child generation is required",
            )
        if isinstance(item.get("first_available_date"), str):
            first_values.append(item["first_available_date"])
        if isinstance(item.get("last_available_date"), str):
            last_values.append(item["last_available_date"])
    if (directory.get("first_available_date"), directory.get("last_available_date")) != (
        min(first_values) if first_values else None,
        max(last_values) if last_values else None,
    ):
        emit.err(
            "directory_coverage",
            "first_available_date",
            None,
            "Stop directory coverage mismatches children",
        )
    if directory.get("collection_generation_id") != history_entity_directory_generation_id(
        directory
    ):
        emit.err(
            "collection_generation_id",
            "collection_generation_id",
            directory.get("collection_generation_id"),
            "Stop directory generation mismatches child edges",
        )
    return emit.out


def check_history_availability_index(payload: object, *, rel_key: str) -> list[CheckResult]:
    """Validate the exact stable five-family retained-history discovery root."""

    emit = _Emitter("historic_availability_index", rel_key)
    root = _as_dict(payload)
    if not isinstance(root, dict):
        emit.err("contract", "", payload, "history availability root must be an object")
        return emit.out
    try:
        HistoricAvailabilityIndex.model_validate(root)
    except ValidationError as exc:
        _history_model_error(emit, exc)
    if rel_key != _STOP_HISTORY_ROOT_PATH:
        emit.err("root_path", "", rel_key, "history availability root uses the wrong path")
    families = root.get("families") if isinstance(root.get("families"), list) else []
    names = [item.get("family") for item in families if isinstance(item, dict)]
    expected_names = ["alerts", "lines", "network", "receipts", "stops"]
    if names != expected_names:
        emit.err("family_order", "families", names, "history families must be exact and sorted")
    expected_paths = {
        "alerts": "historic/alerts/index.json",
        "lines": "historic/history/lines/index.json",
        "network": "historic/history/network/index.json",
        "receipts": "historic/receipts/index.json",
        "stops": "historic/history/stops/index.json",
    }
    versioned_paths = {
        "alerts": re.compile(r"historic/alerts/generations/[0-9a-f]{64}/index\.json"),
        "lines": re.compile(r"historic/history/lines/generations/[0-9a-f]{64}/index\.json"),
        "network": re.compile(r"historic/history/network/generations/[0-9a-f]{64}/index\.json"),
        "receipts": re.compile(r"historic/receipts/generations/[0-9a-f]{64}/index\.json"),
        "stops": re.compile(r"historic/history/stops/generations/[0-9a-f]{64}/index\.json"),
    }
    for position, item in enumerate(families):
        if not isinstance(item, dict):
            continue
        family = item.get("family")
        expected_path = expected_paths.get(family) if isinstance(family, str) else None
        index_path = item.get("index_path")
        versioned = versioned_paths.get(family) if isinstance(family, str) else None
        if (
            not isinstance(family, str)
            or not isinstance(index_path, str)
            or (
                index_path != expected_path
                and (versioned is None or not versioned.fullmatch(index_path))
            )
        ):
            emit.err(
                "family_path",
                f"families[{position}].index_path",
                item.get("index_path"),
                "family path is wrong",
            )
        if not item.get("collection_generation_id"):
            emit.err(
                "family_generation",
                f"families[{position}].collection_generation_id",
                None,
                "family generation is required",
            )
    return emit.out


def _history_family_from_entity_children(
    *,
    family: str,
    directory: object,
    indexes: list[object],
    metrics: tuple[tuple[str, str], ...],
    index_path: str | None = None,
) -> tuple[dict, bool]:  # type: ignore[type-arg]
    directory_dict = _as_dict(directory)
    index_dicts = [value for item in indexes if isinstance((value := _as_dict(item)), dict)]
    malformed = False
    date_values: set[str] = set()
    for index in index_dicts:
        available = index.get("available_dates")
        if not isinstance(available, list):
            malformed = True
            continue
        for local_date in available:
            if not isinstance(local_date, str):
                malformed = True
                continue
            try:
                if date.fromisoformat(local_date).isoformat() != local_date:
                    raise ValueError
            except ValueError:
                malformed = True
                continue
            date_values.add(local_date)
    dates = sorted(date_values)
    first, last, gaps = history_coverage(dates)
    metric_dates: dict[str, list[str]] = {name: [] for name, _aggregation in metrics}
    for index in index_dicts:
        available = (
            index.get("available_dates") if isinstance(index.get("available_dates"), list) else []
        )
        coverages = index.get("metrics") if isinstance(index.get("metrics"), list) else []
        for coverage in coverages:
            if not isinstance(coverage, dict) or coverage.get("metric") not in metric_dates:
                malformed = True
                continue
            metric_name = coverage["metric"]
            coverage_gaps = coverage.get("gaps") if isinstance(coverage.get("gaps"), list) else []
            coverage_first = coverage.get("first_available_date")
            coverage_last = coverage.get("last_available_date")
            if coverage_first is None and coverage_last is None:
                continue
            if not isinstance(coverage_first, str) or not isinstance(coverage_last, str):
                malformed = True
                continue
            valid_gaps: list[tuple[str, str]] = []
            for gap in coverage_gaps:
                if not isinstance(gap, dict):
                    malformed = True
                    continue
                start = gap.get("start_date")
                end = gap.get("end_date")
                if not isinstance(start, str) or not isinstance(end, str):
                    malformed = True
                    continue
                valid_gaps.append((start, end))
            metric_dates[metric_name].extend(
                local_date
                for local_date in available
                if isinstance(local_date, str)
                and coverage_first <= local_date <= coverage_last
                and not any(start <= local_date <= end for start, end in valid_gaps)
            )
    return (
        {
            "family": family,
            "selection_mode": "range",
            "index_path": index_path or f"historic/history/{family}/index.json",
            "collection_generation_id": (
                directory_dict.get("collection_generation_id")
                if isinstance(directory_dict, dict)
                else None
            ),
            "first_available_date": first,
            "last_available_date": last,
            "gaps": _coverage_dict(gaps),
            "metrics": _coverage_dict(
                [
                    history_metric_coverage(name, aggregation, metric_dates[name])
                    for name, aggregation in metrics
                ]
            ),
        },
        malformed,
    )


def _history_graph_dates(value: object) -> tuple[list[str], bool]:
    if not isinstance(value, list):
        return [], True
    dates: set[str] = set()
    malformed = False
    for candidate in value:
        if not isinstance(candidate, str):
            malformed = True
            continue
        try:
            dates.add(history_date(candidate, field="date"))
        except ValueError:
            malformed = True
    return sorted(dates), malformed


def _append_history_graph_timestamp(values: list[str], value: object) -> bool:
    try:
        values.append(history_utc_timestamp(value, field="generated_utc"))
    except ValueError:
        return False
    return True


def check_history_availability_graph(
    payload: object,
    *,
    alert_index: object,
    receipts_index: object,
    network_index: object,
    line_directory: object,
    line_indexes: list[object],
    stop_directory: object,
    fallback_generated_utc: str,
    stop_indexes: list[object] | None = None,
    stop_summary: StopHistoryDirectorySummary | None = None,
    alert_index_path: str = "historic/alerts/index.json",
    receipt_index_path: str = "historic/receipts/index.json",
    network_index_path: str = "historic/history/network/index.json",
    line_directory_path: str = "historic/history/lines/index.json",
    stop_directory_path: str = "historic/history/stops/index.json",
) -> list[CheckResult]:
    """Reconcile the root against detached exact child indexes in this build."""

    emit = _Emitter("historic_availability_graph", _STOP_HISTORY_ROOT_PATH)
    root = _as_dict(payload)
    alerts = _as_dict(alert_index)
    receipts = _as_dict(receipts_index)
    network = _as_dict(network_index)
    if not all(isinstance(value, dict) for value in (root, alerts, receipts, network)):
        emit.err(
            "history_root_graph",
            "families",
            payload,
            "root and all singleton child indexes must be objects",
        )
        return emit.out
    receipt_dates, malformed_graph = _history_graph_dates(receipts.get("dates"))
    receipt_first, receipt_last, receipt_gaps = history_coverage(receipt_dates)
    line_family, line_malformed = _history_family_from_entity_children(
        family="lines",
        directory=line_directory,
        indexes=line_indexes,
        metrics=_LINE_HISTORY_METRICS,
        index_path=line_directory_path,
    )
    if stop_summary is None:
        stop_family, stop_malformed = _history_family_from_entity_children(
            family="stops",
            directory=stop_directory,
            indexes=stop_indexes or [],
            metrics=_STOP_HISTORY_METRICS,
            index_path=stop_directory_path,
        )
    else:
        stop_family = stop_summary.family_dict(stop_directory, index_path=stop_directory_path)
        stop_malformed = False
    malformed_graph = malformed_graph or line_malformed or stop_malformed
    expected_families = [
        {
            "family": "alerts",
            "selection_mode": "range",
            "index_path": alert_index_path,
            "collection_generation_id": alerts.get("collection_generation_id"),
            "first_available_date": alerts.get("first_available_date"),
            "last_available_date": alerts.get("last_available_date"),
            "gaps": [],
            "metrics": [],
        },
        line_family,
        {
            "family": "network",
            "selection_mode": "range",
            "index_path": network_index_path,
            "collection_generation_id": network.get("collection_generation_id"),
            "first_available_date": network.get("first_available_date"),
            "last_available_date": network.get("last_available_date"),
            "gaps": _coverage_dict(network.get("gaps") or []),
            "metrics": _coverage_dict(network.get("metrics") or []),
        },
        {
            "family": "receipts",
            "selection_mode": "date",
            "index_path": receipt_index_path,
            "collection_generation_id": receipts.get("collection_generation_id"),
            "first_available_date": receipt_first,
            "last_available_date": receipt_last,
            "gaps": _coverage_dict(receipt_gaps),
            "metrics": [],
        },
        stop_family,
    ]
    populated_timestamps: list[str] = []
    if alerts.get("first_available_date") is not None:
        malformed_graph = (
            not _append_history_graph_timestamp(
                populated_timestamps,
                alerts.get("generated_utc"),
            )
            or malformed_graph
        )
    if receipt_dates:
        malformed_graph = (
            not _append_history_graph_timestamp(
                populated_timestamps,
                receipts.get("generated_utc"),
            )
            or malformed_graph
        )
    if network.get("available_dates"):
        malformed_graph = (
            not _append_history_graph_timestamp(
                populated_timestamps,
                network.get("generated_utc"),
            )
            or malformed_graph
        )
    for child in [*line_indexes, *(stop_indexes or [])]:
        value = _as_dict(child)
        if isinstance(value, dict):
            malformed_graph = (
                not _append_history_graph_timestamp(
                    populated_timestamps,
                    value.get("generated_utc"),
                )
                or malformed_graph
            )
    if stop_summary is not None and stop_summary.generated_utc is not None:
        malformed_graph = (
            not _append_history_graph_timestamp(
                populated_timestamps,
                stop_summary.generated_utc,
            )
            or malformed_graph
        )
    expected = {
        "generated_utc": latest_history_timestamp(
            populated_timestamps,
            fallback=fallback_generated_utc,
        ),
        "families": expected_families,
    }
    actual = {
        "generated_utc": root.get("generated_utc"),
        "families": _coverage_dict(root.get("families") or []),
    }
    if actual != expected:
        emit.err(
            "history_root_graph",
            "families",
            actual,
            "history root does not exactly match detached child generations and coverage",
        )
    elif malformed_graph:
        emit.err(
            "history_root_graph",
            "families",
            actual,
            "history child graph contains malformed dates, gaps, metrics, or timestamps",
        )
    return emit.out


def check_receipt(payload: object, *, rel_key: str) -> list[CheckResult]:
    emit = _Emitter("historic_receipt", rel_key)
    d = _as_dict(payload)
    if not isinstance(d, dict):
        return emit.out
    emit.rate(d, "otp_pct")
    emit.delay(d, "avg_delay_min")
    emit.rate(d, "severe_pct")
    for f in ("vehicles", "affected_routes", "affected_stops", "alerts"):
        emit.count(d, f)
    wr = d.get("worst_route")
    if isinstance(wr, dict):
        _prefixed(emit, "worst_route.").rate(wr, "otp_delta_pts", -100, 100)
    ws = d.get("worst_stop")
    if isinstance(ws, dict):
        _prefixed(emit, "worst_stop.").delay(ws, "avg_delay_min")
    # S13 time-of-day cuts: rate/delay/count guards per shift (honest-NULL None-skips).
    for i, sc in enumerate(d.get("by_shift") or []):
        if not isinstance(sc, dict):
            continue
        sub = _prefixed(emit, f"by_shift[{i}].")
        sub.count(sc, "observation_count")
        sub.count(sc, "severe_count")
        sub.rate(sc, "severe_pct")
        sub.delay(sc, "avg_delay_min")
    # S13 service-state cut: count/rate guards + per not-reported-route count + the
    # sentinel invariant (a not-reported route id must NEVER be a phantom sentinel).
    ss = d.get("service_states")
    if isinstance(ss, dict):
        sub = _prefixed(emit, "service_states.")
        for f in (
            "scheduled_trip_days",
            "delivered_trip_days",
            "cancelled_trip_days",
            "silent_trip_days",
            "not_reported_route_count",
        ):
            sub.count(ss, f)
        sub.rate(ss, "service_completeness_pct")
        for i, nr in enumerate(ss.get("not_reported_routes") or []):
            if not isinstance(nr, dict):
                continue
            nsub = _prefixed(emit, f"service_states.not_reported_routes[{i}].")
            if nr.get("id") in _SENTINEL_ENTITY_IDS:
                nsub.err(
                    "sentinel_entity",
                    "id",
                    nr.get("id"),
                    f"id={nr.get('id')!r} is a sentinel entity",
                )
            nsub.count(nr, "scheduled_trip_days")
    return emit.out


def check_receipts_index(payload: object, *, rel_key: str) -> list[CheckResult]:
    # S13: sanity-check the additive availability metadata. available[].date must be a
    # SUBSET of dates (never advertise availability for an unpublished date) and has_data
    # / has_schedule must be real bools (honest, not a coerced truthy string).
    emit = _Emitter("historic_receipts_index", rel_key)
    d = _as_dict(payload)
    if not isinstance(d, dict):
        return emit.out
    raw_dates = d.get("dates") or []
    date_list = raw_dates if isinstance(raw_dates, list) else []
    string_dates = [value for value in date_list if isinstance(value, str)]

    for index, value in enumerate(date_list):
        try:
            valid = isinstance(value, str) and date.fromisoformat(value).isoformat() == value
        except ValueError:
            valid = False
        if not valid:
            emit.err(
                "date_format",
                f"dates[{index}]",
                value,
                f"receipt index date {value!r} is not a valid ISO calendar date",
            )
    if date_list != sorted(string_dates):
        emit.err(
            "date_order",
            "dates",
            date_list,
            "receipt index dates must be ascending",
        )
    if len(string_dates) != len(set(string_dates)):
        emit.err(
            "date_duplicate",
            "dates",
            date_list,
            "receipt index dates must be unique",
        )
    dates = set(string_dates)
    for i, a in enumerate(d.get("available") or []):
        if not isinstance(a, dict):
            continue
        sub = _prefixed(emit, f"available[{i}].")
        if a.get("date") not in dates:
            sub.err(
                "availability_orphan",
                "date",
                a.get("date"),
                f"available date={a.get('date')!r} not in dates[]",
            )
        for f in ("has_data", "has_schedule"):
            if not isinstance(a.get(f), bool):
                sub.err("not_bool", f, a.get(f), f"{f}={a.get(f)!r} is not a bool")
    _check_versioned_pointer_digest(
        emit,
        payload,
        re.fullmatch(r"historic/receipts/generations/([0-9a-f]{64})/index\.json", rel_key),
    )
    return emit.out


def check_receipts_collection(index: object, receipt_items: object) -> list[CheckResult]:
    """Reconcile the Receipt pointer against exact stamped child semantics."""

    emit = _Emitter("historic_receipts_collection", "historic/receipts/index.json")
    index_dict = _as_dict(index)
    if not isinstance(index_dict, dict) or not isinstance(receipt_items, list):
        emit.err(
            "receipt_collection",
            "collection",
            receipt_items,
            "Receipt index and child collection must be structured objects",
        )
        return emit.out
    canonical: list[dict[str, object]] = []
    child_dates: list[str] = []
    malformed = False
    for position, item in enumerate(receipt_items):
        if not isinstance(item, tuple) or len(item) < 2:
            malformed = True
            continue
        rel_key, payload = item[:2]
        match = re.fullmatch(r"historic/receipts/(\d{4}-\d{2}-\d{2})\.json", str(rel_key))
        value = _coverage_dict(payload)
        if match is None or not isinstance(value, dict):
            malformed = True
            continue
        path_date = match.group(1)
        payload_date = value.get("date")
        if payload_date != path_date:
            emit.err(
                "receipt_collection",
                f"receipts[{position}].date",
                payload_date,
                "Receipt payload date does not match its path",
            )
            malformed = True
            continue
        semantic_payload = dict(value)
        semantic_payload.pop("generated_utc", None)
        semantic_payload.pop("publish_generation_id", None)
        child_dates.append(path_date)
        canonical.append({"date": path_date, "payload": semantic_payload})
    canonical.sort(key=lambda item: str(item["date"]))
    ordered_dates = sorted(child_dates)
    index_dates = index_dict.get("dates") if isinstance(index_dict.get("dates"), list) else []
    if malformed or len(child_dates) != len(set(child_dates)) or index_dates != ordered_dates:
        emit.err(
            "receipt_collection",
            "dates",
            {"index": index_dates, "children": ordered_dates},
            "Receipt index dates do not exactly match published Receipt children",
        )
    expected_generation = snapshot_sha256({"receipts": canonical})
    if index_dict.get("collection_generation_id") != expected_generation:
        emit.err(
            "receipt_collection",
            "collection_generation_id",
            index_dict.get("collection_generation_id"),
            "Receipt collection generation does not match exact child semantics",
        )
    return emit.out


def check_vehicles(payload: object, *, rel_key: str) -> list[CheckResult]:
    emit = _Emitter("live_vehicles", rel_key)
    d = _as_dict(payload)
    if not isinstance(d, dict):
        return emit.out
    for i, v in enumerate(d.get("vehicles") or []):
        if not isinstance(v, dict):
            continue
        sub = _prefixed(emit, f"vehicles[{i}].")
        if not _in_range(v.get("lat"), -90, 90):
            sub.err("geo_range", "lat", v.get("lat"), f"lat={v.get('lat')} out of [-90,90]")
        if not _in_range(v.get("lon"), -180, 180):
            sub.err("geo_range", "lon", v.get("lon"), f"lon={v.get('lon')} out of [-180,180]")
        if not _in_range(v.get("bearing"), 0, 360):
            sub.err("geo_range", "bearing", v.get("bearing"), "bearing out of [0,360]")
        sub.count(v, "speed_kmh")
    return emit.out


def check_data_health(payload: object, *, rel_key: str) -> list[CheckResult]:
    emit = _Emitter("live_data_health", rel_key)
    d = _as_dict(payload)
    if not isinstance(d, dict):
        return emit.out
    # S11 byte ceiling: the three-lane summary must stay tiny.
    from transit_ops.snapshots.contract import DATA_HEALTH_BYTE_CEILING

    size = _payload_bytes(payload)
    if size is not None and size > DATA_HEALTH_BYTE_CEILING:
        emit.err(
            "byte_ceiling",
            "",
            size,
            f"data_health payload {size}B exceeds ceiling {DATA_HEALTH_BYTE_CEILING}B",
        )
    _valid_verdicts = frozenset({"pass", "warn", "fail"})
    for i, lane in enumerate(d.get("lanes") or []):
        if not isinstance(lane, dict):
            continue
        sub = _prefixed(emit, f"lanes[{i}].")
        # age_s / file counts are non-negative or honest-NULL (None-skipped by .count).
        sub.count(lane, "age_s")
        for f in ("files_written", "files_skipped", "files_total"):
            sub.count(lane, f)
        gate = lane.get("gate")
        if isinstance(gate, dict):
            gsub = _prefixed(emit, f"lanes[{i}].gate.")
            for f in ("checks_run", "errors", "warnings"):
                gsub.count(gate, f)
            verdict = gate.get("verdict")
            if verdict is not None and verdict not in _valid_verdicts:
                gsub.err(
                    "unknown_verdict",
                    "verdict",
                    verdict,
                    f"verdict={verdict!r} not in {sorted(_valid_verdicts)}",
                )
    for i, feed in enumerate(d.get("feeds") or []):
        if not isinstance(feed, dict):
            continue
        sub = _prefixed(emit, f"feeds[{i}].")
        sub.count(feed, "age_s")
    return emit.out


def check_alerts(payload: object, *, rel_key: str) -> list[CheckResult]:
    emit = _Emitter("live_alerts", rel_key)
    d = _as_dict(payload)
    if not isinstance(d, dict):
        return emit.out
    for i, a in enumerate(d.get("alerts") or []):
        if not isinstance(a, dict):
            continue
        sub = _prefixed(emit, f"alerts[{i}].")
        sev = a.get("severity")
        if sev is not None and sev not in ("critical", "high", "watch"):
            sub.err("unknown_severity", "severity", sev, f"severity={sev!r} not a known severity")
        # S15: url must be a string when present; each active window well-ordered.
        url = a.get("url")
        if url is not None and not isinstance(url, str):
            sub.err("not_string", "url", url, f"url={url!r} is not a string")
        for j, p in enumerate(a.get("active_periods") or []):
            if not isinstance(p, dict):
                continue
            ps, pe = p.get("start_utc"), p.get("end_utc")
            if not _iso_le(ps, pe):
                _prefixed(emit, f"alerts[{i}].active_periods[{j}].").err(
                    "window_order", "start_utc", ps, f"start_utc={ps!r} > end_utc={pe!r}"
                )
    return emit.out


# --- rel_key -> checker routing ----------------------------------------------
# Exact keys route directly; per-entity prefixes route by startswith.

_EXACT_CHECKERS = {
    "live/network.json": (check_network, "live_network"),
    "live/vehicles.json": (check_vehicles, "live_vehicles"),
    "live/alerts.json": (check_alerts, "live_alerts"),
    "status/data_health.json": (check_data_health, "live_data_health"),
    "historic/network_trend.json": (check_network_trend, "historic_network_trend"),
    "historic/hotspots.json": (check_hotspots, "historic_hotspots"),
    "historic/repeat_offenders.json": (check_repeat_offenders, "historic_repeat_offenders"),
    "historic/alert_history.json": (check_alert_history, "historic_alert_history"),
    "historic/alerts/index.json": (
        check_alert_archive_index,
        "historic_alert_archive_index",
    ),
}

# Exact discovery-index keys must be matched BEFORE the broader per-entity directory
# prefixes they nest under. Most route via the generic model-validate + universal scan
# only (checker None); _INDEX_CHECKERS below gives an index a dedicated checker.
_INDEX_KINDS = {
    "historic/route_reliability/index.json": "historic_route_reliability_index",
    "historic/receipts/index.json": "historic_receipts_index",
    "historic/history/network/index.json": "historic_network_history_index",
    "historic/history/lines/index.json": "historic_line_history_directory",
    "historic/history/stops/index.json": "historic_stop_history_directory",
    "historic/history/index.json": "historic_availability_index",
}

# S13: index keys that carry a dedicated structural checker (beyond model-validate).
_INDEX_CHECKERS = {
    "historic/receipts/index.json": check_receipts_index,
    "historic/history/network/index.json": check_network_history_index,
    "historic/history/lines/index.json": check_line_history_directory,
    "historic/history/stops/index.json": check_stop_history_directory,
    "historic/history/index.json": check_history_availability_index,
}

_PREFIX_CHECKERS = (
    (
        "historic/history/network/generations/",
        check_network_history_partition,
        "historic_network_history_partition",
    ),
    (
        "historic/history/lines/",
        check_line_history_partition,
        "historic_line_history_partition",
    ),
    (
        "historic/history/stops/",
        check_stop_history_partition,
        "historic_stop_history_partition",
    ),
    (
        "historic/alerts/generations/",
        check_alert_archive_page,
        "historic_alert_archive_page",
    ),
    ("historic/route_reliability/", check_route_reliability, "historic_route_reliability"),
    ("historic/stop_reliability/", check_stop_reliability, "historic_stop_reliability"),
    ("historic/receipts/", check_receipt, "historic_receipt"),
)


def _route_checker(rel_key: str):  # noqa: ANN202
    """Return (checker_or_None, kind): exact match, then index key, then prefix, then unknown."""
    if rel_key in _EXACT_CHECKERS:
        return _EXACT_CHECKERS[rel_key]
    if rel_key in _INDEX_KINDS:
        return (_INDEX_CHECKERS.get(rel_key), _INDEX_KINDS[rel_key])
    if _NETWORK_HISTORY_VERSIONED_INDEX_PATH_RE.fullmatch(rel_key):
        return (check_network_history_index, "historic_network_history_index")
    if _LINE_HISTORY_VERSIONED_DIRECTORY_PATH_RE.fullmatch(rel_key):
        return (check_line_history_directory, "historic_line_history_directory")
    if _STOP_HISTORY_VERSIONED_DIRECTORY_PATH_RE.fullmatch(rel_key):
        return (check_stop_history_directory, "historic_stop_history_directory")
    if _LINE_HISTORY_ENTITY_INDEX_PATH_RE.fullmatch(
        rel_key
    ) or _LINE_HISTORY_VERSIONED_ENTITY_INDEX_PATH_RE.fullmatch(rel_key):
        return (check_line_history_index, "historic_line_history_index")
    if _STOP_HISTORY_ENTITY_INDEX_PATH_RE.fullmatch(
        rel_key
    ) or _STOP_HISTORY_VERSIONED_ENTITY_INDEX_PATH_RE.fullmatch(rel_key):
        return (check_stop_history_index, "historic_stop_history_index")
    if re.fullmatch(r"historic/alerts/generations/[0-9a-f]{64}/index\.json", rel_key):
        return (check_alert_archive_index, "historic_alert_archive_index")
    if re.fullmatch(r"historic/receipts/generations/[0-9a-f]{64}/index\.json", rel_key):
        return (check_receipts_index, "historic_receipts_index")
    for prefix, checker, kind in _PREFIX_CHECKERS:
        if prefix == "historic/history/lines/" and not _LINE_HISTORY_PARTITION_PATH_RE.fullmatch(
            rel_key
        ):
            continue
        if prefix == "historic/history/stops/" and not _STOP_HISTORY_PARTITION_PATH_RE.fullmatch(
            rel_key
        ):
            continue
        if rel_key.startswith(prefix):
            return (checker, kind)
    return (None, "unknown")


def check_payload(rel_key: str, payload: object) -> list[CheckResult]:
    """Route rel_key to its checker (exact key or known prefix) + ALWAYS the universal scan."""
    checker, kind = _route_checker(rel_key)
    results: list[CheckResult] = []
    if checker is not None:
        results.extend(checker(payload, rel_key=rel_key))
    results.extend(_universal_scan(rel_key, kind, _as_dict(payload)))
    return results


def new_report(provider_id: str, tier: str, generated_utc: str) -> GateReport:
    return GateReport(provider_id=provider_id, tier=tier, generated_utc=generated_utc)


def record(
    report: GateReport,
    rel_key: str,
    payload: object,
    *,
    retain_sha: bool = True,
) -> None:
    """Run check_payload for one payload; append results; bump payloads_checked/checks_run."""
    findings = check_payload(rel_key, payload)
    report.results.extend(findings)
    if retain_sha:
        report.payload_sha256[rel_key] = snapshot_sha256(payload)  # type: ignore[arg-type]
    report.payloads_checked += 1
    report.checks_run += 1


def check_route_coverage_delta(
    current_total: int | None,
    prior_files_total: int | None,
    *,
    drop_frac: float = GATE_ROUTE_DROP_FRACTION,
) -> CheckResult | None:
    """ERROR when the WHOLE-tier file count shrank > drop_frac vs the prior publish.

    prior_files_total is core.snapshot_publish_state.files_total (the WHOLE-tier count,
    all historic files — not the route subset). None prior (first publish) -> None: a
    first publish is never blocked (DECISIONS #2).
    """
    if prior_files_total is None or prior_files_total <= 0 or current_total is None:
        return None
    if current_total < prior_files_total * (1 - drop_frac):
        return CheckResult(
            check="coverage_delta",
            kind="batch",
            rel_key="<batch>",
            severity=Severity.ERROR,
            message=(
                f"published file set shrank from ~{prior_files_total} to {current_total} "
                f"(> {drop_frac:.0%} drop)"
            ),
            field_path=None,
            value=current_total,
        )
    return None


def _is_empty_route_file(payload: object) -> bool:
    """A route reliability payload with NO data: empty periods, None habits, empty weak_stops."""
    d = _as_dict(payload)
    if not isinstance(d, dict):
        return False
    return (
        not (d.get("periods") or []) and d.get("habits") is None and not (d.get("weak_stops") or [])
    )


def _id_drift_counts(route_payloads: list[tuple[str, object]]) -> tuple[int, int]:
    """Count (scheduled route-days, overshoot route-days) across route payloads.

    A route-day is 'scheduled' when its cancellation row carries a known
    scheduled_trip_days (the scheduled universe was resolved for that date); it is an
    'overshoot' when the RT-observed total_trip_days EXCEEDS that scheduled count — the
    over-delivery case where silent_trip_days was clamped to 0 (DECISIONS #12). Only
    numeric leaves are counted; honest-NULL scheduled rows are skipped entirely.
    """
    scheduled_days = 0
    overshoot_days = 0
    for _rel_key, payload in route_payloads:
        d = _as_dict(payload)
        if not isinstance(d, dict):
            continue
        for c in d.get("cancellations") or []:
            if not isinstance(c, dict):
                continue
            scheduled = c.get("scheduled_trip_days")
            total = c.get("total_trip_days")
            if not _is_number(scheduled):
                continue
            scheduled_days += 1
            if _is_number(total) and total > scheduled:
                overshoot_days += 1
    return scheduled_days, overshoot_days


def check_id_drift(
    route_payloads: list[tuple[str, object]] | None,
    *,
    warn_frac: float = GATE_ID_DRIFT_WARN_FRACTION,
) -> CheckResult | None:
    """WARN when RT-observed > scheduled on > warn_frac of scheduled route-days.

    Batch-level trip-id drift signal (DECISIONS #12): a high overshoot share means the
    scheduled and RT trip_id namespaces are drifting, so the clamped silent counts
    under-report. Returns None when there are no scheduled route-days (nothing to
    measure) or the share is within tolerance.
    """
    if not route_payloads:
        return None
    scheduled_days, overshoot_days = _id_drift_counts(route_payloads)
    if scheduled_days <= 0:
        return None
    ratio = overshoot_days / scheduled_days
    if ratio <= warn_frac:
        return None
    return CheckResult(
        check="id_drift",
        kind="batch",
        rel_key="<batch>",
        severity=Severity.WARN,
        message=(
            f"{overshoot_days} of {scheduled_days} scheduled route-days have observed "
            f"trips > scheduled ({ratio:.0%} > {warn_frac:.0%}) — trip-id drift; silent "
            "counts under-report"
        ),
        field_path=None,
        value=ratio,
    )


def _network_trend_series_empty(payload: object) -> bool:
    """True when a network_trend payload carries an empty daily `series`."""
    d = _as_dict(payload)
    if not isinstance(d, dict):
        return False
    return len(d.get("series") or []) < 1


def check_network_trend_coverage(
    payload: object, *, rel_key: str, has_prior: bool, has_realtime_payloads: bool
) -> CheckResult | None:
    """Empty network_trend series, severity keyed on what the batch proves:

    * batch carries NO route reliability files -> the provider has no
      realtime-derived data at all (a static-only provider, e.g. enrolled before
      its realtime worker runs): expected emptiness, WARN — a daily red here
      would drown real failures;
    * no prior publish state -> legitimate cold start, WARN;
    * otherwise (realtime data exists AND a prior publish existed) -> the daily
      trend silently dropped: ERROR. Non-empty series -> None."""
    if not _network_trend_series_empty(payload):
        return None
    if not has_realtime_payloads:
        reason = " — batch has no realtime-derived payloads (static-only provider)"
        severity = Severity.WARN
    elif not has_prior:
        reason = " — first publish, no prior state"
        severity = Severity.WARN
    else:
        reason = ""
        severity = Severity.ERROR
    return CheckResult(
        check="empty_coverage",
        kind="historic_network_trend",
        rel_key=rel_key,
        severity=severity,
        message="network_trend series is empty (no daily trend published)" + reason,
        field_path="series",
        value=0,
    )


def finalize_batch(
    report: GateReport,
    *,
    route_payloads: list[tuple[str, object]] | None = None,
    current_total: int | None = None,
    prior_files_total: int | None = None,
    network_trend: tuple[str, object] | None = None,
) -> None:
    """Report-level aggregates that need the WHOLE published set (not per-file).

    * coverage-delta ERROR when the total file count shrank vs the prior publish;
    * over-half-empty route set WARN (a coverage regression signal);
    * trip-id drift WARN when RT-observed > scheduled on > GATE_ID_DRIFT_WARN_FRACTION
      of scheduled route-days (clamped silent counts under-report);
    * empty network_trend series: WARN when the batch carries no route files
      (static-only provider) or on a first publish; ERROR only when realtime
      data exists AND a prior publish existed (routed here because per-file
      checks cannot see prior state or the batch shape).

    prior_files_total None means no prior publish row exists (first publish), which
    both suppresses the coverage-delta ERROR and downgrades the empty-series finding
    to WARN.
    """
    has_prior = prior_files_total is not None
    if network_trend is not None:
        rel_key, payload = network_trend
        trend_finding = check_network_trend_coverage(
            payload,
            rel_key=rel_key,
            has_prior=has_prior,
            has_realtime_payloads=bool(route_payloads),
        )
        if trend_finding is not None:
            report.results.append(trend_finding)
    delta = check_route_coverage_delta(current_total, prior_files_total)
    if delta is not None:
        report.results.append(delta)
    drift = check_id_drift(route_payloads)  # GC2 DECISIONS #12 (WARN on systemic overshoot)
    if drift is not None:
        report.results.append(drift)
    if route_payloads:
        empty = sum(1 for (_k, p) in route_payloads if _is_empty_route_file(p))
        ratio = empty / len(route_payloads)
        if ratio > GATE_EMPTY_ROUTE_WARN_FRACTION:
            report.results.append(
                CheckResult(
                    check="empty_route_ratio",
                    kind="batch",
                    rel_key="<batch>",
                    severity=Severity.WARN,
                    message=(
                        f"{empty} of {len(route_payloads)} route reliability files carry no data "
                        f"({ratio:.0%} > {GATE_EMPTY_ROUTE_WARN_FRACTION:.0%})"
                    ),
                    field_path=None,
                    value=ratio,
                )
            )


def enforce(report: GateReport, *, force: bool) -> None:
    """Log a structured summary; raise GateError when errors exist and not force.

    force=True downgrades a failing gate to a logged "GATE OVERRIDDEN" warning (the
    live tier and --force paths), so findings are recorded but the publish proceeds.
    """
    top = [r.to_dict() for r in (report.errors + report.warnings)][:10]
    summary = {
        "provider_id": report.provider_id,
        "tier": report.tier,
        "generated_utc": report.generated_utc,
        "checks_run": report.checks_run,
        "payloads_checked": report.payloads_checked,
        "errors": len(report.errors),
        "warnings": len(report.warnings),
        "top_findings": top,
    }
    if report.errors or report.warnings:
        logger.warning("publish gate: %s", json.dumps(summary, sort_keys=True))
    else:
        logger.info("publish gate: %s", json.dumps(summary, sort_keys=True))

    if report.errors and not force:
        raise GateError(report)
    if report.errors and force:
        logger.warning(
            "publish gate OVERRIDDEN (force): proceeding despite %d error(s): %s",
            len(report.errors),
            json.dumps([r.to_dict() for r in report.errors], sort_keys=True),
        )
