#!/usr/bin/env python3
"""Reject high-signal private residue in the Git index."""

from __future__ import annotations

import codecs
import os
import re
import subprocess
import tempfile
import unicodedata
from dataclasses import dataclass
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
RAW_ARTIFACT_SEGMENTS = {
    "artifacts",
    ".claude",
    ".codex",
    ".superpowers",
    "db-dumps",
    "operational-receipts",
    "production-exports",
    "run-logs",
    "security-reports",
    "vulnerability-reports",
}
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
VAULT_PATTERN = re.compile(r"\b(?:op|1password|vault)://", re.IGNORECASE)
VULNERABILITY_LABEL_PATTERN = re.compile(
    r"\b(?:private|embargoed)[ _-]+vulnerabilit(?:y|ies)\s*(?=[:\]})])",
    re.IGNORECASE,
)
SECURITY_REPORT_MARKER_PATTERN = re.compile(
    r"\b(?:confidential|private|embargoed)[ _-]+"
    r"(?:vulnerabilit(?:y|ies)[ _-]+report|security[ _-]+finding)\b",
    re.IGNORECASE,
)
USER_SEGMENT = r"(?P<user>[^\W][\w.-]*)"
USER_TERMINATOR = r"(?=/|\\|[\s\"'`]|$)"
HOME_PATTERNS = (
    re.compile(r"(?<![\w.$-])" + re.escape("/" + "home" + "/") + USER_SEGMENT + USER_TERMINATOR),
    re.compile(r"(?<![\w.$-])" + re.escape("/" + "Users" + "/") + USER_SEGMENT + USER_TERMINATOR),
    re.compile(
        r"(?<!\w)[A-Za-z]:"
        + re.escape("\\")
        + r"Users"
        + re.escape("\\")
        + USER_SEGMENT
        + USER_TERMINATOR,
        re.IGNORECASE,
    ),
    re.compile(
        r"(?<![\w.$-])"
        + re.escape("/mnt/")
        + r"[A-Za-z]"
        + re.escape("/Users/")
        + USER_SEGMENT
        + USER_TERMINATOR,
        re.IGNORECASE,
    ),
)
ROOT_HOME_PATTERN = re.compile(r"(?<![\w.$-])/root(?=/|[\s\"'`]|$)")

Finding = tuple[str, str, int]


@dataclass(frozen=True)
class IndexEntry:
    mode: str
    object_id: str
    path: str


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


def _indexed_entries(root: Path) -> list[IndexEntry]:
    output = _git(root, "ls-files", "--cached", "--stage", "-z", "--")
    entries: list[IndexEntry] = []
    for entry in output.split(b"\0"):
        if not entry:
            continue
        try:
            metadata, raw_path = entry.split(b"\t", 1)
            raw_mode, raw_object_id, stage = metadata.split()
        except (IndexError, ValueError) as exc:
            raise GitQueryError from exc
        if stage != b"0":
            raise GitQueryError
        entries.append(
            IndexEntry(
                mode=raw_mode.decode("ascii"),
                object_id=raw_object_id.decode("ascii"),
                path=os.fsdecode(raw_path),
            )
        )
    return sorted(entries, key=lambda entry: entry.path)


def _indexed_blobs(root: Path, entries: list[IndexEntry]) -> dict[str, bytes]:
    blob_entries = [entry for entry in entries if entry.mode != "160000"]
    requested = b"".join(entry.object_id.encode("ascii") + b"\n" for entry in blob_entries)
    output = _git(root, "cat-file", "--batch", input_bytes=requested)

    blobs: dict[str, bytes] = {}
    cursor = 0
    for entry in blob_entries:
        header_end = output.find(b"\n", cursor)
        if header_end < 0:
            raise GitQueryError
        header = output[cursor:header_end].split()
        if len(header) != 3:
            raise GitQueryError
        object_id, object_type, raw_size = header
        try:
            size = int(raw_size)
        except ValueError as exc:
            raise GitQueryError from exc
        if object_id.decode("ascii") != entry.object_id or object_type != b"blob":
            raise GitQueryError
        content_start = header_end + 1
        content_end = content_start + size
        if content_end >= len(output) or output[content_end : content_end + 1] != b"\n":
            raise GitQueryError
        blobs[entry.path] = output[content_start:content_end]
        cursor = content_end + 1
    if cursor != len(output):
        raise GitQueryError
    return blobs


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
    normalized_line = unicodedata.normalize("NFC", line)
    if ROOT_HOME_PATTERN.search(normalized_line):
        return True
    return any(
        match.group("user").casefold() not in PLACEHOLDER_USERS
        for pattern in HOME_PATTERNS
        for match in pattern.finditer(normalized_line)
    )


def _decode_indexed_text_candidates(content: bytes) -> tuple[str, ...]:
    if content.startswith((codecs.BOM_UTF32_LE, codecs.BOM_UTF32_BE)):
        return (content.decode("utf-32", errors="replace"),)
    if content.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        return (content.decode("utf-16", errors="replace"),)
    if content.startswith(codecs.BOM_UTF8):
        return (content.decode("utf-8-sig", errors="replace"),)

    if b"\0" in content:
        candidates: list[str] = []
        for encoding in ("utf-16-le", "utf-16-be"):
            decoded = content.decode(encoding, errors="replace")
            if decoded not in candidates:
                candidates.append(decoded)
        return tuple(candidates)
    return (content.decode("utf-8", errors="replace"),)


def _content_findings(path: str, content: bytes) -> set[Finding]:
    findings: set[Finding] = set()
    for text in _decode_indexed_text_candidates(content):
        for line_number, line in enumerate(text.splitlines(), start=1):
            if PEM_PATTERN.search(line):
                findings.add(("pem-material", path, line_number))
            if VAULT_PATTERN.search(line):
                findings.add(("vault-reference", path, line_number))
            if VULNERABILITY_LABEL_PATTERN.search(line) or SECURITY_REPORT_MARKER_PATTERN.search(
                line
            ):
                findings.add(("private-" + "vulnerability-marker", path, line_number))
            if _has_private_home(line):
                findings.add(("absolute-home-path", path, line_number))
    return findings


def _scan_index(root: Path) -> set[Finding]:
    entries = _indexed_entries(root)
    paths = [entry.path for entry in entries]
    blobs = _indexed_blobs(root, entries)
    findings: set[Finding] = set()

    with tempfile.TemporaryDirectory(prefix="transit-public-tree-") as temp_dir:
        index_tree = Path(temp_dir) / "tree"
        index_tree.mkdir()
        _git(root, "checkout-index", "--all", f"--prefix={index_tree}{os.sep}")

        for path in _tracked_ignored_paths(index_tree, paths):
            findings.add(("tracked-ignored", path, 1))

        for entry in entries:
            pure_path = PurePosixPath(entry.path)
            if pure_path.suffix.casefold() in CRYPTO_SUFFIXES:
                findings.add(("crypto-material", entry.path, 1))
            if RAW_ARTIFACT_SEGMENTS.intersection(pure_path.parts[:-1]):
                findings.add(("raw-artifact-path", entry.path, 1))
            if entry.mode != "160000":
                findings.update(_content_findings(entry.path, blobs[entry.path]))

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
