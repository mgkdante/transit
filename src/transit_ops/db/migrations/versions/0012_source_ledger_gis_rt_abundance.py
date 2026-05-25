from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0012_source_ledger_gis_rt_abundance"
down_revision = "0011_beta_gold_contracts"
branch_labels = None
depends_on = None


NEW_FEED_KIND_VALUES = (
    "static_schedule",
    "gis_static",
    "trip_updates",
    "vehicle_positions",
)
OLD_FEED_KIND_VALUES = (
    "static_schedule",
    "trip_updates",
    "vehicle_positions",
)
NEW_SOURCE_FORMAT_VALUES = (
    "gtfs_schedule_zip",
    "stm_gis_zip",
    "gtfs_rt_trip_updates",
    "gtfs_rt_vehicle_positions",
)
OLD_SOURCE_FORMAT_VALUES = (
    "gtfs_schedule_zip",
    "gtfs_rt_trip_updates",
    "gtfs_rt_vehicle_positions",
)
NEW_RUN_KIND_VALUES = NEW_FEED_KIND_VALUES
OLD_RUN_KIND_VALUES = OLD_FEED_KIND_VALUES
NEW_DATASET_KIND_VALUES = ("static_schedule", "gis_static")


def _in_constraint(column_name: str, values: tuple[str, ...]) -> str:
    return f"{column_name} IN ({', '.join(repr(value) for value in values)})"


NEW_FEED_KIND_CONSTRAINT = _in_constraint("feed_kind", NEW_FEED_KIND_VALUES)
OLD_FEED_KIND_CONSTRAINT = _in_constraint("feed_kind", OLD_FEED_KIND_VALUES)
NEW_SOURCE_FORMAT_CONSTRAINT = _in_constraint("source_format", NEW_SOURCE_FORMAT_VALUES)
OLD_SOURCE_FORMAT_CONSTRAINT = _in_constraint("source_format", OLD_SOURCE_FORMAT_VALUES)
NEW_RUN_KIND_CONSTRAINT = _in_constraint("run_kind", NEW_RUN_KIND_VALUES)
OLD_RUN_KIND_CONSTRAINT = _in_constraint("run_kind", OLD_RUN_KIND_VALUES)
NEW_DATASET_KIND_CONSTRAINT = "dataset_kind IN ('static_schedule', 'gis_static')"
OLD_DATASET_KIND_CONSTRAINT = "dataset_kind = 'static_schedule'"


def _drop_contract_constraints() -> None:
    op.drop_constraint(
        "ck_feed_endpoints_feed_kind",
        "feed_endpoints",
        schema="core",
        type_="check",
    )
    op.drop_constraint(
        "ck_feed_endpoints_source_format",
        "feed_endpoints",
        schema="core",
        type_="check",
    )
    op.drop_constraint(
        "ck_ingestion_runs_run_kind",
        "ingestion_runs",
        schema="raw",
        type_="check",
    )
    op.drop_constraint(
        "ck_dataset_versions_dataset_kind",
        "dataset_versions",
        schema="core",
        type_="check",
    )


def _create_new_contract_constraints() -> None:
    op.create_check_constraint(
        "ck_feed_endpoints_feed_kind",
        "feed_endpoints",
        NEW_FEED_KIND_CONSTRAINT,
        schema="core",
    )
    op.create_check_constraint(
        "ck_feed_endpoints_source_format",
        "feed_endpoints",
        NEW_SOURCE_FORMAT_CONSTRAINT,
        schema="core",
    )
    op.create_check_constraint(
        "ck_ingestion_runs_run_kind",
        "ingestion_runs",
        NEW_RUN_KIND_CONSTRAINT,
        schema="raw",
    )
    op.create_check_constraint(
        "ck_dataset_versions_dataset_kind",
        "dataset_versions",
        NEW_DATASET_KIND_CONSTRAINT,
        schema="core",
    )


def _create_old_contract_constraints() -> None:
    op.create_check_constraint(
        "ck_feed_endpoints_feed_kind",
        "feed_endpoints",
        OLD_FEED_KIND_CONSTRAINT,
        schema="core",
    )
    op.create_check_constraint(
        "ck_feed_endpoints_source_format",
        "feed_endpoints",
        OLD_SOURCE_FORMAT_CONSTRAINT,
        schema="core",
    )
    op.create_check_constraint(
        "ck_ingestion_runs_run_kind",
        "ingestion_runs",
        OLD_RUN_KIND_CONSTRAINT,
        schema="raw",
    )
    op.create_check_constraint(
        "ck_dataset_versions_dataset_kind",
        "dataset_versions",
        OLD_DATASET_KIND_CONSTRAINT,
        schema="core",
    )


def _add_dataset_version_ledger_columns() -> None:
    for column in (
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("storage_backend", sa.Text(), nullable=True),
        sa.Column("storage_path", sa.Text(), nullable=True),
        sa.Column("checksum_sha256", sa.Text(), nullable=True),
        sa.Column("byte_size", sa.BigInteger(), nullable=True),
        sa.Column("first_seen_at_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("observed_from_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("observed_until_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("parser_version", sa.Text(), nullable=True),
        sa.Column("manifest_json", postgresql.JSONB(), nullable=True),
    ):
        op.add_column("dataset_versions", column, schema="core")


def _backfill_dataset_version_ledger() -> None:
    op.execute(
        """
        UPDATE core.dataset_versions AS dv
        SET
            source_url = COALESCE(dv.source_url, io.source_url),
            storage_backend = COALESCE(dv.storage_backend, io.storage_backend),
            storage_path = COALESCE(dv.storage_path, io.storage_path),
            checksum_sha256 = COALESCE(dv.checksum_sha256, io.checksum_sha256, dv.content_hash),
            byte_size = COALESCE(dv.byte_size, io.byte_size),
            first_seen_at_utc = COALESCE(dv.first_seen_at_utc, io.created_at_utc, dv.loaded_at_utc),
            last_seen_at_utc = COALESCE(dv.last_seen_at_utc, io.created_at_utc, dv.loaded_at_utc),
            observed_from_utc = COALESCE(dv.observed_from_utc, dv.effective_at_utc),
            observed_until_utc = COALESCE(dv.observed_until_utc, dv.effective_at_utc)
        FROM raw.ingestion_objects AS io
        WHERE dv.source_ingestion_object_id = io.ingestion_object_id
        """
    )
    op.execute(
        """
        UPDATE core.dataset_versions
        SET checksum_sha256 = COALESCE(checksum_sha256, content_hash)
        WHERE checksum_sha256 IS NULL
        """
    )


def _create_beta_static_inventory_tables() -> None:
    op.create_table(
        "gtfs_source_members",
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("source_file_name", sa.Text(), nullable=False),
        sa.Column("member_path", sa.Text(), nullable=False),
        sa.Column("row_count", sa.BigInteger(), nullable=True),
        sa.Column("checksum_sha256", sa.Text(), nullable=True),
        sa.Column("byte_size", sa.BigInteger(), nullable=True),
        sa.Column("first_seen_at_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("manifest_json", postgresql.JSONB(), nullable=True),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["core.dataset_versions.dataset_version_id"],
            name="fk_silver_gtfs_source_members_dataset_version_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_gtfs_source_members_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "dataset_version_id",
            "source_file_name",
            "member_path",
            name="pk_silver_gtfs_source_members",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_gtfs_source_members_provider_file",
        "gtfs_source_members",
        ["provider_id", "source_file_name"],
        schema="silver",
    )

    op.create_table(
        "gtfs_extra_rows",
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("source_file_name", sa.Text(), nullable=False),
        sa.Column("source_row_number", sa.BigInteger(), nullable=False),
        sa.Column("row_json", postgresql.JSONB(), nullable=False),
        sa.Column(
            "captured_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["core.dataset_versions.dataset_version_id"],
            name="fk_silver_gtfs_extra_rows_dataset_version_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_gtfs_extra_rows_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "dataset_version_id",
            "source_file_name",
            "source_row_number",
            name="pk_silver_gtfs_extra_rows",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_gtfs_extra_rows_provider_file",
        "gtfs_extra_rows",
        ["provider_id", "source_file_name"],
        schema="silver",
    )


def _add_sparse_static_trip_note_columns() -> None:
    op.add_column(
        "trips",
        sa.Column("note_fr", sa.Text(), nullable=True),
        schema="silver",
    )
    op.add_column(
        "trips",
        sa.Column("note_en", sa.Text(), nullable=True),
        schema="silver",
    )


def _create_realtime_source_tables() -> None:
    op.create_table(
        "rt_feed_snapshots",
        sa.Column(
            "rt_feed_snapshot_id",
            sa.BigInteger(),
            sa.Identity(always=False),
            primary_key=True,
        ),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("feed_endpoint_id", sa.BigInteger(), nullable=False),
        sa.Column("ingestion_run_id", sa.BigInteger(), nullable=False),
        sa.Column("ingestion_object_id", sa.BigInteger(), nullable=True),
        sa.Column("endpoint_key", sa.Text(), nullable=False),
        sa.Column("gtfs_realtime_version", sa.Text(), nullable=True),
        sa.Column("incrementality", sa.Text(), nullable=True),
        sa.Column("feed_timestamp_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "captured_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "loaded_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("storage_backend", sa.Text(), nullable=True),
        sa.Column("storage_path", sa.Text(), nullable=True),
        sa.Column("checksum_sha256", sa.Text(), nullable=True),
        sa.Column("byte_size", sa.BigInteger(), nullable=True),
        sa.Column("parser_version", sa.Text(), nullable=True),
        sa.Column("manifest_json", postgresql.JSONB(), nullable=True),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_rt_feed_snapshots_provider_id",
        ),
        sa.ForeignKeyConstraint(
            ["feed_endpoint_id"],
            ["core.feed_endpoints.feed_endpoint_id"],
            name="fk_silver_rt_feed_snapshots_feed_endpoint_id",
        ),
        sa.ForeignKeyConstraint(
            ["ingestion_run_id"],
            ["raw.ingestion_runs.ingestion_run_id"],
            name="fk_silver_rt_feed_snapshots_ingestion_run_id",
        ),
        sa.ForeignKeyConstraint(
            ["ingestion_object_id"],
            ["raw.ingestion_objects.ingestion_object_id"],
            name="fk_silver_rt_feed_snapshots_ingestion_object_id",
        ),
        sa.UniqueConstraint("ingestion_run_id", name="uq_silver_rt_feed_snapshots_ingestion_run"),
        schema="silver",
    )
    op.create_index(
        "ix_silver_rt_feed_snapshots_provider_endpoint_captured",
        "rt_feed_snapshots",
        ["provider_id", "feed_endpoint_id", "captured_at_utc"],
        schema="silver",
    )

    op.create_table(
        "rt_entities",
        sa.Column("rt_feed_snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_index", sa.Integer(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("entity_id", sa.Text(), nullable=True),
        sa.Column("entity_kind", sa.Text(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("raw_entity_json", postgresql.JSONB(), nullable=True),
        sa.ForeignKeyConstraint(
            ["rt_feed_snapshot_id"],
            ["silver.rt_feed_snapshots.rt_feed_snapshot_id"],
            name="fk_silver_rt_entities_snapshot_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_rt_entities_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "rt_feed_snapshot_id",
            "entity_index",
            name="pk_silver_rt_entities",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_rt_entities_provider_entity",
        "rt_entities",
        ["provider_id", "entity_id"],
        schema="silver",
    )

    op.create_table(
        "rt_trip_updates",
        sa.Column("rt_feed_snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_index", sa.Integer(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("trip_id", sa.Text(), nullable=True),
        sa.Column("route_id", sa.Text(), nullable=True),
        sa.Column("direction_id", sa.Integer(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("schedule_relationship", sa.Integer(), nullable=True),
        sa.Column("trip_update_timestamp_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("feed_timestamp_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("captured_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["rt_feed_snapshot_id", "entity_index"],
            ["silver.rt_entities.rt_feed_snapshot_id", "silver.rt_entities.entity_index"],
            name="fk_silver_rt_trip_updates_entity",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_rt_trip_updates_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "rt_feed_snapshot_id",
            "entity_index",
            name="pk_silver_rt_trip_updates",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_rt_trip_updates_provider_trip",
        "rt_trip_updates",
        ["provider_id", "trip_id"],
        schema="silver",
    )
    op.create_index(
        "ix_silver_rt_trip_updates_provider_route",
        "rt_trip_updates",
        ["provider_id", "route_id"],
        schema="silver",
    )

    op.create_table(
        "rt_trip_update_stop_times",
        sa.Column("rt_feed_snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_index", sa.Integer(), nullable=False),
        sa.Column("stop_time_update_index", sa.Integer(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("stop_sequence", sa.Integer(), nullable=True),
        sa.Column("stop_id", sa.Text(), nullable=True),
        sa.Column("arrival_time_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("departure_time_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("schedule_relationship", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["rt_feed_snapshot_id", "entity_index"],
            ["silver.rt_trip_updates.rt_feed_snapshot_id", "silver.rt_trip_updates.entity_index"],
            name="fk_silver_rt_trip_update_stop_times_trip_update",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_rt_trip_update_stop_times_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "rt_feed_snapshot_id",
            "entity_index",
            "stop_time_update_index",
            name="pk_silver_rt_trip_update_stop_times",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_rt_trip_update_stop_times_provider_stop",
        "rt_trip_update_stop_times",
        ["provider_id", "stop_id"],
        schema="silver",
    )

    op.create_table(
        "rt_vehicle_positions",
        sa.Column("rt_feed_snapshot_id", sa.BigInteger(), nullable=False),
        sa.Column("entity_index", sa.Integer(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("vehicle_id", sa.Text(), nullable=True),
        sa.Column("trip_id", sa.Text(), nullable=True),
        sa.Column("route_id", sa.Text(), nullable=True),
        sa.Column("direction_id", sa.Integer(), nullable=True),
        sa.Column("start_time", sa.Text(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("bearing", sa.Float(), nullable=True),
        sa.Column("speed", sa.Float(), nullable=True),
        sa.Column("stop_id", sa.Text(), nullable=True),
        sa.Column("current_stop_sequence", sa.Integer(), nullable=True),
        sa.Column("current_status", sa.Integer(), nullable=True),
        sa.Column("occupancy_status", sa.Integer(), nullable=True),
        sa.Column("congestion_level", sa.Integer(), nullable=True),
        sa.Column("vehicle_timestamp_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("position_quality", sa.Text(), nullable=True),
        sa.Column("feed_timestamp_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("captured_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["rt_feed_snapshot_id", "entity_index"],
            ["silver.rt_entities.rt_feed_snapshot_id", "silver.rt_entities.entity_index"],
            name="fk_silver_rt_vehicle_positions_entity",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_rt_vehicle_positions_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "rt_feed_snapshot_id",
            "entity_index",
            name="pk_silver_rt_vehicle_positions",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_rt_vehicle_positions_provider_vehicle",
        "rt_vehicle_positions",
        ["provider_id", "vehicle_id"],
        schema="silver",
    )
    op.create_index(
        "ix_silver_rt_vehicle_positions_provider_trip",
        "rt_vehicle_positions",
        ["provider_id", "trip_id"],
        schema="silver",
    )


def _create_gis_source_tables() -> None:
    op.create_table(
        "gis_datasets",
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("storage_backend", sa.Text(), nullable=True),
        sa.Column("storage_path", sa.Text(), nullable=True),
        sa.Column("checksum_sha256", sa.Text(), nullable=True),
        sa.Column("byte_size", sa.BigInteger(), nullable=True),
        sa.Column("source_crs_name", sa.Text(), nullable=True),
        sa.Column("source_crs_epsg", sa.Integer(), nullable=True),
        sa.Column("source_crs_wkt", sa.Text(), nullable=True),
        sa.Column("parser_version", sa.Text(), nullable=True),
        sa.Column("manifest_json", postgresql.JSONB(), nullable=True),
        sa.Column(
            "parsed_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["core.dataset_versions.dataset_version_id"],
            name="fk_silver_gis_datasets_dataset_version_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_gis_datasets_provider_id",
        ),
        sa.PrimaryKeyConstraint("dataset_version_id", name="pk_silver_gis_datasets"),
        schema="silver",
    )
    op.create_index(
        "ix_silver_gis_datasets_provider",
        "gis_datasets",
        ["provider_id", "dataset_version_id"],
        schema="silver",
    )

    op.create_table(
        "gis_stop_features",
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("source_feature_id", sa.Text(), nullable=False),
        sa.Column("stop_code", sa.Text(), nullable=True),
        sa.Column("stop_id", sa.Text(), nullable=True),
        sa.Column("stop_name", sa.Text(), nullable=True),
        sa.Column("stop_url", sa.Text(), nullable=True),
        sa.Column("wheelchair", sa.Text(), nullable=True),
        sa.Column("route_id", sa.Text(), nullable=True),
        sa.Column("loc_type", sa.Text(), nullable=True),
        sa.Column("shelter", sa.Text(), nullable=True),
        sa.Column("service_id", sa.Text(), nullable=True),
        sa.Column("source_attributes_json", postgresql.JSONB(), nullable=True),
        sa.Column("source_geometry_wkb", sa.LargeBinary(), nullable=False),
        sa.Column("source_geometry_type", sa.Text(), nullable=True),
        sa.Column("source_crs_name", sa.Text(), nullable=True),
        sa.Column("source_crs_epsg", sa.Integer(), nullable=True),
        sa.Column("source_crs_wkt", sa.Text(), nullable=True),
        sa.Column(
            "parsed_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["silver.gis_datasets.dataset_version_id"],
            name="fk_silver_gis_stop_features_dataset_version_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_gis_stop_features_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "dataset_version_id",
            "source_feature_id",
            name="pk_silver_gis_stop_features",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_gis_stop_features_provider_stop",
        "gis_stop_features",
        ["provider_id", "stop_id"],
        schema="silver",
    )

    op.create_table(
        "gis_line_features",
        sa.Column("dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("source_feature_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=True),
        sa.Column("route_name", sa.Text(), nullable=True),
        sa.Column("headsign", sa.Text(), nullable=True),
        sa.Column("shape_id", sa.Text(), nullable=True),
        sa.Column("ct", sa.Text(), nullable=True),
        sa.Column("service_id", sa.Text(), nullable=True),
        sa.Column("source_attributes_json", postgresql.JSONB(), nullable=True),
        sa.Column("source_geometry_wkb", sa.LargeBinary(), nullable=False),
        sa.Column("source_geometry_type", sa.Text(), nullable=True),
        sa.Column("source_crs_name", sa.Text(), nullable=True),
        sa.Column("source_crs_epsg", sa.Integer(), nullable=True),
        sa.Column("source_crs_wkt", sa.Text(), nullable=True),
        sa.Column(
            "parsed_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["dataset_version_id"],
            ["silver.gis_datasets.dataset_version_id"],
            name="fk_silver_gis_line_features_dataset_version_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_gis_line_features_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "dataset_version_id",
            "source_feature_id",
            name="pk_silver_gis_line_features",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_gis_line_features_provider_route",
        "gis_line_features",
        ["provider_id", "route_id"],
        schema="silver",
    )

    op.create_table(
        "gis_gtfs_matches",
        sa.Column("gis_dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("static_dataset_version_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("feature_kind", sa.Text(), nullable=False),
        sa.Column("source_feature_id", sa.Text(), nullable=False),
        sa.Column("gtfs_id", sa.Text(), nullable=False),
        sa.Column("match_key", sa.Text(), nullable=False),
        sa.Column("match_status", sa.Text(), nullable=False),
        sa.Column("match_notes", sa.Text(), nullable=True),
        sa.Column(
            "matched_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["gis_dataset_version_id"],
            ["silver.gis_datasets.dataset_version_id"],
            name="fk_silver_gis_gtfs_matches_gis_dataset_version_id",
        ),
        sa.ForeignKeyConstraint(
            ["static_dataset_version_id"],
            ["core.dataset_versions.dataset_version_id"],
            name="fk_silver_gis_gtfs_matches_static_dataset_version_id",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_silver_gis_gtfs_matches_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "gis_dataset_version_id",
            "static_dataset_version_id",
            "feature_kind",
            "source_feature_id",
            "gtfs_id",
            name="pk_silver_gis_gtfs_matches",
        ),
        schema="silver",
    )
    op.create_index(
        "ix_silver_gis_gtfs_matches_provider_gtfs",
        "gis_gtfs_matches",
        ["provider_id", "feature_kind", "gtfs_id"],
        schema="silver",
    )


def _guard_downgrade_has_no_8_4_contract_rows() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM core.feed_endpoints
                WHERE feed_kind = 'gis_static'
                   OR source_format = 'stm_gis_zip'
            )
            OR EXISTS (
                SELECT 1
                FROM raw.ingestion_runs
                WHERE run_kind = 'gis_static'
            )
            OR EXISTS (
                SELECT 1
                FROM core.dataset_versions
                WHERE dataset_kind = 'gis_static'
            )
            THEN
                RAISE EXCEPTION USING MESSAGE =
                    'Cannot downgrade 0012_source_ledger_gis_rt_abundance '
                    || 'while 8.4 GIS contract rows exist; prune 8.4 data first.';
            END IF;
        END $$;
        """
    )


def upgrade() -> None:
    op.alter_column(
        "alembic_version",
        "version_num",
        existing_type=sa.String(length=32),
        type_=sa.String(length=128),
    )
    _drop_contract_constraints()
    _create_new_contract_constraints()
    _add_dataset_version_ledger_columns()
    _backfill_dataset_version_ledger()
    _add_sparse_static_trip_note_columns()
    _create_beta_static_inventory_tables()
    _create_realtime_source_tables()
    _create_gis_source_tables()


def downgrade() -> None:
    _guard_downgrade_has_no_8_4_contract_rows()

    op.drop_index(
        "ix_silver_gis_gtfs_matches_provider_gtfs",
        table_name="gis_gtfs_matches",
        schema="silver",
    )
    op.drop_table("gis_gtfs_matches", schema="silver")
    op.drop_index(
        "ix_silver_gis_line_features_provider_route",
        table_name="gis_line_features",
        schema="silver",
    )
    op.drop_table("gis_line_features", schema="silver")
    op.drop_index(
        "ix_silver_gis_stop_features_provider_stop",
        table_name="gis_stop_features",
        schema="silver",
    )
    op.drop_table("gis_stop_features", schema="silver")
    op.drop_index(
        "ix_silver_gis_datasets_provider",
        table_name="gis_datasets",
        schema="silver",
    )
    op.drop_table("gis_datasets", schema="silver")

    op.drop_index(
        "ix_silver_rt_vehicle_positions_provider_trip",
        table_name="rt_vehicle_positions",
        schema="silver",
    )
    op.drop_index(
        "ix_silver_rt_vehicle_positions_provider_vehicle",
        table_name="rt_vehicle_positions",
        schema="silver",
    )
    op.drop_table("rt_vehicle_positions", schema="silver")
    op.drop_index(
        "ix_silver_rt_trip_update_stop_times_provider_stop",
        table_name="rt_trip_update_stop_times",
        schema="silver",
    )
    op.drop_table("rt_trip_update_stop_times", schema="silver")
    op.drop_index(
        "ix_silver_rt_trip_updates_provider_route",
        table_name="rt_trip_updates",
        schema="silver",
    )
    op.drop_index(
        "ix_silver_rt_trip_updates_provider_trip",
        table_name="rt_trip_updates",
        schema="silver",
    )
    op.drop_table("rt_trip_updates", schema="silver")
    op.drop_index(
        "ix_silver_rt_entities_provider_entity",
        table_name="rt_entities",
        schema="silver",
    )
    op.drop_table("rt_entities", schema="silver")
    op.drop_index(
        "ix_silver_rt_feed_snapshots_provider_endpoint_captured",
        table_name="rt_feed_snapshots",
        schema="silver",
    )
    op.drop_table("rt_feed_snapshots", schema="silver")

    op.drop_index(
        "ix_silver_gtfs_extra_rows_provider_file",
        table_name="gtfs_extra_rows",
        schema="silver",
    )
    op.drop_table("gtfs_extra_rows", schema="silver")
    op.drop_index(
        "ix_silver_gtfs_source_members_provider_file",
        table_name="gtfs_source_members",
        schema="silver",
    )
    op.drop_table("gtfs_source_members", schema="silver")

    op.drop_column("trips", "note_en", schema="silver")
    op.drop_column("trips", "note_fr", schema="silver")

    for column_name in (
        "manifest_json",
        "parser_version",
        "observed_until_utc",
        "observed_from_utc",
        "last_seen_at_utc",
        "first_seen_at_utc",
        "byte_size",
        "checksum_sha256",
        "storage_path",
        "storage_backend",
        "source_url",
    ):
        op.drop_column("dataset_versions", column_name, schema="core")

    _drop_contract_constraints()
    _create_old_contract_constraints()
