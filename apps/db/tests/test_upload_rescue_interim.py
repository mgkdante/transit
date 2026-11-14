import csv
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
from unittest.mock import Mock

import psycopg
import pytest
from sqlalchemy.engine import Engine

from transit_ops.history.storage import history_storage
from transit_ops.ingestion.storage import ObjectAlreadyExists
from transit_ops.settings import Settings


@pytest.fixture
def upload(monkeypatch):
    forbidden = Mock(side_effect=AssertionError("database opened"))
    monkeypatch.setattr(psycopg, "connect", forbidden)
    monkeypatch.setattr(Engine, "connect", forbidden)
    scripts = Path(__file__).parents[1] / "scripts"
    monkeypatch.syspath_prepend(str(scripts))
    # Execute afresh so another test's cached import cannot hide import-time I/O.
    spec = importlib.util.spec_from_file_location(
        "upload_rescue_interim", scripts / "upload_rescue_interim.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    yield module
    forbidden.assert_not_called()


class Storage:
    def __init__(self, status=None, corrupt=False):
        self.objects, self.gets, self.puts = {}, [], []
        self.status, self.corrupt = status, corrupt

    def put_if_absent(self, path, key):
        self.puts.append(key)
        if key in self.objects:
            raise ObjectAlreadyExists("secret", self.status)
        self.objects[key] = path.open("rb").read()
        path.unlink()  # Bronze consumes successful uploads.

    def open_stream(self, key):
        self.gets.append(key)
        return io.BytesIO(self.objects[key] + (b"corrupt" if self.corrupt else b""))


@pytest.fixture
def setup(upload, tmp_path, monkeypatch):
    source = tmp_path / "source"
    source.mkdir()
    command = [
        "--source-dir",
        str(source),
        "--spool-dir",
        str(tmp_path / "spool"),
        "--copy-label",
        "copy-a",
        "--note",
        "snapshot_now=receipt snapshot",
        "--note",
        "bounds=receipt bounds",
        "--note",
        "method=read only COPY",
    ]
    originals = {}
    for table, schema in upload.SCHEMAS.items():
        stream = io.StringIO(newline="")
        writer = csv.writer(stream)
        writer.writerow([column[0] for column in schema])
        writer.writerow(["Montréal\n南", ""] + ["1"] * 18)
        payload = stream.getvalue().encode()
        originals[table] = payload
        (source / (table + ".csv")).write_bytes(payload)
        command += ["--expect", table + "=" + hashlib.sha256(payload).hexdigest()]
    storage = Storage()
    scope = Mock()
    scope.resolve.return_value = storage
    monkeypatch.setattr(upload, "history_storage", lambda: scope)
    return command, source, originals, storage


@pytest.mark.parametrize("bad", ["digest", "header", "missing", "label", "expect"])
def test_invalid_input_never_puts(upload, setup, bad, capsys):
    command, source, originals, storage = setup
    table = list(originals)[-1]
    path = source / (table + ".csv")
    if bad == "digest":
        path.write_bytes(b"changed")
    elif bad == "header":
        payload = b"wrong\n1\n"
        path.write_bytes(payload)
        command[-1] = table + "=" + hashlib.sha256(payload).hexdigest()
    elif bad == "missing":
        path.unlink()
    elif bad == "label":
        command[5] = "../secret"
    else:
        command = command[:-2]
    assert upload.main(command) == 2
    assert storage.puts == []
    assert "secret" not in capsys.readouterr().out


def test_verified_deterministic_rerun_preserves_sources_without_database(upload, setup, capsys):
    command, source, originals, storage = setup
    assert upload.main(command) == 0
    first = dict(storage.objects)
    assert upload.main(command) == 0
    assert storage.objects == first
    manifest = json.loads(first["rescue/v1/interim/copy-a/manifest.json"])
    assert manifest["kind"] == "interim_unordered_csv"
    assert manifest["notes"]["snapshot_now"] == "receipt snapshot"
    assert len(storage.gets) == 6
    for table, payload in originals.items():
        key = f"rescue/v1/interim/copy-a/{table}.csv.gz"
        assert gzip.decompress(first[key]) == payload
        assert first[key][4:8] == bytes(4)
        assert manifest["tables"][table]["rows"] == 1
        assert (source / (table + ".csv")).read_bytes() == payload
    assert all(
        json.loads(line)["outcome"] == "verified" for line in capsys.readouterr().out.splitlines()
    )


@pytest.mark.parametrize("status", [409, 412])
@pytest.mark.parametrize("equal", [True, False])
def test_collision_requires_equal_bytes(upload, setup, status, equal):
    command, _, _, storage = setup
    assert upload.main(command) == 0
    storage.status = status
    if not equal:
        storage.objects.pop("rescue/v1/interim/copy-a/manifest.json")
        storage.objects[next(iter(storage.objects))] = b"different"
    assert upload.main(command) == (0 if equal else 1)
    assert equal or not any(key.endswith("manifest.json") for key in storage.objects)


def test_bad_readback_stops_before_manifest(upload, setup):
    command, _, _, storage = setup
    storage.corrupt = True
    assert upload.main(command) == 1
    assert not any(key.endswith("manifest.json") for key in storage.objects)


def test_real_storage_factory_without_database(upload, setup, monkeypatch, capsys):
    command, _, originals, _ = setup
    settings = Settings(
        _env_file=None,
        BRONZE_S3_ENDPOINT="https://storage.example.test",
        BRONZE_S3_BUCKET="test-bucket",
        BRONZE_S3_ACCESS_KEY="test-access",
        BRONZE_S3_SECRET_KEY="test-secret",
    )
    objects = {}

    def put_object(*, Bucket, Key, Body, IfNoneMatch):
        assert Bucket == "test-bucket"
        assert IfNoneMatch == "*"
        assert Key not in objects
        objects[Key] = Body.read()

    def get_object(*, Bucket, Key):
        assert Bucket == "test-bucket"
        return {"Body": io.BytesIO(objects[Key])}

    client = Mock(spec=["put_object", "get_object", "close"])
    client.put_object.side_effect = put_object
    client.get_object.side_effect = get_object
    monkeypatch.setattr("transit_ops.ingestion.storage.build_s3_client", lambda _: client)
    monkeypatch.setattr(upload, "history_storage", lambda: history_storage(settings))
    assert upload.main(command) == 0
    client.close.assert_called_once_with()
    manifest = json.loads(objects["rescue/v1/interim/copy-a/manifest.json"])
    assert set(manifest["tables"]) == set(originals)
    for table, payload in originals.items():
        assert gzip.decompress(objects[f"rescue/v1/interim/copy-a/{table}.csv.gz"]) == payload
    assert json.loads(capsys.readouterr().out)["outcome"] == "verified"


@pytest.mark.parametrize("retained_bytes", [0, 1, -1])
def test_truncated_readback_fails_without_verification(
    upload, setup, monkeypatch, capsys, retained_bytes
):
    command, _, _, storage = setup

    def truncated_stream(key):
        payload = storage.objects[key]
        return io.BytesIO(payload[:retained_bytes])

    monkeypatch.setattr(storage, "open_stream", truncated_stream)
    assert upload.main(command) == 1
    assert storage.puts
    assert not any(key.endswith("manifest.json") for key in storage.objects)
    assert [json.loads(line) for line in capsys.readouterr().out.splitlines()] == [
        dict(outcome="failed", phase="upload_readback", reason="refused_or_failed")
    ]


@pytest.mark.parametrize("after_verification", [False, True])
def test_changed_source_fails_without_verification(
    upload, setup, monkeypatch, capsys, after_verification
):
    command, source, originals, storage = setup
    table = next(iter(originals))

    def mutate():
        path = source / (table + ".csv")
        path.write_bytes(originals[table].replace(b"1", b"2"))

    if after_verification:
        inputs = upload.inputs

        def verified_inputs(argv):
            result = inputs(argv)
            mutate()
            return result

        monkeypatch.setattr(upload, "inputs", verified_inputs)
    else:
        mutate()
    assert upload.main(command) == (1 if after_verification else 2)
    assert storage.puts == []
    assert storage.objects == {}
    assert [json.loads(line) for line in capsys.readouterr().out.splitlines()] == [
        dict(
            outcome="failed",
            phase="spool" if after_verification else "input",
            reason="refused_or_failed",
        )
    ]
