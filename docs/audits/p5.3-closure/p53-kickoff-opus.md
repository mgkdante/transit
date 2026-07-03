# P5.3 IMPLEMENTATION KICKOFF — Opus 4.8, execution only

You are implementing P5.3a→e for transit (STM analytics, transit.yesid.dev). **Every decision is
already made.** Your sources, in precedence order:
1. **The CLOSURE SPEC** — Notion page `3923e863069081f084f9c8bf417b1040`, sections §C0–§C11 (appended
   after the master plan §0–§17). Where spec and plan conflict, the spec wins.
2. The evidence reports at `docs/audits/p5.3-closure/` (branch `docs/p5.3-closure`) — the vibe
   kill tables you execute in P5.3d are the six `vibe-*.md` + `spacing-type-census.md`, with per-hit
   file:line dispositions. `yesid-visual-spec.md` holds every measured value you build to.
3. CLAUDE.md / AGENTS.md for workflow mechanics.

Do NOT redesign, re-audit, or re-litigate. If something is genuinely undecidable (a real conflict
between two spec rules, a new token, a brand-level visual judgment), STOP that thread, append a
one-paragraph framing to `FABLE-QUESTIONS.md` at the branch root, take the most conservative
reversible interim, and continue. The file should end the program EMPTY — treat every addition as a
minor failure.

## Slice loop (fixed order: a → b → c → d → e; one slice per fresh session if context gets long)
For each slice: merge the `docs/p5.3-closure` branch content if not yet on main → fresh branch off
main → implement the slice scope EXACTLY as §C9 defines it → local gates BEFORE any push (GHA budget
law): `bun run test · check · lint · format:check · og:check · icons:check · tokens:build` +
`build` + git-diff-clean; db slice: `cd apps/db && uv run pytest tests -v` offline → ONE PR
(P5.3e: one web PR + one db PR) → merge on green → close the slice in Notion with a Handoff → next.
P5.3a additionally starts with the design-repo v0.3.0 bump in `../yesid.dev-design` (scope FROZEN
per §C4: glow basis + space.page-x + tap-press snippet + drift register 6→2), tag, then
`bun tools/design-sync.ts --tag v0.3.0` in transit and update the pin in `design-vendor.test.ts`.
NEVER hand-edit `apps/web/vendor/design`. `../yesid.dev` is READ-ONLY.

## Verification matrix (every slice, non-negotiable)
- Browser (real, via Chrome MCP): every touched surface × {en, fr} × {dark, light} × {1512w, 390w}.
  390px = the iframe harness trick if resize is a no-op (see docs/audits/p5.3-closure/
  mobile-browser-pass.md). Screenshots in the PR.
- B3 sticky audit wherever anything sticks: engaged sticky → gap to pill ≤8px hairline, never a
  content-colored void. P5.3a: named before/after shots of the three formerly-floating rails
  (network, hotspots, repeat-offenders).
- axe + keyboard walk on touched surfaces; PRM emulation → motion-gated silence.
- P5.3d adds: zero remaining `border-l` stripe hits, FORBIDDEN guard green with EMPTY allowlists,
  tap-target sweep ≥44px on the six §C4-P10 components, stop-detail tab strip scrolls at 390px.
- P5.3e adds: GC2 fixture test green (cross-midnight universe match), targeted rollup rebuild
  verified on a night route in prod output, backfill prod check logged in the PR.

## Agent routing (plan §17 — hard law)
sonnet for mechanical sweeps (kill-table execution, offset-var substitution, grep audits, screenshot
runs); opus (effort high where it helps) for composition (NavPill, TerminalPanel, DetailTemplate,
ArticleShell) and browser-judgment passes. NEVER dispatch fable. If agent dispatch hits a spend
limit: reduce concurrency to batches of 2–3 first; if it persists, fall back to inline main-loop
work. Chart-mark internals under `dataviz/chart/marks/` are FROZEN — the sweep never touches them.

## Definition of done (the program, not a slice)
All §C11 boxes checked · convergence audit re-run clean · every §C5 surface ruling implemented ·
zero STORY-BARE metrics (§C6 acceptance) · FABLE-QUESTIONS.md empty · all five slices closed in
Notion with Handoffs · main green.
