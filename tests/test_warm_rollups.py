from __future__ import annotations

from contextlib import contextmanager
from datetime import UTC, datetime

from transit_ops.gold.rollups import WarmRollupBuildResult, build_warm_rollups
from transit_ops.maintenance import WarmRollupStoragePruneResult, prune_warm_rollup_storage
from transit_ops.settings import Settings


class RowcountResult:
    def __init__(self, rowcount: int) -> None:
        self.rowcount = rowcount


class IterableResult:
    def __init__(self, rows: list) -> None:
        self.rows = rows
        self.rowcount = len(rows)

    def fetchall(self) -> list:
        return self.rows


class FakeRow:
    def __init__(self, period_start_utc: datetime) -> None:
        self.period_start_utc = period_start_utc


class FakeConnection:
    def __init__(
        self,
        vehicle_periods: list[datetime] | None = None,
        trip_delay_periods: list[datetime] | None = None,
    ) -> None:
        self.vehicle_periods = vehicle_periods or []
        self.trip_delay_periods = trip_delay_periods or []
        self.executed: list[str] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        sql = str(statement)
        self.executed.append(sql)

        if "fact_vehicle_snapshot" in sql and "warm_rollup_periods" in sql and "NOT IN" in sql:
            return IterableResult([FakeRow(p) for p in self.vehicle_periods])

        if "fact_trip_delay_snapshot" in sql and "warm_rollup_periods" in sql and "NOT IN" in sql:
            return IterableResult([FakeRow(p) for p in self.trip_delay_periods])

        if "INSERT INTO gold.vehicle_summary_5m" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.trip_delay_summary_5m" in sql:
            return RowcountResult(1)

        if "INSERT INTO gold.warm_rollup_periods" in sql:
            return RowcountResult(1)

        if "DELETE FROM gold.vehicle_summary_5m" in sql:
            return RowcountResult(5)

        if "DELETE FROM gold.trip_delay_summary_5m" in sql:
            return RowcountResult(3)

        if "DELETE FROM gold.warm_rollup_periods" in sql:
            return RowcountResult(8)

        return RowcountResult(0)


class FakeEngine:
    def __init__(self, connection: FakeConnection) -> None:
        self._connection = connection

    @contextmanager
    def begin(self):
        yield self._connection


def _fake_settings(**kwargs) -> Settings:
    defaults = {
        "NEON_DATABASE_URL": None,
        "GOLD_WARM_ROLLUP_RETENTION_DAYS": 90,
    }
    defaults.update(kwargs)
    return Settings.model_construct(**defaults)


def test_build_vehicle_rollup_inserts_new_periods() -> None:
    periods = [
        datetime(2026, 3, 25, 12, 0, tzinfo=UTC),
        datetime(2026, 3, 25, 12, 5, tzinfo=UTC),
    ]
    conn = FakeConnection(vehicle_periods=periods)
    engine = FakeEngine(conn)

    result = build_warm_rollups("stm", engine=engine)

    assert isinstance(result, WarmRollupBuildResult)
    assert result.provider_id == "stm"
    assert result.built_vehicle_periods == 2
    assert result.built_trip_delay_periods == 0

    vehicle_upserts = [s for s in conn.executed if "INSERT INTO gold.vehicle_summary_5m" in s]
    assert len(vehicle_upserts) == 2

    period_upserts = [s for s in conn.executed if "INSERT INTO gold.warm_rollup_periods" in s]
    assert len(period_upserts) == 2


def test_build_vehicle_rollup_skips_already_built_periods() -> None:
    """Idempotency: no missing periods → 0 built."""
    conn = FakeConnection(vehicle_periods=[], trip_delay_periods=[])
    engine = FakeEngine(conn)

    result = build_warm_rollups("stm", engine=engine)

    assert result.built_vehicle_periods == 0
    assert result.built_trip_delay_periods == 0

    vehicle_upserts = [s for s in conn.executed if "INSERT INTO gold.vehicle_summary_5m" in s]
    assert len(vehicle_upserts) == 0


def test_build_trip_delay_rollup_inserts_new_periods() -> None:
    periods = [
        datetime(2026, 3, 25, 8, 0, tzinfo=UTC),
        datetime(2026, 3, 25, 8, 5, tzinfo=UTC),
        datetime(2026, 3, 25, 8, 10, tzinfo=UTC),
    ]
    conn = FakeConnection(trip_delay_periods=periods)
    engine = FakeEngine(conn)

    result = build_warm_rollups("stm", engine=engine)

    assert result.built_vehicle_periods == 0
    assert result.built_trip_delay_periods == 3

    delay_upserts = [s for s in conn.executed if "INSERT INTO gold.trip_delay_summary_5m" in s]
    assert len(delay_upserts) == 3

    period_upserts = [s for s in conn.executed if "INSERT INTO gold.warm_rollup_periods" in s]
    assert len(period_upserts) == 3


def test_build_warm_rollups_empty_facts_is_noop() -> None:
    conn = FakeConnection()
    engine = FakeEngine(conn)

    result = build_warm_rollups("stm", engine=engine)

    assert result.built_vehicle_periods == 0
    assert result.built_trip_delay_periods == 0
    assert isinstance(result.completed_at_utc, datetime)


def test_build_warm_rollups_result_display_dict() -> None:
    conn = FakeConnection(vehicle_periods=[datetime(2026, 3, 25, 12, 0, tzinfo=UTC)])
    engine = FakeEngine(conn)

    result = build_warm_rollups("stm", engine=engine)
    d = result.display_dict()

    assert d["provider_id"] == "stm"
    assert d["built_vehicle_periods"] == 1
    assert d["since_utc"] is None
    assert "completed_at_utc" in d


def test_prune_warm_rollup_storage_deletes_old_periods() -> None:
    conn = FakeConnection()
    engine = FakeEngine(conn)
    settings = _fake_settings()

    result = prune_warm_rollup_storage("stm", settings=settings, engine=engine)

    assert isinstance(result, WarmRollupStoragePruneResult)
    assert result.provider_id == "stm"
    assert result.retention_days == 90
    assert result.cutoff_utc is not None

    vehicle_deletes = [s for s in conn.executed if "DELETE FROM gold.vehicle_summary_5m" in s]
    assert len(vehicle_deletes) == 1

    delay_deletes = [s for s in conn.executed if "DELETE FROM gold.trip_delay_summary_5m" in s]
    assert len(delay_deletes) == 1

    period_deletes = [s for s in conn.executed if "DELETE FROM gold.warm_rollup_periods" in s]
    assert len(period_deletes) == 1

    assert result.deleted_row_counts["gold.vehicle_summary_5m"] == 5
    assert result.deleted_row_counts["gold.trip_delay_summary_5m"] == 3
    assert result.deleted_row_counts["gold.warm_rollup_periods"] == 8
