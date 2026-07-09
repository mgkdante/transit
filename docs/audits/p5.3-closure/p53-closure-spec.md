# P5.3+ CLOSURE SPEC — the A++ finishing contract

> Authored by Fable 5, 2026-07-03, from the 31-lane understand fan-out (35 agents, 0 failures) over
> main `2273280` + live transit.yesid.dev + live yesid.dev. This APPENDS to the P5.3 master plan
> (§0–§17); where it conflicts with the plan body, THIS spec wins — every conflict below is a
> deliberate correction grounded in measured evidence. **Zero TBD survives. FABLE-QUESTIONS.md should
> end P5.3 empty.**
>
> Evidence reports (file:line-anchored) live in the repo at `docs/audits/p5.3-closure/` — committed on
> branch `docs/p5.3-closure`. Referenced throughout as [report-name].

---

## §C0. Decision register — everything is closed

Operator confirmations (2026-07-03, this session):
1. **Nav rail:** KEEP the left quick-nav rail ≥xl, restyled as a floating pill column (same `--shadow-nav` family). Pill-only rejected.
2. **Light-mode grid:** FULL yesid-bold, exact measured values (major 8% ink / minor 4% / block 6%), site-wide including chart surfaces. Safety comes from the solid-card occlusion law, not from a quieter grid.
3. **Yellow conversion CTA:** CONFIRMED — map "Stops near me" is THE one amber `#FFB627` signage-pair CTA (accent ground / `#1C1814` ink), ≤1 per view. No other yellow anywhere.
4. **#181 FR enum labels:** CONFIRMED as shipped — `severe='Sévère'`, `many_seats='Plusieurs places'`, `few_seats='Peu de places'`. Delete the "operator morning veto" comment block in `enumLabels.ts:9-13` (P5.3e hygiene).
5. **#181 resolveWindow:** CONFIRMED as shipped — whole-window drop on any invalid bound. Delete the veto flag comment at `filters/grain.ts:81-94` (P5.3e hygiene).

Closed on evidence (no operator input needed):
6. **T8 browser semantics pass: SATISFIED.** The prod browser lane verified stable domains across windows at 2007px on home/metrics/line-detail, zero regressions ([mobile-browser-pass]). Close the T8 task on the Notion slice plan.
7. **Web spec math: ALL SOUND** — share normalization, sparkDomain, otpTrendDomain, Wilson, and the /max doctrine sweep are verified clean by hand-recomputation ([math-web-specs]). No web math fixes exist.
8. **Pipeline math: 4/5 SOUND, 1 BUG** — the GC2 scheduled-universe denominator mismatch (§C7). Owned by the new P5.3e slice.
9. Plan §14's other two locks stand unchanged: pill search **hybrid**; vertical titles **localized FR**.

Fable rulings made in this spec (each with rationale at its section): nav-link text-shadow ban upheld (§C2.1) · scroll-container kept as `#main` (§C3) · backdrop-blur standardized 16px with a documented GL escape hatch (§C4 P4) · chart-mark internals exempt from the sweep (§C4 P8) · v0.3.0 scope frozen to plan-E4 (§C4 governance) · alerts section reorder (§C5) · stops idle-state content (§C5) · Zod stays (§C8) · slice e appended, order a→b→c→d→e (§C9).

---

## §C1. Measured yesid constants (the numbers Opus builds to)

From live yesid.dev prod, cross-checked to source; SOURCE authoritative on DPR sub-pixel disagreement. Full tables: [yesid-visual-spec].

**Nav pill:** height ≈71px intrinsic (44px min-h items + 12px×2 pad); padding 12px 28px desktop → 12px 20px compact → 8px 16px ≤767 → 6px 8px ≤479; radius `--radius-pill` 9999px; `backdrop-filter: blur(16px)`; border 2px `--border-brand` (= primary@45% dark / @60% light); bg `color-mix(--background 92%, transparent)`; shadow `--shadow-nav` = `0 4px 30px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.03)` (light: `0 4px 24px rgba(28,24,19,.1), 0 0 0 1px rgba(28,24,19,.04)`); root fixed at `top: calc(1rem + env(safe-area-inset-top))`, z 50 (menu-open 70); link gap 28px desktop/18px ≤767; divider 2×18px `--border-brand`, margin-inline 20px; link 15px/500, rest `--secondary-foreground`, active `--primary` + 3×3px amber dot at `bottom:4px`; wordmark 18px bold; every hit area ≥44px; **nav clearance 88px (5.5rem)** of top padding on non-full-bleed pages.

**Section rhythm:** home = viewport panels with 96px (`--space-section-y` cap) internal padding; detail = 40px block padding, 16px inter-section margin, 24–40px heading rhythm. Gutter `--space-page-x` = clamp(1.5rem, 4vw, 5rem). Card gap `--space-card-gap` = clamp(1rem, 2vw, 1.5rem).

**Cards:** radius 12px (`--radius-lg`); border 2px `--border-brand`, hover → `--border-brand-active` (primary@85%); bg `--surface-2` **SOLID hex always — alpha is forbidden on content surfaces so the grid never bleeds through** (the occlusion law); rest shadow = `inset 0 1px 0 var(--edge-highlight)` bevel ONLY; hover = `--shadow-section` (`0 8px 32px primary@6%`) + bevel; transition 200ms `--ease-default`.

**Blueprint grid** (5-layer repeating-linear-gradient on the root wrapper, alphas baked into `--grid-*` tokens): DARK — major 80px primary@6%, minor 16px foreground@2.5%, block 400px accent@4%. LIGHT — major 80px ink@8%, minor 16px ink@4%, block 400px brown@6%. 1px lines.

**Detail template (project variant — the one C1 adopts):** ≥1024 `grid-template-columns: 1fr 2fr 1fr`, gap 2rem, padding-block 2.5rem, rails sticky (yesid `top:5rem` → transit `top: var(--chrome-offset)`); mobile 1-col, side rails hidden/reflowed. Blog variant center cap `minmax(0, 46rem)` = the prose-page lane.

**Article measure:** prose `max-width: 72ch`; effective ~60ch inside a 46rem column; body 18px/1.9/foreground@55% desktop, 17px/1.8/@50% mobile; prose H2 24px/700, H3 20px/600.

**Glow philosophy:** NOTHING glows at rest except the nav pill (dark drop) + status LEDs (`rgba(224,120,0,.5) 0 0 4px 1px`, pulse to 10px). Hover affordances: cards `--shadow-section`; CTAs `--shadow-glow-sm` (`0 0 6px glow@30%`) + `translateY(-1px)`; conversion CTA amber `0 0 6px accent@35%`. Buttons: CTA radius 12px, pad 16px 32px, 19px/600.

---

## §C2. Component skeletons (build exactly these; transit-local composition, zero yesid code imports)

### C2.1 `shell/NavPill.svelte` (replaces TopBar.svelte — delete TopBar, don't wrap it)
Structure: fixed full-width `nav.nav-root` (top `calc(1rem + env(safe-area-inset-top))`, `z: var(--z-nav)`, flex center, pointer-events-none) → intrinsic-width pill (pointer-events-auto) with, in order: `BrandWordmark` (wordmarkHover kept) · divider · links **Map / Lines / Stops / Network** · divider · search (≥lg compact in-pill field; <lg icon → sheet — §14.1 hybrid) · divider · `LangSwitch` + `ThemeToggle` (44×44 each) · hamburger → menu.
Menu (the Audit group): Metrics, Status, Hotspots, Receipt, Repeat offenders, Alerts (+ Search on <lg). ≤767 it opens as a full-height sheet, ≥768 as a dropdown panel anchored `top: calc(100% + 8px)` to the pill — both `z: var(--z-nav)`+, both `.glass-chrome` (§C4 P4).
Props: none load-bearing (reads nav registry from `lib/content/nav.ts`; active from `$page`). Sets `--pill-h` on `:root` via CSS (per-breakpoint custom-property values, no JS measurement — the pill's height is deterministic per breakpoint: content 44px + 2·pad + 2·border).
Active state: `text-primary` + the 3×3 amber bottom dot. **NO text-shadow glow — plan §1.6 "glow never text" is upheld over yesid's own nav-link text-shadow; the dot + color carries the state.** (Rationale: the plan's law is self-consistent and gate-enforceable; carving a nav exemption would make the FORBIDDEN guard leaky on day one.)
Tests: rewrite `TopBar` tests → NavPill (structure, active dot, menu grouping, 44px hit areas, `--pill-h` set); LeftRail tests keep passing (rail survives).

### C2.2 `shell/LeftRail.svelte` (restyle, not rebuild)
≥xl only, floating pill COLUMN: same chassis family as the pill (2px `--border-brand`, bg mix 92%, blur 16px, `--shadow-nav`, radius `--radius-xl` 16px), anchored below the pill (`top: var(--chrome-offset)`), existing width/collapse/drag machinery untouched (`--app-left-rail-offset` system survives per [shell-deep-read]). Below xl: unchanged overlay behavior.

### C2.3 `brand/TerminalPanel.svelte` (new)
Chassis: 2px `--border-rule` border, radius `--radius-lg`, bg `--surface-2` SOLID; titlebar = 3 dots (existing TerminalChrome idiom) + mono `--text-micro` title + right meta slot; body slot; mono footer-readout slot (honest stats: n, window, generated_utc). Rest shadow `--shadow-section` + `cursorGlow` (E2 — hero panels are the sanctioned rest-glow exception alongside the pill). Props: `title`, `meta?`, `footer?` snippets + `children`. Consumers (P5.3c): network control-room head, line-detail §0 verdict, stop-detail next-departures, /status pipeline-lanes board. Absorbs/deprecates `brand/TerminalChrome.svelte` where they'd overlap — one terminal idiom, not two.

### C2.4 `brand/CornerMeta.svelte` (new)
4 absolute corner slots inside a `position:relative` hero zone; mono `--text-micro`, `--muted-foreground`, `aria-hidden="true"`, `pointer-events-none`, hidden <768. REAL data only (provider name · `generated_utc` · route/stop counts · build short-hash). Hero zones ONLY: home hero, detail heads (line/stop/trip), /metrics masthead. Never on dense data sections.

### C2.5 `layout/ArticleShell.svelte` (new)
Vertical: kicker (mono overline) → display title + orange terminal dot → lede (46rem cap, `--text-body`→18px ≥1024, lh 1.9) → meta row (mono micro) → hazard tape → content region: full-bleed chrome allowed, prose lane capped `--container-content`/72ch. This is where `--container-content` SURVIVES after A1 strips it from `Surface` (plan A1). Consumers: /metrics masthead + prose blocks, /status preamble, any future article.

### C2.6 The detail template (C1) — composition recipe, not one component
`layout/DetailTemplate.svelte` (thin grid shell): ≥xl `1fr 2fr 1fr` gap 2rem; left = numbered ToC (existing TocNav + chips) + `SEC n/m` readout + context cards, sticky `top: var(--chrome-offset)`; center = numbered collapsible sections (S10 quiet contract as-is); right = stat-card rail, sticky same. Mobile: single column; ToC becomes the existing floating TocPill; right-rail cards collapse to a top summary strip (NOT dropped — mobile keeps the stats, order: head → summary strip → sections). Apply: **/metrics** (right rail: Provenance / Coverage / Freshness cards) and **/status** (right rail: per-feed stat cards).

### C2.7 `SectionHeading` law (site-wide, P5.3b)
The existing-but-unused `SectionHeading` primitive becomes the ONLY section-title renderer: real `<h2>`/`<h3>` + numbered chip (D4) + optional (i) + `SectionLabel` demoted to the overline INSIDE it. Kills the flat-outline defect on 8 surfaces (network, status, hotspots, receipt, repeat-offenders, alerts, stop detail, trip — [anatomy-*]). Acceptance: every surface has a real h1→h2(→h3) outline, axe heading-order clean.

---

## §C3. Workstream B corrected — the offset system as it actually is

Ground truth ([shell-deep-read]): **`--chrome-offset` does not exist anywhere.** Vertical offset today = three disjoint systems: hardcoded `5.5rem`/`5rem`/`7rem` literals, an UNSET `--nav-height` with a 64px fallback (real TopBar is 60px — already lying by 4px), and per-surface `--rail-sticky-top` overrides. Three surfaces (network, hotspots, repeat-offenders) ship a live ~88px sticky-float bug from this today.

**B1 (amended).** Create the single knob in AppShell:
`--chrome-offset: calc(1rem + env(safe-area-inset-top) + var(--pill-h) + 0.5rem)`.
Every sticky uses `top: var(--chrome-offset)`; global `[id] { scroll-margin-top: calc(var(--chrome-offset) + 0.5rem) }` replaces every anchor-offset hack. DELETE: all `5.5rem`/`5rem`/`7rem` offset literals, the `--nav-height` variable entirely, and every per-surface `--rail-sticky-top` override (the three float bugs die by construction). Non-full-bleed pages top-pad `var(--chrome-offset)` (the yesid `--nav-clearance` analog).
File list (plan's 6 was incomplete — census found ~12): RailLayout, ControlsRail, MetricsExplainer (sticky + scroll-margin + 100dvh calc), RouteReliabilityClusters, SectionConformance, SectionCrowdingByDay, `app.css:535`, ReliabilityFilterPill, TocPill, search anchor `--nav-height` use, RepeatOffenders/Hotspots rails (inherit fix), stop-detail rails.

**Scroll-container ruling:** KEEP `#main` as the scroll container. Rationale: the pill is `position:fixed` (viewport-anchored) and `#main` starts at the viewport top once the TopBar band is deleted, so viewport-derived and container-derived offsets coincide; moving scroll to the window would force an AppShell flex/overflow rewrite and re-derivation of the `:has(.map-hero)` full-bleed geometry for zero visual gain. The pill floats OVER `#main`'s content; content scrolls under it edge-to-edge (A1 satisfied).

B2 (flush stuck-state) and B3 (≤8px acceptance) stand as planned. Add to B3: the three formerly-floating rails get explicit before/after screenshots.

---

## §C4. The vibe kill-list — ~1,410 hits → 12 named dispositions

Census totals: routes ~96 · ui/dataviz primitives ~150 · shell/layout ~215 · map+lines ~520 · remaining features ~427 · data layer 2. Colors are already token-pure everywhere (zero hex leaks outside 2 meta tags + exempt Google wordmark). The debt is overwhelmingly **raw rem/px inside `<style>` blocks**. Full file:line tables with per-hit dispositions: the six [vibe-*] reports + [spacing-type-census]. The sweep executes THOSE tables; this section is the pattern law that governs them.

- **P1 TIGHT-GAP (≈128 hits + long tail; the single biggest).** The `{0.3, 0.35, 0.4, 0.45}rem` cluster is one missing token reinvented 128×. Disposition: snap to the quarter-step scale — 0.3/0.35/0.4/0.45 → **0.375rem**; 0.55/0.6/0.625 → **0.5rem** (or 0.75rem where the eye says the author meant "small", judged per-hit in the tables). NO new spacing token minted (plan-I "3-step space scale" upheld); quarter-steps of the existing Tailwind scale only.
- **P2 MOTION LITERALS (~40+ raw ms/beziers, ~24 WRONG `var()` fallbacks).** All raw durations/easings → `--duration-*`/`--ease-*`. New law: **NO `var(--x, fallback)` fallbacks in app code** — tokens.css is always loaded; fallbacks are where the ~24 lies live (e.g. `var(--duration-normal,180ms)` vs real 200ms). Delete every fallback.
- **P3 FOCUS-RING (~29 duplicate declarations).** app.css:280's global ring is canon. Delete local copies; standardize `outline-offset: 2px`. No new utility needed — this is a deletion pass.
- **P4 GLASS CHROME.** One `.glass-chrome` utility in app.css: `backdrop-filter: blur(16px) saturate(1.1)` + 1px hairline + pill/xl radius context. Map overlay family currently drifts 8/10/12px: standardize to 16px; **if browser-verify shows GL jank on /map, the map family may drop to blur(12px) as a documented exception in the PR — the only sanctioned deviation.**
- **P5 Z-SCALE.** Shell literals (TopBar 45/55/65, AppShell 32, MapStage 12) → `--z-*` tokens. The intra-map overlay band (1–32) becomes a documented local `MAP_Z` const module — deliberately NOT tokens (map-internal stacking, meaningless outside the canvas), capped under `--z-nav`.
- **P6 RADIUS.** `999px`/`9999px` literals → `--radius-pill`. `rounded-[min(...)]` control clamps stay (functional, not vibe).
- **P7 STRIPES DIE.** Plan-G's catalogued left-stripe kills + census additions (3 in ui/alert, 3 in map, 9 in map+lines, SectionGaps, MetricsExplainer, TocNav, MapNearMeControl, MapHeadTitle) — all → StatusBadge/severity chip/numbered-chip/active-chip per plan G. Zero stripes survive.
- **P8 CHART-MARK EXEMPTION.** The ~28 stroke-width/dasharray literals inside `dataviz/chart/marks/*` are **FROZEN with P5.2 mark internals — excluded from the sweep**. Parked as the `--chart-stroke-*`/`--chart-dash-*` candidate for a future chart-lib pass (post-S16). The sweep must not touch mark internals to chase token purity.
- **P9 THEME-COLOR META.** `stores/theme.svelte.ts:24-25` hardcoded `#141414`/`#F3F6FB` → read `--background` via `getComputedStyle` at boot (P5.3e hygiene; the file's own comment admits the duplication).
- **P10 TAP TARGETS (six shared components, [mobile-browser-pass]).** Transit-local `--size-tap-min: 44px`. Fixes: MetricInfo (i) keeps the 17px glyph but gets a 44px hit area (padding + negative margin); tab strips (stop-detail, hotspots station-tabs, repeat-offenders) → ≥44px + `overflow-x:auto` (kills the ONE real mobile overflow bug: stop-detail's clipped 4th tab at 390px); "View on map" chips 32→44px; combobox inputs/clear ≥44px; footer/inline links padding bump. Pill chrome icons ≥44px by construction (C2.1).
- **P11 BREAKPOINTS.** 760px/1023.98px drift → canonical 768/1024; matchMedia strings centralized in one module. No breakpoint tokens minted.
- **P12 TYPE SNAPS.** The 4 off-scale font-size arbitraries (button, badge, BrandCluster, TopBar→NavPill) → `text-micro`/scale; off-token letter-spacings → `--tracking-*`.

**Governance ruling (rule-of-three):** design-repo **v0.3.0 scope is FROZEN to plan-E4** — `--glow` shadow basis adoption, `space.page-x` 1.5rem, the `.tap-press` consumer snippet, drift register 6→2. Everything census-born (`.glass-chrome`, `--size-tap-min`, `MAP_Z`, chart-stroke scale) stays transit-local until a second app needs it. Never hand-edit vendor/.

**FORBIDDEN guard (P5.3d, extends the styleRegressions consumer config):**
1. `border-(left|l)-.*(dataviz|primary|accent|rule)` and CSS `border-left:.*var(--(dataviz|primary|accent|rule)` — stripes can't return.
2. Raw `\d+ms` in `.svelte` `<style>` transitions/animations (motion literals can't return).
3. `var\(--((duration|ease|radius|space)[a-z-]*),` — the no-fallback law is enforced, not aspirational.
4. `text-shadow:.*var\(--(glow|primary|accent)` — glow-never-text enforced.
Allowlists start and stay EMPTY.

---

## §C5. Per-surface rulings — section order + story, desktop AND mobile

Law for all 16: real heading outline via SectionHeading (§C2.7) · display-type head + dot (D1) · verdict beats specified below (H1) · every metric ≤2 hops from its explainer (H3) · sticky = `var(--chrome-offset)` · mobile = no horizontal scroll, ≥44px targets, charts legible or ScrollFrame'd. Anatomy evidence: [anatomy-<surface>].

1. **home** — Keep the 4-beat arc (hero → live pulse → thesis/pillars → explore). FIX: the 4 pulse KPIs get a verdict WORD from the existing `reliabilityVerdict.ts` floors (90/75) + tone color — the evidence dead-end closes; pulse absence upgraded from bare `emptyLabel` to `absentReason` (the flagship page must speak the site's own absence language); h1 gets `overflow-wrap` + the visual h1>h2 weight inversion fixed; CornerMeta on the hero (provider · generated_utc · counts). Mobile: already clean 1-col; (i) targets fixed by P10.
2. **map** — The non-scrolling 13-layer law stands; map stays **verdict-free by design** (its story is the drill; verdicts live on /network). FIX: MapSelectionDetail's three kind-branches each get an "Open full analysis →" exit link (line→/lines/[id], stop→/stop/[id], vehicle→/trip/[id]) — the walled garden opens; wire the 5 unlinked concepts (status, crowding, delay, ETA, staleness) to `metricInfoFor`; "Stops near me" becomes THE amber conversion CTA; chips ≥44px. Breakpoint drift dies (P11).
3. **lines** — Add a one-line network verdict band (reuse the line-§0 VerdictBanner primitive at network scope, from the same payload /network's headline uses) between head and grid; badge-less rows get the AbsentValue chip (doctrine gap closed); `isNoResults` wired; OTP/verdict (i) on the list header; ControlsRail `sticky` passed. Sort-reshuffle-while-streaming: freeze order once badges resolve (sort applies on settled data, spinner until then). Mobile: Map pill 44px (P10).
4. **line detail** — The §0–§4 reliability IA is the site's gold standard; keep it. FIX: an always-visible **verdict headline band above the tabs** (from §0's data — verdict sentence + OTP + Δ chip) so the payoff is never buried; tabs keep Detail as default (the live board is the right first read; the band carries the verdict). Schedule tab: `{:else}` AbsentValue on empty `service_periods` + whole-tab empty state. Reliability sections get h3s (§C2.7); ToC chips ≥44px. Mobile: §2 dumbbell shift-labels → abbreviated form <28rem.
5. **stops** — Idle state stops being a dead end: cold load renders a **network stop-picture band** (total stops · % with reliability history · worst-stop teaser linking to /repeat-offenders) from already-served payloads + example-query chips. Search/controls sticky; OTP badge gets (i) on the header + skeleton-vs-AbsentValue disambiguation (loading ≠ missing). Mobile: combobox targets (P10).
6. **stop detail** — Gets the framing head its own index has (kicker + h1 + lede via C3 detail head) + a one-line reliability verdict at the top of the Reliability pane (same VerdictBanner primitive, stop scope). Real headings throughout (worst flat-outline offender). Tab strip: `overflow-x:auto` + 44px (THE mobile overflow bug). Controls sticky. Honesty seam: absent live delay renders the absence chip, never "on time". Keep the 4-tab structure and grain rail.
7. **network** — Insert a **network §0 verdict banner** between the LIVE band and HISTORIC (verdict sentence + the Δ-vs-prior chip network entirely lacks — [metric-story-orphans] fix #3). HISTORIC tiles get worst-first ranking order (not auto-fit shuffle). `.network-tile` CSS (duplicated 8×) → one shared panel component. Histogram −1/0/1 tick collision: drop the ±1 labels, keep gridlines. Sticky rail bug dies with §C3. Mobile: dense chart labels at 330px verified post-fix in the slice matrix.
8. **metrics** — C1 3-col re-seat (§C2.6). Collapsed cards render their existing-but-unshown `oneLiner` as the subtitle — the story is visible pre-expand; add expand-all; provenance preamble gets its h2. SQL blocks keep contained scroll + gain expand. Numbered ToC + `SEC n/m` (D4/H4). Deep-link landing gap dies with the global scroll-margin (§C3).
9. **status (= data-health)** — Open with the aggregate verdict: a lane-gate TerminalPanel FIRST ("N/M lanes passing · worst: X") before the detail ledger; then C1 template with per-feed stat cards on the right rail + numbered ToC left (8 sections finally navigable). Retention/envelope 2-col grids collapse to 1-col at 390. Explainer links to `#metrics-provenance`/`#structural-gaps` where methodology keys already exist.
10. **hotspots** — Render the already-computed-but-never-shown `otp_delta_pts`/`deltaLost` copy as the verdict line + a "#1 hotspot" callout above the ladder; severe-rate axis gets the network-baseline reference tick; avg-delay + n get (i)s (n → `#metrics-provenance`). `76rem` bespoke width → `--container-wide`. Sticky fixed by §C3. Mobile: station-tabs + tray links ≥44px.
11. **receipt** — Add the day-verdict sentence to the headline (templated from already-present numbers: worst line + affected share + completeness; NO fabricated baseline — when the S13 cuts stand down during the GC2 ramp, the verdict says exactly that). TerminalChrome frame stays (it's proto-TerminalPanel; converges in P5.3c). SectionHeading pass; (i) hit areas (P10).
12. **repeat-offenders** — The hero becomes the actual #1 offender (name + streak + Wilson-bounded rate); the definition card (`value={null}`) demotes to lede + (i). Wire explainer keys beyond `severe` where they exist in the catalog. Sticky fix via §C3; station-tabs 44px; magnitude-bar gutter verified at 390 in-slice.
13. **alerts** — REORDER: headline → Breakdown (the Tier-2 analytics) → filter rail → log (analytics before the 25-row log; the reader gets the shape before the stream). Wire the 5 unused `alert*` tips (cause/effect/severity rows + duration + reach) via `metricInfoFor` — this single fix clears BOTH orphan lists ([metric-story-orphans] §1.1+§2.B); the headline's bare `/metrics` href (the site's only convention break) → `metricInfoFor('alertDuration')`. Alert methodology stays OUT of `METRICS[]` (deliberate: popover tips are the right depth — ruling). Drop `width="bleed"`; cap the surface at content width (the log already caps at 52rem). Filter rail sticky; combobox targets (P10).
14. **search** — Stays a finder, flat by design (ruling: no verdict layer on a retrieval surface). FIX: idle state gets the network census band (lines/stops counts + freshness stamp — it already polls live) + tappable example-query chips; results wire (i)s on OTP/crowding/delay via `metricInfoFor`; mode chips 44px; controls sticky.
15. **trip** — Merge the duplicate Status/Delay cells into one verdict chip; resolve raw stop ids to names (stops repo already client-side); add destination + "N of M stops remaining" progress from the ETA list; line context link-back. (i)s via `metricInfoFor` (delay/ETA). SectionHeading pass. Keep the exemplary stand-down branch.
16. **404/+error** — fold `.err-home` chrome into the card pattern (P1/P3 tables); no story work.

---

## §C6. Metric-story fix list (complete; from [metric-story-orphans])

Shown-side census: ~62 metrics; ~33 STORY-COMPLETE, ~26 PARTIAL, 3 BARE. Explained-side: 14/14 primary explainers shown + deep-linked; 5/10 supplemental unused. Fixes, by visibility:
1. Home pulse verdict words (§C5.1) — closes the highest-visibility PARTIALs.
2. Network Δ-vs-prior chip + verdict banner (§C5.7).
3. /alerts wiring — the 5 `alert*` tips + anchored headline (§C5.13). Kills all 3 BAREs and all 5 unused explainers in one stroke.
4. Receipt not-reported list → covered by the receipt verdict sentence + existing tips (§C5.11).
5. stops `SectionDailyTrend` — the one stop-detail section missing its (i) (census correction: the other 7 ARE wired).
6. Lines index header (i) + stop index header (i) (§C5.3/5).
Post-P5.3 acceptance: zero STORY-BARE renders; every shown metric ≤2 hops from its explainer; zero unused explainer entries.

---

## §C7. Math fix list (pipeline lane; web is clean)

**BUG — GC2 scheduled-universe mismatch** ([math-pipeline] §5b, `rollups.py:291-319` vs `:389`): `obs`/`trip_day` counts trip-days by CAPTURE day (`snapshot_date_key=:date_key`, no `start_date` filter) while `scheduled_trip_count` is service-day-D only. On overnight/cross-midnight routes `obs.total` inflates → `silent_trip_days = GREATEST(scheduled − obs.total, 0)` UNDER-counts and `delivered_trip_days` / read-time `service_completeness_pct` (`route_reliability.py:174`) OVER-count. RT `cancellation_rate_pct` unaffected (self-consistent).
**Fix (P5.3e-db):** filter the observed universe to the service day — join trips' `start_date = :local_date` with the 2-day capture window, exactly the precedent the service-span/headway builders already use. Acceptance: fixture test with a cross-midnight route where naive counting inflates obs (numerator universe == denominator universe); targeted rebuild of the affected daily rollup rows for the live retention window (data job, no migration — same pattern as prior rollup repairs); before/after on a known 24h route (e.g. night network) published and eyeballed.
**Prod check (P5.3e runbook, 5 min):** confirm the GC2 calendar_dates-only backfill actually ran (0069/0073 reserved columns populated for STO-style schedule versions) — it was a data backfill invisible to code review; one `SELECT count(*)` against `schedule_version_service_summary` settles it.
Everything else re-verified SOUND at head: CDF percentile interpolation, Wilson (z=1.96, no-CC deliberate), EWT (Welding/Osuna-Newell, minutes throughout), CoV (Bessel, mean>0 guarded), STO calendar_dates-only service resolution.

---

## §C8. Perf rulings ([perf-snapshot]; 2.86MB raw / ~915KB gz total, route-split, map-leak CLEAN)

1. `/_kit` dev gallery (57KB) OUT of prod output — build-time exclusion or PROD 404 guard.
2. CLS: ChartFrame reserves height (aspect-ratio/min-height) before hydration on all chart routes (331–370KB gz hydration surfaces).
3. `stops_index.json` (1.15MB raw, parsed on stops/search/map): ship a slim typeahead index (id·name·lat·lon) for search/map; full index lazy-loads on /stops only.
4. `protomaps` preconnect: map route head only.
5. **Zod stays** (36KB gz baseline): the runtime edge of the /v1 Contract Doctrine outweighs the bytes. Re-evaluate `zod/mini` at S16, not before. (Ruling.)
6. `live/trips.json` 289KB@30s on /map: acceptable for the live canvas; note only.
Fonts already clean (self-hosted variable woff2, preload, swap). Owner: P5.3e (items 1–4).

---

## §C9. Slice packaging, amended (a→e; each: fresh branch off main → ONE web PR — e adds a db PR → merge on green → Notion close)

- **P5.3a Foundation** = §C3 (B corrected, 12-file list) + A1–A3 (full-bleed law · NavPill+LeftRail per §C2.1/2.2 · grid at §C1 measured values, light 8/4/6) + E4 (v0.3.0 bump, frozen scope §C4). Riskiest; before/after screenshots of EVERY surface; the three sticky-float bugs are named acceptance items.
- **P5.3b Templates** = C1–C3 (§C2.5/2.6 + detail heads) + D4 + H4 + **the SectionHeading law site-wide (§C2.7)** — the heading-outline a11y defect closes HERE, not at S16.
- **P5.3c Theatre** = D1–D3 (heads · vertical FR titles · TerminalPanel §C2.3, absorbing TerminalChrome) + E1–E3 (glow map §C1; text-glow ban absolute) + F (motion wiring) + A4 (CornerMeta §C2.4).
- **P5.3d Sweep & story** = G (the §C4 kill tables + FORBIDDEN guard) + H1–H3 (ALL §C5 story rulings + §C6 wiring) + I (P1/P11/P12 snaps) + P10 tap-targets (incl. the stop-detail overflow bug) + the near-me sort DEFER blocks in LinesIndex/SearchSurface (P5.3d now OWNS them — no-orphan-deferrals satisfied) + convergence re-run.
- **P5.3e Truth & fitness (NEW, last)** = §C7 db fix + rebuild + GC2 backfill prod check (db PR — the plan-§0 "zero apps/db" rule is hereby scoped to slices a–d) + §C8 perf items 1–4 + hygiene (P9 theme-color meta · delete the two confirmed veto comments · stale TODO pointers `NetworkSurface.svelte:425`, `MapHero.svelte:402` · gitignore `workerd.log`) + final full-site convergence audit (§12 battery × all 16 surfaces × {en,fr} × {dark,light} × {1512, 390}).

Verification protocol §12 and intelligence routing §17 stand unchanged. §17 reminder for the kickoff: sonnet lanes for the mechanical sweeps (P1/P2/P3 table execution), opus for composition + browser judgment; FABLE-QUESTIONS.md is the valve and should end EMPTY.

---

## §C10. S16 forwarding register (owners named)

→ S16 owns: full-site FR i18n audit (labels beyond the confirmed enum trio) · full-site axe+keyboard certification (P5.3 does per-slice touched-surface checks) · Zod/`zod/mini` slimming evaluation · canon refresh (Notion Metric Science cards vs `metrics.content.ts` — the on-disk side is already ahead per [metric-story-explained]).
→ Post-S16 / chart-lib v2 owns: `--chart-stroke-*`/`--chart-dash-*` tokenization (frozen-marks exemption §C4 P8).
→ GC1.5 (existing slice `3913e863…62df`) owns its 5 documented deferred drops — NOT P5.3 work.
→ SEG/MP sequencing after P5.3 stands per plan §16.

## §C11. Thread-closure checklist (for the P5.3e PR description)

☑ T8 — satisfied on evidence, close the plan task. ☑ FR enumLabels — confirmed, comment deleted. ☑ resolveWindow — confirmed, comment deleted. ☑ Yellow CTA — confirmed, shipped in P5.3d as the map near-me amber. ☑ Light grid — confirmed at measured values in P5.3a. ☐ GC2 universe fix + rebuild verified in prod. ☐ GC2 backfill prod check logged. ☐ stale TODOs + workerd.log cleaned. ☐ FABLE-QUESTIONS.md empty at close.
