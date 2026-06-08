from __future__ import annotations

import importlib.util
import re
from pathlib import Path

MIGRATION_PATH = Path(
    "src/transit_ops/db/migrations/versions/0014_clean_reporting_foundation.py"
)

GOLD_TABLE_COLUMNS = {
    "route_delay_hourly": [
        "provider_id",
        "period_start_utc",
        "route_id",
        "trip_count",
        "observation_count",
        "avg_delay_seconds",
        "max_delay_seconds",
        "delayed_trip_count",
        "severe_delay_count",
        "built_at_utc",
    ],
    "route_delay_day_of_week": [
        "provider_id",
        "day_of_week_iso",
        "route_id",
        "trip_count",
        "observation_count",
        "avg_delay_seconds",
        "severe_delay_count",
        "built_at_utc",
    ],
    "stop_delay_hourly": [
        "provider_id",
        "period_start_utc",
        "stop_id",
        "route_id",
        "observation_count",
        "avg_arrival_delay_seconds",
        "avg_departure_delay_seconds",
        "severe_delay_count",
        "built_at_utc",
    ],
    "route_reliability_weekly": [
        "provider_id",
        "week_start_local",
        "route_id",
        "observation_count",
        "avg_delay_seconds",
        "delayed_trip_count",
        "severe_delay_count",
        "built_at_utc",
    ],
    "route_reliability_monthly": [
        "provider_id",
        "month_start_local",
        "route_id",
        "observation_count",
        "avg_delay_seconds",
        "delayed_trip_count",
        "severe_delay_count",
        "built_at_utc",
    ],
    "stop_delay_weekly": [
        "provider_id",
        "week_start_local",
        "stop_id",
        "route_id",
        "observation_count",
        "avg_delay_seconds",
        "severe_delay_count",
        "built_at_utc",
    ],
    "stop_delay_monthly": [
        "provider_id",
        "month_start_local",
        "stop_id",
        "route_id",
        "observation_count",
        "avg_delay_seconds",
        "severe_delay_count",
        "built_at_utc",
    ],
    "route_habit_score": [
        "provider_id",
        "route_id",
        "day_of_week_iso",
        "hour_of_day_local",
        "observation_count",
        "avg_delay_seconds",
        "severe_delay_count",
        "repeat_problem_score",
        "built_at_utc",
    ],
    "repeated_problem_route_stop": [
        "provider_id",
        "entity_kind",
        "entity_id",
        "route_id",
        "period_grain",
        "period_start_local",
        "issue_count",
        "avg_delay_seconds",
        "severity_label",
        "built_at_utc",
    ],
    "citizen_accountability_daily": [
        "provider_id",
        "provider_local_date",
        "affected_route_count",
        "affected_stop_count",
        "delayed_trip_count",
        "severe_delay_count",
        "alert_count",
        "rider_impact_score",
        "built_at_utc",
    ],
    "report_labels": [
        "label_key",
        "label_fr",
        "label_en",
        "label_combined",
        "sort_order",
    ],
}


def _migration_text() -> str:
    return MIGRATION_PATH.read_text(encoding="utf-8")


def _load_migration() -> object:
    spec = importlib.util.spec_from_file_location("migration_0014", MIGRATION_PATH)
    assert spec is not None
    assert spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _table_block(migration: str, table_name: str) -> str:
    start_marker = f'op.create_table(\n        "{table_name}",'
    start = migration.index(start_marker)
    next_table = migration.find("\n    op.create_table(", start + len(start_marker))
    downgrade = migration.find("\ndef downgrade()", start)
    end_candidates = [candidate for candidate in [next_table, downgrade] if candidate != -1]
    return migration[start : min(end_candidates)]


def _table_columns(migration: str, table_name: str) -> list[str]:
    block = _table_block(migration, table_name)
    column_tokens = re.findall(r'sa\.Column\(\s*"([^"]+)"|(_built_at_column\(\))', block)
    return [column_name or "built_at_utc" for column_name, _ in column_tokens]


def test_slice_8_7_migration_revision_chain_is_correct() -> None:
    migration = _load_migration()

    assert migration.revision == "0014_clean_reporting_foundation"
    assert migration.down_revision == "0013_gold_ops_brain_contract"


def test_slice_8_7_links_silver_rt_snapshots_to_raw_snapshot_index() -> None:
    migration = _migration_text()
    fk_start = migration.index(
        'op.create_foreign_key(\n'
        '        "fk_silver_rt_feed_snapshots_source_realtime_snapshot_id",'
    )
    fk_end = migration.index("\n    )", fk_start)
    fk_block = migration[fk_start:fk_end]

    assert 'sa.Column("source_realtime_snapshot_id", sa.BigInteger(), nullable=True)' in migration
    assert "manifest_json ->> 'source_realtime_snapshot_id'" in migration
    assert "ix_silver_rt_feed_snapshots_source_realtime_snapshot_id" in migration
    assert '"rt_feed_snapshots"' in fk_block
    assert '"realtime_snapshot_index"' in fk_block
    assert '["source_realtime_snapshot_id"]' in fk_block
    assert '["realtime_snapshot_id"]' in fk_block
    assert 'source_schema="silver"' in fk_block
    assert 'referent_schema="raw"' in fk_block
    assert re.search(
        r'op\.drop_column\(\s*"rt_feed_snapshots",\s*"source_realtime_snapshot_id",\s*schema="silver"',
        migration,
    )


def test_slice_8_7_drops_legacy_silver_realtime_tables_in_dependency_order() -> None:
    migration = _migration_text()

    expected_order = [
        'op.drop_table("trip_update_stop_time_updates", schema="silver")',
        'op.drop_table("trip_updates", schema="silver")',
        'op.drop_table("vehicle_positions", schema="silver")',
    ]
    positions = [migration.index(statement) for statement in expected_order]
    assert positions == sorted(positions)


def test_slice_8_7_drops_legacy_gold_kpi_views_before_reporting_rebuild() -> None:
    migration = _migration_text()

    upgrade_start = migration.index("\ndef upgrade()")
    upgrade = migration[upgrade_start:]
    create_reporting_position = upgrade.index("_create_gold_reporting_tables()")
    expected_views = [
        "kpi_delayed_trip_count_latest",
        "kpi_max_trip_delay_latest",
        "kpi_avg_trip_delay_latest",
        "kpi_routes_with_live_vehicles_latest",
        "kpi_active_vehicles_latest",
    ]

    assert "_drop_legacy_gold_kpi_views()" in upgrade
    assert upgrade.index("_drop_legacy_gold_kpi_views()") < create_reporting_position
    assert 'op.execute(f"DROP VIEW IF EXISTS gold.{view_name}")' in migration
    for view_name in expected_views:
        assert f'"{view_name}"' in migration


def test_slice_8_7_creates_clean_gold_reporting_tables_with_exact_columns() -> None:
    migration = _migration_text()

    for table_name, expected_columns in GOLD_TABLE_COLUMNS.items():
        block = _table_block(migration, table_name)
        assert _table_columns(migration, table_name) == expected_columns
        assert f'"pk_gold_{table_name}"' in block

        if table_name == "report_labels":
            assert 'sa.Column("provider_id"' not in block
            assert 'sa.Column("built_at_utc"' not in block
            assert 'sa.PrimaryKeyConstraint("label_key", name="pk_gold_report_labels")' in block
        else:
            assert 'sa.Column("provider_id", sa.Text(), nullable=False)' in block
            assert "_built_at_column()" in block
            assert re.search(
                rf'sa\.PrimaryKeyConstraint\(\s*"provider_id",[\s\S]+name="pk_gold_{table_name}"',
                block,
            )


def test_slice_8_7_seeds_bilingual_report_labels() -> None:
    migration = _migration_text()

    expected_labels = {
        "network_health": (
            "Santé du réseau",
            "Network Health",
            "Santé du réseau / Network Health",
            10,
        ),
        "operations_map": (
            "Carte opérationnelle",
            "Operations Map",
            "Carte opérationnelle / Operations Map",
            20,
        ),
        "hotspots": ("Points chauds", "Hotspots", "Points chauds / Hotspots", 30),
        "network_habits": (
            "Habitudes du réseau",
            "Network Habits",
            "Habitudes du réseau / Network Habits",
            40,
        ),
        "history": ("Historique", "History", "Historique / History", 50),
        "data_trust": (
            "Confiance des données",
            "Data Trust",
            "Confiance des données / Data Trust",
            60,
        ),
        "citizen_accountability": (
            "Responsabilité citoyenne",
            "Citizen Accountability",
            "Responsabilité citoyenne / Citizen Accountability",
            70,
        ),
    }

    for label_key, (label_fr, label_en, label_combined, sort_order) in expected_labels.items():
        assert f'"label_key": "{label_key}"' in migration
        assert f'"label_fr": "{label_fr}"' in migration
        assert f'"label_en": "{label_en}"' in migration
        assert f'"label_combined": "{label_combined}"' in migration
        assert f'"sort_order": {sort_order}' in migration


def test_slice_8_7_downgrade_restores_legacy_tables_as_noncanonical_dev_reverse() -> None:
    migration = _migration_text()
    downgrade_start = migration.index("\ndef downgrade()")
    downgrade = migration[downgrade_start:]

    assert "not canonical after slice 8.7" in migration
    assert "_recreate_legacy_silver_realtime_tables_for_dev_reverse()" in downgrade
    for table_name in [
        "vehicle_positions",
        "trip_updates",
        "trip_update_stop_time_updates",
    ]:
        assert f'op.create_table(\n        "{table_name}",' in migration
