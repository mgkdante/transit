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

## Find the current work

- Start at [Current status and dependencies](https://www.notion.so/3eb3e8630690812b8f41c682e15ffb21).
  The [Phase 3.2 Plan](https://www.notion.so/3d93e863069081f686cecb4f20f784e1)
  retains the full original acceptance and historical evidence.
- Long-form guides live in [Notion](https://www.notion.so/3663e8630690809891abd71e03b57254).
  [Guide index and source archive](https://www.notion.so/3eb3e863069081beb5d3ed7c1cf7e68b)
  maps the migrated repository documents to their knowledge owners.
- Resolve workflow configuration using AGENTS.override.md > AGENTS.local.md >
  AGENTS.md. Use the exact CODEX_THREAD_ID to find the Sessions row and its Slice
  relation. Preserve existing relations; never infer attachment from Git.
- Read the selected slice's Plan/Handoff and ancestor context. Use hosted Notion
  MCP interactively; if it fails, use the installed workflow-overlord REST helper.
  Preserve native files and child pages on replacement and verify readback.

## Execute the authorized scope

- Primary and successor owners use gpt-6-astra with ultra reasoning. Verify via
  supported APIs. Explicitly choose bounded workers: gpt-6-luna for routine work,
  gpt-6.1-sol for substantial implementation/review, Astra for demonstrated need.
  Verify worker findings. No orchestrator fallback or arbitrary token budget.
- Routine plans, implementation and finite session continuation are authorized
  without repeated approval prompts. Actual missing access, new scope and
  publishing gates still apply. Keep one canonical writer and at most one ready
  successor. A succession marker must verify exact owner/source/goal/readback
  before the successor writes; elapsed time grants no authority.
- Keep context narrow, reuse accepted evidence and consolidate persistence.
  Put plans, progress and long-form documentation in Notion. Retain agent
  instructions and required executable/runtime/license/vendor assets here.
- No local Docker on Windows/WSL. Preserve private and unrelated material;
  never stage everything with git add -A. Never edit Codex state/SQLite or bypass
  approval controls. Verify applicable checks and distinguish local, hosted,
  deployed, physical-device/AT, account and owner evidence.
- Full M3 independent acceptance precedes M4. Parent Roadmap acceptance is
  independent of linked slice statuses. Preserve the current DOC, MAP, motion,
  AT/device and external-access dispositions in the current-status page.
- Vendored design is immutable; adopt an exact external release with its manifest.
  Product versions and commands belong to their executable configuration owners.
