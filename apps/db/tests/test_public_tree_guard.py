from __future__ import annotations

import codecs
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
GUARD = REPO_ROOT / ".github/scripts/check_public_tree.py"
WORKFLOW = REPO_ROOT / ".github/workflows/secret-scan.yml"
DOCKERIGNORE = REPO_ROOT / "apps/db/.dockerignore"
CONTRIBUTING = REPO_ROOT / "CONTRIBUTING.md"


@dataclass
class IndexedRepo:
    root: Path
    env: dict[str, str]

    def write(self, path: str, content: str) -> None:
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")

    def write_bytes(self, path: str, content: bytes) -> None:
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

    def symlink(self, path: str, target: str) -> None:
        link = self.root / path
        link.parent.mkdir(parents=True, exist_ok=True)
        link.symlink_to(target)

    def stage(self, *paths: str, force: bool = False) -> None:
        args = ["add"]
        if force:
            args.append("--force")
        args.extend(["--", *paths])
        self.git(*args)

    def delete_and_stage(self, path: str) -> None:
        (self.root / path).unlink()
        self.git("add", "--update", "--", path)

    def git(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *args],
            cwd=self.root,
            env=self.env,
            check=True,
            capture_output=True,
            text=True,
        )

    def run_guard(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(GUARD)],
            cwd=self.root,
            env=self.env,
            check=False,
            capture_output=True,
            text=True,
        )


@pytest.fixture
def indexed_repo(tmp_path: Path) -> IndexedRepo:
    root = tmp_path / "repo"
    root.mkdir()
    subprocess.run(["git", "init", "--quiet"], cwd=root, check=True)
    env = os.environ.copy()
    env["GIT_INDEX_FILE"] = str(tmp_path / "public-tree.index")
    subprocess.run(
        ["git", "read-tree", "--empty"],
        cwd=root,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    return IndexedRepo(root=root, env=env)


def test_tracked_but_ignored_path_fails(indexed_repo: IndexedRepo) -> None:
    indexed_repo.write(".gitignore", ".cache/\n")
    indexed_repo.write(".cache/runtime.txt", "generated output\n")
    indexed_repo.stage(".gitignore")
    indexed_repo.stage(".cache/runtime.txt", force=True)

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout.splitlines() == ["tracked-ignored: .cache/runtime.txt:1"]
    assert result.stderr == ""


@pytest.mark.parametrize(
    "path",
    [
        "tls/client.crt",
        "tls/client.cer",
        "tls/client.der",
        "tls/client.key",
        "tls/client.pem",
        "tls/client.p12",
        "tls/client.pfx",
        "tls/client.pkcs12",
        "tls/client.jks",
        "tls/client.keystore",
        "tls/client.kdbx",
    ],
)
def test_crypto_material_suffix_fails(indexed_repo: IndexedRepo, path: str) -> None:
    indexed_repo.write(path, "not secret, but this file type does not belong in Git\n")
    indexed_repo.stage(path)

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout.splitlines() == [f"crypto-material: {path}:1"]


@pytest.mark.parametrize("kind", ["CERTIFICATE", "PRIVATE KEY", "RSA PRIVATE KEY"])
def test_renamed_pem_material_fails(indexed_repo: IndexedRepo, kind: str) -> None:
    marker = "-----BEGIN " + kind + "-----"
    indexed_repo.write("notes.txt", f"heading\n{marker}\nencoded-body\n")
    indexed_repo.stage("notes.txt")

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout.splitlines() == ["pem-material: notes.txt:2"]


@pytest.mark.parametrize(
    "path",
    [
        "apps/db/artifacts/runtime.json",
        "nested/.superpowers/session.md",
        "nested/.codex/transcript.jsonl",
        "nested/.claude/settings.json",
        "nested/operational-receipts/session.json",
        "nested/production-exports/export.csv",
        "nested/db-dumps/transit.sql",
        "nested/run-logs/worker.log",
        "nested/security-reports/finding.md",
        "nested/vulnerability-reports/finding.md",
    ],
)
def test_high_risk_raw_artifact_directory_fails(indexed_repo: IndexedRepo, path: str) -> None:
    indexed_repo.write(path, "generated output\n")
    indexed_repo.stage(path)

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout.splitlines() == [f"raw-artifact-path: {path}:1"]


@pytest.mark.parametrize(
    ("content", "category"),
    [
        ("op" + "://Transit/item/field\n", "vault-reference"),
        ("1password" + "://Transit/item/field\n", "vault-reference"),
        ("vault" + "://Transit/item/field\n", "vault-reference"),
        ("workspace=" + "/home/" + "real-user/project\n", "absolute-home-path"),
        ("workspace=" + "/Users/" + "real-user/project\n", "absolute-home-path"),
        (
            "workspace=C:" + chr(92) + "Users" + chr(92) + "real-user" + chr(92) + "project\n",
            "absolute-home-path",
        ),
        (
            "PRIVATE " + "VULNERABILITY: do not publish\n",
            "private-" + "vulnerability-marker",
        ),
        (
            "embargoed-" + "vulnerability: details\n",
            "private-" + "vulnerability-marker",
        ),
        (
            "CONFIDENTIAL " + "VULNERABILITY REPORT: do not publish\n",
            "private-" + "vulnerability-marker",
        ),
        (
            "PRIVATE " + "VULNERABILITY REPORT: do not publish\n",
            "private-" + "vulnerability-marker",
        ),
        (
            "EMBARGOED " + "VULNERABILITY REPORT: do not publish\n",
            "private-" + "vulnerability-marker",
        ),
        (
            "PRIVATE " + "SECURITY FINDING: do not publish\n",
            "private-" + "vulnerability-marker",
        ),
        (
            "CONFIDENTIAL " + "SECURITY FINDING: do not publish\n",
            "private-" + "vulnerability-marker",
        ),
        (
            "EMBARGOED " + "SECURITY FINDING: do not publish\n",
            "private-" + "vulnerability-marker",
        ),
    ],
)
def test_private_content_marker_fails(
    indexed_repo: IndexedRepo, content: str, category: str
) -> None:
    indexed_repo.write("notes.txt", content)
    indexed_repo.stage("notes.txt")

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout.splitlines() == [f"{category}: notes.txt:1"]


@pytest.mark.parametrize(
    "content",
    [
        "workspace=" + "/home/" + "Alice.Dev/project\n",
        "workspace=" + "/Users/" + "Alice.Dev/project\n",
        ("workspace=C:" + chr(92) + "Users" + chr(92) + "Alice.Dev" + chr(92) + "project\n"),
    ],
)
def test_mixed_case_dotted_home_user_fails(indexed_repo: IndexedRepo, content: str) -> None:
    indexed_repo.write("notes.txt", content)
    indexed_repo.stage("notes.txt")

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout == "absolute-home-path: notes.txt:1\n"


def test_indexed_symlink_blob_is_scanned(indexed_repo: IndexedRepo) -> None:
    target = "/home/" + "Symlink.User/private-project"
    indexed_repo.symlink("workspace-link", target)
    indexed_repo.stage("workspace-link")
    assert indexed_repo.git("ls-files", "--stage", "--", "workspace-link").stdout.startswith(
        "120000 "
    )

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout == "absolute-home-path: workspace-link:1\n"


@pytest.mark.parametrize("encoding", ["utf-16", "utf-16-le", "utf-16-be"])
def test_utf16_indexed_blob_is_decoded_before_binary_detection(
    indexed_repo: IndexedRepo, encoding: str
) -> None:
    content = "heading\n" + "op" + "://Transit/item/field\n"
    indexed_repo.write_bytes("notes.txt", content.encode(encoding))
    indexed_repo.stage("notes.txt")

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout == "vault-reference: notes.txt:1\n"


@pytest.mark.parametrize("encoding", ["utf-16-le", "utf-16-be"])
def test_bomless_utf16_with_non_ascii_prefix_is_scanned(
    indexed_repo: IndexedRepo, encoding: str
) -> None:
    non_ascii_prefix = "漢字東京地下鉄運行情報" * 8
    content = non_ascii_prefix + "\n" + "op" + "://Transit/item/field\n"
    indexed_repo.write_bytes("notes.txt", content.encode(encoding))
    indexed_repo.stage("notes.txt")

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout == "vault-reference: notes.txt:1\n"


@pytest.mark.parametrize("encoding", ["utf-16-le", "utf-16-be"])
def test_bomless_utf16_with_stray_byte_before_vault_marker_is_scanned(
    indexed_repo: IndexedRepo, encoding: str
) -> None:
    content = (
        "valid prefix: ".encode(encoding)
        + b"\xff"
        + ("op" + "://Transit/item/field\n").encode(encoding)
    )
    indexed_repo.write_bytes("notes.txt", content)
    indexed_repo.stage("notes.txt")

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout == "vault-reference: notes.txt:1\n"


@pytest.mark.parametrize(
    ("bom", "encoding"),
    [
        (codecs.BOM_UTF16_LE, "utf-16-le"),
        (codecs.BOM_UTF16_BE, "utf-16-be"),
    ],
)
def test_utf16_bom_with_stray_byte_before_vault_marker_is_scanned(
    indexed_repo: IndexedRepo, bom: bytes, encoding: str
) -> None:
    content = (
        bom
        + "valid prefix: ".encode(encoding)
        + b"\xff"
        + ("op" + "://Transit/item/field\n").encode(encoding)
    )
    indexed_repo.write_bytes("notes.txt", content)
    indexed_repo.stage("notes.txt")

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout == "vault-reference: notes.txt:1\n"


@pytest.mark.parametrize("encoding", ["utf-16-le", "utf-16-be"])
def test_bomless_utf16_stray_byte_after_newline_reports_file_level_location(
    indexed_repo: IndexedRepo, encoding: str
) -> None:
    content = (
        "public heading\n".encode(encoding)
        + b"\xff"
        + ("op" + "://Transit/item/field\n").encode(encoding)
    )
    indexed_repo.write_bytes("notes.txt", content)
    indexed_repo.stage("notes.txt")

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout == "vault-reference: notes.txt:1\n"


@pytest.mark.parametrize("encoding", ["utf-16-le", "utf-16-be"])
def test_bomless_utf16_markers_before_and_after_stray_byte_deduplicate_to_file_level(
    indexed_repo: IndexedRepo, encoding: str
) -> None:
    content = (
        ("op" + "://Transit/first/field\npublic heading\n").encode(encoding)
        + b"\xff"
        + ("op" + "://Transit/second/field\n").encode(encoding)
    )
    indexed_repo.write_bytes("notes.txt", content)
    indexed_repo.stage("notes.txt")

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout == "vault-reference: notes.txt:1\n"


@pytest.mark.parametrize("encoding", ["utf-16-le", "utf-16-be"])
def test_utf16_decomposed_prefix_before_home_marker_has_file_level_location(
    indexed_repo: IndexedRepo, encoding: str
) -> None:
    content = (
        "public heading\nE\u0301 A\u030a workspace=/" + "Users/Private.User/project\n"
    ).encode(encoding)
    indexed_repo.write_bytes("notes.txt", content)
    indexed_repo.stage("notes.txt")

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout == "absolute-home-path: notes.txt:1\n"


@pytest.mark.parametrize("encoding", ["utf-16-le", "utf-16-be"])
def test_bomless_utf16_distinct_vault_markers_deduplicate_to_file_level(
    indexed_repo: IndexedRepo, encoding: str
) -> None:
    content = (
        "op" + "://Transit/first/field\npublic line\nop" + "://Transit/second/field\n"
    ).encode(encoding)
    indexed_repo.write_bytes("notes.txt", content)
    indexed_repo.stage("notes.txt")

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout == "vault-reference: notes.txt:1\n"


def test_utf8_keeps_distinct_vault_marker_locations(
    indexed_repo: IndexedRepo,
) -> None:
    indexed_repo.write(
        "notes.txt",
        "op" + "://Transit/first/field\npublic line\nop" + "://Transit/second/field\n",
    )
    indexed_repo.stage("notes.txt")

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout.splitlines() == [
        "vault-reference: notes.txt:1",
        "vault-reference: notes.txt:3",
    ]


@pytest.mark.parametrize("encoding", ["utf-16-le", "utf-16-be"])
def test_bomless_utf16_with_trailing_byte_is_scanned(
    indexed_repo: IndexedRepo, encoding: str
) -> None:
    content = ("heading\n" + "op" + "://Transit/item/field\n").encode(encoding) + b"\xff"
    indexed_repo.write_bytes("notes.txt", content)
    indexed_repo.stage("notes.txt")

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout == "vault-reference: notes.txt:1\n"


@pytest.mark.parametrize(
    ("encoding", "lone_surrogate"),
    [("utf-16-le", b"\x00\xd8"), ("utf-16-be", b"\xd8\x00")],
)
def test_bomless_utf16_with_lone_surrogate_is_scanned(
    indexed_repo: IndexedRepo, encoding: str, lone_surrogate: bytes
) -> None:
    content = (
        "heading\n".encode(encoding)
        + lone_surrogate
        + ("\n" + "op" + "://Transit/item/field\n").encode(encoding)
    )
    indexed_repo.write_bytes("notes.txt", content)
    indexed_repo.stage("notes.txt")

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout == "vault-reference: notes.txt:1\n"


@pytest.mark.parametrize("encoding", ["utf-16-le", "utf-16-be"])
def test_bomless_utf16_with_many_controls_is_scanned(
    indexed_repo: IndexedRepo, encoding: str
) -> None:
    content = (("\x01" * 64) + "\n" + "op" + "://Transit/item/field\n").encode(encoding)
    indexed_repo.write_bytes("notes.txt", content)
    indexed_repo.stage("notes.txt")

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout == "vault-reference: notes.txt:1\n"


@pytest.mark.parametrize(
    "content",
    [
        "workspace=" + "/home/" + "Élodie.开发/project\n",
        "workspace=" + "/Users/" + "Ålice.测试/project\n",
        ("workspace=C:" + chr(92) + "Users" + chr(92) + "Жанна.测试" + chr(92) + "project\n"),
    ],
)
def test_unicode_home_user_fails(indexed_repo: IndexedRepo, content: str) -> None:
    indexed_repo.write("notes.txt", content)
    indexed_repo.stage("notes.txt")

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout == "absolute-home-path: notes.txt:1\n"


def test_canonically_decomposed_unicode_home_user_fails(indexed_repo: IndexedRepo) -> None:
    indexed_repo.write("notes.txt", "workspace=/" + "Users/E\u0301lodie/project\n")
    indexed_repo.stage("notes.txt")

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout == "absolute-home-path: notes.txt:1\n"


@pytest.mark.parametrize(
    "content",
    [
        "workspace=" + "/mnt/" + "c/Users/Alice.Dev/project\n",
        "workspace=" + "/" + "root/private-project\n",
    ],
)
def test_wsl_and_root_home_paths_fail(indexed_repo: IndexedRepo, content: str) -> None:
    indexed_repo.write("notes.txt", content)
    indexed_repo.stage("notes.txt")

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout == "absolute-home-path: notes.txt:1\n"


def test_nul_bearing_non_utf16_binary_stays_ignored(indexed_repo: IndexedRepo) -> None:
    content = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + b"op" + b"://not-text" + b"\x00"
    indexed_repo.write_bytes("image.bin", content)
    indexed_repo.stage("image.bin")

    result = indexed_repo.run_guard()

    assert result.returncode == 0
    assert result.stdout == ""


def test_diagnostics_never_echo_matched_content(indexed_repo: IndexedRepo) -> None:
    private_value = "/home/" + "never-echo-this-user/private-project"
    indexed_repo.write("notes.txt", private_value + "\n")
    indexed_repo.stage("notes.txt")

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout == "absolute-home-path: notes.txt:1\n"
    assert private_value not in result.stdout
    assert private_value not in result.stderr


def test_guard_reads_only_the_index_and_respects_staged_deletion(
    indexed_repo: IndexedRepo,
) -> None:
    private_value = "/home/" + "staged-only-user/project"
    indexed_repo.write("notes.txt", private_value + "\n")

    unstaged = indexed_repo.run_guard()
    indexed_repo.stage("notes.txt")
    staged = indexed_repo.run_guard()
    indexed_repo.delete_and_stage("notes.txt")
    deleted = indexed_repo.run_guard()

    assert unstaged.returncode == 0
    assert unstaged.stdout == ""
    assert staged.returncode == 1
    assert staged.stdout == "absolute-home-path: notes.txt:1\n"
    assert deleted.returncode == 0
    assert deleted.stdout == ""


def test_sorted_deduplicated_findings_include_only_category_and_location(
    indexed_repo: IndexedRepo,
) -> None:
    line = "/home/" + "private-user/one /home/" + "private-user/two op" + "://Transit/item/field\n"
    indexed_repo.write("z-notes.txt", line)
    indexed_repo.stage("z-notes.txt")

    result = indexed_repo.run_guard()

    assert result.returncode == 1
    assert result.stdout.splitlines() == [
        "absolute-home-path: z-notes.txt:1",
        "vault-reference: z-notes.txt:1",
    ]


def test_documented_placeholders_and_public_project_language_pass(
    indexed_repo: IndexedRepo,
) -> None:
    indexed_repo.write(
        ".env.example",
        "\n".join(
            [
                "TOKEN=",
                "SECRET=",
                "API_KEY=${{ secrets.NAME }}",
                "DOC_ADDRESS=203.0.113.10",
                "DOC_ORIGIN=https://example.test",
                "CACHE=/tmp/transit",
                "WORKSPACE=/home/example-user/transit",
                "MAC_WORKSPACE=/Users/Example-User/transit",
                "WSL_WORKSPACE=/mnt/c/Users/Example-User/transit",
                (
                    "WINDOWS_WORKSPACE=C:"
                    + chr(92)
                    + "Users"
                    + chr(92)
                    + "Example-User"
                    + chr(92)
                    + "transit"
                ),
                "VALUE=obvious-dummy-test-token",
                "NOTE=public production receipt proof secret token",
                "SECURITY_DOC=private vulnerability reporting",
                "CATEGORY=private-vulnerability-marker",
                "IMPORT=$lib/features/home/HomeExplore.svelte",
                "COPY_IMPORT=$lib/features/home/home.copy",
                "",
            ]
        ),
    )
    indexed_repo.write("apps/web/src/lib/receipt/public-receipt.json", "{}\n")
    indexed_repo.stage(".env.example", "apps/web/src/lib/receipt/public-receipt.json")

    result = indexed_repo.run_guard()

    assert result.returncode == 0
    assert result.stdout == ""
    assert result.stderr == ""


def test_git_failure_fails_closed_without_forwarding_git_output(tmp_path: Path) -> None:
    result = subprocess.run(
        [sys.executable, str(GUARD)],
        cwd=tmp_path,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 2
    assert result.stdout == "git-error: <repository>:0\n"
    assert result.stderr == ""


def test_secret_scan_runs_current_tree_checks_and_keeps_history_scans() -> None:
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    steps = workflow["jobs"]["gitleaks"]["steps"]
    by_name = {step["name"]: step for step in steps}

    failure_independent = "${{ success() || failure() }}"
    assert by_name["Check tracked public tree"] == {
        "name": "Check tracked public tree",
        "if": failure_independent,
        "run": "python3 .github/scripts/check_public_tree.py",
    }
    assert by_name["Scan current tree"] == {
        "name": "Scan current tree",
        "if": failure_independent,
        "run": "gitleaks dir --redact --config .gitleaks.toml .",
    }
    assert by_name["Scan pull request diff"]["if"] == (
        "${{ (success() || failure()) && github.event_name == 'pull_request' }}"
    )
    assert "origin/${{ github.base_ref }}..HEAD" in by_name["Scan pull request diff"]["run"]
    assert by_name["Scan pushed commits"]["if"] == (
        "${{ (success() || failure()) && github.event_name == 'push' }}"
    )
    assert '"$before..$after"' in by_name["Scan pushed commits"]["run"]
    assert by_name["Scan HEAD history"]["if"] == (
        "${{ (success() || failure()) && "
        "(github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') }}"
    )
    assert "gitleaks detect --redact" in by_name["Scan HEAD history"]["run"]


def test_db_build_context_excludes_artifacts_and_crypto_material() -> None:
    patterns = {
        line.strip()
        for line in DOCKERIGNORE.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }

    assert {
        "artifacts/",
        "**/*.crt",
        "**/*.cer",
        "**/*.der",
        "**/*.key",
        "**/*.pem",
        "**/*.p12",
        "**/*.pfx",
        "**/*.pkcs12",
        "**/*.jks",
        "**/*.keystore",
        "**/*.kdbx",
    } <= patterns


def test_clean_clone_sequence_runs_guard_and_both_gitleaks_surfaces() -> None:
    contributing = CONTRIBUTING.read_text(encoding="utf-8")
    guard = "python3 .github/scripts/check_public_tree.py"
    current_tree = '"$GITLEAKS_BIN" dir --redact --config .gitleaks.toml .'
    history = '"$GITLEAKS_BIN" detect --redact --config .gitleaks.toml'

    assert contributing.count(guard) == 1
    assert contributing.count(current_tree) == 1
    assert contributing.count(history) == 1
    assert contributing.index(guard) < contributing.index(current_tree)
    assert contributing.index(current_tree) < contributing.index(history)
