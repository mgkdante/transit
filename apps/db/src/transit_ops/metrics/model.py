from collections.abc import Mapping
from string import Formatter
from typing import Literal, NamedTuple, Self

from pydantic import BaseModel, ConfigDict, field_validator, model_validator


class AbsenceKey(NamedTuple):
    state: str
    reason: str | None


class FrozenModel(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class Bilingual(FrozenModel):
    en: str
    fr: str

    @field_validator("en", "fr")
    @classmethod
    def valid_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("blank text")
        for _, field, spec, conversion in Formatter().parse(value):
            if field is not None and (
                field not in ("operator", "no_live_data_lines") or spec or conversion
            ):
                raise ValueError("unsupported placeholder")
        return value


class Floor(FrozenModel):
    trips: int | None = None
    trips_of: str = "trips"
    units: int | None = None
    units_of: str | None = None
    service_days: bool = False


class Source(FrozenModel):
    dimension: Literal[
        "network", "line", "line_direction", "stop", "stop_line", "road_segment", "area"
    ]
    time_of_day: Literal["all", "shift", "hour"]
    day_type: bool
    summary: Literal["counts", "counts_and_histogram"]
    histogram_layout: int | None = None
    read_from: Literal["cells", "archive"]
    cell_table: str | None = None
    metrics: tuple[str, ...]
    gate: str

    @model_validator(mode="after")
    def valid_source(self) -> Self:
        if (self.read_from == "cells" and not (self.cell_table or "").strip()) or (
            self.read_from == "archive" and self.cell_table is not None
        ):
            raise ValueError("cell_table must be present only for cells")
        if (self.summary == "counts_and_histogram") != (self.histogram_layout is not None):
            raise ValueError("histogram_layout must be present exactly for a histogram")
        return self


class Series(FrozenModel):
    id: str
    revision: int
    unit: str
    population_key: str
    population: Bilingual
    limits: tuple[Bilingual, ...]
    windows: tuple[
        Literal["live", "day", "trailing_7", "trailing_30", "range", "calendar_month"], ...
    ]
    sources: tuple[Source, ...]
    what_differed: Bilingual | None = None
    in_availability_list: bool = True


class Arithmetic(FrozenModel):
    revision: int
    kind: Literal["rate", "share", "average", "count", "quantile_bin", "duration"]
    numerator: str | None = None
    denominator: str | None = None
    scale: tuple[int, int] = (1, 1)
    quantile: str | None = None
    precision: int
    worse: Literal["lower", "higher"] | None = None
    floor: Floor = Floor()

    @model_validator(mode="after")
    def valid_quantile(self) -> Self:
        if (self.kind == "quantile_bin") != (self.quantile is not None):
            raise ValueError("quantile must be present exactly for quantile_bin")
        return self


class Metric(FrozenModel):
    id: str
    series: str
    name: Bilingual
    plain: Bilingual
    exact: Bilingual
    limits: tuple[Bilingual, ...] = ()
    unit: str
    pair_with: tuple[str, ...] = ()
    arithmetic: tuple[Arithmetic, ...]
    absence_overrides: Mapping[AbsenceKey, Bilingual] = {}
    aliases: tuple[Bilingual, ...] = ()
    reference: str | None = None
