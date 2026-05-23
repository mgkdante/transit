from __future__ import annotations

import json
from datetime import UTC, date, datetime

from transit_ops.ingestion.storage import BronzeObjectInfo
from transit_ops.rebuild.bronze_cleanup import (
    build_bronze_cleanup_plan,
    execute_bronze_cleanup_plan,
    parse_bronze_key,
)


class FakeListDeleteStorage:
    def __init__(
        self,
        keys: list[str],
        *,
        fail_delete_keys: set[str] | None = None,
    ) -> None:
        self.keys = keys
        self.fail_delete_keys = fail_delete_keys or set()
        self.listed_prefixes: list[str] = []
        self.deleted_keys: list[str] = []

    def list_objects(self, prefix: str) -> list[BronzeObjectInfo]:
        self.listed_prefixes.append(prefix)
        return [
            BronzeObjectInfo(storage_path=key, byte_size=None, last_modified=None)
            for key in self.keys
            if key.startswith(prefix)
        ]

    def delete_object(self, storage_path: str) -> None:
        if storage_path in self.fail_delete_keys:
            raise RuntimeError(f"delete failed for {storage_path}")
        self.deleted_keys.append(storage_path)


def test_parse_static_key_extracts_date_and_timestamp() -> None:
    key = (
        "stm/static_schedule/ingested_at_utc=2026-04-30/"
        "20260430T120000000000Z__abc123def456__gtfs.zip"
    )

    parsed = parse_bronze_key(key)

    assert parsed is not None
    assert parsed.provider_id == "stm"
    assert parsed.endpoint_key == "static_schedule"
    assert parsed.key_date == date(2026, 4, 30)
    assert parsed.observed_at_utc == datetime(2026, 4, 30, 12, 0, tzinfo=UTC)
    assert parsed.checksum_prefix == "abc123def456"


def test_parse_realtime_key_extracts_date_and_timestamp() -> None:
    key = (
        "stm/trip_updates/captured_at_utc=2026-05-01/"
        "20260501T003015123456Z__feedabc12345__trip_updates.pb"
    )

    parsed = parse_bronze_key(key)

    assert parsed is not None
    assert parsed.provider_id == "stm"
    assert parsed.endpoint_key == "trip_updates"
    assert parsed.key_date == date(2026, 5, 1)
    assert parsed.observed_at_utc == datetime(2026, 5, 1, 0, 30, 15, 123456, tzinfo=UTC)
    assert parsed.checksum_prefix == "feedabc12345"


def test_parse_unknown_key_returns_none() -> None:
    assert parse_bronze_key("stm/trip_updates/mystery.pb") is None
    assert (
        parse_bronze_key(
            "stm/alerts/captured_at_utc=2026-04-30/20260430T120000000000Z__deadbeef1234__alerts.pb"
        )
        is None
    )


def test_parse_key_with_invalid_checksum_returns_none() -> None:
    assert (
        parse_bronze_key(
            "stm/trip_updates/captured_at_utc=2026-04-30/"
            "20260430T120000000000Z__old__trip_updates.pb"
        )
        is None
    )
    assert (
        parse_bronze_key(
            "stm/static_schedule/ingested_at_utc=2026-04-30/"
            "20260430T120000000000Z__abc123def45g__gtfs.zip"
        )
        is None
    )


def test_parse_realtime_key_with_invalid_filename_returns_none() -> None:
    assert (
        parse_bronze_key(
            "stm/trip_updates/captured_at_utc=2026-04-30/"
            "20260430T120000000000Z__deadbeef1234__vehicle_positions.pb"
        )
        is None
    )
    assert (
        parse_bronze_key(
            "stm/vehicle_positions/captured_at_utc=2026-04-30/"
            "20260430T120000000000Z__deadbeef1234__vehicle_positions.tmp"
        )
        is None
    )


def test_parse_static_key_with_invalid_filename_returns_none() -> None:
    assert (
        parse_bronze_key(
            "stm/static_schedule/ingested_at_utc=2026-04-30/"
            "20260430T120000000000Z__deadbeef1234__not_gtfs.txt"
        )
        is None
    )


def test_parse_key_with_short_fraction_timestamp_returns_none() -> None:
    assert (
        parse_bronze_key(
            "stm/trip_updates/captured_at_utc=2026-04-30/"
            "20260430T1200001Z__deadbeef1234__trip_updates.pb"
        )
        is None
    )


def test_parse_key_with_partition_timestamp_date_mismatch_returns_none() -> None:
    assert (
        parse_bronze_key(
            "stm/trip_updates/captured_at_utc=2026-04-30/"
            "20260501T000000000000Z__deadbeef1234__trip_updates.pb"
        )
        is None
    )


def test_cleanup_plan_deletes_only_pre_may_known_keys() -> None:
    storage = FakeListDeleteStorage(
        [
            "stm/trip_updates/captured_at_utc=2026-04-30/20260430T120000000000Z__deadbeef1234__trip_updates.pb",
            "stm/trip_updates/captured_at_utc=2026-05-01/20260501T000000000000Z__abcdef123456__trip_updates.pb",
            "stm/trip_updates/mystery.pb",
        ]
    )

    plan = build_bronze_cleanup_plan(storage, provider_id="stm", keep_from_date=date(2026, 5, 1))

    assert storage.listed_prefixes == [
        "stm/static_schedule/",
        "stm/trip_updates/",
        "stm/vehicle_positions/",
    ]
    assert [item.storage_path for item in plan.eligible_objects] == [storage.keys[0]]
    assert plan.skipped_unknown_keys == ["stm/trip_updates/mystery.pb"]


def test_cleanup_plan_keeps_may_and_later_known_keys() -> None:
    storage = FakeListDeleteStorage(
        [
            "stm/static_schedule/ingested_at_utc=2026-04-30/20260430T120000000000Z__deadbeef1234__gtfs.zip",
            "stm/static_schedule/ingested_at_utc=2026-05-01/20260501T000000000000Z__abcdef123456__gtfs.zip",
            "stm/vehicle_positions/captured_at_utc=2026-05-02/20260502T010000000000Z__123456abcdef__vehicle_positions.pb",
        ]
    )

    plan = build_bronze_cleanup_plan(storage, provider_id="stm", keep_from_date=date(2026, 5, 1))

    assert [item.storage_path for item in plan.eligible_objects] == [storage.keys[0]]
    assert [item.storage_path for item in plan.retained_objects] == storage.keys[1:]
    assert plan.skipped_unknown_keys == []


def test_cleanup_plan_reports_malformed_known_keys_as_unknown() -> None:
    storage = FakeListDeleteStorage(
        [
            "stm/static_schedule/ingested_at_utc=not-a-date/20260430T120000000000Z__deadbeef1234__gtfs.zip",
            "stm/vehicle_positions/captured_at_utc=2026-04-30/not-a-timestamp__deadbeef1234__vehicle_positions.pb",
        ]
    )

    plan = build_bronze_cleanup_plan(storage, provider_id="stm", keep_from_date=date(2026, 5, 1))

    assert plan.eligible_objects == []
    assert plan.skipped_unknown_keys == storage.keys


def test_cleanup_plan_skips_invalid_checksum_and_realtime_filename() -> None:
    storage = FakeListDeleteStorage(
        [
            "stm/static_schedule/ingested_at_utc=2026-04-30/20260430T120000000000Z__123456abcdef__not_gtfs.txt",
            "stm/trip_updates/captured_at_utc=2026-04-30/20260430T120000000000Z__old__trip_updates.pb",
            "stm/trip_updates/captured_at_utc=2026-04-30/20260430T120000000000Z__deadbeef1234__vehicle_positions.pb",
            "stm/vehicle_positions/captured_at_utc=2026-04-30/20260430T120000000000Z__abcdef123456__vehicle_positions.pb",
        ]
    )

    plan = build_bronze_cleanup_plan(storage, provider_id="stm", keep_from_date=date(2026, 5, 1))

    assert [item.storage_path for item in plan.eligible_objects] == [storage.keys[3]]
    assert plan.skipped_unknown_keys == sorted(storage.keys[:3])


def test_cleanup_plan_sorts_outputs_by_storage_path() -> None:
    retained_b_key = (
        "stm/trip_updates/captured_at_utc=2026-05-01/"
        "20260501T120000000000Z__bbbbbbbbbbbb__trip_updates.pb"
    )
    retained_a_key = (
        "stm/trip_updates/captured_at_utc=2026-05-01/"
        "20260501T000000000000Z__aaaaaaaaaaaa__trip_updates.pb"
    )
    eligible_b_key = (
        "stm/trip_updates/captured_at_utc=2026-04-30/"
        "20260430T120000000000Z__bbbbbbbbbbbb__trip_updates.pb"
    )
    eligible_a_key = (
        "stm/trip_updates/captured_at_utc=2026-04-30/"
        "20260430T000000000000Z__aaaaaaaaaaaa__trip_updates.pb"
    )
    unknown_b_key = "stm/trip_updates/zzz.pb"
    unknown_a_key = "stm/trip_updates/aaa.pb"
    storage = FakeListDeleteStorage(
        [
            retained_b_key,
            retained_a_key,
            eligible_b_key,
            unknown_b_key,
            eligible_a_key,
            unknown_a_key,
        ]
    )

    plan = build_bronze_cleanup_plan(storage, provider_id="stm", keep_from_date=date(2026, 5, 1))

    assert [item.storage_path for item in plan.eligible_objects] == [
        eligible_a_key,
        eligible_b_key,
    ]
    assert [item.storage_path for item in plan.retained_objects] == [
        retained_a_key,
        retained_b_key,
    ]
    assert plan.skipped_unknown_keys == [unknown_a_key, unknown_b_key]


def test_cleanup_display_dicts_are_json_safe() -> None:
    storage = FakeListDeleteStorage(
        [
            "stm/trip_updates/captured_at_utc=2026-04-30/20260430T120000000000Z__deadbeef1234__trip_updates.pb",
            "stm/trip_updates/mystery.pb",
        ]
    )
    plan = build_bronze_cleanup_plan(storage, provider_id="stm", keep_from_date=date(2026, 5, 1))
    result = execute_bronze_cleanup_plan(storage, plan, delete=False)

    plan_payload = plan.display_dict()
    result_payload = result.display_dict()

    json.dumps(plan_payload)
    json.dumps(result_payload)
    assert plan_payload["keep_from_date"] == "2026-05-01"
    assert plan_payload["eligible_objects"][0]["parsed_key"]["observed_at_utc"] == (
        "2026-04-30T12:00:00+00:00"
    )
    assert result_payload["delete_requested"] is False
    assert result_payload["skipped_unknown_keys"] == ["stm/trip_updates/mystery.pb"]


def test_execute_cleanup_plan_dry_run_reports_without_deleting() -> None:
    storage = FakeListDeleteStorage(
        [
            "stm/trip_updates/captured_at_utc=2026-04-30/20260430T120000000000Z__deadbeef1234__trip_updates.pb",
        ]
    )
    plan = build_bronze_cleanup_plan(storage, provider_id="stm", keep_from_date=date(2026, 5, 1))

    result = execute_bronze_cleanup_plan(storage, plan, delete=False)

    assert result.delete_requested is False
    assert result.eligible_count == 1
    assert result.deleted_keys == []
    assert result.failed_keys == []
    assert storage.deleted_keys == []


def test_execute_cleanup_plan_collects_delete_failures_and_keeps_going() -> None:
    failing_key = (
        "stm/trip_updates/captured_at_utc=2026-04-30/"
        "20260430T120000000000Z__deadbeef1234__trip_updates.pb"
    )
    successful_key = (
        "stm/vehicle_positions/captured_at_utc=2026-04-30/"
        "20260430T120500000000Z__abcdef123456__vehicle_positions.pb"
    )
    storage = FakeListDeleteStorage(
        [failing_key, successful_key],
        fail_delete_keys={failing_key},
    )
    plan = build_bronze_cleanup_plan(storage, provider_id="stm", keep_from_date=date(2026, 5, 1))

    result = execute_bronze_cleanup_plan(storage, plan, delete=True)

    assert result.delete_requested is True
    assert result.deleted_keys == [successful_key]
    assert result.failed_keys == [failing_key]
    assert storage.deleted_keys == [successful_key]
