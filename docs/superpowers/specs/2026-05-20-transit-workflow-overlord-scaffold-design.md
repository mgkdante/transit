# Transit Workflow-Overlord Scaffold Design Spec

**Date:** 2026-05-20
**Status:** Approved
**Scope:** Scaffold the Transit Notion site for workflow-overlord adoption, seed the initial canonical roadmap rows, and define the repo-side workflow files that must be created alongside the Notion migration.

---

## Problem

`transit` has real project context, but it is split across repo docs, logs, old superpowers specs, and ad hoc handoff material. There is no workflow-overlord scaffold yet:

- no `AGENTS.md`
- no `AGENTS.local.md`
- no `CLAUDE.md`
- no repo `.codex` hook scaffold
- no project Notion subtree for `Business`, `Architecture`, and `Canonical`

That means the project has useful context, but no single operating system for AI-assisted work. The first job is to create that operating system cleanly, not to keep accumulating more repo-only planning docs.

## Solution

Adopt the same overall workflow-overlord shape already used in `yesid.dev`, but tailored to Transit's needs:

- a clean Notion root page with `Business`, `Architecture`, and `Canonical`
- a disciplined `Architecture` subtree that separates code structure from runtime/ops behavior
- a fresh `Canonical` area with new Roadmap, Slices, Sessions, and Transcript Chunks databases
- two initial roadmap rows:
  - `legacy-context-migration`
  - `upgrading`
- repo-side workflow contract files created alongside the Notion scaffold so the repo can actually point to the Notion state it depends on

The important doctrine is:

- long-form project context lives in Notion
- workflow state lives in Notion
- repo docs become inputs or references, not the canonical workflow brain

## Goals

1. Turn the blank Transit Notion root into a usable workflow-overlord project home.
2. Keep `Business` free-form enough for portfolio and positioning work.
3. Keep `Architecture` structured and easy for humans and LLMs to scan.
4. Start `Canonical` fresh instead of treating old repo logs as live workflow state.
5. Make roadmap row 1 a deliberate LLM-friendly extraction layer for legacy repo context.
6. Create the local repo workflow files required to bind the repo to the new Notion scaffold.
7. Match the `yesid.dev` database field order and operator-facing schema as closely as possible, without copying accidental Notion garbage on purpose.

## Non-goals

- migrating every old repo doc into Notion on day 1
- creating slices during the initial scaffold pass
- writing implementation tasks for future engineering work
- preserving legacy repo planning files as the canonical workflow source after migration
- importing raw logs into one giant unstructured Notion page

## Root Page Cleanup

The current Notion root page is blank and its title is typoed as `ransit`.

As part of the scaffold, rename the root page to `Transit` and use it as the stable workflow-overlord root page referenced by `AGENTS.local.md`.

## Target Notion Tree

```text
Transit
├── 🏢 Business
│   ├── Positioning
│   ├── Scope
│   ├── Audience / Value
│   └── Case Study / Portfolio
├── 🏗️ Architecture
│   ├── Codebase
│   ├── Stack
│   ├── Tests
│   ├── Vocabulary
│   └── Runtime / Operations
└── 📜 Canonical
    ├── 🗺️ Roadmap
    ├── 🍞 Slices
    ├── 🕛 Sessions
    └── 📄 Transcript Chunks
```

## Business Design

`Business` is intentionally freer than `Architecture`, but it still needs stable anchors so the project story does not fragment.

### Pages

**Positioning**
- what Transit is
- what it proves
- why transit data was chosen
- how to describe it to employers or clients

**Scope**
- what is in V1
- what is intentionally out of scope
- what counts as success

**Audience / Value**
- who the project is for
- what operational questions it answers
- what value it demonstrates as a portfolio asset

**Case Study / Portfolio**
- links to the live dashboard
- case-study framing
- portfolio-ready language and assets

### Source Inputs

Primary repo inputs for the initial Business pages:

- `README.md`
- `CASE_STUDY.md`
- `powerbi/portfolio-notes.md`
- business-story sections from `powerbi/dashboard-spec.md`

Older planning docs can contribute wording, but they should not dominate this layer.

## Architecture Design

`Architecture` should be strict enough that an LLM or collaborator can quickly locate the right kind of context without searching the whole tree.

### Pages

**Codebase**
- repo layout
- major modules
- CLI surface
- migration layout
- provider config layout

**Stack**
- Python runtime
- Neon/Postgres
- Cloudflare R2
- Railway
- GitHub Actions
- Power BI
- key libraries and abstractions

**Tests**
- test layout
- what is covered
- where confidence is strong
- where coverage is weak or missing

**Vocabulary**
- project-specific terms
- Bronze / Silver / Gold meanings here
- GTFS / GTFS-RT terms
- workflow-overlord terms used in this repo

**Runtime / Operations**
- realtime cadence
- retention windows
- Railway worker behavior
- GitHub Actions schedules
- Power BI access model
- pause/resume mechanics
- operational caveats

### Source Inputs

Primary repo inputs for the initial Architecture pages:

- `docs/architecture.md`
- `docs/realtime-worker-hosting.md`
- `src/transit_ops/cli.py`
- `src/transit_ops/orchestration.py`
- `src/transit_ops/settings.py`
- `config/providers/stm.yaml`
- `.github/workflows/*.yml`
- `src/transit_ops/db/migrations/versions/*`
- `tests/*`
- `powerbi/field-mapping.md`
- `powerbi/dax-measures.md`
- `powerbi/sql-validation.md`
- `powerbi/build-playbook.md`

## Canonical Design

`Canonical` starts fresh. Old logs and old specs are context sources, not the live workflow system.

### Databases

Create these four databases under `📜 Canonical`:

1. `🗺️ Roadmap`
2. `🍞 Slices`
3. `🕛 Sessions`
4. `📄 Transcript Chunks`

### Database field order contract

Match `yesid.dev`'s operator-facing field order and view order as closely as possible.

#### `🗺️ Roadmap`

Visible field order:

1. `Title`
2. `Close date`
3. `Open date`
4. `Priority`
5. `Roadmap-N`
6. `Status`
7. `Summary`
8. `Type`
9. `🍞 Slices`

Expected select values:

- `Priority`: `now`, `next`, `later`, `nice-to-have`
- `Status`: `planned`, `in-progress`, `closed`
- `Type`: `feature`, `fix`, `refactor`, `docs`, `migration`

#### `🍞 Slices`

Visible field order:

1. `Title`
2. `Parent Roadmap`
3. `PR link`
4. `Status`
5. `Parent slice`
6. `Summary`

Expected select values:

- `Status`: `planned`, `in-progress`, `closed`

Notes:

- Notion may auto-create reciprocal self-relation properties. Do not manually invent extra fields unless the relation system requires them.
- Preserve the core relation names used by workflow-overlord: `Parent Roadmap`, `Parent slice`.

#### `🕛 Sessions`

Visible field order:

1. `Title`
2. `Session ID`
3. `Tool`
4. `Started`
5. `Summary`
6. `Transcript`
7. `📄 Transcript Chunks`
8. `Last edited time`
9. `Decisions`
10. `Files touched`
11. `Open questions`
12. `Tools used`
13. `Topics`
14. `Slice`

Expected select values:

- `Tool`: match `yesid.dev`'s current set exactly
  - `Claude Code`
  - `Codex`
  - `Other`
  - `claude`

The point is field-order parity first. Cleanup of legacy option naming can happen later if needed.

#### `📄 Transcript Chunks`

Visible field order:

1. `Title`
2. `Message Count`
3. `Start`
4. `Summary`
5. `Session`
6. `End`
7. `Seq`

## Initial Roadmap Rows

Seed `Roadmap` with exactly two rows:

1. `legacy-context-migration`
2. `upgrading`

### `legacy-context-migration`

Purpose:

- normalize old repo-only context into an LLM-friendly canonical extraction layer
- make the useful parts of legacy logs and specs easy to inherit later
- avoid forcing future slices to parse giant raw logs directly

Primary sources:

- `docs/logs/`
- `docs/superpowers/`

This row should include a `Research` child page from day 1.

### `upgrading`

Purpose:

- serve as the first forward-looking roadmap row after legacy context is stabilized
- hold the workflow-overlord adoption and next upgrade work that should happen in the new system, not outside it

This row does not need to inherit the raw legacy dump. It should inherit only the normalized outputs produced by `legacy-context-migration`.

## LLM-Friendly Legacy Context Extraction

Roadmap row 1 must be easy for LLMs to retrieve from and reason over. Do not treat it like a dumping ground.

### Row body

Keep the row body short:

- one to two lines explaining the purpose
- child page embeds only

### `Plan` child page structure

`Plan` should contain:

- mission
- source directories
- extraction goals
- normalization rules
- output shape
- review rules

Recommended sections:

1. `## Mission`
2. `## Source Directories`
3. `## Extraction Rules`
4. `## Target Outputs`
5. `## Chunking Strategy`
6. `## Review Checklist`

### `Research` child page structure

`Research` should be the actual retrieval-friendly extraction surface.

Recommended sections:

1. `## Source Inventory`
2. `## Timeline / Chronology`
3. `## Architecture Decisions Extracted`
4. `## Business / Product Decisions Extracted`
5. `## Operational Facts Extracted`
6. `## Open Questions / Conflicts`
7. `## Raw Source Index`

### Extraction rules

To keep this LLM-friendly:

- summarize decisions in small, labeled chunks
- prefer bullets with explicit subjects over long narrative paragraphs
- include concrete dates when they exist
- separate facts from interpretations
- preserve source filenames when making claims
- isolate contradictions instead of blending them away
- avoid giant copy-pastes from raw logs

### Target outcome

Future slices should be able to inherit from `legacy-context-migration` and get:

- a usable project chronology
- durable architecture decisions
- operational facts
- unresolved questions

without having to scan six raw log files every time.

## Repo-Side Workflow Scaffold

The Notion migration is not complete unless the repo also gains the local workflow files that point at it.

### Files to scaffold

**Committed**

- `AGENTS.md`
- `CLAUDE.md`
- `.env.1password`
- `.codex/config.toml`
- `.codex/hooks/session-start.sh`
- `.codex/hooks/user-prompt-submit.sh`
- `.codex/hooks/stop.sh`
- `.codex/hooks/pretool-check-notion-config.sh`
- `.codex/hooks/pretool-check-notion-edit.sh`

**Gitignored / local**

- `AGENTS.local.md`
- `.env`

### `AGENTS.md`

Purpose:

- committed workflow contract
- placeholder-safe frontmatter
- project doctrine for Transit as a workflow-overlord adopter

It should define:

- project identity
- Notion subtree shape
- canonical-location doctrine
- retrieval priority
- workflow-overlord expectations

It should follow the same pattern as `yesid.dev`, but updated for Transit's actual project description and current workflow-overlord version.

### `AGENTS.local.md`

Purpose:

- hold the real Notion UUIDs for the Transit tree
- remain gitignored

It should include:

- root page id
- slices DB id
- sessions DB id
- transcript chunks DB id
- roadmap DB id
- architecture page id
- architecture index DB placeholder or real id
- business page id
- business index DB placeholder or real id
- shared vocabulary page id

Until real Architecture and Business index databases exist, the placeholder-safe starting move is to point `architecture_index_db` and `business_index_db` at their parent pages, matching the current `yesid.dev` doctrine.

### `CLAUDE.md`

Purpose:

- short project-side adoption guide
- remind Claude Code that this repo uses workflow-overlord
- point at Notion as canonical state

This should stay operational, not become a second architecture doc.

### `.env.1password`

Purpose:

- committed secret-reference template for the Notion integration token
- canonical workflow-overlord secret pattern

Expected content shape:

```dotenv
NOTION_INTEGRATION_TOKEN=op://<vault>/<item-uuid>/credential
```

### `.codex/config.toml` and hooks

Purpose:

- enable repo-level hook dispatchers for Codex
- match the nested hook block shape required by Codex
- point at the project's local `.codex/hooks/*.sh` wrappers

This is required if the Transit repo is meant to behave like `yesid.dev` in Codex instead of only in theory.

## Implementation Sequence

The scaffold implementation should happen in this order:

1. rename the Notion root page to `Transit`
2. create `Business`, `Architecture`, and `Canonical`
3. create the `Architecture` subpages
4. create the four canonical databases
5. configure the field order and select options to match `yesid.dev`
6. create the two roadmap rows
7. create child pages for those roadmap rows
8. seed row 1 with the LLM-friendly extraction structure
9. scaffold the repo-side workflow files
10. write `AGENTS.local.md` with the real UUIDs captured from the new Notion structure

## Risks

### Notion schema drift

`yesid.dev` includes some relation noise from Notion's automatic reciprocal fields. If Transit copies those blindly, the schema becomes messy on day 1.

Mitigation:

- preserve operator-facing field order and required relation names
- do not manually add weird duplicate relation fields unless Notion forces them

### Canonical confusion

Transit already uses the word `canonical` in the data-model sense for Silver tables. That can create confusion with workflow-overlord `Canonical`.

Mitigation:

- define both meanings explicitly in `Architecture/Vocabulary`
- treat workflow-overlord `Canonical` as workflow state, not data model

### Legacy context overload

If roadmap row 1 becomes a raw pastebin, it will be useless for inheritance.

Mitigation:

- enforce chunked extraction
- preserve source references
- separate facts, decisions, and open questions

## Done Means

This design is satisfied when:

1. the Transit Notion root is renamed and scaffolded
2. the root contains `Business`, `Architecture`, and `Canonical`
3. `Architecture` contains the five agreed pages
4. `Canonical` contains the four workflow-overlord databases
5. those databases use the same operator-facing field order as `yesid.dev`
6. roadmap rows `legacy-context-migration` and `upgrading` both exist
7. roadmap row 1 has an LLM-friendly extraction-oriented `Plan` and `Research` structure
8. the repo contains the local workflow scaffold files needed to point at the new Notion state
