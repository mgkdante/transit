# P5.3 Master Plan — Full Extract

**Access method:** Hosted Notion MCP (`mcp__…__notion-fetch`) succeeded on first call despite the session-level OAuth warning. No REST fallback needed. Fetched page id `3923e863069081f084f9c8bf417b1040`.

**Page identity**
- Title: *P5.3 · beautification — visual-direction DECISIONS (awaiting operator approval)*
- URL: https://app.notion.com/p/3923e863069081f084f9c8bf417b1040
- Type: page (a row in the **Slices** database, `collection://eefb581b-4610-4fa6-aed1-6318f2969028`)
- Status property: **planned**
- Parent Roadmap: https://app.notion.com/p/3873e86306908140a710c4eb033b2ba5
- PR link: (empty)
- Ancestry: Slices DB → … → Transit root page.
- **Child pages:** none. This is a leaf slice page; the entire plan lives inline in the page body. No recursion into child pages was possible/needed.

**Page-property Summary (verbatim from Notion `Summary` field):**
> Phase 5 sub-phase 3. The visual-direction DECISIONS doc is DRAFTED (in this page body) from the browser+code study of yesid.dev vs every transit surface — per the operator gate, NO implementation starts until the operator approves/edits it. Headline direction: bring yesid's THEATRE to the data without slowing the data down — floating pill nav, blueprint-grid texture, terminal-chrome heroes, display-type page heads + vertical section titles, Tier-1 motion wiring (boop/pressBounce/cursorGlow/magnetic; NO scroll-jacking on data surfaces), detail-page rhythm, selective metro-connected chips. Brand-level changes land in yesid.dev-design as v0.3.0+ and cascade via design-sync bumps; everything visible is transit-local composition. Proposes shrinking the P5.1 token-override register 6→2 (adopt --glow shadows + page-x gutter). Four slices: P5.3a chrome+texture · P5.3b hero theatre · P5.3c motion+micro-polish · P5.3d long-tail surfaces. 4 open questions for the operator in the doc.

---

# P5.3 — BEAUTIFICATION MASTER PLAN (Fable-5 hard pass → Opus 4.8 implements)

> Planned 2026-07-03 on Fable 5 (operator budget constraint: Fable reserved for hard decisions only). Sources: yesid.dev production study (home · /projects · /projects/yesid-dev) + transit main `2273280` (post-P5.2 #196) + the operator directive of 2026-07-03. **Every hard decision is MADE below — the implementing session (fresh, Opus 4.8) executes; anything genuinely undecidable goes on a FABLE-QUESTIONS list instead of being guessed.**

## 0. Mission + non-negotiables
Same look and feel as yesid.dev — one brand, two surfaces, visible continuity — at dashboard speed. Carried rules:
- yesid.dev repo READ-ONLY
- brand-level changes land in `../yesid.dev-design` as v0.3.0+ and cascade via `bun tools/design-sync.ts --tag <next>` (never hand-edit vendor/)
- no app-conditionals in packages
- chartDoctrine + brand gates stay green, allowlists EMPTY (only the named FORBIDDEN additions in §8)
- en+fr + AA every slice
- browser-verify everything
- zero apps/db changes
- P5.2 chart marks are FROZEN internally (beautify frames/tokens around them, never mark internals).

## 1. The design-language contract (what "same look & feel" means, mechanically)
1. **Blueprint-grid board** — full-page grid texture (`--grid-line-major/minor`, `--grid-block-marker`, `--grid-glow` exist in the base); LIGHT MODE BOLDER than dark (yesid round-3 rule).
2. **Floating pill nav** — detached rounded pill, centered, `--shadow-nav`; content scrolls under it edge-to-edge.
3. **Corner marginalia** — mono micro-copy pinned at hero-zone corners (page meta, honest stats, crosshair ornament).
4. **Giant condensed display type** — `--text-display/hero` page titles + orange terminal dot; vertical rotated section titles ≥xl.
5. **Terminal chrome** on HERO panels (titlebar dots + 2px `--border-rule` chassis + mono footer readouts); orange-hairline rounded-xl cards elsewhere.
6. **Glow language** everywhere it belongs (`--shadow-glow-sm/md/lg`, `--shadow-card/section/nav`; today transit uses ONE button hover). Glow never text.
7. **Hazard tape** (have ✓ — align rhythm).
8. **Numbered section chips** 01/02/03 + ToC numbers + `SEC n/m` progress readout.
9. **The 3-column detail template** (left ToC+context rail · numbered collapsible center · right stat-card rail) — yesid /projects/[slug] anatomy.
10. **Metro-line connected chips** where sequence is REAL only.

## 2. Workstream A — Full-bleed shell + chrome
- **A1 Full-bleed law:** `layout/Surface.svelte` drops boxed `max-width: var(--container-wide|content)`; chrome bands (nav/hero/section heads/tape/rails) run edge-to-edge; content lanes use `padding-inline: var(--space-page-x)`; `--container-content` survives ONLY as the prose column inside ArticleShell. Audit + kill every boxed `max-w` in routes/features.
- **A2 Pill nav:** rebuild `shell/TopBar.svelte` → fixed floating pill: wordmark(+wordmarkHover ✓) · Map/Lines/Stops/Network · search (≥lg compact in-pill field; below: icon→sheet) · lang/theme · hamburger→Audit group. Keep a slimmer quick-nav rail ≥xl styled as a floating pill column (same shadow family); Audit group folds into the pill menu.
- **A3 Blueprint grid** on the page background, dark+light (light bolder).
- **A4 `brand/CornerMeta.svelte`** — new primitive: 4 corner slots, mono `--text-micro`, aria-hidden, hero zones only (home, detail heads, metrics); feed REAL data (provider · generated_utc · route counts).

## 3. Workstream B — THE STICKY/OFFSET SYSTEM (the padding complaint)
Magic `5.5rem` offset is hardcoded in 6 files:
- `layout/RailLayout.svelte`
- `layout/ControlsRail.svelte`
- `features/metrics/MetricsExplainer.svelte`
- `features/lines/reliability/RouteReliabilityClusters.svelte`
- `features/health/sections/SectionConformance.svelte`
- `features/network/reliability/sections/SectionCrowdingByDay.svelte`

- **B1:** ONE shell-owned `--chrome-offset` (pill height + gap); every sticky uses `top: var(--chrome-offset)`. Delete all literals.
- **B2:** stuck-state = FLUSH: hairline + backdrop-blur tight under the pill — no dead padding band (IntersectionObserver stuck-state class swap; patterns exist in the codebase).
- **B3 Acceptance:** on every surface, engaged sticky → gap to pill ≤ 8px hairline, never a content-colored void.

## 4. Workstream C — Template continuity
- **C1 Detail template** (compose from transit primitives; NO yesid code imports): 3-col ≥xl — left: On-this-page ToC w/ numbered chips + `SEC n/m` + context cards · center: numbered collapsible sections (default-closed = the S10 quiet contract, which already mirrors this exact yesid page) · right: Overview/Impact-style stat cards. **Apply to `/metrics`** (right rail: Provenance/Coverage/Freshness) **and `/data-health`** (right rail: feed stat cards).
- **C2 `ArticleShell`** — kicker → display title → lede → meta row → tape → full-bleed chrome w/ `--container-content` prose lane; yesid inline-mono accent styling. For prose-heavy surfaces + any future articles.
- **C3 Detail heads** (line/stop/trip): breadcrumb → giant display id + dot → meta chips → tape (≈70% there; align type + spacing to template rhythm).

## 5. Workstream D — Theatre
- **D1** Display-type page head on EVERY surface (one per page) with the dot.
- **D2** Vertical section titles ≥xl on /network, /lines/[id], /metrics — **localized FR** («Réseau.», «Fiabilité.», «Mesure.»).
- **D3** `brand/TerminalPanel.svelte` (new, token-built): frame the network control-room, line verdict, stop next-departures, /status pipeline board.
- **D4** Numbered section chips + ToC numbers site-wide where sections exist.

## 6. Workstream E — Glows
- **E1** Cards: `--shadow-card` at rest; interactive cards hover `-translate-y-px` + `--shadow-glow-sm` (matches shipped button behavior).
- **E2** Hero/terminal panels: `--shadow-section` + `cursorGlow`.
- **E3** Pill: `--shadow-nav`. Glow-as-text-shadow BANNED.
- **E4 FIRST ACTION OF P5.3a:** design repo override reconciliation → tag **v0.3.0** (adopt base `--glow` shadow basis + `space.page-x` 1.5rem; add the documented `.tap-press/.tap-feedback` consumer snippet) → transit `design-sync --tag v0.3.0` → drift register 6→2 (keep `text.heading`, `text.micro`) → update the pin in `design-vendor.test.ts`.

## 7. Workstream F — Motion wiring (all vendored already)
`boop` → chips/badges/toggles · `pressBounce` + `.tap-press` (add utility to app.css hand region from the v0.3.0 snippet) → touch targets · `cursorGlow` → terminal panels + KPI tiles · `magnetic` → pill links + primary CTAs. **NO sectionMagnet/scroll-jacking.** PRM rides package policy. Acceptance: every interactive element ≤200ms tactile feedback; PRM silent (except SAFE-ALWAYS tier).

## 8. Workstream G — THE VIBE SWEEP
**Rule: every visual property = token + named pattern from this plan; else it dies.** Catalogued kills (main `2273280`):
- `features/health/sections/SectionGaps.svelte:44` left stripe `--dataviz-status-late` → StatusBadge/severity chip.
- `features/metrics/MetricsExplainer.svelte:1034` left stripe → numbered-chip section head (C1).
- `components/ui/alert/alert.svelte:68-82` severity left-stripes → severity chip + hairline card (redesign, no stripe).
- `components/shared/TocNav.svelte:147` + `features/map/MapNearMeControl.svelte:526` primary-mix left borders → yesid active-state (chip/underline).
- `features/map/MapHeadTitle.svelte:51` border-rule bar → D1 head treatment.
- SWEEP: grep `border-left|border-l-` + one-off `box-shadow`/`linear-gradient` in features → map to pattern or delete; ship `vibe-sweep.md` kill-list in the PR.

**GUARD:** after the sweep, extend transit's styleRegressions FORBIDDEN config (@yesid/gates preset consumer) with `border-left.*(dataviz|primary|accent|rule)` so the class can't return.

## 9. Workstream H — Wayfinding & story
- **H1** Per-surface narrative audit (overview → detail → diagnosis; "is my line ok now? → when is it bad? → why?"); reorder stuttering sections, document per surface.
- **H2** Same concept = same look everywhere (verdict chips, windows, grain rails) — post-P5.2 straggler sweep.
- **H3** Find-the-stat ≤2 hops: every home/network KPI links to its detail; every section head has its (i); search 1-tap from every page.
- **H4** Breadcrumbs + SEC n/m readouts on detail templates.

## 10. Workstream I — Label & spacing science
Mono overlines: `--tracking-eyebrow` + `--space-card-gap` rhythm · value↔label gap ≥0.35em · `tabular-nums` (✓ mostly) · `--space-section-y` between clusters, kill ad-hoc gap variance (tokenize to the 3-step space scale) · ≤3 text sizes per tile · no rotated labels (law ✓) · muted-foreground only non-load-bearing.

## 11. Slice packaging (each: fresh branch off main → ONE web PR → merge on green → Notion close)
- **P5.3a Foundation** = B + A1-A3 + E4 (v0.3.0 bump). Riskiest — before/after screenshots of EVERY surface.
- **P5.3b Templates** = C1-C3 + D4 + H4 (/metrics + /data-health re-seats + detail heads).
- **P5.3c Theatre** = D1-D3 + E1-E3 + F + A4.
- **P5.3d Sweep** = G + H1-H3 + I + the FORBIDDEN guard + convergence checklist re-run.

Order fixed a→d. If a slice grows past ~1 session, split at workstream boundaries, never mid-workstream.

## 12. Verification protocol (per slice)
1. Battery: `bun run test · check · lint · format:check · og:check · icons:check · tokens:build` + git-diff-clean · `build`.
2. Browser matrix: every touched surface × {en,fr} × {dark,light} × {1512w, 390w}; screenshots in the PR.
3. Sticky audit (B3) wherever a bar sticks.
4. axe + keyboard walk on touched surfaces.
5. PRM emulation → motion-gated silence.
6. `design-sync --check` + vendor tests after any bump.

## 13. Governance routing
- **yesid.dev-design v0.3.0:** ONLY the override reconciliation + tap-press consumer snippet (all other tokens exist). Never edit vendor/ by hand.
- **transit:** all composition (pill nav, TerminalPanel, CornerMeta, ArticleShell, grid, motion, sweeps).
- **yesid.dev:** untouched (flips later via FLIP-THE-SWITCH.md at the operator's hand).

## 14. Decisions LOCKED (formerly open questions)
1. Pill search: **hybrid** — in-pill compact field ≥lg, icon→sheet below.
2. Vertical titles: **localized FR**, short words.
3. Light-mode grid: **yesid-bold** (round-3).
4. Yellow-conversion CTA: **adopt ONE** — map "Stops near me" as the signage-pair CTA (accent ground / signage-bg ink), ≤1 per view. Operator may veto in review.

## 15. Escalation rule for the implementing session (Opus 4.8)
Do NOT burn operator budget on hard calls: if something is genuinely undecidable from this plan + the codebase (a conflict between two rules here, a visual judgment with brand-level consequences, any new token), STOP that thread, add it to a `FABLE-QUESTIONS.md` in the repo root of the branch, pick the most conservative reversible interim, and continue. The operator batches those to Fable 5 later.

## 16. Sequencing after P5.3 (operator-confirmed 2026-07-03)
**P5.4 → SEG** (segment spine: the ~500M-row per-stop prediction table mined — "where along the line the delay builds") → **MP** (multi-provider STO/OC onboarding on the GC2 capability flags) → **S16** (site-wide verification + **FR i18n audit + a11y + canon refresh**) → the publish conversation.

## 17. Intelligence routing (operator budget law — Fable ≈ $10 reserve)
The implementing session runs on **Opus 4.8** as the main loop. When it dispatches workflows/agents, it MUST route model + effort per lane — never default everything to the top tier:
- **haiku / sonnet-low:** mechanical sweeps and inventories — grep audits (max-w, border-left, gap variance), screenshot capture runs, file-list recons, formatting passes, i18n string extraction. Anything whose prompt fully determines the output.
- **sonnet (default effort):** repetitive multi-file edits from an exact pattern already decided here (offset-var substitution B1, tokenizing gap variance I, per-surface motion wiring F once the first surface is reviewed).
- **opus (inherit / high):** per-surface composition work (pill nav A2, TerminalPanel D3, detail template C1, ArticleShell C2), the adversarial review lanes, and the browser-verification judgment passes.
- **fable: NEVER dispatched by the session.** Fable is the operator's reserve. Anything undecidable lands in `FABLE-QUESTIONS.md` (§15) with a one-paragraph framing per question so the operator can batch them into ONE cheap Fable consult (answers-only, no re-reading the repo).
- Additionally: subagent dispatch may hit the account spend limit (it did on 2026-07-02) — if agents fail with a spend-limit error, fall back to inline main-loop work immediately instead of retrying.

---

## Analysis notes for the reader

### Workstream → slice mapping (from §11)
| Slice | Name | Contains |
|---|---|---|
| P5.3a | Foundation | B (offset/sticky) + A1–A3 (full-bleed law, pill nav, grid) + E4 (v0.3.0 design-repo bump) |
| P5.3b | Templates | C1–C3 (detail template, ArticleShell, detail heads) + D4 (numbered chips/ToC) + H4 (breadcrumbs + SEC n/m) |
| P5.3c | Theatre | D1–D3 (display heads, vertical titles, TerminalPanel) + E1–E3 (glows) + F (motion wiring) + A4 (CornerMeta) |
| P5.3d | Sweep | G (vibe sweep + FORBIDDEN guard) + H1–H3 (wayfinding) + I (label/spacing science) + convergence re-run |

### On "open questions"
The plan's original 4 open questions were RESOLVED before publish and now live in **§14 "Decisions LOCKED (formerly open questions)"** — so the doc as fetched contains **zero live TBDs**. The page-property Summary still says "4 open questions for the operator in the doc," but that is stale relative to §14 which shows all 4 as LOCKED. The nearest thing to remaining undecideds is the **§15 escalation mechanism** (a process, not a list): genuinely-undecidable items get parked in a to-be-created `FABLE-QUESTIONS.md` on the branch. There is no such list in this page yet. Item #4 (yellow-conversion CTA) is LOCKED but flagged "Operator may veto in review" — the one conditional/soft decision.

### The whole page IS the plan
No toggles, no sub-databases, no child pages. Content is a flat sequence of H1/H2 headings (§0–§17) plus one markdown table's worth of file lists rendered as bullet lists. Everything above is the complete, verbatim page body.
