import json
from copy import deepcopy
from datetime import UTC, datetime
from hashlib import sha256

import pytest

from transit_ops.static.alert_seed_contract import (
    KEYS,
    SCHEMAS,
    TABLES,
    AlertSeed,
    AlertSeedInvalid,
)

BIG = 9007199254740993
AT = "2026-11-14T09:10:11.123456+00:00"


def signed(data):
    raw = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return json.dumps(
        data | {"sha256": sha256(raw).hexdigest()},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()


def body():
    tables = {name: dict(columns=dict(columns), rows=[]) for name, columns in SCHEMAS.items()}

    def row(index, **values):
        name = TABLES[index]
        tables[name]["rows"].append(dict.fromkeys(SCHEMAS[name]) | values)

    common = dict(i3_alert_snapshot_id=BIG, provider_id="test")
    row(
        5,
        **common,
        feed_endpoint_id=1,
        ingestion_run_id=1,
        captured_at_utc=AT,
        raw_payload_json='{"a": 1, "zz": "雪"}',
    )
    row(
        0,
        **common,
        alert_index=0,
        alert_header_text="",
        captured_at_utc=AT,
        raw_alert_json='{"a": 1, "zz": "雪"}',
        content_hash="abc",
        message_snapshot_id=BIG,
        message_alert_index=0,
    )
    row(1, **common, alert_index=0, entity_index=7, route_id="é", stop_id="", raw_entity_json="{}")
    row(2, i3_alert_snapshot_id=BIG, alert_index=0, period_index=3, start_utc=AT)
    row(3, provider_id="test", observation_date="2026-11-14", alert_count=1, observed_at_utc=AT)
    row(
        4,
        provider_id="test",
        alert_logical_id="a",
        observation_date="2026-11-14",
        has_explicit_fr=True,
        has_explicit_en=False,
        undetermined=False,
        observed_at_utc=AT,
    )
    return dict(
        version=1, provider_id="test", snapshot_at=AT, global_max_snapshot_id=BIG, tables=tables
    )


def test_contract_roundtrip_preserves_exact_values_and_digest():
    data = body()
    seed = AlertSeed.from_json(signed(data))
    assert seed.to_json() == signed(data)
    assert seed.snapshot_at == datetime(2026, 11, 14, 9, 10, 11, 123456, tzinfo=UTC)
    assert seed.tables[TABLES[5]].rows[0]["i3_alert_snapshot_id"] == BIG
    assert seed.tables[TABLES[0]].rows[0]["alert_header_text"] == ""
    assert seed.tables[TABLES[0]].rows[0]["description_text"] is None
    assert seed.tables[TABLES[0]].rows[0]["raw_alert_json"] == '{"a": 1, "zz": "雪"}'


@pytest.mark.parametrize(
    "case", ["child_index", "provider", "null_index", "duplicate", "time_type"]
)
def test_signed_malformed_bundle_refused(case):
    data = body()
    table = data["tables"][TABLES[0 if case == "provider" else 1]]
    if case in ("child_index", "provider"):
        column = "provider_id" if case == "provider" else "entity_index"
        table["columns"].pop(column)
        table["rows"][0].pop(column)
    elif case == "null_index":
        table["rows"][0]["entity_index"] = None
    elif case == "duplicate":
        table["rows"].append(table["rows"][0] | {"route_id": "DIFFERENT"})
    else:
        table = data["tables"][TABLES[2]]
        table["columns"]["start_utc"] = "text"
        table["rows"][0]["start_utc"] = "2026-11-14T09:10:11"
    with pytest.raises(AlertSeedInvalid):
        AlertSeed.from_json(signed(data))


@pytest.mark.parametrize("name", TABLES)
@pytest.mark.parametrize("failure", ["null", "duplicate"])
def test_each_table_identity_is_required_and_unique(name, failure):
    data = body()
    table = data["tables"][name]
    if failure == "null":
        table["rows"][0][KEYS[name][0]] = None
    else:
        table["rows"].append(deepcopy(table["rows"][0]))
    with pytest.raises(AlertSeedInvalid):
        AlertSeed.from_json(signed(data))


@pytest.mark.parametrize("failure", ["digest", "naive", "provider", "child", "floor", "type"])
def test_other_contract_refusals(failure):
    data = body()
    if failure == "naive":
        data["snapshot_at"] = "2026-11-14T09:10:11"
    elif failure == "provider":
        data["tables"][TABLES[0]]["rows"][0]["provider_id"] = "other"
    elif failure == "child":
        data["tables"][TABLES[2]]["rows"][0]["alert_index"] = 99
    elif failure == "floor":
        data["global_max_snapshot_id"] = None
    elif failure == "type":
        data["tables"][TABLES[1]]["rows"][0]["entity_index"] = "7"
    payload = signed(data)
    if failure == "digest":
        payload = payload.replace(b"abc", b"xyz")
    with pytest.raises(AlertSeedInvalid):
        AlertSeed.from_json(payload)
