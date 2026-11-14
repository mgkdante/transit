import hashlib
import json
from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest
from typer.testing import CliRunner

from transit_ops.commands import static
from transit_ops.static import alert_seed as seeds
from transit_ops.static.alert_seed_contract import SCHEMAS


def bundle():
    schemas = SCHEMAS
    return seeds.AlertSeed(
        version=1,
        provider_id="test",
        snapshot_at=datetime(2026, 1, 1, tzinfo=UTC),
        global_max_snapshot_id=None,
        tables={n: dict(columns=c, rows=[]) for n, c in schemas.items()},
    )


def signed(data):
    raw = json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    return json.dumps(data | {"sha256": hashlib.sha256(raw).hexdigest()}).encode()


@pytest.mark.parametrize(
    "mode", [("off", "repeatable read"), ("on", "read committed"), ("on", "repeatable read")]
)
def test_export_refuses_writable_nonrepeatable_or_autocommit(mode):
    pg = MagicMock()
    pg.connection.driver_connection.autocommit = mode == ("on", "repeatable read")
    pg.execute.return_value.one.return_value = mode
    with pytest.raises(seeds.AlertSeedReadRefused):
        seeds.read_alert_seed(pg, provider_id="test")


@pytest.mark.parametrize(
    "field,value", [("provider_id", "changed"), ("snapshot_at", "2026-01-01T00:00:00")]
)
def test_digest_and_naive_snapshot_refused(field, value):
    data = json.loads(bundle().to_json())
    data[field] = value
    with pytest.raises(seeds.AlertSeedInvalid):
        seeds.AlertSeed.from_json(json.dumps(data).encode())
    data.pop("sha256")
    if field == "snapshot_at":
        with pytest.raises(seeds.AlertSeedInvalid):
            seeds.AlertSeed.from_json(signed(data))


def test_export_command_has_no_storage_writes(monkeypatch, tmp_path):
    engine = MagicMock()
    monkeypatch.setattr(static, "make_engine", lambda settings: engine)
    monkeypatch.setattr(static, "read_alert_seed", lambda pg, **kw: bundle())
    target = tmp_path / "seed.json"
    args = ["export-alert-seed", "--provider", "test", "--out", str(target)]
    result = CliRunner().invoke(static.app, args + ["--statement-timeout-s", "10"])
    assert result.exit_code == 0, result.output
    assert seeds.AlertSeed.from_json(target.read_bytes()) == bundle()
    assert engine.dispose.called
    assert CliRunner().invoke(static.app, args + ["--statement-timeout-s", "301"]).exit_code != 0
