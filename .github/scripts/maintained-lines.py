#!/usr/bin/env python3
"""Count authored physical lines from Git with exact, content-bound exclusions."""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path, PurePosixPath

POLICY_PATH = ".github/maintained-lines.json"
VERSION = 3


def git(repo: Path, *args: str, data: bytes | None = None) -> bytes:
    return subprocess.run(
        ["git", "-C", str(repo), *args], input=data, capture_output=True, check=True
    ).stdout


def framed_digest(contents: dict[str, bytes]) -> str:
    digest = hashlib.sha256()
    for path in sorted(contents, key=lambda name: name.encode("utf-8")):
        name, content = path.encode("utf-8"), contents[path]
        digest.update(len(name).to_bytes(8, "big") + name)
        digest.update(len(content).to_bytes(8, "big") + content)
    return digest.hexdigest()


def revision(repo: Path, ref: str) -> tuple[str, str]:
    commit = git(
        repo, "rev-parse", "--verify", "--end-of-options", ref + "^{commit}"
    ).decode().strip()
    tree = git(repo, "rev-parse", commit + "^{tree}").decode().strip()
    return commit, tree


def sources(repo: Path, tree: str, worktree: bool = False) -> dict[str, bytes]:
    if worktree:
        names = git(repo, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
        contents = {}
        for raw in set(names.split(b"\0")) - {b""}:
            name = raw.decode("utf-8")
            path = repo / name
            if path.is_symlink():
                contents[name] = os.fsencode(os.readlink(path))
            elif path.is_file():
                contents[name] = path.read_bytes()
            elif path.exists():
                raise ValueError(f"unsupported tracked path: {name}")
        return contents
    entries = []
    for entry in git(repo, "ls-tree", "-r", "-z", "--full-tree", tree).split(b"\0"):
        if not entry:
            continue
        metadata, raw_name = entry.split(b"\t", 1)
        _, kind, object_id = metadata.split()
        if kind != b"blob":
            raise ValueError(f"unsupported Git object: {raw_name.decode('utf-8')}")
        entries.append((raw_name.decode("utf-8"), object_id))
    batch = git(repo, "cat-file", "--batch", data=b"".join(oid + b"\n" for _, oid in entries))
    contents, offset = {}, 0
    for name, _ in entries:
        end = batch.index(b"\n", offset)
        size = int(batch[offset:end].split()[-1])
        offset = end + 1
        contents[name] = batch[offset:offset + size]
        offset += size + 1
    return contents


def paths(value: object, label: str) -> list[str]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{label} must be a nonempty list of exact paths")
    for name in value:
        if (
            not isinstance(name, str) or not name or "\\" in name or ":" in name
            or "\0" in name or name.startswith("/")
            or any(part in {"", ".", ".."} for part in name.split("/"))
            or any(char in name for char in "*?[")
        ):
            raise ValueError(f"invalid exact path in {label}: {name!r}")
    if len(set(value)) != len(value):
        raise ValueError(f"duplicate path in {label}")
    return value


def load_policy(repo: Path) -> tuple[dict, str]:
    raw = (repo / POLICY_PATH).read_bytes()
    policy = json.loads(raw.decode("utf-8-sig"))
    if not isinstance(policy, dict) or set(policy) != {
        "measurement_version", "baseline_ref", "baseline_lines", "exclusions"
    }:
        raise ValueError(
            "policy must contain measurement_version, baseline_ref, baseline_lines, exclusions"
        )
    if type(policy["measurement_version"]) is not int or policy["measurement_version"] != VERSION:
        raise ValueError(f"measurement_version must be {VERSION}")
    if not isinstance(policy["baseline_ref"], str) or not re.fullmatch(
        r"[0-9a-f]{40}|[0-9a-f]{64}", policy["baseline_ref"]
    ):
        raise ValueError("baseline_ref must be a full commit identity")
    if type(policy["baseline_lines"]) is not int or policy["baseline_lines"] < 0:
        raise ValueError("baseline_lines must be a nonnegative integer")
    if not isinstance(policy["exclusions"], list):
        raise ValueError("exclusions must be a list")
    excluded = set()
    for group in policy["exclusions"]:
        if not isinstance(group, dict) or set(group) != {
            "category", "reason", "files", "owners", "sha256", "origin"
        }:
            raise ValueError(
                "exclusion must contain category, reason, files, owners, sha256, origin"
            )
        if not isinstance(group["category"], str) or group["category"] not in {
            "generated", "vendor", "locks", "assets"
        }:
            raise ValueError("invalid exclusion category")
        for label in ("reason", "origin"):
            if not isinstance(group[label], str) or not group[label].strip():
                raise ValueError(f"exclusion {label} must describe provenance")
        files = paths(group["files"], "files")
        paths(group["owners"], "owners")
        if excluded.intersection(files):
            raise ValueError("a file appears in more than one exclusion")
        excluded.update(files)
        hashes = group["sha256"]
        if (
            not isinstance(hashes, list) or not hashes
            or any(not isinstance(h, str) or not re.fullmatch(r"[0-9a-f]{64}", h) for h in hashes)
            or len(set(hashes)) != len(hashes)
        ):
            raise ValueError("sha256 must list unique accepted content digests")
    return policy, hashlib.sha256(raw).hexdigest()


def classification(name: str) -> tuple[str, str]:
    path = PurePosixPath(name)
    parts = path.parts
    domain = parts[1] if len(parts) > 1 and parts[0] == "apps" else "repository"
    for category in ("tests", "migrations", "fixtures"):
        if category in parts:
            return domain, category
    if parts[0] == ".github" or "scripts" in parts:
        return domain, "tooling"
    if path.suffix.lower() in {".md", ".rst", ".txt"}:
        return domain, "documentation"
    if path.suffix.lower() in {".json", ".toml", ".yaml", ".yml"}:
        return domain, "config"
    return domain, "source"


def measure(contents: dict[str, bytes], policy: dict, *, historical: bool = False) -> dict:
    exclusions = {}
    provenance = []
    for group in policy["exclusions"]:
        if historical and not any(name in contents for name in group["files"]):
            continue
        names = set(group["files"] + group["owners"])
        missing = sorted(names - contents.keys())
        if missing:
            raise ValueError(
                f"missing provenance paths for {group['reason']}: {', '.join(missing)}"
            )
        actual = framed_digest({name: contents[name] for name in names})
        if actual not in group["sha256"]:
            raise ValueError(f"stale provenance for {group['reason']}: sha256 {actual}")
        provenance.append({**group, "validated_sha256": actual})
        exclusions.update({name: group for name in group["files"]})
    rows, by_domain, by_category = [], Counter(), Counter()
    for name in sorted(contents, key=lambda path: path.encode("utf-8")):
        domain, category = classification(name)
        group = exclusions.get(name)
        try:
            lines = len(contents[name].decode("utf-8-sig").splitlines())
        except UnicodeDecodeError as exc:
            if group is None:
                raise ValueError(f"authored file is not UTF-8: {name}") from exc
            lines = None
        counted = group is None
        reason = "authored UTF-8 physical lines"
        if group:
            category, reason = group["category"], group["reason"]
        else:
            by_domain[domain] += lines
            by_category[category] += lines
        rows.append({
            "path": name, "lines": lines, "counted": counted,
            "domain": domain, "category": category, "reason": reason,
        })
    return {
        "measurement_version": VERSION, "maintained_lines": sum(by_domain.values()),
        "source_sha256": framed_digest(contents), "by_domain": dict(sorted(by_domain.items())),
        "by_category": dict(sorted(by_category.items())), "files": rows,
        "exclusions": provenance, "provenance_failures": [],
    }


def nonnegative(value: str) -> int:
    number = int(value)
    if number < 0:
        raise argparse.ArgumentTypeError("must be nonnegative")
    return number


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--ref", default="HEAD", metavar="REV")
    source.add_argument("--worktree", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--baseline-check", action="store_true")
    parser.add_argument("--max", type=nonnegative, metavar="N")
    args = parser.parse_args()
    try:
        repo = Path(git(Path.cwd(), "rev-parse", "--show-toplevel").decode().strip())
        policy, policy_sha256 = load_policy(repo)
        commit, tree = revision(repo, "HEAD" if args.worktree else args.ref)
        report = measure(sources(repo, tree, args.worktree), policy)
        report.update({
            "mode": "worktree" if args.worktree else "revision", "commit": commit, "tree": tree,
            "policy_sha256": policy_sha256,
        })
        if args.baseline_check:
            baseline_commit, baseline_tree = revision(repo, policy["baseline_ref"])
            if baseline_commit != policy["baseline_ref"]:
                raise ValueError("baseline_ref must identify a commit directly")
            baseline = measure(sources(repo, baseline_tree), policy, historical=True)
            if baseline["maintained_lines"] != policy["baseline_lines"]:
                raise ValueError(
                    f"baseline mismatch: configured {policy['baseline_lines']}, "
                    f"measured {baseline['maintained_lines']} at {baseline_commit}"
                )
            report["baseline"] = {
                "commit": baseline_commit, "tree": baseline_tree,
                "maintained_lines": baseline["maintained_lines"], "matched": True,
            }
        report["max"] = args.max
        report["cap_exceeded"] = args.max is not None and report["maintained_lines"] > args.max
        if args.json:
            print(json.dumps(report, ensure_ascii=True, sort_keys=True))
        else:
            print(f"{report['maintained_lines']} maintained lines ({report['mode']} {commit})")
        return int(report["cap_exceeded"])
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        message = str(exc)
        if isinstance(exc, subprocess.CalledProcessError):
            message = exc.stderr.decode("utf-8", errors="replace").strip()
        if args.json:
            print(json.dumps({"measurement_version": VERSION, "provenance_failures": [message]}))
        print(f"maintained-lines: {message}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
