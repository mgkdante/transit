from __future__ import annotations

import hashlib
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
from zipfile import ZipFile

import pytest
import yaml
from sqlalchemy import Engine, event, text
from sqlalchemy.exc import ProgrammingError

import transit_ops.gold.marts as gold
import transit_ops.ingestion.static_gtfs as capture
import transit_ops.orchestration as pipeline
import transit_ops.silver.static_gtfs as silver
from transit_ops.ingestion.common import DownloadedArtifact
from transit_ops.ingestion.storage import get_bronze_storage
from transit_ops.maintenance.bronze import prune_bronze_static_objects
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings


def static_zip(route_name: str, *, empty: bool = False) -> bytes:
    members = {
        "routes.txt": f"route_id,route_type,route_long_name\nR,3,{route_name}\n",
        "stops.txt": "stop_id,stop_name,stop_lat,stop_lon\nS,Station,45.5,-73.5\n",
        "trips.txt": "route_id,service_id,trip_id\nR,WK,T\n",
        "stop_times.txt": (
            "trip_id,stop_id,stop_sequence,arrival_time,departure_time\nT,S,1,08:00:00,08:00:00\n"
        ),
        "calendar_dates.txt": "service_id,date,exception_type\nWK,20260904,1\n",
    }
    contents = BytesIO()
    with ZipFile(contents, "w") as archive:
        for name, rows in members.items():
            archive.writestr(name, rows.splitlines(keepends=True)[0] if empty else rows)
    return contents.getvalue()


@dataclass
class StaticPipeline:
    provider_id: str
    settings: Settings
    registry: ProviderRegistry
    engine: Engine
    payload: bytes

    def run(self):
        return pipeline.run_static_pipeline(
            self.provider_id, settings=self.settings, registry=self.registry, engine=self.engine
        )

    def ingest(self):
        return capture.ingest_static_feed(
            self.provider_id, settings=self.settings, registry=self.registry, engine=self.engine
        )

    def download(self, source_url: str, temp_dir: Path) -> DownloadedArtifact:
        temp_dir.mkdir(parents=True, exist_ok=True)
        path = temp_dir / f"{uuid4().hex}.zip"
        path.write_bytes(self.payload)
        return DownloadedArtifact(
            path, len(self.payload), hashlib.sha256(self.payload).hexdigest(), 200, source_url
        )

    def state(self):
        with self.engine.connect() as connection:
            current = connection.execute(
                text("""
                    SELECT dataset_version_id FROM core.dataset_versions
                    WHERE provider_id=:p AND is_current AND dataset_kind='static_schedule'
                """),
                {"p": self.provider_id},
            ).scalar_one_or_none()
            gold_version = connection.execute(
                text("SELECT DISTINCT dataset_version_id FROM gold.dim_route WHERE provider_id=:p"),
                {"p": self.provider_id},
            ).scalar_one_or_none()
        return current, gold_version


@pytest.fixture
def subject(real_db_engine, seed_provider, tmp_path, monkeypatch):
    provider_id = f"static_recovery_{uuid4().hex[:10]}"
    manifest = yaml.safe_load((Path(__file__).parents[1] / "config/providers/stm.yaml").read_text())
    manifest["provider"]["provider_id"] = provider_id
    manifest["feeds"] = {"static_schedule": manifest["feeds"]["static_schedule"]}
    config = tmp_path / "providers"
    config.mkdir()
    (config / "provider.yaml").write_text(yaml.safe_dump(manifest))
    settings = Settings(
        _env_file=None, BRONZE_STORAGE_BACKEND="local", BRONZE_LOCAL_ROOT=str(tmp_path / "bronze")
    )
    subject = StaticPipeline(
        provider_id,
        settings,
        ProviderRegistry(config, settings),
        real_db_engine,
        static_zip("Original"),
    )
    with real_db_engine.begin() as connection:
        seed_provider(connection, provider_id, display_name="Static pipeline recovery")
        connection.execute(
            text("""
                INSERT INTO core.feed_endpoints(provider_id, endpoint_key, feed_kind, source_format)
                VALUES (:p, 'static_schedule', 'static_schedule', 'gtfs_schedule_zip')
            """),
            {"p": provider_id},
        )
    monkeypatch.setattr(capture, "_download_to_tempfile", subject.download)
    monkeypatch.setattr(
        pipeline,
        "_run_gis_steps_best_effort",
        lambda *a, **k: pipeline._GisStepsOutcome(None, None, None, None, "skipped", None),
    )
    yield subject
    with real_db_engine.begin() as connection:
        for table in (
            "gold.schedule_version_service_summary",
            "gold.dim_date",
            "gold.dim_stop",
            "gold.dim_route_pattern",
            "gold.dim_route",
            "gold.dim_route_history",
            "gold.dim_stop_history",
            "silver.gtfs_source_members",
            "silver.stop_times",
            "silver.trips",
            "silver.stops",
            "silver.calendar_dates",
            "silver.routes",
            "core.dataset_versions",
            "raw.ingestion_objects",
            "raw.ingestion_runs",
            "core.feed_endpoints",
            "core.providers",
        ):
            connection.execute(
                text(f"DELETE FROM {table} WHERE provider_id=:p"), {"p": provider_id}
            )


@pytest.mark.parametrize("stage", ["silver", "gold"])
def test_identical_source_retries_only_the_unfinished_stage(subject, stage):
    subject.run()
    previous, _ = subject.state()
    subject.payload = static_zip("Replacement")
    target, operation = (
        (silver, "_build_trip_record") if stage == "silver" else (gold, "_record_dim_name_history")
    )
    with patch.object(target, operation, side_effect=RuntimeError("interrupted stage")):
        with pytest.raises(RuntimeError, match="interrupted stage"):
            subject.run()
    current, gold_version = subject.state()
    assert gold_version == previous
    assert (current == previous) is (stage == "silver")
    with (
        patch.object(
            pipeline, "load_latest_static_to_silver", wraps=pipeline.load_latest_static_to_silver
        ) as load,
        patch.object(
            pipeline, "refresh_gold_static", wraps=pipeline.refresh_gold_static
        ) as refresh,
    ):
        result = subject.run()
    assert result.status == "succeeded"
    assert result.static_ingestion["content_changed"] is False
    assert load.call_count == (1 if stage == "silver" else 0)
    assert refresh.call_count == 1
    current, gold_version = subject.state()
    assert current == gold_version and current != previous
    with (
        patch.object(pipeline, "load_latest_static_to_silver") as load,
        patch.object(pipeline, "refresh_gold_static") as refresh,
    ):
        repeated = subject.run()
    assert repeated.static_changed is False
    load.assert_not_called()
    refresh.assert_not_called()


def test_initial_capture_does_not_publish_a_dataset_until_loaded(subject):
    capture_result = subject.ingest()
    assert capture_result.dataset_version_id is None
    assert subject.state() == (None, None)
    result = subject.run()
    assert result.static_ingestion["content_changed"] is False
    current, gold_version = subject.state()
    assert current is not None and current == gold_version


def test_reverting_source_bytes_applies_the_reverted_edition(subject):
    original = subject.payload
    subject.run()
    subject.payload = static_zip("Replacement")
    subject.run()
    replacement, _ = subject.state()
    subject.payload = original
    result = subject.run()
    assert result.static_ingestion["content_changed"] is True
    current, gold_version = subject.state()
    assert current == gold_version and current != replacement
    with subject.engine.connect() as connection:
        name = connection.execute(
            text("SELECT route_long_name FROM gold.dim_route WHERE provider_id=:p"),
            {"p": subject.provider_id},
        ).scalar_one()
    assert name == "Original"


def test_upgrade_restores_usable_dataset_before_retrying_captured_only_current(subject):
    subject.run()
    previous, _ = subject.state()
    subject.payload = static_zip("Replacement")
    captured = subject.ingest()
    with subject.engine.begin() as connection:
        connection.execute(
            text("UPDATE core.dataset_versions SET is_current=false WHERE provider_id=:p"),
            {"p": subject.provider_id},
        )
        connection.execute(
            text("""
                INSERT INTO core.dataset_versions(
                    provider_id, feed_endpoint_id, source_ingestion_run_id,
                    source_ingestion_object_id, dataset_kind, content_hash, is_current
                )
                SELECT :p, feed_endpoint_id, :run, :object, 'static_schedule', :hash, true
                FROM core.feed_endpoints
                WHERE provider_id=:p AND endpoint_key='static_schedule'
            """),
            {
                "p": subject.provider_id,
                "run": captured.ingestion_run_id,
                "object": captured.ingestion_object_id,
                "hash": captured.checksum_sha256,
            },
        )
    with patch.object(silver, "_build_trip_record", side_effect=RuntimeError("still unavailable")):
        with pytest.raises(RuntimeError, match="still unavailable"):
            subject.run()
    assert subject.state() == (previous, previous)
    subject.run()
    current, gold_version = subject.state()
    assert current == gold_version and current != previous


def test_empty_routes_cannot_replace_the_usable_dataset(subject):
    subject.run()
    previous = subject.state()
    subject.payload = static_zip("Empty", empty=True)
    for _ in range(2):
        with pytest.raises(ValueError, match="routes.txt must contain at least one route"):
            subject.run()
        assert subject.state() == previous


def test_analyze_failure_rolls_back_materialization_and_retries_identical_source(subject):
    subject.run()
    previous = subject.state()
    subject.payload = static_zip("Replacement")
    analyzed = []
    fail_analyze = True

    def capture_analyze(connection, cursor, statement, parameters, context, executemany):
        nonlocal fail_analyze
        if statement.startswith("ANALYZE "):
            analyzed.append(statement)
        if statement == "ANALYZE silver.routes" and fail_analyze:
            fail_analyze = False
            return "ANALYZE silver.unavailable_static_statistics", parameters
        return statement, parameters

    event.listen(subject.engine, "before_cursor_execute", capture_analyze, retval=True)
    try:
        with pytest.raises(ProgrammingError, match="unavailable_static_statistics"):
            subject.run()
        assert subject.state() == previous
        analyzed.clear()
        retried = subject.run()
        assert retried.static_ingestion["content_changed"] is False
        assert analyzed == [f"ANALYZE {table}" for table in silver._POST_LOAD_ANALYZE_TABLES]
        current, gold_version = subject.state()
        assert current == gold_version and current != previous[0]
        analyzed.clear()
        completed = subject.run()
        assert completed.static_changed is False
        assert analyzed == []
    finally:
        event.remove(subject.engine, "before_cursor_execute", capture_analyze)


@pytest.mark.parametrize("has_previous_dataset", [True, False])
def test_retention_after_capture_cannot_load_different_source_bytes(subject, has_previous_dataset):
    if has_previous_dataset:
        subject.run()
    previous = subject.state()
    subject.payload = static_zip("Pending")
    wanted_hash = hashlib.sha256(subject.payload).hexdigest()
    with patch.object(silver, "_build_trip_record", side_effect=RuntimeError("unfinished")):
        with pytest.raises(RuntimeError, match="unfinished"):
            subject.run()
    with subject.engine.begin() as connection:
        connection.execute(
            text("""
                UPDATE raw.ingestion_runs AS ir
                SET started_at_utc=now()-CASE WHEN io.checksum_sha256=:wanted
                    THEN interval '40 days' ELSE interval '60 days' END
                FROM raw.ingestion_objects AS io
                WHERE ir.ingestion_run_id=io.ingestion_run_id AND ir.provider_id=:provider
            """),
            {"provider": subject.provider_id, "wanted": wanted_hash},
        )
    prepare = pipeline.prepare_static_application

    def prune_after_capture(provider_id, *, engine):
        storage = get_bronze_storage(
            subject.settings, project_root=Path(__file__).parents[1], storage_backend="local"
        )
        with engine.begin() as connection:
            _, objects, _, failures = prune_bronze_static_objects(
                connection, provider_id=provider_id, retention_days=30, bronze_storage=storage
            )
            assert not failures
            assert objects == {"static": 1}
        return prepare(provider_id, engine=engine)

    with patch.object(pipeline, "prepare_static_application", prune_after_capture):
        with pytest.raises(ValueError, match="does not match|No successful Bronze"):
            subject.run()
    assert subject.state() == previous
    retried = subject.run()
    assert retried.static_ingestion["content_changed"] is True
    assert retried.silver_load["content_hash"] == wanted_hash
    current, gold_version = subject.state()
    assert current == gold_version and current != previous[0]
