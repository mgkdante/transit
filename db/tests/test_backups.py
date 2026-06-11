from __future__ import annotations

import io
from datetime import UTC, datetime
from pathlib import Path

import pytest

from transit_ops.backups import (
    BackupError,
    backup_object_key,
    build_pg_dump_command,
    download_latest_backup,
    list_database_backups,
    prune_old_backups,
    run_database_backup,
    verify_excluded_tables_exist,
)
from transit_ops.settings import Settings

FIXED_NOW = datetime(2026, 6, 11, 9, 30, 5, tzinfo=UTC)
EXPECTED_KEY = "backups/postgres/transit-20260611T093005Z.dump"
RAW_DATABASE_URL = "postgresql://app:secret@db.example.com:5432/transit"


def make_settings(**overrides: object) -> Settings:
    defaults: dict[str, object] = {
        "DATABASE_URL": RAW_DATABASE_URL,
        "BRONZE_S3_BUCKET": "transit-raw",
    }
    defaults.update(overrides)
    return Settings(_env_file=None, **defaults)


def backup_meta(key: str, *, size: int = 1024) -> dict[str, object]:
    return {"Key": key, "Size": size, "LastModified": FIXED_NOW}


class FakeS3:
    def __init__(
        self,
        objects: dict[str, dict[str, object]] | None = None,
        *,
        upload_error: Exception | None = None,
    ) -> None:
        self.objects: dict[str, dict[str, object]] = dict(objects or {})
        self.uploads: list[dict[str, object]] = []
        self.deleted: list[str] = []
        self.downloads: list[tuple[str, str, str]] = []
        self.upload_error = upload_error

    def upload_fileobj(self, fileobj, bucket, key, ExtraArgs=None, Config=None):  # noqa: ANN001, N803
        if self.upload_error is not None:
            raise self.upload_error
        body = fileobj.read()
        self.uploads.append(
            {
                "bucket": bucket,
                "key": key,
                "body": body,
                "extra_args": ExtraArgs,
                "config": Config,
            }
        )
        self.objects[key] = {"Key": key, "Size": len(body), "LastModified": FIXED_NOW}

    def delete_object(self, *, Bucket, Key):  # noqa: ANN001, N803
        self.deleted.append(Key)
        self.objects.pop(Key, None)

    def download_file(self, bucket, key, filename):  # noqa: ANN001
        self.downloads.append((bucket, key, filename))
        Path(filename).write_bytes(b"fake-dump-bytes")

    def get_paginator(self, operation_name):  # noqa: ANN001
        assert operation_name == "list_objects_v2"
        return _FakePaginator(self)


class _FakePaginator:
    def __init__(self, client: FakeS3) -> None:
        self.client = client

    def paginate(self, *, Bucket, Prefix):  # noqa: ANN001, N803
        contents = [
            dict(meta)
            for key, meta in sorted(self.client.objects.items())
            if key.startswith(Prefix)
        ]
        midpoint = len(contents) // 2
        yield {"Contents": contents[:midpoint]}
        yield {"Contents": contents[midpoint:]}


class FakeScalarResult:
    def __init__(self, value: object) -> None:
        self.value = value

    def scalar_one(self) -> object:
        return self.value


class FakeGuardConnection:
    def __init__(
        self,
        *,
        missing: set[str] | None = None,
        events: list[tuple[object, ...]] | None = None,
    ) -> None:
        self.missing = missing or set()
        self.events = events if events is not None else []

    def __enter__(self) -> FakeGuardConnection:
        return self

    def __exit__(self, *args: object) -> bool:
        return False

    def execute(self, statement, params=None):  # noqa: ANN001
        params = dict(params or {})
        self.events.append(("sql", str(statement), params))
        table = params.get("tbl")
        value = None if table in self.missing else table
        return FakeScalarResult(value)


class FakeEngine:
    def __init__(self, connection: FakeGuardConnection) -> None:
        self.connection = connection
        self.disposed = False

    def connect(self) -> FakeGuardConnection:
        return self.connection

    def dispose(self) -> None:
        self.disposed = True


def make_engine_factory(
    *,
    missing: set[str] | None = None,
    events: list[tuple[object, ...]] | None = None,
) -> tuple[object, FakeEngine]:
    connection = FakeGuardConnection(missing=missing, events=events)
    engine = FakeEngine(connection)

    def factory(settings: Settings) -> FakeEngine:
        return engine

    return factory, engine


class FakePgDumpProcess:
    def __init__(
        self,
        payload: bytes = b"PGDMP-fake-dump-bytes",
        returncode: int = 0,
        *,
        stay_running: bool = False,
    ) -> None:
        self.stdout = io.BytesIO(payload)
        self.returncode_value = returncode
        self.stay_running = stay_running
        self.kill_calls = 0

    def poll(self) -> int | None:
        if self.stay_running and self.kill_calls == 0:
            return None
        return self.returncode_value

    def wait(self) -> int:
        return self.returncode_value

    def kill(self) -> None:
        self.kill_calls += 1
        self.returncode_value = -9


def make_popen(
    process: FakePgDumpProcess,
    *,
    events: list[tuple[object, ...]] | None = None,
    stderr_bytes: bytes = b"",
):  # noqa: ANN201
    events_list = events if events is not None else []

    def fake_popen(command, *, stdout, stderr):  # noqa: ANN001
        events_list.append(("popen", list(command)))
        if stderr_bytes:
            stderr.write(stderr_bytes)
            stderr.flush()
        return process

    return fake_popen, events_list


def test_backup_object_key_is_utc_timestamped() -> None:
    assert backup_object_key("backups/postgres", FIXED_NOW) == EXPECTED_KEY

    eastern = datetime(2026, 6, 11, 5, 30, 5, tzinfo=UTC).astimezone()
    utc_equivalent = backup_object_key("backups/postgres", eastern.astimezone(UTC))
    assert backup_object_key("backups/postgres", eastern) == utc_equivalent


def test_build_pg_dump_command_uses_custom_format_zstd_and_excludes_rt_stop_times() -> None:
    command = build_pg_dump_command(make_settings())

    assert command[0] == "pg_dump"
    assert "--format=custom" in command
    assert "--compress=zstd:3" in command
    assert "--no-password" in command
    assert "--lock-wait-timeout=5min" in command
    assert "--exclude-table-data=silver.rt_trip_update_stop_times" in command


def test_build_pg_dump_command_requires_database_url() -> None:
    settings = Settings(_env_file=None, DATABASE_URL=None)

    with pytest.raises(ValueError, match="DATABASE_URL"):
        build_pg_dump_command(settings)


def test_build_pg_dump_command_passes_raw_database_url_not_sqlalchemy() -> None:
    command = build_pg_dump_command(make_settings())

    assert command[-1] == RAW_DATABASE_URL
    assert all("+psycopg" not in part for part in command)


def test_build_pg_dump_command_empty_exclusion_emits_no_flag() -> None:
    command = build_pg_dump_command(make_settings(BACKUP_EXCLUDE_TABLE_DATA=" , "))

    assert not any(part.startswith("--exclude-table-data") for part in command)


def test_verify_excluded_tables_queries_to_regclass_per_table() -> None:
    settings = make_settings(BACKUP_EXCLUDE_TABLE_DATA="a.b, c.d")
    factory, engine = make_engine_factory()

    verify_excluded_tables_exist(settings, engine_factory=factory)

    guard_calls = [event for event in engine.connection.events if event[0] == "sql"]
    assert [call[2] for call in guard_calls] == [{"tbl": "a.b"}, {"tbl": "c.d"}]
    assert all("to_regclass" in call[1] for call in guard_calls)
    assert engine.disposed

    def exploding_factory(settings: Settings) -> FakeEngine:
        pytest.fail("engine_factory must not be called when the exclusion list is empty")

    verify_excluded_tables_exist(
        make_settings(BACKUP_EXCLUDE_TABLE_DATA=""), engine_factory=exploding_factory
    )


def test_run_database_backup_verifies_exclusions_before_spawning_pg_dump() -> None:
    events: list[tuple[object, ...]] = []
    factory, engine = make_engine_factory(events=events)
    popen, _ = make_popen(FakePgDumpProcess(), events=events)

    run_database_backup(
        make_settings(),
        client=FakeS3(),
        popen=popen,
        engine_factory=factory,
        now=FIXED_NOW,
    )

    kinds = [event[0] for event in events]
    assert "sql" in kinds and "popen" in kinds
    assert kinds.index("sql") < kinds.index("popen")


def test_run_database_backup_fails_fast_when_excluded_table_missing() -> None:
    factory, engine = make_engine_factory(
        missing={"silver.rt_trip_update_stop_times"}
    )
    popen, popen_events = make_popen(FakePgDumpProcess())
    client = FakeS3()

    with pytest.raises(BackupError, match="silver.rt_trip_update_stop_times"):
        run_database_backup(
            make_settings(),
            client=client,
            popen=popen,
            engine_factory=factory,
            now=FIXED_NOW,
        )

    assert popen_events == []
    assert client.uploads == []
    assert client.deleted == []


def test_run_database_backup_streams_pg_dump_stdout_to_r2() -> None:
    payload = b"PGDMP-streamed-bytes"
    factory, _ = make_engine_factory()
    popen, _ = make_popen(FakePgDumpProcess(payload))
    client = FakeS3()

    result = run_database_backup(
        make_settings(),
        client=client,
        popen=popen,
        engine_factory=factory,
        now=FIXED_NOW,
    )

    assert len(client.uploads) == 1
    upload = client.uploads[0]
    assert upload["bucket"] == "transit-raw"
    assert upload["key"] == EXPECTED_KEY
    assert upload["body"] == payload
    assert upload["extra_args"] == {"ContentType": "application/octet-stream"}
    assert result.key == EXPECTED_KEY
    assert result.bucket == "transit-raw"
    assert result.bytes_uploaded == len(payload)
    assert result.display_dict()["key"] == EXPECTED_KEY


def test_run_database_backup_pins_multipart_chunk_and_concurrency() -> None:
    factory, _ = make_engine_factory()
    popen, _ = make_popen(FakePgDumpProcess())
    client = FakeS3()

    run_database_backup(
        make_settings(),
        client=client,
        popen=popen,
        engine_factory=factory,
        now=FIXED_NOW,
    )

    config = client.uploads[0]["config"]
    assert config is not None
    assert config.multipart_chunksize == 64 * 1024 * 1024
    assert config.max_concurrency == 2


def test_run_database_backup_failure_aborts_and_deletes_partial_object() -> None:
    factory, _ = make_engine_factory()
    popen, _ = make_popen(
        FakePgDumpProcess(returncode=1),
        stderr_bytes=b"pg_dump: error: connection refused",
    )
    client = FakeS3()

    with pytest.raises(BackupError, match="connection refused"):
        run_database_backup(
            make_settings(),
            client=client,
            popen=popen,
            engine_factory=factory,
            now=FIXED_NOW,
        )

    assert client.deleted == [EXPECTED_KEY]
    assert EXPECTED_KEY not in client.objects


def test_run_database_backup_failure_skips_prune() -> None:
    old_keys = [
        f"backups/postgres/transit-202605{day:02d}T093000Z.dump" for day in range(1, 21)
    ]
    factory, _ = make_engine_factory()
    popen, _ = make_popen(FakePgDumpProcess(returncode=1), stderr_bytes=b"boom")
    client = FakeS3({key: backup_meta(key) for key in old_keys})

    with pytest.raises(BackupError):
        run_database_backup(
            make_settings(),
            client=client,
            popen=popen,
            engine_factory=factory,
            now=FIXED_NOW,
        )

    assert client.deleted == [EXPECTED_KEY]
    assert all(key in client.objects for key in old_keys)


def test_run_database_backup_kills_pg_dump_when_upload_raises() -> None:
    factory, _ = make_engine_factory()
    process = FakePgDumpProcess(stay_running=True)
    popen, _ = make_popen(process)
    client = FakeS3(upload_error=RuntimeError("multipart upload exploded"))

    with pytest.raises(BackupError, match="multipart upload exploded"):
        run_database_backup(
            make_settings(),
            client=client,
            popen=popen,
            engine_factory=factory,
            now=FIXED_NOW,
        )

    assert process.kill_calls == 1
    assert client.deleted == [EXPECTED_KEY]


def test_run_database_backup_prunes_to_retention_after_success() -> None:
    old_keys = [
        f"backups/postgres/transit-202605{day:02d}T093000Z.dump" for day in range(1, 16)
    ]
    factory, _ = make_engine_factory()
    popen, _ = make_popen(FakePgDumpProcess())
    client = FakeS3({key: backup_meta(key) for key in old_keys})

    result = run_database_backup(
        make_settings(),
        client=client,
        popen=popen,
        engine_factory=factory,
        now=FIXED_NOW,
    )

    assert result.pruned_keys == old_keys[:2]
    assert result.retained_count == 14
    assert EXPECTED_KEY in client.objects
    assert all(key not in client.objects for key in old_keys[:2])
    assert all(key in client.objects for key in old_keys[2:])


def test_prune_old_backups_keeps_newest_n() -> None:
    keys = [
        f"backups/postgres/transit-2026060{day}T093000Z.dump" for day in range(1, 6)
    ]
    client = FakeS3({key: backup_meta(key) for key in keys})

    deleted = prune_old_backups(
        client, bucket="transit-raw", prefix="backups/postgres", keep=3
    )

    assert deleted == keys[:2]
    assert sorted(client.objects) == keys[2:]


def test_prune_old_backups_ignores_foreign_keys_under_prefix() -> None:
    conforming = [
        f"backups/postgres/transit-2026060{day}T093000Z.dump" for day in range(1, 4)
    ]
    foreign = [
        "backups/postgres/README.txt",
        "backups/postgres/manual-restore-notes.dump",
    ]
    client = FakeS3({key: backup_meta(key) for key in conforming + foreign})

    deleted = prune_old_backups(
        client, bucket="transit-raw", prefix="backups/postgres", keep=1
    )

    assert deleted == conforming[:2]
    assert all(key in client.objects for key in foreign)


def test_prune_old_backups_rejects_keep_below_one() -> None:
    with pytest.raises(ValueError, match="keep"):
        prune_old_backups(
            FakeS3(), bucket="transit-raw", prefix="backups/postgres", keep=0
        )


def test_list_database_backups_sorted_desc() -> None:
    keys = [
        "backups/postgres/transit-20260601T093000Z.dump",
        "backups/postgres/transit-20260603T093000Z.dump",
        "backups/postgres/transit-20260602T093000Z.dump",
    ]
    objects = {key: backup_meta(key, size=2048) for key in keys}
    objects["backups/postgres/README.txt"] = backup_meta(
        "backups/postgres/README.txt"
    )
    client = FakeS3(objects)

    listed = list_database_backups(make_settings(), client=client)

    assert [entry["key"] for entry in listed] == sorted(keys, reverse=True)
    assert listed[0]["size"] == 2048
    assert isinstance(listed[0]["last_modified"], str)


def test_download_latest_backup_picks_newest(tmp_path: Path) -> None:
    keys = [
        "backups/postgres/transit-20260601T093000Z.dump",
        "backups/postgres/transit-20260610T093000Z.dump",
        "backups/postgres/transit-20260605T093000Z.dump",
    ]
    client = FakeS3({key: backup_meta(key) for key in keys})
    dest = tmp_path / "restore" / "latest.dump"

    result = download_latest_backup(make_settings(), dest, client=client)

    newest = "backups/postgres/transit-20260610T093000Z.dump"
    assert client.downloads == [("transit-raw", newest, str(dest))]
    assert result["key"] == newest
    assert result["dest"] == str(dest)
    assert dest.exists()
