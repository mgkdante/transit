from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0014_clean_reporting_foundation"
down_revision = "0013_gold_ops_brain_contract"
branch_labels = None
depends_on = None


REPORT_LABELS = [
    {
        "label_key": "network_health",
        "label_fr": "Santé du réseau",
        "label_en": "Network Health",
        "label_combined": "Santé du réseau / Network Health",
        "sort_order": 10,
    },
    {
        "label_key": "operations_map",
        "label_fr": "Carte opérationnelle",
        "label_en": "Operations Map",
        "label_combined": "Carte opérationnelle / Operations Map",
        "sort_order": 20,
    },
    {
        "label_key": "hotspots",
        "label_fr": "Points chauds",
        "label_en": "Hotspots",
        "label_combined": "Points chauds / Hotspots",
        "sort_order": 30,
    },
    {
        "label_key": "network_habits",
        "label_fr": "Habitudes du réseau",
        "label_en": "Network Habits",
        "label_combined": "Habitudes du réseau / Network Habits",
        "sort_order": 40,
    },
    {
        "label_key": "history",
        "label_fr": "Historique",
        "label_en": "History",
        "label_combined": "Historique / History",
        "sort_order": 50,
    },
    {
        "label_key": "data_trust",
        "label_fr": "Confiance des données",
        "label_en": "Data Trust",
        "label_combined": "Confiance des données / Data Trust",
        "sort_order": 60,
    },
    {
        "label_key": "citizen_accountability",
        "label_fr": "Responsabilité citoyenne",
        "label_en": "Citizen Accountability",
        "label_combined": "Responsabilité citoyenne / Citizen Accountability",
        "sort_order": 70,
    },
]


def _built_at_column() -> sa.Column:
    return sa.Column(
        "built_at_utc",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


def _provider_fk(table_name: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["provider_id"],
        ["core.providers.provider_id"],
        name=f"fk_gold_{table_name}_provider_id",
    )


def _add_source_realtime_snapshot_link() -> None:
    op.add_column(
        "rt_feed_snapshots",
        sa.Column("source_realtime_snapshot_id", sa.BigInteger(), nullable=True),
        schema="silver",
    )
    op.execute(
        """
        UPDATE silver.rt_feed_snapshots
        SET source_realtime_snapshot_id =
            NULLIF(manifest_json ->> 'source_realtime_snapshot_id', '')::bigint
        WHERE manifest_json ? 'source_realtime_snapshot_id'
        """
    )
    op.create_index(
        "ix_silver_rt_feed_snapshots_source_realtime_snapshot_id",
        "rt_feed_snapshots",
        ["source_realtime_snapshot_id"],
        schema="silver",
    )
    op.create_foreign_key(
        "fk_silver_rt_feed_snapshots_source_realtime_snapshot_id",
        "rt_feed_snapshots",
        "realtime_snapshot_index",
        ["source_realtime_snapshot_id"],
        ["realtime_snapshot_id"],
        source_schema="silver",
        referent_schema="raw",
    )


def _drop_legacy_silver_realtime_tables() -> None:
    op.drop_table("trip_update_stop_time_updates", schema="silver")
    op.drop_table("trip_updates", schema="silver")
    op.drop_table("vehicle_positions", schema="silver")


def _create_gold_reporting_tables() -> None:
    op.create_table(
        "route_delay_hourly",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("period_start_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("trip_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("avg_delay_seconds", sa.Numeric(12, 2), nullable=True),
        sa.Column("max_delay_seconds", sa.Integer(), nullable=True),
        sa.Column("delayed_trip_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        _built_at_column(),
        _provider_fk("route_delay_hourly"),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "period_start_utc",
            "route_id",
            name="pk_gold_route_delay_hourly",
        ),
        schema="gold",
    )
    op.create_table(
        "route_delay_day_of_week",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("day_of_week_iso", sa.Integer(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("trip_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("avg_delay_seconds", sa.Numeric(12, 2), nullable=True),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        _built_at_column(),
        _provider_fk("route_delay_day_of_week"),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "day_of_week_iso",
            "route_id",
            name="pk_gold_route_delay_day_of_week",
        ),
        schema="gold",
    )
    op.create_table(
        "stop_delay_hourly",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("period_start_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("stop_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("avg_arrival_delay_seconds", sa.Numeric(12, 2), nullable=True),
        sa.Column("avg_departure_delay_seconds", sa.Numeric(12, 2), nullable=True),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        _built_at_column(),
        _provider_fk("stop_delay_hourly"),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "period_start_utc",
            "stop_id",
            "route_id",
            name="pk_gold_stop_delay_hourly",
        ),
        schema="gold",
    )
    op.create_table(
        "route_reliability_weekly",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("week_start_local", sa.Date(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("avg_delay_seconds", sa.Numeric(12, 2), nullable=True),
        sa.Column("delayed_trip_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        _built_at_column(),
        _provider_fk("route_reliability_weekly"),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "week_start_local",
            "route_id",
            name="pk_gold_route_reliability_weekly",
        ),
        schema="gold",
    )
    op.create_table(
        "route_reliability_monthly",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("month_start_local", sa.Date(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("avg_delay_seconds", sa.Numeric(12, 2), nullable=True),
        sa.Column("delayed_trip_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        _built_at_column(),
        _provider_fk("route_reliability_monthly"),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "month_start_local",
            "route_id",
            name="pk_gold_route_reliability_monthly",
        ),
        schema="gold",
    )
    op.create_table(
        "stop_delay_weekly",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("week_start_local", sa.Date(), nullable=False),
        sa.Column("stop_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("avg_delay_seconds", sa.Numeric(12, 2), nullable=True),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        _built_at_column(),
        _provider_fk("stop_delay_weekly"),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "week_start_local",
            "stop_id",
            "route_id",
            name="pk_gold_stop_delay_weekly",
        ),
        schema="gold",
    )
    op.create_table(
        "stop_delay_monthly",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("month_start_local", sa.Date(), nullable=False),
        sa.Column("stop_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("avg_delay_seconds", sa.Numeric(12, 2), nullable=True),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        _built_at_column(),
        _provider_fk("stop_delay_monthly"),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "month_start_local",
            "stop_id",
            "route_id",
            name="pk_gold_stop_delay_monthly",
        ),
        schema="gold",
    )
    op.create_table(
        "route_habit_score",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("day_of_week_iso", sa.Integer(), nullable=False),
        sa.Column("hour_of_day_local", sa.Integer(), nullable=False),
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("avg_delay_seconds", sa.Numeric(12, 2), nullable=True),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("repeat_problem_score", sa.Numeric(8, 4), nullable=True),
        _built_at_column(),
        _provider_fk("route_habit_score"),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "route_id",
            "day_of_week_iso",
            "hour_of_day_local",
            name="pk_gold_route_habit_score",
        ),
        schema="gold",
    )
    op.create_table(
        "repeated_problem_route_stop",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("entity_kind", sa.Text(), nullable=False),
        sa.Column("entity_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("period_grain", sa.Text(), nullable=False),
        sa.Column("period_start_local", sa.Date(), nullable=False),
        sa.Column("issue_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("avg_delay_seconds", sa.Numeric(12, 2), nullable=True),
        sa.Column("severity_label", sa.Text(), nullable=True),
        _built_at_column(),
        _provider_fk("repeated_problem_route_stop"),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "entity_kind",
            "entity_id",
            "route_id",
            "period_grain",
            "period_start_local",
            name="pk_gold_repeated_problem_route_stop",
        ),
        schema="gold",
    )
    op.create_table(
        "citizen_accountability_daily",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("provider_local_date", sa.Date(), nullable=False),
        sa.Column(
            "affected_route_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("affected_stop_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("delayed_trip_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("alert_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("rider_impact_score", sa.Numeric(8, 4), nullable=True),
        _built_at_column(),
        _provider_fk("citizen_accountability_daily"),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "provider_local_date",
            name="pk_gold_citizen_accountability_daily",
        ),
        schema="gold",
    )
    op.create_table(
        "report_labels",
        sa.Column("label_key", sa.Text(), nullable=False),
        sa.Column("label_fr", sa.Text(), nullable=False),
        sa.Column("label_en", sa.Text(), nullable=False),
        sa.Column("label_combined", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("label_key", name="pk_gold_report_labels"),
        schema="gold",
    )
    report_labels = sa.table(
        "report_labels",
        sa.column("label_key", sa.Text()),
        sa.column("label_fr", sa.Text()),
        sa.column("label_en", sa.Text()),
        sa.column("label_combined", sa.Text()),
        sa.column("sort_order", sa.Integer()),
        schema="gold",
    )
    op.bulk_insert(report_labels, REPORT_LABELS)


def _drop_gold_reporting_tables() -> None:
    for table_name in (
        "report_labels",
        "citizen_accountability_daily",
        "repeated_problem_route_stop",
        "route_habit_score",
        "stop_delay_monthly",
        "stop_delay_weekly",
        "route_reliability_monthly",
        "route_reliability_weekly",
        "stop_delay_hourly",
        "route_delay_day_of_week",
        "route_delay_hourly",
    ):
        op.drop_table(table_name, schema="gold")


def _drop_source_realtime_snapshot_link() -> None:
    op.drop_constraint(
        "fk_silver_rt_feed_snapshots_source_realtime_snapshot_id",
        "rt_feed_snapshots",
        schema="silver",
        type_="foreignkey",
    )
    op.drop_index(
        "ix_silver_rt_feed_snapshots_source_realtime_snapshot_id",
        table_name="rt_feed_snapshots",
        schema="silver",
    )
    op.drop_column("rt_feed_snapshots", "source_realtime_snapshot_id", schema="silver")


def _recreate_legacy_silver_realtime_tables_for_dev_reverse() -> None:
    # Recreated legacy tables are not canonical after slice 8.7; this only reverses dev DBs.
    op.create_table(
        "vehicle_positions",
        sa.Column("realtime_snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_index", sa.Integer(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("entity_id", sa.Text(), nullable=True),
        sa.Column("vehicle_id", sa.Text(), nullable=True),
        sa.Column("trip_id", sa.Text(), nullable=True),
        sa.Column("route_id", sa.Text(), nullable=True),
        sa.Column("stop_id", sa.Text(), nullable=True),
        sa.Column("current_stop_sequence", sa.Integer(), nullable=True),
        sa.Column("current_status", sa.Integer(), nullable=True),
        sa.Column("occupancy_status", sa.Integer(), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("bearing", sa.Float(), nullable=True),
        sa.Column("speed", sa.Float(), nullable=True),
        sa.Column("position_timestamp_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("feed_timestamp_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("captured_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["realtime_snapshot_id"],
            ["raw.realtime_snapshot_index.realtime_snapshot_id"],
            name="fk_silver_vehicle_positions_snapshot_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_vehicle_positions_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "realtime_snapshot_id",
            "entity_index",
            name="pk_silver_vehicle_positions",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_vehicle_positions_provider_vehicle",
        "vehicle_positions",
        ["provider_id", "vehicle_id"],
        schema="silver",
    )
    op.create_index(
        "ix_silver_vehicle_positions_provider_trip",
        "vehicle_positions",
        ["provider_id", "trip_id"],
        schema="silver",
    )

    op.create_table(
        "trip_updates",
        sa.Column("realtime_snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_index", sa.Integer(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("entity_id", sa.Text(), nullable=True),
        sa.Column("trip_id", sa.Text(), nullable=True),
        sa.Column("route_id", sa.Text(), nullable=True),
        sa.Column("direction_id", sa.Integer(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("vehicle_id", sa.Text(), nullable=True),
        sa.Column("trip_schedule_relationship", sa.Integer(), nullable=True),
        sa.Column("delay_seconds", sa.Integer(), nullable=True),
        sa.Column("feed_timestamp_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("captured_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["realtime_snapshot_id"],
            ["raw.realtime_snapshot_index.realtime_snapshot_id"],
            name="fk_silver_trip_updates_snapshot_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_trip_updates_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "realtime_snapshot_id",
            "entity_index",
            name="pk_silver_trip_updates",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_trip_updates_provider_trip",
        "trip_updates",
        ["provider_id", "trip_id"],
        schema="silver",
    )
    op.create_index(
        "ix_silver_trip_updates_provider_route",
        "trip_updates",
        ["provider_id", "route_id"],
        schema="silver",
    )

    op.create_table(
        "trip_update_stop_time_updates",
        sa.Column("realtime_snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("trip_update_entity_index", sa.Integer(), nullable=False),
        sa.Column("stop_time_update_index", sa.Integer(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("stop_sequence", sa.Integer(), nullable=True),
        sa.Column("stop_id", sa.Text(), nullable=True),
        sa.Column("arrival_delay_seconds", sa.Integer(), nullable=True),
        sa.Column("arrival_time_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("departure_delay_seconds", sa.Integer(), nullable=True),
        sa.Column("departure_time_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("schedule_relationship", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["realtime_snapshot_id"],
            ["raw.realtime_snapshot_index.realtime_snapshot_id"],
            name="fk_silver_trip_update_stop_times_snapshot_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_trip_update_stop_times_provider_id",
        ),
        sa.ForeignKeyConstraint(
            ["realtime_snapshot_id", "trip_update_entity_index"],
            ["silver.trip_updates.realtime_snapshot_id", "silver.trip_updates.entity_index"],
            name="fk_silver_trip_update_stop_times_trip_update",
        ),
        sa.PrimaryKeyConstraint(
            "realtime_snapshot_id",
            "trip_update_entity_index",
            "stop_time_update_index",
            name="pk_silver_trip_update_stop_time_updates",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_trip_update_stop_times_provider_stop",
        "trip_update_stop_time_updates",
        ["provider_id", "stop_id"],
        schema="silver",
    )


def upgrade() -> None:
    _add_source_realtime_snapshot_link()
    _drop_legacy_silver_realtime_tables()
    _create_gold_reporting_tables()


def downgrade() -> None:
    _drop_gold_reporting_tables()
    _drop_source_realtime_snapshot_link()
    _recreate_legacy_silver_realtime_tables_for_dev_reverse()
