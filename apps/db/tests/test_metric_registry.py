import pytest

from transit_ops.metrics import Arithmetic, Bilingual, Floor, Metric, Registry, Series, Source
from transit_ops.ranking.rules import MeasureSpec


def sample_metrics(word):
    rate = Arithmetic(
        revision=3,
        kind="rate",
        numerator="ok",
        denominator="n",
        scale=(100, 1),
        precision=1,
        worse="lower",
        floor=Floor(trips=30, trips_of="reported", units=5, units_of="ok", service_days=True),
    )
    return tuple(
        Metric(
            id=id,
            series="sample",
            name=word,
            plain=Bilingual(en="Plain", fr="Simple"),
            exact=Bilingual(en="Exact", fr="Exacte"),
            limits=(Bilingual(en="Metric limit", fr="Limite de métrique"),),
            unit="percent",
            arithmetic=(arithmetic,),
            pair_with=pair,
        )
        for id, arithmetic, pair in (
            ("rate", rate, ("quantile", "average")),
            ("average", rate.model_copy(update={"kind": "average"}), ()),
            ("share", rate.model_copy(update={"kind": "share"}), ()),
            (
                "quantile",
                Arithmetic(revision=3, kind="quantile_bin", quantile="0.9", precision=0),
                (),
            ),
        )
    )


def entries():
    word = Bilingual(en="Units", fr="Unités")
    source = Source(
        dimension="line",
        time_of_day="all",
        day_type=False,
        summary="counts_and_histogram",
        histogram_layout=2,
        read_from="cells",
        cell_table="logical_cells",
        metrics=("rate", "average", "share", "quantile"),
        gate="sample",
    )
    stop = source.model_copy(
        update={
            "dimension": "stop",
            "summary": "counts",
            "histogram_layout": None,
            "metrics": ("rate",),
        }
    )
    series = Series(
        id="sample",
        revision=3,
        unit="readings",
        population_key="counted",
        population=Bilingual(en="Population", fr="Population"),
        limits=(Bilingual(en="Series limit", fr="Limite de série"),),
        windows=("day",),
        sources=(stop, source),
    )
    return (series,), sample_metrics(word)


def test_a_series_is_keyed_by_id_and_revision():
    series, metrics = entries()
    registry = Registry(series, metrics)
    assert registry.series("sample", 3) == series[0]
    assert registry.metric("rate") == metrics[0]
    with pytest.raises(KeyError):
        registry.series("sample", 4)


@pytest.mark.parametrize("locale", ["en", "fr"])
def test_every_lookup_but_metric_takes_the_revision(locale):
    registry = Registry(*entries())
    assert registry.arithmetic("rate", 3).numerator == "ok"
    assert tuple(s.dimension for s in registry.sources_for("quantile", 3)) == ("line",)
    descriptions = {
        "en": "Plain\nExact\nPopulation\nSeries limit\nMetric limit",
        "fr": "Simple\nExacte\nPopulation\nLimite de série\nLimite de métrique",
    }
    assert registry.describe("rate", 3, locale) == descriptions[locale]
    for lookup in (registry.arithmetic, registry.sources_for, registry.describe):
        for id, revision in (("rate", 4), ("unknown", 3)):
            with pytest.raises(KeyError):
                lookup(id, revision)
    with pytest.raises(ValueError):
        registry.describe("rate", 3, "es")


@pytest.mark.parametrize(
    "change", ["series", "metric", "arithmetic", "reference", "pair", "source"]
)
def test_duplicate_or_broken_definitions_are_refused(change):
    series, metrics = entries()
    s, m = series[0], metrics[0]
    if change == "series":
        series += series
    elif change == "metric":
        metrics += (m,)
    elif change == "arithmetic":
        metrics = (m.model_copy(update={"arithmetic": m.arithmetic * 2}), *metrics[1:])
    elif change == "reference":
        series = (s.model_copy(update={"revision": 4}),)
    elif change == "pair":
        metrics = (m.model_copy(update={"pair_with": ("missing",)}), *metrics[1:])
    else:
        source = s.sources[0].model_copy(update={"metrics": ("missing",)})
        series = (s.model_copy(update={"sources": (source,)}),)
    with pytest.raises(ValueError):
        Registry(series, metrics)


@pytest.mark.parametrize(
    "en", ["", " ", "{other}", "{operator!r}", "{operator:>5}", "{operator.x}"]
)
def test_texts_use_only_the_two_placeholders(en):
    with pytest.raises(ValueError):
        Bilingual(en=en, fr="Unités")


def test_every_text_has_both_languages():
    assert Bilingual(en="{operator}", fr="{no_live_data_lines}").en == "{operator}"
    for values in (
        {"en": "Units"},
        {"en": "Units", "fr": " "},
        {"en": "Units", "fr": "Unités", "typo": "bad"},
    ):
        with pytest.raises(ValueError):
            Bilingual(**values)


@pytest.mark.parametrize(
    "change",
    [
        {"cell_table": ""},
        {"read_from": "archive"},
        {"histogram_layout": None},
        {"summary": "counts"},
    ],
)
def test_source_metadata_matches_its_storage_and_summary(change):
    source = entries()[0][0].sources[1]
    with pytest.raises(ValueError):
        Source.model_validate(source.model_dump() | change)


@pytest.mark.parametrize("kind,quantile", [("rate", "0.9"), ("quantile_bin", None)])
def test_a_quantile_metric_carries_its_quantile_and_no_other_does(kind, quantile):
    with pytest.raises(ValueError):
        Arithmetic(revision=3, kind=kind, quantile=quantile, precision=0)


def with_future_arithmetic(metric, keep_earlier=True):
    future = metric.arithmetic[0].model_copy(update={"revision": 4, "numerator": "future_operand"})
    arithmetic = (*metric.arithmetic, future) if keep_earlier else (future,)
    return metric.model_copy(update={"arithmetic": arithmetic})


def expected_spec(id, pair=None, numerator="ok"):
    return MeasureSpec(
        id,
        numerator,
        "n",
        "entity",
        (100, 1),
        1,
        "lower",
        "sample",
        30,
        "reported",
        5,
        "ok",
        True,
        pair,
    )


def test_a_nested_pair_is_the_specification_of_that_measure():
    series, metrics = entries()
    future = series[0].model_copy(update={"revision": 4, "sources": ()})
    later = tuple(with_future_arithmetic(m) if m.id in ("rate", "average") else m for m in metrics)
    registry = Registry((*series, future), later)
    assert registry.measure_spec("rate", 3) == expected_spec("rate", expected_spec("average"))
    assert registry.measure_spec("rate", 4) == expected_spec(
        "rate", expected_spec("average", numerator="future_operand"), numerator="future_operand"
    )
    assert registry.series("sample", 3) == series[0]
    assert tuple(registry.arithmetic(m.id, 3) for m in metrics) == tuple(
        m.arithmetic[0] for m in metrics
    )
    assert registry.measure_spec("share", 3).denominator_from == "network"
    with pytest.raises(ValueError):
        registry.measure_spec("quantile", 3)
    with pytest.raises(KeyError):
        registry.measure_spec("rate", 5)


def test_a_pair_never_borrows_another_revision():
    series, metrics = entries()
    s = series[0]
    sources = tuple(x.model_copy(update={"metrics": ("rate",)}) for x in s.sources)
    future = s.model_copy(update={"revision": 4, "sources": ()})
    metrics = tuple(with_future_arithmetic(m, False) if m.id == "average" else m for m in metrics)
    registry = Registry((s.model_copy(update={"sources": sources}), future), metrics)
    assert registry.measure_spec("rate", 3).pair is None
    bad = metrics[0].model_copy(
        update={"arithmetic": (metrics[0].arithmetic[0].model_copy(update={"numerator": None}),)}
    )
    with pytest.raises(ValueError):
        Registry(
            (s.model_copy(update={"sources": sources}), future), (bad, *metrics[1:])
        ).measure_spec("rate", 3)
