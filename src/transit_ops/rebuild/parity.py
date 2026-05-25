from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.sql.elements import TextClause

from transit_ops.ingestion.common import utc_now

PARITY_ROW_COUNT_TABLES = (
    "raw.ingestion_runs",
    "raw.ingestion_objects",
    "raw.realtime_snapshot_index",
    "silver.agency",
    "silver.feed_info",
    "silver.routes",
    "silver.directions",
    "silver.route_patterns",
    "silver.stops",
    "silver.trips",
    "silver.shapes",
    "silver.stop_times",
    "silver.calendar",
    "silver.calendar_dates",
    "silver.translations",
    "silver.trip_updates",
    "silver.trip_update_stop_time_updates",
    "silver.vehicle_positions",
    "gold.dim_route",
    "gold.dim_stop",
    "gold.dim_date",
    "gold.dim_direction",
    "gold.dim_route_pattern",
    "gold.fact_vehicle_snapshot",
    "gold.fact_trip_delay_snapshot",
    "gold.latest_vehicle_snapshot",
    "gold.latest_trip_delay_snapshot",
    "gold.vehicle_summary_5m",
    "gold.trip_delay_summary_5m",
    "gold.warm_rollup_periods",
)

FRESHNESS_TARGETS = (
    "raw.ingestion_runs.completed_at_utc",
    "raw.realtime_snapshot_index.captured_at_utc",
    "silver.trip_updates.captured_at_utc",
    "silver.vehicle_positions.captured_at_utc",
    "gold.fact_trip_delay_snapshot.captured_at_utc",
    "gold.fact_vehicle_snapshot.captured_at_utc",
    "gold.latest_trip_delay_snapshot.captured_at_utc",
    "gold.latest_vehicle_snapshot.captured_at_utc",
    "gold.vehicle_summary_5m.period_start_utc",
    "gold.trip_delay_summary_5m.period_start_utc",
    "gold.warm_rollup_periods.period_start_utc",
)

KPI_VIEWS = (
    "gold.kpi_active_vehicles_latest",
    "gold.kpi_routes_with_live_vehicles_latest",
    "gold.kpi_avg_trip_delay_latest",
    "gold.kpi_max_trip_delay_latest",
    "gold.kpi_delayed_trip_count_latest",
)

GOLD_RELATIONS_QUERY = text(
    """
SELECT
    table_name AS relation_name,
    table_type AS relation_type
FROM information_schema.tables
WHERE table_schema = 'gold'
ORDER BY relation_name, relation_type
"""
)

_QUALIFIED_RELATION_PATTERN = re.compile(r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$")
_COLUMN_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")


@dataclass(frozen=True)
class ParityEvidenceReport:
    provider_id: str
    captured_at_utc: datetime
    row_counts: Mapping[str, int]
    freshness: Mapping[str, object]
    kpi_rows: Mapping[str, list[Mapping[str, object]]]
    gold_relations: list[Mapping[str, object]]

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "captured_at_utc": self.captured_at_utc.isoformat(),
            "row_counts": _display_mapping(self.row_counts),
            "freshness": _display_mapping(self.freshness),
            "kpi_rows": _display_mapping(self.kpi_rows),
            "gold_relations": _display_gold_relations(self.gold_relations),
        }


def collect_parity_evidence(
    connection,
    *,
    provider_id: str,
    captured_at_utc: datetime | None = None,
) -> ParityEvidenceReport:
    row_counts = {
        table_name: int(
            connection.execute(query, {"provider_id": provider_id}).scalar_one() or 0
        )
        for table_name, query in ROW_COUNT_QUERIES.items()
    }

    freshness = {
        target: _scalar_one_or_none(
            connection.execute(query, {"provider_id": provider_id})
        )
        for target, query in FRESHNESS_QUERIES.items()
    }

    kpi_rows = {
        view_name: _mapping_rows(
            connection.execute(query, {"provider_id": provider_id})
        )
        for view_name, query in KPI_QUERIES.items()
    }

    gold_relations = _mapping_rows(connection.execute(GOLD_RELATIONS_QUERY))

    return ParityEvidenceReport(
        provider_id=provider_id,
        captured_at_utc=captured_at_utc or utc_now(),
        row_counts=row_counts,
        freshness=freshness,
        kpi_rows=kpi_rows,
        gold_relations=gold_relations,
    )


def _row_count_query(table_name: str) -> TextClause:
    _validate_whitelisted_relation(
        table_name,
        allowed_values=PARITY_ROW_COUNT_TABLES,
    )
    if table_name == "raw.ingestion_objects":
        return text(
            """
SELECT count(*)
FROM raw.ingestion_objects AS io
JOIN raw.ingestion_runs AS ir
    ON io.ingestion_run_id = ir.ingestion_run_id
WHERE io.provider_id = :provider_id
  AND ir.provider_id = :provider_id
"""
        )

    return text(
        f"""
SELECT count(*)
FROM {table_name}
WHERE provider_id = :provider_id
"""
    )


def _freshness_query(target: str) -> TextClause:
    if target not in FRESHNESS_TARGETS:
        raise ValueError(f"Unsupported freshness target: {target}")

    table_name, column_name = target.rsplit(".", maxsplit=1)
    _validate_whitelisted_relation(
        table_name,
        allowed_values=tuple(item.rsplit(".", maxsplit=1)[0] for item in FRESHNESS_TARGETS),
    )
    _validate_column_name(column_name)
    return text(
        f"""
SELECT max({column_name})
FROM {table_name}
WHERE provider_id = :provider_id
"""
    )


def _kpi_query(view_name: str) -> TextClause:
    _validate_whitelisted_relation(view_name, allowed_values=KPI_VIEWS)
    return text(
        f"""
SELECT * FROM {view_name}
WHERE provider_id = :provider_id
ORDER BY provider_id, realtime_snapshot_id, captured_at_utc, feed_timestamp_utc
"""
    )


def _validate_whitelisted_relation(
    value: str,
    *,
    allowed_values: tuple[str, ...],
) -> None:
    if value not in allowed_values:
        raise ValueError(f"Unsupported relation: {value}")
    if _QUALIFIED_RELATION_PATTERN.fullmatch(value) is None:
        raise ValueError(f"Unsupported relation name: {value}")


def _validate_column_name(value: str) -> None:
    if _COLUMN_PATTERN.fullmatch(value) is None:
        raise ValueError(f"Unsupported column name: {value}")


def _scalar_one_or_none(result: object) -> object | None:
    scalar_one_or_none = getattr(result, "scalar_one_or_none", None)
    if callable(scalar_one_or_none):
        return scalar_one_or_none()

    return result.scalar_one()  # type: ignore[attr-defined]


def _mapping_rows(result: object) -> list[dict[str, object]]:
    mappings = result.mappings()  # type: ignore[attr-defined]
    return [dict(row) for row in mappings]


def _display_mapping(values: Mapping[str, object]) -> dict[str, object]:
    return {
        key: _display_value(values[key])
        for key in sorted(values)
    }


def _display_gold_relations(
    rows: list[Mapping[str, object]],
) -> list[dict[str, object]]:
    return [
        _display_mapping(row)
        for row in sorted(
            rows,
            key=lambda row: (
                str(row.get("relation_name", "")),
                str(row.get("relation_type", "")),
            ),
        )
    ]


def _display_value(value: object) -> object:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, Mapping):
        return _display_mapping({str(key): nested for key, nested in value.items()})
    if isinstance(value, list):
        return [_display_value(item) for item in value]
    if isinstance(value, tuple):
        return [_display_value(item) for item in value]
    return value


ROW_COUNT_QUERIES = {
    table_name: _row_count_query(table_name)
    for table_name in PARITY_ROW_COUNT_TABLES
}

FRESHNESS_QUERIES = {
    target: _freshness_query(target)
    for target in FRESHNESS_TARGETS
}

KPI_QUERIES = {
    view_name: _kpi_query(view_name)
    for view_name in KPI_VIEWS
}

__all__ = [
    "FRESHNESS_TARGETS",
    "KPI_VIEWS",
    "PARITY_ROW_COUNT_TABLES",
    "ParityEvidenceReport",
    "collect_parity_evidence",
]
