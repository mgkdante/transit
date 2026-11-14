import csv
import gzip
import hashlib
import io
import json
import sys
from pathlib import Path
from unittest.mock import Mock

import psycopg
import pytest
from sqlalchemy.engine import Engine

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
import upload_rescue_interim as upload  # noqa: E402


class Storage:
    def __init__(self, status=None, corrupt=False):
        self.objects, self.gets, self.puts = {}, [], []
        self.status, self.corrupt = status, corrupt

    def put_if_absent(self, path, key):
        self.puts.append(key)
        if key in self.objects:
            raise upload.ObjectAlreadyExists("secret", self.status)
        self.objects[key] = path.open("rb").read()
        path.unlink()  # Bronze consumes successful uploads.

    def open_stream(self, key):
        self.gets.append(key)
        return io.BytesIO(self.objects[key] + (b"corrupt" if self.corrupt else b""))


@pytest.fixture
def setup(tmp_path, monkeypatch):
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
def test_invalid_input_never_puts(setup, bad, capsys):
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


def test_verified_deterministic_rerun_preserves_sources_without_database(
    setup, monkeypatch, capsys
):
    command, source, originals, storage = setup
    forbidden = Mock(side_effect=AssertionError("database opened"))
    monkeypatch.setattr(psycopg, "connect", forbidden)
    monkeypatch.setattr(Engine, "connect", forbidden)
    assert upload.main(command) == 0
    first = dict(storage.objects)
    assert upload.main(command) == 0
    forbidden.assert_not_called()
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
def test_collision_requires_equal_bytes(setup, status, equal):
    command, _, _, storage = setup
    assert upload.main(command) == 0
    storage.status = status
    if not equal:
        storage.objects.pop("rescue/v1/interim/copy-a/manifest.json")
        storage.objects[next(iter(storage.objects))] = b"different"
    assert upload.main(command) == (0 if equal else 1)
    assert equal or not any(key.endswith("manifest.json") for key in storage.objects)


def test_bad_readback_stops_before_manifest(setup):
    command, _, _, storage = setup
    storage.corrupt = True
    assert upload.main(command) == 1
    assert not any(key.endswith("manifest.json") for key in storage.objects)
