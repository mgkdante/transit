---
notion:
  root_page_id: "3663e863-0690-8098-91ab-d71e03b57254"
  workspace_url: "https://www.notion.so/"
  databases:
    slices:
      database_id: "71633cd8-0568-47da-bc7a-b070524ee9ef"
    sessions:
      database_id: "c3c2d13f-d0fa-46cb-883a-8016fb009e5e"
    transcript_chunks:
      database_id: "f54f87d7-d967-443a-aa1f-c23bf48b46bc"
  pages:
    roadmap: "962edb61-2fe6-4966-9c22-93d4f10c446c"
    architecture: "3663e863-0690-815b-927d-ea4888252234"
    business: "3663e863-0690-819f-8f1f-ffd7313e39bd"
  vocabulary_page_id: "3503e863-0690-8105-8dd7-fccd0d94699c"
---

# Transit agent instructions

Transit captures GTFS and GTFS-Realtime data, normalizes it in Postgres, and
publishes versioned snapshots for the public citizen web app. It is a portfolio
project. Workflow-overlord Canonical means Notion workflow state; the data model
uses canonical to mean normalized transport data.

## Recover scope before editing

1. Verify the actual checkout, branch, full HEAD/tree and working-tree/index
   status. A migrated main checkout may be ahead of the remote; use the approved
   checkpoint, not an assumed remote default. Preserve historical experiments
   and unrelated worktrees. Read any applicable nested agent instructions.
2. Read [Current status and dependencies](https://www.notion.so/3eb3e8630690812b8f41c682e15ffb21).
   Consult the [Phase 3.2 Plan](https://www.notion.so/3d93e863069081f686cecb4f20f784e1)
   only for relevant original criteria or historical evidence. Read the selected
   slice's Plan/Handoff and ancestor context before implementing it.
3. Resolve workflow configuration using AGENTS.override.md > AGENTS.local.md >
   AGENTS.md. Query Sessions with the exact runtime session ID: CODEX_THREAD_ID
   for Codex, or the actual tool-provided ID for another client. Preserve existing
   Slice relations and the correct Tool identity. Git does not establish attachment.
4. Use hosted Notion MCP interactively; on failure use the installed
   workflow-overlord REST helper. Resolve the installed helper on the current OS
   without changing plugin source. If both paths fail, report the exact access
   failure; continue only work whose approved scope is already available.

## Continue in finite packets

- Routine planning, implementation, focused repair loops and finite continuation
  are authorized without repeated confirmation. Each packet needs a concrete
  outcome, scope, validation and stop condition. Finish independent ready work
  before reporting an actual missing dependency; do not invent prerequisite
  projects or repeat unchanged blocker audits.
- Use supported goal tools for the authorized continuation: one finite active
  goal per owner, no token budget unless explicitly requested. Complete it only
  after its outcome and canonical readback are verified, then start the next
  executable packet. Report unavailable goal tooling rather than inventing state.
- For this maintainer's Codex continuation workflow, primary and successor owners
  use gpt-6-astra with ultra reasoning. This allocation preference does not require
  other contributors to adopt Codex or change their personal LLM setup.
  Verify through supported APIs or exposed runtime metadata; distinguish live
  execution evidence from persisted settings. If unavailable, state the limitation
  instead of claiming verification or silently substituting an owner model.
- In that workflow, select worker model and effort explicitly: gpt-6-luna
  low/medium for routine extraction, gpt-6.1-sol medium/high for implementation,
  debugging and review, and Astra for demonstrated uncertainty. Give each worker
  a narrow brief and file ownership. Verify its findings and code before accepting
  them. Avoid full-history duplication when a bounded brief is sufficient.
- Keep one canonical writer and at most one prepared successor. A child may
  research read-only while the owner works; concurrent code writers require
  disjoint assigned files. Before succession, persist and read back the exact
  source, completed result, remaining scope, verification, limitations, new owner
  and finite objective. The matching succession marker releases the old writer
  before the successor writes. Elapsed time alone grants no authority.
- Create successors only for executable packets. Context management is a reason
  to hand off a verified checkpoint, not to replay investigation or run empty loops.
  Missing credentials, irreducible decisions and publishing gates remain real.

## Keep the product portable

- Product code and setup/build/test commands must work across Windows, Linux and
  applicable cloud hosts. Contributor LLM clients, plugins and private settings
  are personal; they are not product build or runtime dependencies. Keep this
  repository's agent configuration here. Create no shared LLM files at brand level.
- Execute on the selected host. Windows work uses native Windows tools; do not
  switch it back to WSL. Historical WSL transcripts may supply context, never fresh
  Windows execution proof. No local Docker on Windows or WSL.
- Use repository-relative paths and standard path/URL conversion APIs. Isolate
  unavoidable OS-specific locking, process, archive or filesystem operations
  behind a small explicit boundary. Preserve behavior and fail closed when the
  required capability is absent; a platform check must not hide product failures.
- Read versions and commands from their executable owners: root package.json,
  .nvmrc, .bun-version, .python-version, workspace manifests, apps/db/pyproject.toml,
  lockfiles and relevant CI/deployment configuration. Do not duplicate version
  inventories here or upgrade pins just to match a machine's installed tools.
- Recreate only needed dependencies from pins/lockfiles; virtual environments,
  node_modules and generated caches are specific to their host. On this Windows
  migration use uv-managed Python: the legacy system Python has an incomplete
  standard library. Keep machine paths out of tracked configuration and preserve
  .gitattributes LF rules.
- Distinguish portable contributor commands from intentionally Linux-hosted
  operational scripts. Keep their platform requirements explicit. Windows tests,
  Linux source review and hosted execution are separate evidence; none proves
  support for every cloud provider, CPU architecture or filesystem.

## Protect project boundaries

- apps/db owns ingestion, normalization and publication; apps/data-proxy serves
  versioned snapshots; apps/web consumes that contract, never Postgres directly.
- Vendored design is immutable. Adopt an exact external release with its manifest;
  propose shared design fixes in its owner repository, not the vendor directory.
- Preserve private configuration and unrelated files. Stage only named changes;
  never use git add -A, blanket resets, cleans or historical branch merges.
  Verify Windows deletion/move targets before destructive filesystem operations.
- Never edit Codex state/SQLite or bypass approval controls. Push, hosted runs,
  merge, deployment and publishing require their applicable explicit authority;
  local implementation or session continuation does not supply it.

## Verify and persist

- Reproduce a bug at its owning boundary, add meaningful regression coverage for
  changed behavior and run the affected checks. Broaden only for unresolved risk
  or failures; do not repeat large suites after unchanged successful results.
  Treat skipped tests and mocked OS branches as limitations, not platform proof.
- Before declaring completion, inspect the final diff, check whitespace, confirm
  the intended source and review material changes independently. Record exact
  commands/results and distinguish local, hosted, deployed, physical-device/AT,
  account and owner evidence. Preserve failed attempts and their original scope.
- Plans, progress, evidence summaries and long-form guides belong in Notion.
  [Guide index and source archive](https://www.notion.so/3eb3e863069081beb5d3ed7c1cf7e68b)
  identifies the migrated guides; do not recreate their deleted repository copies.
  Keep operational agent instructions and executable/runtime/license/vendor assets.
- Make targeted canonical updates, preserve native files and child pages, and
  fetch the result to verify readback. Keep one authoritative copy of each fact.
- Full independent M3 acceptance precedes M4. Parent Roadmap acceptance is
  independent of slice closure. Preserve current DOC budgets/capture allowances,
  MAP latency tradeoff, settled motion behavior, AT/device and external-access
  dispositions in the current-status page. Portability and instruction cleanup
  alone add no M3 acceptance and reopen no exhausted capture allowance.
