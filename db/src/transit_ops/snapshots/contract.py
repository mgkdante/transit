from __future__ import annotations
from enum import Enum
from pydantic import BaseModel, Field

class Status(str, Enum):
    early = "early"; on_time = "on_time"; late = "late"; severe = "severe"; unknown = "unknown"

class Severity(str, Enum):
    critical = "critical"; high = "high"; watch = "watch"

class Occupancy(str, Enum):
    empty = "empty"; many_seats = "many_seats"; few_seats = "few_seats"; standing = "standing"; full = "full"

class Vehicle(BaseModel):
    id: str
    route: str | None = None
    trip: str | None = None
    lat: float
    lon: float
    bearing: int | None = None
    speed_kmh: int | None = None
    status: Status
    delay_min: int | None = None
    occupancy: Occupancy | None = None
    next_stop: str | None = None
    updated_utc: str

class VehiclesFile(BaseModel):
    generated_utc: str
    vehicles: list[Vehicle]

class StopEta(BaseModel):
    stop: str
    eta_utc: str
    delay_min: int | None = None

class Trip(BaseModel):
    route: str | None = None
    status: Status
    delay_min: int | None = None
    stops: list[StopEta] = Field(default_factory=list)

class TripsFile(BaseModel):
    trips: dict[str, Trip]

class Alert(BaseModel):
    id: str
    severity: Severity
    header_key: str
    routes: list[str] = Field(default_factory=list)
    stops: list[str] = Field(default_factory=list)
    start_utc: str | None = None
    end_utc: str | None = None

class AlertsFile(BaseModel):
    alerts: list[Alert]

class StatusDist(BaseModel):
    on_time: int = 0; late: int = 0; severe: int = 0; early: int = 0; unknown: int = 0

class OccupancyMix(BaseModel):
    empty: float = 0.0; many_seats: float = 0.0; few_seats: float = 0.0; standing: float = 0.0; full: float = 0.0

class NetworkFile(BaseModel):
    vehicles_in_service: int
    on_time_pct: int
    status_dist: StatusDist
    delay_p50_min: int
    delay_p90_min: int
    occupancy_mix: OccupancyMix
    non_responding: int
    feed_freshness_s: int
    coverage_pct: int

class ManifestLiveFiles(BaseModel):
    vehicles: str = "live/vehicles.json"
    trips: str = "live/trips.json"
    alerts: str = "live/alerts.json"
    network: str = "live/network.json"
    ttl_s: int = 30
    generated_utc: str

class ManifestFiles(BaseModel):
    live: ManifestLiveFiles

class Manifest(BaseModel):
    provider: str
    display_name: str
    tz: str = "America/Toronto"
    bbox: list[float]
    default_lang: str = "fr"
    attribution: str
    basemap: str
    dataset_version: str
    labels: dict[str, str]
    files: ManifestFiles
    surfaces: list[str]
