"""Real-database regression tests for the i3 SCD-2 silver loader (slice-9.1.1h).

These tests exercise the actual Postgres constraints (partial unique index,
informed-entities FK) that fake-connection tests structurally cannot see —
the prod incident they lock in (alerts.json frozen since 2026-06-09 14:16Z)
passed every offline test.

They run ONLY when TRANSIT_TEST_DATABASE_URL points at a disposable Postgres
with the transit schema applied (e.g. a throwaway local cluster restored from
`pg_dump --schema-only -n core -n raw -n silver -n gold`, then
`alembic stamp 0036_dst_safe_observation_url && alembic upgrade head` so the
0037 EN columns + gold views are present). Each test runs inside one
transaction and rolls back — nothing persists, reruns are idempotent.

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://repro@:55432/transit_repro?host=/tmp/i3repro" \
        uv run pytest tests/test_i3_real_db_regression.py -v

Never point this at production.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from transit_ops.silver.i3 import RawI3AlertSnapshot, load_i3_snapshot_to_silver

PROVIDER = "stm_i3fk_test"
ENDPOINT_ID = 990014
RUN_IDS = (990101, 990102, 990103, 990104)
SNAP_IDS = (990001, 990002, 990003, 990004)
T1 = datetime(2026, 6, 10, 3, 0, tzinfo=UTC)
T2 = datetime(2026, 6, 10, 3, 5, tzinfo=UTC)
T3 = datetime(2026, 6, 10, 3, 10, tzinfo=UTC)
T4 = datetime(2026, 6, 10, 3, 15, tzinfo=UTC)
SNAP_TIMES = dict(zip(SNAP_IDS, (T1, T2, T3, T4), strict=True))

ALERT_A = {
    "id": "ALERT-A",
    "header": "Ascenseur hors service - station X",
    "description": "L'ascenseur est hors service.",
    "severity": "info",
    "routes": ["51"],
    "stops": ["S100", "S101"],
}
ALERT_A_MORE_STOPS = {**ALERT_A, "stops": ["S100", "S101", "S102"]}
ALERT_B_V1 = {
    "id": "ALERT-B",
    "header": "Detour 105",
    "description": "v1",
    "severity": "warning",
    "routes": ["105"],
}
ALERT_B_V2 = {**ALERT_B_V1, "description": "v2 - trajet modifie"}
ALERT_C = {"id": "ALERT-C", "header": "Nouvel avis", "routes": ["24"]}

# slice-9.1.1s bilingual fixtures (etatservice shape: header_texts /
# description_texts arrays of {language, text}). NO active period set, so
# gold.current_i3_alerts' active-window filter (0024:134-135 filters out
# past-end alerts) keeps the row visible — the verbatim text is what matters.
ALERT_BILINGUAL = {
    "id": "ALERT-BI",
    "header_texts": [
        {"language": "fr", "text": "Votre ligne est interrompue"},
        {"language": "en", "text": "Your line is interrupted"},
    ],
    "description_texts": [
        {"language": "fr", "text": "Arrets annules entre A et B"},
        {"language": "en", "text": "Cancelled stops between A and B"},
    ],
    "routes": ["44"],
    "stops": ["S200"],
}
# Same identity (fr header/description/severity/cause/effect + period unchanged),
# only the EN text differs -> hash unchanged -> ON CONFLICT redirect, EN refresh.
ALERT_BILINGUAL_EN_EDIT = {
    **ALERT_BILINGUAL,
    "header_texts": [
        {"language": "fr", "text": "Votre ligne est interrompue"},
        {"language": "en", "text": "Your line is interrupted (updated)"},
    ],
    "description_texts": [
        {"language": "fr", "text": "Arrets annules entre A et B"},
        {"language": "en", "text": "Cancelled stops between A and B (updated)"},
    ],
}
# Same fr identity, EN entries removed entirely (transient en-less payload).
ALERT_BILINGUAL_NO_EN = {
    **ALERT_BILINGUAL,
    "header_texts": [{"language": "fr", "text": "Votre ligne est interrompue"}],
    "description_texts": [{"language": "fr", "text": "Arrets annules entre A et B"}],
}


@pytest.fixture()
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        _seed(connection, seed_provider)
        try:
            yield connection
        finally:
            transaction.rollback()


def _seed(connection, seed_provider) -> None:
    seed_provider(connection, PROVIDER, display_name="STM i3 FK regression")
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
    for run_id, snap_id in zip(RUN_IDS, SNAP_IDS, strict=True):
        connection.execute(
            text(
                """
                INSERT INTO raw.ingestion_runs
                    (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status)
                VALUES (:r, :p, :e, 'i3_alerts', 'succeeded')
                """
            ),
            {"r": run_id, "p": PROVIDER, "e": ENDPOINT_ID},
        )
        connection.execute(
            text(
                """
                INSERT INTO raw.i3_alert_snapshots
                    (i3_alert_snapshot_id, provider_id, feed_endpoint_id,
                     ingestion_run_id, captured_at_utc, raw_payload_json)
                VALUES (:s, :p, :e, :r, :captured, '{}')
                """
            ),
            {
                "s": snap_id,
                "p": PROVIDER,
                "e": ENDPOINT_ID,
                "r": run_id,
                "captured": SNAP_TIMES[snap_id],
            },
        )


def _load(connection, snap_id: int, alerts: list) -> object:
    snapshot = RawI3AlertSnapshot(
        i3_alert_snapshot_id=snap_id,
        provider_id=PROVIDER,
        captured_at_utc=SNAP_TIMES[snap_id],
        raw_payload_json=alerts,
    )
    return load_i3_snapshot_to_silver(connection, snapshot=snapshot)


def _active_rows(connection) -> list[dict]:
    return [
        dict(row)
        for row in connection.execute(
            text(
                """
                SELECT i3_alert_snapshot_id, alert_index, alert_id,
                       description_text, last_seen_at, valid_to
                FROM silver.i3_alerts
                WHERE provider_id = :p
                ORDER BY alert_id, i3_alert_snapshot_id
                """
            ),
            {"p": PROVIDER},
        ).mappings()
    ]


def _entities(connection) -> list[tuple]:
    return list(
        connection.execute(
            text(
                """
                SELECT i3_alert_snapshot_id, alert_index, entity_index, route_id, stop_id
                FROM silver.i3_alert_informed_entities
                WHERE provider_id = :p
                ORDER BY i3_alert_snapshot_id, alert_index, entity_index
                """
            ),
            {"p": PROVIDER},
        )
    )


def test_persisting_alert_with_entities_survives_cross_snapshot_load(conn) -> None:
    """THE regression: an alert whose content is unchanged across snapshots must
    not orphan its informed entities (prod: every load since the 2026-06-09
    deploy rolled back on fk_silver_i3_alert_informed_entities_alert)."""
    _load(conn, SNAP_IDS[0], [ALERT_A, ALERT_B_V1])

    # Pre-fix this raises IntegrityError (ForeignKeyViolation) — ALERT-A's
    # insert is ON CONFLICT-redirected to the snapshot-1 row, so its entities
    # written under snapshot 2 have no parent.
    _load(conn, SNAP_IDS[1], [ALERT_A, ALERT_B_V2, ALERT_C])

    rows = _active_rows(conn)
    by_alert = {}
    for row in rows:
        by_alert.setdefault(row["alert_id"], []).append(row)

    # ALERT-A: single row, still keyed to snapshot 1, active, last_seen bumped.
    (a_row,) = by_alert["ALERT-A"]
    assert a_row["i3_alert_snapshot_id"] == SNAP_IDS[0]
    assert a_row["valid_to"] is None
    assert a_row["last_seen_at"] == T2

    # ALERT-A entities: still exactly the two original rows on the snap-1 key.
    a_entities = [e for e in _entities(conn) if e[0] == SNAP_IDS[0] and e[1] == 0]
    assert {(e[3], e[4]) for e in a_entities} == {("51", "S100"), ("51", "S101")}

    # ALERT-B: v1 superseded at T2, v2 active under snapshot 2.
    b_rows = by_alert["ALERT-B"]
    v1 = next(r for r in b_rows if r["description_text"] == "v1")
    v2 = next(r for r in b_rows if r["description_text"].startswith("v2"))
    assert v1["valid_to"] == T2
    assert v2["valid_to"] is None
    assert v2["i3_alert_snapshot_id"] == SNAP_IDS[1]

    # ALERT-C: new and active with its entity.
    (c_row,) = by_alert["ALERT-C"]
    assert c_row["valid_to"] is None


def test_entity_extension_attaches_to_surviving_row(conn) -> None:
    """Same content hash but a longer stop list: new entities must attach to
    the surviving (older-snapshot) parent row, not crash and not duplicate."""
    _load(conn, SNAP_IDS[0], [ALERT_A])
    _load(conn, SNAP_IDS[1], [ALERT_A_MORE_STOPS])

    a_entities = [e for e in _entities(conn) if e[1] == 0]
    keys = {(e[0], e[1]) for e in a_entities}
    assert keys == {(SNAP_IDS[0], 0)}, "entities must live on the surviving row"
    assert {(e[3], e[4]) for e in a_entities} == {
        ("51", "S100"),
        ("51", "S101"),
        ("51", "S102"),
    }


def test_empty_payload_does_not_supersede(conn) -> None:
    """A feed hiccup returning zero alerts must not close every active alert."""
    _load(conn, SNAP_IDS[0], [ALERT_A, ALERT_B_V1])
    _load(conn, SNAP_IDS[1], [])

    assert all(row["valid_to"] is None for row in _active_rows(conn))


def test_reload_same_snapshot_is_idempotent(conn) -> None:
    """Re-running a load for the same snapshot id must converge, not error."""
    _load(conn, SNAP_IDS[0], [ALERT_A, ALERT_B_V1])
    _load(conn, SNAP_IDS[1], [ALERT_A, ALERT_B_V2, ALERT_C])
    before_rows = _active_rows(conn)
    before_entities = _entities(conn)

    _load(conn, SNAP_IDS[1], [ALERT_A, ALERT_B_V2, ALERT_C])

    assert _active_rows(conn) == before_rows
    assert _entities(conn) == before_entities


# ---------------------------------------------------------------------------
# slice-9.1.1s — bilingual EN text against a real cluster where 0037 is applied
# ---------------------------------------------------------------------------


def _active_en(connection) -> dict:
    """The single active row's fr+en text columns."""
    return dict(
        connection.execute(
            text(
                """
                SELECT alert_header_text, alert_header_text_en,
                       description_text, description_text_en,
                       i3_alert_snapshot_id, last_seen_at
                FROM silver.i3_alerts
                WHERE provider_id = :p AND valid_to IS NULL
                """
            ),
            {"p": PROVIDER},
        )
        .mappings()
        .one()
    )


def test_bilingual_payload_lands_both_languages(conn) -> None:
    """An etatservice bilingual alert stores fr in the canonical columns and en
    in the additive EN columns."""
    _load(conn, SNAP_IDS[0], [ALERT_BILINGUAL])
    row = _active_en(conn)
    assert row["alert_header_text"] == "Votre ligne est interrompue"
    assert row["alert_header_text_en"] == "Your line is interrupted"
    assert row["description_text"] == "Arrets annules entre A et B"
    assert row["description_text_en"] == "Cancelled stops between A and B"


def test_en_only_edit_updates_surviving_row_without_new_scd2_row(conn) -> None:
    """EN is outside the content hash, so an EN-only edit redirects onto the
    surviving SCD-2 row (no new row, no supersession) and refreshes EN in place."""
    _load(conn, SNAP_IDS[0], [ALERT_BILINGUAL])
    first = _active_en(conn)
    _load(conn, SNAP_IDS[1], [ALERT_BILINGUAL_EN_EDIT])

    rows = _active_rows(conn)
    assert len(rows) == 1, "EN-only edit must not create a second SCD-2 row"
    refreshed = _active_en(conn)
    # same surviving row (still keyed to snapshot 1), last_seen bumped to T2
    assert refreshed["i3_alert_snapshot_id"] == first["i3_alert_snapshot_id"] == SNAP_IDS[0]
    assert refreshed["last_seen_at"] == T2
    # EN refreshed onto the surviving row
    assert refreshed["alert_header_text_en"] == "Your line is interrupted (updated)"
    assert refreshed["description_text_en"] == "Cancelled stops between A and B (updated)"
    # no superseded row exists
    assert all(r["valid_to"] is None for r in rows)


def test_en_less_reload_preserves_stored_en(conn) -> None:
    """A transient en-less payload (same fr identity) must NOT wipe stored EN —
    the ON CONFLICT COALESCE keeps the previously-seen English."""
    _load(conn, SNAP_IDS[0], [ALERT_BILINGUAL])
    _load(conn, SNAP_IDS[1], [ALERT_BILINGUAL_NO_EN])

    rows = _active_rows(conn)
    assert len(rows) == 1
    row = _active_en(conn)
    # COALESCE(excluded.en=NULL, stored) keeps the prior EN non-NULL
    assert row["alert_header_text_en"] == "Your line is interrupted"
    assert row["description_text_en"] == "Cancelled stops between A and B"


def test_gold_current_view_exposes_en_columns(conn) -> None:
    """gold.current_i3_alerts surfaces the EN columns. The fixture has no active
    period so the 0024 active-window filter keeps it visible."""
    _load(conn, SNAP_IDS[0], [ALERT_BILINGUAL])
    row = dict(
        conn.execute(
            text(
                """
                SELECT alert_header_text, alert_header_text_en,
                       description_text, description_text_en
                FROM gold.current_i3_alerts
                WHERE provider_id = :p
                """
            ),
            {"p": PROVIDER},
        )
        .mappings()
        .one()
    )
    assert row["alert_header_text_en"] == "Your line is interrupted"
    assert row["description_text_en"] == "Cancelled stops between A and B"


def test_migration_backfilled_superseded_seed_row(conn) -> None:
    """The widened backfill reaches valid_to-CLOSED (superseded) hashed rows —
    the only EN source for them in the 30-day history window. Seeds a closed
    hashed row carrying en variants in raw_alert_json and runs the migration's
    own _BACKFILL_EN, asserting the EN column populates."""
    import importlib.util
    import json
    import pathlib

    # The 0037 migration module name starts with a digit, so load it by path
    # and reuse its verbatim _BACKFILL_EN SQL (proves the test runs the real
    # backfill, not a paraphrase).
    _mig_path = (
        pathlib.Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0037_i3_alert_text_en.py"
    )
    _spec = importlib.util.spec_from_file_location("_mig_0037", _mig_path)
    _mig = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_mig)

    raw = json.dumps(
        {
            "id": "ALERT-CLOSED",
            "header_texts": [
                {"language": "fr", "text": "Ancienne alerte"},
                {"language": "en", "text": "Old alert"},
            ],
            "description_texts": [
                {"language": "fr", "text": "Texte ferme"},
                {"language": "en", "text": "Closed text"},
            ],
        }
    )
    # A superseded (valid_to set) HASHED row with NULL EN columns, mirroring a
    # row that existed before 0037's worker reached it.
    conn.execute(
        text(
            """
            INSERT INTO silver.i3_alerts (
                i3_alert_snapshot_id, alert_index, provider_id,
                alert_id, alert_header_text, description_text,
                severity, captured_at_utc, raw_alert_json,
                content_hash, first_seen_at, last_seen_at, valid_to
            )
            VALUES (
                :s, 0, :p, 'ALERT-CLOSED', 'Ancienne alerte', 'Texte ferme',
                'info', :t, CAST(:raw AS jsonb),
                'deadbeefdeadbeefdeadbeefdeadbeef', :t, :t, :t
            )
            """
        ),
        {"s": SNAP_IDS[0], "p": PROVIDER, "t": T1, "raw": raw},
    )

    # Run the migration's verbatim backfill SQL.
    conn.execute(text(_mig._BACKFILL_EN))

    row = dict(
        conn.execute(
            text(
                """
                SELECT alert_header_text_en, description_text_en, valid_to
                FROM silver.i3_alerts
                WHERE provider_id = :p AND alert_id = 'ALERT-CLOSED'
                """
            ),
            {"p": PROVIDER},
        )
        .mappings()
        .one()
    )
    assert row["valid_to"] is not None, "seed row must be superseded (valid_to set)"
    assert row["alert_header_text_en"] == "Old alert"
    assert row["description_text_en"] == "Closed text"
