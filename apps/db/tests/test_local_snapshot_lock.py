from __future__ import annotations

import errno
import multiprocessing
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest


def test_storage_import_and_stable_activation_in_native_interpreter(tmp_path):
    # An unconditional platform-only import breaks all storage backends, including S3.
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from transit_ops.snapshots.storage import LocalSnapshotStorage; "
            "import sys; s = LocalSnapshotStorage(sys.argv[1], 'v1/stm'); "
            "v = s.capture_stable_version('historic/index.json'); "
            "s.activate_stable_json('historic/index.json', {'complete': True}, "
            "expected_version=v, tier='historic'); "
            "assert s.get_json('historic/index.json') == {'complete': True}",
            str(tmp_path),
        ],
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stderr


def _hold_directory_lock(directory, acquired, release):
    from transit_ops.snapshots.storage import _exclusive_directory_lock

    with _exclusive_directory_lock(Path(directory)):
        acquired.set()
        if release is None:
            # Do not terminate a process while it owns a multiprocessing.Event's
            # internal condition lock; that can poison test cleanup on Windows.
            time.sleep(30)
        else:
            assert release.wait(20), "lock holder was not released"


def _wait_for_directory_lock(directory, started, acquired):
    from transit_ops.snapshots.storage import _exclusive_directory_lock

    started.set()
    with _exclusive_directory_lock(Path(directory)):
        acquired.set()


@pytest.mark.parametrize("terminate_holder", [False, True])
def test_directory_lock_waits_and_recovers_after_owner_release(tmp_path, terminate_holder):
    # Removing the OS lock, or leaving it stuck on process exit, breaks this test.
    context = multiprocessing.get_context("spawn")
    held, release, started, acquired = [context.Event() for _ in range(4)]
    holder = context.Process(
        target=_hold_directory_lock,
        args=(str(tmp_path), held, None if terminate_holder else release),
    )
    waiter = context.Process(
        target=_wait_for_directory_lock, args=(str(tmp_path), started, acquired)
    )
    holder.start()
    try:
        assert held.wait(10)
        waiter.start()
        assert started.wait(10)
        assert not acquired.wait(0.3), "waiter entered while another process held the lock"
        if terminate_holder:
            holder.terminate()
            holder.join(timeout=5)
        else:
            release.set()
        assert acquired.wait(10), "lock was not released"
        waiter.join(timeout=5)
        holder.join(timeout=5)
        assert waiter.exitcode == 0
        if not terminate_holder:
            assert holder.exitcode == 0
    finally:
        release.set()
        for process in (holder, waiter):
            if process.pid is not None:
                if process.is_alive():
                    process.terminate()
                process.join(timeout=5)


def test_directory_lock_is_released_after_exception(tmp_path):
    from transit_ops.snapshots.storage import _exclusive_directory_lock

    with pytest.raises(RuntimeError, match="publication failed"):
        with _exclusive_directory_lock(tmp_path):
            raise RuntimeError("publication failed")
    context = multiprocessing.get_context("spawn")
    started, acquired = context.Event(), context.Event()
    waiter = context.Process(
        target=_wait_for_directory_lock, args=(str(tmp_path), started, acquired)
    )
    waiter.start()
    try:
        assert acquired.wait(10)
        waiter.join(timeout=5)
        assert waiter.exitcode == 0
    finally:
        if waiter.is_alive():
            waiter.terminate()
        waiter.join(timeout=5)


@pytest.mark.parametrize(
    "rel_key",
    [
        "historic/.transit-snapshot.lock",
        "historic/.transit-snapshot.lock/child.json",
        "historic/./.transit-snapshot.lock",
    ],
)
def test_internal_lock_file_is_reserved_from_logical_keys(tmp_path, rel_key):
    from transit_ops.snapshots.storage import LocalSnapshotStorage

    store = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    with pytest.raises(ValueError, match="unsafe_local_snapshot_path"):
        store.put_bytes(rel_key, b"public", tier="historic")


@pytest.mark.skipif(os.name != "nt", reason="Windows filesystem aliases")
@pytest.mark.parametrize(
    "rel_key",
    [
        r"historic\.transit-snapshot.lock",
        "historic/.TRANSIT-SNAPSHOT.LOCK",
        "historic/.transit-snapshot.lock.",
        "historic/.transit-snapshot.lock ",
        "historic/.transit-snapshot.lock:payload",
        r"historic\.TRANSIT-SNAPSHOT.LOCK. \child.json",
    ],
)
def test_windows_lock_file_aliases_are_reserved(tmp_path, rel_key):
    from transit_ops.snapshots.storage import LocalSnapshotStorage

    store = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    with pytest.raises(ValueError, match="unsafe_local_snapshot_path"):
        store.full_key(rel_key)


def test_inventory_excludes_internal_lock_file_and_preserves_it(tmp_path):
    from transit_ops.snapshots.storage import LocalSnapshotStorage

    store = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    directory = tmp_path / "v1/stm/historic"
    directory.mkdir(parents=True)
    internal = directory / ".transit-snapshot.lock"
    internal.touch()
    store.put_bytes("historic/public.json", b"{}", tier="historic")
    assert [v.rel_key for v in store.iter_object_versions("historic/")] == [
        "historic/public.json"
    ]
    assert internal.exists()


@pytest.mark.skipif(os.name != "nt", reason="Windows extended path resolution")
def test_containment_accepts_equivalent_extended_paths_during_publication(tmp_path, monkeypatch):
    from transit_ops.snapshots.storage import LocalSnapshotStorage

    store = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    original = Path.resolve

    def resolve_with_extended_prefix(path, *args, **kwargs):
        resolved = original(path, *args, **kwargs)
        # CPython 3.12 can retain this prefix if the object appears while resolving.
        return Path("\\\\?\\" + str(resolved))

    monkeypatch.setattr(Path, "resolve", resolve_with_extended_prefix)
    store.put_bytes("historic/public.json", b"{}", tier="historic")
    assert store.read_bytes("historic/public.json") == b"{}"
    assert [v.rel_key for v in store.iter_object_versions("historic/")] == [
        "historic/public.json"
    ]


@pytest.mark.skipif(os.name != "nt", reason="Windows CRT error handling")
def test_windows_lock_does_not_retry_non_contention_errors(tmp_path, monkeypatch):
    import transit_ops.snapshots.storage as storage_module

    failure = OSError(errno.EINVAL, "invalid locking operation")

    def fail_lock(*args):
        raise failure

    def unexpected_sleep(*args):
        pytest.fail("a non-contention locking error must propagate immediately")

    with monkeypatch.context() as patch:
        patch.setattr(storage_module.msvcrt, "locking", fail_lock)
        patch.setattr(storage_module.time, "sleep", unexpected_sleep)
        with pytest.raises(OSError) as raised:
            with storage_module._exclusive_directory_lock(tmp_path):
                pytest.fail("failed lock must not enter publication")
    assert raised.value is failure
    # Closing on acquisition failure makes the same lock available afterward.
    with storage_module._exclusive_directory_lock(tmp_path):
        pass


@pytest.mark.skipif(os.name != "nt", reason="Windows persistent lock file")
def test_windows_activation_keeps_one_lock_file_for_existing_waiters(tmp_path):
    from transit_ops.snapshots.storage import LocalSnapshotStorage

    store = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    key = "historic/index.json"
    store.activate_stable_json(
        key, {"version": 1}, expected_version=store.capture_stable_version(key), tier="historic"
    )
    internal = tmp_path / "v1/stm/historic/.transit-snapshot.lock"
    identity = internal.stat().st_ino
    store.activate_stable_json(
        key, {"version": 2}, expected_version=store.capture_stable_version(key), tier="historic"
    )
    assert internal.stat().st_ino == identity
    assert internal.read_bytes() == b""
    assert [v.rel_key for v in store.iter_object_versions("historic/")] == [key]


@pytest.mark.skipif(os.name != "nt", reason="Windows junction inventory")
def test_inventory_hides_reserved_namespace_reached_through_junction(tmp_path):
    from transit_ops.snapshots.storage import LocalSnapshotStorage

    store = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    store.put_bytes("historic/public/item.json", b"{}", tier="historic")
    directory = tmp_path / "v1/stm/historic"
    subprocess.run(
        [
            "cmd", "/c", "mklink", "/J",
            str(directory / ".transit-snapshot.lock"), str(directory / "public"),
        ],
        check=True,
        capture_output=True,
    )
    assert [v.rel_key for v in store.iter_object_versions("historic/")] == [
        "historic/public/item.json"
    ]
