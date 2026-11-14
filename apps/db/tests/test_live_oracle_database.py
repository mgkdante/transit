import os
from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal

import pytest
import real_db_seed as db_seed
from alembic import command
from sqlalchemy import text
from sqlalchemy.engine import make_url

from transit_ops.db.target_safety import assert_disposable_test_url
from transit_ops.live.oracle.database import OracleDatabaseRefused, PinnedClock, oracle_database

ENVIRONMENT = {"TRANSIT_TEST_DATABASE_DISPOSABLE": "I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE"}


@pytest.mark.parametrize(
    "database",
    [
        "transit_ci_oracle_0123456789abcdef",
        "transit_ci_xdist_0123456789abcdef_gw2",
    ],
)
def test_oracle_names_pass_the_policy_only_for_approved_bases(database):
    assert_disposable_test_url(f"postgresql://transit_ci@localhost/{database}", ENVIRONMENT)


@pytest.mark.parametrize("database", ["other_oracle_0123456789abcdef", "transit_ci_oracle_XYZ"])
def test_unapproved_oracle_names_are_refused(database):
    with pytest.raises(RuntimeError, match="Disposable test database target policy failed"):
        assert_disposable_test_url(f"postgresql://transit_ci@localhost/{database}", ENVIRONMENT)


def test_clock_keeps_microseconds_and_rejects_naive_values():
    instant = datetime(2025, 1, 10, 12, 0, 0, 123456, timezone(timedelta(hours=-5)))
    clock = PinnedClock(instant)
    assert clock.instant == datetime(2025, 1, 10, 17, 0, 0, 123456, UTC)
    with pytest.raises(ValueError, match="aware"):
        clock.set(datetime(2025, 1, 10))
    assert clock.instant.microsecond == 123456
    with pytest.raises(ValueError, match="aware"):
        PinnedClock(datetime(2025, 1, 10))


@pytest.mark.parametrize(
    "url,environment",
    [
        ("postgresql://transit_ci@remote.invalid/transit_ci", ENVIRONMENT),
        ("postgresql://other@localhost/other", ENVIRONMENT),
        ("postgresql://transit_ci@localhost/transit_ci", {}),
    ],
)
def test_a_non_disposable_target_is_refused(url, environment):
    with pytest.raises(OracleDatabaseRefused, match="Disposable test database target policy"):
        with oracle_database(
            url, clock=PinnedClock(datetime(2025, 1, 10, tzinfo=UTC)), environment=environment
        ):
            pytest.fail("refused targets must not yield")


@pytest.fixture
def clock():
    return PinnedClock(datetime(2025, 1, 10, 17, 0, 0, 123456, UTC))


@pytest.fixture
def oracle(real_db_engine, clock):
    with oracle_database(
        real_db_engine.url.render_as_string(hide_password=False),
        clock=clock,
        environment=os.environ,
    ) as engine:
        yield engine


def test_views_follow_the_pinned_clock(oracle, clock, seed_provider):
    with oracle.begin() as conn:
        seed_provider(conn, "oracle_probe", display_name="Oracle probe")
        params = {"p": "oracle_probe", "e": 1, "r": 1, "s": 1, "ts": clock.instant, "n": 1}
        db_seed.feed_endpoints(conn, params)
        db_seed.ingestion_runs(conn, params)
        db_seed.realtime_snapshot_index(conn, params)
        conn.execute(
            text("""
            INSERT INTO gold.latest_trip_delay_snapshot
                (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
                 snapshot_local_date, feed_timestamp_utc, captured_at_utc,
                 start_date, delay_seconds, stop_time_update_count)
            VALUES (:p, :s, 0, 20250110, '2025-01-10', :ts, :ts, '2025-01-10', 120, 1)
        """),
            params,
        )
        assert conn.execute(
            text(
                "SELECT avg_delay_seconds FROM gold.current_trip_delay_computed"
                " WHERE provider_id='oracle_probe'"
            )
        ).scalar_one() == Decimal("120.00")
    clock.set(clock.instant + timedelta(days=3))
    with oracle.connect() as conn:
        assert (
            conn.execute(
                text(
                    "SELECT avg_delay_seconds FROM gold.current_trip_delay_computed"
                    " WHERE provider_id='oracle_probe'"
                )
            ).first()
            is None
        )


def test_builder_sql_and_defaults_read_the_pinned_clock(oracle, clock, seed_provider):
    with oracle.begin() as conn:
        keywords = conn.execute(
            text("SELECT CURRENT_DATE, CURRENT_TIMESTAMP, LOCALTIME, LOCALTIMESTAMP")
        ).one()
        assert keywords[0] != clock.instant.date()
        assert keywords[1] != clock.instant
        assert keywords[2] != clock.instant.time()
        assert keywords[3] != clock.instant.replace(tzinfo=None)
        assert (
            tuple(
                conn.execute(
                    text(
                        "SELECT now(), clock_timestamp(), statement_timestamp(),"
                        " transaction_timestamp()"
                    )
                ).one()
            )
            == (clock.instant,) * 4
        )
        seed_provider(conn, "oracle_probe", display_name="Oracle probe")
        stored = conn.execute(
            text("""
            INSERT INTO gold.realtime_serving_state (provider_id, endpoint_key)
            VALUES ('oracle_probe', 'trip_updates') RETURNING initialized_at_utc
        """)
        ).scalar_one()
        assert stored == clock.instant
    clock.set(clock.instant + timedelta(seconds=1))
    with oracle.connect() as conn:
        assert conn.execute(text("SELECT now()")).scalar_one() == clock.instant


def test_feed_freshness_age_is_measured_from_the_pinned_clock(oracle, clock, seed_provider):
    with oracle.begin() as conn:
        seed_provider(conn, "oracle_probe", display_name="Oracle probe")
        params = {
            "p": "oracle_probe",
            "e": 1,
            "r": 1,
            "completed": clock.instant - timedelta(seconds=90.4),
        }
        db_seed.feed_endpoints(conn, params)
        db_seed.ingestion_runs(conn, params, completed_at_utc=":completed")
        assert (
            conn.execute(
                text(
                    "SELECT completed_age_seconds FROM gold.feed_freshness_current"
                    " WHERE provider_id='oracle_probe'"
                )
            ).scalar_one()
            == 90
        )


@pytest.mark.parametrize("fail", [False, True])
def test_the_oracle_database_is_dropped_on_exit_and_on_failure(real_db_engine, clock, fail):
    name = None
    try:
        with oracle_database(
            real_db_engine.url.render_as_string(hide_password=False),
            clock=clock,
            environment=os.environ,
        ) as engine:
            name = engine.url.database
            with real_db_engine.connect() as conn:
                assert (
                    conn.execute(
                        text("SELECT datname FROM pg_database WHERE datname=:name"), {"name": name}
                    ).scalar_one()
                    == name
                )
            if fail:
                raise ValueError("body failed")
    except ValueError as error:
        assert fail and str(error) == "body failed"
    with real_db_engine.connect() as conn:
        assert name is not None
        assert (
            conn.execute(
                text("SELECT datname FROM pg_database WHERE datname=:name"), {"name": name}
            ).first()
            is None
        )


def test_migration_failure_drops_the_created_database(real_db_engine, clock, monkeypatch):
    names = []

    def fail_upgrade(config, revision):
        names.append(make_url(config.get_main_option("sqlalchemy.url")).database)
        raise RuntimeError("migration failed")

    monkeypatch.setattr(command, "upgrade", fail_upgrade)
    with pytest.raises(RuntimeError, match="migration failed"):
        with oracle_database(
            real_db_engine.url.render_as_string(hide_password=False),
            clock=clock,
            environment=os.environ,
        ):
            pytest.fail("failed migration must not yield")
    with real_db_engine.connect() as conn:
        assert names
        assert (
            conn.execute(
                text("SELECT datname FROM pg_database WHERE datname=:name"), {"name": names[0]}
            ).first()
            is None
        )
