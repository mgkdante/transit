from __future__ import annotations

import json
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.sql.elements import TextClause

from transit_ops.source_factory.validation import (
    SOURCE_FACTORY_VALIDATION_CHECKS,
    SourceFactoryValidationReport,
    collect_source_factory_validation_evidence,
)

EXPECTED_CHECK_IDS = (
    "silver_static_source_lineage_abundance",
    "gtfs_rt_trip_updates_source_history",
    "gtfs_rt_vehicle_positions_source_history",
    "computed_delay_facts",
    "sibling_rt_feed_join",
    "postgis_map_marts",
    "provider_local_timezone_buckets",
    "source_lineage_freshness_health",
    "retention_timestamp_bounds",
    "reader_role_privileges",
)


class FakeResult:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows

    def mappings(self) -> FakeResult:
        return self

    def __iter__(self):  # noqa: ANN204
        return iter(self.rows)


class RecordingValidationConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def execute(self, statement: TextClause, params: dict[str, object]):  # noqa: ANN201
        self.calls.append((str(statement), dict(params)))
        return FakeResult(
            [
                {
                    "provider_id": params["provider_id"],
                    "captured_at_utc": datetime(2026, 5, 25, 14, 30, tzinfo=UTC),
                    "service_date": date(2026, 5, 25),
                    "ratio": Decimal("98.50"),
                    "source_url": (
                        "postgresql://reader:secret@db.transit.yesid.dev:5432/transit"
                    ),
                    "message": (
                        "failed to use "
                        "postgresql://reader:secret@db.transit.yesid.dev:5432/transit"
                    ),
                }
            ]
        )


def _sql_by_check_id() -> dict[str, str]:
    return {check.check_id: str(check.statement) for check in SOURCE_FACTORY_VALIDATION_CHECKS}


def test_source_factory_validation_checks_cover_required_contract_surfaces() -> None:
    assert tuple(check.check_id for check in SOURCE_FACTORY_VALIDATION_CHECKS) == EXPECTED_CHECK_IDS
    assert all(
        isinstance(check.statement, TextClause)
        for check in SOURCE_FACTORY_VALIDATION_CHECKS
    )


def test_collect_executes_each_check_with_provider_scope_and_json_safe_rows() -> None:
    connection = RecordingValidationConnection()

    report = collect_source_factory_validation_evidence(
        connection,
        provider_id="stm",
        captured_at_utc=datetime(2026, 5, 25, 15, 0, tzinfo=UTC),
    )

    assert len(connection.calls) == len(SOURCE_FACTORY_VALIDATION_CHECKS)
    assert all(params == {"provider_id": "stm"} for _, params in connection.calls)
    display = report.display_dict()
    first_row = display["checks"]["computed_delay_facts"]["rows"][0]
    assert first_row == {
        "captured_at_utc": "2026-05-25T14:30:00+00:00",
        "message": "failed to use <redacted>",
        "provider_id": "stm",
        "ratio": "98.50",
        "service_date": "2026-05-25",
        "source_url": "<redacted>",
    }
    json.dumps(display, sort_keys=True)


def test_validation_sql_references_static_source_lineage_abundance_tables() -> None:
    sql = _sql_by_check_id()["silver_static_source_lineage_abundance"]

    assert "core.dataset_versions" in sql
    assert "silver.gtfs_source_members" in sql
    assert "silver.gtfs_extra_rows" in sql
    assert "dataset_kind = 'static_schedule'" in sql
    for member_name in (
        "routes.txt",
        "stops.txt",
        "trips.txt",
        "stop_times.txt",
        "calendar.txt",
        "calendar_dates.txt",
    ):
        assert member_name in sql
    assert "('agency.txt')" not in sql
    assert "has_service_calendar_member" in sql
    for table_name in (
        "silver.agency",
        "silver.routes",
        "silver.stops",
        "silver.trips",
        "silver.stop_times",
    ):
        assert table_name in sql
    assert "dv.provider_id = rp.provider_id" in sql
    assert "requested_provider" in sql


def test_validation_sql_references_gtfs_rt_source_history_and_flattened_tables() -> None:
    trip_sql = _sql_by_check_id()["gtfs_rt_trip_updates_source_history"]
    vehicle_sql = _sql_by_check_id()["gtfs_rt_vehicle_positions_source_history"]

    for table_name in (
        "silver.rt_feed_snapshots",
        "silver.rt_entities",
        "silver.rt_trip_updates",
        "silver.rt_trip_update_stop_times",
        "silver.trip_updates",
        "silver.trip_update_stop_time_updates",
    ):
        assert table_name in trip_sql
    assert "endpoint_key = 'trip_updates'" in trip_sql
    assert "requested_provider" in trip_sql
    assert "COALESCE(sc.source_snapshot_count, 0)" in trip_sql

    for table_name in (
        "silver.rt_feed_snapshots",
        "silver.rt_entities",
        "silver.rt_vehicle_positions",
        "silver.vehicle_positions",
    ):
        assert table_name in vehicle_sql
    assert "endpoint_key = 'vehicle_positions'" in vehicle_sql
    assert "requested_provider" in vehicle_sql
    assert "COALESCE(sc.source_snapshot_count, 0)" in vehicle_sql


def test_validation_sql_proves_computed_delay_join_from_predicted_to_static_times() -> None:
    sql = _sql_by_check_id()["computed_delay_facts"]

    assert "gold.fact_stop_time_delay_observation" in sql
    assert "gold.current_trip_delay_computed" in sql
    assert "silver.rt_trip_update_stop_times" in sql
    assert "silver.stop_times" in sql
    assert "predicted_arrival_utc" in sql
    assert "predicted_departure_utc" in sql
    assert "requested_provider" in sql
    assert "arrival_delay_seconds" in sql
    assert "departure_delay_seconds" in sql
    assert "delay_observation_count_delta" in sql
    assert "predicted_arrival_count_delta" in sql
    assert "predicted_departure_count_delta" in sql
    assert "st.trip_id = rtu.trip_id" in sql
    assert "st.stop_sequence = rstu.stop_sequence" in sql


def test_validation_sql_proves_sibling_rt_feed_join_with_sane_time_window() -> None:
    sql = _sql_by_check_id()["sibling_rt_feed_join"]

    assert "silver.rt_trip_updates" in sql
    assert "silver.rt_vehicle_positions" in sql
    assert "tu.provider_id = vp.provider_id" in sql
    assert "tu.trip_id = vp.trip_id" in sql
    assert "tu.route_id = vp.route_id" in sql
    assert "BETWEEN" in sql
    assert "interval '10 minutes'" in sql
    assert "requested_provider" in sql
    assert "COALESCE(sj.sibling_join_count, 0)" in sql


def test_validation_sql_covers_map_marts_timezone_buckets_health_retention_and_roles() -> None:
    sql_by_id = _sql_by_check_id()

    map_sql = sql_by_id["postgis_map_marts"]
    for relation in (
        "gold.map_stops",
        "gold.map_route_lines",
        "gold.current_vehicle_map",
        "gold.map_gis_line_features",
    ):
        assert relation in map_sql
    assert "geom_wgs84 IS NOT NULL" in map_sql
    assert "geojson IS NOT NULL" in map_sql

    timezone_sql = sql_by_id["provider_local_timezone_buckets"]
    assert "core.providers" in timezone_sql
    assert "p.timezone" in timezone_sql
    assert "provider_local_date" in timezone_sql
    assert "gold.public_route_reliability_daily" in timezone_sql
    assert "gold.public_stop_delay_daily" in timezone_sql
    assert "gold.public_alert_impact_daily" in timezone_sql
    assert "gold.i3_alert_history_reporting" in timezone_sql

    health_sql = sql_by_id["source_lineage_freshness_health"]
    assert "gold.source_lineage_reporting" in health_sql
    assert "gold.feed_freshness_current" in health_sql
    assert "requested_provider" in health_sql

    retention_sql = sql_by_id["retention_timestamp_bounds"]
    assert "raw.ingestion_runs" in retention_sql
    assert "silver.rt_feed_snapshots" in retention_sql
    assert "gold.fact_stop_time_delay_observation" in retention_sql
    assert "oldest_timestamp_utc" in retention_sql
    assert "newest_timestamp_utc" in retention_sql

    role_sql = sql_by_id["reader_role_privileges"]
    assert "transit-reporting" in role_sql
    assert "transit-db" in role_sql
    assert "pg_roles" in role_sql
    assert "information_schema.role_table_grants" in role_sql
    assert "has_database_privilege" in role_sql
    assert "has_schema_privilege" in role_sql
    assert "has_table_privilege" in role_sql
    assert "can_create_temp" in role_sql
    assert "contract_ok" in role_sql
    assert "can_use_gold_schema" in role_sql
    assert "public_select_relation_count" in role_sql
    assert "public_spatial_ref_sys_select" in role_sql
    assert "public_unapproved_select_relation_count" in role_sql
    assert "spatial_ref_sys" in role_sql
    assert "gold" in role_sql
    assert "raw" in role_sql
    assert "silver" in role_sql


def test_report_display_dict_includes_external_payloads_with_secret_redaction() -> None:
    report = SourceFactoryValidationReport(
        provider_id="stm",
        captured_at_utc=datetime(2026, 5, 25, 15, 0, tzinfo=UTC),
        checks={},
        health_payload={
            "status": "ok",
            "database_url": "postgresql://reader:secret@db.transit.yesid.dev:5432/transit",
            "message": (
                "could not connect to "
                "postgresql://reader:secret@db.transit.yesid.dev:5432/transit"
            ),
        },
        reader_role_proofs={
            "transit-reporting": {
                "can_create_temp": False,
                "password": "secret",
                "access_key": "r2-access-key",
            }
        },
        retention_payload={
            "newest": datetime(2026, 5, 25, 14, 0, tzinfo=UTC),
            "opaque": object(),
        },
    )

    display = report.display_dict()

    assert display["health_payload"] == {
        "database_url": "<redacted>",
        "message": "could not connect to <redacted>",
        "status": "ok",
    }
    assert display["reader_role_proofs"] == {
        "transit-reporting": {
            "access_key": "<redacted>",
            "can_create_temp": False,
            "password": "<redacted>",
        }
    }
    assert display["retention_payload"]["newest"] == "2026-05-25T14:00:00+00:00"
    assert isinstance(display["retention_payload"]["opaque"], str)


def test_check_result_rows_redact_secret_shaped_values() -> None:
    report = collect_source_factory_validation_evidence(
        RecordingValidationConnection(),
        provider_id="stm",
        captured_at_utc=datetime(2026, 5, 25, 15, 0, tzinfo=UTC),
    )

    first_row = report.display_dict()["checks"]["computed_delay_facts"]["rows"][0]

    assert first_row["source_url"] == "<redacted>"
    assert first_row["message"] == "failed to use <redacted>"
