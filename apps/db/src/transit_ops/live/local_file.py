"""Single-writer disposable live state and its durable local poll record."""

from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from threading import RLock
from typing import Final, get_args, get_type_hints

import duckdb

from transit_ops.history.poll_record import CaptureEntry, PollEntry
from transit_ops.live.settings import LaneSettings

SCHEMA_VERSION: Final = 1
_TYPES = {int: "BIGINT", bool: "BOOLEAN", str: "VARCHAR", datetime: "TIMESTAMP"}
_OWNERS: set[Path] = set()
_OWNER_LOCK = RLock()


class LocalFileLocked(RuntimeError):
    pass


class LocalFileMismatch(RuntimeError):
    pass


class LocalFileUnreadable(RuntimeError):
    pass


def connect_live(
    path: Path | None, *, temp_directory: Path, memory_limit_mb: int, threads: int, temp_max_mb: int
) -> duckdb.DuckDBPyConnection:
    if any(type(v) is not int or v <= 0 for v in (memory_limit_mb, threads, temp_max_mb)):
        raise ValueError("explicit positive memory, thread and temp limits required")
    try:
        conn = duckdb.connect(
            str(path) if path is not None else ":memory:",
            config={
                "integer_division": True,
                "default_null_order": "nulls_last_on_asc_first_on_desc",
                "preserve_insertion_order": True,
                "autoinstall_known_extensions": False,
                "autoload_known_extensions": False,
                "memory_limit": f"{memory_limit_mb}MB",
                "threads": threads,
                "temp_directory": str(temp_directory),
                "max_temp_directory_size": f"{temp_max_mb}MB",
            },
        )
    except duckdb.Error as exc:
        if "could not set lock" in str(exc).lower() or "being used by another process" in str(exc):
            raise LocalFileLocked(str(path)) from exc
        raise LocalFileUnreadable(str(path)) from exc
    try:
        conn.execute("SET TimeZone = 'UTC'")
        conn.execute("SET max_temp_directory_size = ?", [f"{temp_max_mb}MB"])
        if conn.execute("SELECT current_setting('default_collation')").fetchone() != ("",):
            raise ValueError("live requires binary collation")
        conn.execute("SET lock_configuration = true")
        return conn
    except BaseException:
        conn.close()
        raise


class LocalFile:
    def __init__(self, connection: duckdb.DuckDBPyConnection):
        self.connection = connection
        self._path: Path | None = None
        self._active = self._failed = False

    @classmethod
    def open(cls, path: Path, *, provider_id: str, settings: LaneSettings) -> "LocalFile":
        memory, threads, temp = (
            settings.duckdb_memory_limit_mb,
            settings.duckdb_threads,
            settings.temp_dir_max_mb,
        )
        if memory is None or threads is None or temp is None:
            raise ValueError("explicit memory, thread and temp limits required")
        with _OWNER_LOCK:
            path = path.resolve()
            if path in _OWNERS:
                raise LocalFileLocked(str(path))
            fresh = not path.exists()
            conn = connect_live(
                path,
                temp_directory=path.with_suffix(".tmp"),
                memory_limit_mb=memory,
                threads=threads,
                temp_max_mb=temp,
            )
            local = cls(conn)
            local._path = path
            _OWNERS.add(path)
            try:
                local._initialize(provider_id, fresh)
                return local
            except BaseException as exc:
                local.close()
                if isinstance(exc, duckdb.Error):
                    raise LocalFileUnreadable(str(path)) from exc
                raise

    def _initialize(self, provider: str, fresh: bool) -> None:
        tables = {"meta": "schema_version INTEGER, provider_id VARCHAR"}
        for table, kind, key in (
            ("polls", PollEntry, "ingestion_run_id"),
            ("captures", CaptureEntry, "capture_row_id"),
        ):
            columns = [
                f'"{name}" {_TYPES[(get_args(t) or (t,))[0]]}'
                for name, t in get_type_hints(kind).items()
            ]
            tables[table] = (
                f"{', '.join(columns)}, endpoint_key VARCHAR, segment_seq BIGINT, "
                f"PRIMARY KEY(index_family, {key})"
            )
        with self.transaction() as conn:
            existing = conn.execute(
                "SELECT table_name FROM duckdb_tables() "
                "WHERE database_name=current_database() AND schema_name='main' AND NOT temporary"
            ).fetchall()
            for table, definition in tables.items():
                if not fresh and (table,) not in existing:
                    raise LocalFileMismatch(f"{self._path}: {table} table missing")
                conn.execute(f"CREATE TEMP TABLE _local_expected ({definition})")
                expected = conn.execute("PRAGMA table_info('_local_expected')").fetchall()
                if fresh:
                    conn.execute(f"CREATE TABLE {table} ({definition})")
                if (
                    conn.execute("SELECT * FROM pragma_table_info(?)", [table]).fetchall()
                    != expected
                ):
                    raise LocalFileMismatch(f"{self._path}: {table} table shape differs")
                conn.execute("DROP TABLE _local_expected")
            if fresh:
                conn.execute("INSERT INTO meta VALUES (?, ?)", [SCHEMA_VERSION, provider])
            if conn.execute("SELECT * FROM meta").fetchall() != [(SCHEMA_VERSION, provider)]:
                raise LocalFileMismatch(f"{self._path}: meta provider or schema version differs")

    @contextmanager
    def transaction(self) -> Iterator[duckdb.DuckDBPyConnection]:
        outer = not self._active
        if outer:
            self.connection.execute("BEGIN")
        self._active = True
        try:
            yield self.connection
            if outer:
                if self._failed:
                    raise RuntimeError("transaction aborted")
                self.connection.execute("COMMIT")
        except BaseException:
            self._failed = True
            if outer:
                self.connection.execute("ROLLBACK")
            raise
        finally:
            if outer:
                self._active = self._failed = False

    def record_polls(self, polls: Sequence[PollEntry], *, endpoint_key: str) -> int:
        return self._record("polls", "ingestion_run_id", polls, endpoint_key)

    def record_captures(self, captures: Sequence[CaptureEntry], *, endpoint_key: str) -> int:
        return self._record("captures", "capture_row_id", captures, endpoint_key)

    def _record(
        self,
        table: str,
        key: str,
        entries: Sequence[PollEntry] | Sequence[CaptureEntry],
        endpoint: str,
    ) -> int:
        inserted = 0
        with self.transaction() as conn:
            for entry in entries:
                values = {**asdict(entry), "endpoint_key": endpoint}
                # UTC microseconds avoid DuckDB's optional timezone decoding dependency.
                for name, value in values.items():
                    if isinstance(value, datetime):
                        if value.utcoffset() is None:
                            raise ValueError(f"{name} must be timezone-aware")
                        values[name] = value.astimezone(UTC).replace(tzinfo=None)
                columns = ", ".join(f'"{name}"' for name in values)
                identity = (entry.index_family, values[key])
                rows = conn.execute(
                    f"SELECT {columns} FROM {table} WHERE index_family = ? AND {key} = ?", identity
                ).fetchall()
                if rows and rows != [tuple(values.values())]:
                    raise LocalFileMismatch(f"{table} key {identity!r} differs")
                if not rows:
                    placeholders = ", ".join("?" for _ in values)
                    conn.execute(
                        f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",
                        list(values.values()),
                    )
                    inserted += 1
        return inserted

    def close(self) -> None:
        with _OWNER_LOCK:
            self.connection.close()
            if self._path is not None:
                _OWNERS.remove(self._path)
                self._path = None
