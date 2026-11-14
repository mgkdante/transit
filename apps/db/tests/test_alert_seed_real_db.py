import json
from datetime import UTC, date, datetime

import pytest
import test_i3_real_db_regression as fixture
from sqlalchemy import text

from transit_ops.static import alert_seed as seeds

BIG = 9007199254740993
AT = "2026-06-10T08:30:00.123456+05:30"


def query(pg, sql, **params):
    return pg.execute(text(sql), params)


@pytest.fixture()
def exported(real_db_engine, seed_provider, monkeypatch):
    monkeypatch.setattr(fixture, "SNAP_IDS", (BIG, *fixture.SNAP_IDS[1:]))
    monkeypatch.setitem(fixture.SNAP_TIMES, BIG, datetime.fromisoformat(AT))
    with real_db_engine.connect() as pg, pg.begin():
        query(pg, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        fixture._seed(pg, seed_provider)
        alert = fixture.ALERT_A | {"extra": {"é": "雪"}}
        future = alert | {"id": "future", "activePeriods": [{"start": "2099-01-01T00:00:00Z"}]}
        expired = alert | {"id": "expired", "activePeriods": [{"end": "2000-01-01T00:00:00Z"}]}
        fixture._load(pg, BIG, [alert, future, expired, alert | {"id": "superseded"}])
        changed = alert | {"routes": ["changed"], "stops": ["changed", "changed2", "new"]}
        fixture._load(pg, fixture.SNAP_IDS[1], [changed, future, expired])
        query(
            pg,
            "UPDATE silver.i3_alerts SET url='', url_en=NULL WHERE provider_id=:p",
            p=fixture.PROVIDER,
        )
        query(pg, "SET TRANSACTION READ ONLY")
        yield pg, seeds.read_alert_seed(pg, provider_id=fixture.PROVIDER)
        pg.rollback()


def ordered(rows):
    return sorted(json.dumps(row, sort_keys=True) for row in rows)


def value(v):
    if isinstance(v, datetime):
        return v.astimezone(UTC).isoformat(timespec="microseconds")
    return v.isoformat() if isinstance(v, date) else v


def expected_rows(pg, name, scope):
    schema, table = name.split(".")
    columns = query(
        pg,
        "SELECT column_name, data_type FROM information_schema.columns "
        "WHERE table_schema=:s AND table_name=:t ORDER BY ordinal_position",
        s=schema,
        t=table,
    ).all()
    fields = ", ".join(f'"{c}"::text AS "{c}"' if k == "jsonb" else f'"{c}"' for c, k in columns)
    return [
        {c: value(v) for c, v in r.items()}
        for r in query(
            pg, f"SELECT {fields} FROM {name} WHERE {scope}", p=fixture.PROVIDER
        ).mappings()
    ]


def test_complete_scope_and_postgres_special_values(exported):
    pg, seed = exported
    active = (
        "SELECT i3_alert_snapshot_id, alert_index FROM silver.i3_alerts "
        "WHERE provider_id=:p AND valid_to IS NULL"
    )
    refs = (
        "SELECT message_snapshot_id FROM silver.i3_alerts WHERE provider_id=:p AND valid_to IS NULL"
    )
    scopes = [
        "provider_id=:p AND valid_to IS NULL",
        f"(i3_alert_snapshot_id, alert_index) IN ({active})",
        f"(i3_alert_snapshot_id, alert_index) IN ({active})",
        "provider_id=:p",
        "provider_id=:p",
        f"i3_alert_snapshot_id IN (SELECT i3_alert_snapshot_id FROM ({active}) a UNION {refs})",
    ]
    for name, scope in zip(seeds.TABLES, scopes, strict=True):
        expected = expected_rows(pg, name, scope)
        assert ordered(seed.tables[name].rows) == ordered(expected)
    assert seeds.AlertSeed.from_json(seed.to_json()) == seed
    alerts = seed.tables[seeds.TABLES[0]].rows
    assert {r["alert_id"] for r in alerts} == {"ALERT-A", "future", "expired"}
    assert all(
        r["i3_alert_snapshot_id"] == BIG and r["url"] == "" and r["url_en"] is None for r in alerts
    )
    assert alerts[0]["captured_at_utc"] == "2026-06-10T03:00:00.123456+00:00"
    assert any("雪" in r["raw_alert_json"] for r in alerts)
    entities = seed.tables[seeds.TABLES[1]].rows
    expected_entities = {("51", "S100"), ("51", "S101"), ("changed", "new")}
    assert {
        (r["route_id"], r["stop_id"]) for r in entities if r["alert_index"] == 0
    } == expected_entities
    floor = query(pg, "SELECT max(i3_alert_snapshot_id) FROM raw.i3_alert_snapshots").scalar_one()
    assert seed.global_max_snapshot_id == floor and floor >= BIG
    assert seeds.read_alert_seed(pg, provider_id="empty_seed_test").global_max_snapshot_id == floor


def test_autocommit_refused_by_postgres(real_db_engine):
    prefix = "SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL "
    with real_db_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as pg:
        query(pg, prefix + "REPEATABLE READ, READ ONLY")
        try:
            with pytest.raises(seeds.AlertSeedReadRefused):
                seeds.read_alert_seed(pg, provider_id="test")
        finally:
            query(pg, prefix + "READ COMMITTED, READ WRITE")


def test_concurrent_writer_cannot_change_export_snapshot(real_db_engine, seed_provider):
    provider = "alert_seed_writer_test"
    with real_db_engine.begin() as writer:
        seed_provider(writer, provider, display_name="Disposable seed writer")
        query(
            writer,
            "INSERT INTO raw.alert_feed_observations VALUES (:p, current_date, 1, now())",
            p=provider,
        )
    try:
        with real_db_engine.connect() as pg, pg.begin():
            query(pg, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            before = seeds.read_alert_seed(pg, provider_id=provider)
            with real_db_engine.begin() as writer:
                query(
                    writer,
                    "UPDATE raw.alert_feed_observations SET alert_count=2 WHERE provider_id=:p",
                    p=provider,
                )
            assert seeds.read_alert_seed(pg, provider_id=provider) == before
        with real_db_engine.connect() as pg, pg.begin():
            query(pg, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            after = seeds.read_alert_seed(pg, provider_id=provider)
            assert after.tables[seeds.TABLES[3]].rows[0]["alert_count"] == 2
    finally:
        with real_db_engine.begin() as writer:
            query(
                writer, "DELETE FROM raw.alert_feed_observations WHERE provider_id=:p", p=provider
            )
            query(writer, "DELETE FROM core.providers WHERE provider_id=:p", p=provider)
