from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace as NS
from unittest.mock import Mock

import pytest

from transit_ops.history import daily, ledger, store
from transit_ops.history import daily_selection as selection
from transit_ops.history.daily_selection import CaptureDay, CaptureDayStatus
from transit_ops.history.seal_captures import CopyContentMissing
from transit_ops.history.verify import Verification

NOW = datetime(2026, 11, 13, 12, tzinfo=UTC)
FEED = "capture.trip_updates"


def _database(s):
    conn = Mock()

    @contextmanager
    def begin():
        assert not s.active
        s.active = True
        try:
            yield
        finally:
            s.active = False

    def execute(sql, params=None):
        assert s.active
        query = str(sql)
        if "to_regclass" in query:
            return NS(scalar_one=lambda: None if params["name"] == s.missing else "exists")
        if "pipeline_switches" in query:
            return NS(one_or_none=lambda: s.switch)
        assert "SELECT now()" in query
        return NS(scalar_one=lambda: NOW)

    conn.begin.side_effect = begin
    conn.execute.side_effect = execute
    conn.in_transaction.side_effect = lambda: s.active
    conn.rollback.side_effect = lambda: setattr(s, "active", False)
    return conn


def _selection(s, monkeypatch):
    def providers(c, **kw):
        assert s.active
        return s.providers

    def days(c, **kw):
        assert s.active and all(("close", p) in s.calls for p in s.providers)
        s.selection = kw
        return sorted(s.days)

    def status(c, day, **kw):
        assert s.active and kw == {"now": NOW}
        return s.status.get(day, CaptureDayStatus("needs_work", "first_seal"))

    def close(c, **kw):
        assert s.active and kw == {"provider_id": kw["provider_id"], "actor": "operator"}
        s.calls.append(("close", kw["provider_id"]))
        return 2

    monkeypatch.setattr(selection, "capture_providers", providers)
    monkeypatch.setattr(selection, "capture_days", days)
    monkeypatch.setattr(selection, "capture_day_status", status)
    monkeypatch.setattr(daily, "close_unfinished_runs", close)


def _archive(s, monkeypatch):
    def seal(c, storage, **kw):
        assert not s.active and storage is s.storage
        s.calls.append(("seal", kw))
        s.t += s.seal_duration
        if s.failure:
            s.active = True
            raise s.failure
        return NS(state="verified" if s.current else "sealed")

    def copies(c, **kw):
        assert s.active and type(kw["start"]) is date and kw["start"] == kw["end"]
        return [NS(content_version=v, state=state) for v, state in s.copies]

    def verify(c, storage, copy, **kw):
        assert not s.active and storage is s.storage and kw == {"actor": "operator"}
        v = copy.content_version
        s.calls.append(("verify", v))
        rejected = s.reject == v
        if not rejected:
            s.current = v
        return Verification(
            NS(state="rejected" if rejected else "verified"),
            "rejected" if rejected else "verified",
            "stale" if rejected else None,
            None,
            not rejected,
        )

    monkeypatch.setattr(store, "seal", seal)
    monkeypatch.setattr(store, "verify", verify)
    monkeypatch.setattr(ledger, "find_copies", copies)
    monkeypatch.setattr(ledger, "window_state", lambda *a, **kw: NS(current_version=s.current))


@pytest.fixture
def runner(monkeypatch):
    s = NS(
        t=0,
        switch=(True, NOW),
        missing=None,
        days=[],
        status={},
        calls=[],
        copies=[],
        current=None,
        failure=None,
        reject=None,
        providers=["inactive"],
        active=False,
    )

    conn = _database(s)
    _selection(s, monkeypatch)
    _archive(s, monkeypatch)
    s.conn, s.storage, s.seal_duration = conn, Mock(), 0
    s.run = lambda **kw: daily.run_capture_history(
        conn,
        s.storage,
        **(
            dict(
                datasets=[FEED],
                archive_backend="local",
                sealed_by="test",
                actor="operator",
                clock=lambda: s.t,
            )
            | kw
        ),
    )
    s.days = [CaptureDay("inactive", FEED, date(2026, 11, 10))]
    return s


def test_newest_day_first_and_three_days_per_feed(runner):
    s = runner
    s.days = [
        CaptureDay(p, f, date(2026, 11, d))
        for d in range(5, 10)
        for p in ("inactive", "other")
        for f in (FEED, "capture.vehicle_positions")
    ]
    for day in s.days:
        if day.utc_date.day == 9:
            s.status[day] = CaptureDayStatus("unchanged", "same")
    s.failure = RuntimeError("private response")
    result = s.run()
    seals = [kw for op, kw in s.calls if op == "seal"]
    assert [kw["window_key"] for kw in seals] == [
        f"2026-11-{d:02}" for d in (8, 7, 6) for _ in range(4)
    ]
    assert not result.success and result.remaining_work
    assert len(result.errors) == 12 and all("private response" not in e for e in result.errors)


@pytest.mark.parametrize("duration", [0, 1, 2])
def test_time_budget_stops_between_days(runner, duration):
    s = runner
    s.days += [CaptureDay("inactive", FEED, date(2026, 11, 9))]
    s.copies = [(1, "sealed")]
    s.seal_duration = duration
    result = s.run(time_budget_seconds=1)
    assert result.success
    if duration:
        assert result.stop_reason == "time_budget" and result.remaining_work
        assert [op for op, _ in s.calls] == ["close", "seal", "verify"]
    else:
        assert result.stop_reason == "complete"


@pytest.mark.parametrize(
    "table", ["core.history_window", "core.history_archive_copy", "core.history_event"]
)
def test_missing_ledger_table_exits_cleanly(runner, table):
    runner.missing = table
    result = runner.run()
    assert result.success and result.stop_reason == "ledger_missing"
    assert runner.calls == []
    runner.storage.assert_not_called()


def test_inactive_provider_with_rows_is_sealed(runner):
    runner.copies = [(1, "sealed")]
    result = runner.run()
    assert result.success and result.counts["verified"] == 1
    assert runner.calls[1][1]["provider_id"] == "inactive"
    assert runner.calls[1][1]["sealed_by"] == "test"
    assert runner.calls[-1] == ("verify", 1)


@pytest.mark.parametrize("switch", [None, (False, NOW), "missing"])
def test_daily_switch_is_off_until_enabled(runner, switch):
    if switch == "missing":
        runner.missing = "core.pipeline_switches"
    else:
        runner.switch = switch
    assert runner.run().stop_reason == "disabled"
    assert runner.calls == []
    runner.storage.assert_not_called()


@pytest.mark.parametrize("changed", [(False, NOW), (True, NOW + timedelta(seconds=1))])
def test_switch_change_stops_next_day(runner, monkeypatch, changed):
    original = store.seal

    def seal(*a, **kw):
        runner.switch = changed
        return original(*a, **kw)

    monkeypatch.setattr(store, "seal", seal)
    runner.days += [CaptureDay("inactive", FEED, date(2026, 11, 9))]
    runner.copies = [(1, "sealed")]
    assert runner.run().stop_reason == "switch_changed"
    assert runner.calls[-1] == ("verify", 1)
    assert len([op for op, _ in runner.calls if op == "seal"]) == 1


def test_unfinished_runs_close_once_per_provider_before_selection(runner):
    runner.providers += ["only_unfinished"]
    runner.run(start=date(2026, 11, 9), end=date(2026, 11, 10))
    assert runner.calls[:2] == [("close", "inactive"), ("close", "only_unfinished")]
    assert runner.selection["start"] == date(2026, 11, 9)
    assert runner.selection["datasets"] == [FEED]


def test_sealed_versions_are_verified_after_a_reused_current_copy(runner):
    runner.current = 2
    runner.copies = [(4, "sealed"), (1, "sealed"), (2, "verified"), (3, "sealed"), (5, "rejected")]
    result = runner.run()
    assert result.success
    assert [v for op, v in runner.calls if op == "verify"] == [3, 4]


@pytest.mark.parametrize(
    "failure",
    [
        CopyContentMissing("missing poll"),
        NotImplementedError("trimmed day"),
        RuntimeError("private"),
    ],
)
def test_refused_and_rejected_days_do_not_stop_other_days(runner, monkeypatch, failure):
    runner.failure = failure
    runner.copies = [(1, "sealed"), (2, "sealed")]
    runner.reject = 1
    runner.days += [CaptureDay("inactive", FEED, date(2026, 11, 9))]
    runner.status[runner.days[-1]] = CaptureDayStatus("refused", "trimmed_work_requires_union")
    runner.days += [CaptureDay("inactive", FEED, date(2026, 11, 8))]
    original = store.seal

    def fail_once(*a, **kw):
        try:
            return original(*a, **kw)
        finally:
            runner.failure = None

    monkeypatch.setattr(store, "seal", fail_once)
    result = runner.run()
    assert not result.success and len(result.outcomes) == 3
    assert result.outcomes[-1].state == "completed"
    assert [v for op, v in runner.calls if op == "verify"] == [1, 2]
    assert not runner.active


def test_next_run_resumes_after_an_interrupted_day(runner):
    runner.failure = RuntimeError("interrupted")
    assert not runner.run().success
    runner.failure = None
    runner.copies = [(1, "sealed")]
    assert runner.run().success
    assert [v for op, v in runner.calls if op == "verify"] == [1]


def test_first_seal_warning_and_remaining_work_are_reported(runner):
    runner.status[runner.days[0]] = CaptureDayStatus("needs_work", "first_seal", True)
    runner.days += [CaptureDay("inactive", FEED, date(2026, 11, 9))]
    result = runner.run(max_days_per_feed=1)
    assert result.warnings and result.remaining_work
    assert result.counts["deferred"] == 1 and result.stop_reason == "day_cap"


@pytest.mark.parametrize(
    "kw",
    [
        dict(start="bad"),
        dict(start=date(2026, 2, 2), end=date(2026, 2, 1)),
        dict(time_budget_seconds=0),
        dict(time_budget_seconds=float("nan")),
        dict(max_days_per_feed=4),
        dict(max_days_per_feed=True),
        dict(datasets=["unknown"]),
        dict(archive_backend="bad"),
        dict(sealed_by=""),
        dict(actor=""),
    ],
)
def test_daily_arguments_are_checked_before_io(runner, kw):
    with pytest.raises((ValueError, LookupError)):
        runner.run(**kw)
    runner.conn.execute.assert_not_called()


def test_permission_errors_propagate(runner):
    runner.conn.execute.side_effect = PermissionError("denied")
    with pytest.raises(PermissionError):
        runner.run()
    assert runner.calls == []


@pytest.mark.parametrize("at", ["preflight", "status"])
def test_deadline_before_first_day_does_not_start_work(runner, monkeypatch, at):
    if at == "preflight":
        runner.run(clock=iter([0, 1]).__next__, time_budget_seconds=1)
        runner.conn.execute.assert_not_called()
    else:
        original = selection.capture_day_status

        def status(*a, **kw):
            runner.t = 1
            return original(*a, **kw)

        monkeypatch.setattr(selection, "capture_day_status", status)
        result = runner.run(time_budget_seconds=1)
        assert result.stop_reason == "time_budget"
    assert not any(op == "seal" for op, _ in runner.calls)


def test_failed_verification_continues_and_resumes_next_run(runner, monkeypatch):
    original = store.verify

    def fail(*a, **kw):
        runner.active = True
        raise RuntimeError("private body")

    monkeypatch.setattr(store, "verify", fail)
    runner.copies = [(1, "sealed")]
    assert not runner.run().success
    assert not runner.active
    monkeypatch.setattr(store, "verify", original)
    assert runner.run().success


def test_provider_discovery_includes_open_day_attempts():
    conn = Mock()
    conn.execute.return_value.scalars.return_value = ["inactive"]
    assert selection.capture_providers(conn, now=NOW) == ["inactive"]
    params = conn.execute.call_args.args[1]
    assert params["qualify_from"] == datetime.min.replace(tzinfo=UTC)
    assert params["end_at"] == NOW


def test_cancellation_propagates(runner, monkeypatch):
    monkeypatch.setattr(store, "seal", Mock(side_effect=KeyboardInterrupt))
    with pytest.raises(KeyboardInterrupt):
        runner.run()


def test_status_failure_is_a_day_failure(runner, monkeypatch):
    monkeypatch.setattr(selection, "capture_day_status", Mock(side_effect=RuntimeError("private")))
    result = runner.run()
    assert not result.success and result.counts["failed"] == 1
    assert "private" not in result.errors[0] and not runner.active
