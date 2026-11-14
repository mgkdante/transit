import pytest
from sqlalchemy import text
from test_i3_real_db_regression import ALERT_A, PROVIDER, SNAP_IDS, _load, _seed

from transit_ops.static.alert_seed import TABLES, AlertSeed, read_alert_seed


@pytest.fixture()
def exported(real_db_engine, seed_provider):
    with real_db_engine.connect() as pg, pg.begin():
        pg.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"))
        _seed(pg, seed_provider)
        future = {**ALERT_A, "id": "future", "activePeriods": [{"start": "2099-01-01T00:00:00Z"}]}
        expired = {**ALERT_A, "id": "expired", "activePeriods": [{"end": "2000-01-01T00:00:00Z"}]}
        _load(pg, SNAP_IDS[0], [ALERT_A, future, expired, {**ALERT_A, "id": "superseded"}])
        changed = {**ALERT_A, "routes": ["changed"], "stops": ["changed", "changed2", "new"]}
        _load(pg, SNAP_IDS[1], [changed, future, expired])
        pg.execute(text("SET TRANSACTION READ ONLY"))
        seed = read_alert_seed(pg, provider_id=PROVIDER)
        assert AlertSeed.from_json(seed.to_json()) == seed
        yield pg, seed
        pg.rollback()


def test_seed_keeps_first_capture_children_and_latest_message_ids(exported):
    pg, seed = exported
    alert = seed.tables[TABLES[0]].rows[0]
    assert alert["i3_alert_snapshot_id"] == SNAP_IDS[0]
    assert alert["message_snapshot_id"] == SNAP_IDS[1]
    entities = [r for r in seed.tables[TABLES[1]].rows if r["alert_index"] == 0]
    assert {(r["route_id"], r["stop_id"]) for r in entities} == {
        ("51", "S100"),
        ("51", "S101"),
        ("changed", "new"),
    }
    for name, table in seed.tables.items():
        fields = ", ".join(
            f'"{c}"::text' if k == "jsonb" else f'"{c}"' for c, k in table.columns.items()
        )
        expected = pg.execute(text(f"SELECT {fields} FROM {name}")).all()
        for row in table.rows:
            actual = tuple(row[c] for c in table.columns)
            assert actual in [
                tuple(
                    v.isoformat(timespec="microseconds")
                    if hasattr(v, "hour")
                    else v.isoformat()
                    if hasattr(v, "isoformat")
                    else v
                    for v in r
                )
                for r in expected
            ]


def test_seed_includes_future_and_expired_unsuperseded_rows(exported):
    _, seed = exported
    assert {r["alert_id"] for r in seed.tables[TABLES[0]].rows} == {"ALERT-A", "future", "expired"}
    assert {r["start_utc"] for r in seed.tables[TABLES[2]].rows} == {
        None,
        "2099-01-01T00:00:00.000000+00:00",
    }


def test_seed_excludes_superseded_rows_and_orphan_children(exported):
    _, seed = exported
    for name in TABLES[:2]:
        assert {r["alert_index"] for r in seed.tables[name].rows} == {0, 1, 2}


def test_global_id_floor_includes_other_providers(exported):
    pg, seed = exported
    floor = pg.execute(
        text("SELECT max(i3_alert_snapshot_id) FROM raw.i3_alert_snapshots")
    ).scalar_one()
    assert seed.global_max_snapshot_id == floor
    assert read_alert_seed(pg, provider_id="empty_seed_test").global_max_snapshot_id == floor
