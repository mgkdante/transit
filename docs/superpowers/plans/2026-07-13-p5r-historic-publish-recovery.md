# P5-R Historic Publish Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded manual recovery lane that migrates production, syncs the retained Alert archive, runs the existing historic value gate, publishes without running expensive rollups, and leaves machine-readable proof that current public history and source Alert messages are actually reachable.

**Architecture:** Keep orchestration in one manual GitHub Actions workflow and reuse the existing `init-db`, `sync-alert-archive`, and gated `publish-all` commands. Add one focused Python validation service plus a thin CLI command so migration, sync, public-index, advertised-object, integrity, and message proof stay testable outside YAML. Serialize the lane with the existing daily historic writer, validate the three discovery indexes the publisher really emits, and deliberately leave the contract-only `historic/history/index.json` rollout to the later history-family tasks.

**Tech Stack:** Python 3.12, Typer, SQLAlchemy 2, Alembic, Pydantic 2, httpx, pytest, GitHub Actions YAML, Cloudflare R2 `/v1` JSON contracts.

## Global Constraints

- Work only in `/home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history` on `slice/p5r-partitioned-history`; never edit the saved-project root checkout.
- Follow strict RED → GREEN for every implementation group and make one focused commit after each independently green deliverable.
- The recovery workflow is `workflow_dispatch` only, has a hard 45-minute job timeout, and shares the exact `daily-warm-rollups` concurrency group with `cancel-in-progress: false`.
- The workflow must run, in order: dependency setup → `init-db` → migration-head proof → retained Alert sync → default-gated historic publish → public proof → always-upload evidence.
- Never invoke a warm builder, static pipeline, replay, backfill, retention prune, `--no-gate`, or `--force` from the recovery workflow.
- Keep the existing scheduled daily lane behavior intact; changing its commands, schedule, pruning, alerting, or permissions is outside this task.
- Validate the real current historic discovery indexes: `historic/alerts/index.json`, `historic/receipts/index.json`, and `historic/route_reliability/index.json`.
- Do not require or publish `historic/history/index.json`; Task 4 intentionally made that contract optional and left the object unpublished for later history-family rollout.
- Treat `manifest.json` as a path-discovery contract only. It is live-lane-owned, so its historic timestamp is not an immediate recovery-lane freshness gate.
- A nonempty Alert surface with no source text is a failed proof. When the DB-built payload has source descriptions, a public payload with none is also a failed proof. A genuinely empty Alert surface is an explicit `no_data` result, never fabricated message success.
- Public proof must cache-bust requests, reject unsafe index-derived paths before HTTP, validate Pydantic contracts, fetch every advertised Alert page, verify page byte sizes and SHA-256 digests, and fetch the oldest/newest advertised Receipt and route artifacts when those indexes are nonempty.
- Automated green code is not production deployment proof. A later actual workflow run must supply migration, sync, gate, public-index, source-message, and URL-fetch artifacts before deployment is claimed.
- Do not start Network/Lines/Stops, Hotspots/Repeat Offenders, Status convergence, browser QA, deployment, push, PR, or merge inside Task 6.

---

## File Structure

- Create `apps/db/src/transit_ops/validation/historic_publish.py`: pure report types, dependency-injected proof builder, production migration/DB expectation readers, safe public-path handling, cache-busted HTTP transport, Pydantic validation, page-integrity checks, boundary fetches, and source-message checks.
- Modify `apps/db/src/transit_ops/validation/__init__.py`: export the new proof report and builder.
- Modify `apps/db/src/transit_ops/cli.py`: add a thin `verify-historic-publish` command that reads sync/gate receipts, writes seeded-provider JSON proof on pass or failure, and exits nonzero when the report fails; enrolled-but-unseeded providers keep the existing explicit stdout skip contract.
- Create `apps/db/tests/test_historic_publish_proof.py`: focused service tests with fake migration, DB expectations, and HTTP bytes.
- Modify `apps/db/tests/test_cli.py`: command help, happy path, report-on-failure, invalid input, and provider/report-path tests.
- Create `.github/workflows/historic-publish-recovery.yml`: the manual bounded publish-only lane.
- Create `apps/db/tests/test_historic_publish_recovery_workflow.py`: parsed-YAML contract and forbidden-command tests.
- Modify `.superpowers/sdd/progress.md`: ignored local progress pointer only; no canonical Notion mutation.
- Create `.superpowers/sdd/task-6-historic-publish-recovery-report.md`: ignored RED/GREEN/review evidence only.

### Task 1: Build reusable historic-publication proof

**Files:**
- Create: `apps/db/tests/test_historic_publish_proof.py`
- Create: `apps/db/src/transit_ops/validation/historic_publish.py`
- Modify: `apps/db/src/transit_ops/validation/__init__.py`

**Interfaces:**
- Consumes: `Settings.sqlalchemy_database_url`, `Settings.SNAPSHOT_PUBLIC_BASE_URL`, `Manifest`, `ManifestHistoricFiles`, `AlertHistory`, `AlertArchiveIndex`, `AlertArchivePage`, `ReceiptsIndex`, `Receipt`, `RouteReliabilityIndex`, `RouteReliability`, `builders.build_alert_history`, `builders.build_alert_archive`, Alembic `ScriptDirectory`, and the DB `alembic_version` table.
- Produces:

```python
FetchBytes = Callable[[str], bytes]
MigrationReader = Callable[[Settings, Engine], "MigrationEvidence"]
ExpectationsReader = Callable[[str, str, Engine], "AlertExpectations"]

@dataclass(frozen=True)
class MigrationEvidence:
    repository_heads: Sequence[str]
    database_heads: Sequence[str]

@dataclass(frozen=True)
class AlertExpectations:
    collection_generation_id: str
    total_alerts: int
    first_available_date: str | None
    last_available_date: str | None
    archive_source_text_count: int
    archive_description_count: int
    legacy_alert_count: int
    legacy_source_text_count: int
    legacy_description_count: int

@dataclass(frozen=True)
class HistoricPublishProofReport:
    provider_id: str
    verified_at_utc: datetime
    status: Literal["pass", "fail"]
    migration: dict[str, object]
    sync: dict[str, object]
    gate: dict[str, object]
    public: dict[str, object]
    source_messages: dict[str, object]
    failures: Sequence[str]

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "verified_at_utc": self.verified_at_utc.isoformat(),
            "status": self.status,
            "migration": self.migration,
            "sync": self.sync,
            "gate": self.gate,
            "public": self.public,
            "source_messages": self.source_messages,
            "failures": list(self.failures),
        }

build_historic_publish_proof(
    provider_id: str,
    *,
    sync_receipt: Mapping[str, object],
    gate_report: Mapping[str, object],
    settings: Settings | None = None,
    engine: Engine | None = None,
    fetch_bytes: FetchBytes | None = None,
    migration_reader: MigrationReader | None = None,
    expectations_reader: ExpectationsReader | None = None,
    now_utc: datetime | None = None,
) -> HistoricPublishProofReport
```

- [ ] **Step 1: Write the passing-contract and honest-empty RED tests**

Create fixtures that serialize real Pydantic `Manifest`, `AlertArchiveIndex`, `AlertArchivePage`, `AlertHistory`, `ReceiptsIndex`, `Receipt`, `RouteReliabilityIndex`, and `RouteReliability` objects. The complete fixture must expose two archive pages, two receipt dates, and two route IDs so both boundaries are fetched. Inject these exact dependency seams:

```python
def migration_reader(settings, engine):  # noqa: ANN001
    return MigrationEvidence(("0081_snapshot_publish_stable_files",), ("0081_snapshot_publish_stable_files",))

def expectations_reader(provider_id, generated_utc, engine):  # noqa: ANN001
    return AlertExpectations(
        collection_generation_id="a" * 64,
        total_alerts=2,
        first_available_date="2026-05-01",
        last_available_date="2026-07-13",
        archive_source_text_count=2,
        archive_description_count=2,
        legacy_alert_count=2,
        legacy_source_text_count=2,
        legacy_description_count=2,
    )

def fetch_bytes(url: str) -> bytes:
    path = urlsplit(url).path.split("/v1/stm/", 1)[1]
    return public_bytes[path]
```

Assert the pass report has matching migration heads, validated sync arithmetic, a zero-error historic gate, all three indexes at the gate's `generated_utc`, every Alert page path in `public["artifacts"]`, both Receipt/route boundaries, exact Alert page digest/size/count checks, and nonzero legacy/archive description counts. Add a second fixture where DB and public Alert collections are truly empty; assert `status == "pass"`, null archive bounds, no page fetch, and both source-message sections report `"no_data"` rather than a zero-message success.

- [ ] **Step 2: Run the new proof tests and verify RED**

Run:

```bash
cd /home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history/apps/db
uv run pytest tests/test_historic_publish_proof.py -q
```

Expected: collection fails because `transit_ops.validation.historic_publish` does not exist.

- [ ] **Step 3: Add RED failure-matrix tests**

Add parametrized tests that assert stable failure codes for each exact violation:

```python
@pytest.mark.parametrize(
    ("mutation", "failure"),
    [
        ("migration_mismatch", "migration_head_mismatch"),
        ("sync_provider", "sync_provider_mismatch"),
        ("sync_dry_run", "sync_dry_run"),
        ("sync_arithmetic", "sync_count_mismatch"),
        ("stale_sync", "sync_receipt_stale"),
        ("gate_provider", "gate_provider_mismatch"),
        ("gate_tier", "gate_tier_mismatch"),
        ("gate_errors", "gate_failed"),
        ("stale_gate", "gate_generation_stale"),
        ("index_generation", "public_index_generation_mismatch"),
        ("archive_generation", "public_archive_generation_mismatch"),
        ("unsafe_page", "unsafe_public_path"),
        ("page_sha", "alert_page_sha256_mismatch"),
        ("page_size", "alert_page_byte_size_mismatch"),
        ("page_count", "alert_page_count_mismatch"),
        ("archive_description", "archive_source_description_missing"),
        ("legacy_description", "legacy_source_description_missing"),
        ("archive_text", "archive_source_text_missing"),
        ("legacy_text", "legacy_source_text_missing"),
    ],
)
def test_historic_publish_proof_fails_closed(mutation: str, failure: str) -> None:
    report = build_mutated_report(mutation)
    assert report.status == "fail"
    assert failure in report.failures
```

Also prove malformed JSON, HTTP failure, Pydantic contract failure, wrong Receipt date, wrong route ID, and unsafe manifest prefixes become report failures with artifact evidence rather than uncaught operational exceptions. Assert an injected `TypeError` from a dependency callable still propagates so programming mistakes are not laundered as an operational proof result.

- [ ] **Step 4: Implement the minimal proof service**

Implement `historic_publish.py` with these exact rules:

```python
SYNC_MAX_AGE = timedelta(hours=6)
GATE_MAX_AGE = timedelta(hours=36)
FUTURE_SKEW = timedelta(minutes=5)

def _has_source_text(alert: object) -> bool:
    return any(
        isinstance(value, str) and value.strip()
        for value in (
            getattr(alert, "header_text", None),
            getattr(alert, "header_text_en", None),
            getattr(alert, "description", None),
            getattr(alert, "description_en", None),
        )
    )

def _has_description(alert: object) -> bool:
    return any(
        isinstance(value, str) and value.strip()
        for value in (
            getattr(alert, "description", None),
            getattr(alert, "description_en", None),
        )
    )

def _safe_public_path(path: str) -> str:
    parsed = urlsplit(path)
    segments = path.split("/")
    if (
        not path
        or parsed.scheme
        or parsed.netloc
        or path.startswith("/")
        or "\\" in path
        or parsed.query
        or parsed.fragment
        or any(segment in {"", ".", ".."} for segment in segments)
        or any("%2f" in segment.casefold() or "%5c" in segment.casefold() for segment in segments)
    ):
        raise ValueError("unsafe_public_path")
    return path
```

The production migration reader must use `ScriptDirectory.from_config(config).get_heads()` and `SELECT version_num FROM alembic_version ORDER BY version_num`; success requires the exact sets to match and contain one head. The production expectation reader must build the current DB `AlertArchiveBundle` and legacy `AlertHistory` through the existing builders at the gate generation, then count source text and descriptions from those real models.

Parse the sync receipt with nonnegative integer counts and enforce:

```python
source_count == inserted_count + updated_count + unchanged_count
```

Require matching provider, `dry_run is False`, exact requested/source-bound honesty, and a `synced_at_utc` within the allowed age/skew. Parse the gate report and require matching provider, tier `historic`, zero errors, positive `checks_run` and `payloads_checked`, and a current `generated_utc` within the allowed age/skew.

Fetch `manifest.json` with a unique `proof=` query, validate it as `Manifest`, and use its historic pointers/prefixes without requiring `manifest.files.historic.generated_utc` to match immediately. If the manifest fails, record the failure and continue with `ManifestHistoricFiles()` defaults so the report still captures direct public evidence.

Fetch and validate all three real indexes plus `historic/alert_history.json`. Require each mutable historic payload's `generated_utc` to equal the gate report. Fetch every Alert page, validate `AlertArchivePage`, and compare its raw byte length and SHA-256 to its advertised ref before counting entries/messages. Require the public archive generation, total, bounds, and page counts to match the DB-derived expectations. Fetch de-duplicated oldest/newest Receipt dates and route IDs, validate each model, and require the payload date/ID and generation to match its index/gate.

Return a report for every operational result. Set `status="fail"` iff `failures` is nonempty. Redact credentials by recording only public URLs and hashes; never include `DATABASE_URL`, R2 credentials, or exception representations that embed request headers.

- [ ] **Step 5: Export the service and run GREEN**

Add to `apps/db/src/transit_ops/validation/__init__.py`:

```python
from transit_ops.validation.historic_publish import (
    AlertExpectations,
    HistoricPublishProofReport,
    MigrationEvidence,
    build_historic_publish_proof,
)
```

Include all four names in `__all__`, then run:

```bash
uv run pytest tests/test_historic_publish_proof.py -q
uv run ruff check src/transit_ops/validation/historic_publish.py src/transit_ops/validation/__init__.py tests/test_historic_publish_proof.py
uv run ruff format --check src/transit_ops/validation/historic_publish.py src/transit_ops/validation/__init__.py tests/test_historic_publish_proof.py
```

Expected: all proof tests pass; Ruff reports no findings and all files already formatted.

- [ ] **Step 6: Commit the proof service**

```bash
git add apps/db/src/transit_ops/validation/historic_publish.py \
  apps/db/src/transit_ops/validation/__init__.py \
  apps/db/tests/test_historic_publish_proof.py
git commit -m "feat(db): prove historic publication recovery"
```

### Task 2: Add the thin proof CLI

**Files:**
- Modify: `apps/db/tests/test_cli.py`
- Modify: `apps/db/src/transit_ops/cli.py`

**Interfaces:**
- Consumes: `build_historic_publish_proof(provider_id, sync_receipt: Mapping[str, object], gate_report: Mapping[str, object], settings: Settings)`, `_provider_registry`, `_skip_if_unseeded`, and `_preflight_report_path`.
- Produces:

```text
verify-historic-publish PROVIDER \
  --sync-report PATH \
  --gate-report PATH \
  --report-path PATH
```

The command prints the same sorted JSON it writes. It exits `0` only for a passing proof or an explicit unseeded skip, and exits `1` after writing/printing a failed proof.

- [ ] **Step 1: Write CLI RED tests**

Add tests named `test_verify_historic_publish_help`,
`test_verify_historic_publish_reads_receipts_and_writes_passing_report`,
`test_verify_historic_publish_writes_report_before_failed_exit`,
`test_verify_historic_publish_rejects_bad_json_before_builder`,
`test_verify_historic_publish_rejects_missing_or_directory_inputs`,
`test_verify_historic_publish_rejects_unknown_provider_before_writing`, and
`test_verify_historic_publish_skips_unseeded_provider_without_builder`.

The happy/failure tests must monkeypatch `build_historic_publish_proof`, assert both parsed mappings are passed unchanged, compare stdout JSON byte-for-byte with `--report-path`, and assert failed proof still leaves the report file. The unseeded test must assert the existing honest skip JSON and no proof-builder call.

- [ ] **Step 2: Run focused CLI tests and verify RED**

Run:

```bash
uv run pytest tests/test_cli.py -q -k 'verify_historic_publish'
```

Expected: failures because the command is not registered.

- [ ] **Step 3: Implement the command**

Add the import and command:

```python
from transit_ops.validation.historic_publish import build_historic_publish_proof

@app.command("verify-historic-publish")
def verify_historic_publish_command(
    provider_id: str,
    sync_report: Path = typer.Option(..., "--sync-report"),  # noqa: B008
    gate_report: Path = typer.Option(..., "--gate-report"),  # noqa: B008
    report_path: Path = typer.Option(..., "--report-path"),  # noqa: B008
) -> None:
    """Verify one migrated, synced, gated historic publication against public /v1."""
    settings = get_settings()
    try:
        _provider_registry(settings).get_provider(provider_id)
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    if _skip_if_unseeded(settings, provider_id, step="verify-historic-publish"):
        return
    _preflight_report_path(report_path)
    sync_payload = _read_json_object(sync_report, option_name="--sync-report")
    gate_payload = _read_json_object(gate_report, option_name="--gate-report")
    result = build_historic_publish_proof(
        provider_id,
        sync_receipt=sync_payload,
        gate_report=gate_payload,
        settings=settings,
    )
    body = json.dumps(result.display_dict(), indent=2, sort_keys=True)
    report_path.write_text(body + "\n", encoding="utf-8")
    typer.echo(body)
    if result.status != "pass":
        raise typer.Exit(code=1)
```

Implement `_read_json_object(path, option_name)` beside the existing report preflight helpers. It must reject a missing path, directory, unreadable file, invalid JSON, or non-object JSON with a `typer.BadParameter` naming the option and must not log raw file contents.

- [ ] **Step 4: Run CLI GREEN and regression tests**

```bash
uv run pytest tests/test_cli.py -q -k 'verify_historic_publish or publish_all_writes_gate_report or sync_alert_archive'
uv run ruff check src/transit_ops/cli.py tests/test_cli.py
uv run ruff format --check src/transit_ops/cli.py tests/test_cli.py
```

Expected: selected tests pass and Ruff is clean.

- [ ] **Step 5: Commit the CLI**

```bash
git add apps/db/src/transit_ops/cli.py apps/db/tests/test_cli.py
git commit -m "feat(db): expose historic publication proof"
```

### Task 3: Add the bounded manual recovery workflow

**Files:**
- Create: `apps/db/tests/test_historic_publish_recovery_workflow.py`
- Create: `.github/workflows/historic-publish-recovery.yml`

**Interfaces:**
- Consumes: existing `init-db`, `list-providers`, `sync-alert-archive`, `publish-all --tier historic --report-dir`, new `verify-historic-publish`, production DB/R2 secrets, and `actions/upload-artifact@v4`.
- Produces: one manual GitHub Actions lane and `historic-publish-recovery-${{ github.run_id }}` containing migration output, per-provider sync receipts, publish output, per-provider gate reports, and per-provider public proof reports.

- [ ] **Step 1: Write parsed-YAML RED tests**

Create `test_historic_publish_recovery_workflow.py` with `yaml.safe_load`, the existing PyYAML `on` fallback, and assertions for:

```python
assert set(on_block) == {"workflow_dispatch"}
assert document["permissions"] == {"contents": "read"}
assert job["timeout-minutes"] == 45
assert job["defaults"]["run"]["working-directory"] == "apps/db"
assert document["concurrency"] == {
    "group": "daily-warm-rollups",
    "cancel-in-progress": False,
}
```

Read the daily workflow and assert its concurrency block is identical. Join only step `run` bodies and assert strict command order:

```python
init < migration_head < sync < publish < proof
```

Assert the sync is a `list-providers` loop with per-provider `tee`, publish is exactly default-gated historic with `--report-dir artifacts/historic-publish-recovery`, and proof receives the matching sync/gate/report paths. Assert the workflow raw text contains neither `--no-gate` nor `--force` and no command from this exact forbidden set:

```python
FORBIDDEN = {
    "build-warm-rollups",
    "rebuild-warm-rollups",
    "build-gold-marts",
    "run-static-pipeline",
    "prune-i3-storage",
    "prune-warm-rollup-storage",
    "prune-bronze-storage",
    "prune-silver-storage",
    "prune-gold-storage",
    "backfill-alert-archive",
    "replay-realtime-silver",
}
```

Assert the upload step uses `if: always()`, `continue-on-error: true`, `actions/upload-artifact@v4`, workspace-relative `apps/db/artifacts/historic-publish-recovery/`, 30-day retention, and `if-no-files-found: warn`. Assert the env has only the required production DB/snapshot settings and reused R2 credentials; it must not expose unrelated provider feed/API secrets.

- [ ] **Step 2: Run workflow tests and verify RED**

```bash
uv run pytest tests/test_historic_publish_recovery_workflow.py -q
```

Expected: collection or assertions fail because the workflow file does not exist.

- [ ] **Step 3: Create the workflow**

Use this exact orchestration shape:

```yaml
name: Historic Publish Recovery

on:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: daily-warm-rollups
  cancel-in-progress: false

jobs:
  publish-historic-recovery:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    defaults:
      run:
        working-directory: apps/db
    env:
      APP_ENV: production
      LOG_LEVEL: INFO
      PROVIDER_TIMEZONE: America/Toronto
      STM_PROVIDER_ID: stm
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
      BRONZE_S3_ENDPOINT: https://eccfb9bedd87d413eaf4cac6ae2285d3.r2.cloudflarestorage.com
      BRONZE_S3_REGION: auto
      BRONZE_S3_ACCESS_KEY: ${{ secrets.BRONZE_S3_ACCESS_KEY }}
      BRONZE_S3_SECRET_KEY: ${{ secrets.BRONZE_S3_SECRET_KEY }}
      SNAPSHOT_STORAGE_BACKEND: s3
      SNAPSHOT_R2_BUCKET: ${{ secrets.SNAPSHOT_R2_BUCKET }}
      SNAPSHOT_PUBLIC_BASE_URL: ${{ secrets.SNAPSHOT_PUBLIC_BASE_URL }}
```

Add the same pinned checkout/Python/uv/dependency setup as the daily lane. Then add these run steps:

```bash
mkdir -p artifacts/historic-publish-recovery
uv run python -m transit_ops.cli init-db 2>&1 \
  | tee artifacts/historic-publish-recovery/migration-upgrade.txt
```

```bash
{
  uv run alembic heads
  uv run alembic current --check-heads
} 2>&1 | tee artifacts/historic-publish-recovery/migration-head.txt
```

```bash
for provider in $(uv run python -m transit_ops.cli list-providers); do
  uv run python -m transit_ops.cli sync-alert-archive "$provider" \
    | tee "artifacts/historic-publish-recovery/alert-archive-sync-${provider}.json"
done
```

```bash
uv run python -m transit_ops.cli publish-all \
  --tier historic \
  --report-dir artifacts/historic-publish-recovery \
  | tee artifacts/historic-publish-recovery/historic-publish.json
```

```bash
for provider in $(jq -r '.[].provider_id' artifacts/historic-publish-recovery/historic-publish.json); do
  uv run python -m transit_ops.cli verify-historic-publish "$provider" \
    --sync-report "artifacts/historic-publish-recovery/alert-archive-sync-${provider}.json" \
    --gate-report "artifacts/historic-publish-recovery/publish-gate-${provider}.json" \
    --report-path "artifacts/historic-publish-recovery/public-proof-${provider}.json"
done
```

GitHub's default bash `-e -o pipefail` must remain in force so a failed migration, sync, gate, publish, or proof stops the successful path while the final artifact upload still runs.

- [ ] **Step 4: Run workflow GREEN and existing daily-lane regressions**

```bash
uv run pytest \
  tests/test_historic_publish_recovery_workflow.py \
  tests/test_deploy_artifacts.py \
  tests/test_workflow_alerting_contract.py -q
```

Expected: all tests pass; the existing daily `sync < build < publish < prune` assertions remain unchanged.

- [ ] **Step 5: Commit the workflow**

```bash
git add .github/workflows/historic-publish-recovery.yml \
  apps/db/tests/test_historic_publish_recovery_workflow.py
git commit -m "feat(ops): add historic publish recovery lane"
```

### Task 4: Verify Task 6 and obtain independent review

**Files:**
- Modify: `.superpowers/sdd/progress.md` (ignored local ledger)
- Create: `.superpowers/sdd/task-6-historic-publish-recovery-report.md` (ignored local evidence)

**Interfaces:**
- Consumes: all Task 6 production/test files and the existing archive publication, CLI, workflow, migration, gate, storage, and SQL-registry regressions.
- Produces: reproducible verification receipts and a fresh independent reviewer verdict; no deployment claim.

- [ ] **Step 1: Run the focused Task 6 matrix**

```bash
cd /home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history/apps/db
uv run pytest \
  tests/test_historic_publish_proof.py \
  tests/test_historic_publish_recovery_workflow.py \
  tests/test_cli.py \
  tests/test_alert_archive.py \
  tests/test_alert_archive_publication.py \
  tests/test_alert_archive_publication_real_db.py \
  tests/test_snapshots_publish.py \
  tests/test_snapshots_publish_parallel.py \
  tests/test_snapshots_gate.py \
  tests/test_snapshots_contract.py \
  tests/test_deploy_artifacts.py \
  tests/test_workflow_alerting_contract.py \
  tests/test_migration_0079_alert_history_messages.py \
  tests/test_migration_0080_alert_archive.py \
  tests/test_migration_0081_snapshot_publish_stable_files.py \
  tests/test_sql_registry.py -q
```

Expected: all selected tests pass. If the real-DB publication file skips because `TRANSIT_TEST_DATABASE_URL` is absent, record the exact skip count; do not call the skipped proof executed.

- [ ] **Step 2: Run complete DB and quality gates**

```bash
uv run pytest -q
uv run ruff check src tests
uv run ruff format --check src tests
cd /home/mgkdante/Yesito/projects/transit/.worktrees/p5r-partitioned-history
git diff --check origin/main..HEAD
git status --short --branch
```

Expected: the full DB suite passes with only documented environment-dependent skips; Ruff and diff checks are clean; the branch contains only intended Task 6 changes plus prior retained-history commits.

- [ ] **Step 3: Write the ignored evidence report and self-review**

Record every RED command/failure, GREEN command/count, commit hash, skipped real-DB test, and quality result in `.superpowers/sdd/task-6-historic-publish-recovery-report.md`. Review the complete Task 6 diff and explicitly confirm:

```text
manual trigger only
45-minute bound
shared historic-writer concurrency
no expensive builder/replay/backfill/prune command
default gate with no override
migration head proven
sync arithmetic and freshness proven
three real indexes proven
all advertised Alert pages fetched and hash-checked
oldest/newest Receipt and route URLs fetched
legacy and partitioned Alert source messages checked separately
honest empty Alert treatment
no global history-index publisher
daily lane unchanged except shared serialization by existing group
no secret values in reports
no deployment claim
```

Update `.superpowers/sdd/progress.md` from Task 6 planning to Task 6 review only after the local test evidence exists.

- [ ] **Step 4: Request a fresh independent Task 6 review**

Give a new reviewer the exact base `410811a0`, Task 6 commit range, this plan, canonical Notion Task 6 wording, and evidence report. Require review of production code and tests for fail-open behavior, path/URL injection, stale same-day false passes, source-message false positives, migration-head truth, workflow concurrency/races, skipped-provider semantics, secret leakage, and accidental expensive commands. The reviewer must rerun at least the focused proof/workflow tests and `git diff --check` and must not edit files.

- [ ] **Step 5: Fix every accepted finding test-first and re-verify**

For each accepted finding, first add the narrow failing regression, run it to prove RED, implement the smallest correction, rerun the focused matrix and all affected regressions, and commit with a scoped message. Repeat independent review until it returns no findings.

- [ ] **Step 6: Mark Task 6 locally complete without deploying**

Update the ignored progress ledger with the final commit range and clean reviewer verdict. Leave Task 7 Network/Lines/Stops pending. Do not push or dispatch the workflow from this task; a real production run and public URL receipts remain a separate deployment action after integration authority and secrets are available.

## Plan Self-Review

- Spec coverage: every canonical Task 6 clause maps to Tasks 1–4; migration, sync counts, default gate, public indexes, URL fetches, source messages, bounded execution, daily compatibility, artifacts, and no-rollup behavior each have a direct test.
- Scope boundary: `historic/history/index.json` remains deliberately absent because it has no publisher today and current Alerts/Receipts use their real family indexes; later families own that rollout.
- Placeholder scan: every created/modified file, public signature, command, failure class, verification command, and commit boundary is named; implementation steps contain concrete behavior and code shapes.
- Type consistency: `sync_receipt`, `gate_report`, `MigrationEvidence`, `AlertExpectations`, `HistoricPublishProofReport`, and `build_historic_publish_proof` use the same names and types in the service, CLI, workflow, and tests.
- Operational honesty: local code green is explicitly separated from a real workflow run; empty Alerts are `no_data`, while missing public descriptions fail only when the DB proves descriptions exist.
