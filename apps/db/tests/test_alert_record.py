import json
from dataclasses import FrozenInstanceError, replace
from datetime import UTC, datetime
from pathlib import Path

import pytest

from transit_ops.providers.alert_record import (
    AlertIdentityInputs,
    AlertRecord,
    InformedEntity,
    alert_rows,
)

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
