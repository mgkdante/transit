"""Read-only measurement of one explicitly selected closed capture day."""

import sys
import tracemalloc
from collections import Counter
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import UTC, date
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic
from typing import Never

from sqlalchemy import Connection, text

from transit_ops.history.datasets import CaptureSource, get_dataset, utc_day_closes_at
from transit_ops.history.pack import read_pack
from transit_ops.history.probe_duckdb import benchmark
from transit_ops.history.seal_captures import LocalPack, WindowNotClosed, pack_working_day
from transit_ops.history.working_captures import read_working_day
from transit_ops.ingestion.storage import BronzeStorage, BronzeStorageResolver, ByteStream


@dataclass(frozen=True)
class ReadOnlyStorage(BronzeStorage):
    _store: BronzeStorage

    def open_stream(
        self, path: str, *, byte_range: tuple[int, int] | None = None
    ) -> AbstractContextManager[ByteStream]:
        return self._store.open_stream(path, byte_range=byte_range)

    def exists(self, path: str) -> bool:
        return self._store.exists(path)

    def _refuse(self, *args: object, **kwargs: object) -> Never:
        raise PermissionError("probe storage is read-only")

    persist_temp_file = put_if_absent = delete_object = delete_objects = _refuse


@dataclass(frozen=True)
class Finding:
    capture_row_id: int
    reason: str


@dataclass(frozen=True)
class ProbeReport:
    provider_id: str
    endpoint_key: str
    utc_date: str
    closed: bool
    outcome: str
    poll_counts: dict[str, int]
    capture_count: int
    packed_count: int
    missing_count: int
    mismatch_count: int
    findings: tuple[Finding, ...]
    source_bytes: int
    compressed_bytes: int
    ratio: float | None
    database_read_seconds: float
    pack_and_verify_seconds: float
    decode_and_check_seconds: float
    total_seconds: float
    python_traced_peak_bytes: int
    memory_method: str
    process_peak_rss_bytes: int | None
    process_peak_rss_reason: str | None
    longest_completed_poll_seconds: float | None
    unfinished_attempts: int
    duckdb: dict[str, object]


def validate_selection(provider_id: str, endpoint_key: str, utc_date: date) -> None:
    if not provider_id.strip() or any(ord(c) < 32 for c in provider_id):
        raise ValueError("invalid provider")
    if type(utc_date) is not date:
        raise ValueError("expected one UTC date")
    if not isinstance(get_dataset("capture." + endpoint_key).source, CaptureSource):
        raise ValueError("expected a capture feed")


def peak_rss() -> tuple[int | None, str | None]:
    if sys.platform != "linux":
        return None, "process peak RSS unavailable on this platform"
    try:
        import resource

        return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024, None
    except (ImportError, OSError):
        return None, "resource peak RSS unavailable"


def _report(
    local: LocalPack,
    times: tuple[float, float, float, float],
    peak: int,
    rss: tuple[int | None, str | None],
    duckdb: dict[str, object],
) -> ProbeReport:
    record, pack = local.record, local.pack
    findings = tuple(
        Finding(p.capture_row_id, p.missing_reason)
        for p in record.polls
        if p.capture_row_id is not None and p.missing_reason in ("object_absent", "object_mismatch")
    )
    durations = [
        (p.completed_at_utc.astimezone(UTC) - p.started_at_utc.astimezone(UTC)).total_seconds()
        for p in record.polls
        if p.status != "unfinished" and p.completed_at_utc is not None
    ]
    return ProbeReport(
        record.feed_day.provider_id,
        record.feed_day.endpoint_key,
        record.feed_day.utc_date.isoformat(),
        True,
        "measured" if pack else "no_captures",
        dict(Counter(p.status for p in record.polls)),
        len(record.captures),
        len(pack.captures) if pack else 0,
        sum(f.reason == "object_absent" for f in findings),
        sum(f.reason == "object_mismatch" for f in findings),
        findings,
        pack.source_bytes if pack else 0,
        pack.byte_size if pack else 0,
        pack.source_bytes / pack.byte_size if pack else None,
        *times,
        peak,
        "tracemalloc peak bytes; excludes native allocations; existing tracing peak retained",
        *rss,
        max(durations, default=None),
        sum(p.status == "unfinished" for p in record.polls),
        duckdb,
    )


def probe_capture_day(
    connection: Connection,
    storage: BronzeStorageResolver,
    *,
    provider_id: str,
    endpoint_key: str,
    utc_date: date,
) -> ProbeReport:
    validate_selection(provider_id, endpoint_key, utc_date)
    if connection.in_transaction():
        raise ValueError("probe requires a connection without an open transaction")
    start = monotonic()
    tracing = tracemalloc.is_tracing()
    if not tracing:
        tracemalloc.start()
    try:
        db_start = monotonic()
        with connection.begin():
            connection.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
            now = connection.execute(text("SELECT now()")).scalar_one()
            if now.astimezone(UTC) < utc_day_closes_at(utc_date):
                raise WindowNotClosed("probe requires a closed UTC day")
            record = read_working_day(
                connection, provider_id=provider_id, endpoint_key=endpoint_key, utc_date=utc_date
            )
        db_seconds = monotonic() - db_start
        with TemporaryDirectory(prefix="transit-probe-") as directory:
            pack_start = monotonic()
            local = pack_working_day(
                record, lambda b: ReadOnlyStorage(b, storage(b)), directory=Path(directory)
            )
            pack_seconds = monotonic() - pack_start
            decode_start = monotonic()
            if local.pack is not None:
                assert local.path is not None
                with local.path.open("rb") as source:
                    for _ in read_pack(source, local.pack.streams, local.pack.captures):
                        pass
            decode_seconds = monotonic() - decode_start
            duckdb = benchmark(local, Path(directory))
        return _report(
            local,
            (db_seconds, pack_seconds, decode_seconds, monotonic() - start),
            tracemalloc.get_traced_memory()[1],
            peak_rss(),
            duckdb,
        )
    finally:
        if not tracing:
            tracemalloc.stop()
