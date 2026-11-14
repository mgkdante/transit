from dataclasses import replace
from datetime import UTC, date, datetime

import pytest

from transit_ops.gold.alert_archive import prepare_recovered_archive_record
from transit_ops.history.alert_recovery import recover_alert_archive_entries
from transit_ops.history.alert_recovery_models import (
    Candidate,
    RecoveryReport,
    SourceReport,
    unrecovered_ids,
)

NOW = datetime(2026, 11, 14, tzinfo=UTC)
KINDS = ("backup", "published", "capture")
REPORTS = tuple(SourceReport(k, coverage=("synthetic bounded scan",), complete=True) for k in KINDS)


def candidate(provider, identity="a", kind="backup"):
    row = prepare_recovered_archive_record(
        dict(
            alert_id=identity,
            archive_month=date(2020, 1, 1),
            first_seen_utc="2020-01-02T00:00:00Z",
            last_seen_utc="2026-11-01T00:00:00Z",
            description_text="Travaux",
            description_text_en="Works",
            message=None,
            route_ids=[],
            stop_ids=[],
            active_periods=[],
        ),
        provider_id=provider,
        recovered_at_utc=NOW.replace(day=13),
    )
    return Candidate(provider, identity, date(2020, 1, 1), row, kind, "synthetic scan")


@pytest.mark.parametrize("reports", [[], iter(())])
def test_no_reports_means_unknown(reports):
    assert unrecovered_ids(["missing"], [], reports) is None


@pytest.mark.parametrize(
    "evidence",
    [
        {},
        {"coverage": ("scan",), "missing": ("object",)},
        {"coverage": ("scan",), "errors": ("invalid",)},
    ],
)
def test_complete_source_requires_consistent_evidence(evidence):
    with pytest.raises(ValueError):
        SourceReport("backup", complete=True, **evidence)


@pytest.mark.parametrize("reports", [(), REPORTS[:1], REPORTS + REPORTS[:1]])
def test_recovery_cannot_claim_complete_without_exact_source_inventory(reports):
    with pytest.raises(ValueError):
        RecoveryReport("p", True, reports, NOW, complete=True)


@pytest.mark.parametrize("kind", KINDS)
def test_each_missing_or_incomplete_source_keeps_loss_unknown(kind):
    for reports in (
        tuple(r for r in REPORTS if r.kind != kind),
        tuple(replace(r, complete=False) if r.kind == kind else r for r in REPORTS),
    ):
        with pytest.raises(ValueError):
            RecoveryReport("p", True, reports, NOW, unrecovered_expected_ids=())
        assert not RecoveryReport("p", True, reports, NOW).complete


def test_conflict_blocks_complete_but_not_qualified_inventory():
    with pytest.raises(ValueError):
        RecoveryReport("p", True, REPORTS, NOW, conflicts=("a",), complete=True)
    assert RecoveryReport("p", True, REPORTS, NOW, complete=True).complete
    assert unrecovered_ids(None, (), REPORTS) is None
    assert unrecovered_ids(["z", "a", "z"], ["a"], REPORTS) == ("z",)


@pytest.mark.parametrize(
    "provider,reports,items",
    [
        ("", REPORTS, ()),
        ("p", REPORTS + REPORTS[:1], ()),
        ("p", (SourceReport("unknown"),), ()),
        ("p", REPORTS[:1], (candidate("p", kind="capture"),)),
        ("p", REPORTS, (replace(candidate("p"), provider_id=""),)),
        ("p", REPORTS, (replace(candidate("p"), alert_id="wrong"),)),
    ],
)
def test_planner_refuses_invalid_evidence_before_using_connection(provider, reports, items):
    with pytest.raises(ValueError):
        recover_alert_archive_entries(
            None,
            provider_id=provider,
            candidates=items,
            source_reports=reports,
            recovered_at_utc=NOW,
        )
