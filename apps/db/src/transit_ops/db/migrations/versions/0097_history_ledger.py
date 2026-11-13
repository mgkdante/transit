"""Empty history ledger and owner-controlled pipeline switches."""

from alembic import op

revision = "0097_history_ledger"
down_revision = "0096_provider_live_policy"
branch_labels = None
depends_on = None

DDL = r"""
CREATE TABLE core.history_window (
    dataset_id text NOT NULL,
    provider_id text NOT NULL, -- No FK: migration locks no existing table.
    revision integer NOT NULL DEFAULT 0, -- 0: dataset tied to no definition.
    window_key text NOT NULL, -- YYYY-MM-DD, YYYY-MM, or a 64-hex checksum.
    window_start date,
    working_state text NOT NULL CHECK (working_state IN ('present', 'partial', 'trimmed', 'empty')),
    working_changed_at_utc timestamptz NOT NULL,
    next_version integer NOT NULL DEFAULT 1, -- The one allocator of content versions.
    current_version integer,
    trimmed_at_utc timestamptz,
    hold_until_utc timestamptz,
    hold_reason text,
    PRIMARY KEY (dataset_id, provider_id, revision, window_key)
);

CREATE TABLE core.history_archive_copy (
    dataset_id text NOT NULL,
    provider_id text NOT NULL,
    revision integer NOT NULL,
    window_key text NOT NULL,
    content_version integer NOT NULL CHECK (content_version >= 1),
    schema_version integer NOT NULL,
    storage_backend text NOT NULL CHECK (storage_backend IN ('local', 's3')),
    storage_path text, -- Pack, table file or zip; null for a day with no stored capture.
    manifest_path text,
    byte_size bigint,
    sha256 text CHECK (sha256 ~ '^[0-9a-f]{64}$'), -- Object at storage_path.
    manifest_sha256 text CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'), -- Capture manifest.
    record_count bigint,
    poll_count bigint,
    source_bytes bigint,
    content_sha256 text CHECK (content_sha256 ~ '^[0-9a-f]{64}$'), -- Everything the copy means.
    poll_record_sha256 text CHECK (poll_record_sha256 ~ '^[0-9a-f]{64}$'), -- Capture poll records.
    first_time_utc timestamptz,
    last_time_utc timestamptz,
    allocated_at_utc timestamptz NOT NULL,
    sealed_at_utc timestamptz,
    verified_at_utc timestamptz,
    rejected_at_utc timestamptz,
    reject_reason text,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (dataset_id, provider_id, revision, window_key, content_version),
    FOREIGN KEY (dataset_id, provider_id, revision, window_key)
    REFERENCES core.history_window (dataset_id, provider_id, revision, window_key),

    CHECK (sealed_at_utc IS NULL OR sealed_at_utc >= allocated_at_utc),
    CHECK (verified_at_utc IS NULL OR (sealed_at_utc IS NOT NULL AND verified_at_utc >= sealed_at_utc)),
    CHECK ((rejected_at_utc IS NULL) = (reject_reason IS NULL)),
    CHECK (rejected_at_utc IS NULL OR rejected_at_utc >= GREATEST(allocated_at_utc, sealed_at_utc, verified_at_utc))
);

CREATE TABLE core.history_event ( -- Append-only: who did what to which window, and why.
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at_utc timestamptz NOT NULL DEFAULT now(),
    kind text NOT NULL CHECK (kind IN ('seal', 'verify', 'reject', 'current', 'trim', 'restore', 'hold', 'unhold',
    'changed', 'close_runs', 'fold_published', 'processing_evidence', 'rebuild')),
    dataset_id text NOT NULL,
    provider_id text NOT NULL,
    revision integer NOT NULL,
    window_key text NOT NULL,
    content_version integer,
    actor text NOT NULL,
    reason text,
    details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX history_event_window_idx
    ON core.history_event (dataset_id, provider_id, revision, window_key, event_id);

CREATE TABLE core.pipeline_switches (
    switch_key text PRIMARY KEY,
    enabled boolean NOT NULL DEFAULT false,
    updated_at_utc timestamptz NOT NULL,
    updated_by text NOT NULL,
    reason text NOT NULL
);
REVOKE ALL ON core.history_window, core.history_archive_copy,
    core.history_event, core.pipeline_switches FROM PUBLIC;
DO $$ BEGIN
    -- Revoke an owner's ordinary privileges too: pipeline DML cannot delete rows or rewrite events.
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'transit_app') THEN
        REVOKE ALL ON core.history_window, core.history_archive_copy,
            core.history_event, core.pipeline_switches FROM transit_app;
        GRANT USAGE ON SCHEMA core TO transit_app;
        GRANT SELECT, INSERT, UPDATE ON core.history_window,
            core.history_archive_copy, core.pipeline_switches TO transit_app;
        GRANT SELECT, INSERT ON core.history_event TO transit_app;
    END IF;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'transit-db') THEN
        REVOKE ALL ON core.history_window, core.history_archive_copy,
            core.history_event, core.pipeline_switches FROM "transit-db";
        GRANT USAGE ON SCHEMA core TO "transit-db";
        GRANT SELECT ON core.history_window, core.history_archive_copy,
            core.history_event, core.pipeline_switches TO "transit-db";
    END IF;
END $$;
"""


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '2s'")
    op.execute("SET LOCAL statement_timeout = '15s'")
    op.execute(DDL)


def downgrade() -> None:
    op.execute("DROP INDEX core.history_event_window_idx")
    op.execute(
        "DROP TABLE core.pipeline_switches, core.history_event, "
        "core.history_archive_copy, core.history_window"
    )
