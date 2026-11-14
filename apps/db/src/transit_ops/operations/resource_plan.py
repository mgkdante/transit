"""Pure admission of measured, simultaneous Transit resource requirements.

CPU precision is one millicore. Disk items describe disjoint occupied paths;
explicit measured zeroes are required for inapplicable categories. Reservations
include headroom, so measured disk requirements are never added a second time.
Transition PostgreSQL must be supplied as its own concurrent service, never
folded into a final-target worker measurement. No host enforcement happens here.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import ROUND_CEILING, Decimal

DISK_CATEGORIES = (
    "database",
    "wal_checkpoints",
    "edition_overlap",
    "pending_segments",
    "capture_spool",
    "duckdb_temp",
    "status",
    "ingress_data",
    "rotated_logs",
)


class ResourceEvidenceMissing(ValueError):
    """A named measurement is absent, invalid or incomplete."""


class TenantCapacityExceeded(ValueError):
    """Measured requirements exceed a reservation or the approved ceiling."""


@dataclass(frozen=True)
class ServicePeak:
    service: str
    measurement_sha: str
    interval: str
    workload: str
    complete: bool
    gaps: tuple[str, ...]
    cpu_cores: float | None
    container_memory_bytes: int | float | None
    process_rss_bytes: int | float | None
    pid_peak: int | None
    worker: bool

    @staticmethod
    def cores_from_docker_percent(percent: float) -> float:
        return float(_number(percent, "docker.cpu_percent", integral=False) / 100)


@dataclass(frozen=True)
class DiskItem:
    service: str
    category: str
    occupied_bytes: int | None
    measurement_sha: str
    basis: str
    measurement_kind: str


@dataclass(frozen=True)
class DiskPeak:
    items: tuple[DiskItem, ...]
    reservations: Mapping[str, int]


@dataclass(frozen=True)
class ResourceTotal:
    cpus: float
    memory_bytes: int
    disk_budget_bytes: int


@dataclass(frozen=True)
class ServiceLimit:
    cpus: float
    memory_bytes: int
    memswap_bytes: int
    pids_limit: int
    duckdb_memory_bytes: int
    threads: int
    temp_max_bytes: int
    disk_budget_bytes: int


@dataclass(frozen=True)
class ResourcePlan:
    services: Mapping[str, ServiceLimit]
    total: ResourceTotal
    headroom: ResourceTotal
    source_proof_hashes: tuple[str, ...]
    pilot_unresolved: tuple[str, ...]


def _number(value: int | float | None, name: str, *, integral: bool = True) -> Decimal:
    if value is None or isinstance(value, bool):
        raise ResourceEvidenceMissing(name)
    number = Decimal(str(value))
    if not number.is_finite() or number < 0 or (integral and number != number.to_integral_value()):
        raise ResourceEvidenceMissing(name)
    return number


def _ceil(value: Decimal) -> int:
    return int(value.to_integral_value(rounding=ROUND_CEILING))


def _proof(sha: str, name: str) -> None:
    if len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha):
        raise ResourceEvidenceMissing(f"{name}.measurement_sha")


def _disk(disk: DiskPeak, names: set[str]) -> tuple[dict[str, int], set[str]]:
    sizes: dict[tuple[str, str], int] = {}
    proofs = set()
    for item in disk.items:
        name = f"{item.service}.{item.category}"
        key = (item.service, item.category)
        if item.service not in names or item.category not in DISK_CATEGORIES or key in sizes:
            raise ResourceEvidenceMissing(f"{name}: duplicate or unknown disk category")
        _proof(item.measurement_sha, name)
        if item.measurement_kind != "occupied_bytes":
            raise ResourceEvidenceMissing(f"{name}.measurement_kind: {item.measurement_kind}")
        if not item.basis.strip():
            raise ResourceEvidenceMissing(f"{name}.basis")
        sizes[key] = _ceil(_number(item.occupied_bytes, f"{name}.occupied_bytes"))
        proofs.add(item.measurement_sha)
    if set(disk.reservations) != names:
        raise ResourceEvidenceMissing("disk.reservations: every concurrent service required")
    for service in names:
        for category in DISK_CATEGORIES:
            if (service, category) not in sizes:
                raise ResourceEvidenceMissing(f"{service}.{category}.occupied_bytes")
        required = _ceil(Decimal(sum(sizes[service, c] for c in DISK_CATEGORIES)) * Decimal("1.5"))
        reservation = _number(disk.reservations[service], f"{service}.disk.reservation")
        if reservation < required:
            raise TenantCapacityExceeded(f"{service}.disk: requires {required} bytes")
    return {s: _ceil(Decimal(sizes[s, "duckdb_temp"]) * Decimal("1.5")) for s in names}, proofs


def _limit(peak: ServicePeak, temp: int, reservation: int) -> ServiceLimit:
    name = peak.service
    _proof(peak.measurement_sha, name)
    for field in ("interval", "workload"):
        if not getattr(peak, field).strip():
            raise ResourceEvidenceMissing(f"{name}.{field}")
    if peak.complete is not True or peak.gaps:
        raise ResourceEvidenceMissing(f"{name}.coverage")
    cpu = _number(peak.cpu_cores, f"{name}.cpu_cores", integral=False) * Decimal("1.5")
    if cpu == 0:
        raise ResourceEvidenceMissing(f"{name}.cpu_cores: positive measured peak required")
    memory = _ceil(
        _number(peak.container_memory_bytes, f"{name}.container_memory_bytes", integral=False)
        * Decimal("1.5")
    )
    pids = _ceil(_number(peak.pid_peak, f"{name}.pid_peak") * Decimal("1.5"))
    rss = peak.process_rss_bytes
    if rss is not None:
        rss_limit = _ceil(
            _number(rss, f"{name}.process_rss_bytes", integral=False) * Decimal("1.5")
        )
        if peak.worker and rss_limit > 3_758_096_384:
            raise TenantCapacityExceeded(f"{name}.pilot: RSS plus headroom exceeds 3.5 GiB")
    if peak.worker and memory > 3_758_096_384:
        raise TenantCapacityExceeded(f"{name}.pilot: container peak exceeds 3.5 GiB with headroom")
    cpus = Decimal(_ceil(cpu * 1000)) / 1000
    return ServiceLimit(
        float(cpus), memory, memory, pids, memory * 3 // 5, max(1, _ceil(cpus)), temp, reservation
    )


def plan_resources(
    peaks: Sequence[ServicePeak], *, disk: DiskPeak, concurrent_services: Sequence[str]
) -> ResourcePlan:
    names = set(concurrent_services)
    if not names or len(names) != len(concurrent_services) or any(not s.strip() for s in names):
        raise ResourceEvidenceMissing("concurrent_services: unique names required")
    by_name = {p.service: p for p in peaks}
    if len(by_name) != len(peaks):
        raise ResourceEvidenceMissing("duplicate service measurement")
    if set(by_name) != names:
        raise ResourceEvidenceMissing(
            f"concurrent_services measurements: {sorted(names ^ by_name.keys())}"
        )
    temps, proofs = _disk(disk, names)
    limits = {s: _limit(by_name[s], temps[s], disk.reservations[s]) for s in sorted(names)}
    cpu = sum((Decimal(str(v.cpus)) for v in limits.values()), Decimal(0))
    memory = sum(v.memory_bytes for v in limits.values())
    occupied = sum(v.disk_budget_bytes for v in limits.values())
    for field, required, cap in (
        ("cpus", cpu, Decimal("2.5")),
        ("memory_bytes", memory, 8_589_934_592),
        ("disk_budget_bytes", occupied, 32_000_000_000),
    ):
        if required > cap:
            raise TenantCapacityExceeded(f"tenant.{field}: requires {required}, ceiling {cap}")
    unresolved = tuple(
        f"{s}.process_rss_bytes"
        for s in sorted(names)
        if by_name[s].worker and by_name[s].process_rss_bytes is None
    )
    return ResourcePlan(
        limits,
        ResourceTotal(float(cpu), memory, occupied),
        ResourceTotal(
            float(Decimal("2.5") - cpu), 8_589_934_592 - memory, 32_000_000_000 - occupied
        ),
        tuple(sorted(proofs | {p.measurement_sha for p in peaks})),
        unresolved,
    )
