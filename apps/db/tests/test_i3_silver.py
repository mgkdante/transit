from __future__ import annotations

from datetime import UTC, datetime

from transit_ops.silver.i3 import (
    RawI3AlertSnapshot,
    compute_alert_content_hash,
    load_i3_snapshot_to_silver,
    normalize_i3_alert_payload,
)


class FakeResult:
    def __init__(self, scalar_value=None, mapping_value=None, mapping_rows=None) -> None:  # noqa: ANN001
        self.scalar_value = scalar_value
        self.mapping_value = mapping_value
        self.mapping_rows = mapping_rows or []
        self.rowcount = 0

    def scalar_one_or_none(self):  # noqa: ANN201
        return self.scalar_value

    def mappings(self):  # noqa: ANN201
        return self

    def one_or_none(self):  # noqa: ANN201
        return self.mapping_value

    def __iter__(self):  # noqa: ANN204
        return iter(self.mapping_rows)


class RecordingConnection:

    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []
        self._last_alert_batch: list[dict] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        sql = str(statement)
        self.calls.append((sql, params))
        if "INSERT INTO silver.i3_alerts" in sql and isinstance(params, list):
            self._last_alert_batch = params
        if "SELECT content_hash, i3_alert_snapshot_id, alert_index" in sql:
            return FakeResult(
                mapping_rows=[
                    {
                        "content_hash": row["content_hash"],
                        "i3_alert_snapshot_id": row["i3_alert_snapshot_id"],
                        "alert_index": row["alert_index"],
                    }
                    for row in self._last_alert_batch
                ]
            )
        return FakeResult()


def _snapshot(payload: object) -> RawI3AlertSnapshot:
    return RawI3AlertSnapshot(
        i3_alert_snapshot_id=505,
        provider_id="stm",
        provider_timezone="America/Toronto",
        captured_at_utc=datetime(2026, 5, 25, 4, 5, 6, tzinfo=UTC),
        raw_payload_json=payload,
    )


def test_normalize_i3_alert_payload_accepts_common_alert_shapes() -> None:
    snapshot = _snapshot(
        {
            "alerts": [
                {
                    "id": "alert-1",
                    "header": {"text": "Service interruption"},
                    "description": {"text": "Blue line issue"},
                    "severity": "warning",
                    "cause": "technical_problem",
                    "effect": "delay",
                    "activePeriod": {
                        "start": "2026-05-25T04:00:00Z",
                        "end": "2026-05-25T05:00:00Z",
                    },
                    "informedEntities": [
                        {"routeId": "2", "stopId": "43"},
                        {"areaId": "metro"},
                    ],
                }
            ]
        }
    )

    alerts, entities, _periods = normalize_i3_alert_payload(snapshot)

    assert alerts[0]["alert_id"] == "alert-1"
    assert alerts[0]["alert_header_text"] == "Service interruption"
    assert alerts[0]["description_text"] == "Blue line issue"
    assert alerts[0]["active_period_start_utc"] == datetime(2026, 5, 25, 4, tzinfo=UTC)
    assert entities[0]["route_id"] == "2"
    assert entities[0]["stop_id"] == "43"
    assert entities[1]["area_id"] == "metro"


def test_normalize_i3_alert_payload_dedups_identical_content_hash() -> None:
    one = {
        "header": {"text": "Votre ligne"},
        "description": {"text": "Service normal du métro"},
        "informedEntities": [{"routeId": "1"}],
    }
    snapshot = _snapshot({"alerts": [dict(one), dict(one)]})

    alerts, entities, _periods = normalize_i3_alert_payload(snapshot)

    assert len(alerts) == 1
    kept = alerts[0]["alert_index"]
    assert len(entities) == 1
    assert {e["alert_index"] for e in entities} == {kept}


def test_load_i3_snapshot_to_silver_inserts_alerts_and_entities() -> None:
    connection = RecordingConnection()
    snapshot = _snapshot(
        {
            "messages": [
                {
                    "messageId": "m1",
                    "title": "Route 10 delayed",
                    "routes": ["10"],
                    "stops": ["10001", "10002"],
                    "activePeriod": {
                        "start": "2026-05-25T04:00:00Z",
                        "end": "2026-05-25T05:00:00Z",
                    },
                }
            ]
        }
    )

    result = load_i3_snapshot_to_silver(connection, snapshot=snapshot)

    assert result.i3_alert_snapshot_id == 505
    assert result.alert_rows_inserted == 1
    assert result.informed_entity_rows_inserted == 2
    data_calls = [
        sql for sql, _ in connection.calls if "silver.i3_" in sql or "INSERT INTO raw.alert_" in sql
    ]
    assert "INSERT INTO raw.alert_feed_observations" in data_calls[0]
    assert "INSERT INTO raw.alert_language_observations" in data_calls[1]
    assert "DELETE FROM silver.i3_alert_active_periods" in data_calls[2]
    assert "DELETE FROM silver.i3_alert_informed_entities" in data_calls[3]
    assert "DELETE FROM silver.i3_alerts" in data_calls[4]
    assert "INSERT INTO silver.i3_alerts" in data_calls[5]
    assert "SELECT content_hash, i3_alert_snapshot_id, alert_index" in data_calls[6]
    assert "INSERT INTO silver.i3_alert_informed_entities" in data_calls[7]
    assert "INSERT INTO silver.i3_alert_active_periods" in data_calls[8]
    assert "SET valid_to" in data_calls[9]
    assert result.alerts_redirected_to_existing == 0
    assert result.entities_dropped_missing_parent == 0


def test_normalize_i3_alert_payload_accepts_stm_etatservice_shape() -> None:
    snapshot = _snapshot(
        {
            "messages": [
                {
                    "id": "etat-1",
                    "header_texts": [
                        {"language": "fr", "text": "Votre ligne"},
                        {"language": "en", "text": "Your line"},
                    ],
                    "description_texts": [
                        {"language": "fr", "text": "Arrets annules"},
                        {"language": "en", "text": "Cancelled stops"},
                    ],
                    "informed_entities": [
                        {"route_short_name": "14"},
                        {"direction_id": "S"},
                        {"stop_code": "53010"},
                    ],
                }
            ]
        }
    )

    alerts, entities, _periods = normalize_i3_alert_payload(snapshot)

    assert alerts[0]["alert_id"] == "etat-1"
    assert alerts[0]["alert_header_text"] == "Votre ligne"
    assert alerts[0]["description_text"] == "Arrets annules"
    assert alerts[0]["alert_header_text_en"] == "Your line"
    assert alerts[0]["description_text_en"] == "Cancelled stops"
    assert entities[0]["route_id"] == "14"
    assert entities[1]["raw_entity_json"] == {"direction_id": "S"}
    assert entities[2]["stop_id"] == "53010"


def test_normalize_i3_alert_payload_matches_bcp47_region_language_tags() -> None:
    snapshot = _snapshot(
        {
            "messages": [
                {
                    "id": "region-1",
                    "header_texts": [
                        {"language": "en-CA", "text": "Detour on route 1"},
                        {"language": "fr-CA", "text": "Detour ligne 1"},
                    ],
                    "description_texts": [
                        {"language": "en-CA", "text": "Major works"},
                        {"language": "fr-CA", "text": "Travaux majeurs"},
                    ],
                }
            ]
        }
    )

    alerts, _, _ = normalize_i3_alert_payload(snapshot)

    assert alerts[0]["alert_header_text"] == "Detour ligne 1"
    assert alerts[0]["description_text"] == "Travaux majeurs"
    assert alerts[0]["alert_header_text_en"] == "Detour on route 1"
    assert alerts[0]["description_text_en"] == "Major works"


def test_normalize_en_is_none_when_feed_has_no_english() -> None:
    snapshot = _snapshot(
        {
            "messages": [
                {
                    "id": "fr-only",
                    "header_texts": [{"language": "fr", "text": "Interruption"}],
                    "description_texts": [{"language": "fr", "text": "Service interrompu"}],
                },
                {
                    "id": "bare-string",
                    "header": "Service interruption",
                    "description": "No service",
                },
                {
                    "id": "marker-less-dict",
                    "header": {"text": "Avis"},
                    "description": {"text": "Texte"},
                },
            ]
        }
    )

    alerts, _, _ = normalize_i3_alert_payload(snapshot)

    assert len(alerts) == 3
    for alert in alerts:
        assert alert["alert_header_text_en"] is None
        assert alert["description_text_en"] is None
    assert alerts[1]["alert_header_text"] == "Service interruption"
    assert alerts[2]["alert_header_text"] == "Avis"


def test_normalize_en_text_none_never_stringifies_language_dict() -> None:
    snapshot = _snapshot(
        {
            "messages": [
                {
                    "id": "en-none",
                    "header_texts": [
                        {"language": "fr", "text": "Votre ligne"},
                        {"language": "en", "text": None},
                    ],
                    "description_texts": [
                        {"language": "fr", "text": "Service interrompu"},
                        {"language": "en", "text": None},
                    ],
                }
            ]
        }
    )

    alerts, _, _ = normalize_i3_alert_payload(snapshot)

    assert alerts[0]["alert_header_text"] == "Votre ligne"
    assert alerts[0]["description_text"] == "Service interrompu"
    assert alerts[0]["alert_header_text_en"] is None
    assert alerts[0]["description_text_en"] is None


def test_normalize_i3_multi_period_shape_emits_all_periods_and_url() -> None:
    snapshot = _snapshot(
        {
            "messages": [
                {
                    "id": "multi-i3",
                    "header_texts": [{"language": "fr", "text": "Fermeture"}],
                    "activePeriods": [
                        {"start": "2026-05-25T04:00:00Z", "end": "2026-05-25T05:00:00Z"},
                        {"start": "2026-06-01T04:00:00Z", "end": "2026-06-01T05:00:00Z"},
                    ],
                    "url": [
                        {"language": "fr", "text": "https://stm.info/avis/x"},
                        {"language": "en", "text": "https://stm.info/en/alert/x"},
                    ],
                }
            ]
        }
    )

    alerts, _entities, periods = normalize_i3_alert_payload(snapshot)

    assert len(alerts) == 1
    row = alerts[0]
    assert row["active_period_start_utc"] == datetime(2026, 5, 25, 4, tzinfo=UTC)
    assert row["url"] == "https://stm.info/avis/x"
    assert row["url_en"] == "https://stm.info/en/alert/x"
    assert [p["period_index"] for p in periods] == [0, 1]
    assert periods[1]["start_utc"] == datetime(2026, 6, 1, 4, tzinfo=UTC)


def test_single_period_hash_is_byte_identical_to_pre_s15_formula() -> None:
    s = datetime(2026, 5, 1, 8, tzinfo=UTC)
    e = datetime(2026, 5, 1, 10, tzinfo=UTC)
    frozen = "fe7cfb8f8f2e46274639499aded61a7e"
    new_single = compute_alert_content_hash(
        alert_id="a1",
        alert_header_text="H",
        description_text="D",
        severity="WARN",
        cause="C",
        effect="EFF",
        active_period_start_utc=s,
        active_period_end_utc=e,
        published_at_utc=None,
        updated_at_utc=None,
    )
    assert new_single == frozen
    with_empty = compute_alert_content_hash(
        alert_id="a1",
        alert_header_text="H",
        description_text="D",
        severity="WARN",
        cause="C",
        effect="EFF",
        active_period_start_utc=s,
        active_period_end_utc=e,
        published_at_utc=None,
        updated_at_utc=None,
        extra_active_periods=[],
    )
    assert with_empty == frozen


def test_multi_period_alert_hashes_differently_from_single_period() -> None:
    s = datetime(2026, 5, 1, 8, tzinfo=UTC)
    e = datetime(2026, 5, 1, 10, tzinfo=UTC)
    single = compute_alert_content_hash(
        alert_id="a1",
        alert_header_text="H",
        description_text="D",
        severity="WARN",
        cause="C",
        effect="EFF",
        active_period_start_utc=s,
        active_period_end_utc=e,
        published_at_utc=None,
        updated_at_utc=None,
    )
    multi = compute_alert_content_hash(
        alert_id="a1",
        alert_header_text="H",
        description_text="D",
        severity="WARN",
        cause="C",
        effect="EFF",
        active_period_start_utc=s,
        active_period_end_utc=e,
        published_at_utc=None,
        updated_at_utc=None,
        extra_active_periods=[
            (datetime(2026, 5, 8, 8, tzinfo=UTC), datetime(2026, 5, 8, 10, tzinfo=UTC))
        ],
    )
    assert single != multi


def test_content_hash_unchanged_by_en_variants() -> None:
    base = {
        "id": "hash-stable",
        "header_texts": [{"language": "fr", "text": "Votre ligne"}],
        "description_texts": [{"language": "fr", "text": "Arrets annules"}],
    }
    with_en = {
        "id": "hash-stable",
        "header_texts": [
            {"language": "fr", "text": "Votre ligne"},
            {"language": "en", "text": "Your line"},
        ],
        "description_texts": [
            {"language": "fr", "text": "Arrets annules"},
            {"language": "en", "text": "Cancelled stops"},
        ],
    }
    no_en_alerts, _, _ = normalize_i3_alert_payload(_snapshot({"messages": [base]}))
    with_en_alerts, _, _ = normalize_i3_alert_payload(_snapshot({"messages": [with_en]}))

    assert no_en_alerts[0]["content_hash"] == with_en_alerts[0]["content_hash"]
    assert no_en_alerts[0]["alert_header_text_en"] is None
    assert with_en_alerts[0]["alert_header_text_en"] == "Your line"
