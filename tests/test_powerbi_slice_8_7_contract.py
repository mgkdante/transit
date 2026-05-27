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
    "TripDelaySummary5mLive": "trip_delay_summary_5m_live",
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
DESKTOP_REPORT_WIDTH = 1280
DESKTOP_REPORT_HEIGHT = 720
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
    "Couleur fraîcheur / Freshness Color",
    "Couleur retard / Delay Color",
}
BRAND_VOICE_TITLES_REQUIRED = {
    "Source actuelle / Current source",
    "Fraîcheur des flux / Feed freshness state",
    "Plus haut retard / Highest delay now",
    "Trajets problématiques / Problem trips",
}
BRAND_VOICE_TITLES_REMOVED = {
    "Marqueur dataset / Dataset marker",
    "Contexte qualité / Quality context",
    "Pires routes maintenant / Worst routes now",
    "Ce qui cloche maintenant / What is wrong now",
}
EXPECTED_DIM_PROVIDER_COLUMNS = {
    "provider_id",
    "provider_key",
    "display_name",
    "timezone",
    "default_language",
    "is_active",
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


def test_report_pages_are_exact_bilingual_fr_first_desktop_web_layout() -> None:
    pages = json.loads(_read(REPORT_ROOT / "pages" / "pages.json"))
    page_names = pages["pageOrder"]
    page_defs = [
        json.loads(_read(REPORT_ROOT / "pages" / page_name / "page.json"))
        for page_name in page_names
    ]
    display_names = [page["displayName"] for page in page_defs]

    assert display_names == EXPECTED_PAGES
    assert pages["activePageName"] == page_names[0]
    for page in page_defs:
        assert page["width"] == DESKTOP_REPORT_WIDTH
        assert page["height"] == DESKTOP_REPORT_HEIGHT
        assert page["displayOption"] == "FitToPage"


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
    # Brand Spine D3 ("Why orange"): #E07800 is interactive-only; not the
    # primary chart dataColor. Move orange off dataColors[0] so default
    # bar/line series use a neutral foreground hue.
    assert theme["dataColors"][0] != "#E07800"
    assert theme["tableAccent"] == "#E07800"


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


def test_network_health_freshness_measure_uses_gtfs_rt_only() -> None:
    measure_text = _read(TABLE_ROOT / "_Measures.tmdl")
    match = re.search(
        r"measure 'Âge fraîcheur sec / Freshness Age Sec' = ```(?P<dax>.*?)```",
        measure_text,
        flags=re.DOTALL,
    )
    assert match is not None
    dax = match.group("dax")

    assert "CALCULATE(" in dax
    assert "MIN(FeedFreshnessCurrent[completed_age_seconds])" in dax
    assert 'FeedFreshnessCurrent[endpoint_key] IN {"trip_updates", "vehicle_positions"}' in dax
    assert "gis_static" not in dax
    assert "static_schedule" not in dax


def test_measures_dummy_partition_has_valid_single_row_source() -> None:
    measure_text = _read(TABLE_ROOT / "_Measures.tmdl")

    assert "\n\tpartition _Measures = m\n" in measure_text
    assert "\n\t\tpartition _Measures = m\n" not in measure_text
    assert 'Table.FromRows({{"_Measures"}}, type table [Column1 = text])' in measure_text
    assert "Table.FromRows({{}}, type table [Column1 = text])" not in measure_text


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


def test_relationships_ship_inactive_so_desktop_refresh_proves_cardinality() -> None:
    relationships = _read(MODEL_ROOT / "relationships.tmdl").strip()

    assert relationships, "relationships.tmdl should not be empty after Plan task 9 step 5"
    blocks = re.findall(
        r"relationship \w+\n(?:\t[^\n]+\n)+",
        relationships,
    )
    assert blocks, "no relationship blocks parsed"
    for block in blocks:
        assert "isActive: false" in block, (
            f"relationship must ship inactive (operator activates in Desktop after "
            f"refresh proves uniqueness on the dim side):\n{block}"
        )


def test_p05_provider_binds_to_real_dim_provider_columns() -> None:
    visual = json.loads(
        _read(
            REPORT_ROOT
            / "pages"
            / "p05datatrust"
            / "visuals"
            / "p05_provider"
            / "visual.json"
        )
    )
    projections = visual["visual"]["query"]["queryState"]["Values"]["projections"]
    properties = {
        projection["field"]["Column"]["Property"] for projection in projections
    }
    available_columns = _source_columns("DimProvider")

    assert available_columns == EXPECTED_DIM_PROVIDER_COLUMNS
    assert properties <= available_columns, (
        f"p05_provider binds to columns absent from DimProvider: "
        f"{properties - available_columns}"
    )
    assert "provider_name" not in properties
    assert "country_code" not in properties


def test_p00_delay_trend_binds_to_live_view_not_batch_mart() -> None:
    """Network Health is an operator-now page; its delay-trend line chart
    must read from gold.trip_delay_summary_5m_live (sub-second-fresh)
    not gold.trip_delay_summary_5m (built once per day by GH Actions cron
    which leaves the chart ~24h stale and breaks outright if a single
    workflow run is missed)."""
    visual = json.loads(
        _read(
            REPORT_ROOT
            / "pages"
            / "p00networkhealth"
            / "visuals"
            / "p00_delay_trend"
            / "visual.json"
        )
    )
    query_state = visual["visual"]["query"]["queryState"]
    entities = set()
    for role in query_state.values():
        for projection in role.get("projections", []):
            field = projection["field"]
            inner = field.get("Aggregation", field).get("Expression", field)
            column = inner.get("Column", {})
            entity = column.get("Expression", {}).get("SourceRef", {}).get("Entity")
            if entity:
                entities.add(entity)
            elif "Column" not in inner:
                # cope with bare Column projections
                bare_column = field.get("Column", {})
                entity = bare_column.get("Expression", {}).get("SourceRef", {}).get("Entity")
                if entity:
                    entities.add(entity)

    assert entities == {"TripDelaySummary5mLive"}, (
        f"p00_delay_trend should bind exclusively to TripDelaySummary5mLive, "
        f"found: {entities}"
    )


def test_visual_titles_match_brand_voice_after_slice_8_7_polish() -> None:
    report_text = _all_model_and_report_text()

    for title in BRAND_VOICE_TITLES_REQUIRED:
        assert title in report_text, f"expected brand-voice title missing: {title}"
    for title in BRAND_VOICE_TITLES_REMOVED:
        assert title not in report_text, (
            f"old non-brand-voice title still present: {title}"
        )


def test_color_helper_measures_return_brand_hex_palette() -> None:
    measure_text = _read(TABLE_ROOT / "_Measures.tmdl")

    for measure_name in (
        "Couleur fraîcheur / Freshness Color",
        "Couleur retard / Delay Color",
    ):
        match = re.search(
            rf"measure '{re.escape(measure_name)}' = ```(?P<dax>.*?)```",
            measure_text,
            flags=re.DOTALL,
        )
        assert match is not None, f"missing color helper measure: {measure_name}"
        dax = match.group("dax")
        assert "SWITCH(" in dax
        assert '"#6ECF8F"' in dax  # green: healthy
        assert '"#FFB627"' in dax  # yellow: warning
        assert '"#E07800"' in dax  # orange: action required (brand interactive hue)
