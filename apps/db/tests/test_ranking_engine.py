import json
from dataclasses import asdict, fields
from pathlib import Path

from transit_ops.ranking import (
    RULES,
    EntityWindow,
    MeasureSpec,
    RankingRules,
    rank_entities,
    shown_units,
)

VECTORS = Path(__file__).parent / "fixtures" / "ranking_vectors.json"
IDS = (
    "half_exact",
    "half_not_exact_in_binary",
    "half_negative",
    "past_2_53",
    "shared_rank_keeps_exact_order",
    "id_code_point",
    "code_point_beyond_bmp",
    "operands_past_2_53",
)


def integers(value):
    return json.loads(json.dumps(value), parse_int=str)


def spec_from(data):
    data = dict(data)
    assert set(data) == {field.name for field in fields(MeasureSpec)}
    for key in ("precision", "floor_trips", "floor_units"):
        data[key] = None if data[key] is None else int(data[key])
    data["scale"] = tuple(map(int, data["scale"]))
    data["pair"] = None if data["pair"] is None else spec_from(data["pair"])
    return MeasureSpec(**data)


def rules_from(data):
    assert set(data) == {field.name for field in fields(RankingRules)}
    result = {}
    for key, value in data.items():
        sample = getattr(RULES, key)
        if isinstance(sample, int):
            value = int(value)
        elif key == "service_day_base":
            value = {name: int(count) for name, count in value.items()}
        elif key == "service_day_range":
            value = (int(value[0]), tuple(map(int, value[1])))
        elif isinstance(sample, tuple):
            value = tuple(int(item) if isinstance(sample[0], int) else item for item in value)
        result[key] = value
    return RankingRules(**result)


def check_vector(vector_id):
    document = json.loads(VECTORS.read_bytes())
    case = next(case for case in document["vectors"] if case["id"] == vector_id)
    spec = spec_from(case["spec"])
    rules = rules_from(document["rules"])
    rows = [
        EntityWindow(row["entity_id"], {k: int(v) for k, v in row["counts"].items()})
        for row in case["rows"]
    ]
    for ordered in (rows, list(reversed(rows))):
        actual = rank_entities(
            ordered,
            spec=spec,
            window_days=int(case["window_days"]),
            rules=rules,
            network=case["network"],
        )
        assert integers([asdict(row) for row in actual]) == case["expected"]
        for row in actual:
            assert shown_units(row.numerator, row.denominator or 1, spec) == row.shown_units
    assert [dict(row.counts) for row in rows] == [
        {k: int(v) for k, v in row["counts"].items()} for row in case["rows"]
    ]
    if vector_id == "half_negative":
        assert shown_units(-13500, 100, spec, precision=0) == -2


def test_half_exact():
    check_vector("half_exact")


def test_vectors_file_is_current():
    def no_number(token):
        raise AssertionError(f"JSON numeric token: {token}")

    raw = VECTORS.read_bytes()
    data = json.loads(raw, parse_int=no_number, parse_float=no_number, parse_constant=no_number)
    assert tuple(case["id"] for case in data["vectors"]) == IDS
    assert data["rules"] == integers(asdict(rules_from(data["rules"]))) == integers(asdict(RULES))
    for case in data["vectors"]:
        assert set(case) == {"id", "both", "spec", "window_days", "network", "rows", "expected"}
        assert case["both"] is True and case["network"] is None
        assert case["spec"] == integers(asdict(spec_from(case["spec"])))
        assert case["window_days"] == str(int(case["window_days"]))
        check_vector(case["id"])

    def compact(value):
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)

    rebuilt = (
        '{\n"rules":'
        + compact(data["rules"])
        + ',\n"vectors":[\n'
        + ",\n".join(map(compact, data["vectors"]))
        + "\n]\n}\n"
    )
    assert rebuilt.encode("ascii") == raw


def test_half_not_exact_in_binary():
    check_vector("half_not_exact_in_binary")


def test_half_negative():
    check_vector("half_negative")


def test_cross_products_past_2_53():
    check_vector("past_2_53")


def test_inside_a_shared_rank_the_exact_order_holds():
    check_vector("shared_rank_keeps_exact_order")


def test_ids_compare_by_code_point():
    check_vector("id_code_point")


def test_ids_beyond_the_basic_plane_compare_by_code_point():
    check_vector("code_point_beyond_bmp")


def test_operands_beyond_2_to_the_53_stay_exact():
    check_vector("operands_past_2_53")
