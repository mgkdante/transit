"""Offline unit coverage for D2 alert-language measurement semantics."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

from transit_ops.core.models import ProviderManifest
from transit_ops.validation.alert_language_coverage import (
    AlertLanguageCoverageCounts,
    build_alert_language_coverage_measurement,
    run_alert_language_coverage_measurement,
)


def _manifest(provider_id: str, *, alert_feed: bool) -> ProviderManifest:
    feeds: dict[str, object] = {
        "static_schedule": {
            "endpoint_key": "static_schedule",
            "feed_kind": "static_schedule",
            "source_format": "gtfs_schedule_zip",
            "source_url": f"https://example.test/{provider_id}.zip",
            "auth": {"auth_type": "none"},
            "refresh_interval_seconds": 86400,
        }
    }
    if alert_feed:
        feeds["service_alerts"] = {
            "endpoint_key": "service_alerts",
            "feed_kind": "service_alerts",
            "source_format": "gtfs_rt_service_alerts",
            "source_url": f"https://example.test/{provider_id}-alerts.pb",
            "auth": {"auth_type": "none"},
            "refresh_interval_seconds": 300,
        }
    return ProviderManifest.model_validate(
        {
            "provider": {
                "provider_id": provider_id,
                "display_name": provider_id.upper(),
                "timezone": "America/Toronto",
            },
            "feeds": feeds,
        }
    )


def _counts(
    *,
    feed_days: int = 0,
    total: int = 0,
    denominator: int = 0,
    explicit_en: int = 0,
    explicit_fr: int = 0,
    undetermined: int = 0,
) -> AlertLanguageCoverageCounts:
    return AlertLanguageCoverageCounts(
        feed_observation_days=feed_days,
        alert_observation_count=total,
        denominator=denominator,
        explicit_en_count=explicit_en,
        explicit_fr_count=explicit_fr,
        undetermined_count=undetermined,
    )


def test_available_measurement_uses_explicit_and_all_alert_denominators() -> None:
    """Break caught: undetermined rows diluting explicit-language coverage."""

    measurement = build_alert_language_coverage_measurement(
        provider_id="stm",
        provider_timezone="America/Toronto",
        window_days=7,
        window_start=date(2026, 7, 24),
        window_end=date(2026, 7, 30),
        supported=True,
        counts=_counts(
            feed_days=7,
            total=4,
            denominator=3,
            explicit_en=2,
            explicit_fr=3,
            undetermined=1,
        ),
    )

    assert measurement.state == "available"
    assert measurement.denominator == 3
    assert measurement.alert_observation_count == 4
    assert measurement.explicit_en_pct == Decimal("66.67")
    assert measurement.explicit_fr_pct == Decimal("100.00")
    # This percentage intentionally uses all alert observations; the explicit
    # FR/EN denominator above excludes the undetermined third bucket.
    assert measurement.undetermined_pct == Decimal("25.00")


def test_all_undetermined_is_available_with_null_language_coverage() -> None:
    """Break caught: a zero explicit denominator being reported as 0%."""

    measurement = build_alert_language_coverage_measurement(
        provider_id="stm",
        provider_timezone="America/Toronto",
        window_days=30,
        window_start=date(2026, 7, 1),
        window_end=date(2026, 7, 30),
        supported=True,
        counts=_counts(
            feed_days=12,
            total=2,
            denominator=0,
            undetermined=2,
        ),
    )

    assert measurement.state == "available"
    assert measurement.denominator == 0
    assert measurement.explicit_en_pct is None
    assert measurement.explicit_fr_pct is None
    assert measurement.undetermined_pct == Decimal("100.00")


def test_four_states_have_distinct_null_semantics() -> None:
    """Break caught: unsupported, unavailable, and no-alerts collapsing together."""

    common = {
        "provider_id": "p",
        "provider_timezone": "America/Toronto",
        "window_days": 7,
        "window_start": date(2026, 7, 24),
        "window_end": date(2026, 7, 30),
    }
    unsupported = build_alert_language_coverage_measurement(
        **common,
        supported=False,
        counts=_counts(),
    )
    unavailable = build_alert_language_coverage_measurement(
        **common,
        supported=True,
        counts=_counts(),
    )
    no_alerts = build_alert_language_coverage_measurement(
        **common,
        supported=True,
        counts=_counts(feed_days=3),
    )
    available = build_alert_language_coverage_measurement(
        **common,
        supported=True,
        counts=_counts(
            feed_days=3,
            total=1,
            denominator=1,
            explicit_fr=1,
        ),
    )

    assert [
        unsupported.state,
        unavailable.state,
        no_alerts.state,
        available.state,
    ] == ["unsupported", "unavailable", "no-alerts", "available"]
    for measurement in (unsupported, unavailable, no_alerts):
        assert measurement.denominator == 0
        assert measurement.explicit_en_pct is None
        assert measurement.explicit_fr_pct is None
        assert measurement.undetermined_pct is None


class _Result:
    def __init__(self, row: dict[str, int]) -> None:
        self.row = row

    def mappings(self):  # noqa: ANN201
        return self

    def one(self):  # noqa: ANN201
        return self.row


class _Connection:
    def __init__(self, rows: dict[tuple[str, int], dict[str, int]]) -> None:
        self.rows = rows
        self.queries: list[dict[str, object]] = []
        self.retained: list[list[dict[str, object]]] = []

    def execute(self, statement, params=None):  # noqa: ANN001, ANN201
        sql = str(statement)
        if "FROM raw.alert_language_observations" in sql:
            assert isinstance(params, dict)
            self.queries.append(params)
            window_days = (
                params["window_end"] - params["window_start"]
            ).days + 1
            return _Result(self.rows[(str(params["provider_id"]), window_days)])
        if "INSERT INTO core.alert_language_coverage_samples" in sql:
            assert isinstance(params, list)
            self.retained.append(params)
            return _Result({})
        raise AssertionError(f"unexpected SQL: {sql}")


def test_runner_uses_inclusive_provider_local_7_and_30_day_windows() -> None:
    """Break caught: UTC anchoring or an off-by-one trailing window."""

    supported = _manifest("supported", alert_feed=True)
    unsupported = _manifest("unsupported", alert_feed=False)
    connection = _Connection(
        {
            ("supported", 7): {
                "feed_observation_days": 2,
                "alert_observation_count": 0,
                "denominator": 0,
                "explicit_en_count": 0,
                "explicit_fr_count": 0,
                "undetermined_count": 0,
            },
            ("supported", 30): {
                "feed_observation_days": 10,
                "alert_observation_count": 3,
                "denominator": 2,
                "explicit_en_count": 1,
                "explicit_fr_count": 2,
                "undetermined_count": 1,
            },
        }
    )

    # 03:30Z is still July 29 in America/Toronto during EDT.
    receipt = run_alert_language_coverage_measurement(
        connection,
        manifests=[unsupported, supported],
        measured_at_utc=datetime(2026, 7, 30, 3, 30, tzinfo=UTC),
        retain=True,
    )

    assert receipt.measured_at_utc == datetime(2026, 7, 30, 3, 30, tzinfo=UTC)
    assert receipt.retained is True
    assert [
        (
            item.provider_id,
            item.window_days,
            item.window_start.isoformat(),
            item.window_end.isoformat(),
            item.state,
        )
        for item in receipt.measurements
    ] == [
        ("supported", 7, "2026-07-23", "2026-07-29", "no-alerts"),
        ("supported", 30, "2026-06-30", "2026-07-29", "available"),
        ("unsupported", 7, "2026-07-23", "2026-07-29", "unsupported"),
        ("unsupported", 30, "2026-06-30", "2026-07-29", "unsupported"),
    ]
    # Unsupported providers never query observation tables.
    assert len(connection.queries) == 2
    assert all(query["provider_id"] == "supported" for query in connection.queries)
    assert len(connection.retained) == 1
    assert len(connection.retained[0]) == 4


def test_receipt_json_shape_keeps_nulls_and_numeric_percentages() -> None:
    connection = _Connection(
        {
            ("supported", 7): {
                "feed_observation_days": 0,
                "alert_observation_count": 0,
                "denominator": 0,
                "explicit_en_count": 0,
                "explicit_fr_count": 0,
                "undetermined_count": 0,
            },
            ("supported", 30): {
                "feed_observation_days": 1,
                "alert_observation_count": 1,
                "denominator": 1,
                "explicit_en_count": 1,
                "explicit_fr_count": 0,
                "undetermined_count": 0,
            },
        }
    )

    receipt = run_alert_language_coverage_measurement(
        connection,
        manifests=[_manifest("supported", alert_feed=True)],
        measured_at_utc=datetime(2026, 7, 30, 12, tzinfo=UTC),
        retain=False,
    )
    payload = receipt.display_dict()

    assert set(payload) == {"measured_at_utc", "retained", "measurements"}
    assert payload["retained"] is False
    unavailable, available = payload["measurements"]
    assert unavailable["explicit_en_pct"] is None
    assert unavailable["denominator"] == 0
    assert available["explicit_en_pct"] == 100.0
    assert available["explicit_fr_pct"] == 0.0
    assert available["undetermined_pct"] == 0.0
