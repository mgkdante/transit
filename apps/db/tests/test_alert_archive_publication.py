"""Partitioned retained-alert publication contract and builder tests."""

from __future__ import annotations

import hashlib
from datetime import UTC, date, datetime, timedelta

from _sqlfakes import NamedQueryConn

from transit_ops.snapshots import contract


def test_alert_archive_contract_and_manifest_pointer_exist() -> None:
    """RED: the retained collection has explicit bounded page/index contracts."""
    page_type = contract.AlertArchivePage
    index_type = contract.AlertArchiveIndex

    page = page_type(
        generated_utc="2026-07-01T00:00:00Z",
        month="2026-07",
        page=1,
        alerts=[
            {
                "id": "stm-alert-a",
                "first_seen_utc": "2026-07-01T00:00:00Z",
                "last_seen_utc": "2026-07-01T01:00:00Z",
            }
        ],
    )
    index = index_type(
        generated_utc="2026-07-02T00:00:00Z",
        collection_generation_id="generation",
        first_available_date="2026-07-01",
        last_available_date="2026-07-01",
        total_alerts=1,
        months=[],
    )

    assert page.alerts[0].id == "stm-alert-a"
    assert index.total_alerts == 1
    assert contract.ManifestHistoricFiles().alerts_index == "historic/alerts/index.json"
    assert contract.ALERT_ARCHIVE_PAGE_ENTRY_CAP == 250
    assert contract.ALERT_ARCHIVE_PAGE_BYTE_CEILING == 524288


def _row(number: int, **overrides: object) -> dict[str, object]:
    start = datetime(2026, 7, 1, tzinfo=UTC) + timedelta(hours=number)
    row: dict[str, object] = {
        "provider_id": "stm",
        "alert_id": f"stm-alert-{number:04d}",
        "archive_month": date(2026, 7, 1),
        "header_text": f"Alerte {number}",
        "header_text_en": f"Alert {number}",
        "description_text": f"Message {number}",
        "description_text_en": f"Message EN {number}",
        "severity": "WARNING",
        "cause": "CONSTRUCTION",
        "effect": "DETOUR",
        "route_ids": ["45", "10", "45"],
        "stop_ids": ["7002", "7001", "7002"],
        "start_utc": start,
        "end_utc": start + timedelta(minutes=30),
        "active_periods": [
            {
                "start_utc": start.isoformat(),
                "end_utc": (start + timedelta(minutes=30)).isoformat(),
            }
        ],
        "url": "https://www.stm.info/fr/infos/etat-du-service",
        "first_seen_utc": start - timedelta(minutes=5),
        "last_seen_utc": start + timedelta(minutes=35),
        "updated_at_utc": start + timedelta(hours=1),
        "first_available_date": date(2026, 7, 1),
        "last_available_date": date(2026, 7, 31),
    }
    row.update(overrides)
    return row


def _build(rows: list[dict[str, object]], *, stamp: str = "2026-08-01T00:00:00Z"):
    from transit_ops.snapshots.builders import build_alert_archive

    connection = NamedQueryConn({"alerts.archive.publish": rows}, strict=True)
    return build_alert_archive(connection, "stm", generated_utc=stamp), connection


def test_archive_query_is_named_provider_scoped_and_unlimited() -> None:
    from transit_ops.snapshots.builders.historic.alert_archive import _ALERT_ARCHIVE_SQL

    sql = str(_ALERT_ARCHIVE_SQL)
    assert "-- q:alerts.archive.publish" in sql
    assert "provider_id = :provider_id" in sql
    assert "LIMIT" not in sql.upper()
    assert "archive_month DESC" in sql


def test_publish_state_uses_stable_baseline_and_pre_0081_coalesce() -> None:
    from transit_ops.snapshots.publish import (
        _PRIOR_FILES_TOTAL_SQL,
        _record_publish_state,
        _stable_item_total,
        _stable_outcome_total,
    )

    class _Connection:
        def __init__(self) -> None:
            self.params = None

        def execute(self, statement, params=None):  # noqa: ANN001
            self.params = params

    connection = _Connection()
    _record_publish_state(
        connection,
        provider_id="stm",
        tier="historic",
        generated_utc="2026-07-13T00:00:00Z",
        written=13,
        skipped=2,
        total=15,
        stable_total=12,
    )

    assert connection.params["total"] == 15
    assert connection.params["stable_total"] == 12
    assert "COALESCE(stable_files_total, files_total)" in str(_PRIOR_FILES_TOTAL_SQL)
    assert (
        _stable_item_total(
            [
                ("historic/alert_history.json", {}, "historic"),
                ("historic/alerts/index.json", {}, "historic"),
                (
                    "historic/alerts/generations/hash/2026-07/page-0001.json",
                    {},
                    "historic_immutable",
                ),
                (
                    "historic/history/network/generations/hash/2026-07.json",
                    {},
                    "historic",
                ),
                (
                    "historic/history/lines/3437/generations/hash/2026-07.json",
                    {},
                    "historic_immutable",
                ),
                (
                    "historic/history/network/immutable-alias.json",
                    {},
                    "historic_immutable",
                ),
                (
                    "historic/history/stops/53544f50/generations/hash/2026-07.json",
                    {},
                    "historic_immutable",
                ),
                ("historic/history/network/index.json", {}, "historic"),
                ("historic/history/lines/index.json", {}, "historic"),
                ("historic/history/stops/index.json", {}, "historic"),
                ("historic/history/index.json", {}, "historic"),
            ]
        )
        == 6
    )

    class _Outcomes:
        written = [
            "historic/alerts/index.json",
            "historic/history/network/generations/hash/2026-07.json",
        ]
        skipped = [
            "historic/history/index.json",
            "historic/history/lines/3437/generations/hash/2026-07.json",
        ]
        immutable_written = ["historic/history/network/immutable-alias.json"]
        immutable_skipped = ["historic/alerts/generations/hash/2026-07/page-0001.json"]

    assert _stable_outcome_total(_Outcomes()) == 2


def test_archive_builder_is_deterministic_newest_first_from_shuffled_rows() -> None:
    rows = [_row(1), _row(3), _row(2)]
    first, connection = _build(rows)
    second, _ = _build(list(reversed(rows)))

    assert [entry.id for entry in first.page_items[0][1].alerts] == [
        "stm-alert-0003",
        "stm-alert-0002",
        "stm-alert-0001",
    ]
    assert first == second
    assert len(connection.executed) == 1


def test_archive_builder_packs_501_rows_as_250_250_1_without_loss() -> None:
    bundle, _ = _build([_row(number) for number in range(501)])

    pages = [page for _, page in bundle.page_items]
    assert [len(page.alerts) for page in pages] == [250, 250, 1]
    assert len({entry.id for page in pages for entry in page.alerts}) == 501
    assert bundle.index.total_alerts == 501
    assert bundle.index.months[0].total_alerts == 501


def test_archive_builder_round_trips_long_unicode_html_and_splits_on_bytes(
    monkeypatch,
) -> None:
    from transit_ops.snapshots.builders.historic import alert_archive as archive_module

    monkeypatch.setattr(archive_module, "ALERT_ARCHIVE_PAGE_BYTE_CEILING", 1800)
    message_fr = "<p>🚇 État du service — Côte-Vertu</p>" * 15
    message_en = "<p>🚇 Service status — Côte-Vertu</p>" * 15
    bundle, _ = _build(
        [
            _row(1, description_text=message_fr, description_text_en=message_en),
            _row(2, description_text=message_fr, description_text_en=message_en),
        ]
    )

    assert len(bundle.page_items) == 2
    assert bundle.page_items[0][1].alerts[0].description == message_fr
    assert bundle.page_items[0][1].alerts[0].description_en == message_en


def test_archive_paths_reuse_same_sha_and_change_with_content() -> None:
    from transit_ops.snapshots.serialization import snapshot_json_bytes

    first, _ = _build([_row(1)])
    same, _ = _build([_row(1)], stamp="2027-01-01T00:00:00Z")
    changed, _ = _build([_row(1, description_text="changed")])

    first_path, first_page = first.page_items[0]
    assert first_path == same.page_items[0][0]
    assert first_path != changed.page_items[0][0]
    body = snapshot_json_bytes(first_page)
    assert hashlib.sha256(body).hexdigest() in first_path
    assert first.index.months[0].pages[0].byte_size == len(body)


def test_run_envelope_stamping_never_mutates_content_addressed_page_bytes() -> None:
    from transit_ops.snapshots.publish import _stamp_envelope
    from transit_ops.snapshots.serialization import snapshot_json_bytes

    bundle, _ = _build([_row(1)])
    path, page = bundle.page_items[0]
    before = snapshot_json_bytes(page)
    items = [
        (path, page, "historic_immutable"),
        ("historic/alerts/index.json", bundle.index, "historic"),
    ]

    _stamp_envelope(items, provider_id="stm", stamp="2030-01-01T00:00:00Z")

    assert snapshot_json_bytes(page) == before
    assert page.publish_generation_id is None
    assert page.methodology_version == "alerts-1"
    assert bundle.index.publish_generation_id == "stm@2030-01-01T00:00:00Z"


def test_all_content_addressed_partition_bytes_and_digests_ignore_run_stamps() -> None:
    from transit_ops.snapshots.publish import _stamp_envelope
    from transit_ops.snapshots.serialization import snapshot_json_bytes, snapshot_sha256

    archive, _ = _build([_row(1)])
    partitions = [
        archive.page_items[0],
        (
            "historic/history/network/generations/hash/2026-07.json",
            contract.NetworkHistoryPartition(
                generated_utc="2026-07-31T00:00:00Z",
                month="2026-07",
                days=[{"date": "2026-07-01", "vehicles": 1}],
            ),
        ),
        (
            "historic/history/lines/3437/generations/hash/2026-07.json",
            contract.LineHistoryPartition(
                generated_utc="2026-07-31T00:00:00Z",
                month="2026-07",
                entity_id="47",
                days=[
                    {
                        "date": "2026-07-01",
                        "delay": {
                            "observation_count": 1,
                            "in_clamp_observation_count": 1,
                            "on_time_count": 1,
                            "severe_count": 0,
                            "sum_delay_seconds": 0,
                        },
                    }
                ],
            ),
        ),
        (
            "historic/history/stops/53544f50/generations/hash/2026-07.json",
            contract.StopHistoryPartition(
                generated_utc="2026-07-31T00:00:00Z",
                month="2026-07",
                entity_id="STOP",
                days=[
                    {
                        "date": "2026-07-01",
                        "occupancy": {
                            "empty": 1,
                            "many_seats": 0,
                            "few_seats": 0,
                            "standing": 0,
                            "full": 0,
                        },
                    }
                ],
            ),
        ),
    ]

    for path, payload in partitions:
        before_bytes = snapshot_json_bytes(payload)
        before_digest = snapshot_sha256(payload)
        items = [(path, payload, "historic_immutable")]

        _stamp_envelope(items, provider_id="stm", stamp="2030-01-01T00:00:00Z")
        after_first = snapshot_json_bytes(payload)
        _stamp_envelope(items, provider_id="stm", stamp="2040-01-01T00:00:00Z")

        assert after_first == before_bytes
        assert snapshot_json_bytes(payload) == before_bytes
        assert snapshot_sha256(payload) == before_digest
        assert payload.publish_generation_id is None


def test_archive_index_envelopes_observation_and_active_period_coverage() -> None:
    start = datetime(2026, 6, 20, tzinfo=UTC)
    end = datetime(2026, 8, 4, tzinfo=UTC)
    bundle, _ = _build(
        [
            _row(
                1,
                first_available_date=date(2026, 5, 12),
                last_available_date=date(2026, 7, 31),
                active_periods=[{"start_utc": start.isoformat(), "end_utc": end.isoformat()}],
            )
        ]
    )

    ref = bundle.index.months[0].pages[0]
    assert bundle.index.first_available_date == "2026-05-12"
    assert bundle.index.last_available_date == "2026-08-04"
    assert ref.coverage_start == "2026-06-20"
    assert ref.coverage_end == "2026-08-04"


def test_archive_empty_index_is_honest_and_stable() -> None:
    bundle, _ = _build([])

    assert bundle.page_items == []
    assert bundle.index.total_alerts == 0
    assert bundle.index.months == []
    assert bundle.index.first_available_date is None
    assert bundle.index.last_available_date is None
    assert len(bundle.index.collection_generation_id) == 64


def test_legacy_newest_500_payload_bytes_window_count_and_truncation_are_unchanged() -> None:
    from transit_ops.snapshots.builders import build_alert_history
    from transit_ops.snapshots.builders.historic.small_surfaces import _ALERT_HISTORY_SQL

    row = {
        "alert_header_text": "Fermeture métro",
        "header_text_en": "Metro closure",
        "description": "<p>FR</p>",
        "description_en": "<p>EN</p>",
        "severity": "WARNING",
        "cause": "CONSTRUCTION",
        "effect": "NO_SERVICE",
        "routes": ["2", "1", "2"],
        "stops": ["20", "10"],
        "start_utc": datetime(2026, 7, 1, 1, tzinfo=UTC),
        "end_utc": datetime(2026, 7, 1, 2, tzinfo=UTC),
        "url": "https://stm.info/a",
        "active_periods": [
            {
                "start_utc": "2026-07-01T01:00:00+00:00",
                "end_utc": "2026-07-01T02:00:00+00:00",
            }
        ],
    }
    connection = NamedQueryConn(
        {
            "alerts.history.anchor": [{"anchor": date(2026, 7, 13)}],
            "alerts.history.count": [{"total": 501}],
            "alerts.history": [row],
        },
        strict=True,
    )

    payload = build_alert_history(
        connection,
        "stm",
        generated_utc="2026-07-13T00:00:00Z",
    )

    assert payload.model_dump_json() == (
        '{"schema_version":1,"methodology_version":null,"publish_generation_id":null,'
        '"generated_utc":"2026-07-13T00:00:00Z","alerts":[{"id":'
        '"stm-alert-c05f3bcfdc39","severity":"high","header_text":"Fermeture métro",'
        '"header_text_en":"Metro closure","description":"<p>FR</p>",'
        '"description_en":"<p>EN</p>","routes":["1","2"],"stops":["10","20"],'
        '"start_utc":"2026-07-01T01:00:00Z","end_utc":"2026-07-01T02:00:00Z",'
        '"duration_min":60.0,"impact_passages":null,"cause":"CONSTRUCTION",'
        '"effect":"NO_SERVICE","severity_level":"WARNING","url":"https://stm.info/a",'
        '"active_periods":[{"start_utc":"2026-07-01T01:00:00Z",'
        '"end_utc":"2026-07-01T02:00:00Z"}]}],"breakdown":{"by_cause":'
        '[{"key":"CONSTRUCTION","count":1,"median_duration_min":60.0}],"by_effect":'
        '[{"key":"NO_SERVICE","count":1,"median_duration_min":60.0}],"by_severity":'
        '[{"key":"high","count":1,"median_duration_min":60.0}]},'
        '"window_start":"2026-04-14","window_end":"2026-07-13",'
        '"total_in_window":501,"truncated":true}'
    )
    assert "LIMIT 500" in str(_ALERT_HISTORY_SQL)


def test_archive_page_gate_rejects_oversized_singleton() -> None:
    from transit_ops.snapshots.gate import check_alert_archive_page

    page = contract.AlertArchivePage(
        generated_utc="2026-07-01T00:00:00Z",
        month="2026-07",
        page=1,
        alerts=[
            contract.AlertArchiveEntry(
                id="huge",
                description="é" * contract.ALERT_ARCHIVE_PAGE_BYTE_CEILING,
                first_seen_utc="2026-07-01T00:00:00Z",
                last_seen_utc="2026-07-01T01:00:00Z",
            )
        ],
    )

    findings = check_alert_archive_page(
        page,
        rel_key="historic/alerts/generations/hash/2026-07/page-0001.json",
    )
    assert "byte_ceiling" in {finding.check for finding in findings}


def test_archive_bundle_gate_rejects_dishonest_ref_totals_bytes_and_sha() -> None:
    from transit_ops.snapshots.gate import check_alert_archive_bundle

    bundle, _ = _build([_row(1)])
    dishonest = bundle.index.model_copy(deep=True)
    dishonest.total_alerts = 2
    dishonest.months[0].pages[0].byte_size += 1
    dishonest.months[0].pages[0].sha256 = "0" * 64

    findings = check_alert_archive_bundle(dishonest, bundle.page_items)
    checks = {finding.check for finding in findings}
    assert "archive_total" in checks
    assert "ref_byte_size" in checks
    assert "ref_sha256" in checks


def test_archive_bundle_gate_rejects_duplicate_paths_metadata_and_generation_id() -> None:
    from transit_ops.snapshots.gate import check_alert_archive_bundle

    bundle, _ = _build([_row(1)])
    dishonest = bundle.index.model_copy(deep=True)
    dishonest.collection_generation_id = "0" * 64
    duplicate_ref = dishonest.months[0].pages[0].model_copy(deep=True)
    duplicate_ref.page = 2
    dishonest.months[0].pages.append(duplicate_ref)
    dishonest.months[0].total_alerts = 2
    dishonest.total_alerts = 2

    findings = check_alert_archive_bundle(
        dishonest,
        [bundle.page_items[0], bundle.page_items[0]],
        provider_timezone=bundle.provider_timezone,
    )
    checks = {finding.check for finding in findings}
    assert "duplicate_built_path" in checks
    assert "duplicate_ref_path" in checks
    assert "ref_page_metadata" in checks
    assert "collection_generation_id" in checks


def test_archive_index_gate_reports_non_string_month_without_crashing() -> None:
    from transit_ops.snapshots.gate import check_alert_archive_index

    bundle, _ = _build([_row(1)])
    malformed = bundle.index.model_dump(mode="json")
    malformed["months"][0]["month"] = None
    malformed["months"].append({**malformed["months"][0], "month": "2026-06"})

    findings = check_alert_archive_index(
        malformed,
        rel_key="historic/alerts/index.json",
    )

    assert "month_format" in {finding.check for finding in findings}


def test_archive_page_gate_reuses_existing_alert_rules_and_newest_order() -> None:
    from transit_ops.snapshots.gate import check_alert_archive_page

    bundle, _ = _build([_row(1), _row(2)])
    path, page = bundle.page_items[0]
    page.alerts.reverse()
    page.alerts[0].duration_min = -1
    page.alerts[0].active_periods = [
        contract.AlertActivePeriod(
            start_utc="2026-07-02T00:00:00Z",
            end_utc="2026-07-01T00:00:00Z",
        )
    ]

    checks = {finding.check for finding in check_alert_archive_page(page, rel_key=path)}
    assert "entry_order" in checks
    assert "count_negative" in checks
    assert "window_order" in checks


def test_archive_tie_break_is_id_ascending_and_coverage_uses_provider_local_dates() -> None:
    from transit_ops.snapshots.gate import check_alert_archive_bundle

    observed = datetime(2026, 7, 2, 0, 30, tzinfo=UTC)
    future = datetime(2026, 8, 5, 0, 30, tzinfo=UTC)
    common = {
        "start_utc": observed,
        "end_utc": observed + timedelta(minutes=30),
        "first_seen_utc": observed,
        "last_seen_utc": observed + timedelta(minutes=5),
        "provider_timezone": "America/Toronto",
        "first_available_date": date(2026, 7, 1),
        "last_available_date": date(2026, 7, 1),
    }
    bundle, _ = _build(
        [
            _row(
                2,
                alert_id="z-alert",
                **common,
                active_periods=[{"start_utc": future.isoformat(), "end_utc": None}],
            ),
            _row(1, alert_id="a-alert", **common, active_periods=[]),
        ]
    )

    page = bundle.page_items[0][1]
    ref = bundle.index.months[0].pages[0]
    assert [entry.id for entry in page.alerts] == ["a-alert", "z-alert"]
    # 00:30Z is still the prior Montréal service date. The future active period
    # must widen both the page and collection bounds so the public picker can
    # actually select the advertised page coverage.
    assert ref.coverage_start == "2026-07-01"
    assert ref.coverage_end == "2026-08-04"
    assert bundle.index.first_available_date == "2026-07-01"
    assert bundle.index.last_available_date == "2026-08-04"
    assert not check_alert_archive_bundle(
        bundle.index,
        bundle.page_items,
        provider_timezone=bundle.provider_timezone,
    )
