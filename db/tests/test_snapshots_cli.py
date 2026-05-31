"""Tests for the publish-snapshot CLI command."""

from typer.testing import CliRunner

from transit_ops import cli
from transit_ops.snapshots.publish import PublishResult


def test_publish_snapshot_cmd(monkeypatch):
    called = {}

    def fake(provider_id, **kw):
        called["provider_id"] = provider_id
        called["tier"] = kw.get("tier")
        return PublishResult(
            provider_id=provider_id,
            tier=kw.get("tier", "live"),
            keys_written=["live/vehicles.json", "manifest.json"],
        )

    monkeypatch.setattr(cli, "publish_snapshot", fake)
    result = CliRunner().invoke(cli.app, ["publish-snapshot", "stm", "--tier", "live"])
    assert result.exit_code == 0, result.output
    assert called["provider_id"] == "stm"
    assert called["tier"] == "live"
    assert "manifest.json" in result.output
