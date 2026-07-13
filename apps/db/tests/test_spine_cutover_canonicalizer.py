"""Offline checks for the calendar-stability layer in the real-DB spine gate."""

from __future__ import annotations

import importlib.util
from datetime import date
from pathlib import Path


def _gate_module():
    path = Path(__file__).with_name("test_spine_cutover_gate.py")
    spec = importlib.util.spec_from_file_location("spine_cutover_gate_helpers", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_day_grain_daytype_prior_is_neutralized_across_weekend_boundary() -> None:
    gate = _gate_module()
    canonical = {
        "periods_by_grain": [
            {
                "grain": "day",
                "by_daytype": [
                    {
                        "grain": "weekend",
                        "prior_observation_count": 8,
                        "prior_on_time": 4,
                        "prior_otp_pct": 50,
                    },
                    {"grain": "weekday"},
                ],
            }
        ]
    }

    gate._relativize_day_grain_calendar(canonical, date(2026, 7, 11))

    row = canonical["periods_by_grain"][0]["by_daytype"][0]
    assert row == {
        "grain": gate._ANCHOR_DAYKIND,
        "prior_observation_count": None,
        "prior_on_time": None,
        "prior_otp_pct": None,
    }
    assert canonical["periods_by_grain"][0]["by_daytype"][1] == {"grain": gate._ANCHOR_DAYKIND}
