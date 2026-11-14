from __future__ import annotations

import json
import os
from dataclasses import asdict
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
from google.protobuf import descriptor_pb2, descriptor_pool, message_factory, text_format
from google.transit import gtfs_realtime_pb2

from transit_ops.ingestion.service_alerts import convert_gtfs_rt_alerts_to_i3_payload
from transit_ops.silver.i3 import (
    RawI3AlertSnapshot,
    build_alert_language_observations,
    normalize_i3_alert_payload,
)

ROOT = Path(__file__).parent / "fixtures" / "alerts"
REQUIRED = {
    "stm-etatservice-json": {
        "etatservice_shape",
        "nonstandard_strings",
        "missing_id",
        "repeated_id",
        "repeated_identical_alert",
        "several_periods",
        "missing_and_zero_timestamps",
        "text_without_language",
        "region_language_tags",
        "common_shape",
    },
    "gtfs-rt": {
        "basic_feed",
        "several_periods_with_url",
        "unknown_enum_value",
        "no_alert_entity",
        "missing_entity_id",
        "every_selector",
    },
}
CASES = sorted((ROOT / "corpus").glob("*/*"))


def feed_bytes(case: Path) -> bytes:
    if case.stem == "unknown_enum_value":
        # Text parsing rejects closed-enum unknowns. Extend an isolated descriptor to
        # encode the fixture; the converter still decodes with the unmodified bindings.
        descriptor = descriptor_pb2.FileDescriptorProto.FromString(
            gtfs_realtime_pb2.DESCRIPTOR.serialized_pb
        )
        alert = next(item for item in descriptor.message_type if item.name == "Alert")
        cause = next(item for item in alert.enum_type if item.name == "Cause")
        cause.value.add(name="FIXTURE_UNKNOWN_CAUSE", number=9999)
        pool = descriptor_pool.DescriptorPool()
        pool.Add(descriptor)
        message = message_factory.GetMessageClass(
            pool.FindMessageTypeByName("transit_realtime.FeedMessage")
        )()
    else:
        message = gtfs_realtime_pb2.FeedMessage()
    text_format.Parse(case.read_text(encoding="utf-8"), message)
    return message.SerializeToString()


def _iso(value: object) -> str:
    if isinstance(value, date | datetime):
        return value.isoformat()
    raise TypeError(f"unsupported golden value: {type(value).__name__}")


def _current(case: Path) -> dict:
    converted = case.parent.name == "gtfs-rt"
    payload = (
        convert_gtfs_rt_alerts_to_i3_payload(feed_bytes(case))
        if converted
        else json.loads(case.read_text(encoding="utf-8"))
    )
    snapshot = RawI3AlertSnapshot(
        i3_alert_snapshot_id=1,
        provider_id="fixture_city",
        provider_timezone="America/Toronto",
        captured_at_utc=datetime(2026, 11, 12, 12, tzinfo=UTC),
        raw_payload_json=payload,
    )
    alerts, entities, periods = normalize_i3_alert_payload(snapshot)
    result = {
        "alert_rows": alerts,
        "entity_rows": entities,
        "period_rows": periods,
        "language_observations": [
            asdict(item) for item in build_alert_language_observations(snapshot)
        ],
    }
    if converted:
        result["converted_payload"] = payload
    return json.loads(json.dumps(result, default=_iso, ensure_ascii=False))


def _golden(case: Path) -> Path:
    return ROOT / "golden" / case.parent.name / f"{case.stem}.json"


def test_unknown_enum_fixture_preserves_wire_value() -> None:
    case = ROOT / "corpus" / "gtfs-rt" / "unknown_enum_value.textproto"
    assert feed_bytes(case) == bytes.fromhex("0a050a03322e3012080a01782a03308f4e")


@pytest.mark.parametrize("case", CASES, ids=lambda case: f"{case.parent.name}/{case.stem}")
def test_current_path_matches_golden(case: Path) -> None:
    golden = _golden(case)
    assert golden.is_file(), f"missing golden: {golden.relative_to(ROOT)}"
    assert _current(case) == json.loads(golden.read_text(encoding="utf-8"))


def test_corpus_holds_every_required_case() -> None:
    for format_name, names in REQUIRED.items():
        suffix = ".textproto" if format_name == "gtfs-rt" else ".json"
        for name in names:
            assert ROOT.joinpath("corpus", format_name, name + suffix).is_file()


def test_every_case_has_one_golden_and_every_golden_one_case() -> None:
    expected = {_golden(case).relative_to(ROOT / "golden") for case in CASES}
    actual = {path.relative_to(ROOT / "golden") for path in (ROOT / "golden").glob("*/*")}
    assert actual == expected


@pytest.mark.skipif(
    os.environ.get("ALERT_GOLDEN_REGEN") != "1",
    reason="set ALERT_GOLDEN_REGEN=1 to regenerate the frozen alert goldens",
)
def test_regenerate_alert_golden() -> None:
    for case in CASES:
        path = _golden(case)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(_current(case), indent=2, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
            newline="\n",
        )
