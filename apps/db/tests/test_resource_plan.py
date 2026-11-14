from dataclasses import replace

import pytest

from transit_ops.operations.resource_plan import (
    DISK_CATEGORIES,
    DiskItem,
    DiskPeak,
    ResourceEvidenceMissing,
    ServicePeak,
    TenantCapacityExceeded,
    plan_resources,
)


def peak(service="worker", **changes):
    sample = ServicePeak(
        service, "a" * 64, "pilot interval", "busy-hour replay", True, (), 0.201, 101, 90, 3, True
    )
    return replace(sample, **changes)


def disk(services=("worker",), **changes):
    items = tuple(
        DiskItem(service, category, 10, "b" * 64, "disjoint occupied paths")
        for service in services
        for category in DISK_CATEGORIES
    )
    return replace(DiskPeak(items, {service: 1000 for service in services}), **changes)


def plan(sample=None, storage=None):
    return plan_resources(
        [sample or peak()], disk=storage or disk(), concurrent_services=["worker"]
    )


def test_peaks_get_fifty_percent_headroom():
    result = plan()
    worker = result.services["worker"]
    assert worker.cpus == 0.302
    assert worker.memory_bytes == worker.memswap_bytes == 152
    assert worker.pids_limit == 5
    assert worker.threads == 1
    assert worker.temp_max_bytes == 15
    assert worker.disk_budget_bytes == 1000
    assert result.total.memory_bytes == 152
    assert result.headroom.memory_bytes == 8_589_934_440
    assert result.headroom.cpus == 2.198
    assert result.source_proof_hashes == ("a" * 64, "b" * 64)
    assert result.pilot_unresolved == ()


def test_cpu_percent_and_binary_memory_decimal_disk_units():
    sample = peak(
        cpu_cores=ServicePeak.cores_from_docker_percent(125), container_memory_bytes=1024**3
    )
    result = plan(sample)
    assert result.services["worker"].cpus == 1.875
    assert result.services["worker"].memory_bytes == 1_610_612_736
    assert result.headroom.disk_budget_bytes == 31_999_999_000


@pytest.mark.parametrize(
    "changes,field",
    [
        ({"cpu_cores": None}, "cpu_cores"),
        ({"cpu_cores": float("nan")}, "cpu_cores"),
        ({"cpu_cores": float("inf")}, "cpu_cores"),
        ({"pid_peak": -1}, "pid_peak"),
        ({"container_memory_bytes": None}, "container_memory_bytes"),
        ({"complete": False}, "coverage"),
        ({"gaps": ("missed sample",)}, "coverage"),
        ({"workload": ""}, "workload"),
        ({"interval": ""}, "interval"),
        ({"measurement_sha": ""}, "measurement_sha"),
    ],
)
def test_missing_or_incomplete_measurement_refused(changes, field):
    with pytest.raises(ResourceEvidenceMissing, match=f"worker.*{field}"):
        plan(peak(**changes))


def test_missing_rss_leaves_pilot_unresolved_without_inventing_it():
    result = plan(peak(process_rss_bytes=None))
    assert result.services["worker"].memory_bytes == 152
    assert result.pilot_unresolved == ("worker.process_rss_bytes",)
    with pytest.raises(ResourceEvidenceMissing, match="process_rss_bytes"):
        plan(peak(process_rss_bytes=-1))


@pytest.mark.parametrize(
    "changes,field",
    [
        ({"cpu_cores": 2}, "cpus"),
        ({"container_memory_bytes": 6 * 1024**3, "worker": False}, "memory_bytes"),
        ({"process_rss_bytes": 3 * 1024**3}, "pilot"),
    ],
)
def test_limits_never_clamp_to_ceiling(changes, field):
    with pytest.raises(TenantCapacityExceeded, match=field):
        plan(peak(**changes))
    with pytest.raises(TenantCapacityExceeded, match="disk"):
        plan(storage=disk(reservations={"worker": 32_000_000_001}))


def test_shadow_health_ingress_and_logs_count_in_total():
    names = ("worker", "shadow", "health", "ingress")
    result = plan_resources(
        [peak(name, worker=name in names[:2]) for name in names],
        disk=disk(names),
        concurrent_services=names,
    )
    assert result.total.cpus == 1.208
    assert result.total.memory_bytes == 608
    assert result.total.disk_budget_bytes == 4000
    assert result.services["shadow"].disk_budget_bytes == 1000
    storage = disk(names)
    logs = replace(storage.items[-1], occupied_bytes=1000)
    with pytest.raises(TenantCapacityExceeded, match="ingress.disk"):
        plan_resources(
            [peak(n) for n in names],
            disk=replace(storage, items=(*storage.items[:-1], logs)),
            concurrent_services=names,
        )
    with pytest.raises(ResourceEvidenceMissing, match="shadow"):
        plan_resources([peak()], disk=disk(), concurrent_services=names)


def test_duckdb_memory_is_at_most_sixty_percent():
    assert plan().services["worker"].duckdb_memory_bytes == 91
    assert plan(peak(container_memory_bytes=1)).services["worker"].duckdb_memory_bytes == 1


@pytest.mark.parametrize("field", ("pid_peak", "container_memory_bytes", "process_rss_bytes"))
def test_fractional_counts_are_refused(field):
    with pytest.raises(ResourceEvidenceMissing, match=field):
        plan(peak(**{field: 1.5}))
    with pytest.raises(ResourceEvidenceMissing, match="reservation"):
        plan(storage=disk(reservations={"worker": 1000.5}))


def test_block_io_is_not_disk_occupancy():
    storage = disk()
    for basis in ("BlockIO", "filesystem free bytes", ""):
        item = replace(storage.items[0], basis=basis)
        with pytest.raises(ResourceEvidenceMissing, match="database.*basis"):
            plan(storage=replace(storage, items=(item, *storage.items[1:])))


def test_disk_requires_disjoint_complete_measured_categories_and_fixed_reservations():
    storage = disk()
    for altered in (
        replace(storage, items=storage.items[1:]),
        replace(storage, items=(*storage.items, storage.items[0])),
        replace(storage, reservations={}),
        replace(
            storage, items=(replace(storage.items[0], occupied_bytes=None), *storage.items[1:])
        ),
    ):
        with pytest.raises(ResourceEvidenceMissing):
            plan(storage=altered)
    with pytest.raises(TenantCapacityExceeded, match="worker.disk"):
        plan(storage=disk(reservations={"worker": 134}))
    assert plan(storage=disk(reservations={"worker": 135})).total.disk_budget_bytes == 135


def test_service_identity_and_pilot_edges():
    with pytest.raises(ResourceEvidenceMissing, match="duplicate"):
        plan_resources([peak(), peak()], disk=disk(), concurrent_services=["worker"])
    with pytest.raises(ResourceEvidenceMissing, match="concurrent"):
        plan_resources([], disk=disk(), concurrent_services=[])
    assert plan(peak(process_rss_bytes=2_505_397_589)).pilot_unresolved == ()
    with pytest.raises(TenantCapacityExceeded, match="pilot"):
        plan(peak(process_rss_bytes=2_505_397_590))
