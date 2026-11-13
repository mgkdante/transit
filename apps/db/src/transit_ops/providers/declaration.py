from collections.abc import Mapping
from pathlib import Path
from typing import Annotated, Literal, Self
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import yaml  # type: ignore[import-untyped]
from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    UrlConstraints,
    ValidationError,
    field_validator,
    model_validator,
)
from pydantic_core import InitErrorDetails

from transit_ops.core.models import ReadingPopulation

SITE_LOCALES: tuple[str, ...] = ("en", "fr")
KNOWN_FORMATS: Mapping[str, frozenset[str]] = {
    "gtfs": frozenset({"schedule"}),
    "gtfs-rt": frozenset({"trip_updates", "vehicle_positions", "alerts"}),
    "stm-etatservice-json": frozenset({"alerts"}),
    "stm-gis-zip": frozenset({"geometry"}),
}
_Text = Annotated[str, Field(min_length=1, pattern=r"\S")]
_Env = Annotated[str, Field(pattern=r"^[A-Z_][A-Z0-9_]*$")]
_Locale = Literal["en", "fr"]
_Https = Annotated[HttpUrl, UrlConstraints(allowed_schemes=["https"])]
_Nonnegative = Annotated[int, Field(strict=True, ge=0)]


def _bounds(value: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    west, south, east, north = value
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise ValueError("must be west, south, east, north with valid ranges and positive area")
    return value


_Bounds = Annotated[tuple[float, float, float, float], AfterValidator(_bounds)]


def _require(problems: list[tuple[str, str]]) -> None:
    if problems:
        errors: list[InitErrorDetails] = [
            {
                "type": "value_error",
                "loc": tuple(key.split(".")),
                "input": None,
                "ctx": {"error": ValueError(message)},
            }
            for key, message in problems
        ]
        raise ValidationError.from_exception_data("Declaration", errors)


class DeclarationError(ValueError):
    """A declaration refusal containing only safe, actionable messages."""


class _Block(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)


class LocaleLabels(_Block):
    city: _Text
    operator: _Text


class Licence(_Block):
    name: _Text
    terms_url: _Https
    review: Literal["pending", "accepted"]


class FeedSignature(_Block):
    query: _Text
    secret_env: _Env
    scheme: Literal["sha256_utc_minute"]


class FeedAuth(_Block):
    header: _Text | None = None
    query: _Text | None = None
    secret_env: _Env
    signature: FeedSignature | None = None

    @model_validator(mode="after")
    def check_location(self) -> Self:
        _require(
            [("header", "exactly one of header and query is required")]
            if (self.header is None) == (self.query is None)
            else []
        )
        return self


class FeedDeclaration(_Block):
    family: Literal["schedule", "trip_updates", "vehicle_positions", "alerts", "geometry"]
    format: _Text | None = None
    url: _Https | None = None
    url_env: _Env | None = None
    auth: FeedAuth | None = None
    every_seconds: Annotated[int, Field(strict=True, gt=0)] | None = None
    phase_seconds: _Nonnegative | None = None

    @model_validator(mode="after")
    def check_feed(self) -> Self:
        problems = []
        if self.url is None and self.url_env is None:
            problems.append(("url", "url or url_env is required. There is no default."))
        if self.format is not None and self.family not in KNOWN_FORMATS.get(self.format, ()):
            problems.append(
                (
                    "format",
                    "format has no adapter for this family; known: " + ", ".join(KNOWN_FORMATS),
                )
            )
        if self.family == "geometry" and self.format is None:
            problems.append(("format", "geometry format is required. There is no default."))
        _require(problems)
        return self


class GapLabels(_Block):
    short: _Text
    long: _Text | None = None


class GapDeclaration(_Block):
    gap_id: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]*$")]
    route_ids: list[Annotated[str, Field(min_length=1, pattern=r"^\S+$")]] = Field(
        default_factory=list
    )
    route_types: list[Annotated[int, Field(strict=True, ge=0, le=1702)]] = Field(
        default_factory=list
    )
    labels: dict[_Locale, GapLabels]

    @model_validator(mode="after")
    def check_selectors(self) -> Self:
        problems = [
            ("labels." + locale, "short label is required. There is no default.")
            for locale in SITE_LOCALES
            if locale not in self.labels
        ]
        if not self.route_ids and not self.route_types:
            problems.append(("route_ids", "route_ids or route_types is required"))
        for key, values in (("route_ids", self.route_ids), ("route_types", self.route_types)):
            if len(set(values)) != len(values):
                problems.append((key, "selectors must be unique"))
        _require(problems)
        return self


class MapBlock(_Block):
    basemap_url: _Text
    basemap_bounds: _Bounds
    posters_url: _Text


class Overrides(_Block):
    bounds: _Bounds | None = None
    fit_bounds: _Bounds | None = None
    max_bounds: _Bounds | None = None
    geocode_context: _Text | None = None
    search_examples: list[_Text] | None = None
    max_vehicle_speed_kmh: Annotated[float, Field(gt=0, allow_inf_nan=False)] | None = None
    strict_gtfs: Annotated[bool, Field(strict=True)] | None = None


class Declaration(_Block):
    declaration: Literal[2]
    id: Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9_-]*$")]
    name: _Text
    labels: dict[_Locale, LocaleLabels]
    timezone: _Text
    default_locale: _Locale
    feed_languages: Annotated[
        list[Annotated[str, Field(pattern=r"^[a-z]{2,3}$")]], Field(min_length=1)
    ]
    website: _Https | None = None
    currency: Annotated[str, Field(pattern=r"^[A-Z]{3}$")] | None = None
    stage: Literal["candidate", "capturing", "public"]
    licence: Licence
    attribution: dict[_Locale, _Text]
    disclaimer: dict[_Locale, _Text] | None = None
    feeds: list[FeedDeclaration]
    lines_without_live_data: list[GapDeclaration] | None = None
    reading_population: ReadingPopulation | None = None
    live_source_lag_seconds: _Nonnegative | None = None
    alert_links: dict[_Locale, _Https] | None = None
    map: MapBlock | None = None
    overrides: Overrides | None = None

    @field_validator("timezone")
    @classmethod
    def check_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("must be an IANA timezone such as America/Winnipeg") from None
        return value

    @model_validator(mode="after")
    def check_declaration(self) -> Self:
        problems = [
            ("labels." + locale, "is required. There is no default.")
            for locale in SITE_LOCALES
            if locale not in self.labels
        ]
        if self.default_locale not in self.attribution:
            problems.append(
                ("attribution." + self.default_locale, "is required. There is no default.")
            )
        if len(set(self.feed_languages)) != len(self.feed_languages):
            problems.append(("feed_languages", "language tags must be distinct"))
        families = [feed.family for feed in self.feeds]
        if families.count("schedule") != 1:
            problems.append(
                ("feeds", "exactly one schedule entry is required. There is no default.")
            )
        if len(set(families)) != len(families):
            problems.append(("feeds", "families must be distinct"))
        if self.stage in ("capturing", "public") and (
            self.overrides is None or self.overrides.bounds is None
        ):
            problems.append(("overrides.bounds", "is required for capturing or public"))
        if self.stage == "public":
            if self.licence.review != "accepted":
                problems.append(("licence.review", "must be accepted for public"))
            for key in ("map", "reading_population"):
                if getattr(self, key) is None:
                    problems.append((key, "is required for public. There is no default."))
        _require(problems)
        return self


def _message(error: Mapping[str, object]) -> str:
    kind, location = error["type"], error["loc"]
    if kind == "missing":
        if location == ("timezone",):
            return (
                "timezone is required (an IANA name such as America/Winnipeg). There is no default."
            )
        return "is required. There is no default."
    if location == ("declaration",):
        return "declaration must be 2"
    if isinstance(location, tuple) and location[-1:] in (("secret_env",), ("url_env",)):
        return "must name an environment variable; never write a key here"
    if kind == "value_error":
        context = error.get("ctx")
        if isinstance(context, dict):
            return str(context["error"])
    if kind == "extra_forbidden":
        return "unknown key; remove it"
    return "invalid value; use the declared type, allowed values and constraints"


def load_declaration(path: Path) -> Declaration:
    try:
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, yaml.YAMLError):
        raise DeclarationError(f"{path.name}: file: must be readable UTF-8 YAML") from None
    if not isinstance(payload, dict):
        raise DeclarationError(f"{path.name}: file: must contain a YAML mapping")
    try:
        declaration = Declaration.model_validate(payload)
    except ValidationError as error:
        messages = []
        for issue in error.errors(include_url=False, include_input=False):
            key = ""
            location = issue["loc"]
            for index, part in enumerate(location):
                if location[index + 1 : index + 2] == ("[key]",):
                    part = "<locale>"
                key += f"[{part}]" if isinstance(part, int) else ("." if key else "") + part
            messages.append(f"{path.name}: {key}: {_message(issue)}")
        raise DeclarationError("\n".join(messages)) from None
    if declaration.id != path.stem:
        raise DeclarationError(f"{path.name}: id must equal the file name without .yaml")
    return declaration
