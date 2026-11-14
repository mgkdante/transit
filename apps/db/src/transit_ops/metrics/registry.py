from collections.abc import Sequence
from copy import deepcopy
from dataclasses import replace

from transit_ops.ranking.rules import MeasureSpec

from .model import Arithmetic, Metric, Series, Source


class Registry:
    def __init__(self, series: Sequence[Series] = (), metrics: Sequence[Metric] = ()) -> None:
        self._series = {(s.id, s.revision): deepcopy(s) for s in series}
        self._metrics = {m.id: deepcopy(m) for m in metrics}
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
