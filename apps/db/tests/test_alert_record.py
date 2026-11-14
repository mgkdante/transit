import json
from dataclasses import FrozenInstanceError, replace
from datetime import UTC, datetime
from pathlib import Path

import pytest
from google.protobuf.message import DecodeError
from google.transit import gtfs_realtime_pb2
from test_alert_golden import ROOT, feed_bytes

from transit_ops.providers.alert_record import (
    AlertIdentityInputs,
    AlertRecord,
    InformedEntity,
    alert_rows,
)
from transit_ops.providers.formats.alerts_gtfs_rt import gtfs_rt_alerts

AT = datetime(2026, 11, 12, 12, tzinfo=UTC)
START = datetime(2026, 3, 30, 2, 20, tzinfo=UTC)
END = datetime(2026, 3, 30, 19, 46, 40, tzinfo=UTC)


def record(index=0):
    identity = AlertIdentityInputs(
        "basic-fixture",
        "Detour de ligne fictive",
        "Travaux imaginaires",
        "WARNING",
        "CONSTRUCTION",
        "DETOUR",
        START,
        END,
        None,
        None,
        (),
    )
    return AlertRecord(
        index,
        "basic-fixture",
        {"fr": "Detour de ligne fictive"},
        {"fr": "Travaux imaginaires"},
        {},
        "CONSTRUCTION",
        "DETOUR",
        "WARNING",
        "CONSTRUCTION",
        "DETOUR",
        ((START, END),),
        (),
        None,
        None,
        identity,
        {"id": "basic-fixture"},
    )


def project(records):
    return alert_rows(
        records, provider_id="fixture_city", i3_alert_snapshot_id=1, captured_at_utc=AT
    )


def test_identity_matches_literal_golden_and_records_are_frozen():
    value = record()
    assert value.identity.content_hash() == "b08e0638ede004dfae406b967195a163"
    with pytest.raises(FrozenInstanceError):
        value.id = "changed"
    assert project(()) == ([], [], [])


def test_projection_preserves_complete_parent_and_raw_values():
    value = replace(
        record(3),
        header={"en": "English", "fr": "Detour de ligne fictive"},
        url={"en": "https://example.org/en", "fr": "https://example.org/fr"},
    )
    assert project((value,)) == (
        [
            {
                "i3_alert_snapshot_id": 1,
                "alert_index": 3,
                "provider_id": "fixture_city",
                "alert_id": "basic-fixture",
                "alert_header_text": "Detour de ligne fictive",
                "description_text": "Travaux imaginaires",
                "alert_header_text_en": "English",
                "description_text_en": None,
                "severity": "WARNING",
                "cause": "CONSTRUCTION",
                "effect": "DETOUR",
                "url": "https://example.org/fr",
                "url_en": "https://example.org/en",
                "active_period_start_utc": START,
                "active_period_end_utc": END,
                "published_at_utc": None,
                "updated_at_utc": None,
                "captured_at_utc": AT,
                "raw_alert_json": {"id": "basic-fixture"},
                "content_hash": "b08e0638ede004dfae406b967195a163",
            }
        ],
        [],
        [
            {
                "i3_alert_snapshot_id": 1,
                "alert_index": 3,
                "period_index": 0,
                "start_utc": START,
                "end_utc": END,
            }
        ],
    )


def test_selectors_keep_order_raw_and_repeated_indexes():
    raw = {"agencyId": " agency ", "routeType": 0, "stopId": " S1 "}
    selector = InformedEntity(" agency ", None, 0, " S1 ", None, None, raw)
    value = replace(record(), informed_entities=(selector, selector))
    expected = {
        "i3_alert_snapshot_id": 1,
        "alert_index": 0,
        "entity_index": 0,
        "provider_id": "fixture_city",
        "route_id": None,
        "stop_id": "S1",
        "trip_id": None,
        "area_id": None,
        "raw_entity_json": {"agencyId": " agency ", "routeType": 0, "stopId": " S1 "},
    }
    assert project((value,))[1] == [expected, {**expected, "entity_index": 1}]
    assert raw == {"agencyId": " agency ", "routeType": 0, "stopId": " S1 "}


def test_first_hash_wins_without_renumbering_or_coalescing_ids():
    first = record()
    duplicate = replace(record(1), raw={"discarded": True}, active_periods=((None, None),))
    distinct = replace(record(2), identity=replace(first.identity, description_text="other"))
    rows, _, periods = project((first, duplicate, distinct))
    assert [row["alert_index"] for row in rows] == [0, 2]
    assert [row["alert_id"] for row in rows] == ["basic-fixture", "basic-fixture"]
    assert [row["alert_index"] for row in periods] == [0, 2]
    assert rows[0]["raw_alert_json"] == {"id": "basic-fixture"}


def test_untagged_text_and_epoch_periods_remain_present():
    epoch = datetime(1970, 1, 1, tzinfo=UTC)
    value = replace(
        record(),
        id=None,
        header={"": "untagged", "en": "English"},
        description={},
        url={"": "https://example.org"},
        severity_level=None,
        active_periods=((epoch, None), (None, END)),
    )
    rows, _, periods = project((value,))
    assert (rows[0]["alert_header_text"], rows[0]["url"]) == ("untagged", "https://example.org")
    assert (rows[0]["alert_id"], rows[0]["description_text"], rows[0]["severity"]) == (
        None,
        None,
        None,
    )
    assert periods == [
        {
            "i3_alert_snapshot_id": 1,
            "alert_index": 0,
            "period_index": 0,
            "start_utc": epoch,
            "end_utc": None,
        },
        {
            "i3_alert_snapshot_id": 1,
            "alert_index": 0,
            "period_index": 1,
            "start_utc": None,
            "end_utc": END,
        },
    ]


def test_multi_period_identity_and_rows_match_golden():
    path = Path(__file__).parent / "fixtures/alerts/golden/gtfs-rt/several_periods_with_url.json"
    golden = json.loads(path.read_text(encoding="utf-8"))
    raw = golden["converted_payload"]["alerts"][0]
    periods = tuple(
        (datetime.fromtimestamp(p["start"], UTC), datetime.fromtimestamp(p["end"], UTC))
        for p in raw["activePeriod"]
    )
    identity = AlertIdentityInputs(
        raw["id"],
        "Fermeture fictive du weekend",
        None,
        None,
        None,
        None,
        *periods[0],
        None,
        None,
        periods[1:],
    )
    value = AlertRecord(
        0,
        raw["id"],
        {"fr": "Fermeture fictive du weekend"},
        {},
        {"fr": "https://example.invalid/fr/multi", "en": "https://example.invalid/en/multi"},
        None,
        None,
        None,
        None,
        None,
        periods,
        (),
        None,
        None,
        identity,
        raw,
    )
    assert identity.content_hash() == "835237b4955db9b1b6a6d45300e9df9a"
    actual = json.loads(json.dumps(project((value,)), default=lambda dt: dt.isoformat()))
    assert actual == [golden["alert_rows"], golden["entity_rows"], golden["period_rows"]]
    # The existing hash owner appends extra periods in source order (silver/i3.py:53).
    reordered = replace(identity, extra_active_periods=tuple(reversed(periods[1:])))
    assert reordered.content_hash() != "835237b4955db9b1b6a6d45300e9df9a"


@pytest.mark.parametrize("case", sorted((ROOT / "corpus/gtfs-rt").glob("*")), ids=lambda p: p.stem)
def test_gtfs_rt_rows_and_hashes_match_golden(case):
    golden = json.loads((ROOT / "golden/gtfs-rt" / f"{case.stem}.json").read_text("utf-8"))
    records = gtfs_rt_alerts(feed_bytes(case))
    actual = json.loads(json.dumps(project(records), default=lambda dt: dt.isoformat()))
    assert actual == [golden["alert_rows"], golden["entity_rows"], golden["period_rows"]]
    assert [(r.occurrence_index, r.id, r.identity.content_hash()) for r in records] == [
        (r["alert_index"], r["raw_alert_json"]["id"], r["content_hash"])
        for r in golden["alert_rows"]
    ]
    assert [r.raw for r in records] == golden["converted_payload"]["alerts"]
    for record, row in zip(records, golden["alert_rows"], strict=True):
        for key in ("raw_alert_json",):
            assert json.dumps(record.raw, sort_keys=True, ensure_ascii=False) == json.dumps(
                row[key], sort_keys=True, ensure_ascii=False
            )
    if case.stem == "no_alert_entity":
        assert records == ()
        assert project(records) == ([], [], [])


def edge_feed():
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.header.gtfs_realtime_version = "2.0"
    entity = feed.entity.add(id=" edge ", is_deleted=True)
    alert = entity.alert
    translations = [
        ("eng_CA", " English "),
        ("en", "ignored"),
        ("fra-CA", " Francais "),
        ("fr", "ignored too"),
        ("", " untagged "),
        ("es", ""),
        ("es", " "),
    ]
    for language, text in translations:
        alert.header_text.translation.add(language=language, text=text)
    alert.description_text.translation.add(text=" description ")
    for language in ("en", "fr"):
        alert.url.translation.add(language=language, text=f" https://example.org/{language} ")
    alert.informed_entity.add()
    alert.informed_entity.add(direction_id=1).trip.start_date = "20261112"
    alert.informed_entity.add(agency_id=" agency ")
    alert.informed_entity.add(route_type=0)
    trip = alert.informed_entity.add().trip
    trip.trip_id, trip.start_date, trip.start_time = " trip ", "20261112", "12:00:00"
    alert.active_period.add()
    alert.active_period.add(start=0)
    alert.active_period.add(end=0)
    return feed, translations


def test_gtfs_rt_adapter_keeps_exactly_what_todays_converter_keeps():
    feed, translations = edge_feed()
    payload = feed.SerializeToString()
    (value,) = gtfs_rt_alerts(payload)
    assert feed.SerializeToString() == payload
    assert value.header == {"en": "English", "fr": "Francais", "": "untagged"}
    assert value.description == {"": "description"}
    assert value.url == {"en": "https://example.org/en", "fr": "https://example.org/fr"}
    assert (value.cause, value.effect, value.severity_level) == (None, None, None)
    assert (value.cause_standard, value.effect_standard, value.published_at, value.updated_at) == (
        None,
        None,
        None,
        None,
    )
    epoch = datetime(1970, 1, 1, tzinfo=UTC)
    assert value.active_periods == ((epoch, None), (None, epoch))
    assert value.raw == {
        "id": " edge ",
        "header": [
            {"text": text, **({"language": lang} if lang else {})}
            for lang, text in translations
            if text
        ],
        "description": [{"text": " description "}],
        "url": [
            {"text": f" https://example.org/{lang} ", "language": lang} for lang in ("en", "fr")
        ],
        "activePeriod": [{"start": 0}, {"end": 0}],
        "informedEntities": [{"agencyId": " agency "}, {"routeType": 0}, {"tripId": " trip "}],
    }
    assert [
        (s.agency_id, s.route_type, s.trip_id, s.area_id, s.raw) for s in value.informed_entities
    ] == [
        (" agency ", None, None, None, {"agencyId": " agency "}),
        (None, 0, None, None, {"routeType": 0}),
        (None, None, " trip ", None, {"tripId": " trip "}),
    ]
    assert (
        value.identity.alert_id,
        value.identity.alert_header_text,
        value.identity.description_text,
    ) == ("edge", "Francais", "description")
    assert value.identity.extra_active_periods == ((None, epoch),)
    _, entities, periods = project((value,))
    assert [r["trip_id"] for r in entities] == [None, None, "trip"]
    assert [(r["start_utc"], r["end_utc"]) for r in periods] == list(value.active_periods)


def test_urls_do_not_change_identity():
    feed, _ = edge_feed()
    (value,) = gtfs_rt_alerts(feed.SerializeToString())
    rows, _, _ = project((value,))
    assert (rows[0]["url"], rows[0]["url_en"]) == (
        "https://example.org/fr",
        "https://example.org/en",
    )
    feed.entity[0].alert.url.Clear()
    assert gtfs_rt_alerts(feed.SerializeToString())[0].identity == value.identity


def test_missing_and_repeated_ids_keep_children_by_occurrence():
    feed = gtfs_realtime_pb2.FeedMessage(header={"gtfs_realtime_version": "2.0"})
    feed.entity.add(id="vehicle").vehicle.SetInParent()
    inputs = [
        ("", "a", ["A", "A"]),
        ("", "b", ["B"]),
        ("same", "c", ["C"]),
        ("same", "d", ["D"]),
        ("same", "c", ["discarded"]),
        ("last", "e", ["E"]),
    ]
    for id_, text, stops in inputs:
        alert = feed.entity.add(id=id_).alert
        alert.header_text.translation.add(text=text)
        alert.active_period.add(start=0)
        for stop in stops:
            alert.informed_entity.add(stop_id=stop)
    records = gtfs_rt_alerts(feed.SerializeToString())
    assert [(r.occurrence_index, r.id) for r in records] == [
        (0, None),
        (1, None),
        (2, "same"),
        (3, "same"),
        (4, "same"),
        (5, "last"),
    ]
    parents, entities, periods = project(records)
    assert [(r["alert_index"], r["alert_id"], r["alert_header_text"]) for r in parents] == [
        (0, None, "a"),
        (1, None, "b"),
        (2, "same", "c"),
        (3, "same", "d"),
        (5, "last", "e"),
    ]
    assert [
        (r["alert_index"], r["entity_index"], r["stop_id"], r["raw_entity_json"]) for r in entities
    ] == [
        (0, 0, "A", {"stopId": "A"}),
        (0, 1, "A", {"stopId": "A"}),
        (1, 0, "B", {"stopId": "B"}),
        (2, 0, "C", {"stopId": "C"}),
        (3, 0, "D", {"stopId": "D"}),
        (5, 0, "E", {"stopId": "E"}),
    ]
    assert [
        (r["alert_index"], r["period_index"], r["start_utc"], r["end_utc"]) for r in periods
    ] == [(i, 0, datetime(1970, 1, 1, tzinfo=UTC), None) for i in (0, 1, 2, 3, 5)]
    assert records[4].informed_entities[0].raw == {"stopId": "discarded"}
    assert records[2].identity == records[4].identity


def test_invalid_protobuf_is_rejected():
    with pytest.raises(DecodeError):
        gtfs_rt_alerts(b"\xff")
