from datetime import UTC, datetime

import pytest

from transit_ops.source_factory.models import FactoryPhase, PhaseStatus, SourceFactoryResult


def test_source_factory_result_display_dict_is_stable() -> None:
    result = SourceFactoryResult(
        provider_id="stm",
        execute=False,
        started_at_utc=datetime(2026, 5, 25, 12, 0, tzinfo=UTC),
        completed_at_utc=datetime(2026, 5, 25, 12, 1, tzinfo=UTC),
        phase_status={FactoryPhase.PREFLIGHT: PhaseStatus.OK},
        artifacts={"preflight": "artifacts/slice-8.6/preflight.json"},
        summaries={"r2_inventory": {"known_keep": 3, "unknown_prefix": 1}},
    )

    assert result.display_dict()["phase_status"] == {"preflight": "ok"}
    assert result.display_dict()["summaries"]["r2_inventory"]["unknown_prefix"] == 1


def test_source_factory_result_display_dict_serializes_nested_enums() -> None:
    result = SourceFactoryResult(
        provider_id="stm",
        execute=False,
        started_at_utc=datetime(2026, 5, 25, 12, 0, tzinfo=UTC),
        completed_at_utc=None,
        phase_status={FactoryPhase.PARITY: PhaseStatus.SKIPPED},
        artifacts={
            "final": {
                FactoryPhase.FINAL_REPORT: [PhaseStatus.OK],
            },
        },
        summaries={
            FactoryPhase.PARITY: [PhaseStatus.SKIPPED],
        },
    )

    payload = result.display_dict()

    assert payload["artifacts"] == {"final": {"final_report": ["ok"]}}
    assert payload["summaries"] == {"parity": ["skipped"]}
    assert type(payload["artifacts"]["final"]["final_report"][0]) is str
    assert type(payload["summaries"]["parity"][0]) is str


def test_source_factory_result_display_dict_rejects_unsupported_summary_values() -> None:
    result = SourceFactoryResult(
        provider_id="stm",
        execute=False,
        started_at_utc=datetime(2026, 5, 25, 12, 0, tzinfo=UTC),
        completed_at_utc=None,
        phase_status={FactoryPhase.PREFLIGHT: PhaseStatus.OK},
        artifacts={},
        summaries={"unsupported": object()},
    )

    with pytest.raises(TypeError):
        result.display_dict()
