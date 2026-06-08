from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001_initial_foundation"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    for schema_name in ("core", "raw", "silver", "gold", "ops"):
        op.execute(f"CREATE SCHEMA IF NOT EXISTS {schema_name}")

    op.create_table(
        "providers",
        sa.Column("provider_id", sa.Text(), primary_key=True),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("timezone", sa.Text(), nullable=False),
        sa.Column("attribution_text", sa.Text(), nullable=True),
        sa.Column("website_url", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema="core",
    )

    op.create_table(
        "feed_endpoints",
        sa.Column("feed_endpoint_id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("endpoint_key", sa.Text(), nullable=False),
        sa.Column("feed_kind", sa.Text(), nullable=False),
        sa.Column("source_format", sa.Text(), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("auth_type", sa.Text(), nullable=False, server_default=sa.text("'api_key'")),
        sa.Column("refresh_interval_seconds", sa.Integer(), nullable=True),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "feed_kind IN ('static_schedule', 'trip_updates', 'vehicle_positions')",
            name="ck_feed_endpoints_feed_kind",
        ),
        sa.CheckConstraint(
            (
                "source_format IN "
                "('gtfs_schedule_zip', 'gtfs_rt_trip_updates', 'gtfs_rt_vehicle_positions')"
            ),
            name="ck_feed_endpoints_source_format",
        ),
        sa.ForeignKeyConstraint(["provider_id"], ["core.providers.provider_id"]),
        sa.UniqueConstraint(
            "provider_id",
            "endpoint_key",
            name="uq_feed_endpoints_provider_endpoint_key",
        ),
        schema="core",
    )

    op.create_table(
        "ingestion_runs",
        sa.Column("ingestion_run_id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("feed_endpoint_id", sa.BigInteger(), nullable=False),
        sa.Column("run_kind", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column(
            "requested_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "started_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("completed_at_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("feed_timestamp_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("http_status_code", sa.Integer(), nullable=True),
        sa.Column("entity_count", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "run_kind IN ('static_schedule', 'trip_updates', 'vehicle_positions')",
            name="ck_ingestion_runs_run_kind",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'succeeded', 'failed')",
            name="ck_ingestion_runs_status",
        ),
        sa.ForeignKeyConstraint(["provider_id"], ["core.providers.provider_id"]),
        sa.ForeignKeyConstraint(["feed_endpoint_id"], ["core.feed_endpoints.feed_endpoint_id"]),
        schema="raw",
    )
    op.create_index(
        "ix_ingestion_runs_provider_endpoint_started",
        "ingestion_runs",
        ["provider_id", "feed_endpoint_id", "started_at_utc"],
        schema="raw",
    )

    op.create_table(
        "ingestion_objects",
        sa.Column(
            "ingestion_object_id",
            sa.BigInteger(),
            sa.Identity(always=False),
            primary_key=True,
        ),
        sa.Column("ingestion_run_id", sa.BigInteger(), nullable=False),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("object_kind", sa.Text(), nullable=False),
        sa.Column("storage_backend", sa.Text(), nullable=False),
        sa.Column("storage_path", sa.Text(), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("checksum_sha256", sa.Text(), nullable=True),
        sa.Column("byte_size", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "storage_backend IN ('local', 's3')",
            name="ck_ingestion_objects_storage_backend",
        ),
        sa.ForeignKeyConstraint(["ingestion_run_id"], ["raw.ingestion_runs.ingestion_run_id"]),
        sa.ForeignKeyConstraint(["provider_id"], ["core.providers.provider_id"]),
        sa.UniqueConstraint("storage_backend", "storage_path", name="uq_ingestion_objects_storage"),
        schema="raw",
    )
    op.create_index(
        "ix_ingestion_objects_ingestion_run_id",
        "ingestion_objects",
        ["ingestion_run_id"],
        schema="raw",
    )

    op.create_table(
        "realtime_snapshot_index",
        sa.Column(
            "realtime_snapshot_id",
            sa.BigInteger(),
            sa.Identity(always=False),
            primary_key=True,
        ),
        sa.Column("ingestion_run_id", sa.BigInteger(), nullable=False),
        sa.Column("ingestion_object_id", sa.BigInteger(), nullable=True),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("feed_endpoint_id", sa.BigInteger(), nullable=False),
        sa.Column("feed_timestamp_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("entity_count", sa.Integer(), nullable=True),
        sa.Column(
            "captured_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["ingestion_run_id"], ["raw.ingestion_runs.ingestion_run_id"]),
        sa.ForeignKeyConstraint(
            ["ingestion_object_id"],
            ["raw.ingestion_objects.ingestion_object_id"],
        ),
        sa.ForeignKeyConstraint(["provider_id"], ["core.providers.provider_id"]),
        sa.ForeignKeyConstraint(["feed_endpoint_id"], ["core.feed_endpoints.feed_endpoint_id"]),
        sa.UniqueConstraint("ingestion_run_id", name="uq_realtime_snapshot_index_ingestion_run_id"),
        schema="raw",
    )
    op.create_index(
        "ix_realtime_snapshot_provider_endpoint_feed_ts",
        "realtime_snapshot_index",
        ["provider_id", "feed_endpoint_id", "feed_timestamp_utc"],
        schema="raw",
    )

    op.create_table(
        "dataset_versions",
        sa.Column(
            "dataset_version_id",
            sa.BigInteger(),
            sa.Identity(always=False),
            primary_key=True,
        ),
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("feed_endpoint_id", sa.BigInteger(), nullable=False),
        sa.Column("source_ingestion_run_id", sa.BigInteger(), nullable=False),
        sa.Column("source_ingestion_object_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "dataset_kind",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'static_schedule'"),
        ),
        sa.Column("source_version", sa.Text(), nullable=True),
        sa.Column("content_hash", sa.Text(), nullable=False),
        sa.Column(
            "loaded_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("effective_at_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.CheckConstraint(
            "dataset_kind = 'static_schedule'",
            name="ck_dataset_versions_dataset_kind",
        ),
        sa.ForeignKeyConstraint(["provider_id"], ["core.providers.provider_id"]),
        sa.ForeignKeyConstraint(["feed_endpoint_id"], ["core.feed_endpoints.feed_endpoint_id"]),
        sa.ForeignKeyConstraint(
            ["source_ingestion_run_id"],
            ["raw.ingestion_runs.ingestion_run_id"],
        ),
        sa.ForeignKeyConstraint(
            ["source_ingestion_object_id"],
            ["raw.ingestion_objects.ingestion_object_id"],
        ),
        sa.UniqueConstraint(
            "provider_id",
            "feed_endpoint_id",
            "content_hash",
            name="uq_dataset_versions_hash",
        ),
        schema="core",
    )
    op.create_index(
        "ix_dataset_versions_provider_endpoint_loaded",
        "dataset_versions",
        ["provider_id", "feed_endpoint_id", "loaded_at_utc"],
        schema="core",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_dataset_versions_provider_endpoint_loaded",
        table_name="dataset_versions",
        schema="core",
    )
    op.drop_table("dataset_versions", schema="core")

    op.drop_index(
        "ix_realtime_snapshot_provider_endpoint_feed_ts",
        table_name="realtime_snapshot_index",
        schema="raw",
    )
    op.drop_table("realtime_snapshot_index", schema="raw")

    op.drop_index(
        "ix_ingestion_objects_ingestion_run_id",
        table_name="ingestion_objects",
        schema="raw",
    )
    op.drop_table("ingestion_objects", schema="raw")

    op.drop_index(
        "ix_ingestion_runs_provider_endpoint_started",
        table_name="ingestion_runs",
        schema="raw",
    )
    op.drop_table("ingestion_runs", schema="raw")

    op.drop_table("feed_endpoints", schema="core")
    op.drop_table("providers", schema="core")

    for schema_name in ("ops", "gold", "silver", "raw", "core"):
        op.execute(f"DROP SCHEMA IF EXISTS {schema_name} CASCADE")
