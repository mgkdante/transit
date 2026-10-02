import hashlib
from io import BytesIO
from pathlib import Path

import pytest

from transit_ops.ingestion import common


@pytest.mark.parametrize("size", [0, 19, common.CHUNK_SIZE_BYTES + 17])
def test_download_hashes_streamed_bytes_without_rereading_tempfile(tmp_path, monkeypatch, size):
    payload = (bytes(range(256)) * (size // 256 + 1))[:size]
    response = BytesIO(payload)
    response.status = 206
    requests = []

    def open_response(request, *, timeout, context):
        requests.append((request, timeout, context))
        return response

    reads = []
    original_open = Path.open

    def observe_open(path, mode="r", *args, **kwargs):
        if mode == "rb":
            reads.append(path)
        return original_open(path, mode, *args, **kwargs)

    monkeypatch.setattr(common, "urlopen", open_response)
    monkeypatch.setattr(Path, "open", observe_open)
    artifact = common.download_to_tempfile(
        source_url="https://example.test/feed.pb",
        temp_dir=tmp_path,
        headers={"X-Fixture": "capture"},
        default_filename="feed.pb",
    )
    assert artifact.byte_size == size
    assert artifact.checksum_sha256 == hashlib.sha256(payload).hexdigest()
    assert artifact.http_status_code == 206
    assert artifact.source_url == "https://example.test/feed.pb"
    assert response.closed
    assert len(requests) == 1
    assert requests[0][0].get_header("X-fixture") == "capture"
    assert requests[0][1:] == (120, None)
    assert reads == []
    with original_open(artifact.temp_path, "rb") as handle:
        assert handle.read() == payload


@pytest.mark.parametrize("cleanup_fails", [False, True])
def test_failed_download_keeps_original_error_and_closes_response(
    tmp_path, monkeypatch, caplog, cleanup_fails
):
    failure = TimeoutError("upstream stalled")

    class FailedResponse(BytesIO):
        def read(self, size=-1):
            raise failure

    response = FailedResponse()
    monkeypatch.setattr(common, "urlopen", lambda *args, **kwargs: response)
    if cleanup_fails:

        def refuse_cleanup(*args, **kwargs):
            raise PermissionError("cleanup failed")

        monkeypatch.setattr(Path, "unlink", refuse_cleanup)
    with pytest.raises(TimeoutError) as error:
        common.download_to_tempfile(
            source_url="https://example.test/feed.pb", temp_dir=tmp_path, default_filename="feed.pb"
        )
    assert error.value is failure
    assert response.closed
    assert bool(list(tmp_path.iterdir())) is cleanup_fails
    if cleanup_fails:
        assert "Cannot remove failed download" in caplog.text


@pytest.mark.parametrize("status", [None, 0, "absent"])
def test_download_defaults_status_and_forwards_ssl_context(tmp_path, monkeypatch, status):
    response = BytesIO(b"feed")
    if status != "absent":
        response.status = status
    expected_context = object()

    def open_response(request, *, timeout, context):
        assert context is expected_context
        assert request.header_items() == []
        return response

    monkeypatch.setattr(common, "urlopen", open_response)
    artifact = common.download_to_tempfile(
        source_url="https://example.test/feed.pb",
        temp_dir=tmp_path,
        default_filename="feed.pb",
        ssl_context=expected_context,
    )
    assert artifact.http_status_code == 200
    assert artifact.temp_path.suffix == ".pb"
    assert artifact.temp_path.read_bytes() == b"feed"


@pytest.mark.parametrize("stage", ["file_open", "write", "file_close", "response_close"])
def test_download_discards_artifact_on_output_and_context_failures(tmp_path, monkeypatch, stage):
    failure = OSError(f"{stage} failed")
    events = []

    class Response(BytesIO):
        def close(self):
            super().close()
            events.append("response_closed")
            if stage == "response_close":
                raise failure

    response = Response(b"partial feed")
    original_open = Path.open

    class Writer:
        def __init__(self, handle):
            self.handle = handle

        def __enter__(self):
            return self

        def write(self, chunk):
            self.handle.write(chunk)
            if stage == "write":
                raise failure
            return len(chunk)

        def __exit__(self, *args):
            self.handle.close()
            events.append("file_closed")
            if stage == "file_close":
                raise failure

    def open_file(path, mode="r", *args, **kwargs):
        if mode == "wb":
            if stage == "file_open":
                raise failure
            return Writer(original_open(path, mode, *args, **kwargs))
        return original_open(path, mode, *args, **kwargs)

    monkeypatch.setattr(common, "urlopen", lambda *args, **kwargs: response)
    monkeypatch.setattr(Path, "open", open_file)
    with pytest.raises(OSError) as error:
        common.download_to_tempfile(
            source_url="https://example.test/feed.pb", temp_dir=tmp_path, default_filename="feed.pb"
        )
    assert error.value is failure
    assert response.closed
    expected_events = ["response_closed"]
    if stage != "file_open":
        expected_events.insert(0, "file_closed")
    assert events == expected_events
    assert list(tmp_path.iterdir()) == []
