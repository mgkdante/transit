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


def test_publish_all_cmd_loops_every_provider(monkeypatch):
    calls = []

    def fake(provider_id, **kw):
        calls.append(provider_id)
        return PublishResult(
            provider_id=provider_id,
            tier=kw.get("tier", "live"),
            keys_written=["manifest.json"],
        )

    monkeypatch.setattr(cli, "publish_snapshot", fake)
    result = CliRunner().invoke(cli.app, ["publish-all", "--tier", "static"])

    assert result.exit_code == 0, result.output
    assert calls == ["octranspo", "stm", "sto"]  # every enrolled provider
    assert "manifest.json" in result.output


def test_publish_snapshot_tier_help_lists_all_tiers():
    # slice-9.1.1w: static and historic tiers shipped (slice-9.1.1r), so the
    # --tier help must list them, not claim they "land in later phases".
    result = CliRunner().invoke(cli.app, ["publish-snapshot", "--help"])
    assert result.exit_code == 0, result.output
    assert "later phases" not in result.output
    assert "static" in result.output
    assert "historic" in result.output
