
from __future__ import annotations

from contextlib import contextmanager

import pytest

from transit_ops.gold.rollups import build_warm_rollups, provider_is_seeded

UNSEEDED_PROVIDER = "octranspo_seedguard_test"
SEEDED_PROVIDER = "stm_seedguard_test"


class _TxEngine:

    def __init__(self, connection) -> None:  # noqa: ANN001
        self._connection = connection

    @contextmanager
    def begin(self):
        nested = self._connection.begin_nested()
        try:
            yield self._connection
            nested.commit()
        except Exception:
            nested.rollback()
            raise

    @contextmanager
    def connect(self):
        yield self._connection


@pytest.fixture()
def conn(real_db_engine, seed_provider):  # noqa: ANN001
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        seed_provider(
            connection,
            SEEDED_PROVIDER,
            display_name="STM seed-guard regression",
        )
        try:
            yield connection
        finally:
            transaction.rollback()


def test_provider_is_seeded_reflects_dim_provider_view(conn) -> None:
    assert provider_is_seeded(conn, UNSEEDED_PROVIDER) is False
    assert provider_is_seeded(conn, SEEDED_PROVIDER) is True


def test_provider_is_seeded_engine_overload_for_absent_provider(real_db_engine) -> None:  # noqa: ANN001
    assert provider_is_seeded(real_db_engine, UNSEEDED_PROVIDER) is False


def test_build_warm_rollups_skips_unseeded_provider_without_noresultfound(conn) -> None:
    result = build_warm_rollups(UNSEEDED_PROVIDER, engine=_TxEngine(conn))

    assert result.skipped_not_seeded is True
    assert result.provider_id == UNSEEDED_PROVIDER
    assert result.built_trip_delay_periods == 0
    assert result.reporting_aggregate_row_counts == {}


def test_build_warm_rollups_runs_for_seeded_provider(conn) -> None:
    result = build_warm_rollups(SEEDED_PROVIDER, engine=_TxEngine(conn))

    assert result.skipped_not_seeded is False
    assert result.provider_id == SEEDED_PROVIDER
    assert result.reporting_aggregate_row_counts != {}
