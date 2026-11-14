import json
from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import replace
from hashlib import sha256
from operator import attrgetter

from pydantic import JsonValue

from transit_ops.ranking.rules import MeasureSpec

from .model import Arithmetic, Metric, Series, Source


def _json(value: object) -> JsonValue:
    if value is None or isinstance(value, str | bool | int):
        return value
    if isinstance(value, tuple | list):
        return [_json(v) for v in value]
    if isinstance(value, Mapping) and all(isinstance(k, str) for k in value):
        return {k: _json(v) for k, v in value.items()}
    raise ValueError("definitions require JSON values without floats")


def _digest(value: object) -> str:
    data = json.dumps(_json(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return sha256(data.encode("utf-8")).hexdigest()


def _metric_data(m: Metric) -> dict[str, object]:
    return m.model_dump(exclude={"absence_overrides"}) | {
        "absence_overrides": [
            {"state": k.state, "reason": k.reason, "sentence": m.absence_overrides[k].model_dump()}
            for k in sorted(
                m.absence_overrides, key=lambda k: (k.state, k.reason is not None, k.reason or "")
            )
        ]
    }


def _unique_sources(s: Series) -> None:
    keys = {(x.dimension, x.time_of_day, x.day_type) for x in s.sources}
    if len(keys) != len(s.sources):
        raise ValueError("duplicate source dimension/cut")


class Registry:
    def __init__(
        self,
        series: Sequence[Series] = (),
        metrics: Sequence[Metric] = (),
        *,
        metric_constants: Mapping[tuple[str, int], Mapping[str, object]] | None = None,
        histogram_layouts: Mapping[int, object] | None = None,
    ) -> None:
        self._series = {(s.id, s.revision): deepcopy(s) for s in series}
        self._metrics = {m.id: deepcopy(m) for m in metrics}
        self._constants = {k: _json(v) for k, v in (metric_constants or {}).items()}
        self._layouts = {k: _json(v) for k, v in (histogram_layouts or {}).items()}
        if metric_constants is not None and any(
            (m.id, a.revision) not in self._constants for m in metrics for a in m.arithmetic
        ):
            raise ValueError("explicit constants required for every metric revision")
        if histogram_layouts is not None and any(
            x.histogram_layout not in self._layouts
            for s in series
            for x in s.sources
            if x.histogram_layout is not None
        ):
            raise ValueError("referenced histogram layout is missing")
        if len(self._series) != len(series) or len(self._metrics) != len(metrics):
            raise ValueError("duplicate definition")
        for m in metrics:
            revisions = [a.revision for a in m.arithmetic]
            if len(set(revisions)) != len(revisions):
                raise ValueError("duplicate arithmetic revision")
            if any((m.series, r) not in self._series for r in revisions):
                raise ValueError("unknown series revision")
            if any(p not in self._metrics for p in m.pair_with):
                raise ValueError("unknown paired metric")
        for s in series:
            _unique_sources(s)
            for source in s.sources:
                for id in source.metrics:
                    candidate = self._metrics.get(id)
                    if (
                        candidate is None
                        or candidate.series != s.id
                        or s.revision not in {a.revision for a in candidate.arithmetic}
                    ):
                        raise ValueError("source metric does not resolve to this series revision")

    def metric(self, id: str) -> Metric:
        return self._metrics[id]

    def series(self, id: str, revision: int) -> Series:
        return self._series[id, revision]

    def arithmetic(self, metric_id: str, revision: int) -> Arithmetic:
        return {a.revision: a for a in self.metric(metric_id).arithmetic}[revision]

    def sources_for(self, metric_id: str, revision: int) -> tuple[Source, ...]:
        self.arithmetic(metric_id, revision)
        sources = self.series(self.metric(metric_id).series, revision).sources
        return tuple(
            sorted(
                (s for s in sources if metric_id in s.metrics),
                key=lambda s: (s.dimension, s.time_of_day, s.day_type),
            )
        )

    def describe(self, metric_id: str, revision: int, locale: str = "en") -> str:
        if locale not in ("en", "fr"):
            raise ValueError("unsupported locale")
        self.arithmetic(metric_id, revision)
        m = self.metric(metric_id)
        s = self.series(m.series, revision)
        return "\n".join(
            getattr(t, locale) for t in (m.plain, m.exact, s.population, *s.limits, *m.limits)
        )

    def measure_spec(self, metric_id: str, revision: int) -> MeasureSpec:
        def project(id: str) -> MeasureSpec:
            a = self.arithmetic(id, revision)
            if a.worse is None or a.numerator is None:
                raise ValueError("measure is not rankable or has no numerator")
            f = a.floor
            return MeasureSpec(
                id,
                a.numerator,
                a.denominator,
                "network" if a.kind == "share" else "entity",
                a.scale,
                a.precision,
                a.worse,
                self.metric(id).series,
                f.trips,
                f.trips_of,
                f.units,
                f.units_of,
                f.service_days,
                None,
            )

        spec = project(metric_id)
        for id in self.metric(metric_id).pair_with:
            try:
                a = self.arithmetic(id, revision)
            except KeyError:
                continue
            if a.worse is not None:
                return replace(spec, pair=project(id))
        return spec

    def metric_pin(self, metric_id: str, revision: int) -> str:
        m = self.metric(metric_id)
        a = self.arithmetic(metric_id, revision)
        if (metric_id, revision) not in self._constants:
            raise ValueError("explicit constants required for every metric revision")
        return _digest(
            a.model_dump()
            | {
                "series": m.series,
                "unit": m.unit,
                "constants": self._constants[metric_id, revision],
            }
        )

    def series_pin(self, series_id: str, revision: int) -> str:
        s = self.series(series_id, revision)
        layouts = {x.histogram_layout for x in s.sources if x.histogram_layout is not None}
        if not layouts <= self._layouts.keys():
            raise ValueError("referenced histogram layout is missing")
        data = s.model_dump(include={"unit", "population_key", "in_availability_list"})
        data.update(
            windows=sorted(s.windows),
            sources=[
                x.model_dump(exclude={"metrics"})
                for x in sorted(s.sources, key=attrgetter("dimension", "time_of_day", "day_type"))
            ],
            histogram_layouts={str(k): self._layouts[k] for k in sorted(layouts)},
        )
        return _digest(data)

    def _pins(self, revision: int | None = None) -> dict[str, dict[str, str]]:
        return {
            "series": {
                f"{id}@{r}": self.series_pin(id, r)
                for id, r in sorted(self._series)
                if revision is None or r == revision
            },
            "metrics": {
                f"{id}@{a.revision}": self.metric_pin(id, a.revision)
                for id, m in sorted(self._metrics.items())
                for a in m.arithmetic
                if revision is None or a.revision == revision
            },
        }

    def validate_pins(self, pins: Mapping[str, Mapping[str, str]]) -> None:
        expected = self._pins()
        if set(pins) - expected.keys() or any(
            set(pins.get(k, {})) - v.keys() for k, v in expected.items()
        ):
            raise ValueError("a pin has no entry")
        for kind, entries in expected.items():
            for key, digest in entries.items():
                if key not in pins.get(kind, {}):
                    raise ValueError("pin it in the packet that releases it")
                if pins[kind][key] != digest:
                    raise ValueError("a released definition changed: add a new revision")

    def wording_sha256(self) -> str:
        words = {
            "id",
            "name",
            "plain",
            "exact",
            "limits",
            "aliases",
            "reference",
            "absence_overrides",
        }
        return _digest(
            {
                "metrics": [
                    {k: v for k, v in _metric_data(m).items() if k in words}
                    for _, m in sorted(self._metrics.items())
                ],
                "series": [
                    s.model_dump(
                        include={"id", "revision", "population", "limits", "what_differed"}
                    )
                    for _, s in sorted(self._series.items())
                ],
            }
        )

    def export_registry(self, revision: int) -> dict[str, JsonValue]:
        series = [
            s.model_dump(exclude={"sources", "windows"})
            | {
                "windows": sorted(s.windows),
                "sources": [
                    x.model_dump(exclude={"cell_table"})
                    for x in sorted(
                        s.sources, key=attrgetter("dimension", "time_of_day", "day_type")
                    )
                ],
            }
            for (_, r), s in sorted(self._series.items())
            if r == revision
        ]
        metrics = [
            _metric_data(m) | {"arithmetic": self.arithmetic(id, revision).model_dump()}
            for id, m in sorted(self._metrics.items())
            if any(a.revision == revision for a in m.arithmetic)
        ]
        return {
            "revision": revision,
            "pins": _json(self._pins(revision)),
            "wording_sha256": self.wording_sha256(),
            "series": _json(series),
            "metrics": _json(metrics),
        }
