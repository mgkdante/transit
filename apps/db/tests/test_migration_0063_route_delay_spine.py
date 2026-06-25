from __future__ import annotations

import importlib.util
from pathlib import Path


def _migration_path() -> Path:
    return (
        Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0063_route_delay_spine.py"
    )


def _source() -> str:
    path = _migration_path()
    assert path.exists(), "expected migration 0063_route_delay_spine.py"
    return path.read_text(encoding="utf-8")


def _load():
    path = _migration_path()
    assert path.exists(), "expected migration 0063_route_delay_spine.py"
    spec = importlib.util.spec_from_file_location("m0063", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_0063_chain() -> None:
    m = _load()

    assert m.revision == "0063_route_delay_spine"
    assert m.down_revision == "0062_rename_misnamed_rolling_tables"
    assert callable(m.upgrade)
    assert callable(m.downgrade)


def test_0063_creates_route_delay_spine_with_finest_grain_pk() -> None:
    src = _source()

    assert '"route_delay_spine"' in src
    assert "pk_gold_route_delay_spine" in src
    assert "fk_gold_route_delay_spine_provider_id" in src
    assert "ix_gold_route_delay_spine_provider_route_date" in src

    # finest-grain hour-grain PK (D1): shift/day_type/dow/week/month derive at read time.
    for col in (
        "provider_id",
        "route_id",
        "service_local_date",
        "hour_of_day_local",
        "direction_id",
    ):
        assert f'"{col}"' in src, f"PK column {col} missing"

    # additive count columns + the separate histogram.
    for col in (
        "observation_count",
        "delay_observation_count",
        "on_time_observation_count",
        "severe_delay_count",
        "sum_delay_seconds",
        "delay_histogram",
    ):
        assert f'"{col}"' in src, f"column {col} missing"

    # delayed_trip_count is COUNT(DISTINCT trip_id) -> NON-additive at hour grain;
    # it must NOT be a spine column (it is read from route_delay_hourly). Correction #2.
    assert '"delayed_trip_count"' not in src
