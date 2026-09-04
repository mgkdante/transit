#!/usr/bin/env python3
"""Reject high-signal private residue in the Git index."""

from __future__ import annotations

import os
import re
import stat
import subprocess
import tempfile
from pathlib import Path, PurePosixPath

CRYPTO_SUFFIXES = {
    ".cer",
    ".crt",
    ".der",
    ".jks",
    ".kdbx",
    ".key",
    ".keystore",
    ".p12",
    ".pem",
    ".pfx",
    ".pkcs12",
}
RAW_ARTIFACT_SEGMENTS = {"artifacts", ".claude", ".codex", ".superpowers"}
PLACEHOLDER_USERS = {
    "example",
    "example-user",
    "runner",
    "user",
    "username",
    "your-user",
    "your-username",
}

PEM_PATTERN = re.compile(
    re.escape("-----BEGIN ") + r"(?:CERTIFICATE|(?:[A-Z0-9]+ )?PRIVATE KEY)" + re.escape("-----")
)
VAULT_PATTERN = re.compile("op" + r"://", re.IGNORECASE)
VULNERABILITY_MARKER_PATTERN = re.compile(
    r"\b(?:private|embargoed)[ _-]+vulnerabilit(?:y|ies)\s*(?=[:\]})])",
    re.IGNORECASE,
)
HOME_PATTERNS = (
    re.compile(re.escape("/" + "home" + "/") + r"(?P<user>[a-z0-9][a-z0-9_-]*)(?=/|[\s\"'`]|$)"),
    re.compile(re.escape("/" + "Users" + "/") + r"(?P<user>[a-z0-9][a-z0-9_-]*)(?=/|[\s\"'`]|$)"),
    re.compile(
        r"[A-Za-z]:"
        + re.escape("\\")
        + r"Users"
        + re.escape("\\")
        + r"(?P<user>[A-Za-z0-9][A-Za-z0-9_-]*)(?=\\|[\s\"'`]|$)",
        re.IGNORECASE,
    ),
)

Finding = tuple[str, str, int]


class GitQueryError(RuntimeError):
    """A Git command could not resolve the requested index state."""


def _git(
    cwd: Path,
    *args: str,
    input_bytes: bytes | None = None,
    allowed_returncodes: frozenset[int] = frozenset({0}),
) -> bytes:
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        input=input_bytes,
        check=False,
        capture_output=True,
    )
    if result.returncode not in allowed_returncodes:
        raise GitQueryError
    return result.stdout


def _repository_root() -> Path:
    output = _git(Path.cwd(), "rev-parse", "--show-toplevel")
    root = Path(os.fsdecode(output.rstrip(b"\n")))
    if not root.is_absolute():
        raise GitQueryError
    return root


def _indexed_paths(root: Path) -> list[str]:
    output = _git(root, "ls-files", "--cached", "--stage", "-z", "--")
    paths: list[str] = []
    for entry in output.split(b"\0"):
        if not entry:
            continue
        try:
            metadata, raw_path = entry.split(b"\t", 1)
            stage = metadata.rsplit(b" ", 1)[1]
        except (IndexError, ValueError) as exc:
            raise GitQueryError from exc
        if stage != b"0":
            raise GitQueryError
        paths.append(os.fsdecode(raw_path))
    return sorted(set(paths))


def _tracked_ignored_paths(index_tree: Path, paths: list[str]) -> set[str]:
    _git(index_tree, "init", "--quiet")
    encoded_paths = b"".join(os.fsencode(path) + b"\0" for path in paths)
    output = _git(
        index_tree,
        "-c",
        "core.excludesFile=/dev/null",
        "check-ignore",
        "--no-index",
        "--stdin",
        "-z",
        input_bytes=encoded_paths,
        allowed_returncodes=frozenset({0, 1}),
    )
    return {os.fsdecode(path) for path in output.split(b"\0") if path}


def _has_private_home(line: str) -> bool:
    return any(
        match.group("user").casefold() not in PLACEHOLDER_USERS
        for pattern in HOME_PATTERNS
        for match in pattern.finditer(line)
    )


def _content_findings(path: str, target: Path) -> set[Finding]:
    findings: set[Finding] = set()
    mode = target.lstat().st_mode
    if not stat.S_ISREG(mode):
        return findings

    with target.open("rb") as stream:
        probe = stream.read(8192)
        if b"\0" in probe:
            return findings
        stream.seek(0)
        for line_number, raw_line in enumerate(stream, start=1):
            line = raw_line.decode("utf-8", errors="replace")
            if PEM_PATTERN.search(line):
                findings.add(("pem-material", path, line_number))
            if VAULT_PATTERN.search(line):
                findings.add(("vault-reference", path, line_number))
            if VULNERABILITY_MARKER_PATTERN.search(line):
                findings.add(("private-" + "vulnerability-marker", path, line_number))
            if _has_private_home(line):
                findings.add(("absolute-home-path", path, line_number))
    return findings


def _scan_index(root: Path) -> set[Finding]:
    paths = _indexed_paths(root)
    findings: set[Finding] = set()

    with tempfile.TemporaryDirectory(prefix="transit-public-tree-") as temp_dir:
        index_tree = Path(temp_dir) / "tree"
        index_tree.mkdir()
        _git(root, "checkout-index", "--all", f"--prefix={index_tree}{os.sep}")

        for path in _tracked_ignored_paths(index_tree, paths):
            findings.add(("tracked-ignored", path, 1))

        for path in paths:
            pure_path = PurePosixPath(path)
            if pure_path.suffix.casefold() in CRYPTO_SUFFIXES:
                findings.add(("crypto-material", path, 1))
            if RAW_ARTIFACT_SEGMENTS.intersection(pure_path.parts[:-1]):
                findings.add(("raw-artifact-path", path, 1))
            findings.update(_content_findings(path, index_tree / path))

    return findings


def _safe_path(path: str) -> str:
    return path.encode("unicode_escape", errors="backslashreplace").decode("ascii")


def main() -> int:
    try:
        findings = _scan_index(_repository_root())
    except (GitQueryError, OSError, UnicodeError):
        print("git-error: <repository>:0")
        return 2

    for category, path, line_number in sorted(findings):
        print(f"{category}: {_safe_path(path)}:{line_number}")
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
