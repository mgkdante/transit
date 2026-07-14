import pytest
from pydantic import ValidationError

from transit_ops.snapshots import contract


def _historic_model(name: str):
    model = getattr(contract, name, None)
    assert model is not None, f"missing {name} retained-history contract"
    return model


def test_historic_hotspots_day_requires_a_real_self_identifying_date():
    historic_hotspots_day = _historic_model("HistoricHotspotsDay")

    parsed = historic_hotspots_day(
        generated_utc="2026-07-13T12:00:00Z",
        date="2026-07-13",
    )
    assert parsed.date == "2026-07-13"

    with pytest.raises(ValidationError):
        historic_hotspots_day(generated_utc="2026-07-13T12:00:00Z")
    with pytest.raises(ValidationError):
        historic_hotspots_day(
            generated_utc="2026-07-13T12:00:00Z",
            date="2026-02-30",
        )


def test_historic_hotspots_day_enforces_canonical_grain_identity_and_order():
    historic_hotspots_day = _historic_model("HistoricHotspotsDay")
    valid = [
        {"grain": "day", "date": "2026-07-13", "window_end": "2026-07-13"},
        {"grain": "week", "date": "2026-07-07", "window_end": "2026-07-13"},
        {"grain": "month", "date": "2026-06-14", "window_end": "2026-07-13"},
        {"grain": "shift", "date": None, "window_end": None},
    ]

    parsed = historic_hotspots_day(
        generated_utc="2026-07-13T12:00:00Z",
        date="2026-07-13",
        by_grain=valid,
    )
    assert [grain.grain for grain in parsed.by_grain] == ["day", "week", "month", "shift"]
    assert [
        grain.grain
        for grain in historic_hotspots_day(
            generated_utc="2026-07-13T12:00:00Z",
            date="2026-07-13",
            by_grain=[valid[2]],
        ).by_grain
    ] == ["month"]

    invalid_grain_sets = [
        [{"grain": "nonsense", "date": None, "window_end": None}],
        [valid[0], valid[0]],
        [valid[1], valid[0]],
        [{"grain": "day", "date": "2026-07-12", "window_end": "2026-07-13"}],
        [{"grain": "week", "date": "2026-07-07", "window_end": "2026-07-12"}],
        [{"grain": "month", "date": "2026-06-15", "window_end": "2026-07-13"}],
        [{"grain": "shift", "date": "2026-07-07", "window_end": "2026-07-13"}],
    ]
    for grains in invalid_grain_sets:
        with pytest.raises(ValidationError):
            historic_hotspots_day(
                generated_utc="2026-07-13T12:00:00Z",
                date="2026-07-13",
                by_grain=grains,
            )


def test_historic_repeat_offenders_day_and_grains_require_exact_window_dates():
    historic_repeat_offender_grain = _historic_model("HistoricRepeatOffenderGrain")
    historic_repeat_offenders_day = _historic_model("HistoricRepeatOffendersDay")

    grain = historic_repeat_offender_grain(
        grain="week",
        date="2026-07-07",
        window_end="2026-07-13",
        window_days=7,
    )
    parsed = historic_repeat_offenders_day(
        generated_utc="2026-07-13T12:00:00Z",
        date="2026-07-13",
        by_grain=[grain],
    )
    assert parsed.date == "2026-07-13"
    assert parsed.by_grain[0].date == "2026-07-07"
    assert parsed.by_grain[0].window_end == "2026-07-13"
    assert (
        historic_repeat_offender_grain(
            grain="month",
            date="2026-06-14",
            window_end="2026-07-13",
        ).window_days
        is None
    )
    month = historic_repeat_offender_grain(
        grain="month",
        date="2026-06-14",
        window_end="2026-07-13",
    )
    assert (
        historic_repeat_offenders_day(
            generated_utc="2026-07-13T12:00:00Z",
            date="2026-07-13",
        ).by_grain
        == []
    )

    for incomplete in (
        {"grain": "week", "date": "2026-07-07"},
        {"grain": "week", "window_end": "2026-07-13"},
    ):
        with pytest.raises(ValidationError):
            historic_repeat_offender_grain(**incomplete)

    for field, impossible in (("date", "2026-02-29"), ("window_end", "2026-04-31")):
        with pytest.raises(ValidationError):
            historic_repeat_offender_grain(
                **{
                    "grain": "month",
                    "date": "2026-06-14",
                    "window_end": "2026-07-13",
                    field: impossible,
                }
            )

    with pytest.raises(ValidationError):
        historic_repeat_offenders_day(generated_utc="2026-07-13T12:00:00Z")

    with pytest.raises(ValidationError):
        historic_repeat_offender_grain(
            grain="week",
            date="2026-07-14",
            window_end="2026-07-13",
        )
    with pytest.raises(ValidationError):
        historic_repeat_offender_grain(
            grain="week",
            date="2026-07-07",
            window_end="2026-07-13",
            window_days=6,
        )
    with pytest.raises(ValidationError):
        historic_repeat_offender_grain(
            grain="day",
            date="2026-07-13",
            window_end="2026-07-13",
        )
    with pytest.raises(ValidationError):
        historic_repeat_offender_grain(
            grain="week",
            date="2026-07-10",
            window_end="2026-07-13",
            window_days=4,
        )
    with pytest.raises(ValidationError):
        historic_repeat_offenders_day(
            generated_utc="2026-07-13T12:00:00Z",
            date="2026-07-12",
            by_grain=[grain],
        )
    with pytest.raises(ValidationError):
        historic_repeat_offenders_day(
            generated_utc="2026-07-13T12:00:00Z",
            date="2026-07-13",
            by_grain=[grain, grain],
        )
    with pytest.raises(ValidationError):
        historic_repeat_offenders_day(
            generated_utc="2026-07-13T12:00:00Z",
            date="2026-07-13",
            by_grain=[month, grain],
        )


def test_current_ranking_contracts_remain_date_free_and_backward_compatible():
    hotspots = contract.Hotspots(generated_utc="2026-07-13T12:00:00Z")
    repeat_offenders = contract.RepeatOffenders(generated_utc="2026-07-13T12:00:00Z")
    grain = contract.RepeatOffenderGrain(grain="week")

    assert not hasattr(hotspots, "date")
    assert not hasattr(repeat_offenders, "date")
    assert grain.grain == "week"
    assert contract.Hotspots.model_json_schema()["required"] == ["generated_utc"]
    assert contract.RepeatOffenders.model_json_schema()["required"] == ["generated_utc"]
