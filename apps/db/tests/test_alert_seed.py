import hashlib
import json
from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest
from typer.testing import CliRunner

from transit_ops.commands import static
from transit_ops.static.alert_seed import (
    TABLES,
    AlertSeed,
    AlertSeedInvalid,
    AlertSeedReadRefused,
    read_alert_seed,
)


def bundle():
    tables = {n: dict(columns={"provider_id": "text"}, rows=[]) for n in TABLES}
    return AlertSeed(
        version=1,
        provider_id="test",
        snapshot_at=datetime(2026, 1, 1, tzinfo=UTC),
        global_max_snapshot_id=None,
        tables=tables,
    )


def test_seed_roundtrip_preserves_null_empty_unicode_jsonb_and_microseconds():
    seed = bundle()
    table = seed.tables[TABLES[3]]
    table.columns.update(note="text", empty="text", body="jsonb", at="timestamp with time zone")
    table.columns["big"] = "bigint"
    row = dict(provider_id="test", note=None, empty="", body='{"é": "雪"}')
    row.update(at="2026-01-01T00:00:00.123456+00:00", big=9007199254740993)
    table.rows.append(row)
    encoded = seed.to_json()
    assert b"\\u" not in encoded
    assert AlertSeed.from_json(encoded) == seed
    assert AlertSeed.from_json(encoded).to_json() == encoded
    assert seed.global_max_snapshot_id is None


@pytest.mark.parametrize("change", ["digest", "provider", "time", "schema", "child"])
def test_invalid_seed_refused(change):
    data = json.loads(bundle().to_json())
    if change in ("digest", "provider"):
        data["tables"][TABLES[3]]["rows"] = [{"provider_id": "other"}]
    elif change == "time":
        data["snapshot_at"] = "2026-01-01T00:00:00"
    elif change == "schema":
        data["tables"].pop(TABLES[0])
    else:
        columns = dict(i3_alert_snapshot_id="bigint", alert_index="integer")
        data["tables"][TABLES[2]] = dict(
            columns=columns, rows=[dict(i3_alert_snapshot_id=1, alert_index=0)]
        )
    if change != "digest":
        data.pop("sha256")
        raw = json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
        data["sha256"] = hashlib.sha256(raw).hexdigest()
    with pytest.raises(AlertSeedInvalid):
        AlertSeed.from_json(json.dumps(data).encode())


@pytest.mark.parametrize("mode", [("off", "repeatable read"), ("on", "read committed")])
def test_export_refuses_writable_or_nonrepeatable_transaction(mode):
    pg = MagicMock()
    pg.execute.return_value.one.return_value = mode
    with pytest.raises(AlertSeedReadRefused):
        read_alert_seed(pg, provider_id="test")


def test_export_command_has_no_storage_writes(monkeypatch, tmp_path):
    engine = MagicMock()
    monkeypatch.setattr(static, "make_engine", lambda settings: engine)
    monkeypatch.setattr(static, "read_alert_seed", lambda pg, **kw: bundle())
    target = tmp_path / "seed.json"
    args = ["export-alert-seed", "--provider", "test", "--out", str(target)]
    result = CliRunner().invoke(static.app, args + ["--statement-timeout-s", "10"])
    assert result.exit_code == 0, result.output
    assert AlertSeed.from_json(target.read_bytes()) == bundle()
    assert engine.dispose.called
    assert CliRunner().invoke(static.app, args + ["--statement-timeout-s", "301"]).exit_code != 0
