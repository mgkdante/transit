import json
from hashlib import sha256
from pathlib import Path

import pytest
from test_metric_registry import entries

from transit_ops.metrics import REGISTRY, AbsenceKey, Bilingual, Registry

PINS = {
    "series": {"sample@3": "83633c678454bb9d6047a9b5bfc8aa51a3916e3399be9144e383eda802d51cf2"},
    "metrics": {
        "rate@3": "e07e841e72a763be5b2dc38aa57eee18729e782ee5bed96d2d59483fabe8bd1a",
        "average@3": "36f2d2e45765819a1de041b641a944f79d3f7d71daeb268f225ab70c8d3833db",
        "share@3": "5ddaf2d254a795d9a86526429dcf874375c367c7ad9a2362cee239b3e9dbfcf8",
        "quantile@3": "38f1ce4ded21859e80f5c9dd1dcd7585667ec9c3cb6d452e566b6c70cd01b12b",
    },
}


def fixture_registry(series=None, metrics=None, **kwargs):
    ss, mm = entries()
    constants = {(m.id, a.revision): {} for m in (metrics or mm) for a in m.arithmetic}
    return Registry(
        ss if series is None else series,
        mm if metrics is None else metrics,
        metric_constants=kwargs.pop("metric_constants", constants),
        histogram_layouts=kwargs.pop("histogram_layouts", {2: (-60, 0, 300)}),
        **kwargs,
    )


def test_empty_registry_and_committed_pins():
    pins = json.loads(Path(__file__).with_name("metric_registry_pins.json").read_text())
    assert pins == {"series": {}, "metrics": {}}
    REGISTRY.validate_pins(pins)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"metric_constants": {}},
        {"histogram_layouts": {}},
        {"metric_constants": {("rate", 3): {"edge": 1.5}}},
        {"metric_constants": {("rate", 3): {"edge": object()}}},
    ],
)
def test_pin_dependencies_are_explicit_json_values(kwargs):
    with pytest.raises(ValueError):
        fixture_registry(**kwargs)


def test_every_pin_is_recomputed():
    preimage = (
        '{"constants":{},"denominator":"n","floor":{"service_days":true,"trips":30,'
        '"trips_of":"reported","units":5,"units_of":"ok"},"kind":"rate","numerator":"ok",'
        '"precision":1,"quantile":null,"revision":3,"scale":[100,1],"series":"sample",'
        '"unit":"percent","worse":"lower"}'
    )
    assert sha256(preimage.encode()).hexdigest() == PINS["metrics"]["rate@3"]
    r = fixture_registry()
    assert r.series_pin("sample", 3) == PINS["series"]["sample@3"]
    for id in ("rate", "average", "share", "quantile"):
        assert r.metric_pin(id, 3) == PINS["metrics"][f"{id}@3"]
    r.validate_pins(PINS)


@pytest.mark.parametrize(
    "pins,message",
    [
        ({"series": {}, "metrics": {}}, "pin it in the packet that releases it"),
        ({"series": {"orphan@3": "x"}, "metrics": {}}, "a pin has no entry"),
        (
            {"series": {"sample@3": "x"}, "metrics": PINS["metrics"]},
            "a released definition changed: add a new revision",
        ),
    ],
)
def test_missing_or_orphaned_or_changed_pins_are_refused(pins, message):
    with pytest.raises(ValueError, match=message):
        fixture_registry().validate_pins(pins)


@pytest.mark.parametrize(
    "target,field",
    [("metric", f) for f in "name plain exact limits aliases reference absence_overrides".split()]
    + [("series", f) for f in "population limits what_differed".split()],
)
def test_a_corrected_word_moves_only_the_wording_hash(target, field):
    ss, mm = entries()
    word = Bilingual(en="Units", fr="Corrigé")
    value = (
        (word,)
        if field in ("limits", "aliases")
        else "reference"
        if field == "reference"
        else {AbsenceKey("synthetic", None): word}
        if field == "absence_overrides"
        else word
    )
    if target == "metric":
        mm = (mm[0].model_copy(update={field: value}), *mm[1:])
    else:
        ss = (ss[0].model_copy(update={field: value}),)
    changed = fixture_registry(ss, mm)
    changed.validate_pins(PINS)
    assert changed.wording_sha256() != fixture_registry().wording_sha256()


def test_core_export_is_selected_and_contains_no_cell_table():
    r = fixture_registry()
    exported = r.export_registry(3)
    assert exported["pins"] == PINS
    assert [m["id"] for m in exported["metrics"]] == ["average", "quantile", "rate", "share"]
    assert all(m["arithmetic"]["revision"] == 3 for m in exported["metrics"])
    assert "cell_table" not in json.dumps(exported)
    assert r.series("sample", 3).sources[0].cell_table == "logical_cells"
    assert REGISTRY.export_registry(4)["series"] == []
    assert r.export_registry(4)["metrics"] == []


@pytest.mark.parametrize(
    "target,change",
    [
        ("metric", {"unit": "fraction"}),
        ("metric", {"series": "other"}),
        ("arithmetic", {"kind": "share"}),
        ("arithmetic", {"numerator": "other"}),
        ("arithmetic", {"denominator": "other"}),
        ("arithmetic", {"scale": (1, 60)}),
        ("arithmetic", {"precision": 2}),
        ("arithmetic", {"worse": "higher"}),
        ("quantile", {"quantile": "0.5"}),
        ("floor", {"trips": 31}),
        ("floor", {"trips_of": "n"}),
        ("floor", {"units": 6}),
        ("floor", {"units_of": "n"}),
        ("floor", {"service_days": False}),
        ("series", {"unit": "events"}),
        ("series", {"population_key": "other"}),
        ("series", {"windows": ("live",)}),
        ("series", {"in_availability_list": False}),
        ("source", {"dimension": "network"}),
        ("source", {"time_of_day": "hour"}),
        ("source", {"day_type": True}),
        ("source", {"summary": "counts", "histogram_layout": None}),
        ("source", {"histogram_layout": 3}),
        ("source", {"read_from": "archive", "cell_table": None}),
        ("source", {"cell_table": "other"}),
        ("source", {"gate": "other"}),
    ],
)
def test_each_definition_field_moves_its_pin(target, change):
    ss, mm = entries()
    s, index = ss[0], 3 if target == "quantile" else 0
    m, a = mm[index], mm[index].arithmetic[0]
    if "series" in change:
        ss = (s.model_copy(update={"id": change["series"]}),)
        mm = tuple(x.model_copy(update=change) for x in mm)
    if target == "floor":
        change, target = {"floor": a.floor.model_copy(update=change)}, "arithmetic"
    if target in ("arithmetic", "quantile"):
        change = {"arithmetic": (a.model_copy(update=change),)}
    if target == "source":
        change = {"sources": (s.sources[0], s.sources[1].model_copy(update=change))}
    is_series = target in ("source", "series")
    if is_series:
        ss = (s.model_copy(update=change),)
    else:
        mm = tuple(m.model_copy(update=change) if i == index else x for i, x in enumerate(mm))
    r = fixture_registry(ss, mm, histogram_layouts={2: (-60, 0, 300), 3: (-60, 0, 300)})
    actual = r.series_pin("sample", 3) if is_series else r.metric_pin(m.id, 3)
    if "series" not in change:
        assert r.wording_sha256() == fixture_registry().wording_sha256()
    assert (
        actual
        != PINS["series" if is_series else "metrics"]["sample@3" if is_series else f"{m.id}@3"]
    )


@pytest.mark.parametrize(
    "id,key", [("rate", "bands"), ("rate", "floor_rule"), ("quantile", "layout")]
)
def test_dependencies_are_isolated_and_snapshotted(id, key):
    ss, mm = map(list, entries())
    constants = {(m.id, 3): {} for m in mm}
    constants[id, 3][key] = [-60, 0, 300]
    layouts = {2: [-60, 0, 300], 99: [0, 1]}
    r = fixture_registry(ss, mm, metric_constants=constants, histogram_layouts=layouts)
    before = r.export_registry(3)
    constants[id, 3][key][0] = -61
    layouts[2 if key == "layout" else 99][0] = -61
    changed = fixture_registry(ss, mm, metric_constants=constants, histogram_layouts=layouts)
    assert changed.wording_sha256() == r.wording_sha256()
    assert changed.metric_pin(id, 3) != r.metric_pin(id, 3)
    assert all(changed.metric_pin(m.id, 3) == r.metric_pin(m.id, 3) for m in mm if m.id != id)
    assert (changed.series_pin("sample", 3) != r.series_pin("sample", 3)) == (key == "layout")
    ss.clear()
    mm.clear()
    assert r.export_registry(3) == before


def test_duplicate_sources_are_refused():
    ss, mm = entries()
    with pytest.raises(ValueError, match="duplicate source"):
        fixture_registry((ss[0].model_copy(update={"sources": ss[0].sources * 2}),), mm)


@pytest.mark.parametrize("revision", [3, 4])
def test_a_second_revision_copies_no_wording_and_moves_no_earlier_pin(revision):
    ss, mm = entries()
    a4 = mm[0].arithmetic[0].model_copy(update={"revision": 4})
    m = mm[0].model_copy(update={"arithmetic": (*mm[0].arithmetic, a4)})
    assert m.name is mm[0].name
    sources = tuple(x.model_copy(update={"metrics": ("rate",)}) for x in ss[0].sources)
    s4 = ss[0].model_copy(update={"revision": 4, "unit": "stop_events", "sources": sources})
    r = fixture_registry((*ss, s4), (m, *mm[1:]))
    r.validate_pins(
        {
            "series": PINS["series"]
            | {"sample@4": "9cddfda5eb42437da8a1d720d2fa44a057e172ac6c3a2b1382c103dd1297840c"},
            "metrics": PINS["metrics"]
            | {"rate@4": "162da8b17af3b6bcf6ce753da4203699453accf01fe796217e603c4983be7af1"},
        }
    )
    assert r.arithmetic("rate", revision) == (a4 if revision == 4 else mm[0].arithmetic[0])
    assert r.series("sample", 4).unit == "stop_events"
    assert [x["id"] for x in r.export_registry(4)["metrics"]] == ["rate"]


def test_ordering_and_caller_wording_mutation_do_not_change_exports():
    ss, mm = entries()
    ss = (ss[0].model_copy(update={"windows": ("live", "day")}),)
    ss += (ss[0].model_copy(update={"id": "z", "sources": ()}),)
    words = {AbsenceKey("z", None): mm[0].name, AbsenceKey("a", "reason"): mm[0].plain}
    mm = (mm[0].model_copy(update={"absence_overrides": words}), *mm[1:])
    r = fixture_registry(ss, mm)
    before = r.export_registry(3)
    swapped = ss[0].model_copy(update={"sources": ss[0].sources[::-1], "windows": ("day", "live")})
    swapped_m = mm[0].model_copy(update={"absence_overrides": dict(reversed(words.items()))})
    other = fixture_registry((ss[1], swapped), (*mm[:0:-1], swapped_m))
    assert json.dumps(other.export_registry(3), ensure_ascii=False) == json.dumps(
        before, ensure_ascii=False
    )
    words.clear()
    assert r.export_registry(3) == before


def test_adding_a_metric_moves_no_series_pin():
    ss, mm = entries()
    sources = tuple(x.model_copy(update={"metrics": (*x.metrics, "added")}) for x in ss[0].sources)
    added = mm[0].model_copy(update={"id": "added", "pair_with": ()})
    r = fixture_registry((ss[0].model_copy(update={"sources": sources}),), (*mm, added))
    r.validate_pins(
        {
            "series": PINS["series"],
            "metrics": PINS["metrics"] | {"added@3": PINS["metrics"]["rate@3"]},
        }
    )
