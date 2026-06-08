import pytest
from sqlalchemy.sql.elements import TextClause

from transit_ops.settings import Settings
from transit_ops.source_factory.guards import (
    assert_oracle_database_target,
    build_r2_namespace_proof,
    build_worker_stopped_proof,
    validate_destructive_confirmations,
    validate_migration_revision,
)


def test_oracle_like_database_target_requires_confirmation_and_returns_sanitized_proof() -> None:
    database_url = "postgresql://operator:secret@oracle.internal:5432/transit_ops"

    with pytest.raises(ValueError, match="confirm_oracle_target"):
        assert_oracle_database_target(database_url, confirm_oracle_target=False)

    proof = assert_oracle_database_target(database_url, confirm_oracle_target=True)

    assert proof == {
        "status": "ok",
        "scheme": "postgresql",
        "host": "oracle.internal",
        "port": "5432",
        "database": "transit_ops",
    }
    assert "secret" not in repr(proof)


def test_oracle_database_target_rejects_invalid_port_without_leaking_credentials() -> None:
    database_url = "postgresql://operator:secret@oracle.internal:not-a-port/transit_ops"

    with pytest.raises(ValueError, match="invalid port") as exc_info:
        assert_oracle_database_target(database_url, confirm_oracle_target=True)

    assert "secret" not in str(exc_info.value)
    assert "operator:" not in str(exc_info.value)


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql://operator:neon-password@ep-test.neon.tech/transit_ops",
        "postgresql://operator:railway-password@containers-us-west.railway.app/transit_ops",
        "postgresql://operator:proxy-password@roundhouse.proxy.rlwy.net/transit_ops",
        "postgresql://operator:local-password@localhost/transit_ops",
        "postgresql://operator:loopback-password@127.0.0.1/transit_ops",
    ],
)
def test_non_oracle_targets_are_rejected_without_leaking_credentials(database_url: str) -> None:
    with pytest.raises(ValueError) as exc_info:
        assert_oracle_database_target(database_url, confirm_oracle_target=True)

    message = str(exc_info.value)
    assert "password" not in message
    assert "operator:" not in message


@pytest.mark.parametrize("database_url", [None, "", "   "])
def test_missing_database_target_is_rejected(database_url: str | None) -> None:
    with pytest.raises(ValueError, match="DATABASE_URL"):
        assert_oracle_database_target(database_url, confirm_oracle_target=True)


def test_empty_host_database_target_is_rejected() -> None:
    with pytest.raises(ValueError, match="host"):
        assert_oracle_database_target("postgresql:///transit_ops", confirm_oracle_target=True)


class FakeScalarResult:
    def __init__(self, revision: str | None) -> None:
        self.revision = revision

    def scalar_one_or_none(self) -> str | None:
        return self.revision


class FakeConnection:
    def __init__(self, revision: str | None) -> None:
        self.revision = revision
        self.statements: list[object] = []

    def execute(self, statement: object) -> FakeScalarResult:
        self.statements.append(statement)
        return FakeScalarResult(self.revision)


def test_validate_migration_revision_accepts_exact_expected_revision() -> None:
    connection = FakeConnection("0013_gold_ops_brain_contract")

    proof = validate_migration_revision(connection)

    assert proof == {"status": "ok", "revision": "0013_gold_ops_brain_contract"}
    assert len(connection.statements) == 1
    assert isinstance(connection.statements[0], TextClause)
    assert "alembic_version" in str(connection.statements[0])


def test_validate_migration_revision_rejects_mismatch() -> None:
    connection = FakeConnection("0012_previous_revision")

    with pytest.raises(ValueError, match="0013_gold_ops_brain_contract"):
        validate_migration_revision(connection)


def test_destructive_confirmations_allow_dry_run_without_confirmations() -> None:
    proof = validate_destructive_confirmations(
        execute=False,
        destructive_r2_cleanup=True,
        active_prefix_wipe=True,
        confirm_worker_stopped=False,
        confirm_oracle_target=False,
        confirm_r2_cleanup=False,
        confirm_active_prefix_wipe=False,
    )

    assert proof == {
        "execute": False,
        "destructive_r2_cleanup": True,
        "active_prefix_wipe": True,
        "confirm_worker_stopped": False,
        "confirm_oracle_target": False,
        "confirm_r2_cleanup": False,
        "confirm_active_prefix_wipe": False,
    }


@pytest.mark.parametrize("missing_flag", ["confirm_worker_stopped", "confirm_oracle_target"])
def test_execute_requires_base_confirmations(missing_flag: str) -> None:
    confirmations = {
        "confirm_worker_stopped": True,
        "confirm_oracle_target": True,
        "confirm_r2_cleanup": False,
        "confirm_active_prefix_wipe": False,
    }
    confirmations[missing_flag] = False

    with pytest.raises(ValueError, match=missing_flag):
        validate_destructive_confirmations(
            execute=True,
            destructive_r2_cleanup=False,
            active_prefix_wipe=False,
            **confirmations,
        )


def test_execute_cleanup_requires_r2_cleanup_confirmation() -> None:
    with pytest.raises(ValueError, match="confirm_r2_cleanup"):
        validate_destructive_confirmations(
            execute=True,
            destructive_r2_cleanup=True,
            active_prefix_wipe=False,
            confirm_worker_stopped=True,
            confirm_oracle_target=True,
            confirm_r2_cleanup=False,
            confirm_active_prefix_wipe=False,
        )


def test_execute_active_wipe_requires_active_prefix_confirmation() -> None:
    with pytest.raises(ValueError, match="confirm_active_prefix_wipe"):
        validate_destructive_confirmations(
            execute=True,
            destructive_r2_cleanup=False,
            active_prefix_wipe=True,
            confirm_worker_stopped=True,
            confirm_oracle_target=True,
            confirm_r2_cleanup=False,
            confirm_active_prefix_wipe=False,
        )


def test_destructive_confirmations_return_boolean_proof_when_valid() -> None:
    proof = validate_destructive_confirmations(
        execute=True,
        destructive_r2_cleanup=True,
        active_prefix_wipe=True,
        confirm_worker_stopped=True,
        confirm_oracle_target=True,
        confirm_r2_cleanup=True,
        confirm_active_prefix_wipe=True,
    )

    assert proof["execute"] is True
    assert proof["confirm_worker_stopped"] is True
    assert proof["confirm_oracle_target"] is True
    assert proof["confirm_r2_cleanup"] is True
    assert proof["confirm_active_prefix_wipe"] is True


def test_worker_stopped_proof_requires_confirmation() -> None:
    with pytest.raises(ValueError, match="confirm_worker_stopped"):
        build_worker_stopped_proof(confirm_worker_stopped=False)


def test_worker_stopped_proof_includes_note_only_when_provided() -> None:
    assert build_worker_stopped_proof(confirm_worker_stopped=True) == {
        "status": "ok",
        "confirmed": True,
    }

    assert build_worker_stopped_proof(
        confirm_worker_stopped=True,
        note="operator verified no worker process is running",
    ) == {
        "status": "ok",
        "confirmed": True,
        "note": "operator verified no worker process is running",
    }


@pytest.mark.parametrize(
    "unsafe_note",
    [
        "DATABASE_URL=postgresql://operator:db-secret@oracle.internal/transit_ops",
        "worker output showed secret-key abc123",
        "postgresql://operator:secret@oracle.internal/transit_ops",
    ],
)
def test_worker_stopped_proof_redacts_sensitive_note_content(unsafe_note: str) -> None:
    proof = build_worker_stopped_proof(confirm_worker_stopped=True, note=unsafe_note)

    assert proof["note"] == "[redacted: sensitive operator note omitted]"
    assert "db-secret" not in repr(proof)
    assert "abc123" not in repr(proof)
    assert "operator:" not in repr(proof)


def test_r2_namespace_proof_omits_secrets() -> None:
    settings = Settings(
        DATABASE_URL="postgresql://operator:db-secret@oracle.internal/transit_ops",
        BRONZE_STORAGE_BACKEND="s3",
        BRONZE_S3_BUCKET="transit-raw",
        BRONZE_S3_ENDPOINT="https://access:secret@example.r2.cloudflarestorage.com",
        BRONZE_S3_ACCESS_KEY="access-key",
        BRONZE_S3_SECRET_KEY="secret-key",
    )

    proof = build_r2_namespace_proof(settings, "stm")

    assert proof == {
        "provider_id": "stm",
        "storage_backend": "s3",
        "bucket": "transit-raw",
    }
    assert "secret" not in repr(proof)
    assert "DATABASE_URL" not in repr(proof)


def test_local_namespace_proof_includes_local_root() -> None:
    settings = Settings(
        BRONZE_STORAGE_BACKEND="local",
        BRONZE_LOCAL_ROOT="/tmp/transit-bronze",
    )

    assert build_r2_namespace_proof(settings, "stm") == {
        "provider_id": "stm",
        "storage_backend": "local",
        "local_root": "/tmp/transit-bronze",
    }
