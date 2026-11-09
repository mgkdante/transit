from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, get_ident

import boto3
import pytest

from transit_ops.settings import Settings
from transit_ops.snapshots.storage import build_snapshot_storage


def test_snapshot_clients_are_thread_owned_reused_and_closed(monkeypatch):
    clients = []
    sessions = []
    barrier = Barrier(4)

    class Client:
        def __init__(self):
            self.owner = get_ident()
            self.calls = 0
            self.closed = 0

        def put_object(self, **kwargs):
            assert get_ident() == self.owner, "shared TLS context across threads"
            self.calls += 1

        def close(self):
            self.closed += 1

    class Session:
        def __init__(self):
            sessions.append(self)

        def client(self, *args, **kwargs):
            client = Client()
            clients.append(client)
            return client

    monkeypatch.setattr(boto3.session, "Session", Session)
    # Catch use of the implicit shared default session too.
    monkeypatch.setattr(boto3, "client", lambda *a, **kw: Session().client(*a, **kw))
    settings = Settings(
        _env_file=None,
        SNAPSHOT_STORAGE_BACKEND="s3",
        SNAPSHOT_R2_BUCKET="snapshots",
        BRONZE_S3_ENDPOINT="https://storage.example.com",
        BRONZE_S3_ACCESS_KEY="test",
        BRONZE_S3_SECRET_KEY="test",
    )
    store = build_snapshot_storage(settings, provider_id="stm")

    def upload(index):
        barrier.wait(timeout=5)
        for suffix in range(2):
            store.put_json(f"live/{index}-{suffix}.json", {}, tier="live")

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(upload, range(4)))
    assert len(clients) == len(sessions) == 5  # caller plus four upload threads
    assert sorted(client.calls for client in clients) == [0, 2, 2, 2, 2]
    store.close()
    store.close()
    assert all(client.closed == 1 for client in clients)
    with pytest.raises(RuntimeError, match="closed"):
        store.put_json("live/late.json", {}, tier="live")


def test_snapshot_workers_have_distinct_real_tls_contexts():
    settings = Settings(
        _env_file=None,
        SNAPSHOT_STORAGE_BACKEND="s3",
        SNAPSHOT_R2_BUCKET="snapshots",
        BRONZE_S3_ENDPOINT="https://storage.example.com",
        BRONZE_S3_ACCESS_KEY="test",
        BRONZE_S3_SECRET_KEY="test",
    )
    store = build_snapshot_storage(settings, provider_id="stm")
    barrier = Barrier(4)

    def context_for_worker(index):
        barrier.wait(timeout=5)
        client = store._client
        context = client._endpoint.http_session._manager.connection_pool_kw["ssl_context"]
        assert store._client is client
        return context

    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            contexts = list(pool.map(context_for_worker, range(4)))
        assert len({id(context) for context in contexts}) == 4
        assert all(context.check_hostname is False for context in contexts)
        # Botocore performs hostname verification in urllib3; CA verification stays required.
        import ssl

        assert all(context.verify_mode == ssl.CERT_REQUIRED for context in contexts)
    finally:
        store.close()


def test_worker_scope_reuses_clients_across_cycles_and_closes_at_executor_exit(monkeypatch):
    import transit_ops.orchestration as orchestration
    import transit_ops.snapshots.storage as storage_module
    from transit_ops.snapshots.live_scope import worker_live_storage
    from transit_ops.snapshots.uploads import put_batch

    clients = []
    stores = []
    barrier = Barrier(4)

    class Client:
        def __init__(self):
            self.owner = get_ident()
            self.closed = 0
            clients.append(self)

        def put_object(self, **kwargs):
            assert self.closed == 0
            assert get_ident() == self.owner
            barrier.wait(timeout=5)

        def close(self):
            self.closed += 1

    monkeypatch.setattr(storage_module, "build_s3_client", lambda *a, **kw: Client())
    settings = Settings(
        _env_file=None,
        SNAPSHOT_STORAGE_BACKEND="s3",
        SNAPSHOT_R2_BUCKET="snapshots",
        SNAPSHOT_PUBLISH_CONCURRENCY=4,
    )

    def cycles(provider_id, **kwargs):
        store = worker_live_storage(provider_id, settings)
        stores.append(store)
        for _cycle in range(3):
            assert worker_live_storage(provider_id, settings) is store
            put_batch(store, [(f"live/{i}.json", {}, "live") for i in range(4)], concurrency=4)
            assert len([client for client in clients if not client.closed]) == 5

    monkeypatch.setattr(orchestration, "_run_realtime_worker_loop", cycles)
    for lifetime in range(2):
        orchestration.run_realtime_worker_loop("stm", settings=settings)
        assert len(clients) == 5 * (lifetime + 1)
        assert all(client.closed == 1 for client in clients)
        assert worker_live_storage("stm", settings) is None
    assert stores[0] is not stores[1]
