from __future__ import annotations

from dataclasses import dataclass

import pytest

import transit_ops.validation.proof as proof_module
from transit_ops.settings import Settings
from transit_ops.validation.proof import build_retention_proof_report

EXPECTED_RETENTION_CONTRACT = {
    "STATIC_DATASET_RETENTION_COUNT": 1,
    "SILVER_REALTIME_RETENTION_DAYS": 14,
    "GOLD_FACT_RETENTION_DAYS": 7,
    "BRONZE_REALTIME_RETENTION_DAYS": 30,
    "BRONZE_STATIC_RETENTION_DAYS": 365,
    "GOLD_WARM_ROLLUP_RETENTION_DAYS": 365,
}
DEFAULT_CONTRACT_ENV_KEYS = (*EXPECTED_RETENTION_CONTRACT, "DATABASE_URL")


@dataclass(frozen=True)
class FakeDisplayResult:
    label: str
    dry_run: bool | None = None

    def display_dict(self) -> dict[str, object]:
        payload: dict[str, object] = {"label": self.label}
        if self.dry_run is not None:
            payload["dry_run"] = self.dry_run
        return payload


@pytest.fixture
def clean_default_contract_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in DEFAULT_CONTRACT_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def test_retention_proof_report_combines_contract_storage_dry_runs_static_validation() -> None:
    settings = Settings(
        _env_file=None,
        DATABASE_URL="postgresql://user:secret@localhost:5432/transit",
        STATIC_DATASET_RETENTION_COUNT=2,
        SILVER_REALTIME_RETENTION_DAYS=31,
        GOLD_FACT_RETENTION_DAYS=366,
        BRONZE_REALTIME_RETENTION_DAYS=32,
        BRONZE_STATIC_RETENTION_DAYS=33,
        GOLD_WARM_ROLLUP_RETENTION_DAYS=91,
        BRONZE_STORAGE_BACKEND="s3",
        BRONZE_LOCAL_ROOT="/tmp/bronze",
        BRONZE_S3_ENDPOINT="https://example.r2.cloudflarestorage.com",
        BRONZE_S3_BUCKET="transit-proof",
        BRONZE_S3_REGION="auto",
        BRONZE_S3_ACCESS_KEY="access-key",
        BRONZE_S3_SECRET_KEY="secret-key",
    )
    calls: list[tuple[str, str, bool, object]] = []

    def prune(label: str):
        def _call(provider_id, *, settings, engine, dry_run):  # noqa: ANN001
            calls.append((label, provider_id, dry_run, engine))
            return FakeDisplayResult(label=label, dry_run=dry_run)

        return _call

    def validate(provider_id, *, settings, registry):  # noqa: ANN001
        return FakeDisplayResult(label=f"static-{provider_id}")

    engine = object()
    report = build_retention_proof_report(
        "stm",
        settings=settings,
        engine=engine,
        registry=object(),
        static_feed_validator=validate,
        prune_silver=prune("silver"),
        prune_gold=prune("gold"),
        prune_bronze=prune("bronze"),
        prune_warm_rollup=prune("warm_rollup"),
    ).display_dict()

    assert report["provider_id"] == "stm"
    assert set(report) == {
        "provider_id",
        "generated_at_utc",
        "retention_contract",
        "storage",
        "dry_runs",
        "static_feed_validation",
    }
    assert report["retention_contract"] == {
        "STATIC_DATASET_RETENTION_COUNT": 2,
        "SILVER_REALTIME_RETENTION_DAYS": 31,
        "GOLD_FACT_RETENTION_DAYS": 366,
        "BRONZE_REALTIME_RETENTION_DAYS": 32,
        "BRONZE_STATIC_RETENTION_DAYS": 33,
        "GOLD_WARM_ROLLUP_RETENTION_DAYS": 91,
    }
    assert report["storage"] == {
        "BRONZE_STORAGE_BACKEND": "s3",
        "BRONZE_LOCAL_ROOT": "/tmp/bronze",
        "BRONZE_S3_ENDPOINT": "https://example.r2.cloudflarestorage.com",
        "BRONZE_S3_BUCKET": "transit-proof",
        "BRONZE_S3_REGION": "auto",
        "BRONZE_S3_ACCESS_KEY_CONFIGURED": True,
        "BRONZE_S3_SECRET_KEY_CONFIGURED": True,
    }
    assert "access-key" not in str(report)
    assert "secret-key" not in str(report)
    assert calls == [
        ("silver", "stm", True, engine),
        ("gold", "stm", True, engine),
        ("bronze", "stm", True, engine),
        ("warm_rollup", "stm", True, engine),
    ]
    assert report["dry_runs"] == {
        "silver": {
            "status": "ok",
            "dry_run": True,
            "result": {"label": "silver", "dry_run": True},
            "message": "Dry-run completed successfully.",
            "error_type": None,
        },
        "gold": {
            "status": "ok",
            "dry_run": True,
            "result": {"label": "gold", "dry_run": True},
            "message": "Dry-run completed successfully.",
            "error_type": None,
        },
        "bronze": {
            "status": "ok",
            "dry_run": True,
            "result": {"label": "bronze", "dry_run": True},
            "message": "Dry-run completed successfully.",
            "error_type": None,
        },
        "warm_rollup": {
            "status": "ok",
            "dry_run": True,
            "result": {"label": "warm_rollup", "dry_run": True},
            "message": "Dry-run completed successfully.",
            "error_type": None,
        },
    }
    assert report["static_feed_validation"] == {"label": "static-stm"}


def test_retention_proof_report_uses_default_clean_reporting_contract(
    clean_default_contract_env: None,
) -> None:
    settings = Settings(_env_file=None)

    report = build_retention_proof_report(
        "stm",
        settings=settings,
        static_feed_validator=lambda provider_id, **kwargs: FakeDisplayResult("static"),
    ).display_dict()

    assert report["retention_contract"] == EXPECTED_RETENTION_CONTRACT


def test_retention_proof_report_marks_db_backed_dry_runs_unavailable_without_db_url() -> None:
    settings = Settings(_env_file=None, DATABASE_URL=None)
    called = False

    def should_not_prune(*args, **kwargs):  # noqa: ANN002, ANN003
        nonlocal called
        called = True
        raise AssertionError("DB-backed prune should not run without DATABASE_URL")

    report = build_retention_proof_report(
        "stm",
        settings=settings,
        static_feed_validator=lambda provider_id, **kwargs: FakeDisplayResult("static"),
        prune_silver=should_not_prune,
        prune_gold=should_not_prune,
        prune_bronze=should_not_prune,
        prune_warm_rollup=should_not_prune,
    ).display_dict()

    assert called is False
    for section in report["dry_runs"].values():
        assert section == {
            "status": "unavailable",
            "dry_run": True,
            "result": None,
            "message": "DATABASE_URL is required for this dry-run proof surface.",
            "error_type": "missing_database_url",
        }


def test_retention_proof_report_missing_db_url_skips_engine_creation(monkeypatch) -> None:
    settings = Settings(_env_file=None, DATABASE_URL=None)

    def fail_make_engine(settings):  # noqa: ANN001
        raise AssertionError("make_engine should not be called without DATABASE_URL")

    monkeypatch.setattr(proof_module, "make_engine", fail_make_engine)

    report = build_retention_proof_report(
        "stm",
        settings=settings,
        static_feed_validator=lambda provider_id, **kwargs: FakeDisplayResult("static"),
    ).display_dict()

    assert report["dry_runs"]["silver"]["error_type"] == "missing_database_url"


def test_retention_proof_report_propagates_prune_programming_errors() -> None:
    settings = Settings(
        _env_file=None,
        DATABASE_URL="postgresql://user:secret@localhost:5432/transit",
    )

    def broken_prune(provider_id, *, settings, engine, dry_run):  # noqa: ANN001
        raise TypeError("wrong callable signature")

    with pytest.raises(TypeError, match="wrong callable signature"):
        build_retention_proof_report(
            "stm",
            settings=settings,
            engine=object(),
            static_feed_validator=lambda provider_id, **kwargs: FakeDisplayResult("static"),
            prune_silver=broken_prune,
        )


def test_retention_proof_report_propagates_static_validation_programming_errors() -> None:
    settings = Settings(
        _env_file=None,
        DATABASE_URL="postgresql://user:secret@localhost:5432/transit",
    )

    def broken_validator(provider_id, *, settings, registry):  # noqa: ANN001
        raise AttributeError("unexpected result shape")

    with pytest.raises(AttributeError, match="unexpected result shape"):
        build_retention_proof_report(
            "stm",
            settings=settings,
            engine=object(),
            static_feed_validator=broken_validator,
            prune_silver=lambda provider_id, **kwargs: FakeDisplayResult("silver"),
            prune_gold=lambda provider_id, **kwargs: FakeDisplayResult("gold"),
            prune_bronze=lambda provider_id, **kwargs: FakeDisplayResult("bronze"),
            prune_warm_rollup=lambda provider_id, **kwargs: FakeDisplayResult("warm"),
        )


def test_build_retention_proof_report_captures_expected_operational_failures() -> None:
    settings = Settings(
        _env_file=None,
        DATABASE_URL="postgresql://user:secret@localhost:5432/transit",
    )

    def failing_prune(provider_id, *, settings, engine, dry_run):  # noqa: ANN001
        raise ValueError("connection unavailable")

    def failing_validate(provider_id, *, settings, registry):  # noqa: ANN001
        raise ValueError("validation unavailable")

    prune_report = build_retention_proof_report(
        "bad-provider",
        settings=settings,
        engine=object(),
        static_feed_validator=lambda provider_id, **kwargs: FakeDisplayResult("static"),
        prune_silver=failing_prune,
        prune_gold=failing_prune,
        prune_bronze=failing_prune,
        prune_warm_rollup=failing_prune,
    ).display_dict()
    static_report = build_retention_proof_report(
        "bad-provider",
        settings=settings,
        engine=object(),
        static_feed_validator=failing_validate,
        prune_silver=lambda provider_id, **kwargs: FakeDisplayResult("silver"),
        prune_gold=lambda provider_id, **kwargs: FakeDisplayResult("gold"),
        prune_bronze=lambda provider_id, **kwargs: FakeDisplayResult("bronze"),
        prune_warm_rollup=lambda provider_id, **kwargs: FakeDisplayResult("warm"),
    ).display_dict()

    assert prune_report["dry_runs"]["silver"] == {
        "status": "unavailable",
        "dry_run": True,
        "result": None,
        "message": "connection unavailable",
        "error_type": "ValueError",
    }
    assert static_report["static_feed_validation"] == {
        "status": "unavailable",
        "message": "validation unavailable",
        "error_type": "ValueError",
    }
