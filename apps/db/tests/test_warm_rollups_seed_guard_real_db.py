"""Real-database regression tests for the unseeded-provider seed guard.

slice-9.8 reliability: PR #124 enrolled octranspo + sto (provider YAML manifests),
so ``list-providers`` returns them — but their static pipeline never ran in prod,
so there is no ``gold.dim_provider`` row (the view over ``core.providers``). The
Daily Warm Rollups workflow loops ``build-warm-rollups`` over EVERY enrolled
provider under ``set -e``; ``build_warm_rollups`` opened with a ``dp.timezone``
calendar read via ``.scalar_one()`` → ``NoResultFound`` → exit 1 → the whole
all-providers job aborted before stm ran (incident #133).

These tests exercise the ACTUAL ``gold.dim_provider`` view + the guard against a
migrated schema (a FakeConnection cannot prove the view semantics). They run ONLY
when TRANSIT_TEST_DATABASE_URL points at a disposable Postgres with the transit
schema applied (alembic upgrade head). CI has no Postgres; this file is
local-only. Never point this at production.

Each test runs inside one transaction and rolls back — nothing persists.
"""

from __future__ import annotations

import os
from contextlib import contextmanager

import pytest
from sqlalchemy import create_engine, text

from transit_ops.gold.rollups import build_warm_rollups, provider_is_seeded

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set — real-DB regression tests skipped",
)

# An enrolled-but-unseeded provider: it has NO core.providers row, so the
# gold.dim_provider view yields no row for it (the exact prod state of octranspo/sto).
UNSEEDED_PROVIDER = "octranspo_seedguard_test"
# A seeded provider: a core.providers row exists → dim_provider view has a row.
SEEDED_PROVIDER = "stm_seedguard_test"


class _TxEngine:
    """Wraps one rolled-back connection so build_warm_rollups' engine.begin()
    blocks join the test's outer transaction instead of committing.

    Each engine.begin() yields the SAME connection inside a SAVEPOINT, so the
    real per-block commits stay nested within the outer transaction the fixture
    rolls back. The Engine overload of provider_is_seeded calls .connect(), which
    must also yield the same connection (without closing it)."""

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
def conn():
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        # Seed ONLY the seeded provider into core.providers (→ dim_provider view).
        connection.execute(
            text(
                """
                INSERT INTO core.providers
                    (provider_id, display_name, timezone, provider_key)
                VALUES (:p, 'STM seed-guard regression', 'America/Toronto', :p)
                """
            ),
            {"p": SEEDED_PROVIDER},
        )
        try:
            yield connection
        finally:
            transaction.rollback()
        engine.dispose()


def test_provider_is_seeded_reflects_dim_provider_view(conn) -> None:
    # No core.providers row → no dim_provider view row → not seeded.
    assert provider_is_seeded(conn, UNSEEDED_PROVIDER) is False
    # core.providers row present → dim_provider view row → seeded.
    assert provider_is_seeded(conn, SEEDED_PROVIDER) is True


def test_provider_is_seeded_engine_overload_for_absent_provider() -> None:
    """The Engine overload opens its own short-lived connection (the publish-all
    path). For a provider with no core.providers row it returns False without
    raising — read-only, so no fixture transaction is needed."""
    engine = create_engine(DB_URL)
    try:
        assert provider_is_seeded(engine, UNSEEDED_PROVIDER) is False
    finally:
        engine.dispose()


def test_build_warm_rollups_skips_unseeded_provider_without_noresultfound(conn) -> None:
    """The crash-site regression: an unseeded provider must NOT raise
    NoResultFound on the dp.timezone calendar read — it returns a skipped result."""
    result = build_warm_rollups(UNSEEDED_PROVIDER, engine=_TxEngine(conn))

    assert result.skipped_not_seeded is True
    assert result.provider_id == UNSEEDED_PROVIDER
    assert result.built_trip_delay_periods == 0
    assert result.reporting_aggregate_row_counts == {}


def test_build_warm_rollups_runs_for_seeded_provider(conn) -> None:
    """Regression guard: a seeded provider is NOT skipped — it proceeds through
    the calendar read and the reporting-aggregate rebuild (empty facts → 0 built,
    but the marts are refreshed, proving the full path ran)."""
    result = build_warm_rollups(SEEDED_PROVIDER, engine=_TxEngine(conn))

    assert result.skipped_not_seeded is False
    assert result.provider_id == SEEDED_PROVIDER
    # No facts seeded → nothing built, but the reporting-aggregate rebuild ran
    # (the DELETE+UPSERT registry executed), proving the guard was a pass-through.
    assert result.reporting_aggregate_row_counts != {}
