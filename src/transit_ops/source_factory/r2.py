from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Protocol

from transit_ops.ingestion.storage import BronzeObjectInfo
from transit_ops.rebuild.bronze_cleanup import REBUILD_ENDPOINTS, ParsedBronzeKey, parse_bronze_key
from transit_ops.source_factory.artifacts import write_json_artifact
from transit_ops.source_factory.models import ArtifactRef


class R2CleanupStorage(Protocol):
    def list_objects(self, prefix: str) -> Iterable[BronzeObjectInfo]: ...

    def delete_object(self, storage_path: str) -> None: ...


@dataclass(frozen=True)
class R2InventoryItem:
    storage_path: str
    byte_size: int | None
    last_modified: datetime | None
    parsed_key: ParsedBronzeKey | None

    def display_dict(self) -> dict[str, object]:
        return {
            "storage_path": self.storage_path,
            "byte_size": self.byte_size,
            "last_modified": self.last_modified.isoformat() if self.last_modified else None,
            "parsed_key": self.parsed_key.display_dict() if self.parsed_key else None,
        }


@dataclass(frozen=True)
class R2Inventory:
    provider_id: str
    prefixes: tuple[str, ...]
    generated_at_utc: datetime
    objects: list[R2InventoryItem]
    known_objects: list[R2InventoryItem]
    unknown_keys: list[str]

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "prefixes": list(self.prefixes),
            "generated_at_utc": self.generated_at_utc.isoformat(),
            "objects": [item.display_dict() for item in self.objects],
            "known_objects": [item.display_dict() for item in self.known_objects],
            "unknown_keys": list(self.unknown_keys),
        }


@dataclass(frozen=True)
class R2CleanupPlan:
    provider_id: str
    keep_from_date: date
    inventory_generated_at_utc: datetime
    eligible_objects: list[R2InventoryItem]
    retained_objects: list[R2InventoryItem]
    skipped_unknown_keys: list[str]
    unknown_keys_included_in_wipe: list[str] | None = None
    active_prefix_wipe: bool = False

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "keep_from_date": self.keep_from_date.isoformat(),
            "inventory_generated_at_utc": self.inventory_generated_at_utc.isoformat(),
            "eligible_objects": [item.display_dict() for item in self.eligible_objects],
            "retained_objects": [item.display_dict() for item in self.retained_objects],
            "skipped_unknown_keys": list(self.skipped_unknown_keys),
            "unknown_keys_included_in_wipe": list(self.unknown_keys_included_in_wipe or []),
            "active_prefix_wipe": self.active_prefix_wipe,
        }


@dataclass(frozen=True)
class R2CleanupResult:
    provider_id: str
    execute: bool
    confirm_r2_cleanup: bool
    confirm_active_prefix_wipe: bool
    planned_count: int
    deleted_keys: list[str]
    failed_keys: list[str]
    skipped_unknown_keys: list[str]
    unknown_keys_included_in_wipe: list[str] | None = None

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "execute": self.execute,
            "confirm_r2_cleanup": self.confirm_r2_cleanup,
            "confirm_active_prefix_wipe": self.confirm_active_prefix_wipe,
            "planned_count": self.planned_count,
            "deleted_keys": list(self.deleted_keys),
            "failed_keys": list(self.failed_keys),
            "skipped_unknown_keys": list(self.skipped_unknown_keys),
            "unknown_keys_included_in_wipe": list(self.unknown_keys_included_in_wipe or []),
        }


@dataclass(frozen=True)
class R2PruneCycleResult:
    provider_id: str
    execute: bool
    pre_inventory: R2Inventory
    cleanup_plan: R2CleanupPlan
    cleanup_result: R2CleanupResult
    post_inventory: R2Inventory
    artifacts: Mapping[str, ArtifactRef]

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "execute": self.execute,
            "pre_inventory": self.pre_inventory.display_dict(),
            "cleanup_plan": self.cleanup_plan.display_dict(),
            "cleanup_result": self.cleanup_result.display_dict(),
            "post_inventory": self.post_inventory.display_dict(),
            "artifacts": {
                name: artifact.display_dict() for name, artifact in self.artifacts.items()
            },
        }


def build_r2_inventory(
    storage: R2CleanupStorage,
    *,
    provider_id: str,
    endpoint_keys: Iterable[str] = REBUILD_ENDPOINTS,
    generated_at_utc: datetime | None = None,
) -> R2Inventory:
    prefixes = tuple(f"{provider_id}/{endpoint_key}/" for endpoint_key in endpoint_keys)
    scanned = sorted(
        (obj for prefix in prefixes for obj in storage.list_objects(prefix)),
        key=lambda obj: obj.storage_path,
    )

    objects: list[R2InventoryItem] = []
    known_objects: list[R2InventoryItem] = []
    unknown_keys: list[str] = []
    for obj in scanned:
        parsed_key = parse_bronze_key(obj.storage_path)
        item = R2InventoryItem(
            storage_path=obj.storage_path,
            byte_size=obj.byte_size,
            last_modified=obj.last_modified,
            parsed_key=parsed_key,
        )
        objects.append(item)
        if parsed_key is None:
            unknown_keys.append(obj.storage_path)
        else:
            known_objects.append(item)

    return R2Inventory(
        provider_id=provider_id,
        prefixes=prefixes,
        generated_at_utc=generated_at_utc or datetime.now(UTC),
        objects=objects,
        known_objects=known_objects,
        unknown_keys=unknown_keys,
    )


def build_r2_cleanup_plan_from_inventory(
    inventory: R2Inventory,
    *,
    keep_from_date: date,
    active_prefix_wipe: bool = False,
) -> R2CleanupPlan:
    if active_prefix_wipe:
        return R2CleanupPlan(
            provider_id=inventory.provider_id,
            keep_from_date=keep_from_date,
            inventory_generated_at_utc=inventory.generated_at_utc,
            eligible_objects=list(inventory.objects),
            retained_objects=[],
            skipped_unknown_keys=[],
            unknown_keys_included_in_wipe=list(inventory.unknown_keys),
            active_prefix_wipe=True,
        )

    eligible_objects: list[R2InventoryItem] = []
    retained_objects: list[R2InventoryItem] = []
    for item in inventory.known_objects:
        if item.parsed_key is None:
            continue
        if item.parsed_key.key_date < keep_from_date:
            eligible_objects.append(item)
        else:
            retained_objects.append(item)

    return R2CleanupPlan(
        provider_id=inventory.provider_id,
        keep_from_date=keep_from_date,
        inventory_generated_at_utc=inventory.generated_at_utc,
        eligible_objects=eligible_objects,
        retained_objects=retained_objects,
        skipped_unknown_keys=list(inventory.unknown_keys),
        unknown_keys_included_in_wipe=[],
        active_prefix_wipe=False,
    )


def execute_r2_cleanup_plan(
    storage: R2CleanupStorage,
    plan: R2CleanupPlan,
    *,
    execute: bool,
    confirm_r2_cleanup: bool = False,
    confirm_active_prefix_wipe: bool = False,
) -> R2CleanupResult:
    if execute and not confirm_r2_cleanup:
        raise PermissionError("confirm_r2_cleanup is required to execute R2 cleanup.")
    if execute and plan.active_prefix_wipe and not confirm_active_prefix_wipe:
        raise PermissionError(
            "confirm_active_prefix_wipe is required to execute an active-prefix wipe."
        )
    _validate_cleanup_plan_before_delete(plan)

    if not execute:
        return R2CleanupResult(
            provider_id=plan.provider_id,
            execute=False,
            confirm_r2_cleanup=confirm_r2_cleanup,
            confirm_active_prefix_wipe=confirm_active_prefix_wipe,
            planned_count=len(plan.eligible_objects),
            deleted_keys=[],
            failed_keys=[],
            skipped_unknown_keys=list(plan.skipped_unknown_keys),
            unknown_keys_included_in_wipe=list(plan.unknown_keys_included_in_wipe or []),
        )

    deleted_keys: list[str] = []
    failed_keys: list[str] = []
    for item in plan.eligible_objects:
        try:
            storage.delete_object(item.storage_path)
        except Exception:
            failed_keys.append(item.storage_path)
            continue
        deleted_keys.append(item.storage_path)

    return R2CleanupResult(
        provider_id=plan.provider_id,
        execute=True,
        confirm_r2_cleanup=confirm_r2_cleanup,
        confirm_active_prefix_wipe=confirm_active_prefix_wipe,
        planned_count=len(plan.eligible_objects),
        deleted_keys=deleted_keys,
        failed_keys=failed_keys,
        skipped_unknown_keys=list(plan.skipped_unknown_keys),
        unknown_keys_included_in_wipe=list(plan.unknown_keys_included_in_wipe or []),
    )


def _validate_cleanup_plan_before_delete(plan: R2CleanupPlan) -> None:
    if plan.active_prefix_wipe:
        return

    unsafe_keys = [
        item.storage_path
        for item in plan.eligible_objects
        if item.parsed_key is None or item.parsed_key.key_date >= plan.keep_from_date
    ]
    if unsafe_keys:
        raise ValueError(
            "Normal R2 cleanup plan contains keys outside the approved known Bronze "
            f"retention window: {', '.join(sorted(unsafe_keys))}"
        )


def run_r2_prune_cycle(
    storage: R2CleanupStorage,
    *,
    provider_id: str,
    keep_from_date: date,
    artifact_dir: Path,
    execute: bool = False,
    confirm_r2_cleanup: bool = False,
    active_prefix_wipe: bool = False,
    confirm_active_prefix_wipe: bool = False,
    clock: Callable[[], datetime] | None = None,
) -> R2PruneCycleResult:
    inventory_clock = clock or (lambda: datetime.now(UTC))
    pre_inventory = build_r2_inventory(
        storage,
        provider_id=provider_id,
        generated_at_utc=inventory_clock(),
    )
    pre_inventory_artifact = write_json_artifact(
        artifact_dir / f"{provider_id}-r2-pre-inventory.json",
        pre_inventory.display_dict(),
    )

    cleanup_plan = build_r2_cleanup_plan_from_inventory(
        pre_inventory,
        keep_from_date=keep_from_date,
        active_prefix_wipe=active_prefix_wipe,
    )
    cleanup_plan_artifact = write_json_artifact(
        artifact_dir / f"{provider_id}-r2-cleanup-plan.json",
        cleanup_plan.display_dict(),
    )

    cleanup_result = execute_r2_cleanup_plan(
        storage,
        cleanup_plan,
        execute=execute,
        confirm_r2_cleanup=confirm_r2_cleanup,
        confirm_active_prefix_wipe=confirm_active_prefix_wipe,
    )

    post_inventory = build_r2_inventory(
        storage,
        provider_id=provider_id,
        generated_at_utc=inventory_clock(),
    )
    post_inventory_artifact = write_json_artifact(
        artifact_dir / f"{provider_id}-r2-post-inventory.json",
        post_inventory.display_dict(),
    )

    return R2PruneCycleResult(
        provider_id=provider_id,
        execute=execute,
        pre_inventory=pre_inventory,
        cleanup_plan=cleanup_plan,
        cleanup_result=cleanup_result,
        post_inventory=post_inventory,
        artifacts={
            "pre_inventory": pre_inventory_artifact,
            "cleanup_plan": cleanup_plan_artifact,
            "post_inventory": post_inventory_artifact,
        },
    )
