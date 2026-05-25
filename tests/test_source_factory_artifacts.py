import pytest

from transit_ops.source_factory.artifacts import write_json_artifact


def test_write_json_artifact_writes_stable_sorted_pretty_json(tmp_path) -> None:
    artifact = write_json_artifact(
        tmp_path / "slice-8.6" / "preflight.json",
        {"z": 1, "a": {"phase": "preflight"}},
    )

    expected_body = (
        '{\n'
        '  "a": {\n'
        '    "phase": "preflight"\n'
        "  },\n"
        '  "z": 1\n'
        "}\n"
    )

    assert artifact.path.name == "preflight.json"
    assert artifact.path.read_bytes() == expected_body.encode()
    assert artifact.byte_size == 52
    assert artifact.sha256 == "ac3d1c5b06379b093edc82ac5661a79e9d7666f3a58e9f6c2243d8052cacb8db"


def test_write_json_artifact_rejects_non_json_payload_without_partial_file(tmp_path) -> None:
    artifact_path = tmp_path / "slice-8.6" / "bad.json"

    with pytest.raises(TypeError):
        write_json_artifact(artifact_path, {"bad": object()})

    assert not artifact_path.exists()


def test_write_json_artifact_rejects_nan_without_partial_file(tmp_path) -> None:
    artifact_path = tmp_path / "slice-8.6" / "nan.json"

    with pytest.raises(ValueError):
        write_json_artifact(artifact_path, {"bad": float("nan")})

    assert not artifact_path.exists()
