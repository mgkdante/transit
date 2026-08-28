"""Contract tests for the forward OTP observation-universe repair."""

from __future__ import annotations

import importlib.util
import inspect
from pathlib import Path

import pytest


def _load():
    path = (
        Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0085_repair_otp_count_universe.py"
    )
    spec = importlib.util.spec_from_file_location("m0085", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_0085_repairs_the_source_then_its_hourly_projection() -> None:
    migration = _load()

    assert migration.revision == "0085_repair_otp_count_universe"
    assert len(migration.revision) <= 32
    assert migration.down_revision == "0084_alert_language_coverage"
    assert "UPDATE gold.trip_delay_summary_5m" in migration._REPAIR_5M_OBSERVATION_UNIVERSE
    assert "UPDATE gold.route_delay_hourly" in migration._REPAIR_HOURLY_OBSERVATION_UNIVERSE
    for sql in (
        migration._REPAIR_5M_OBSERVATION_UNIVERSE,
        migration._REPAIR_HOURLY_OBSERVATION_UNIVERSE,
    ):
        assert "delay_observation_count = on_time_observation_count" in sql
        assert "on_time_observation_count > delay_observation_count" in sql

    source = inspect.getsource(migration.upgrade)
    assert source.find("_REPAIR_5M_OBSERVATION_UNIVERSE") < source.find(
        "_REPAIR_HOURLY_OBSERVATION_UNIVERSE"
    )


def test_0085_refuses_lossy_downgrade() -> None:
    migration = _load()

    with pytest.raises(NotImplementedError):
        migration.downgrade()
