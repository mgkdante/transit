import json
from copy import deepcopy
from dataclasses import replace

import pytest
from test_ranking_engine import IDS, VECTORS, check_vector, row_from, spec_from

from transit_ops.ranking import RULES, RankedEntity, measure_state, rank_entities

CASE = json.loads(VECTORS.read_bytes())["vectors"][8]["cases"][0]
SPEC = spec_from(CASE["spec"])


def row(**changes):
    return replace(row_from(CASE["rows"][0]), **changes)


def state(entity, spec=SPEC, *, window_days=7, rules=RULES, network=None):
    return measure_state(entity, spec, window_days=window_days, rules=rules, network=network)


@pytest.mark.parametrize(
    "changes,expected",
    [
        ({"live_data": "no_live_data", "counts": {}, "measured_days": {}}, "no_live_data"),
        ({"live_data": "unresolved", "measured_days": {}}, "not_measured"),
        ({"scheduled_days": 0}, "not_measured"),
        ({"measured_days": {"reliability": 3}, "counts": {}}, "not_measured"),
        ({"counts": {"trips": 29}, "reading_days": 0}, "too_few_trips"),
        ({"reading_days": 4}, "too_few_service_days"),
    ],
)
def test_first_applicable_state(changes, expected):
    assert state(row(**changes)) == expected


@pytest.mark.parametrize("group", IDS[8:])
def test_state_vectors(group):
    check_vector(group)


@pytest.mark.parametrize(
    "changes,window",
    [
        ({}, 0),
        ({"scheduled_days": -1}, 7),
        ({"reading_days": -1}, 7),
        ({"measured_days": {"reliability": -1}}, 7),
    ],
)
def test_invalid_days_refuse(changes, window):
    with pytest.raises(ValueError):
        state(row(**changes), window_days=window)


@pytest.mark.parametrize(
    "window,scheduled,floor",
    [
        (1, 1, 1),
        (2, 1, 2),
        (3, 2, 3),
        (4, 2, 4),
        (7, 2, 4),
        (7, 4, 4),
        (7, 7, 5),
        (30, 8, 8),
        (30, 30, 15),
        (31, 31, 16),
        (90, 26, 26),
    ],
)
def test_literal_floor(window, scheduled, floor):
    for days, expected in [(floor - 1, "too_few_service_days"), (floor, "ranked")]:
        entity = row(
            scheduled_days=scheduled, reading_days=days, measured_days={"reliability": scheduled}
        )
        assert state(entity, window_days=window) == expected


@pytest.mark.parametrize(
    "measured,reading,expected",
    [
        (4, 5, "ranked"),
        (3, 5, "not_measured"),
        (5, 0, "too_few_service_days"),
    ],
)
def test_measurement_is_independent_of_readings(measured, reading, expected):
    entity = row(scheduled_days=5, reading_days=reading, measured_days={"reliability": measured})
    assert state(entity) == expected


def test_state_groups_keep_full_results_and_code_point_order():
    spec = replace(SPEC, floor_units=30, floor_units_of="late")
    entries = [
        ("ranked", {}, 90, 100, 900),
        ("too_few_trips", {"counts": dict(row().counts, trips=29)}, 90, 100, 900),
        ("too_few_service_days", {"reading_days": 0}, 90, 100, 900),
        ("too_few_units", {"counts": dict(row().counts, n=0)}, 90, 0, None),
        ("not_defined", {"counts": dict(row().counts, late=30, n=0)}, 90, 0, None),
        ("not_measured", {"scheduled_days": 0}, None, None, None),
        ("no_live_data", {"live_data": "no_live_data", "counts": {}}, None, None, None),
    ]
    entities, expected = [], []
    for status, changes, n, d, units in entries:
        for name in ["É", "𐀀"]:
            entity = row(entity_id=status + name, **changes)
            if status == "ranked":
                entity = replace(entity, counts=dict(entity.counts, late=30))
            entities.append(entity)
            expected.append(
                RankedEntity(
                    entity.entity_id, status, None, 1 if status == "ranked" else None, n, d, units
                )
            )
    assert rank_entities(entities[::-1], spec=spec, window_days=7, rules=RULES) == expected


@pytest.mark.parametrize(
    "changes,error",
    [
        ({"measured_days": {}}, KeyError),
        ({"counts": {}}, KeyError),
        ({"counts": dict(row().counts, n=-1)}, ValueError),
    ],
)
def test_missing_or_invalid_evidence_refuses(changes, error):
    with pytest.raises(error):
        state(row(**changes))


def test_network_pair_rules_reasons_and_immutable_inputs():
    spec = replace(SPEC, denominator_from="network")
    entity, network = row(), {"n": 200}
    before = deepcopy((entity, spec, RULES, network))
    assert rank_entities([entity], spec=spec, window_days=7, rules=RULES, network=network) == [
        RankedEntity("a", "ranked", None, 1, 90, 200, 450)
    ]
    assert state(entity, replace(SPEC, pair=spec).pair, network={"n": 0}) == "not_defined"
    for supplied, error in [(None, ValueError), ({}, KeyError)]:
        with pytest.raises(error):
            state(entity, spec, network=supplied)
    assert (entity, spec, RULES, network) == before
    partial = row(measured_days={"reliability": 5})
    assert state(partial, rules=replace(RULES, measured_share=(1, 2))) == "ranked"
    assert (
        state(row(reading_days=4), rules=replace(RULES, service_day_base={"trailing_7": 4}))
        == "ranked"
    )
    for reason in [None, "schedule_not_kept"]:
        absent = row(
            scheduled_days=0, not_measured_reason={} if reason is None else {"reliability": reason}
        )
        assert rank_entities([absent], spec=SPEC, window_days=7, rules=RULES) == [
            RankedEntity("a", "not_measured", reason, None, None, None, None)
        ]


@pytest.mark.parametrize("changes", [{"scale": (0, 1)}, {"precision": -1}])
def test_invalid_arithmetic_refuses_even_without_a_value(changes):
    entity = row(counts=dict(row().counts, n=0))
    with pytest.raises(ValueError):
        rank_entities([entity], spec=replace(SPEC, **changes), window_days=7, rules=RULES)


@pytest.mark.parametrize(
    "window,scheduled,reading,trips,expected",
    [
        (30, 8, 7, 30, "too_few_service_days"),
        (30, 8, 8, 30, "ranked"),
        (30, 8, 8, 29, "too_few_trips"),
        (1, 1, 1, 30, "ranked"),
    ],
)
def test_sparse_service_still_requires_trips(window, scheduled, reading, trips, expected):
    entity = row(
        scheduled_days=scheduled,
        reading_days=reading,
        measured_days={"reliability": scheduled},
        counts=dict(row().counts, trips=trips),
    )
    assert state(entity, window_days=window) == expected


def test_unranked_inputs_do_not_take_positions_and_unresolved_overrides_reason():
    absent = row(
        entity_id="c",
        live_data="unresolved",
        not_measured_reason={"reliability": "schedule_not_kept"},
    )
    better = row(entity_id="b", counts=dict(row().counts, on_time=100))
    assert rank_entities([absent, better, row()], spec=SPEC, window_days=7, rules=RULES) == [
        RankedEntity("a", "ranked", None, 1, 90, 100, 900),
        RankedEntity("b", "ranked", None, 2, 100, 100, 1000),
        RankedEntity("c", "not_measured", "applicability_unresolved", None, None, None, None),
    ]
