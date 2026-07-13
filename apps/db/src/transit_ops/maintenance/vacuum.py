"""VACUUM maintenance tier (slice-9.1.1-zeta split)."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime

from sqlalchemy.engine import Engine

from transit_ops.db.connection import make_engine
from transit_ops.ingestion.common import utc_now
from transit_ops.settings import Settings, get_settings

from .bronze import RAW_BRONZE_METADATA_TABLES
from .gold import (
    ALERT_ARCHIVE_RETENTION_TABLE,
    GOLD_AGGREGATE_TABLES,
    GOLD_FACT_TABLES,
)
from .i3 import I3_RETENTION_TABLES
from .silver import REALTIME_SILVER_TABLES
from .static import GIS_SILVER_TABLES, STATIC_SILVER_TABLES

VACUUM_TABLES = (
    *STATIC_SILVER_TABLES,
    *GIS_SILVER_TABLES,
    *REALTIME_SILVER_TABLES,
    *GOLD_FACT_TABLES,
    "gold.latest_trip_delay_snapshot",
    "gold.latest_vehicle_snapshot",
    *GOLD_AGGREGATE_TABLES,
    ALERT_ARCHIVE_RETENTION_TABLE,
    *RAW_BRONZE_METADATA_TABLES,
    *I3_RETENTION_TABLES,
)


@dataclass(frozen=True)
class VacuumResult:
    provider_id: str
    full: bool
    tables: list[str]
    completed_at_utc: datetime

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["completed_at_utc"] = self.completed_at_utc.isoformat()
        return payload


def vacuum_storage(
    provider_id: str,
    *,
    full: bool = False,
    tables: list[str] | None = None,
    settings: Settings | None = None,
    engine: Engine | None = None,
) -> VacuumResult:
    settings = settings or get_settings()
    engine = engine or make_engine(settings)
    # PARALLEL 0: parallel vacuum workers allocate DSM in /dev/shm, which the
    # A1 VM's postgres container caps at 64MB. PARALLEL is invalid with FULL.
    vacuum_mode = "FULL, ANALYZE" if full else "PARALLEL 0, ANALYZE"

    target_tables = tables if tables is not None else list(VACUUM_TABLES)
    invalid = [t for t in target_tables if t not in VACUUM_TABLES]
    if invalid:
        raise ValueError(
            f"Unknown vacuum table(s): {invalid}. Must be one of: {list(VACUUM_TABLES)}"
        )

    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
        for table_name in target_tables:
            connection.exec_driver_sql(f"VACUUM ({vacuum_mode}) {table_name}")

    return VacuumResult(
        provider_id=provider_id,
        full=full,
        tables=target_tables,
        completed_at_utc=utc_now(),
    )
