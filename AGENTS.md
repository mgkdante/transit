# Transit agent instructions

Transit captures GTFS and GTFS-Realtime data, normalizes it in Postgres, and
publishes versioned snapshots for the public citizen web app. It is a portfolio
project. In the data model, canonical means normalized transport data.

Notion owns intent, decisions, standing rules and how to work with Yesito. Before agentic coding, read [LLMs](https://app.notion.com/p/4083e863069080df9e63d165128a1522), which routes to the rest, and this project's [guide](https://app.notion.com/p/4083e863069081f7b6edf66237f17f35). Don't add standing rules here: this file keeps local commands and constraints only. Write to Notion only when the current task authorizes it. Private workspace access is not needed to contribute.

## Recover scope before editing

1. Verify the actual checkout, branch, full HEAD/tree and working-tree/index
   status. A migrated main checkout may be ahead of the remote; use the approved
   checkpoint, not an assumed remote default. Preserve historical experiments
   and unrelated worktrees. Read any applicable nested agent instructions.
2. Follow the project guide's current-state route, then read the selected slice's
   Plan/Handoff and ancestor context before implementing it.
3. If Notion can't be reached, report the exact access failure; continue only
   work whose approved scope is already available.

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
- The `@yesid/*` packages come from one exact yesid.design release; propose shared design fixes
  in that repository, never patch them under `node_modules`.
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
- Plans, progress, evidence summaries and long-form guides belong in Notion.
  [Guide index and source archive](https://www.notion.so/3eb3e863069081beb5d3ed7c1cf7e68b)
  identifies the migrated guides; do not recreate their deleted repository copies.
  Keep operational agent instructions and executable/runtime/license/vendor assets.
