"""Daily Warm job policy, independent of GitHub and of the stage execution adapter."""

from __future__ import annotations

import hashlib
import json
import re
import time
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, NotRequired, TypedDict

PROVIDER_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*", re.ASCII)


@dataclass(frozen=True)
class Stage:
    argv: tuple[str, ...]
    output: Path | None = None
    capture: bool = False
    merge_stderr: bool = False
    tee: bool = False
    append: bool = False
    timeout_seconds: float | None = None
    kill_after_seconds: int = 60
    env: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class StageResult:
    exit_code: int
    stdout: str = ""


class _RollupReceipt(TypedDict):
    provider_id: str
    status: str
    started_utc: str
    attempt_exit_codes: list[int]
    attempt_count: int
    recovered_after_timeout: bool
    completed_utc: NotRequired[str]
    exit_code: NotRequired[int]


class DailyRunError(ValueError):
    def __init__(self, message: str, exit_code: int = 5):
        super().__init__(message)
        self.exit_code = exit_code


def _json(raw: str, *, document_count_exit: int = 5) -> object:
    # jq 1.7.1 uses 5 for parse errors; document-count failures depend on the filter.
    def reject_constant(value: str) -> None:
        raise ValueError(f"Invalid JSON constant: {value}")

    try:
        documents = []
        decoder = json.JSONDecoder(parse_constant=reject_constant)
        remaining = raw.lstrip()
        while remaining:
            document, end = decoder.raw_decode(remaining)
            documents.append(document)
            remaining = remaining[end:].lstrip()
    except ValueError as exc:
        raise DailyRunError("Malformed JSON document", 5) from exc
    if len(documents) != 1:
        raise DailyRunError("Expected exactly one JSON document", document_count_exit)
    return documents[0]


def _providers(value: object, *, maximum: int | None = None) -> list[str]:
    if not isinstance(value, list) or not value:
        raise DailyRunError("Provider plan must be a nonempty array")
    if any(not isinstance(p, str) or not PROVIDER_ID.fullmatch(p) for p in value):
        raise DailyRunError("Provider plan contains an unsafe provider id")
    if len(set(value)) != len(value):
        raise DailyRunError("Provider plan contains duplicate provider ids")
    if maximum is not None and len(value) > maximum:
        raise DailyRunError("Provider plan exceeds the three-provider publication budget")
    return value


def _write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


class DailyRun:
    def __init__(
        self,
        runner: Callable[[Stage], StageResult],
        *,
        artifact_root: Path = Path("artifacts/daily-warm-rollups"),
        environ: Mapping[str, str],
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
        clock: Callable[[], float] = time.monotonic,
    ):
        self.runner = runner
        self.root = artifact_root
        self.env = environ
        self.now = now
        self.clock = clock

    def run(self, job: str) -> int:
        try:
            jobs = {
                "prepare": self.prepare,
                "rollups": self.rollups,
                "publish": self.publish,
                "check-handoff": self.check_handoff,
                "proof": self.proof,
                "retention": self.retention,
            }
            return jobs[job]()
        except DailyRunError as exc:
            print(str(exc))
            return exc.exit_code

    def _stamp(self) -> str:
        return self.now().astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    def _directory(self, job: str) -> Path:
        path = self.root / job
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _cli(self, *args: str, **kwargs: Any) -> Stage:
        return Stage(("uv", "run", "python", "-m", "transit_ops.cli", *args), **kwargs)

    def _identity(self, provider: str, command: str, attempt: int = 1) -> dict[str, str]:
        def component(value: str, limit: int) -> str:
            return re.sub(r"[^A-Za-z0-9_-]", "_", value)[:limit]

        run = component(self.env.get("GITHUB_RUN_ID") or "local", 14)
        run_attempt = component(self.env.get("GITHUB_RUN_ATTEMPT") or "0", 3)
        digest = hashlib.sha256(provider.encode()).hexdigest()[:8]
        return {
            "PGAPPNAME": (
                f"dwr-r{run}-a{run_attempt}-p{component(provider, 12)}-h{digest}"
                f"-c{component(command, 8)}-pa{component(str(attempt), 3)}"
            )
        }

    def prepare(self) -> int:
        directory = self._directory("prepare")
        stages = [
            self._cli(
                "init-db", output=directory / "migration-upgrade.txt", merge_stderr=True, tee=True
            ),
            Stage(
                ("uv", "run", "alembic", "heads"),
                output=directory / "migration-head.txt",
                merge_stderr=True,
                tee=True,
            ),
            Stage(
                ("uv", "run", "alembic", "current", "--check-heads"),
                output=directory / "migration-head.txt",
                merge_stderr=True,
                tee=True,
                append=True,
            ),
        ]
        for stage in stages:
            status = self.runner(stage).exit_code
            if status:
                return status
        discovery = self.runner(self._cli("list-providers", capture=True))
        if discovery.exit_code:
            return discovery.exit_code
        try:
            providers = _providers(discovery.stdout.rstrip("\n").split("\n"))
        except DailyRunError as exc:
            raise DailyRunError(str(exc), 1) from exc
        compact = json.dumps(providers, separators=(",", ":"))
        (directory / "provider-discovery.json").write_text(compact + "\n", encoding="utf-8")
        output = self.env.get("GITHUB_OUTPUT")
        if not output:
            raise DailyRunError("GITHUB_OUTPUT is required for the provider handoff", 1)
        with Path(output).open("a", encoding="utf-8", newline="\n") as stream:
            stream.write(f"providers={compact}\n")
        for provider in providers:
            status = self.runner(
                self._cli(
                    "sync-alert-archive",
                    provider,
                    output=directory / f"alert-archive-sync-{provider}.json",
                    tee=True,
                )
            ).exit_code
            if status:
                return status
        return 0

    def check_handoff(self) -> int:
        for producer in ("PREPARE", "PUBLISH"):
            if not re.fullmatch(r"[1-9][0-9]*", self.env.get(f"{producer}_ARTIFACT_ID", "")):
                raise DailyRunError("Missing or invalid producing-job artifact ID", 1)
        print(
            f"Proof handoff run={self.env.get('GITHUB_RUN_ID', '')} "
            f"attempt={self.env.get('GITHUB_RUN_ATTEMPT', '')} "
            f"prepare={self.env['PREPARE_ARTIFACT_ID']} publish={self.env['PUBLISH_ARTIFACT_ID']}"
        )
        return 0

    def proof(self) -> int:
        directory = self._directory("proof")
        prepare = self.root / "prepare"
        publish = self.root / "publish"
        discovered = _providers(self._read_json(prepare / "provider-discovery.json"))
        active = []
        for provider in discovered:
            receipt = self._read_json(prepare / f"alert-archive-sync-{provider}.json")
            if not isinstance(receipt, dict) or receipt.get("provider_id") != provider:
                raise DailyRunError("Sync receipt must be one matching provider object")
            if "skipped_not_seeded" in receipt and not isinstance(
                receipt["skipped_not_seeded"], bool
            ):
                raise DailyRunError("Sync receipt skipped_not_seeded must be boolean")
            if not receipt.get("skipped_not_seeded", False):
                active.append(provider)
        if not active:
            raise DailyRunError("Provider discovery returned no active providers", 1)
        rows = self._read_json(publish / "historic-publish.json")
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise DailyRunError("Historic publish result must be one nonempty array")
        published = _providers([row.get("provider_id") for row in rows])
        if set(published) != set(active):
            raise DailyRunError(
                "Historic publish provider set does not match active sync receipts", 1
            )

        def prove(provider: str) -> int:
            proof_path = directory / f"public-proof-{provider}.json"
            _write_json(
                proof_path,
                {
                    "provider_id": provider,
                    "status": "fail",
                    "failures": ["historic_proof_interrupted_before_completion"],
                },
            )
            started = self.clock()
            print(f"Historic proof start provider={provider} deadline_seconds=2100")
            status = self.runner(
                self._cli(
                    "verify-historic-publish",
                    provider,
                    "--sync-report",
                    str(prepare / f"alert-archive-sync-{provider}.json"),
                    "--gate-report",
                    str(publish / f"publish-gate-{provider}.json"),
                    "--report-path",
                    str(proof_path),
                )
            ).exit_code
            (directory / f"elapsed-{provider}.txt").write_text(
                f"{int(self.clock() - started)}\n", encoding="utf-8"
            )
            return status

        aggregate_status = 0
        with ThreadPoolExecutor(max_workers=len(active)) as pool:
            futures = {p: pool.submit(prove, p) for p in active}
            for provider in active:
                status = futures[provider].result()
                if status == 0:
                    try:
                        receipt = self._read_json(
                            directory / f"public-proof-{provider}.json", document_count_exit=1
                        )
                        if (
                            not isinstance(receipt, dict)
                            or receipt.get("provider_id") != provider
                            or receipt.get("status") != "pass"
                        ):
                            raise DailyRunError("Historic proof did not pass for provider", 1)
                    except DailyRunError as exc:
                        status = exc.exit_code
                elapsed = (directory / f"elapsed-{provider}.txt").read_text().strip()
                print(
                    f"Historic proof finish provider={provider} exit_code={status} "
                    f"elapsed_seconds={elapsed}"
                )
                aggregate_status = aggregate_status or status
        return aggregate_status

    def rollups(self) -> int:
        directory = self._directory("rollups")
        providers = _providers(_json(self.env.get("PROVIDER_PLAN", "")))
        receipts: dict[str, _RollupReceipt] = {}
        for provider in providers:
            receipts[provider] = {
                "provider_id": provider,
                "status": "running",
                "started_utc": self._stamp(),
                "attempt_exit_codes": [],
                "attempt_count": 0,
                "recovered_after_timeout": False,
            }
            _write_json(directory / f"rollup-stage-{provider}.json", receipts[provider])

        def attempt(provider: str) -> int:
            number = len(receipts[provider]["attempt_exit_codes"]) + 1
            result = self.runner(
                self._cli(
                    "build-warm-rollups",
                    provider,
                    output=directory / f"rollup-{provider}.log",
                    tee=True,
                    merge_stderr=True,
                    append=number > 1,
                    timeout_seconds=4500,
                    env=self._identity(provider, "rollup", number),
                )
            )
            (directory / f"attempt-status-{provider}.txt").write_text(
                f"{result.exit_code}\n", encoding="utf-8"
            )
            return result.exit_code

        def record(provider: str, status: int) -> None:
            receipt = receipts[provider]
            receipt["attempt_exit_codes"].append(status)
            receipt = {
                "provider_id": provider,
                "status": "success" if status == 0 else "failure",
                "started_utc": receipt["started_utc"],
                "completed_utc": self._stamp(),
                "exit_code": status,
                "attempt_exit_codes": receipt["attempt_exit_codes"],
                "attempt_count": len(receipt["attempt_exit_codes"]),
                "recovered_after_timeout": receipt["attempt_exit_codes"] == [124, 0],
            }
            receipts[provider] = receipt
            _write_json(directory / f"rollup-stage-{provider}.json", receipt)

        effective = {}
        with ThreadPoolExecutor(max_workers=len(providers)) as pool:
            futures = {p: pool.submit(attempt, p) for p in providers}
            for provider in providers:
                effective[provider] = futures[provider].result()
                record(provider, effective[provider])
        deferred = next((p for p in providers if effective[p] == 124), None)
        if deferred:
            status = attempt(deferred)
            record(deferred, status)
            if status == 0:
                effective[deferred] = 0
        return next((effective[p] for p in providers if effective[p]), 0)

    def _read_json(self, path: Path, *, document_count_exit: int = 5) -> object:
        try:
            return _json(path.read_text(encoding="utf-8"), document_count_exit=document_count_exit)
        except OSError as exc:
            raise DailyRunError(f"Cannot read evidence: {path}", 2) from exc

    def publish(self) -> int:
        directory = self._directory("publish")
        providers = _providers(_json(self.env.get("PROVIDER_PLAN", "")), maximum=3)
        aggregate_path = directory / "historic-publish.json"
        aggregate: list[object] = []
        _write_json(aggregate_path, aggregate)

        def publish_provider(provider: str) -> int:
            started = self.clock()
            print(f"Historic publish start provider={provider} deadline_seconds=5400")
            result = self.runner(
                self._cli(
                    "publish-all",
                    "--tier",
                    "historic",
                    "--provider-id",
                    provider,
                    "--report-dir",
                    str(directory),
                    output=directory / f"result-{provider}.json",
                    timeout_seconds=5400,
                    kill_after_seconds=30,
                )
            )
            (directory / f"elapsed-{provider}.txt").write_text(
                f"{int(self.clock() - started)}\n", encoding="utf-8"
            )
            return result.exit_code

        aggregate_status = 0
        with ThreadPoolExecutor(max_workers=len(providers)) as pool:
            futures = {p: pool.submit(publish_provider, p) for p in providers}
            for provider in providers:
                status = futures[provider].result()
                if status == 0:
                    try:
                        rows = self._read_json(
                            directory / f"result-{provider}.json", document_count_exit=1
                        )
                        if (
                            not isinstance(rows, list)
                            or len(rows) > 1
                            or any(
                                not isinstance(row, dict)
                                or row.get("provider_id") != provider
                                or row.get("tier") != "historic"
                                for row in rows
                            )
                        ):
                            raise DailyRunError("Invalid historic publish result", 1)
                        aggregate.extend(rows)
                        _write_json(aggregate_path, aggregate)
                    except DailyRunError as exc:
                        status = exc.exit_code
                aggregate_status = aggregate_status or status
                elapsed = (directory / f"elapsed-{provider}.txt").read_text().strip()
                print(
                    f"Historic publish finish provider={provider} exit_code={status} "
                    f"elapsed_seconds={elapsed}"
                )
        print(json.dumps(aggregate))
        return aggregate_status

    def retention(self) -> int:
        directory = self._directory("retention")
        catch_up = self.env.get("BRONZE_CATCH_UP_BATCHES") or "0"
        if not re.fullmatch(r"[0-9]{1,3}", catch_up):
            raise DailyRunError("bronze_catch_up_batches must be an integer from 0 to 999", 1)
        batches = int(catch_up) or 4
        bronze_budget = 18000 if int(catch_up) else 1860
        providers = _providers(_json(self.env.get("PROVIDER_PLAN", "")))
        aggregate_status = 0
        for provider in providers:
            deadline = self.clock() + 300
            prune_status = 0
            for command, identity in (
                ("prune-i3-storage", "i3"),
                ("prune-warm-rollup-storage", "warm"),
            ):
                remaining = deadline - self.clock()
                if remaining <= 0:
                    prune_status = 124
                    break
                prune_status = self.runner(
                    self._cli(
                        command,
                        provider,
                        timeout_seconds=remaining,
                        env=self._identity(provider, identity),
                    )
                ).exit_code
                if prune_status:
                    break
            if prune_status == 0:
                prune_status = self.runner(
                    self._cli(
                        "prune-bronze-storage",
                        provider,
                        "--max-batches",
                        str(batches),
                        "--require-exhausted",
                        timeout_seconds=bronze_budget,
                        env=self._identity(provider, "bronze"),
                    )
                ).exit_code
            aggregate_status = aggregate_status or prune_status
            proof_status = self.runner(
                self._cli(
                    "retention-proof-report",
                    provider,
                    "--report-path",
                    str(directory / f"retention-proof-{provider}.json"),
                    timeout_seconds=300,
                    env=self._identity(provider, "proof"),
                )
            ).exit_code
            aggregate_status = aggregate_status or proof_status
        return aggregate_status
