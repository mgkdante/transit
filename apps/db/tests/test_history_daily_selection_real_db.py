import hashlib
import json
from datetime import UTC, date, datetime, timedelta

import pytest
from history_fixtures import seed_working_day
from sqlalchemy import text

from transit_ops.history import ledger
from transit_ops.history.daily_selection import CaptureDay, capture_day_status, capture_days
from transit_ops.history.datasets import utc_day_closes_at
from transit_ops.history.working_captures import rows_fingerprint

P = "daily_selection_test"
DS = "capture.trip_updates"
AT = datetime(2026, 1, 2, tzinfo=UTC)
DAY = CaptureDay(P, DS, AT.date())
NOW = utc_day_closes_at(DAY.utc_date) + timedelta(days=10)


@pytest.fixture
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection, connection.begin() as transaction:
        seed_provider(connection, P, display_name="Daily selection test")
        yield connection
        transaction.rollback()


def seed(conn, **kwargs):
    return seed_working_day(
        conn,
        provider_id=P,
        endpoint_key="trip_updates",
        started_at_utc=kwargs.pop("started_at_utc", AT),
        **kwargs,
    )


def days(conn, start=DAY.utc_date, end=DAY.utc_date, empty_since=None):
    return [
        d
        for d in capture_days(conn, datasets=(DS,), start=start, end=end, empty_since=empty_since)
        if d.provider_id == P
    ]


def status(conn, day=DAY, now=NOW):
    return capture_day_status(conn, day, now=now)


def window(conn, day=DAY):
    ledger.allocate_version(
        conn, dataset_id=day.dataset_id, provider_id=P, window_key=day.utc_date.isoformat()
    )


def copy(conn, version=1, state="verified", day=DAY):
    fingerprint = rows_fingerprint(
        conn, provider_id=P, endpoint_key="trip_updates", utc_date=day.utc_date
    )
    conn.execute(
        text("""
        INSERT INTO core.history_archive_copy
        (dataset_id,provider_id,revision,window_key,content_version,schema_version,
         storage_backend,allocated_at_utc,sealed_at_utc,verified_at_utc,details)
        VALUES (:ds,:p,0,:key,:v,1,'local',:at,:sealed,:verified,CAST(:details AS jsonb))
    """),
        dict(
            ds=DS,
            p=P,
            key=day.utc_date.isoformat(),
            v=version,
            at=AT,
            sealed=None if state == "allocated" else AT,
            verified=NOW if state == "verified" else None,
            details=json.dumps({"rows_fingerprint": fingerprint}),
        ),
    )
    if state == "verified":
        conn.execute(
            text(
                "UPDATE core.history_window SET current_version=:v, "
                "working_changed_at_utc=:at WHERE provider_id=:p AND window_key=:key"
            ),
            dict(v=version, at=AT, p=P, key=day.utc_date.isoformat()),
        )


def test_inactive_provider_with_rows_is_sealed(conn):
    seed(conn)
    conn.execute(text("UPDATE core.providers SET is_active=false WHERE provider_id=:p"), {"p": P})
    assert days(conn) == [DAY]
    assert status(conn).reason == "first_seal"


def test_failed_only_and_processing_only_days_are_selected(conn):
    seed(conn, status="failed", with_capture=False)
    seed(
        conn,
        run_id=2,
        started_at_utc=AT - timedelta(days=1),
        status="failed",
        with_capture=False,
        run_kind="silver_load",
    )
    assert days(conn, AT.date() - timedelta(days=1)) == [DAY, CaptureDay(P, DS, date(2026, 1, 1))]
    assert status(conn).state == "needs_work"
    assert status(conn, CaptureDay(P, DS, date(2026, 1, 1))).reason == "first_seal"


def test_selection_finds_an_in_place_edit_and_new_processing_evidence(conn):
    seed(conn, status="failed", with_capture=False)
    window(conn)
    copy(conn)
    assert status(conn).state == "unchanged"
    conn.execute(
        text("UPDATE raw.ingestion_runs SET error_message='changed' WHERE provider_id=:p"), {"p": P}
    )
    assert status(conn).reason == "working_changed"
    conn.execute(
        text("UPDATE raw.ingestion_runs SET error_message=NULL WHERE provider_id=:p"), {"p": P}
    )
    ledger.record_processing_evidence(
        conn,
        dataset_id=DS,
        provider_id=P,
        window_key=DAY.utc_date.isoformat(),
        command="load",
        completed_at_utc=NOW,
        rows_by_capture={},
    )
    assert status(conn).reason == "working_changed"


def test_interrupted_copies_and_ledger_only_days_are_selected(conn):
    seed(conn, status="failed", with_capture=False)
    window(conn)
    copy(conn, version=2)
    copy(conn, version=1, state="sealed")
    assert status(conn).state == "unchanged"
    copy(conn, version=3, state="sealed")
    assert status(conn).reason == "verification_pending"
    copy(conn, version=4, state="allocated")
    assert status(conn).reason == "repair_pending"
    conn.execute(text("DELETE FROM raw.ingestion_runs WHERE provider_id=:p"), {"p": P})
    assert days(conn) == [DAY]


def test_empty_days_do_not_relabel_unproven_history(conn):
    seed(conn, status="failed", with_capture=False)
    conn.execute(
        text("UPDATE core.feed_endpoints SET created_at_utc=:at WHERE provider_id=:p"),
        dict(at=AT, p=P),
    )
    tomorrow = AT.date() + timedelta(days=1)
    assert days(conn, end=tomorrow) == [DAY]
    selected = days(conn, end=tomorrow, empty_since=AT)
    assert selected[0].utc_date == tomorrow
    assert status(conn, selected[0]).reason == "first_seal"
    assert days(conn, end=tomorrow, empty_since=AT + timedelta(days=1, seconds=1)) == [DAY]
    gap = CaptureDay(P, DS, AT.date() - timedelta(days=1))
    assert status(conn, gap).reason == "unproven_gap"
    window(conn, gap)
    conn.execute(
        text("UPDATE core.history_window SET working_state='empty' WHERE provider_id=:p"), {"p": P}
    )
    assert status(conn, gap).reason == "first_seal"
    copy(conn, day=gap)
    assert status(conn, gap).state == "unchanged"
    assert gap in days(conn, start=gap.utc_date)
    conn.execute(
        text("UPDATE core.feed_endpoints SET created_at_utc=:at WHERE provider_id=:p"),
        dict(at=AT + timedelta(days=1, seconds=1), p=P),
    )
    assert days(conn, end=tomorrow, empty_since=AT) == [DAY]
    later = AT.date() + timedelta(days=2)
    assert days(conn, end=later, empty_since=AT)[0].utc_date == later


def test_partial_day_uses_its_remainder_and_refuses_new_work(conn):
    seed(conn, status="failed", with_capture=False)
    window(conn)
    copy(conn)
    fingerprint = rows_fingerprint(
        conn, provider_id=P, endpoint_key="trip_updates", utc_date=AT.date()
    )
    conn.execute(
        text("UPDATE core.history_window SET working_state='partial' WHERE provider_id=:p"),
        {"p": P},
    )
    assert status(conn).state == "refused"
    ledger.record_event(
        conn,
        kind="trim",
        dataset_id=DS,
        provider_id=P,
        revision=0,
        window_key=DAY.utc_date.isoformat(),
        details={"remainder_fingerprint": fingerprint},
    )
    assert status(conn).state == "unchanged"
    conn.execute(
        text("UPDATE raw.ingestion_runs SET error_message='late' WHERE provider_id=:p"), {"p": P}
    )
    before = ledger.window_state(
        conn, dataset_id=DS, provider_id=P, window_key=DAY.utc_date.isoformat()
    )
    assert status(conn).reason == "trimmed_work_requires_union"
    assert (
        ledger.window_state(conn, dataset_id=DS, provider_id=P, window_key=DAY.utc_date.isoformat())
        == before
    )
    conn.execute(text("DELETE FROM raw.ingestion_runs WHERE provider_id=:p"), {"p": P})
    conn.execute(text("DELETE FROM core.history_event WHERE provider_id=:p"), {"p": P})
    conn.execute(
        text("UPDATE core.history_window SET working_state='trimmed' WHERE provider_id=:p"),
        {"p": P},
    )
    assert hashlib.sha256(b"").hexdigest() != fingerprint
    assert status(conn).state == "unchanged"
    seed(conn, run_id=2, status="failed", with_capture=False)
    assert status(conn).reason == "trimmed_work_requires_union"
    conn.execute(
        text("UPDATE core.history_window SET hold_reason='ledger_rebuilt' WHERE provider_id=:p"),
        {"p": P},
    )
    assert status(conn).reason == "rebuilt_verification_required"


def test_day_selection_uses_poll_start_and_the_exact_close_boundary(conn):
    seed(
        conn,
        started_at_utc=AT + timedelta(hours=23, minutes=59),
        captured_at_utc=AT + timedelta(days=1, seconds=5),
    )
    assert days(conn, end=AT.date() + timedelta(days=1)) == [DAY]
    close = utc_day_closes_at(DAY.utc_date)
    assert status(conn, now=close - timedelta(microseconds=1)).reason == "still_open"
    assert status(conn, now=close).state == "needs_work"


def test_invalid_current_pointer_is_not_treated_as_unsealed(conn):
    window(conn)
    conn.execute(
        text("UPDATE core.history_window SET current_version=1 WHERE provider_id=:p"), {"p": P}
    )
    with pytest.raises(RuntimeError, match="current"):
        status(conn)
    seed(conn, status="failed", with_capture=False)
    copy(conn, state="sealed")
    with pytest.raises(RuntimeError, match="current"):
        status(conn)
    conn.execute(
        text("UPDATE core.history_archive_copy SET verified_at_utc=:at WHERE provider_id=:p"),
        dict(at=NOW, p=P),
    )
    conn.execute(
        text(
            "UPDATE core.history_archive_copy SET rejected_at_utc=:at, "
            "reject_reason='stale' WHERE provider_id=:p"
        ),
        dict(at=NOW, p=P),
    )
    with pytest.raises(RuntimeError, match="current"):
        status(conn)


def test_first_seal_warning_starts_seven_days_after_close(conn):
    seed(conn, status="failed", with_capture=False)
    boundary = utc_day_closes_at(DAY.utc_date) + timedelta(days=7)
    assert not status(conn, now=boundary - timedelta(microseconds=1)).overdue_first_seal
    assert status(conn, now=boundary).overdue_first_seal
    window(conn)
    copy(conn, state="sealed")
    assert not status(conn).overdue_first_seal


@pytest.mark.parametrize("endpoint", ["vehicle_positions", "i3_alerts", "service_alerts"])
def test_other_declared_capture_feeds_are_selected(conn, endpoint):
    seed_working_day(
        conn,
        provider_id=P,
        endpoint_key=endpoint,
        started_at_utc=AT,
        status="failed",
        with_capture=False,
    )
    selected = capture_days(
        conn, datasets=("capture." + endpoint,), start=AT.date(), end=AT.date(), empty_since=None
    )
    day = CaptureDay(P, "capture." + endpoint, AT.date())
    assert day in selected
    assert status(conn, day).reason == "first_seal"


def test_old_evidence_is_selected_inside_an_explicit_range(conn):
    old = AT - timedelta(days=401)
    seed(conn, started_at_utc=old, status="failed", with_capture=False)
    selected = days(conn, start=old.date(), end=old.date(), empty_since=AT)
    assert selected == [CaptureDay(P, DS, old.date())]
    assert status(conn, selected[0]).reason == "first_seal"
    assert days(conn, empty_since=AT) == []


@pytest.mark.parametrize("form", ["partial", "trimmed"])
@pytest.mark.parametrize("pending", ["allocated", "sealed"])
def test_trimmed_forms_refuse_pending_copies(conn, form, pending):
    seed(conn, status="failed", with_capture=False)
    window(conn)
    copy(conn)
    copy(conn, version=2, state=pending)
    fingerprint = rows_fingerprint(
        conn, provider_id=P, endpoint_key="trip_updates", utc_date=DAY.utc_date
    )
    ledger.record_event(
        conn,
        kind="trim",
        dataset_id=DS,
        provider_id=P,
        revision=0,
        window_key=DAY.utc_date.isoformat(),
        details={"remainder_fingerprint": fingerprint},
    )
    conn.execute(
        text("UPDATE core.history_window SET working_state=:form WHERE provider_id=:p"),
        dict(form=form, p=P),
    )
    assert status(conn).reason == "trimmed_work_requires_union"


def test_provider_discovery_can_use_the_bounded_run_index(conn):
    from transit_ops.history.daily_selection import _PROVIDERS

    seed(conn, status="failed", with_capture=False)
    conn.execute(text("SET LOCAL enable_seqscan=off"))
    plan = conn.execute(
        text("EXPLAIN (FORMAT JSON, COSTS OFF) " + _PROVIDERS),
        dict(
            capture_feeds=["trip_updates"],
            capture_ids=[DS],
            qualify_from=AT,
            end_at=AT + timedelta(days=1),
        ),
    ).scalar_one()

    def nodes(node):
        yield node
        for child in node.get("Plans", []):
            yield from nodes(child)

    scan = next(
        node
        for node in nodes(plan[0]["Plan"])
        if node.get("Index Name") == "ix_ingestion_runs_provider_endpoint_started"
    )
    condition = scan["Index Cond"]
    assert all(
        column in condition
        for column in ("provider_id", "feed_endpoint_id", "started_at_utc", ">=", "<")
    )


def test_empty_calendar_starts_after_endpoint_creation(conn):
    from transit_ops.history.daily_selection import _DAYS

    seed(conn, status="failed", with_capture=False)
    conn.execute(text("UPDATE core.feed_endpoints SET created_at_utc=:at WHERE provider_id=:p"),
                 dict(at=AT + timedelta(hours=1), p=P))
    assert [d.utc_date for d in days(conn, start=date.min, end=date(2026, 1, 4),
                                   empty_since=AT)] == [date(2026, 1, d) for d in (4, 3, 2)]
    plan = conn.execute(text("EXPLAIN (ANALYZE, FORMAT JSON) " + _DAYS), dict(
        endpoint="trip_updates", dataset=DS, providers=[P], start_day=date.min,
        end_day=date(2026, 1, 4), start_at=datetime.min.replace(tzinfo=UTC),
        end_at=AT + timedelta(days=3), empty_at=AT, empty_start_day=AT.date(),
    )).scalar_one()
    pending, generated = [plan[0]["Plan"]], []
    while pending:
        node = pending.pop()
        pending.extend(node.get("Plans", []))
        if node["Node Type"] == "Function Scan":
            generated.append(node["Actual Rows"] + node.get("Rows Removed by Filter", 0))
    assert generated and max(generated) == 2
