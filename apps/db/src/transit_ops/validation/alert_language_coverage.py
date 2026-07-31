"""Measure explicit alert-language coverage from pre-coalescing observations."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.engine import Connection

from transit_ops.core.models import FeedKind, ProviderManifest

AlertLanguageCoverageState = Literal[
    "available",
    "no-alerts",
    "unavailable",
    "unsupported",
]
MEASUREMENT_WINDOWS = (7, 30)

_COVERAGE_COUNTS_SQL = text(
    """
    WITH alert_counts AS (
        SELECT
            count(*)::integer AS alert_observation_count,
            count(*) FILTER (WHERE NOT undetermined)::integer AS denominator,
            count(*) FILTER (WHERE has_explicit_en)::integer AS explicit_en_count,
            count(*) FILTER (WHERE has_explicit_fr)::integer AS explicit_fr_count,
            count(*) FILTER (WHERE undetermined)::integer AS undetermined_count
        FROM raw.alert_language_observations
        WHERE provider_id = :provider_id
          AND observation_date BETWEEN :window_start AND :window_end
    ),
    feed_counts AS (
        SELECT count(*)::integer AS feed_observation_days
        FROM raw.alert_feed_observations
        WHERE provider_id = :provider_id
          AND observation_date BETWEEN :window_start AND :window_end
    )
    SELECT
        feed_counts.feed_observation_days,
        alert_counts.alert_observation_count,
        alert_counts.denominator,
        alert_counts.explicit_en_count,
        alert_counts.explicit_fr_count,
        alert_counts.undetermined_count
    FROM alert_counts
    CROSS JOIN feed_counts
    """
)

_UPSERT_COVERAGE_SAMPLES = text(
    """
    INSERT INTO core.alert_language_coverage_samples (
        provider_id,
        measurement_date,
        window_days,
        window_start,
        window_end,
        state,
        explicit_en_pct,
        explicit_fr_pct,
        undetermined_pct,
        denominator,
        alert_observation_count,
        feed_observation_days,
        measured_at_utc
    )
    VALUES (
        :provider_id,
        :measurement_date,
        :window_days,
        :window_start,
        :window_end,
        :state,
        :explicit_en_pct,
        :explicit_fr_pct,
        :undetermined_pct,
        :denominator,
        :alert_observation_count,
        :feed_observation_days,
        :measured_at_utc
    )
    ON CONFLICT (provider_id, measurement_date, window_days)
    DO UPDATE SET
        window_start = excluded.window_start,
        window_end = excluded.window_end,
        state = excluded.state,
        explicit_en_pct = excluded.explicit_en_pct,
        explicit_fr_pct = excluded.explicit_fr_pct,
        undetermined_pct = excluded.undetermined_pct,
        denominator = excluded.denominator,
        alert_observation_count = excluded.alert_observation_count,
        feed_observation_days = excluded.feed_observation_days,
        measured_at_utc = excluded.measured_at_utc
    WHERE excluded.measured_at_utc
          >= alert_language_coverage_samples.measured_at_utc
    """
)


@dataclass(frozen=True)
class AlertLanguageCoverageCounts:
    feed_observation_days: int
    alert_observation_count: int
    denominator: int
    explicit_en_count: int
    explicit_fr_count: int
    undetermined_count: int


@dataclass(frozen=True)
class AlertLanguageCoverageMeasurement:
    provider_id: str
    provider_timezone: str
    window_days: int
    window_start: date
    window_end: date
    state: AlertLanguageCoverageState
    explicit_en_pct: Decimal | None
    explicit_fr_pct: Decimal | None
    undetermined_pct: Decimal | None
    denominator: int
    alert_observation_count: int
    feed_observation_days: int

    def display_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["window_start"] = self.window_start.isoformat()
        payload["window_end"] = self.window_end.isoformat()
        for key in (
            "explicit_en_pct",
            "explicit_fr_pct",
            "undetermined_pct",
        ):
            value = payload[key]
            payload[key] = float(value) if isinstance(value, Decimal) else None
        return payload

    def retention_params(self, *, measured_at_utc: datetime) -> dict[str, object]:
        payload = asdict(self)
        payload["measurement_date"] = self.window_end
        payload["measured_at_utc"] = measured_at_utc
        payload.pop("provider_timezone")
        return payload


@dataclass(frozen=True)
class AlertLanguageCoverageReceipt:
    measured_at_utc: datetime
    retained: bool
    measurements: list[AlertLanguageCoverageMeasurement]

    def display_dict(self) -> dict[str, object]:
        measured_at = self.measured_at_utc.astimezone(UTC)
        return {
            "measured_at_utc": measured_at.isoformat().replace("+00:00", "Z"),
            "retained": self.retained,
            "measurements": [
                measurement.display_dict() for measurement in self.measurements
            ],
        }


# LATER additive-only DataHealth mapping (D2 designs this; it does not publish it):
#
#   DataHealth.alert_language_coverage: optional list[AlertLanguageCoverage]
#   provider_id / provider_timezone / window_days / window_start / window_end
#       map directly from each retained measurement row.
#   state:
#       unsupported = no alert feed in the provider registry
#       unavailable = feed configured, no feed observations in the window
#       no-alerts   = feed observations exist, zero alert observations
#       available   = at least one alert observation
#   explicit_en_pct / explicit_fr_pct:
#       nullable; denominator excludes undetermined observations. A zero
#       denominator is None, never a fabricated 0%.
#   undetermined_pct:
#       nullable only when there are no alert observations; otherwise uses all
#       alert observations so a 100% untagged window remains visible.
#   denominator:
#       count of observations with at least one explicit FR or EN tag.
#
# The whole block must remain optional when a later slice adds it to DataHealth:
# absence means "payload predates this additive field", while the explicit state
# values above carry current measurement availability. No lane row or heartbeat
# is fabricated in this slice, and snapshots/contract.py stays unchanged.


def _percentage(numerator: int, denominator: int) -> Decimal | None:
    if denominator == 0:
        return None
    return (
        Decimal(numerator * 100) / Decimal(denominator)
    ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _validate_counts(counts: AlertLanguageCoverageCounts) -> None:
    values = asdict(counts)
    if any(value < 0 for value in values.values()):
        raise ValueError("alert-language coverage counts cannot be negative")
    if counts.denominator + counts.undetermined_count != counts.alert_observation_count:
        raise ValueError(
            "determined and undetermined counts must partition alert observations"
        )
    if (
        counts.explicit_en_count > counts.denominator
        or counts.explicit_fr_count > counts.denominator
    ):
        raise ValueError("explicit language counts cannot exceed the denominator")


def build_alert_language_coverage_measurement(
    *,
    provider_id: str,
    provider_timezone: str,
    window_days: int,
    window_start: date,
    window_end: date,
    supported: bool,
    counts: AlertLanguageCoverageCounts,
) -> AlertLanguageCoverageMeasurement:
    if window_days not in MEASUREMENT_WINDOWS:
        raise ValueError(f"window_days must be one of {MEASUREMENT_WINDOWS}")
    if window_end - window_start != timedelta(days=window_days - 1):
        raise ValueError("coverage window must be inclusive and exactly window_days long")
    _validate_counts(counts)

    if not supported:
        state: AlertLanguageCoverageState = "unsupported"
    elif counts.feed_observation_days == 0:
        state = "unavailable"
    elif counts.alert_observation_count == 0:
        state = "no-alerts"
    else:
        state = "available"

    if state != "available":
        explicit_en_pct = None
        explicit_fr_pct = None
        undetermined_pct = None
    else:
        explicit_en_pct = _percentage(
            counts.explicit_en_count,
            counts.denominator,
        )
        explicit_fr_pct = _percentage(
            counts.explicit_fr_count,
            counts.denominator,
        )
        undetermined_pct = _percentage(
            counts.undetermined_count,
            counts.alert_observation_count,
        )

    return AlertLanguageCoverageMeasurement(
        provider_id=provider_id,
        provider_timezone=provider_timezone,
        window_days=window_days,
        window_start=window_start,
        window_end=window_end,
        state=state,
        explicit_en_pct=explicit_en_pct,
        explicit_fr_pct=explicit_fr_pct,
        undetermined_pct=undetermined_pct,
        denominator=counts.denominator if supported else 0,
        alert_observation_count=(
            counts.alert_observation_count if supported else 0
        ),
        feed_observation_days=counts.feed_observation_days if supported else 0,
    )


def _supports_alert_measurement(manifest: ProviderManifest) -> bool:
    return any(
        feed_kind.value in manifest.feeds
        for feed_kind in (FeedKind.I3_ALERTS, FeedKind.SERVICE_ALERTS)
    )


def _read_counts(
    connection: Connection,
    *,
    provider_id: str,
    window_start: date,
    window_end: date,
) -> AlertLanguageCoverageCounts:
    row = connection.execute(
        _COVERAGE_COUNTS_SQL,
        {
            "provider_id": provider_id,
            "window_start": window_start,
            "window_end": window_end,
        },
    ).mappings().one()
    return AlertLanguageCoverageCounts(
        feed_observation_days=int(row["feed_observation_days"]),
        alert_observation_count=int(row["alert_observation_count"]),
        denominator=int(row["denominator"]),
        explicit_en_count=int(row["explicit_en_count"]),
        explicit_fr_count=int(row["explicit_fr_count"]),
        undetermined_count=int(row["undetermined_count"]),
    )


def run_alert_language_coverage_measurement(
    connection: Connection,
    *,
    manifests: list[ProviderManifest],
    measured_at_utc: datetime,
    retain: bool = False,
) -> AlertLanguageCoverageReceipt:
    """Measure all registry providers and optionally retain daily receipt rows."""

    if measured_at_utc.utcoffset() is None:
        raise ValueError("measured_at_utc must be timezone-aware")
    measured_at_utc = measured_at_utc.astimezone(UTC)
    measurements: list[AlertLanguageCoverageMeasurement] = []

    for manifest in sorted(
        manifests,
        key=lambda item: item.provider.provider_id,
    ):
        provider_id = manifest.provider.provider_id
        provider_timezone = manifest.provider.timezone
        window_end = measured_at_utc.astimezone(
            ZoneInfo(provider_timezone)
        ).date()
        supported = _supports_alert_measurement(manifest)
        for window_days in MEASUREMENT_WINDOWS:
            window_start = window_end - timedelta(days=window_days - 1)
            counts = (
                _read_counts(
                    connection,
                    provider_id=provider_id,
                    window_start=window_start,
                    window_end=window_end,
                )
                if supported
                else AlertLanguageCoverageCounts(0, 0, 0, 0, 0, 0)
            )
            measurements.append(
                build_alert_language_coverage_measurement(
                    provider_id=provider_id,
                    provider_timezone=provider_timezone,
                    window_days=window_days,
                    window_start=window_start,
                    window_end=window_end,
                    supported=supported,
                    counts=counts,
                )
            )

    if retain and measurements:
        connection.execute(
            _UPSERT_COVERAGE_SAMPLES,
            [
                measurement.retention_params(
                    measured_at_utc=measured_at_utc
                )
                for measurement in measurements
            ],
        )

    return AlertLanguageCoverageReceipt(
        measured_at_utc=measured_at_utc,
        retained=retain,
        measurements=measurements,
    )
