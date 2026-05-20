# CLAUDE.md — transit (Claude Code entry point)

> **Read [AGENTS.md](AGENTS.md) first.** Workflow contract lives there — tool-agnostic, shared with Codex.

## Project context

- **Project:** Transit — STM transit operations analytics pipeline
- **Stack:** Python 3.12 · Neon · Cloudflare R2 · Railway · GitHub Actions · Power BI
- **Workflow:** workflow-overlord 3.x plugin (Notion-backed shared state)

## Where context lives

Business / Architecture / Vocabulary / Roadmap / Slices / Sessions / Transcript Chunks live in the Transit Notion subtree referenced by `AGENTS.local.md`. Interactive work uses the hosted Notion MCP first; hooks and automation use direct REST. Repo stays lean — Notion is canonical for workflow content.

## Build commands

- `uv sync` — install dependencies
- `uv run pytest tests -v` — run tests
- `uv run transit-ops show-config` — print safe config summary
- `uv run python -m transit_ops.cli db-test` — database connectivity check
- `uv run python -m transit_ops.cli run-static-pipeline stm` — run the static pipeline
- `uv run python -m transit_ops.cli run-realtime-cycle stm` — run one realtime cycle

## Workflow commands

- `/workflow-overlord` — orchestrator
- `/workflow-overlord-roadmap-open <SUMMARY>` — create a roadmap row
- `/workflow-overlord-slice-open <SUMMARY>` — create a slice
- `/workflow-overlord-slice-pick <slice>` — attach slice to current session
- `/workflow-overlord-slice-implement` — work the attached slice plan
- `/workflow-overlord-slice-close <slice>` — finalize a slice
- `/workflow-overlord-status` — read-only status

The workflow-overlord hooks provide the mechanical guarantees. Codex uses the same repo hook wrappers through `.codex/hooks/*.sh` plus config-layer dispatchers.

## Portability

This file can be deleted without breaking the workflow — Codex runs off `AGENTS.md` alone. `CLAUDE.md` exists only for Claude Code's auto-load convention.
