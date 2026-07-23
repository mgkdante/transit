"""Real-database regression tests for core.snapshot_publish_state (slice-9.1.1r).

These exercise the actual Postgres constraints that fake-connection tests
structurally cannot see — the (provider_id, tier) PK + ON CONFLICT upsert, the
FK to core.providers, and the tier CHECK — plus build_manifest reading real
tier-state rows.

They run ONLY when TRANSIT_TEST_DATABASE_URL points at a disposable Postgres
with the transit schema applied and migration 0042 present, e.g. a throwaway
local cluster restored from ``pg_dump --schema-only`` of prod then
``alembic upgrade head`` (which applies 0042 on top). Each test runs inside one
transaction and rolls back — nothing persists, reruns are idempotent.

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://repro@:55432/transit_repro?host=/tmp/snaprepro" \
        uv run pytest tests/test_snapshots_real_db_state.py -v

Never point this at production. (CI has no Postgres — skipped there.)
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from transit_ops.snapshots import builders
from transit_ops.snapshots.publish import _prior_files_total, _record_publish_state

PROVIDER = "stm_snapstate_test"
T1 = datetime(2026, 6, 1, 0, 0, tzinfo=UTC)
T2 = datetime(2026, 6, 13, 0, 0, tzinfo=UTC)


@pytest.fixture()
def conn(real_db_engine, seed_provider):  # noqa: ANN001
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        seed_provider(connection, PROVIDER, display_name="STM snapshot-state regression")
        try:
            yield connection
        finally:
            transaction.rollback()


def _state_rows(connection) -> list[dict]:
    return [
        dict(row)
        for row in connection.execute(
            text(
                """
                SELECT provider_id, tier, generated_utc, files_written,
                       files_skipped, files_total, stable_files_total, updated_at_utc
                FROM core.snapshot_publish_state
                WHERE provider_id = :p
                ORDER BY tier
                """
            ),
            {"p": PROVIDER},
        ).mappings()
    ]


def test_state_upsert_is_idempotent(conn) -> None:
    """Calling _record_publish_state twice on (provider, tier) leaves one row;
    the second call's values win and updated_at_utc advances."""
    _record_publish_state(
        conn,
        provider_id=PROVIDER,
        tier="static",
        generated_utc=T1,
        written=9300,
        skipped=0,
        total=9300,
    )
    first = _state_rows(conn)
    assert len(first) == 1
    assert first[0]["files_written"] == 9300
    assert first[0]["stable_files_total"] == 9300
    first_updated = first[0]["updated_at_utc"]

    _record_publish_state(
        conn,
        provider_id=PROVIDER,
        tier="static",
        generated_utc=T2,
        written=20,
        skipped=9280,
        total=9300,
    )
    rows = _state_rows(conn)
    assert len(rows) == 1, "upsert must not insert a second row"
    assert rows[0]["files_written"] == 20
    assert rows[0]["files_skipped"] == 9280
    assert rows[0]["generated_utc"] == T2
    assert rows[0]["stable_files_total"] == 9300
    assert rows[0]["updated_at_utc"] >= first_updated


def test_state_fk_rejects_unknown_provider(conn) -> None:
    """A row for a provider absent from core.providers violates the FK."""
    from sqlalchemy.exc import IntegrityError

    with pytest.raises(IntegrityError):
        _record_publish_state(
            conn,
            provider_id="ghost_provider",
            tier="static",
            generated_utc=T1,
            written=0,
            skipped=0,
            total=0,
        )


def test_tier_check_constraint(conn) -> None:
    """tier outside {live,static,historic} violates the CHECK constraint."""
    from sqlalchemy.exc import IntegrityError

    with pytest.raises(IntegrityError):
        _record_publish_state(
            conn,
            provider_id=PROVIDER,
            tier="bogus",
            generated_utc=T1,
            written=0,
            skipped=0,
            total=0,
        )


def test_build_manifest_reads_tier_state(conn) -> None:
    """build_manifest fills files.static/historic generated_utc from the table."""
    _record_publish_state(
        conn,
        provider_id=PROVIDER,
        tier="static",
        generated_utc=T1,
        written=10,
        skipped=0,
        total=10,
    )
    _record_publish_state(
        conn,
        provider_id=PROVIDER,
        tier="historic",
        generated_utc=T2,
        written=5,
        skipped=0,
        total=5,
    )

    class _Settings:
        SNAPSHOT_PUBLIC_BASE_URL = "https://data.example.com"

    manifest = builders.build_manifest(
        conn, provider_id=PROVIDER, generated_utc="2026-06-13T12:00:00Z", settings=_Settings()
    )
    assert manifest.files.static.generated_utc == "2026-06-01T00:00:00Z"
    assert manifest.files.historic.generated_utc == "2026-06-13T00:00:00Z"
    assert manifest.basemap is None  # no PMTILES URL configured


def test_historic_state_tracks_physical_and_stable_totals_separately(conn) -> None:
    _record_publish_state(
        conn,
        provider_id=PROVIDER,
        tier="historic",
        generated_utc=T2,
        written=14,
        skipped=3,
        total=17,
        stable_total=12,
    )

    row = _state_rows(conn)[0]
    assert row["files_total"] == 17
    assert row["stable_files_total"] == 12
    assert _prior_files_total(conn, provider_id=PROVIDER, tier="historic") == 12


def test_pre_0081_null_stable_total_falls_back_to_physical_total(conn) -> None:
    conn.execute(
        text(
            """
            INSERT INTO core.snapshot_publish_state
                (provider_id, tier, generated_utc, files_written, files_skipped, files_total)
            VALUES (:provider, 'historic', :generated, 7, 2, 9)
            """
        ),
        {"provider": PROVIDER, "generated": T1},
    )

    row = _state_rows(conn)[0]
    assert row["stable_files_total"] is None
    assert _prior_files_total(conn, provider_id=PROVIDER, tier="historic") == 9
