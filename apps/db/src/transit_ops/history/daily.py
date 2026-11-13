"""Sequential capture archive work with a default-off admission gate."""

import math
import time
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime

from sqlalchemy import Connection, text

from transit_ops.history import daily_selection as selection
from transit_ops.history import datasets as declarations
from transit_ops.history import ledger, store
from transit_ops.history.close_runs import close_unfinished_runs
from transit_ops.history.daily_selection import CaptureDay
from transit_ops.history.seal_captures import CopyContentMissing, WindowNotClosed
from transit_ops.history.verify import Verification
from transit_ops.ingestion.storage import BronzeStorageResolver


@dataclass
class DayOutcome:
    day: CaptureDay
    state: str
    reason: str
    verifications: list[Verification] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


@dataclass
class DailyHistoryResult:
    outcomes: list[DayOutcome] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    counts: Counter[str] = field(default_factory=Counter)
    stop_reason: str = "complete"
    remaining_work: bool = False

    @property
    def success(self) -> bool:
        return not self.errors


def _validate(
    datasets: Sequence[str],
    start: date | None,
    end: date | None,
    cap: int,
    budget: float,
    backend: str,
    sealed_by: str,
    actor: str | None,
) -> None:
    if not datasets or isinstance(datasets, str):
        raise ValueError("capture datasets are required")
    for dataset in datasets:
        if not isinstance(declarations.get_dataset(dataset).source, declarations.CaptureSource):
            raise ValueError("not a capture dataset")
    if any(d is not None and type(d) is not date for d in (start, end)):
        raise ValueError("start and end must be dates")
    if start is not None and end is not None and start > end:
        raise ValueError("start must not be after end")
    if type(cap) is not int or not 1 <= cap <= 3:
        raise ValueError("max_days_per_feed must be between 1 and 3")
    if isinstance(budget, bool) or not math.isfinite(budget) or budget <= 0:
        raise ValueError("time budget must be finite and positive")
    if (
        backend not in ("local", "s3")
        or not sealed_by.strip()
        or actor is not None
        and not actor.strip()
    ):
        raise ValueError("invalid archive backend or provenance")


def _switch(connection: Connection) -> datetime | None:
    row = connection.execute(
        text("""
        SELECT enabled, updated_at_utc FROM core.pipeline_switches
        WHERE switch_key = 'history_daily'
    """)
    ).one_or_none()
    return row[1].astimezone(UTC) if row is not None and row[0] else None


def _preflight(admission: "_Admission") -> datetime | None:
    connection, result = admission.connection, admission.result
    with connection.begin():
        names = (
            "core.history_window",
            "core.history_archive_copy",
            "core.history_event",
            "core.pipeline_switches",
        )
        for name in names:
            if not admission.available():
                return None
            if (
                connection.execute(text("SELECT to_regclass(:name)"), {"name": name}).scalar_one()
                is None
            ):
                result.stop_reason = "disabled" if name == names[-1] else "ledger_missing"
                return None
        if not admission.available():
            return None
        enabled_at = _switch(connection)
    if enabled_at is None:
        result.stop_reason = "disabled"
    return enabled_at


@dataclass
class _Admission:
    connection: Connection
    result: DailyHistoryResult
    deadline: float
    clock: Callable[[], float]
    enabled_at: datetime | None = None

    def available(self, *, switch: bool = False) -> bool:
        if self.clock() >= self.deadline:
            self.result.stop_reason = "time_budget"
        elif switch:
            with self.connection.begin():
                current = _switch(self.connection)
            if current != self.enabled_at:
                self.result.stop_reason = "switch_changed"
            elif self.clock() < self.deadline:
                return True
            else:
                self.result.stop_reason = "time_budget"
        else:
            return True
        self.result.remaining_work = True
        return False


def _pending(connection: Connection, day: CaptureDay) -> list[ledger.ArchiveCopy]:
    with connection.begin():
        window = ledger.window_state(
            connection,
            dataset_id=day.dataset_id,
            provider_id=day.provider_id,
            window_key=day.utc_date.isoformat(),
        )
        copies = ledger.find_copies(
            connection,
            dataset_id=day.dataset_id,
            provider_id=day.provider_id,
            start=day.utc_date,
            end=day.utc_date,
        )
    current = window.current_version if window else None
    return sorted(
        (
            c
            for c in copies
            if c.state == "sealed" and (current is None or c.content_version > current)
        ),
        key=lambda c: c.content_version,
    )


def _failure(connection: Connection, outcome: DayOutcome, exc: Exception) -> None:
    if connection.in_transaction():
        connection.rollback()
    message = (
        str(exc)
        if isinstance(exc, (CopyContentMissing, WindowNotClosed, NotImplementedError))
        else type(exc).__name__
    )
    outcome.errors.append(
        f"{outcome.day.provider_id}/{outcome.day.dataset_id}/{outcome.day.utc_date}: {message}"
    )
    outcome.state = "failed"


def _work_day(
    connection: Connection,
    storage: BronzeStorageResolver,
    day: CaptureDay,
    archive_backend: str,
    sealed_by: str,
    actor: str | None,
) -> DayOutcome:
    outcome = DayOutcome(day, "completed", "seal_and_verify")
    try:
        copy = store.seal(
            connection,
            storage,
            dataset_id=day.dataset_id,
            provider_id=day.provider_id,
            window_key=day.utc_date.isoformat(),
            archive_backend=archive_backend,
            sealed_by=sealed_by,
            actor=actor,
        )
        if copy.state not in ("sealed", "verified"):
            raise RuntimeError("seal returned an unfinished copy")
    except Exception as exc:
        _failure(connection, outcome, exc)
    tried: set[int] = set()
    try:
        while pending := [c for c in _pending(connection, day) if c.content_version not in tried]:
            copy = pending[0]
            tried.add(copy.content_version)
            try:
                verified = store.verify(connection, storage, copy, actor=actor)
                outcome.verifications.append(verified)
                if verified.outcome != "verified" or verified.copy.state != "verified":
                    outcome.state = "failed"
                    outcome.errors.append(
                        f"{day}: version {copy.content_version}: {verified.reason}"
                    )
            except Exception as exc:
                _failure(connection, outcome, exc)
    except Exception as exc:
        _failure(connection, outcome, exc)
    return outcome


def _prepare(
    admission: _Admission,
    datasets: Sequence[str],
    start: date | None,
    end: date | None,
    actor: str | None,
) -> tuple[list[CaptureDay], datetime] | None:
    connection = admission.connection
    if not admission.available():
        return None
    with connection.begin():
        now: datetime = connection.execute(text("SELECT now()")).scalar_one().astimezone(UTC)
    if not admission.available():
        return None
    with connection.begin():
        providers = selection.capture_providers(connection, now=now)
    for provider in providers:
        if not admission.available(switch=True):
            return None
        with connection.begin():
            admission.result.counts["closed_runs"] += close_unfinished_runs(
                connection, provider_id=provider, actor=actor
            )
    if not admission.available():
        return None
    with connection.begin():
        days = selection.capture_days(
            connection,
            datasets=datasets,
            start=start or date.min,
            end=end or now.date(),
            empty_since=admission.enabled_at,
        )
    return days, now


def _run_days(
    admission: _Admission,
    storage: BronzeStorageResolver,
    days: list[CaptureDay],
    now: datetime,
    cap: int,
    backend: str,
    sealed_by: str,
    actor: str | None,
) -> None:
    result, connection = admission.result, admission.connection
    attempts: Counter[tuple[str, str]] = Counter()
    for day in days:
        if not admission.available():
            break
        try:
            with connection.begin():
                status = selection.capture_day_status(connection, day, now=now)
        except Exception as exc:
            outcome = DayOutcome(day, "failed", "status_failed")
            _failure(connection, outcome, exc)
            key = (day.provider_id, day.dataset_id)
            if attempts[key] < cap:
                attempts[key] += 1
                _record(result, outcome)
            else:
                result.counts["deferred"] += 1
                result.remaining_work = True
            continue
        if status.overdue_first_seal:
            result.warnings.append(f"{day}: first seal overdue")
        key = (day.provider_id, day.dataset_id)
        if status.state == "unchanged":
            result.outcomes.append(DayOutcome(day, "unchanged", status.reason))
            continue
        if attempts[key] >= cap:
            result.counts["deferred"] += 1
            result.remaining_work = True
            continue
        if not admission.available(switch=True):
            break
        attempts[key] += 1
        if status.state == "refused":
            outcome = DayOutcome(day, "refused", status.reason, errors=[f"{day}: {status.reason}"])
        else:
            outcome = _work_day(connection, storage, day, backend, sealed_by, actor)
        _record(result, outcome)
    if result.stop_reason == "complete" and result.remaining_work:
        result.stop_reason = "day_cap"


def _record(result: DailyHistoryResult, outcome: DayOutcome) -> None:
    result.outcomes.append(outcome)
    result.errors.extend(outcome.errors)
    result.counts["attempted"] += 1
    result.counts[outcome.state] += 1
    result.counts["verified"] += sum(
        v.outcome == "verified" and v.copy.state == "verified" for v in outcome.verifications
    )


def run_capture_history(
    connection: Connection,
    storage: BronzeStorageResolver,
    *,
    datasets: Sequence[str],
    start: date | None = None,
    end: date | None = None,
    max_days_per_feed: int = 3,
    time_budget_seconds: float = 2700,
    archive_backend: str,
    sealed_by: str,
    actor: str | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> DailyHistoryResult:
    """Admit bounded days; finish their verifications even after the deadline.

    Cleanup covers every declared capture feed of each discovered provider,
    including open-day attempts and attempts outside the requested date range.
    The caller owns the storage scope; store verbs own their transactions.
    """
    _validate(
        datasets,
        start,
        end,
        max_days_per_feed,
        time_budget_seconds,
        archive_backend,
        sealed_by,
        actor,
    )
    if connection.in_transaction():
        raise ValueError("daily history requires a connection without a transaction")
    result = DailyHistoryResult()
    admission = _Admission(connection, result, clock() + time_budget_seconds, clock)
    if not admission.available():
        return result
    admission.enabled_at = _preflight(admission)
    if admission.enabled_at is None:
        return result
    prepared = _prepare(admission, datasets, start, end, actor)
    if prepared is not None:
        days, now = prepared
        _run_days(
            admission, storage, days, now, max_days_per_feed, archive_backend, sealed_by, actor
        )
    return result
