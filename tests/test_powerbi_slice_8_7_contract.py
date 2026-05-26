from __future__ import annotations

import json
import re
from pathlib import Path

POWERBI_ROOT = Path("powerbi")
REPORT_ROOT = POWERBI_ROOT / "transit-ops-v2.Report" / "definition"
MODEL_ROOT = POWERBI_ROOT / "transit-ops-v2.SemanticModel" / "definition"
TABLE_ROOT = MODEL_ROOT / "tables"
THEME_ROOT = (
    POWERBI_ROOT
    / "transit-ops-v2.Report"
    / "StaticResources"
    / "SharedResources"
    / "BaseThemes"
)

EXPECTED_GOLD_TABLES = {
    "DimProvider": "dim_provider",
    "DimDate": "dim_date",
    "DimRoute": "dim_route",
    "DimStop": "dim_stop",
    "DimDirection": "dim_direction",
    "LatestVehicleSnapshot": "latest_vehicle_snapshot",
    "LatestTripDelaySnapshot": "latest_trip_delay_snapshot",
    "CurrentVehicleMap": "current_vehicle_map",
    "CurrentTripDelayComputed": "current_trip_delay_computed",
    "CurrentI3Alerts": "current_i3_alerts",
    "FeedFreshnessCurrent": "feed_freshness_current",
    "SourceLineageReporting": "source_lineage_reporting",
    "FactVehicleSnapshot": "fact_vehicle_snapshot",
    "FactTripDelaySnapshot": "fact_trip_delay_snapshot",
    "FactStopTimeDelayObservation": "fact_stop_time_delay_observation",
    "VehicleSummary5m": "vehicle_summary_5m",
    "TripDelaySummary5m": "trip_delay_summary_5m",
    "PublicRouteReliabilityDaily": "public_route_reliability_daily",
    "PublicStopDelayDaily": "public_stop_delay_daily",
    "PublicAlertImpactDaily": "public_alert_impact_daily",
    "I3AlertHistoryReporting": "i3_alert_history_reporting",
    "RouteDelayHourly": "route_delay_hourly",
    "RouteDelayDayOfWeek": "route_delay_day_of_week",
    "StopDelayHourly": "stop_delay_hourly",
    "RouteReliabilityWeekly": "route_reliability_weekly",
    "RouteReliabilityMonthly": "route_reliability_monthly",
    "StopDelayWeekly": "stop_delay_weekly",
    "StopDelayMonthly": "stop_delay_monthly",
    "RouteHabitScore": "route_habit_score",
    "RepeatedProblemRouteStop": "repeated_problem_route_stop",
    "CitizenAccountabilityDaily": "citizen_accountability_daily",
    "ReportLabels": "report_labels",
}

EXPECTED_TABLES = set(EXPECTED_GOLD_TABLES) | {"_Measures"}
EXPECTED_PAGES = [
    "Santé du réseau / Network Health",
    "Carte opérationnelle / Operations Map",
    "Points chauds / Hotspots",
    "Habitudes du réseau / Network Habits",
    "Historique / History",
    "Confiance des données / Data Trust",
    "Responsabilité citoyenne / Citizen Accountability",
]
EXPECTED_MEASURES = {
    "Véhicules actifs / Active Vehicles",
    "Trajets en retard / Delayed Trips",
    "Retard moyen sec / Avg Delay Sec",
    "Retard sévère / Severe Delay",
    "Routes touchées / Affected Routes",
    "Arrêts touchés / Affected Stops",
    "Alertes actives / Active Alerts",
    "Âge fraîcheur sec / Freshness Age Sec",
    "Score impact citoyens / Citizen Impact Score",
    "Score habitudes / Habit Score",
}
EXPECTED_VEHICLE_SUMMARY_5M_COLUMNS = {
    "provider_id",
    "period_start_utc",
    "route_id",
    "vehicle_count",
    "observation_count",
    "snapshot_count",
    "built_at_utc",
}
EXPECTED_DIM_DATE_COLUMNS = {
    "provider_id",
    "dataset_version_id",
    "service_date",
    "date_key",
    "day_of_week_iso",
    "day_name",
    "week_of_year",
    "month_number",
    "month_name",
    "quarter_number",
    "year_number",
    "is_weekend",
    "has_calendar_exception",
    "is_service_added",
    "is_service_removed",
}
LEGACY_TERMS = {
    "KpiActiveVehicles",
    "KpiAvgDelay",
    "KpiDelayedTrips",
    "KpiMaxDelay",
    "KpiRoutesRunning",
    "kpi_active_vehicles_latest",
    "kpi_avg_trip_delay_latest",
    "kpi_delayed_trip_count_latest",
    "kpi_max_trip_delay_latest",
    "kpi_routes_with_live_vehicles_latest",
    "Network Overview",
    "Route Performance",
    "Stop Activity",
    "Live Ops",
}
REPORT_TOP_LEVEL_KEYS = {
    "$schema",
    "themeCollection",
    "objects",
    "resourcePackages",
    "settings",
}
REPORT_SECTION_PROPERTY_KEYS = {"verticalAlignment"}
PBIR_TOP_LEVEL_KEYS = {"$schema", "version", "datasetReference"}
PBISM_TOP_LEVEL_KEYS = {"$schema", "version", "settings"}
PAGES_TOP_LEVEL_KEYS = {"$schema", "pageOrder", "activePageName"}
PAGE_TOP_LEVEL_KEYS = {
    "$schema",
    "name",
    "displayName",
    "displayOption",
    "height",
    "width",
    "objects",
}


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _all_model_and_report_text() -> str:
    return "\n".join(
        path.read_text(encoding="utf-8")
        for path in [
            *MODEL_ROOT.rglob("*"),
            *REPORT_ROOT.rglob("*"),
            POWERBI_ROOT / "transit-ops-v2.pbip",
        ]
        if path.is_file() and path.suffix in {".json", ".pbip", ".pbir", ".tmdl"}
    )


def _model_refs() -> set[str]:
    model = _read(MODEL_ROOT / "model.tmdl")
    return set(re.findall(r"^ref table (.+)$", model, flags=re.MULTILINE))


def _table_name(path: Path) -> str:
    match = re.search(r"^table (.+)$", _read(path), flags=re.MULTILINE)
    assert match is not None, f"{path} has no table declaration"
    return match.group(1)


def _source_columns(table_name: str) -> set[str]:
    table_text = _read(TABLE_ROOT / f"{table_name}.tmdl")
    return set(re.findall(r"^\t\tsourceColumn: (.+)$", table_text, flags=re.MULTILINE))


def test_semantic_model_references_exact_gold_table_set_and_measures() -> None:
    table_files = {path.stem: path for path in TABLE_ROOT.glob("*.tmdl")}

    assert set(table_files) == EXPECTED_TABLES
    assert _model_refs() == EXPECTED_TABLES
    for table_name, path in table_files.items():
        assert _table_name(path) == table_name


def test_gold_partitions_use_only_reporting_database_gold_navigation() -> None:
    for table_name, gold_item in EXPECTED_GOLD_TABLES.items():
        table_text = _read(TABLE_ROOT / f"{table_name}.tmdl")

        assert 'mode: directQuery' in table_text
        assert 'PostgreSQL.Database("db.transit.yesid.dev", "transit")' in table_text
        assert f'Source{{[Schema="gold",Item="{gold_item}"]}}[Data]' in table_text
        assert 'Schema="raw"' not in table_text
        assert 'Schema="silver"' not in table_text
        assert 'Schema="core"' not in table_text

    measures_text = _read(TABLE_ROOT / "_Measures.tmdl")
    assert "mode: import" in measures_text


def test_report_pages_are_exact_bilingual_fr_first_skeleton() -> None:
    pages = json.loads(_read(REPORT_ROOT / "pages" / "pages.json"))
    page_names = pages["pageOrder"]
    display_names = [
        json.loads(_read(REPORT_ROOT / "pages" / page_name / "page.json"))["displayName"]
        for page_name in page_names
    ]

    assert display_names == EXPECTED_PAGES
    assert pages["activePageName"] == page_names[0]


def test_report_theme_uses_yesid_tokens_not_default_cy_theme() -> None:
    report = json.loads(_read(REPORT_ROOT / "report.json"))
    theme = json.loads(_read(THEME_ROOT / "TransitOpsYesidDark.json"))
    report_text = json.dumps(report, ensure_ascii=False)
    theme_text = json.dumps(theme, ensure_ascii=False)

    assert "CY26" not in report_text
    assert "CY26" not in theme_text
    assert "#141414" in theme_text
    assert "#E07800" in theme_text
    assert "#FFB627" in theme_text
    assert "TransitOpsYesidDark" in report_text


def test_report_definition_uses_supported_schema_shape() -> None:
    report = json.loads(_read(REPORT_ROOT / "report.json"))
    pbir = json.loads(_read(POWERBI_ROOT / "transit-ops-v2.Report" / "definition.pbir"))
    pbism = json.loads(_read(POWERBI_ROOT / "transit-ops-v2.SemanticModel" / "definition.pbism"))
    pages = json.loads(_read(REPORT_ROOT / "pages" / "pages.json"))

    assert set(report) <= REPORT_TOP_LEVEL_KEYS
    section_objects = report.get("objects", {}).get("section", [])
    for section_object in section_objects:
        properties = section_object.get("properties", {})
        assert set(properties) <= REPORT_SECTION_PROPERTY_KEYS

    assert set(pbir) == PBIR_TOP_LEVEL_KEYS
    assert set(pbism) == PBISM_TOP_LEVEL_KEYS
    assert set(pages) == PAGES_TOP_LEVEL_KEYS
    for page_name in pages["pageOrder"]:
        page = json.loads(_read(REPORT_ROOT / "pages" / page_name / "page.json"))
        assert set(page) == PAGE_TOP_LEVEL_KEYS


def test_measures_are_bilingual_fr_first_and_legacy_terms_are_absent() -> None:
    measure_text = _read(TABLE_ROOT / "_Measures.tmdl")
    measure_names = set(re.findall(r"^\tmeasure '([^']+)'", measure_text, flags=re.MULTILINE))

    assert EXPECTED_MEASURES <= measure_names
    all_text = _all_model_and_report_text()
    for legacy_term in LEGACY_TERMS:
        assert legacy_term not in all_text


def test_vehicle_summary_5m_uses_actual_gold_rollup_columns() -> None:
    assert _source_columns("VehicleSummary5m") == EXPECTED_VEHICLE_SUMMARY_5M_COLUMNS


def test_dim_date_uses_actual_gold_mart_columns() -> None:
    dim_date_columns = _source_columns("DimDate")

    assert dim_date_columns == EXPECTED_DIM_DATE_COLUMNS
    assert "service_date" in dim_date_columns
    assert "calendar_date" not in dim_date_columns
    assert "day_of_month" not in dim_date_columns


def test_relationships_reference_existing_tmdl_source_columns_when_present() -> None:
    table_columns = {
        path.stem: _source_columns(path.stem) for path in TABLE_ROOT.glob("*.tmdl")
    }
    relationships = _read(MODEL_ROOT / "relationships.tmdl")
    endpoints = re.findall(
        r"^\t(?:fromColumn|toColumn): ([^.]+)\.([^\n]+)$",
        relationships,
        flags=re.MULTILINE,
    )

    for table_name, column_name in endpoints:
        assert table_name in table_columns
        assert column_name in table_columns[table_name]


def test_relationships_are_empty_until_provider_safe_keys_exist() -> None:
    relationships = _read(MODEL_ROOT / "relationships.tmdl").strip()

    assert relationships == ""
