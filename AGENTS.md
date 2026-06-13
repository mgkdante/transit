---
# This file's frontmatter ships with `<FILL IN>` placeholders by design.
# Real Notion UUIDs live in a gitignored `AGENTS.local.md` file.
# Resolution: AGENTS.local.md > AGENTS.md > refuse (PreToolUse Rule 6 hook enforces).

notion:
  root_page_id: "<FILL IN: Transit top page UUID>"
  workspace_url: "<FILL IN: e.g. https://www.notion.so/>"
  databases:
    slices:
      database_id: "<FILL IN>"
    sessions:
      database_id: "<FILL IN>"
    transcript_chunks:
      database_id: "<FILL IN>"
  pages:
    roadmap: "<FILL IN>"
    architecture: "<FILL IN>"
    architecture_index_db: "<FILL IN>"
    business: "<FILL IN>"
    business_index_db: "<FILL IN>"
  vocabulary_page_id: "<FILL IN: shared global vocabulary page UUID>"
---

# AGENTS.md — transit workflow contract (v3)

> **Tool-agnostic.** Read by both Claude Code and Codex CLI.

## Project

**Transit** — near-real-time STM transit operations analytics pipeline. GTFS static and GTFS-Realtime feeds are captured to Bronze storage, normalized into Postgres, and published as versioned /v1 snapshots to Cloudflare R2 for the public citizen web app (web/). This is a portfolio project, not a SaaS product.

## Workflow

workflow-overlord 3.x orchestrates Claude Code + Codex sessions via Notion shared state. Anti-hallucination through chunked slices. **Notion is the canonical workflow state.** Git branches and worktrees are optional operator workflow, not plugin metadata.

Notion is also the canonical home for long-form business context, architecture context, runtime notes, and /v1 snapshot-contract / web-app knowledge. Repo prose should stay short and practical, not compete with that source of truth.
Humans can discover that Notion home from the tracked link in `README.md` under `Notion Home`. `AGENTS.local.md` is for local machine-readable UUID pointers and override resolution, not the only route to find project context.

## Core principles — the 6 mechanical guarantees

1. **Sessions row exists at session start** — SessionStart hook
2. **Sessions row backfilled on first prompt if SessionStart missed** — UserPromptSubmit hook
3. **Sessions row gets transcript artifact + summary at stop** — Stop hook
4. **No surgical Notion edits (Rule 2)** — PreToolUse hook
5. **Refuse placeholder Notion config (Rule 6)** — PreToolUse hook
6. **Cross-tool parity** — Claude and Codex use the same wrapper contract; Codex dispatchers must use nested hook blocks and preserve PreToolUse exit codes

Everything else is instruction + AI nudge — user decides.

## Notion subtree shape

```text
<root_page_id> ("Transit")
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

Global Vocabulary lives at a workspace-shared page referenced by `vocabulary_page_id` — same UUID across every project.

## Notion integration architecture

Two distinct paths — pick by **caller**, not by tool name.

### `notion_conversation` (interactive / agentic)
- hosted Notion MCP at `https://mcp.notion.com/mcp`
- OAuth through the active AI tool
- use for browsing, search, page creation, database scaffolding, and workflow actions

### `notion_automation` (headless / hooks / CI)
- direct Notion REST API via token auth
- auth source: `NOTION_INTEGRATION_TOKEN`
- use for hooks, transcript sync, deterministic writes, and recovery

## Retrieval priority

1. hosted MCP `notion-query-data-sources`
2. hosted MCP `notion-fetch`
3. hosted MCP `notion-search`
4. direct REST fallback if hosted MCP is unavailable or failing

## Canonical-language warning

Transit uses the word **canonical** in two different ways:

- **workflow-overlord Canonical** = Notion workflow state (`Roadmap`, `Slices`, `Sessions`, `Transcript Chunks`)
- **data-model canonical** = normalized GTFS / GTFS-RT relational model in the app, especially Silver-layer tables

Do not mix them up.

## AI nudge contract

The AI MUST nudge the user about available tools at every optional juncture. Same format every time:

> *Reminder: tools available — `superpowers:brainstorming`, `superpowers:writing-plans`, `superpowers:test-driven-development`, `superpowers:systematic-debugging`, `superpowers:verification-before-completion`, `superpowers:requesting-code-review`. Invoke any (or none) — your call.*

Never recommend, never personalize, never auto-invoke. User decides.

## Zero-drift invariant

Every piece of workflow state has exactly one canonical location. For Transit, that migration is already done enough that repo prose is no longer a fallback knowledge base. If rich context matters, go to Notion first.

## Stack-specific notes

- **Runtime:** Python 3.12
- **Core infra:** Oracle VM Postgres + Docker Compose, Cloudflare R2, Caddy, GitHub Actions, SvelteKit web app on Cloudflare (web/)
- **Realtime cadence:** current runtime behavior lives in Notion → `Architecture` → `Runtime / Operations`
- **Serving artifacts:** the /v1 R2 snapshot contract (bucket transit-snapshots) feeds web/; keep design/semantic explanations, validation notes, and portfolio framing in Notion
