"""Real-database regression tests for i3 retention (slice-9.1.1l).

Exercises against actual Postgres constraints (the partial unique index, the
ON DELETE CASCADE FKs from raw.i3_alert_snapshots and informed_entities) that
fake-connection tests structurally cannot see:

  * migration 0038's SQL constants collapse the legacy content_hash IS NULL
    rows to one closed survivor per content version (latest-captured), with the
    survivor's hash == compute_alert_content_hash(...) and span/valid_to stamped
    from the group MIN/MAX — and the promote never collides with an active
    hashed twin that shares the same content (the partial-unique-index trap);
  * prune_i3_raw_snapshots keeps any raw snapshot still referenced by a silver
    row (the cascade trap) and the per-provider latest snapshot, and removes the
    unreferenced old ones + their ingestion_objects/runs (recording R2 paths);
  * prune_i3_silver_closed_rows honours the 30-day floor and cascades entities.

Run ONLY when TRANSIT_TEST_DATABASE_URL points at a disposable Postgres with the
transit schema at head (0039 applied). Each test runs inside one transaction and
rolls back. Never point this at production.

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://repro@:55432/transit_repro?host=/tmp/i3repro" \
        uv run pytest tests/test_i3_retention_real_db.py -v
"""

from __future__ import annotations

import importlib.util
import os
import pathlib
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import create_engine, text

import transit_ops.maintenance.i3 as i3_maintenance_module
from transit_ops.maintenance import (
    prune_i3_raw_snapshots,
    prune_i3_silver_closed_rows,
)
from transit_ops.silver.i3 import compute_alert_content_hash

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set — real-DB retention tests skipped",
)

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


# Two legacy content groups. Group A is captured in T1 and T2; its T2 capture
# carries an extra informed entity, so the latest-captured survivor must carry
# the EXTENDED entity set. Group B is captured only at T1.
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
    def __init__(self) -> None:
        self.deleted: list[str] = []

    def delete_object(self, storage_path: str) -> None:
        self.deleted.append(storage_path)


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
def conn():
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        transaction = connection.begin()
        # These tests reconstruct the PRE-0039 world (legacy content_hash IS NULL
        # rows) to exercise 0038's one-time collapse. At gate time the schema is
        # at head, where 0039 enforces content_hash NOT NULL, so drop that
        # constraint inside this rolled-back transaction to seed the legacy rows;
        # the rollback restores it, and prod is never touched.
        connection.execute(
            text("ALTER TABLE silver.i3_alerts ALTER COLUMN content_hash DROP NOT NULL")
        )
        _seed(connection)
        try:
            yield connection
        finally:
            transaction.rollback()
        engine.dispose()


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
    """A pre-SCD-2 legacy row: content_hash / first_seen / last_seen / valid_to NULL."""
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
    # Group A: T1 (snap 1, idx 0, one entity), T2 (snap 2, idx 0, TWO entities).
    _insert_legacy_alert(
        connection, snap_id=SNAP_IDS[0], alert_index=0, content=GROUP_A, captured=T1
    )
    _insert_entity(connection, snap_id=SNAP_IDS[0], alert_index=0, entity_index=0, stop_id="S100")
    _insert_legacy_alert(
        connection, snap_id=SNAP_IDS[1], alert_index=0, content=GROUP_A, captured=T2
    )
    _insert_entity(connection, snap_id=SNAP_IDS[1], alert_index=0, entity_index=0, stop_id="S100")
    _insert_entity(connection, snap_id=SNAP_IDS[1], alert_index=0, entity_index=1, stop_id="S101")
    # Group B: T1 only (snap 1, idx 1).
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
    # Loop the batched delete until it deletes nothing.
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

    # Zero NULL-hash rows remain.
    remaining_null = conn.execute(
        text(
            "SELECT count(*) FROM silver.i3_alerts "
            "WHERE provider_id = :p AND content_hash IS NULL"
        ),
        {"p": PROVIDER},
    ).scalar()
    assert remaining_null == 0

    rows = _silver_rows(conn)
    by_alert = {r["alert_id"]: r for r in rows}
    # Exactly one survivor per content group.
    assert len(rows) == 2
    assert set(by_alert) == {"ALERT-A", "ALERT-B"}

    a = by_alert["ALERT-A"]
    # Survivor is the LATEST-captured duplicate (snap 2) with span/valid_to set.
    assert a["i3_alert_snapshot_id"] == SNAP_IDS[1]
    assert a["first_seen_at"] == T1
    assert a["last_seen_at"] == T2
    assert a["valid_to"] == T2
    # Hash equals the python/SQL twin.
    assert a["content_hash"] == _hash(GROUP_A)
    # Survivor carries the EXTENDED entity set (the snap-2 capture's two stops).
    a_entities = conn.execute(
        text(
            """
            SELECT stop_id FROM silver.i3_alert_informed_entities
            WHERE provider_id = :p AND i3_alert_snapshot_id = :s AND alert_index = 0
            ORDER BY stop_id
            """
        ),
        {"p": PROVIDER, "s": SNAP_IDS[1]},
    ).scalars().all()
    assert a_entities == ["S100", "S101"]

    b = by_alert["ALERT-B"]
    assert b["valid_to"] == T1
    assert b["content_hash"] == _hash(GROUP_B)


def test_0038_promote_does_not_violate_active_partial_unique_index(conn) -> None:
    _seed_legacy_world(conn)
    # An ACTIVE hashed row whose content equals Group A — its content_hash is the
    # same value the legacy survivor will be promoted to. Because the promote sets
    # valid_to (closing the survivor), it stays OUT of the active partial-index
    # domain, so no collision on flush.
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

    # Must NOT raise a unique-violation.
    _run_collapse(conn)

    # The pre-existing ACTIVE hashed row is untouched and still active.
    active = conn.execute(
        text(
            """
            SELECT i3_alert_snapshot_id, valid_to FROM silver.i3_alerts
            WHERE provider_id = :p AND content_hash = :hash AND valid_to IS NULL
            """
        ),
        {"p": PROVIDER, "hash": _hash(GROUP_A)},
    ).mappings().all()
    assert len(active) == 1
    assert active[0]["i3_alert_snapshot_id"] == SNAP_IDS[2]


def test_0038_resume_after_partial_delete_keeps_one_survivor_with_full_span(conn) -> None:
    """Interrupt-mid-DELETE resume must not mint a SECOND closed survivor.

    Because alembic stamps 0038 only AFTER upgrade() returns, an interrupt during
    the batched DELETE re-runs the WHOLE upgrade(). On the rerun the survivor
    promoted by the first run is no longer content_hash IS NULL, so a naive
    build->promote would pick a fresh keeper out of the leftover NULL dups and
    mint a SECOND closed row for the same content group with a NARROWER span — a
    silent "exactly one closed survivor per content version" violation that no
    constraint catches (both closed rows sit outside the active partial index).

    This drives the real fix end-to-end:
        1. seed ONE content group with THREE NULL-hash dups (T1, T2, T3);
        2. run build -> promote (closes the T3 survivor, leaves T1/T2 NULL);
        3. PARTIAL delete — remove the T1 dup only, leaving the T2 dup NULL
           (simulating an interrupt before the delete drained);
        4. re-run the FULL build -> promote -> drain delete;
        5. assert STILL exactly one survivor, span == FULL group (T1..T3),
           and ZERO NULL-hash rows remain.
    """
    # One content group, three NULL-hash captures at T1 < T2 < T3.
    _insert_legacy_alert(conn, snap_id=SNAP_IDS[0], alert_index=0, content=GROUP_A, captured=T1)
    _insert_legacy_alert(conn, snap_id=SNAP_IDS[1], alert_index=0, content=GROUP_A, captured=T2)
    _insert_legacy_alert(conn, snap_id=SNAP_IDS[2], alert_index=0, content=GROUP_A, captured=T3)

    legacy_hash = _hash(GROUP_A)

    # --- First (interrupted) run: build + promote, then a PARTIAL delete. ---
    _build_and_promote(conn)

    # Exactly one closed survivor so far (the latest-captured T3 dup), carrying
    # the FULL span T1..T3 even though T1/T2 are still present.
    survivor = conn.execute(
        text(
            """
            SELECT i3_alert_snapshot_id, first_seen_at, last_seen_at, valid_to
            FROM silver.i3_alerts
            WHERE provider_id = :p AND content_hash = :h AND valid_to IS NOT NULL
            """
        ),
        {"p": PROVIDER, "h": legacy_hash},
    ).mappings().all()
    assert len(survivor) == 1
    assert survivor[0]["i3_alert_snapshot_id"] == SNAP_IDS[2]
    assert survivor[0]["first_seen_at"] == T1
    assert survivor[0]["last_seen_at"] == T3
    assert survivor[0]["valid_to"] == T3

    # Two NULL dups remain (the T1 and T2 captures). Delete ONLY the T1 dup to
    # simulate an interrupt before the batched delete drained the work-set.
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
    # One NULL dup (the T2 capture) survives into the resumed run.
    null_left = conn.execute(
        text(
            "SELECT count(*) FROM silver.i3_alerts "
            "WHERE provider_id = :p AND content_hash IS NULL"
        ),
        {"p": PROVIDER},
    ).scalar()
    assert null_left == 1

    # --- Resumed run: FULL build -> promote -> drain delete. ---
    _run_collapse(conn)

    # Zero NULL-hash rows remain.
    remaining_null = conn.execute(
        text(
            "SELECT count(*) FROM silver.i3_alerts "
            "WHERE provider_id = :p AND content_hash IS NULL"
        ),
        {"p": PROVIDER},
    ).scalar()
    assert remaining_null == 0

    # STILL exactly one closed survivor for this content version — the leftover
    # T2 dup folded into the EXISTING survivor, not a second narrower row.
    rows = _silver_rows(conn)
    assert len(rows) == 1
    s = rows[0]
    assert s["alert_id"] == "ALERT-A"
    assert s["content_hash"] == legacy_hash
    # The EXISTING (T3) survivor was re-stamped in place, NOT replaced by a
    # narrower-span row keyed on the leftover T2 dup.
    assert s["i3_alert_snapshot_id"] == SNAP_IDS[2]
    # Span still spans the FULL group T1..T3 (no narrowing to the leftover dup).
    assert s["first_seen_at"] == T1
    assert s["last_seen_at"] == T3
    assert s["valid_to"] == T3


def test_prune_i3_raw_keeps_silver_referenced_and_latest_snapshots(conn) -> None:
    # Seed one legacy alert referencing snapshot 1 (so snap 1 is silver-referenced).
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
            text(
                "SELECT i3_alert_snapshot_id FROM raw.i3_alert_snapshots "
                "WHERE provider_id = :p"
            ),
            {"p": PROVIDER},
        ).scalars()
    )
    # snap 1 survives (silver-referenced); snap 3 survives (latest per provider).
    assert SNAP_IDS[0] in surviving
    assert SNAP_IDS[2] in surviving
    # snap 2 was unreferenced + not latest → deleted, its R2 path removed.
    assert SNAP_IDS[1] not in surviving
    assert any(str(SNAP_IDS[1]) in p for p in storage.deleted)
    assert meta_counts["raw.i3_alert_snapshots"] == 1


def test_prune_i3_silver_closed_rows_respects_30d_floor_and_cascade(conn) -> None:
    now = datetime(2026, 6, 13, 0, 0, tzinfo=UTC)
    old_closed = now - timedelta(days=40)
    recent_closed = now - timedelta(days=5)

    # A closed row older than the 30d floor (should be deleted with its entity).
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
    # A recently-closed row (inside the 30d window — must survive).
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
    # An ACTIVE row (valid_to NULL — must survive regardless of age).
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

    # retention_days=7 is floored to the 30d minimum → cutoff = now - 30d, so the
    # 40d-old closed row is eligible while the 5d-old one is protected.
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
    # The old closed row's entity cascaded away.
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
        i3_maintenance_module._maintenance_pkg,
        "get_bronze_storage",
        lambda settings, project_root=None: FakeBronze(),
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
