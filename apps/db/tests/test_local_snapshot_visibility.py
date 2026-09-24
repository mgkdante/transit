from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event

import pytest

from transit_ops.snapshots.serialization import snapshot_json_bytes
from transit_ops.snapshots.storage import LocalSnapshotStorage


class PausedWriter:
    def __init__(self, handle, prepared, release):
        self.handle = handle
        self.prepared = prepared
        self.release = release

    def __enter__(self):
        self.handle.__enter__()
        return self

    def __exit__(self, *args):
        return self.handle.__exit__(*args)

    def close(self):
        self.handle.close()

    def write(self, body):
        split = len(body) // 2
        self.handle.write(body[:split])
        self.handle.flush()
        self.prepared.set()
        assert self.release.wait(5), "reader did not release the local writer"
        return split + self.handle.write(body[split:])


def pause_writes(monkeypatch, prepared, release):
    original = Path.open

    def open_file(path, mode="r", *args, **kwargs):
        handle = original(path, mode, *args, **kwargs)
        if "w" in mode or "x" in mode:
            return PausedWriter(handle, prepared, release)
        return handle

    monkeypatch.setattr(Path, "open", open_file)


@pytest.mark.parametrize(
    "operation, existing",
    [
        ("ordinary", False),
        ("ordinary", True),
        ("conditional", False),
        ("immutable", False),
    ],
)
def test_preparing_local_publication_is_invisible_to_unlocked_readers(
    tmp_path, monkeypatch, operation, existing
):
    store = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    key = "historic/history/index.json"
    old = b'{"generation":"old"}'
    payload = {"generation": "new", "values": list(range(100))}
    body = snapshot_json_bytes(payload)
    if existing:
        store.put_bytes(key, old, tier="historic")
    expected = store.capture_stable_version(key)
    prepared, release = Event(), Event()
    pause_writes(monkeypatch, prepared, release)

    def write():
        if operation == "ordinary":
            return store.put_bytes(key, body, tier="historic")
        if operation == "conditional":
            return store.activate_stable_json_outcome(
                key,
                payload,
                expected_version=expected,
                tier="historic",
            )
        return store.put_immutable_json_outcome(key, payload)

    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(write)
        try:
            assert prepared.wait(3)
            assert store.read_bytes(key) == (old if existing else None)
            assert [item.rel_key for item in store.iter_object_versions("historic/")] == (
                [key] if existing else []
            )
        finally:
            release.set()
        pending.result(timeout=3)
    assert store.read_bytes(key) == body
    assert [item.rel_key for item in store.iter_object_versions("historic/")] == [key]


@pytest.mark.parametrize("operation", ["ordinary", "conditional", "immutable"])
@pytest.mark.parametrize("failure_phase", ["write", "close", "commit"])
def test_failed_preparation_preserves_old_bytes_and_removes_temporary_files(
    tmp_path, monkeypatch, operation, failure_phase
):
    import transit_ops.snapshots.storage as storage_module

    store = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    key = "historic/history/index.json"
    old = b'{"generation":"old"}'
    existing = operation != "immutable"
    if existing:
        store.put_bytes(key, old, tier="historic")
    expected = store.capture_stable_version(key)
    failure = OSError(f"injected {failure_phase} failure")
    original_open = Path.open

    class FailedWriter:
        def __init__(self, handle):
            self.handle = handle

        def write(self, body):
            if failure_phase == "write":
                self.handle.write(body[: len(body) // 2])
                self.handle.flush()
                raise failure
            return self.handle.write(body)

        def close(self):
            self.handle.close()
            if failure_phase == "close":
                raise failure

    def open_file(path, mode="r", *args, **kwargs):
        handle = original_open(path, mode, *args, **kwargs)
        return FailedWriter(handle) if "w" in mode or "x" in mode else handle

    def fail_commit(*args, **kwargs):
        raise failure

    monkeypatch.setattr(Path, "open", open_file)
    if failure_phase == "commit":
        monkeypatch.setattr(
            storage_module.os, "link" if operation == "immutable" else "replace", fail_commit
        )
    with pytest.raises(OSError) as raised:
        if operation == "ordinary":
            store.put_json(key, {"generation": "new"}, tier="historic")
        elif operation == "conditional":
            store.activate_stable_json_outcome(
                key,
                {"generation": "new"},
                expected_version=expected,
                tier="historic",
            )
        else:
            store.put_immutable_json_outcome(key, {"generation": "new"})
    assert raised.value is failure
    assert store.read_bytes(key) == (old if existing else None)
    assert not list(tmp_path.rglob(".transit-snapshot-*.tmp"))


def test_cleanup_failure_does_not_replace_the_original_write_failure(tmp_path, monkeypatch):
    store = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    key = "historic/history/index.json"
    old = b'{"generation":"old"}'
    store.put_bytes(key, old, tier="historic")
    failure = OSError("original write failure")
    original_open = Path.open
    original_unlink = Path.unlink

    class BrokenWriter:
        def __init__(self, handle):
            self.handle = handle

        def write(self, body):
            self.handle.write(body[:1])
            self.handle.flush()
            raise failure

        def close(self):
            self.handle.close()
            raise OSError("secondary close failure")

    def open_file(path, mode="r", *args, **kwargs):
        handle = original_open(path, mode, *args, **kwargs)
        return BrokenWriter(handle) if "x" in mode else handle

    def fail_cleanup(path, *args, **kwargs):
        if path.name.startswith(".transit-snapshot-"):
            raise OSError("secondary unlink failure")
        return original_unlink(path, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(Path, "open", open_file)
        patch.setattr(Path, "unlink", fail_cleanup)
        with pytest.raises(OSError) as raised:
            store.put_bytes(key, b'{"generation":"new"}', tier="historic")
    assert raised.value is failure
    assert "secondary unlink failure" in " ".join(failure.__notes__)
    assert store.read_bytes(key) == old
    assert [version.rel_key for version in store.iter_object_versions("historic/")] == [key]
    for temporary in tmp_path.rglob(".transit-snapshot-*.tmp"):
        temporary.unlink()


@pytest.mark.parametrize("operation", ["ordinary", "conditional", "immutable"])
def test_new_local_files_preserve_ordinary_umask_permissions(tmp_path, operation):
    import os
    import stat

    store = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    key = "historic/history/index.json"
    expected = store.capture_stable_version(key)
    previous_umask = os.umask(0o027)
    try:
        if operation == "ordinary":
            store.put_json(key, {}, tier="historic")
        elif operation == "conditional":
            store.activate_stable_json_outcome(key, {}, expected_version=expected, tier="historic")
        else:
            store.put_immutable_json_outcome(key, {})
    finally:
        os.umask(previous_umask)
    assert stat.S_IMODE(Path(store.full_key(key)).stat().st_mode) == 0o640


@pytest.mark.parametrize("operation", ["ordinary", "conditional"])
def test_local_replacement_retains_the_existing_file_mode(tmp_path, operation):
    import stat

    store = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    key = "historic/history/index.json"
    store.put_json(key, {"generation": "old"}, tier="historic")
    destination = Path(store.full_key(key))
    destination.chmod(0o600)
    expected = store.capture_stable_version(key)
    if operation == "ordinary":
        store.put_json(key, {"generation": "new"}, tier="historic")
    else:
        store.activate_stable_json_outcome(
            key,
            {"generation": "new"},
            expected_version=expected,
            tier="historic",
        )
    assert stat.S_IMODE(destination.stat().st_mode) == 0o600


def test_inventory_hides_only_exact_reserved_temporary_filenames(tmp_path):
    store = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    names = [
        ".transit-snapshot-not-a-uuid.tmp",
        ".transit-snapshot-" + "a" * 31 + ".tmp",
        ".transit-snapshot-" + "a" * 32 + ".json",
        "transit-snapshot-" + "a" * 32 + ".tmp",
    ]
    for name in names:
        store.put_bytes("historic/" + name, b"{}", tier="historic")
    reserved = ".transit-snapshot-" + "a" * 32 + ".tmp"
    private_file = tmp_path / "v1/stm/historic" / reserved
    private_file.write_bytes(b"partial")
    assert {version.rel_key for version in store.iter_object_versions("historic/")} == {
        "historic/" + name for name in names
    }
    with pytest.raises(ValueError, match="unsafe_local_snapshot_path"):
        store.put_bytes("historic/" + reserved, b"public", tier="historic")
    assert private_file.read_bytes() == b"partial"


def _publish_first_root_in_process(root, prepared, release, outcomes):
    patch = pytest.MonkeyPatch()
    pause_writes(patch, prepared, release)
    try:
        store = LocalSnapshotStorage(root, "v1/stm")
        key = "historic/history/index.json"
        result = store.activate_stable_json_outcome(
            key,
            {"generation": "complete"},
            expected_version=store.capture_stable_version(key),
            tier="historic",
        )
        outcomes.put(("written", result.written))
    except BaseException as error:
        outcomes.put(("error", repr(error)))
        raise
    finally:
        patch.undo()


def test_first_root_creation_is_atomic_to_another_process_reader(tmp_path):
    import multiprocessing

    context = multiprocessing.get_context("fork")
    prepared, release = context.Event(), context.Event()
    outcomes = context.Queue()
    writer = context.Process(
        target=_publish_first_root_in_process,
        args=(str(tmp_path), prepared, release, outcomes),
    )
    store = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    key = "historic/history/index.json"
    writer.start()
    try:
        assert prepared.wait(5)
        assert store.read_bytes(key) is None
        assert list(store.iter_object_versions("historic/")) == []
    finally:
        release.set()
        writer.join(timeout=5)
        if writer.is_alive():
            writer.terminate()
            writer.join(timeout=2)
    try:
        assert writer.exitcode == 0
        assert outcomes.get(timeout=2) == ("written", True)
    finally:
        outcomes.close()
        outcomes.join_thread()
    assert store.get_json(key) == {"generation": "complete"}
    assert not list(tmp_path.rglob(".transit-snapshot-*.tmp"))


@pytest.mark.parametrize("same_payload", [False, True])
def test_independent_immutable_creators_commit_once_without_overwrite(
    tmp_path, monkeypatch, same_payload
):
    from threading import Barrier

    import transit_ops.snapshots.storage as storage_module
    from transit_ops.snapshots.storage import ImmutableKeyCollisionError

    stores = [LocalSnapshotStorage(str(tmp_path), "v1/stm") for _ in range(2)]
    key = "historic/history/network/generations/test.json"
    prepared = Barrier(3)
    release = Event()
    original_link = storage_module.os.link

    def link_after_both_prepared(*args, **kwargs):
        prepared.wait(timeout=5)
        assert release.wait(5)
        return original_link(*args, **kwargs)

    monkeypatch.setattr(storage_module.os, "link", link_after_both_prepared)

    def create(index):
        try:
            return stores[index].put_immutable_json_outcome(
                key,
                {"generation": 0 if same_payload else index},
            )
        except ImmutableKeyCollisionError as error:
            return error

    with ThreadPoolExecutor(max_workers=2) as pool:
        pending = [pool.submit(create, index) for index in range(2)]
        try:
            prepared.wait(timeout=5)
            assert stores[0].read_bytes(key) is None
            assert list(stores[0].iter_object_versions("historic/")) == []
        finally:
            release.set()
        results = [item.result(timeout=3) for item in pending]
    outcomes = [item for item in results if not isinstance(item, Exception)]
    assert sum(item.written for item in outcomes) == 1
    assert len(outcomes) == (2 if same_payload else 1)
    assert sum(isinstance(item, ImmutableKeyCollisionError) for item in results) == (
        0 if same_payload else 1
    )
    assert stores[0].get_json(key) in ({"generation": 0}, {"generation": 1})
    assert not list(tmp_path.rglob(".transit-snapshot-*.tmp"))


def test_temporary_name_collision_never_removes_an_unowned_file(tmp_path, monkeypatch):
    from types import SimpleNamespace

    import transit_ops.snapshots.storage as storage_module

    store = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    key = "historic/history/index.json"
    destination = Path(store.full_key(key))
    destination.parent.mkdir(parents=True)
    temporary = destination.with_name(".transit-snapshot-" + "a" * 32 + ".tmp")
    temporary.write_bytes(b"another writer's preparation")
    monkeypatch.setattr(storage_module, "uuid4", lambda: SimpleNamespace(hex="a" * 32))
    with pytest.raises(FileExistsError) as collision:
        store.put_immutable_json_outcome(key, {})
    assert collision.value.filename == str(temporary)
    assert temporary.read_bytes() == b"another writer's preparation"
    assert store.read_bytes(key) is None
