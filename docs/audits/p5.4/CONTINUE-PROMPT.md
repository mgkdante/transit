# P5.4 BEAUTIFY — CONTINUATION PROMPT (paste into a fresh Opus 4.8 session)

> Copy everything between the lines into the new session. It is self-contained; it points at
> in-repo docs (committed), not this session's scratchpad.

---

You are continuing the **P5.4 beautify program** for transit (STM analytics, transit.yesid.dev), a
SvelteKit app under `apps/web`. This is execution work driven by operator feedback. **Run on Opus 4.8
as the main loop; use ultracode (Workflow tool) with model-routed agents.** Read these first, in order:

1. `docs/audits/p5.4/p5.4-plan.md` — the phase specs for the remaining work (P5.4b→e) + all operator
   decisions. AUTHORITATIVE.
2. `docs/audits/p5.4/reuse-audit.md` — the component reuse audit (transit vs yesid.dev vs the shared
   design system). This is the promotion roadmap and the source of every P5.4 component verdict.
3. `docs/audits/p5.3-closure/p53-closure-spec.md` — the P5.3 closure spec (§C1 measured yesid values,
   §C-laws) that P5.4 builds on.

## Where things stand
- Branch: **`slice/p5.3e-truth-fitness`** (stacked, LOCAL — nothing pushed; the operator owns the
  merge). It holds P5.3a–e + feedback-1 (LeftRail removed, dev proxy, a11y) + the nav batch (Transit
  wordmark, Yesid→burger, flat menu) + **P5.4a** (one Masthead header family site-wide,
  VerticalSectionTitle edge-letters deleted; **the TerminalPanel signal-head lights are KEPT** — the
  operator reversed the earlier dot-removal, do NOT remove them). Check out this branch and continue.
  Tip commit at handoff: **905dc6b** (verify with `git log --oneline -5`).
  NOTE: P5.4a's browser-verify lane was blocked (Chrome extension unreachable) — invariants were
  confirmed via SSR+source, but a live browser pass on all surfaces is owed. Do a `bun run dev`
  visual sweep EARLY in the new session (real routes are `/lines/24`, `/stops/<id>` — not
  `/line/`, `/stop/51234`), then proceed with P5.4b.
- Run locally for review: **`cd apps/web && bun run dev`** — `.env` is `PUBLIC_V1_BASE=/data/v1`
  (gitignored), which routes through the existing vite proxy to prod data same-origin (no CORS).
- Component-layer decision (operator, locked): **build transit-local NOW, promotion-ready**
  (token-driven, app-agnostic, no app-conditionals, clean props) — do NOT stand up the `@yesid/ui-*`
  packages this program; that cross-repo extraction + yesid.dev migration is a separate later session.
  The reuse-audit is the roadmap for it.

## Remaining phases (run them in order, chain automatically, don't stop for approval between phases)
- **P5.4b — Home dispatcher redesign.** Full redesign of `/` as a launchpad/dispatcher: reorganize the
  cards-to-other-pages, centralize, scale type, leverage the reclaimed real estate (LeftRail is gone),
  within yesid.dev branding, using the new Masthead. Do real web research on dispatcher/launchpad/
  bento styling patterns (ultracode). Remove the PWA/apple install prompt if present. Checkpoint-worthy.
- **P5.4c — DetailShell + metrics/status port.** Build ONE faithful `DetailShell` (full-bleed header
  band + hazard separator + 3-col grid `1fr 2fr 1fr` @1024 + `observeActiveToc` + `TocPill` + optional
  `CtaBand`) porting the REAL yesid `projects/[slug]`/`blog/[slug]` architecture (read it in
  `../yesid.dev`, READ-ONLY). Re-seat **metrics** + **status** onto it, deleting MetricsExplainer's
  hand-inlined grid + all its hardcoding. **Delete `layout/DetailTemplate.svelte`** (hollow lookalike).
  This is the "metrics/status must be a real copy of projects" mandate — operator called it super
  important.
- **P5.4d — SurfaceRail + ScheduleTable.** Build `SurfaceRail` = GrainPicker + a ported `FilterGroup`
  (from yesid) + `TocNav`, a **sticky LEFT rail** (`top: var(--chrome-offset)`) that REPLACES the ugly
  floating top grain/granularity bar + the 5 per-feature filter reimplementations. Apply to
  line-reliability, stop-reliability, network, hotspots, alerts. Build one `ScheduleTable` (grid +
  board modes) and apply to stop schedule + line schedule + next-departures board — **schedules render
  as a table everywhere** (operator mandate).
- **P5.4e — Per-surface beauty + tooltips + edge-to-edge + convergence.** Beautify pass on every
  surface leveraging the reclaimed real estate (centralize, more geometric/"tetris", less scattered,
  bigger type where it earns it) across lines/line-detail/stops/stop-detail/network/hotspots/receipt/
  repeat-offenders/alerts + light trip/search/map. Tooltip clarity pass (in-place explanation +
  tooltip-as-jump; GrainPicker grain/sub-grain tip is the known weak spot). Normalize edge-to-edge.
  Full-site convergence audit (battery × 16 surfaces × {en,fr} × {dark,light} × {1512,390}). Write
  `docs/audits/p5.4/promotion-roadmap.md` (the @yesid/ui-* extraction plan from the reuse audit).

## Hard laws (every phase)
- NEVER hand-edit `apps/web/vendor/design`. NEVER touch `apps/web/src/lib/components/dataviz/chart/marks/*`
  (P5.2-frozen). `../yesid.dev` is READ-ONLY reference. **Zero `apps/db` changes** (P5.4 is web-only).
- Keep the operator-APPROVED elements byte-unchanged: pill nav, blueprint grid, sticky-flush, motion,
  glow. The amber `#FFB627` "Stops near me" is the ONE conversion CTA — no other yellow.
- Values = tokens or the §C1 measured yesid values. `en`+`fr` for ALL copy (BilingualLabel).
- The FORBIDDEN style guard + chartDoctrine + brand gates stay GREEN with EMPTY allowlists.
- **Do NOT push / open PRs / merge.** Local commits on the branch only. Leave the gitignored
  `.env`/`workerd.log` alone.

## Per-phase protocol (the pattern that's been working)
Each phase = one Workflow: sequential **single-writer** implement stages (so the whole-app edits never
collide) → parallel **verify** (battery on sonnet · 16-surface browser check on opus via `bun run dev`
+ the iframe-390 harness · adversarial diff review on opus-high) → conditional **fix** round. Local
gate battery before every commit: `bun run test && check && lint && format:check && og:check &&
icons:check && tokens:build` (tree must stay clean) `&& build`. Agent routing: **sonnet** for
mechanical lanes, **opus (effort high)** for composition + browser judgment + review. **NEVER dispatch
a fable agent.** Report each phase's outcome to the operator; chain to the next automatically.

## Definition of done
All four phases implemented + green + adversarially SHIP'd; every surface beautified and edge-to-edge;
metrics+status on the real detail architecture; grain/filters in a left rail everywhere; schedules in
tables; tooltips clear; convergence audit clean; the promotion-roadmap doc written. Then hand the
operator an ordered review guide (how to run it, per-surface what-changed / what-to-scrutinize) — the
operator does a holistic pass and returns feedback for the next round.

---
