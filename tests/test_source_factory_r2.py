from __future__ import annotations

import json
from datetime import UTC, date, datetime

import pytest

from transit_ops.ingestion.storage import BronzeObjectInfo
from transit_ops.source_factory.r2 import (
    R2CleanupPlan,
    R2InventoryItem,
    build_r2_cleanup_plan_from_inventory,
    build_r2_inventory,
    execute_r2_cleanup_plan,
    run_r2_prune_cycle,
)

STATIC_OLD = (
    "stm/static_schedule/ingested_at_utc=2026-04-30/"
    "20260430T120000000000Z__aaaaaaaaaaaa__gtfs.zip"
)
TRIP_OLD = (
    "stm/trip_updates/captured_at_utc=2026-04-30/"
    "20260430T120000000000Z__bbbbbbbbbbbb__trip_updates.pb"
)
TRIP_NEW = (
    "stm/trip_updates/captured_at_utc=2026-05-01/"
    "20260501T120000000000Z__cccccccccccc__trip_updates.pb"
)
VEHICLE_NEW = (
    "stm/vehicle_positions/captured_at_utc=2026-05-02/"
    "20260502T120000000000Z__dddddddddddd__vehicle_positions.pb"
)
UNKNOWN_KEY = "stm/trip_updates/mystery.pb"
GIS_SOURCE_KEY = (
    "stm/gis_static/ingested_at_utc=2026-04-30/"
    "20260430T120000000000Z__eeeeeeeeeeee__gis.zip"
)
I3_SOURCE_KEY = (
    "stm/i3_alerts/captured_at_utc=2026-04-30/"
    "20260430T120000000000Z__ffffffffffff__alerts.json"
)
MALFORMED_KEY = (
    "stm/static_schedule/ingested_at_utc=not-a-date/"
    "20260430T120000000000Z__eeeeeeeeeeee__gtfs.zip"
)
PRE_GENERATED_AT = datetime(2026, 5, 25, 12, 0, tzinfo=UTC)
POST_GENERATED_AT = datetime(2026, 5, 25, 12, 1, tzinfo=UTC)


class FakeR2Storage:
    def __init__(
        self,
        keys: list[str],
        *,
        fail_delete_keys: set[str] | None = None,
    ) -> None:
        self.keys = list(keys)
        self.fail_delete_keys = fail_delete_keys or set()
        self.listed_prefixes: list[str] = []
        self.deleted_keys: list[str] = []

    def list_objects(self, prefix: str) -> list[BronzeObjectInfo]:
        self.listed_prefixes.append(prefix)
        return [
            BronzeObjectInfo(
                storage_path=key,
                byte_size=len(key),
                last_modified=datetime(2026, 5, 25, 12, 0, tzinfo=UTC),
            )
            for key in self.keys
            if key.startswith(prefix)
        ]

    def delete_object(self, storage_path: str) -> None:
        if storage_path in self.fail_delete_keys:
            raise RuntimeError(f"delete failed for {storage_path}")
        self.deleted_keys.append(storage_path)
        self.keys.remove(storage_path)


def test_inventory_scans_active_prefixes_and_classifies_known_vs_unknown_keys() -> None:
    storage = FakeR2Storage([STATIC_OLD, TRIP_NEW, VEHICLE_NEW, UNKNOWN_KEY, MALFORMED_KEY])
    generated_at = datetime(2026, 5, 25, 12, 0, tzinfo=UTC)

    inventory = build_r2_inventory(storage, provider_id="stm", generated_at_utc=generated_at)

    assert storage.listed_prefixes == [
        "stm/static_schedule/",
        "stm/trip_updates/",
        "stm/vehicle_positions/",
    ]
    assert inventory.prefixes == (
        "stm/static_schedule/",
        "stm/trip_updates/",
        "stm/vehicle_positions/",
    )
    assert [item.storage_path for item in inventory.objects] == [
        STATIC_OLD,
        MALFORMED_KEY,
        TRIP_NEW,
        UNKNOWN_KEY,
        VEHICLE_NEW,
    ]
    assert [item.storage_path for item in inventory.known_objects] == [
        STATIC_OLD,
        TRIP_NEW,
        VEHICLE_NEW,
    ]
    assert inventory.unknown_keys == [MALFORMED_KEY, UNKNOWN_KEY]


def test_normal_cleanup_plan_deletes_only_old_known_keys_and_skips_unknown_keys() -> None:
    inventory = build_r2_inventory(
        FakeR2Storage([STATIC_OLD, TRIP_OLD, TRIP_NEW, UNKNOWN_KEY]),
        provider_id="stm",
        generated_at_utc=datetime(2026, 5, 25, 12, 0, tzinfo=UTC),
    )

    plan = build_r2_cleanup_plan_from_inventory(
        inventory,
        keep_from_date=date(2026, 5, 1),
    )

    assert [item.storage_path for item in plan.eligible_objects] == [STATIC_OLD, TRIP_OLD]
    assert [item.storage_path for item in plan.retained_objects] == [TRIP_NEW]
    assert plan.skipped_unknown_keys == [UNKNOWN_KEY]
    assert plan.active_prefix_wipe is False


def test_dry_run_execution_does_not_delete_and_needs_no_confirmations() -> None:
    storage = FakeR2Storage([TRIP_OLD])
    plan = build_r2_cleanup_plan_from_inventory(
        build_r2_inventory(storage, provider_id="stm"),
        keep_from_date=date(2026, 5, 1),
    )

    result = execute_r2_cleanup_plan(storage, plan, execute=False)

    assert result.execute is False
    assert result.confirm_r2_cleanup is False
    assert result.deleted_keys == []
    assert result.failed_keys == []
    assert storage.deleted_keys == []


def test_execute_requires_confirm_r2_cleanup() -> None:
    storage = FakeR2Storage([TRIP_OLD])
    plan = build_r2_cleanup_plan_from_inventory(
        build_r2_inventory(storage, provider_id="stm"),
        keep_from_date=date(2026, 5, 1),
    )

    with pytest.raises(PermissionError, match="confirm_r2_cleanup"):
        execute_r2_cleanup_plan(storage, plan, execute=True)

    assert storage.deleted_keys == []


def test_active_prefix_wipe_includes_unknowns_and_requires_separate_confirmation() -> None:
    storage = FakeR2Storage([TRIP_OLD, TRIP_NEW, UNKNOWN_KEY])
    plan = build_r2_cleanup_plan_from_inventory(
        build_r2_inventory(storage, provider_id="stm"),
        keep_from_date=date(2026, 5, 1),
        active_prefix_wipe=True,
    )

    assert plan.active_prefix_wipe is True
    assert [item.storage_path for item in plan.eligible_objects] == [
        TRIP_OLD,
        TRIP_NEW,
        UNKNOWN_KEY,
    ]
    assert plan.retained_objects == []
    assert plan.skipped_unknown_keys == []
    assert plan.unknown_keys_included_in_wipe == [UNKNOWN_KEY]

    with pytest.raises(PermissionError, match="confirm_active_prefix_wipe"):
        execute_r2_cleanup_plan(storage, plan, execute=True, confirm_r2_cleanup=True)

    assert storage.deleted_keys == []


def test_active_prefix_wipe_executes_with_both_confirmations() -> None:
    storage = FakeR2Storage([TRIP_OLD, TRIP_NEW, UNKNOWN_KEY])
    plan = build_r2_cleanup_plan_from_inventory(
        build_r2_inventory(storage, provider_id="stm"),
        keep_from_date=date(2026, 5, 1),
        active_prefix_wipe=True,
    )

    result = execute_r2_cleanup_plan(
        storage,
        plan,
        execute=True,
        confirm_r2_cleanup=True,
        confirm_active_prefix_wipe=True,
    )

    assert result.deleted_keys == [TRIP_OLD, TRIP_NEW, UNKNOWN_KEY]
    assert result.skipped_unknown_keys == []
    assert result.unknown_keys_included_in_wipe == [UNKNOWN_KEY]
    assert storage.keys == []


def test_normal_execute_rejects_hand_constructed_unsafe_plan() -> None:
    new_item = build_r2_inventory(FakeR2Storage([TRIP_NEW]), provider_id="stm").objects[0]
    unknown_item = R2InventoryItem(
        storage_path=UNKNOWN_KEY,
        byte_size=None,
        last_modified=None,
        parsed_key=None,
    )
    plan = R2CleanupPlan(
        provider_id="stm",
        keep_from_date=date(2026, 5, 1),
        inventory_generated_at_utc=PRE_GENERATED_AT,
        eligible_objects=[new_item, unknown_item],
        retained_objects=[],
        skipped_unknown_keys=[],
        active_prefix_wipe=False,
    )
    storage = FakeR2Storage([TRIP_NEW, UNKNOWN_KEY])

    with pytest.raises(ValueError, match="outside the approved known Bronze retention window"):
        execute_r2_cleanup_plan(
            storage,
            plan,
            execute=True,
            confirm_r2_cleanup=True,
        )

    assert storage.deleted_keys == []


def test_delete_failures_are_reported_and_execution_continues() -> None:
    storage = FakeR2Storage([STATIC_OLD, TRIP_OLD], fail_delete_keys={STATIC_OLD})
    plan = build_r2_cleanup_plan_from_inventory(
        build_r2_inventory(storage, provider_id="stm"),
        keep_from_date=date(2026, 5, 1),
    )

    result = execute_r2_cleanup_plan(
        storage,
        plan,
        execute=True,
        confirm_r2_cleanup=True,
    )

    assert result.deleted_keys == [TRIP_OLD]
    assert result.failed_keys == [STATIC_OLD]
    assert storage.deleted_keys == [TRIP_OLD]


def test_prune_cycle_writes_artifacts_and_reinventories_after_delete(tmp_path) -> None:
    storage = FakeR2Storage([TRIP_OLD, TRIP_NEW, UNKNOWN_KEY])
    timestamps = iter([PRE_GENERATED_AT, POST_GENERATED_AT])

    result = run_r2_prune_cycle(
        storage,
        provider_id="stm",
        keep_from_date=date(2026, 5, 1),
        artifact_dir=tmp_path,
        execute=True,
        confirm_r2_cleanup=True,
        clock=lambda: next(timestamps),
    )

    assert storage.listed_prefixes == [
        "stm/static_schedule/",
        "stm/trip_updates/",
        "stm/vehicle_positions/",
        "stm/static_schedule/",
        "stm/trip_updates/",
        "stm/vehicle_positions/",
    ]
    assert result.cleanup_result.deleted_keys == [TRIP_OLD]
    assert [item.storage_path for item in result.pre_inventory.objects] == [
        TRIP_OLD,
        TRIP_NEW,
        UNKNOWN_KEY,
    ]
    assert [item.storage_path for item in result.post_inventory.objects] == [
        TRIP_NEW,
        UNKNOWN_KEY,
    ]
    assert result.pre_inventory.generated_at_utc == PRE_GENERATED_AT
    assert result.post_inventory.generated_at_utc == POST_GENERATED_AT
    assert set(result.artifacts) == {
        "pre_inventory",
        "cleanup_plan",
        "post_inventory",
    }

    pre_path = tmp_path / "stm-r2-pre-inventory.json"
    plan_path = tmp_path / "stm-r2-cleanup-plan.json"
    post_path = tmp_path / "stm-r2-post-inventory.json"
    assert pre_path.exists()
    assert plan_path.exists()
    assert post_path.exists()

    pre_payload = json.loads(pre_path.read_text())
    plan_payload = json.loads(plan_path.read_text())
    post_payload = json.loads(post_path.read_text())
    assert pre_payload["objects"][0]["storage_path"] == TRIP_OLD
    assert pre_payload["generated_at_utc"] == PRE_GENERATED_AT.isoformat()
    assert plan_payload["skipped_unknown_keys"] == [UNKNOWN_KEY]
    assert post_payload["generated_at_utc"] == POST_GENERATED_AT.isoformat()
    assert [item["storage_path"] for item in post_payload["objects"]] == [
        TRIP_NEW,
        UNKNOWN_KEY,
    ]


def test_prune_cycle_can_inventory_source_factory_endpoint_keys(tmp_path) -> None:
    storage = FakeR2Storage([STATIC_OLD, GIS_SOURCE_KEY, I3_SOURCE_KEY])
    timestamps = iter([PRE_GENERATED_AT, POST_GENERATED_AT])

    result = run_r2_prune_cycle(
        storage,
        provider_id="stm",
        keep_from_date=date(2026, 5, 1),
        artifact_dir=tmp_path,
        endpoint_keys=("static_schedule", "gis_static", "i3_alerts"),
        execute=False,
        clock=lambda: next(timestamps),
    )

    assert storage.listed_prefixes == [
        "stm/static_schedule/",
        "stm/gis_static/",
        "stm/i3_alerts/",
        "stm/static_schedule/",
        "stm/gis_static/",
        "stm/i3_alerts/",
    ]
    assert result.pre_inventory.prefixes == (
        "stm/static_schedule/",
        "stm/gis_static/",
        "stm/i3_alerts/",
    )
    assert result.pre_inventory.unknown_keys == [GIS_SOURCE_KEY, I3_SOURCE_KEY]
    assert result.cleanup_plan.skipped_unknown_keys == [GIS_SOURCE_KEY, I3_SOURCE_KEY]


def test_display_dict_payloads_are_json_safe_and_include_skipped_unknown_keys() -> None:
    storage = FakeR2Storage([TRIP_OLD, UNKNOWN_KEY])
    inventory = build_r2_inventory(
        storage,
        provider_id="stm",
        generated_at_utc=datetime(2026, 5, 25, 12, 0, tzinfo=UTC),
    )
    plan = build_r2_cleanup_plan_from_inventory(
        inventory,
        keep_from_date=date(2026, 5, 1),
    )
    result = execute_r2_cleanup_plan(storage, plan, execute=False)

    json.dumps(inventory.display_dict())
    json.dumps(plan.display_dict())
    json.dumps(result.display_dict())

    assert plan.display_dict()["skipped_unknown_keys"] == [UNKNOWN_KEY]
    assert result.display_dict()["skipped_unknown_keys"] == [UNKNOWN_KEY]
