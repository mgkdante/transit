from dataclasses import dataclass, field

import pytest
from sqlalchemy import text
from test_bronze_prune_real_db import (
    NOW,
    PROVIDER,
    STATIC_OBJECT_UNREFERENCED,
    TU_OLD_A,
    TU_OLD_B,
    _object_exists,
    _seed_static_runs,
)
from test_bronze_prune_real_db import conn as conn

from transit_ops.ingestion.storage import BronzeStorage
from transit_ops.maintenance.bronze import (
    prune_bronze_realtime_objects,
    prune_bronze_static_objects,
)


@dataclass(frozen=True)
class MemoryArchive(BronzeStorage):
    batches: list[list[str]] = field(default_factory=list)
    failures: set[str] = field(default_factory=set)

    def delete_objects(self, paths):
        paths = list(paths)
        self.batches.append(paths)
        return self.failures.intersection(paths)


@pytest.mark.parametrize("kind", ["realtime", "static"])
def test_explicit_store_cannot_delete_metadata_for_another_backend(conn, kind):
    if kind == "static":
        _seed_static_runs(conn)
    object_id = TU_OLD_A[1] if kind == "realtime" else STATIC_OBJECT_UNREFERENCED
    assert _object_exists(conn, object_id)
    conn.execute(
        text(
            "UPDATE raw.ingestion_objects SET storage_backend='local' WHERE ingestion_object_id=:id"
        ),
        {"id": object_id},
    )
    storage = MemoryArchive("s3")
    prune = prune_bronze_realtime_objects if kind == "realtime" else prune_bronze_static_objects
    _, _, _, failed = prune(
        conn,
        provider_id=PROVIDER,
        retention_days=30,
        bronze_storage=storage,
        now_utc=NOW,
    )
    assert _object_exists(conn, object_id)
    assert object_id in failed


def test_backend_groups_keep_identical_paths_and_failures_separate(conn):
    conn.execute(
        text("""
        UPDATE raw.ingestion_objects SET storage_backend=:backend,storage_path='same.pb'
        WHERE ingestion_object_id=:id
    """),
        [{"id": TU_OLD_A[1], "backend": "local"}, {"id": TU_OLD_B[1], "backend": "s3"}],
    )
    local = MemoryArchive("local", failures={"same.pb"})
    remote = MemoryArchive("s3")
    resolved = []

    def resolve(backend):
        resolved.append(backend)
        return {"local": local, "s3": remote}[backend]

    _, counts, _, failed = prune_bronze_realtime_objects(
        conn,
        provider_id=PROVIDER,
        retention_days=30,
        now_utc=NOW,
        bronze_storage_resolver=resolve,
    )
    assert resolved == ["local", "s3"]
    assert local.batches == [["same.pb"]]
    assert "same.pb" in remote.batches[0]
    assert counts == {"realtime": 2}
    assert failed == {TU_OLD_A[1]}
    assert _object_exists(conn, TU_OLD_A[1])
    assert not _object_exists(conn, TU_OLD_B[1])


def test_unavailable_backend_keeps_its_metadata_while_other_backend_succeeds(conn):
    conn.execute(
        text(
            "UPDATE raw.ingestion_objects SET storage_backend='local' WHERE ingestion_object_id=:id"
        ),
        {"id": TU_OLD_A[1]},
    )
    remote = MemoryArchive("s3")

    def resolve(backend):
        if backend == "local":
            raise ValueError("local archive unavailable")
        return remote

    _, counts, _, failed = prune_bronze_realtime_objects(
        conn,
        provider_id=PROVIDER,
        retention_days=30,
        now_utc=NOW,
        bronze_storage_resolver=resolve,
    )
    assert counts == {"realtime": 2}
    assert failed == {TU_OLD_A[1]}
    assert _object_exists(conn, TU_OLD_A[1])
    assert not _object_exists(conn, TU_OLD_B[1])


@pytest.fixture()
def alert_connection(real_db_engine):
    from test_i3_retention_real_db import _seed

    with real_db_engine.connect() as connection, connection.begin() as transaction:
        _seed(connection)
        yield connection
        transaction.rollback()


def test_alert_archive_uses_its_recorded_backend_and_legacy_object_identity(alert_connection):
    from datetime import timedelta

    from test_i3_retention_real_db import OBJ_IDS, SNAP_IDS, T3
    from test_i3_retention_real_db import PROVIDER as ALERT_PROVIDER

    from transit_ops.maintenance.i3 import prune_i3_raw_snapshots

    alert_connection.execute(
        text(
            "UPDATE raw.ingestion_objects SET storage_backend='local' WHERE ingestion_object_id=:id"
        ),
        {"id": OBJ_IDS[0]},
    )
    local, remote = MemoryArchive("local"), MemoryArchive("s3")
    _, counts, _, failed = prune_i3_raw_snapshots(
        alert_connection,
        provider_id=ALERT_PROVIDER,
        retention_days=30,
        now_utc=T3 + timedelta(days=40),
        bronze_storage_resolver=lambda backend: {"local": local, "s3": remote}[backend],
    )
    assert counts == {"i3_raw": 2}
    assert failed == set()
    assert str(SNAP_IDS[0]) in local.batches[0][0]
    assert str(SNAP_IDS[1]) in remote.batches[0][0]
    assert alert_connection.execute(
        text("SELECT i3_alert_snapshot_id FROM raw.i3_alert_snapshots WHERE provider_id=:p"),
        {"p": ALERT_PROVIDER},
    ).scalars().all() == [SNAP_IDS[2]]


def test_local_archive_deletion_cannot_touch_a_remote_keys_local_namesake(conn, tmp_path):
    from transit_ops.ingestion.storage import LocalBronzeStorage

    local = LocalBronzeStorage("local", tmp_path)
    local_file = tmp_path / "owned.pb"
    local_file.write_bytes(b"local archive")
    remote_namesake = tmp_path / TU_OLD_B[5]
    remote_namesake.parent.mkdir(parents=True)
    remote_namesake.write_bytes(b"not the remote archive")
    conn.execute(
        text(
            "UPDATE raw.ingestion_objects SET storage_backend='local',storage_path=:path "
            "WHERE ingestion_object_id=:id"
        ),
        {"id": TU_OLD_A[1], "path": str(local_file)},
    )
    _, counts, _, failed = prune_bronze_realtime_objects(
        conn,
        provider_id=PROVIDER,
        retention_days=30,
        now_utc=NOW,
        bronze_storage=local,
    )
    assert not local_file.exists()
    assert remote_namesake.read_bytes() == b"not the remote archive"
    assert counts == {"realtime": 1}
    assert TU_OLD_B[1] in failed
    assert _object_exists(conn, TU_OLD_B[1])


@pytest.mark.parametrize("explicit_backend", [True, False])
def test_alert_backend_does_not_guess_from_mismatched_legacy_identity(
    alert_connection, explicit_backend
):
    from datetime import timedelta

    from test_i3_retention_real_db import PROVIDER as ALERT_PROVIDER
    from test_i3_retention_real_db import SNAP_IDS, T3

    from transit_ops.maintenance.i3 import prune_i3_raw_snapshots

    alert_connection.execute(
        text("""
            UPDATE raw.i3_alert_snapshots
            SET storage_backend=:backend, storage_path='recorded-alert.json'
            WHERE i3_alert_snapshot_id=:id
        """),
        {"id": SNAP_IDS[0], "backend": "local" if explicit_backend else None},
    )
    local, remote = MemoryArchive("local"), MemoryArchive("s3")
    _, counts, _, failed = prune_i3_raw_snapshots(
        alert_connection,
        provider_id=ALERT_PROVIDER,
        retention_days=30,
        now_utc=T3 + timedelta(days=40),
        bronze_storage_resolver=lambda backend: {"local": local, "s3": remote}[backend],
    )
    remaining = (
        alert_connection.execute(
            text("SELECT i3_alert_snapshot_id FROM raw.i3_alert_snapshots WHERE provider_id=:p"),
            {"p": ALERT_PROVIDER},
        )
        .scalars()
        .all()
    )
    assert (SNAP_IDS[0] in remaining) is not explicit_backend
    assert counts == {"i3_raw": 2 if explicit_backend else 1}
    assert failed == (set() if explicit_backend else {SNAP_IDS[0]})
    assert local.batches == ([["recorded-alert.json"]] if explicit_backend else [])
    assert all("recorded-alert.json" not in batch for batch in remote.batches)
