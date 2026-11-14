from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from shutil import copyfile

import pytest
from google.transit import gtfs_realtime_pb2 as pb

from transit_ops.providers import DeclarationError, RawCapture, load_providers, normalize_capture
from transit_ops.providers.modes import (
    PASS_MODES,
    WORKER_MODES,
    normalizer_fingerprint,
    serialize_modes,
)

AT = datetime(2026, 6, 20, 12, tzinfo=UTC)


@pytest.fixture
def provider(tmp_path):
    copyfile(
        Path(__file__).parent / "fixtures/providers/fixture_city.yaml",
        tmp_path / "fixture_city.yaml",
    )
    return load_providers(tmp_path, env={})["fixture_city"]


def capture(family="trip_updates", payload=None):
    message = pb.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    message.header.incrementality = pb.FeedHeader.DIFFERENTIAL
    message.header.timestamp = 0
    for name in ("Côte-Vertu", "second"):
        entity = message.entity.add(id=name)
        trip = entity.trip_update.trip if family == "trip_updates" else entity.vehicle.trip
        trip.trip_id = "√2"
        if family == "trip_updates":
            entity.trip_update.stop_time_update.add(stop_id="√2").arrival.time = 0
            entity.trip_update.stop_time_update.add(stop_id="last").departure.delay = 12
    return RawCapture(
        family,
        "gtfs-rt",
        message.SerializeToString() if payload is None else payload,
        AT,
        "private-label",
    )


@pytest.mark.parametrize("family", ["trip_updates", "vehicle_positions"])
def test_worker_modes_return_the_message_as_sent_and_read_no_schedule(provider, family):
    class NoSchedule:
        @property
        def context_id(self):
            raise AssertionError("schedule was read")

    raw = capture(family)
    result = normalize_capture(provider, raw, NoSchedule(), modes=WORKER_MODES)
    assert result.status == "ok" and result.rejected_reason is None
    assert result.message.SerializeToString() == raw.payload
    assert [e.id for e in result.message.entity] == ["Côte-Vertu", "second"]
    trip = (
        result.message.entity[0].trip_update.trip
        if family == "trip_updates"
        else result.message.entity[0].vehicle.trip
    )
    assert trip.trip_id == "√2" and not trip.HasField("route_id")
    assert not trip.HasField("start_date")
    assert result.message.header.timestamp == 0
    assert result.message.header.HasField("timestamp")
    assert result.message.header.incrementality == pb.FeedHeader.DIFFERENTIAL
    if family == "trip_updates":
        stops = result.message.entity[0].trip_update.stop_time_update
        assert [s.stop_id for s in stops] == ["√2", "last"]
        assert stops[0].arrival.HasField("time") and stops[0].arrival.time == 0
        assert not stops[1].departure.HasField("time") and stops[1].departure.delay == 12
    assert result.fills == result.outcomes == result.alerts == ()
    assert result.evidence is result.schedule_context_id is None


def test_undecodable_payload_is_rejected_not_raised(provider):
    result = normalize_capture(provider, capture(payload=b"\xff"), modes=WORKER_MODES)
    assert (result.status, result.rejected_reason, result.message) == (
        "rejected",
        "undecodable",
        None,
    )
    assert result.fills == result.outcomes == result.alerts == ()
    assert result.evidence is None


@pytest.mark.parametrize("payload", [b"", b"\x0a\x05\x0a\x03" + b"2.0"])
def test_empty_feed_is_ok(provider, payload):
    result = normalize_capture(provider, capture(payload=payload), modes=WORKER_MODES)
    assert result.status == "ok" and len(result.message.entity) == 0
    assert result.message.HasField("header") == bool(payload)


def test_apply_mode_without_a_schedule_never_raises(provider):
    result = normalize_capture(provider, capture(), modes=PASS_MODES, collect=True)
    assert (
        result.status == "ok" and result.message.header.incrementality == pb.FeedHeader.DIFFERENTIAL
    )
    assert result.fills == result.outcomes == result.alerts == ()
    assert result.evidence is result.schedule_context_id is None


def test_modes_serialization_is_stable():
    expected = "N1=count;N2=count;N3=count;N5=count;N6=count;N7=count;N8=count;N9=count"
    assert serialize_modes(dict(reversed(list(WORKER_MODES.items())))) == expected
    assert normalizer_fingerprint(WORKER_MODES) == "1:" + expected
    assert normalizer_fingerprint(PASS_MODES) == "1:" + expected.replace("count", "apply")
    with pytest.raises(TypeError):
        WORKER_MODES["N1"] = "apply"


@pytest.mark.parametrize(
    "changes",
    [
        {"N1": None},
        {"N4": "count"},
        {"N1": "bad"},
        {"N2": "apply"},
        {"N3": "apply", "N5": "apply"},
    ],
)
def test_invalid_modes_are_refused_before_parsing(provider, changes):
    modes = dict(WORKER_MODES) | changes
    modes = {k: v for k, v in modes.items() if v is not None}
    with pytest.raises(ValueError):
        normalize_capture(provider, capture(payload=b"\xff"), modes=modes)


def test_unknown_format_fails_at_load(tmp_path):
    source = Path(__file__).parent / "fixtures/providers/fixture_city.yaml"
    (tmp_path / source.name).write_text(
        source.read_text().replace(
            "family: trip_updates,", "family: trip_updates, format: mystery,"
        ),
        encoding="utf-8",
    )
    with pytest.raises(DeclarationError, match="feeds.*format"):
        load_providers(tmp_path, env={})


@pytest.mark.parametrize(
    "family,format",
    [
        ("absent", "gtfs-rt"),
        ("alerts", "gtfs-rt"),
        ("schedule", "gtfs"),
        ("trip_updates", "gtfs"),
    ],
)
def test_capture_configuration_misuse_is_refused(provider, family, format):
    with pytest.raises(ValueError):
        normalize_capture(
            provider, replace(capture(), family=family, format=format), modes=WORKER_MODES
        )


def test_schedule_identity_is_recorded_outside_worker_fast_path(provider):
    class Identity:
        context_id = "edition-42"

    result = normalize_capture(provider, capture(), Identity(), modes=PASS_MODES, collect=True)
    assert result.schedule_context_id == "edition-42" and result.evidence is None


def test_results_do_not_share_mutable_messages(provider):
    raw = capture()
    first = normalize_capture(provider, raw, modes=WORKER_MODES)
    first.message.entity[0].id = "changed"
    second = normalize_capture(provider, raw, modes=WORKER_MODES)
    assert second.message.entity[0].id == "Côte-Vertu"


@pytest.mark.parametrize("family", ["trip_updates", "vehicle_positions"])
def test_normalized_message_keeps_existing_row_semantics(provider, family):
    from hashlib import sha256

    from transit_ops.live.captures import CaptureRef, ParsePolicy, parse_capture
    from transit_ops.silver.realtime_gtfs import (
        RealtimeNormalizationContext,
        normalize_realtime_message,
    )

    raw = capture(family)
    result = normalize_capture(provider, raw, modes=WORKER_MODES)
    ref = CaptureRef(
        "fixture_city", family, 42, AT, AT, len(raw.payload), sha256(raw.payload).hexdigest()
    )
    parsed = parse_capture(raw.payload, ref, ParsePolicy(None, 100))
    rows = normalize_realtime_message(
        result.message,
        context=RealtimeNormalizationContext("fixture_city", family, AT, AT),
        rt_feed_snapshot_id=42,
    )
    assert [r["entity_id"] for r in rows["rt_entities"]] == ["Côte-Vertu", "second"]
    child = rows["rt_trip_updates" if family == "trip_updates" else "rt_vehicle_positions"]
    assert [r["trip_id"] for r in child] == ["√2", "√2"]
    assert [r["route_id"] for r in child] == [None, None]
    if family == "trip_updates":
        stops = rows["rt_trip_update_stop_times"]
        assert [r["stop_id"] for r in stops] == ["√2", "last", "√2", "last"]
        assert [r["arrival_time_utc"] for r in stops] == [None] * 4
    for table, frame in parsed.frames.items():
        assert frame.rows == tuple(tuple(r[c] for c in frame.columns) for r in rows[table])
