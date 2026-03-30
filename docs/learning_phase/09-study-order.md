# 09 — Study Order

Study sequences for different personas and tool contexts. Each sequence
references documents in this learning pack.

---

## Persona A: New human developer (full study, ~5-6 hours)

Complete walkthrough with Cursor open. Builds deep understanding.

| Phase | Document | Time | What you learn |
|-------|----------|------|---------------|
| 1 | [01-runtime-topology](01-runtime-topology.md) | 30 min | What runs, when, where, and what talks to what |
| 2 | [02-python-ownership](02-python-ownership.md) | 20 min | Which module owns what — mental map of the codebase |
| 3 | [04-schema-usage-map](04-schema-usage-map.md) | 30 min | Every table, its grain, retention, and role |
| 4 | [05-business-logic-and-kpi-semantics](05-business-logic-and-kpi-semantics.md) | 40 min | The delay fallback chain, KPIs, null semantics |
| 5 | [06-cursor-reading-itinerary](06-cursor-reading-itinerary.md) | 4-5 hrs | Guided walkthrough of every important file |
| 6 | [03-command-traces](03-command-traces.md) | 20 min | End-to-end execution traces for all CLI commands |
| 7 | [07-query-drills.sql](07-query-drills.sql) | 45 min | Hands-on SQL drills against live Neon |
| 8 | [08-powerbi-consumption-rules](08-powerbi-consumption-rules.md) | 20 min | What Gold objects Power BI should consume |

**Study rules:**
- Do phases 1-4 before starting phase 5 (the Cursor walkthrough needs context)
- Phase 5 is the core — do not skip it
- Phase 7 requires a live Neon connection — run after business hours if the worker is active
- Answer every checkpoint question in phase 5 before moving on

---

## Persona B: AI tool context loading (NotebookLM, Claude, Codex)

Priority ordering for loading docs into an AI tool's context window.
Load in this order; stop when you hit the context limit.

| Priority | Document | Why first |
|----------|----------|-----------|
| 1 | [02-python-ownership](02-python-ownership.md) | Module map is essential for navigating any code question |
| 2 | [04-schema-usage-map](04-schema-usage-map.md) | Table definitions anchor SQL and data questions |
| 3 | [05-business-logic-and-kpi-semantics](05-business-logic-and-kpi-semantics.md) | Business rules are not derivable from code alone at a glance |
| 4 | [01-runtime-topology](01-runtime-topology.md) | Runtime context for understanding when things run |
| 5 | [03-command-traces](03-command-traces.md) | Execution flows for debugging or modification tasks |
| 6 | [08-powerbi-consumption-rules](08-powerbi-consumption-rules.md) | Only if working on dashboard |
| 7 | [07-query-drills.sql](07-query-drills.sql) | Only if running live queries |

**For NotebookLM specifically:** Load docs 1-5 as sources. That covers the
full pipeline understanding. Add 6-7 only when working on BI or data validation.

---

## Persona C: Cursor/Claude Code session (which docs to load first)

When starting a Claude Code or Cursor session on this repo:

### For pipeline/backend work
```
Read: docs/learning_phase/02-python-ownership.md
Read: docs/learning_phase/04-schema-usage-map.md
Read: docs/learning_phase/05-business-logic-and-kpi-semantics.md
```

### For Power BI / dashboard work
```
Read: docs/learning_phase/08-powerbi-consumption-rules.md
Read: docs/learning_phase/04-schema-usage-map.md
Read: powerbi/field-mapping.md
Read: powerbi/dax-measures.md
```

### For debugging a specific command
```
Read: docs/learning_phase/03-command-traces.md
Read: docs/learning_phase/02-python-ownership.md
```

### For understanding a specific table or query
```
Read: docs/learning_phase/04-schema-usage-map.md
Read: docs/learning_phase/05-business-logic-and-kpi-semantics.md
```

---

## Persona D: Quick reference card

One line per document. Pin this to your desk.

| # | Document | One-line summary |
|---|----------|-----------------|
| 01 | runtime-topology | What runs, when, where — Railway worker 30s, GH Actions daily, R2 + Neon |
| 02 | python-ownership | Module map — who owns what, who calls whom, what each file does NOT own |
| 03 | command-traces | 7 CLI commands traced end-to-end: tables touched, R2 ops, risk level |
| 04 | schema-usage-map | Every table: purpose, grain, PK, retention, hot/warm/cold role |
| 05 | business-logic-and-kpi-semantics | delay_seconds fallback chain, vehicle_id LATERAL, null semantics, KPIs |
| 06 | cursor-reading-itinerary | 9-phase guided code walkthrough with checkpoint questions |
| 07 | query-drills.sql | 13 SQL drills from schema discovery to delay fallback reproduction |
| 08 | powerbi-consumption-rules | What Power BI imports, relationship keys, delay caveats, forbidden patterns |
| 09 | study-order | This file — study sequences for different personas |

---

## Document dependency graph

```text
09-study-order (this file)
  └─ references all other docs

06-cursor-reading-itinerary
  ├─ assumes you read 01, 02 first
  └─ references 05 for delay fallback detail

05-business-logic-and-kpi-semantics
  └─ assumes you read 04 (schema) first

03-command-traces
  ├─ assumes you read 01 (runtime) and 02 (ownership)
  └─ references 04 (tables)

08-powerbi-consumption-rules
  ├─ assumes you read 04 (schema)
  └─ references 05 (delay semantics)

07-query-drills.sql
  └─ assumes you read 04 (schema) and 05 (semantics)

04-schema-usage-map
  └─ standalone (can be read first)

02-python-ownership
  └─ standalone (can be read first)

01-runtime-topology
  └─ standalone (can be read first)
```

Standalone entry points: 01, 02, 04.
Everything else depends on at least one of those three.
