from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from pathlib import Path


class FactoryPhase(StrEnum):
    PREFLIGHT = "preflight"
    R2_PRE_INVENTORY = "r2_pre_inventory"
    R2_CLEANUP_PLAN = "r2_cleanup_plan"
    R2_CLEANUP_EXECUTE = "r2_cleanup_execute"
    R2_POST_INVENTORY = "r2_post_inventory"
    DB_RESET = "db_reset"
    SOURCE_BACKFILL = "source_backfill"
    SILVER_VALIDATION = "silver_validation"
    GOLD_VALIDATION = "gold_validation"
    PARITY = "parity"
    RETENTION = "retention"
    READER_ROLES = "reader_roles"
    HEALTH_FRESHNESS = "health_freshness"
    FINAL_REPORT = "final_report"


class PhaseStatus(StrEnum):
    OK = "ok"
    SKIPPED = "skipped"
    FAILED = "failed"


@dataclass(frozen=True)
class ArtifactRef:
    path: Path
    byte_size: int
    sha256: str

    def display_dict(self) -> dict[str, object]:
        return {
            "path": str(self.path),
            "byte_size": self.byte_size,
            "sha256": self.sha256,
        }


@dataclass(frozen=True)
class SourceFactoryResult:
    provider_id: str
    execute: bool
    started_at_utc: datetime
    completed_at_utc: datetime | None
    phase_status: Mapping[FactoryPhase, PhaseStatus]
    artifacts: Mapping[str, object]
    summaries: Mapping[str, object]

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "execute": self.execute,
            "started_at_utc": self.started_at_utc.isoformat(),
            "completed_at_utc": (
                self.completed_at_utc.isoformat()
                if self.completed_at_utc is not None
                else None
            ),
            "phase_status": {
                phase.value: status.value for phase, status in self.phase_status.items()
            },
            "artifacts": _json_safe_value(self.artifacts),
            "summaries": _json_safe_value(self.summaries),
        }


def _json_safe_value(value: object) -> object:
    if isinstance(value, StrEnum):
        return value.value
    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, ArtifactRef):
        return value.display_dict()
    if isinstance(value, Mapping):
        return {
            _json_safe_key(key): _json_safe_value(nested_value)
            for key, nested_value in value.items()
        }
    if isinstance(value, list | tuple):
        return [_json_safe_value(item) for item in value]
    raise TypeError(f"Unsupported display value type: {type(value).__name__}")


def _json_safe_key(value: object) -> str:
    if isinstance(value, StrEnum):
        return value.value
    return str(value)
