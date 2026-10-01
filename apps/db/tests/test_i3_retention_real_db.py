
from __future__ import annotations

import importlib.util
import pathlib
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import text

import transit_ops.maintenance.i3 as i3_maintenance_module
from transit_ops.maintenance import (
    prune_i3_raw_snapshots,
    prune_i3_silver_closed_rows,
)
from transit_ops.silver.i3 import compute_alert_content_hash

PROVIDER = "stm_i3ret_test"
ENDPOINT_ID = 991014
RUN_IDS = (991101, 991102, 991103)
SNAP_IDS = (991001, 991002, 991003)
OBJ_IDS = (991201, 991202, 991203)
T1 = datetime(2026, 6, 10, 3, 0, tzinfo=UTC)
T2 = datetime(2026, 6, 10, 3, 5, tzinfo=UTC)
T3 = datetime(2026, 6, 10, 3, 10, tzinfo=UTC)
SNAP_TIMES = dict(zip(SNAP_IDS, (T1, T2, T3), strict=True))


def _load_0038():
    path = (
        pathlib.Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0038_i3_legacy_nullhash_collapse.py"
    )
    spec = importlib.util.spec_from_file_location("_mig_0038", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GROUP_A = {
    "alert_id": "ALERT-A",
    "alert_header_text": "Ascenseur hors service",
    "description_text": "L'ascenseur est hors service.",
    "severity": "info",
    "cause": None,
    "effect": None,
    "active_period_start_utc": None,
    "active_period_end_utc": None,
    "published_at_utc": None,
    "updated_at_utc": None,
}
GROUP_B = {
    **GROUP_A,
    "alert_id": "ALERT-B",
    "alert_header_text": "Detour 105",
    "description_text": "Trajet modifie",
    "severity": "warning",
}


def _hash(content: dict) -> str:
    return compute_alert_content_hash(**content)


class FakeBronze:
    storage_backend = "s3"

    def __init__(self) -> None:
        self.deleted: list[str] = []

    def delete_object(self, storage_path: str) -> None:
        self.deleted.append(storage_path)

    def delete_objects(self, paths):
        for path in paths:
            self.delete_object(path)
        return set()


class _ExistingTransactionEngine:
    def __init__(self, connection) -> None:  # noqa: ANN001
        self.connection = connection

    def begin(self):
        connection = self.connection

        class Context:
            def __enter__(self):
                return connection

            def __exit__(self, exc_type, exc, traceback) -> bool:  # noqa: ANN001
                return False

        return Context()


@pytest.fixture()
def conn(real_db_engine):  # noqa: ANN001
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(
                text("ALTER TABLE silver.i3_alerts ALTER COLUMN content_hash DROP NOT NULL")
            )
            _seed(connection)
            yield connection
        finally:
            transaction.rollback()


def _seed(connection) -> None:
    connection.execute(
        text(
            """
            INSERT INTO core.providers (provider_id, display_name, timezone, provider_key)
            VALUES (:p, 'STM i3 retention', 'America/Toronto', :p)
            """
        ),
        {"p": PROVIDER},
    )
    connection.execute(
        text(
            """
            INSERT INTO core.feed_endpoints
                (feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format)
            VALUES (:e, :p, 'i3_alerts', 'i3_alerts', 'api_i3_json')
            """
        ),
        {"e": ENDPOINT_ID, "p": PROVIDER},
    )
    for run_id, snap_id, obj_id in zip(RUN_IDS, SNAP_IDS, OBJ_IDS, strict=True):
        connection.execute(
            text(
                """
                INSERT INTO raw.ingestion_runs
                    (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status,
                     started_at_utc)
                VALUES (:r, :p, :e, 'i3_alerts', 'succeeded', :t)
                """
            ),
            {"r": run_id, "p": PROVIDER, "e": ENDPOINT_ID, "t": SNAP_TIMES[snap_id]},
        )
        connection.execute(
            text(
                """
                INSERT INTO raw.ingestion_objects
                    (ingestion_object_id, ingestion_run_id, provider_id, storage_backend,
                     storage_path, object_kind)
                VALUES (:o, :r, :p, 's3', :path, 'i3_alerts')
                """
            ),
            {
                "o": obj_id,
                "r": run_id,
                "p": PROVIDER,
                "path": f"{PROVIDER}/i3_alerts/captured_at_utc={snap_id}/payload.json",
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO raw.i3_alert_snapshots
                    (i3_alert_snapshot_id, provider_id, feed_endpoint_id,
                     ingestion_run_id, ingestion_object_id, captured_at_utc,
                     storage_path, raw_payload_json)
                VALUES (:s, :p, :e, :r, :o, :t, :path, '{}')
                """
            ),
            {
                "s": snap_id,
                "p": PROVIDER,
                "e": ENDPOINT_ID,
                "r": run_id,
                "o": obj_id,
                "t": SNAP_TIMES[snap_id],
                "path": f"{PROVIDER}/i3_alerts/captured_at_utc={snap_id}/payload.json",
            },
        )


def _insert_legacy_alert(
    connection, *, snap_id: int, alert_index: int, content: dict, captured: datetime
) -> None:
    connection.execute(
        text(
            """
            INSERT INTO silver.i3_alerts (
                i3_alert_snapshot_id, alert_index, provider_id,
                alert_id, alert_header_text, description_text, severity,
                cause, effect, active_period_start_utc, active_period_end_utc,
                published_at_utc, updated_at_utc, captured_at_utc, raw_alert_json,
                content_hash, first_seen_at, last_seen_at, valid_to
            )
            VALUES (
                :s, :i, :p, :alert_id, :header, :descr, :severity,
                :cause, :effect, :aps, :ape, :pub, :upd, :captured, '{}',
                NULL, NULL, NULL, NULL
            )
            """
        ),
        {
            "s": snap_id,
            "i": alert_index,
            "p": PROVIDER,
            "alert_id": content["alert_id"],
            "header": content["alert_header_text"],
            "descr": content["description_text"],
            "severity": content["severity"],
            "cause": content["cause"],
            "effect": content["effect"],
            "aps": content["active_period_start_utc"],
            "ape": content["active_period_end_utc"],
            "pub": content["published_at_utc"],
            "upd": content["updated_at_utc"],
            "captured": captured,
        },
    )


def _insert_entity(
    connection, *, snap_id: int, alert_index: int, entity_index: int, stop_id: str
) -> None:
    connection.execute(
        text(
            """
            INSERT INTO silver.i3_alert_informed_entities
                (i3_alert_snapshot_id, alert_index, entity_index, provider_id,
                 stop_id, raw_entity_json)
            VALUES (:s, :i, :ei, :p, :stop, '{}')
            """
        ),
        {"s": snap_id, "i": alert_index, "ei": entity_index, "p": PROVIDER, "stop": stop_id},
    )


def _seed_legacy_world(connection) -> None:
    _insert_legacy_alert(
        connection, snap_id=SNAP_IDS[0], alert_index=0, content=GROUP_A, captured=T1
    )
    _insert_entity(connection, snap_id=SNAP_IDS[0], alert_index=0, entity_index=0, stop_id="S100")
    _insert_legacy_alert(
        connection, snap_id=SNAP_IDS[1], alert_index=0, content=GROUP_A, captured=T2
    )
    _insert_entity(connection, snap_id=SNAP_IDS[1], alert_index=0, entity_index=0, stop_id="S100")
    _insert_entity(connection, snap_id=SNAP_IDS[1], alert_index=0, entity_index=1, stop_id="S101")
    _insert_legacy_alert(
        connection, snap_id=SNAP_IDS[0], alert_index=1, content=GROUP_B, captured=T1
    )


def _build_and_promote(connection) -> None:
    m = _load_0038()
    connection.execute(text(m._BUILD_LEGACY_KEEPERS))
    connection.execute(text(m._BUILD_LEGACY_SPANS))
    connection.execute(text(m._PROMOTE_LEGACY_SURVIVORS))
    connection.execute(text("DROP TABLE IF EXISTS i3_legacy_keepers"))
    connection.execute(text("DROP TABLE IF EXISTS i3_legacy_spans"))


def _drain_delete(connection) -> None:
    m = _load_0038()
    while True:
        result = connection.execute(text(m._DELETE_LEGACY_BATCH))
        if (result.rowcount or 0) == 0:
            break


def _run_collapse(connection) -> None:
    _build_and_promote(connection)
    _drain_delete(connection)


def _silver_rows(connection) -> list[dict]:
    return [
        dict(row)
        for row in connection.execute(
            text(
                """
                SELECT alert_id, content_hash, first_seen_at, last_seen_at,
                       valid_to, i3_alert_snapshot_id, alert_index
                FROM silver.i3_alerts
                WHERE provider_id = :p
                ORDER BY alert_id, i3_alert_snapshot_id
                """
            ),
            {"p": PROVIDER},
        ).mappings()
    ]


def test_0038_constants_collapse_and_close_legacy_rows(conn) -> None:
    _seed_legacy_world(conn)
    _run_collapse(conn)

    remaining_null = conn.execute(
        text(
            "SELECT count(*) FROM silver.i3_alerts WHERE provider_id = :p AND content_hash IS NULL"
        ),
        {"p": PROVIDER},
    ).scalar()
    assert remaining_null == 0

    rows = _silver_rows(conn)
    by_alert = {r["alert_id"]: r for r in rows}
    assert len(rows) == 2
    assert set(by_alert) == {"ALERT-A", "ALERT-B"}

    a = by_alert["ALERT-A"]
    assert a["i3_alert_snapshot_id"] == SNAP_IDS[1]
    assert a["first_seen_at"] == T1
    assert a["last_seen_at"] == T2
    assert a["valid_to"] == T2
    assert a["content_hash"] == _hash(GROUP_A)
    a_entities = (
        conn.execute(
            text(
                """
            SELECT stop_id FROM silver.i3_alert_informed_entities
            WHERE provider_id = :p AND i3_alert_snapshot_id = :s AND alert_index = 0
            ORDER BY stop_id
            """
            ),
            {"p": PROVIDER, "s": SNAP_IDS[1]},
        )
        .scalars()
        .all()
    )
    assert a_entities == ["S100", "S101"]

    b = by_alert["ALERT-B"]
    assert b["valid_to"] == T1
    assert b["content_hash"] == _hash(GROUP_B)


def test_0038_promote_does_not_violate_active_partial_unique_index(conn) -> None:
    _seed_legacy_world(conn)
    conn.execute(
        text(
            """
            INSERT INTO silver.i3_alerts (
                i3_alert_snapshot_id, alert_index, provider_id,
                alert_id, alert_header_text, description_text, severity,
                captured_at_utc, raw_alert_json,
                content_hash, first_seen_at, last_seen_at, valid_to
            )
            VALUES (
                :s, 5, :p, :alert_id, :header, :descr, :severity,
                :t, '{}', :hash, :t, :t, NULL
            )
            """
        ),
        {
            "s": SNAP_IDS[2],
            "p": PROVIDER,
            "alert_id": GROUP_A["alert_id"],
            "header": GROUP_A["alert_header_text"],
            "descr": GROUP_A["description_text"],
            "severity": GROUP_A["severity"],
            "t": T3,
            "hash": _hash(GROUP_A),
        },
    )

    _run_collapse(conn)

    active = (
        conn.execute(
            text(
                """
            SELECT i3_alert_snapshot_id, valid_to FROM silver.i3_alerts
            WHERE provider_id = :p AND content_hash = :hash AND valid_to IS NULL
            """
            ),
            {"p": PROVIDER, "hash": _hash(GROUP_A)},
        )
        .mappings()
        .all()
    )
    assert len(active) == 1
    assert active[0]["i3_alert_snapshot_id"] == SNAP_IDS[2]


def test_0038_resume_after_partial_delete_keeps_one_survivor_with_full_span(conn) -> None:
    _insert_legacy_alert(conn, snap_id=SNAP_IDS[0], alert_index=0, content=GROUP_A, captured=T1)
    _insert_legacy_alert(conn, snap_id=SNAP_IDS[1], alert_index=0, content=GROUP_A, captured=T2)
    _insert_legacy_alert(conn, snap_id=SNAP_IDS[2], alert_index=0, content=GROUP_A, captured=T3)

    legacy_hash = _hash(GROUP_A)

    _build_and_promote(conn)

    survivor = (
        conn.execute(
            text(
                """
            SELECT i3_alert_snapshot_id, first_seen_at, last_seen_at, valid_to
            FROM silver.i3_alerts
            WHERE provider_id = :p AND content_hash = :h AND valid_to IS NOT NULL
            """
            ),
            {"p": PROVIDER, "h": legacy_hash},
        )
        .mappings()
        .all()
    )
    assert len(survivor) == 1
    assert survivor[0]["i3_alert_snapshot_id"] == SNAP_IDS[2]
    assert survivor[0]["first_seen_at"] == T1
    assert survivor[0]["last_seen_at"] == T3
    assert survivor[0]["valid_to"] == T3

    deleted = conn.execute(
        text(
            """
            DELETE FROM silver.i3_alerts
            WHERE provider_id = :p AND content_hash IS NULL
              AND i3_alert_snapshot_id = :s AND alert_index = 0
            """
        ),
        {"p": PROVIDER, "s": SNAP_IDS[0]},
    ).rowcount
    assert deleted == 1
    null_left = conn.execute(
        text(
            "SELECT count(*) FROM silver.i3_alerts WHERE provider_id = :p AND content_hash IS NULL"
        ),
        {"p": PROVIDER},
    ).scalar()
    assert null_left == 1

    _run_collapse(conn)

    remaining_null = conn.execute(
        text(
            "SELECT count(*) FROM silver.i3_alerts WHERE provider_id = :p AND content_hash IS NULL"
        ),
        {"p": PROVIDER},
    ).scalar()
    assert remaining_null == 0

    rows = _silver_rows(conn)
    assert len(rows) == 1
    s = rows[0]
    assert s["alert_id"] == "ALERT-A"
    assert s["content_hash"] == legacy_hash
    assert s["i3_alert_snapshot_id"] == SNAP_IDS[2]
    assert s["first_seen_at"] == T1
    assert s["last_seen_at"] == T3
    assert s["valid_to"] == T3


def test_prune_i3_raw_keeps_silver_referenced_and_latest_snapshots(conn) -> None:
    _insert_legacy_alert(conn, snap_id=SNAP_IDS[0], alert_index=0, content=GROUP_A, captured=T1)
    storage = FakeBronze()

    cutoff, object_counts, meta_counts, failed = prune_i3_raw_snapshots(
        conn,
        provider_id=PROVIDER,
        retention_days=1,
        bronze_storage=storage,
        now_utc=datetime.now(UTC) + timedelta(days=365),
    )
    assert failed == set()

    surviving = set(
        conn.execute(
            text("SELECT i3_alert_snapshot_id FROM raw.i3_alert_snapshots WHERE provider_id = :p"),
            {"p": PROVIDER},
        ).scalars()
    )
    assert SNAP_IDS[0] in surviving
    assert SNAP_IDS[2] in surviving
    assert SNAP_IDS[1] not in surviving
    assert any(str(SNAP_IDS[1]) in p for p in storage.deleted)
    assert meta_counts["raw.i3_alert_snapshots"] == 1


@pytest.mark.parametrize("equal_time", [False, True])
def test_i3_raw_retention_keeps_capture_time_winner(conn, equal_time):
    conn.execute(
        text(
            "UPDATE raw.i3_alert_snapshots SET captured_at_utc=:captured "
            "WHERE i3_alert_snapshot_id=:snapshot"
        ),
        [
            {"snapshot": SNAP_IDS[0], "captured": T3},
            {"snapshot": SNAP_IDS[1], "captured": T3 if equal_time else T2},
            {"snapshot": SNAP_IDS[2], "captured": T1},
        ],
    )
    storage = FakeBronze()
    kwargs = dict(
        provider_id=PROVIDER,
        retention_days=1,
        bronze_storage=storage,
        now_utc=T3 + timedelta(days=40),
    )
    _, expected, _, _ = prune_i3_raw_snapshots(conn, dry_run=True, **kwargs)
    _, deleted, _, _ = prune_i3_raw_snapshots(conn, **kwargs)
    assert deleted == expected == {"i3_raw": 2}
    assert conn.execute(
        text("SELECT i3_alert_snapshot_id FROM raw.i3_alert_snapshots WHERE provider_id=:p"),
        {"p": PROVIDER},
    ).scalars().all() == [SNAP_IDS[1 if equal_time else 0]]


def test_prune_i3_silver_closed_rows_respects_30d_floor_and_cascade(conn) -> None:
    now = datetime(2026, 6, 13, 0, 0, tzinfo=UTC)
    old_closed = now - timedelta(days=40)
    recent_closed = now - timedelta(days=5)

    conn.execute(
        text(
            """
            INSERT INTO silver.i3_alerts (
                i3_alert_snapshot_id, alert_index, provider_id, alert_id,
                captured_at_utc, raw_alert_json, content_hash,
                first_seen_at, last_seen_at, valid_to
            )
            VALUES (:s, 0, :p, 'OLD', :t, '{}', 'h_old', :t, :vt, :vt)
            """
        ),
        {"s": SNAP_IDS[0], "p": PROVIDER, "t": old_closed, "vt": old_closed},
    )
    _insert_entity(conn, snap_id=SNAP_IDS[0], alert_index=0, entity_index=0, stop_id="S900")
    conn.execute(
        text(
            """
            INSERT INTO silver.i3_alerts (
                i3_alert_snapshot_id, alert_index, provider_id, alert_id,
                captured_at_utc, raw_alert_json, content_hash,
                first_seen_at, last_seen_at, valid_to
            )
            VALUES (:s, 1, :p, 'RECENT', :t, '{}', 'h_recent', :t, :vt, :vt)
            """
        ),
        {"s": SNAP_IDS[0], "p": PROVIDER, "t": recent_closed, "vt": recent_closed},
    )
    conn.execute(
        text(
            """
            INSERT INTO silver.i3_alerts (
                i3_alert_snapshot_id, alert_index, provider_id, alert_id,
                captured_at_utc, raw_alert_json, content_hash,
                first_seen_at, last_seen_at, valid_to
            )
            VALUES (:s, 2, :p, 'ACTIVE', :t, '{}', 'h_active', :t, :t, NULL)
            """
        ),
        {"s": SNAP_IDS[0], "p": PROVIDER, "t": old_closed},
    )

    cutoff, row_counts = prune_i3_silver_closed_rows(
        conn,
        provider_id=PROVIDER,
        retention_days=7,
        now_utc=now,
    )
    assert cutoff == now - timedelta(days=30)
    assert row_counts["silver.i3_alerts"] == 1
    assert row_counts["silver.i3_alert_informed_entities"] == 1

    survivors = {r["alert_id"] for r in _silver_rows(conn)}
    assert survivors == {"RECENT", "ACTIVE"}
    remaining_entities = conn.execute(
        text(
            "SELECT count(*) FROM silver.i3_alert_informed_entities "
            "WHERE provider_id = :p AND stop_id = 'S900'"
        ),
        {"p": PROVIDER},
    ).scalar()
    assert remaining_entities == 0


def test_i3_prune_archives_complete_alert_before_eligible_silver_delete(conn, monkeypatch) -> None:
    captured = datetime(2025, 10, 1, 13, 0, tzinfo=UTC)
    closed = datetime(2026, 3, 1, 13, 0, tzinfo=UTC)
    conn.execute(
        text(
            """
            INSERT INTO silver.i3_alerts (
                i3_alert_snapshot_id, alert_index, provider_id, alert_id,
                alert_header_text, alert_header_text_en,
                description_text, description_text_en,
                severity, cause, effect,
                active_period_start_utc, active_period_end_utc,
                captured_at_utc, raw_alert_json, content_hash,
                first_seen_at, last_seen_at, valid_to, url
            ) VALUES (
                :snapshot_id, 20, :provider_id, 'ARCHIVE-BEFORE-PRUNE',
                'Ascenseur fermé', 'Elevator closed',
                'Utilisez la station voisine.', 'Use the nearby station.',
                'WARNING', 'MAINTENANCE', 'ACCESSIBILITY_ISSUE',
                :captured, :closed,
                :captured, '{}'::jsonb, 'archive-before-prune-v1',
                :captured, :closed, :closed,
                'https://www.stm.info/fr/infos/etat-du-service'
            )
            """
        ),
        {
            "snapshot_id": SNAP_IDS[0],
            "provider_id": PROVIDER,
            "captured": captured,
            "closed": closed,
        },
    )
    _insert_entity(
        conn,
        snap_id=SNAP_IDS[0],
        alert_index=20,
        entity_index=0,
        stop_id="S900",
    )
    conn.execute(
        text(
            """
            INSERT INTO silver.i3_alert_active_periods (
                i3_alert_snapshot_id, alert_index, period_index, start_utc, end_utc
            ) VALUES (:snapshot_id, 20, 0, :captured, :closed)
            """
        ),
        {"snapshot_id": SNAP_IDS[0], "captured": captured, "closed": closed},
    )

    class Settings:
        GOLD_WARM_ROLLUP_RETENTION_DAYS = 730
        SILVER_I3_CLOSED_RETENTION_DAYS = 90
        BRONZE_I3_RETENTION_DAYS = 30

    monkeypatch.setattr(
        i3_maintenance_module,
        "_provider_alert_archive_bounds",
        lambda provider_id, settings: (date(2024, 7, 1), date(2026, 7, 12)),
        raising=False,
    )
    monkeypatch.setattr(
        "transit_ops.maintenance.bronze.BronzeStorageScope.resolve",
        lambda self, backend: FakeBronze(),
    )

    result = i3_maintenance_module.prune_i3_storage(
        PROVIDER,
        settings=Settings(),  # type: ignore[arg-type]
        engine=_ExistingTransactionEngine(conn),  # type: ignore[arg-type]
    )

    assert result.alert_archive_sync is not None
    assert result.alert_archive_sync.inserted_count == 1
    assert (
        conn.execute(
            text(
                "SELECT count(*) FROM silver.i3_alerts "
                "WHERE provider_id = :provider_id AND alert_id = 'ARCHIVE-BEFORE-PRUNE'"
            ),
            {"provider_id": PROVIDER},
        ).scalar_one()
        == 0
    )
    archived = (
        conn.execute(
            text(
                """
            SELECT header_text, header_text_en, description_text, description_text_en,
                   url, stop_ids, active_periods
            FROM gold.alert_archive_entry
            WHERE provider_id = :provider_id AND alert_id = 'ARCHIVE-BEFORE-PRUNE'
            """
            ),
            {"provider_id": PROVIDER},
        )
        .mappings()
        .one()
    )
    assert archived["header_text"] == "Ascenseur fermé"
    assert archived["header_text_en"] == "Elevator closed"
    assert archived["description_text"] == "Utilisez la station voisine."
    assert archived["description_text_en"] == "Use the nearby station."
    assert archived["url"].startswith("https://")
    assert archived["stop_ids"] == ["S900"]
    assert len(archived["active_periods"]) == 1


def test_i3_raw_retention_keeps_each_alert_endpoints_latest_capture(conn):
    endpoint = conn.execute(
        text(
            "INSERT INTO core.feed_endpoints "
            "(provider_id,endpoint_key,feed_kind,source_format) "
            "VALUES (:p,'service_alerts','service_alerts','gtfs_rt_service_alerts') "
            "RETURNING feed_endpoint_id"
        ),
        {"p": PROVIDER},
    ).scalar_one()
    conn.execute(
        text(
            "UPDATE raw.i3_alert_snapshots SET feed_endpoint_id=:endpoint "
            "WHERE i3_alert_snapshot_id=:snapshot"
        ),
        {"endpoint": endpoint, "snapshot": SNAP_IDS[1]},
    )
    conn.execute(
        text(
            "UPDATE raw.ingestion_runs SET feed_endpoint_id=:endpoint,run_kind='service_alerts' "
            "WHERE ingestion_run_id=:run"
        ),
        {"endpoint": endpoint, "run": RUN_IDS[1]},
    )
    storage = FakeBronze()
    _, deleted, _, _ = prune_i3_raw_snapshots(
        conn,
        provider_id=PROVIDER,
        retention_days=1,
        bronze_storage=storage,
        now_utc=T3 + timedelta(days=40),
    )
    assert deleted == {"i3_raw": 1}
    assert set(
        conn.execute(
            text("SELECT i3_alert_snapshot_id FROM raw.i3_alert_snapshots WHERE provider_id=:p"),
            {"p": PROVIDER},
        ).scalars()
    ) == set(SNAP_IDS[1:])


def test_i3_pruner_defers_while_silver_loader_owns_the_provider(conn, real_db_engine):
    from transit_ops.silver.i3 import RawI3AlertSnapshot, load_i3_snapshot_to_silver

    storage = FakeBronze()
    kwargs = dict(
        provider_id=PROVIDER,
        retention_days=1,
        bronze_storage=storage,
        now_utc=T3 + timedelta(days=40),
    )
    with conn.begin_nested() as loading:
        load_i3_snapshot_to_silver(
            conn,
            snapshot=RawI3AlertSnapshot(SNAP_IDS[2], PROVIDER, "America/Toronto", T3, []),
        )
        with real_db_engine.begin() as contender:
            contender.execute(text("SET LOCAL statement_timeout='1s'"))
            _, deferred, _, _ = prune_i3_raw_snapshots(contender, **kwargs)
        assert deferred == {"i3_raw": 0}
        assert storage.deleted == []
        loading.rollback()
    _, retried, _, _ = prune_i3_raw_snapshots(conn, **kwargs)
    assert retried == {"i3_raw": 2}
