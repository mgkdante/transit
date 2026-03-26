from __future__ import annotations

import pytest

from transit_ops.core.models import ProviderManifest
from transit_ops.gold.marts import build_gold_marts
from transit_ops.settings import Settings


class FakeScalarResult:
    def __init__(self, scalar_value=None) -> None:  # noqa: ANN001
        self.scalar_value = scalar_value

    def scalar_one(self):  # noqa: ANN201
        return self.scalar_value


class FakeMappingResult:
    def __init__(self, row: dict[str, object] | None) -> None:
        self.row = row

    def mappings(self):  # noqa: ANN201
        return self

    def one_or_none(self):  # noqa: ANN201
        return self.row


class RecordingConnection:
    def __init__(self, *, dataset_row: dict[str, object] | None) -> None:
        self.dataset_row = dataset_row
        self.calls: list[tuple[str, object]] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        sql_text = str(statement)
        self.calls.append((sql_text, params))

        if "FROM core.dataset_versions" in sql_text:
            return FakeMappingResult(self.dataset_row)
        if "SELECT max(realtime_snapshot_id)" in sql_text and "silver.trip_updates" in sql_text:
            return FakeScalarResult(2)
        if (
            "SELECT max(realtime_snapshot_id)" in sql_text
            and "silver.vehicle_positions" in sql_text
        ):
            return FakeScalarResult(1)
        if "SELECT count(*)" in sql_text and "gold.dim_route" in sql_text:
            return FakeScalarResult(216)
        if "SELECT count(*)" in sql_text and "gold.dim_stop" in sql_text:
            return FakeScalarResult(8897)
        if "SELECT count(*)" in sql_text and "gold.dim_date" in sql_text:
            return FakeScalarResult(99)
        if "SELECT count(*)" in sql_text and "gold.fact_vehicle_snapshot" in sql_text:
            return FakeScalarResult(953)
        if "SELECT count(*)" in sql_text and "gold.fact_trip_delay_snapshot" in sql_text:
            return FakeScalarResult(1780)
        return FakeScalarResult(0)


class _ContextManager:
    def __init__(self, connection) -> None:  # noqa: ANN001
        self.connection = connection

    def __enter__(self):  # noqa: ANN201
        return self.connection

    def __exit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001, ANN201
        return False


class FakeEngine:
    def __init__(self, connection) -> None:  # noqa: ANN001
        self.connection = connection

    def begin(self):  # noqa: ANN201
        return _ContextManager(self.connection)


class FakeRegistry:
    def __init__(self, manifest: ProviderManifest) -> None:
        self.manifest = manifest

    def get_provider(self, provider_id: str) -> ProviderManifest:
        assert provider_id == self.manifest.provider.provider_id
        return self.manifest


def _build_manifest() -> ProviderManifest:
    return ProviderManifest.model_validate(
        {
            "provider": {
                "provider_id": "stm",
                "display_name": "STM",
                "timezone": "America/Toronto",
                "is_active": True,
            },
            "feeds": {
                "static_schedule": {
                    "endpoint_key": "static_schedule",
                    "feed_kind": "static_schedule",
                    "source_format": "gtfs_schedule_zip",
                    "source_url": "https://example.com/static.zip",
                    "auth": {"auth_type": "none"},
                    "refresh_interval_seconds": 86400,
                },
                "trip_updates": {
                    "endpoint_key": "trip_updates",
                    "feed_kind": "trip_updates",
                    "source_format": "gtfs_rt_trip_updates",
                    "source_url": "https://example.com/trip-updates.pb",
                    "auth": {
                        "auth_type": "api_key",
                        "credential_env_var": "STM_API_KEY",
                        "auth_header_name": "apiKey",
                    },
                    "refresh_interval_seconds": 30,
                },
                "vehicle_positions": {
                    "endpoint_key": "vehicle_positions",
                    "feed_kind": "vehicle_positions",
                    "source_format": "gtfs_rt_vehicle_positions",
                    "source_url": "https://example.com/vehicle-positions.pb",
                    "auth": {
                        "auth_type": "api_key",
                        "credential_env_var": "STM_API_KEY",
                        "auth_header_name": "apiKey",
                    },
                    "refresh_interval_seconds": 30,
                },
            },
        }
    )


def test_build_gold_marts_rebuilds_dimensions_and_facts() -> None:
    connection = RecordingConnection(dataset_row={"dataset_version_id": 2})
    engine = FakeEngine(connection)
    settings = Settings(NEON_DATABASE_URL="postgresql://user:pass@example.com/neondb")

    result = build_gold_marts(
        "stm",
        settings=settings,
        registry=FakeRegistry(_build_manifest()),
        engine=engine,
    )

    assert result.provider_id == "stm"
    assert result.provider_timezone == "America/Toronto"
    assert result.dataset_version_id == 2
    assert result.latest_trip_updates_snapshot_id == 2
    assert result.latest_vehicle_snapshot_id == 1
    assert result.row_counts == {
        "dim_route": 216,
        "dim_stop": 8897,
        "dim_date": 99,
        "fact_vehicle_snapshot": 953,
        "fact_trip_delay_snapshot": 1780,
    }
    assert "DELETE FROM gold.fact_trip_delay_snapshot" in connection.calls[3][0]
    assert "INSERT INTO gold.dim_route" in connection.calls[8][0]
    assert "INSERT INTO gold.fact_trip_delay_snapshot" in connection.calls[12][0]


def test_build_gold_marts_requires_current_static_dataset() -> None:
    connection = RecordingConnection(dataset_row=None)
    engine = FakeEngine(connection)
    settings = Settings(NEON_DATABASE_URL="postgresql://user:pass@example.com/neondb")

    with pytest.raises(ValueError, match="Run load-static-silver before build-gold-marts"):
        build_gold_marts(
            "stm",
            settings=settings,
            registry=FakeRegistry(_build_manifest()),
            engine=engine,
        )
