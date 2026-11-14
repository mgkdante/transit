from dataclasses import FrozenInstanceError, replace
from datetime import UTC, datetime

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
    assert project((value,))[1] == [
        {
            "i3_alert_snapshot_id": 1,
            "alert_index": 0,
            "entity_index": 0,
            "provider_id": "fixture_city",
            "route_id": None,
            "stop_id": "S1",
            "trip_id": None,
            "area_id": None,
            "raw_entity_json": {"agencyId": " agency ", "routeType": 0, "stopId": " S1 "},
        },
        {
            "i3_alert_snapshot_id": 1,
            "alert_index": 0,
            "entity_index": 1,
            "provider_id": "fixture_city",
            "route_id": None,
            "stop_id": "S1",
            "trip_id": None,
            "area_id": None,
            "raw_entity_json": {"agencyId": " agency ", "routeType": 0, "stopId": " S1 "},
        },
    ]
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
