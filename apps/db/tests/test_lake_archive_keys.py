import json

import pytest

from transit_ops.lake.archive_keys import parse_copy_key, proof_key, schema_key, table_copy_key


@pytest.mark.parametrize(
    "dataset,provider,grain,window,folder",
    [
        ("gold.fact_vehicle_snapshot", "network-1", "utc_day", "2026-11-01", "2026"),
        ("gold.route_delay_spine", "network_2", "month", "2026-11", "2026"),
        ("silver.routes", "network", "edition", "a" * 64, "editions"),
        ("core.providers", "_shared", "month", "2026-11", "2026"),
    ],
)
def test_literal_keys_and_round_trip(dataset, provider, grain, window, folder):
    key = table_copy_key(dataset, provider, 0, grain, window, 2, 3)
    assert key == f"archive/v1/tables/{dataset}/{provider}/r0/{folder}/{window}.c2.s3.parquet"
    assert proof_key(key) == key.removesuffix(".parquet") + ".proof.json"
    assert schema_key(dataset, 3) == f"archive/v1/tables/{dataset}/schemas/s3.json"
    parsed = parse_copy_key(key)
    assert parsed is not None
    assert (parsed.dataset_id, parsed.provider_id, parsed.revision) == (dataset, provider, 0)
    assert (parsed.grain, parsed.window_key, parsed.version, parsed.schema_version) == (
        grain,
        window,
        2,
        3,
    )


@pytest.mark.parametrize(
    "field,value",
    [
        ("provider_id", "../escape"),
        ("provider_id", "a*"),
        ("provider_id", "_other"),
        ("window_key", "2026-02-30"),
        ("version", 0),
        ("schema_version", 0),
        ("revision", -1),
        ("version", True),
        ("grain", "edition"),
        ("dataset_id", "capture.trip_updates"),
        ("dataset_id", "unknown.table"),
    ],
)
def test_refuses_invalid_parts(field, value):
    args = dict(
        dataset_id="gold.fact_vehicle_snapshot",
        provider_id="network",
        revision=0,
        grain="utc_day",
        window_key="2026-11-01",
        version=1,
        schema_version=1,
    )
    args[field] = value
    with pytest.raises((ValueError, LookupError)):
        table_copy_key(**args)


@pytest.mark.parametrize(
    "key",
    [
        "archive/v1/tables/core.providers/_shared/r0/2025/2026-11.c1.s1.parquet",
        "archive/v1/tables/core.providers/_shared/r0/2026/2026-11.c01.s1.parquet",
        "archive/v1/tables/core.providers/_shared/r0/2026/2026-11.c0.s1.parquet",
        "archive/v1/tables/core.providers/_shared/r0/2026/2026-11.c1.s1.proof.json",
        "../bad",
        "archive/v1/tables/unknown.table/x/r0/2026/2026-11.c1.s1.parquet",
    ],
)
def test_parser_refuses_noncanonical_keys(key):
    assert parse_copy_key(key) is None


def test_schema_and_proof_keys_refuse_invalid_input():
    with pytest.raises(ValueError):
        proof_key("arbitrary.parquet")
    with pytest.raises(ValueError):
        schema_key("core.providers", 0)


def test_schema_version_creates_reuses_then_allocates_above_all_keys(tmp_path):
    from transit_ops.ingestion.storage import LocalBronzeStorage
    from transit_ops.lake.archive_keys import resolve_schema_version
    from transit_ops.lake.table_schema import TableSchema

    storage = LocalBronzeStorage("local", tmp_path / "objects")
    schema = TableSchema.from_columns([("id", "integer", True)], ["id"])
    assert resolve_schema_version(storage, "core.providers", schema) == 1
    first = "archive/v1/tables/core.providers/schemas/s1.json"
    assert storage.read_bytes(first) == schema.to_json()
    before = list(storage.list_keys("archive/"))
    assert resolve_schema_version(storage, "core.providers", schema) == 1
    assert list(storage.list_keys("archive/")) == before
    orphan = storage.root / "archive/v1/tables/core.providers/schemas/s7.json"
    orphan.write_bytes(b"different schema")
    changed = TableSchema.from_columns([("id", "bigint", True)], ["id"])
    assert resolve_schema_version(storage, "core.providers", changed) == 8
    assert storage.read_bytes(first) == schema.to_json()
    assert storage.read_bytes(schema_key("core.providers", 8)) == changed.to_json()


def test_copy_version_counts_orphans_and_receipts_and_recognizes_content(tmp_path):
    from transit_ops.ingestion.storage import LocalBronzeStorage
    from transit_ops.lake.archive_keys import resolve_copy_version

    storage = LocalBronzeStorage("local", tmp_path / "objects")
    args = (storage, "core.providers", "_shared", 0, "month", "2026-11")
    empty = resolve_copy_version(*args, "a" * 64)
    assert (empty.version, empty.key) == (1, None)
    key = table_copy_key("core.providers", "_shared", 0, "month", "2026-11", 4, 2)
    receipt = storage.root / proof_key(key)
    receipt.parent.mkdir(parents=True)
    receipt.write_text(json.dumps({"content_sha256": "a" * 64}))
    orphan = storage.root / key.replace(".c4.", ".c8.")
    orphan.write_bytes(b"orphan")
    # Other windows and revisions do not change this window's version.
    for other in (key.replace("2026-11", "2026-12"), key.replace("/r0/", "/r1/")):
        path = storage.root / other.replace(".c4.", ".c99.")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"other window")
    before = list(storage.list_keys("archive/"))
    same = resolve_copy_version(*args, "a" * 64)
    assert (same.version, same.key) == (4, key)
    changed = resolve_copy_version(*args, "b" * 64)
    assert (changed.version, changed.key) == (9, None)
    assert list(storage.list_keys("archive/")) == before


def test_bad_receipt_fails_closed_and_digest_is_required(tmp_path):
    from transit_ops.ingestion.storage import LocalBronzeStorage
    from transit_ops.lake.archive_keys import resolve_copy_version

    storage = LocalBronzeStorage("local", tmp_path / "objects")
    args = (storage, "core.providers", "_shared", 0, "month", "2026-11")
    with pytest.raises(ValueError, match="content_sha256"):
        resolve_copy_version(*args, "")
    path = storage.root / proof_key(table_copy_key(*args[1:], 1, 1))
    path.parent.mkdir(parents=True)
    path.write_bytes(b"[]")
    with pytest.raises(ValueError, match="receipt"):
        resolve_copy_version(*args, "a" * 64)


def test_schema_race_refuses_different_bytes_without_overwriting(tmp_path):
    from transit_ops.ingestion.storage import LocalBronzeStorage
    from transit_ops.lake.archive_keys import resolve_schema_version
    from transit_ops.lake.objects import ObjectKeyTaken
    from transit_ops.lake.table_schema import TableSchema

    class RacingStorage(LocalBronzeStorage):
        def put_if_absent(self, temp_path, storage_path):
            competitor = self.root / storage_path
            competitor.parent.mkdir(parents=True, exist_ok=True)
            competitor.write_bytes(b"competing schema")
            return super().put_if_absent(temp_path, storage_path)

    storage = RacingStorage("local", tmp_path / "objects")
    schema = TableSchema.from_columns([("id", "integer", True)], ["id"])
    with pytest.raises(ObjectKeyTaken):
        resolve_schema_version(storage, "core.providers", schema)
    assert storage.read_bytes(schema_key("core.providers", 1)) == b"competing schema"


def test_unproven_object_does_not_deduplicate_and_latest_matching_receipt_wins(tmp_path):
    from transit_ops.ingestion.storage import LocalBronzeStorage
    from transit_ops.lake.archive_keys import resolve_copy_version

    storage = LocalBronzeStorage("local", tmp_path / "objects")
    args = (storage, "core.providers", "_shared", 0, "month", "2026-11")
    key = table_copy_key(*args[1:], 1, 1)
    path = storage.root / key
    path.parent.mkdir(parents=True)
    path.write_bytes(b"unproven")
    result = resolve_copy_version(*args, "a" * 64)
    assert (result.version, result.key) == (2, None)
    for version in (2, 10):
        candidate = table_copy_key(*args[1:], version, 1)
        (storage.root / proof_key(candidate)).write_text(json.dumps({"content_sha256": "a" * 64}))
    result = resolve_copy_version(*args, "a" * 64)
    assert result.version == 10
    assert result.key == table_copy_key(*args[1:], 10, 1)
