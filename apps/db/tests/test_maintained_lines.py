"""Exercise the maintained-line policy through its Git-backed CLI."""

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / ".github/scripts/maintained-lines.py"


def git(repo: Path, *args: str) -> str:
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()


def write(repo: Path, path: str, content: bytes) -> None:
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)


def fixture_repo(tmp_path: Path, files: dict[str, bytes]) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "config", "user.name", "Counter Test")
    git(repo, "config", "user.email", "counter@example.invalid")
    git(repo, "config", "core.autocrlf", "false")
    for path, content in files.items():
        write(repo, path, content)
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "fixture")
    return repo


def digest(repo: Path, paths: list[str]) -> str:
    result = hashlib.sha256()
    for path in sorted(set(paths), key=lambda value: value.encode("utf-8")):
        name, content = path.encode("utf-8"), (repo / path).read_bytes()
        result.update(len(name).to_bytes(8, "big") + name)
        result.update(len(content).to_bytes(8, "big") + content)
    return result.hexdigest()


def config(repo: Path, baseline_lines: int, exclusions: list[dict] | None = None) -> None:
    policy = {
        "measurement_version": 3,
        "baseline_ref": git(repo, "rev-parse", "HEAD"),
        "baseline_lines": baseline_lines,
        "exclusions": exclusions or [],
    }
    write(repo, ".github/maintained-lines.json", json.dumps(policy).encode())


def run(repo: Path, tmp_path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    copied = tmp_path / "counter.py"
    shutil.copyfile(SCRIPT, copied)
    return subprocess.run(
        [sys.executable, str(copied), "--json", *args], cwd=repo, capture_output=True, text=True
    )


def test_cap_counts_authored_lines_and_validates_exact_generated_provenance(tmp_path: Path):
    repo = fixture_repo(tmp_path, {"source.py": b"a\nb\nc\n", "generated.json": b"one\ntwo\n"})
    config(repo, 3, [{
        "category": "generated",
        "reason": "fixture output",
        "origin": "produced by source.py",
        "files": ["generated.json"],
        "owners": ["source.py"],
        "sha256": [digest(repo, ["generated.json", "source.py"])],
    }])
    result = run(repo, tmp_path, "--max", "3")
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["maintained_lines"] == 3
    assert run(repo, tmp_path, "--max", "2").returncode == 1
    rows = {row["path"]: row for row in report["files"]}
    assert rows["source.py"]["counted"] is True
    assert rows["generated.json"]["counted"] is False


def test_all_utf8_authored_content_counts_physical_lines(tmp_path: Path):
    repo = fixture_repo(tmp_path, {
        "crlf.txt": b"\xef\xbb\xbfa\r\n\r\nc",
        "embedded-null.py": b"a\0b\n",
        "static/index.html": b"<p>authored</p>\n",
        "static/settings.json": b'{"authored": true}\n',
        "quote.txt": b'"DO NOT EDIT: this is quoted text"\n',
        "vendor/new.js": b"const authored = 1;\n\n",
        "generated/new.py": b"authored = 1\n\n",
        "empty": b"",
    })
    config(repo, 11)
    result = run(repo, tmp_path)
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["maintained_lines"] == 11
    assert all(row["counted"] for row in report["files"])
    assert len(report["commit"]) == len(report["tree"]) == 40
    assert len(report["source_sha256"]) == 64
    assert report["source_sha256"] == digest(repo, [row["path"] for row in report["files"]])


def test_worktree_additions_deletions_ignored_files_and_policy_itself(tmp_path: Path):
    repo = fixture_repo(tmp_path, {".gitignore": b"ignored.txt\n", "deleted.py": b"one\ntwo\n"})
    config(repo, 3)
    (repo / "deleted.py").unlink()
    write(repo, "new.py", b"one\ntwo\nthree\n")
    write(repo, "ignored.txt", b"ignored\n" * 100)
    assert json.loads(run(repo, tmp_path).stdout)["maintained_lines"] == 3
    report = json.loads(run(repo, tmp_path, "--worktree").stdout)
    assert report["maintained_lines"] == 5
    assert {row["path"] for row in report["files"]} == {
        ".gitignore", ".github/maintained-lines.json", "new.py"
    }
    write(repo, "new.py", b"four\n")
    changed = json.loads(run(repo, tmp_path, "--worktree").stdout)
    assert changed["source_sha256"] != report["source_sha256"]


def test_binary_assets_need_valid_provenance_and_missing_or_stale_groups_fail(tmp_path: Path):
    repo = fixture_repo(tmp_path, {"owner.txt": b"asset origin\n", "image.bin": b"\xff\0"})
    group = {
        "category": "assets", "reason": "binary fixture", "origin": "owner.txt description",
        "files": ["image.bin"], "owners": ["owner.txt"],
        "sha256": [digest(repo, ["image.bin", "owner.txt"])],
    }
    config(repo, 1, [group])
    result = run(repo, tmp_path)
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["maintained_lines"] == 1
    assert next(row for row in report["files"] if row["path"] == "image.bin")["lines"] is None
    write(repo, "owner.txt", b"changed provenance\n")
    stale = run(repo, tmp_path, "--worktree")
    assert stale.returncode == 2
    assert "stale provenance" in stale.stdout
    (repo / "image.bin").unlink()
    missing = run(repo, tmp_path, "--worktree")
    assert missing.returncode == 2
    assert "missing provenance paths" in missing.stdout
    config(repo, 1)
    undecodable = run(repo, tmp_path)
    assert undecodable.returncode == 2
    assert "authored file is not UTF-8: image.bin" in undecodable.stdout


def test_baseline_check_validates_configured_ref_independently_of_target(tmp_path: Path):
    repo = fixture_repo(tmp_path, {"source.py": b"one\n"})
    config(repo, 1)
    write(repo, "extra.py", b"two\nthree\n")
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "target includes policy and more authored lines")
    result = run(repo, tmp_path, "--baseline-check")
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["maintained_lines"] == 4
    assert report["baseline"]["maintained_lines"] == 1
    policy_path = repo / ".github/maintained-lines.json"
    policy = json.loads(policy_path.read_bytes())
    policy["baseline_lines"] = 2
    policy_path.write_text(json.dumps(policy), encoding="utf-8")
    mismatch = run(repo, tmp_path, "--baseline-check")
    assert mismatch.returncode == 2
    assert "baseline mismatch" in mismatch.stdout
    assert report["policy_sha256"] != json.loads(run(repo, tmp_path).stdout)["policy_sha256"]


@pytest.mark.parametrize("args", [
    ("--max", "-1"), ("--max", "not-an-integer"), ("--ref", "missing"),
    ("--ref", "HEAD", "--worktree"),
])
def test_invalid_cli_inputs_fail_with_exit_two(tmp_path: Path, args: tuple[str, ...]):
    repo = fixture_repo(tmp_path, {"source.py": b"one\n"})
    config(repo, 1)
    result = run(repo, tmp_path, *args)
    assert result.returncode == 2
    assert result.stderr


@pytest.mark.parametrize("files", [
    ["../source.py"], ["/source.py"], ["C:/source.py"], ["*.py"],
    ["source.py", "source.py"], ["dir\\source.py"], ["dir/./source.py"],
])
def test_invalid_exact_provenance_paths_are_rejected(tmp_path: Path, files: list[str]):
    repo = fixture_repo(tmp_path, {"source.py": b"one\n"})
    config(repo, 1, [{
        "category": "generated", "reason": "invalid fixture", "origin": "fixture",
        "files": files, "owners": ["source.py"], "sha256": ["0" * 64],
    }])
    result = run(repo, tmp_path)
    assert result.returncode == 2
    assert json.loads(result.stdout)["provenance_failures"]


def test_new_authored_files_under_excluded_directory_still_count(tmp_path: Path):
    repo = fixture_repo(tmp_path, {"owner.py": b"one\n", "vendor/release.js": b"external\n"})
    config(repo, 1, [{
        "category": "vendor", "reason": "exact release", "origin": "owner.py release record",
        "files": ["vendor/release.js"], "owners": ["owner.py"],
        "sha256": [digest(repo, ["vendor/release.js", "owner.py"])],
    }])
    write(repo, "vendor/authored.js", b"one\ntwo\n")
    git(repo, "add", "vendor/authored.js")
    git(repo, "commit", "-qm", "authored file beside vendor release")
    result = run(repo, tmp_path)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["maintained_lines"] == 3


def test_changed_exclusion_content_requires_explicit_accepted_digest(tmp_path: Path):
    repo = fixture_repo(tmp_path, {"owner.py": b"one\n", "generated.json": b"old\n"})
    original = digest(repo, ["owner.py", "generated.json"])
    write(repo, "generated.json", b"new\n")
    updated = digest(repo, ["owner.py", "generated.json"])
    git(repo, "add", "generated.json")
    git(repo, "commit", "-qm", "new generated output")
    config(repo, 1, [{
        "category": "generated", "reason": "two approved outputs", "origin": "owner.py",
        "files": ["generated.json"], "owners": ["owner.py"], "sha256": [original, updated],
    }])
    result = run(repo, tmp_path, "--baseline-check")
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["maintained_lines"] == 1
    historical = run(repo, tmp_path, "--ref", "HEAD~1")
    assert historical.returncode == 0, historical.stderr
    assert json.loads(historical.stdout)["maintained_lines"] == 1


@pytest.mark.parametrize(("field", "value"), [
    ("category", []), ("category", {}), ("category", "source"),
    ("files", "source.py"), ("owners", []), ("sha256", [42]),
    ("reason", ""), ("origin", None),
])
def test_malformed_provenance_groups_fail_cleanly(tmp_path: Path, field: str, value: object):
    repo = fixture_repo(tmp_path, {"source.py": b"one\n"})
    group = {
        "category": "generated", "reason": "fixture", "origin": "fixture",
        "files": ["source.py"], "owners": ["source.py"], "sha256": ["0" * 64],
    }
    group[field] = value
    config(repo, 1, [group])
    result = run(repo, tmp_path)
    assert result.returncode == 2
    assert json.loads(result.stdout)["provenance_failures"]
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize("policy", [
    [], {}, {"measurement_version": 3},
    {"measurement_version": True, "baseline_ref": "0" * 40, "baseline_lines": 1, "exclusions": []},
    {"measurement_version": 3, "baseline_ref": "HEAD", "baseline_lines": 1, "exclusions": []},
    {"measurement_version": 3, "baseline_ref": "0" * 40, "baseline_lines": -1, "exclusions": []},
    {"measurement_version": 3, "baseline_ref": "0" * 40, "baseline_lines": 1, "exclusions": {}},
])
def test_malformed_policy_fails_cleanly(tmp_path: Path, policy: object):
    repo = fixture_repo(tmp_path, {"source.py": b"one\n"})
    write(repo, ".github/maintained-lines.json", json.dumps(policy).encode())
    result = run(repo, tmp_path)
    assert result.returncode == 2
    assert json.loads(result.stdout)["provenance_failures"]
    assert "Traceback" not in result.stderr
