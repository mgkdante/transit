from dataclasses import replace

import pytest
from test_orchestration import _realtime_ingestion_result, _realtime_silver_result

from transit_ops.settings import Settings


@pytest.mark.parametrize(
    "fault", [None, "capture", "silver", "capture_identity", "silver_identity", "silver_type"]
)
def test_shared_realtime_operation_preserves_exact_receipts_and_failure_stage(
    monkeypatch, caplog, fault
):
    from transit_ops import capture_load

    captured = _realtime_ingestion_result("trip_updates", 20)
    if fault == "capture_identity":
        captured = replace(captured, provider_id="other")
    silver = _realtime_silver_result("trip_updates", 20)
    original = RuntimeError("failed https://example.test/feed?api_key=private-d1-secret")
    calls = []

    def resolver(backend):
        pytest.fail("delegate storage resolution")

    def capture(provider_id, endpoint_key, **kwargs):
        assert (provider_id, endpoint_key) == ("stm", "trip_updates")
        assert kwargs["bronze_storage_resolver"] is resolver
        calls.append("archived")
        if fault == "capture":
            raise original
        return captured, b"committed-capture-a"

    def load(provider_id, endpoint_key, *, snapshot_id, captured_payload, **kwargs):
        assert calls == ["archived"]
        assert (provider_id, endpoint_key, snapshot_id) == ("stm", "trip_updates", 20)
        assert captured_payload == b"committed-capture-a"
        assert kwargs["bronze_storage_resolver"] is resolver
        calls.append("silver")
        if fault == "silver":
            raise original
        if fault == "silver_type":
            return object()
        return replace(silver, realtime_snapshot_id=21) if fault == "silver_identity" else silver

    monkeypatch.setattr(capture_load, "_capture_realtime_feed", capture)
    monkeypatch.setattr(capture_load, "_load_realtime_to_silver", load)
    result = capture_load.capture_and_load_realtime(
        "stm",
        "trip_updates",
        settings=Settings(_env_file=None),
        registry=object(),
        engine=object(),
        bronze_storage_resolver=resolver,
    )
    assert "private-d1-secret" not in caplog.text
    assert "committed-capture-a" not in caplog.text
    if fault is None:
        assert result.capture is captured
        assert result.silver is silver
        assert result.failure is None
        assert calls == ["archived", "silver"]
    else:
        assert result.silver is None
        assert result.capture is (None if fault == "capture" else captured)
        assert result.failure.stage == ("capture" if fault == "capture" else "silver")
        assert result.failure.kind == (
            "silver_identity"
            if fault == "silver_type"
            else fault
            if fault in {"capture_identity", "silver_identity"}
            else "operation"
        )
        if fault in {"capture", "silver"}:
            assert result.failure.error is original
        assert calls == (
            ["archived"] if fault in {"capture", "capture_identity"} else ["archived", "silver"]
        )
