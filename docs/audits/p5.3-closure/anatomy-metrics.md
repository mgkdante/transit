# Surface Anatomy — /metrics (How-we-measure explainer)

Route: `apps/web/src/routes/[[lang=locale]]/metrics/+page.svelte` (+ its own `+layout.svelte`)
Feature screen: `apps/web/src/lib/features/metrics/MetricsExplainer.svelte` (1276 lines — the whole surface)
Content: `metrics.content.ts` (1240 lines, 14 metric entries) · Chrome copy: `metrics.copy.ts` (415 lines)
Analyzed READ-ONLY. Line refs are 1-indexed.

---

## 0. Mount chain / how the page lives in the shell

- `+page.svelte` (12 lines) is a THIN mount: imports `MetricsExplainer` and renders `<MetricsExplainer />`. No `+page.ts` (content is static; locale from `getLocale()` context). File header at lines 1-7.
- `metrics/+layout.svelte` (27 lines) is a **bare pass-through** — `{@render children()}` only (line 26). S10 (2026-07-02) retired the rotated writing-mode edge word ("METRICS."/"MESURE."), its 2px accent-rail, and the metro-station dots (see its own header, lines 4-12). So the "only route dir with its own nested layout" now adds **zero structure** — it exists but is inert. All chrome lives inside MetricsExplainer.
- Root `routes/+layout.svelte` wraps every page in `<AppShell>` and renders the page tree into the shell's `main` snippet, inside `#main` (line 480-484):
  - `#main` = `flex h-full w-full flex-col overflow-y-auto` (document surfaces) — **the scroll container is this inner div, NOT the window** (line 482).
  - `<Footer>` renders at the bottom of the flow for non-full-bleed surfaces (lines 503-509). /metrics is NOT full-bleed (`isFullBleed = seoPath === '/map'`, line 112), so it scrolls and gets the Footer.
- `AppShell` (`lib/components/shell/AppShell.svelte`): TopBar is `h-[60px]` (TopBar.svelte:273 = 3.75rem), a **shrink-0 flex sibling ABOVE** the scroll row (`app-shell-row`, line 271-277). The `<main>` map stage is `position:absolute; inset:0` full-bleed under the chrome (AppShell.svelte:390-393). **There is NO second sticky header inside `#main`.** This matters for §2 offsets below.

---

## 1. SECTION ORDER + STORY ARC

The whole body is ONE `<article class="metrics-article">` (MetricsExplainer.svelte:448) → header band → hazard separator → 2-col body grid (ToC rail | sections column). Reading order down the sections column (`data-testid="metrics-sections"`, line 538):

| # | Section (heading text) | Component / element | Data source / selector |
|---|---|---|---|
| A | **Article masthead**: kicker `MÉTHODE · SCIENCE DES MESURES` / h1 `Comment on mesure` / mono subheading `// PROXY, PAS UNE PONCTUALITÉ CERTIFIÉE` / lede | `SurfaceHeader` (line 456) inside `<header class="metrics-header detail-header-grid">` (line 454) | static `metricsCopy[locale]` (kicker/heading/subheading/lede) |
| A′ | Quiet/Focus toggle + Remember pin (in the header) | 2 `<button role="switch">` (lines 463-500) | local `$state` quiet/remembered; localStorage/sessionStorage |
| — | Hazard stripe | `<Separator variant="hazard" />` (line 508) | — |
| B | **Provenance preamble** — "Provenance (vaut pour chaque métrique)" + doctrine paragraph | `<section class="metrics-prose">` (line 542), `SectionLabel` station | `t.provenance.label` / `.body`; anchor `metrics-provenance` |
| B1 | Live conformance verdict OR honest stand-down line | `ConformanceBadge` (line 551) OR `<p class="metrics-provenance-down" role="status">` (line 557) | `createResource(getProvenance)` → `provenance.data?.conformance` (line 105) |
| B2 | **How we measure** — 3 named notes: (1) capture-day vs service-day, (2) rounding rebaseline 2026-07-01, (3) doctrine constants (min_n_rate / wilson_z) | `<div class="metrics-measure">` (line 565); each note `<h3 class="metrics-measure__heading">` + `<p>` | static copy + `doctrineConstants` derived from live `provenance.data.methodology` (lines 127-136); honest-absence fallback (lines 588-595) |
| B3 | **Confidence legend** — proxy / medium chips + meanings | `<div class="metrics-legend">` (line 599), `<ul>` (line 601) | `t.confidence.levels` |
| C | **Cluster 01 Punctuality** overline, then 5 metric cards: On-time %, Average delay, Typical/worst-case delay (p50/p90), Severe-delay share, Weak stops | `SectionLabel` station overline (line 616) + per-metric `CollapsibleSection` (line 621) | `groups` (lines 140-146), `METRICS.filter(cluster)`; per card: definition/math/sql/notReally/caveats + optional live pipeline note |
| D | **Cluster 02 Wait regularity** — Headway CoV, Observed/scheduled headway, Excess wait | same card spine | cluster `waitRegularity` |
| E | **Cluster 03 Service delivered** — Cancellation, Skipped-stop, Service span | same | cluster `serviceDelivered` |
| F | **Cluster 04 Crowding** — Occupancy | same | cluster `crowding` |
| G | **Cluster 05 Time-of-day habits** — Habits matrix, Seasonality | same | cluster `habits` |
| H | **Live vehicle positions** — "almost real-time, not real-time" explainer (icon badge) | `CollapsibleSection` with `chart` icon (line 697), anchor `live-positions` | `t.livePositions.{lede,points}` (5 points) — deep-link target for on-map "How this works" |
| I | **Structural gaps ("Lacunes")** — honest close: 3 things the metrics CANNOT tell | `CollapsibleSection` with `eye` icon (line 728), anchor `structural-gaps` | `t.lacunes.{lede,gaps}` (3 gaps) |

Every card ends with a `Back to top` link → `#metrics-provenance` (lines 683, 718, 749).

**14 metric cards** across 5 clusters (verified inventory, metrics.content.ts): punctuality(5): otp, avg-delay, p50-p90, severe, weak-stops · waitRegularity(3): regularity, headway, excess-wait · serviceDelivered(3): cancellation, skipped-stop, service-span · crowding(1): occupancy · habits(2): habits, seasonality. Plus 3 non-metric sections (provenance preamble, live-positions, structural-gaps). **Total ToC entries = 17** (1 provenance icon + 14 numbered metrics + live-positions + structural-gaps; tocEntries lines 177-215).

### Story-arc assessment

The page is deliberately structured as **context → evidence → honest limits**, and at the section level the arc is sound:
- **Context**: masthead + provenance preamble establish "everything here is a feed-derived PROXY, not certified OTP, NULL≠0" — the frame every number inherits. This is genuinely strong, portfolio-grade honest framing.
- **Evidence**: each metric card is a mini-essay (definition → the math → the SQL → what-it's-NOT → caveats → live pipeline note). The verbatim SQL + "what it's NOT" is a rare, credible depth signal.
- **Verdict/limits**: the "Structural gaps" close names the 3 blind spots (not passenger-weighted / no RT for some rapid modes / stop-and-route not journey) — an honest capstone.

**Where the story stalls / breaks:**
1. **DEFAULT-CLOSED kills the narrative on first paint.** S10 made every card `open={false}` (line 626, 702, 733). On load the reader sees the preamble + a **stack of 14+ collapsed title bars** — no evidence is visible until they click. For a *case-study* read the arc is invisible until interacted with; the "context → evidence → verdict" flow only exists if you open cards one by one. There is no "expand all" affordance (Focus only COLLAPSES; unfocus reopens the ToC, NOT the cards — lines 322-326, deliberate per operator mandate lines 229-231).
2. **No cluster-level narration.** Clusters are just mono overlines (`01 Punctuality`, line 616). There's no 1-2 sentence "why this cluster matters / what question it answers" bridge between the preamble and the first card. The five clusters are presented as taxonomy, not as a story ("first, is it on time? then, is the wait predictable? then, did service even run?…").
3. **The reader's question at each depth is answered flatly, not progressively.** Every card answers "how is metric X computed" at the same altitude — there is no "here's the headline takeaway, expand for the math." A portfolio reader wants a one-line verdict per metric visible while collapsed (the `oneLiner` field EXISTS in content, line 92/125, but is NOT rendered on this page — it's only used as the (i) hover tip on reliability surfaces). **This is the single biggest missed opportunity**: the collapsed card could show `oneLiner` as a subtitle, turning the closed stack into a scannable summary.
4. **No hero / no "what am I looking at" orientation for a cold visitor.** A reader landing on /metrics directly (not via an (i) deep-link) gets the methodology frame but no map of the journey — e.g. "14 metrics, 5 families, every one a proxy." The ToC counter (`SEC 1 / 17`) is the only progress signal and it lives in the rail.
5. **Live-positions card is thematically orphaned.** It sits between the last metric cluster and structural-gaps, but it's about the MAP's motion rendering, not a reliability metric. It's here because the on-map link needs a target (`/metrics#live-positions`), but narratively it interrupts the "metrics → limits" flow.

**Verdict:** the *content* is A-grade honest-methodology writing; the *presentation* under-serves it — a default-closed accordion with no collapsed-state summary means the story is latent, not told.

---

## 2. CHROME — headers, sticky elements, offsets

- **TopBar** (global, AppShell): `h-[60px]` (3.75rem), `z-40`, `border-b`, `bg-card`, shrink-0 — sits ABOVE the scroll container, so it never overlaps scrolled content. The metrics page does not interact with it.
- **`--chrome-offset`**: **NOT USED ANYWHERE in the codebase** (grep across `.svelte`/`.css`/`.ts` = 0 hits). The task asked to note its use; there is none. Offsets are hardcoded rem values instead.
- **Article header band** (`.metrics-header`, lines 785-791): `position: relative; overflow: hidden`, full-bleed `background: var(--manifesto)` dot-grid, `padding-block: clamp(1.75rem,4vw,3rem)`, `padding-inline: var(--space-page-x)`. Inner block (`.metrics-header__inner`, 792-797) re-caps to `max-width: var(--container-content)` (64rem), centered. **Not sticky.**
- **Hazard separator** (line 508): edge-to-edge, closes the header band.
- **Sticky ToC rail** (desktop ≥1024px only): `.context-panel { position: sticky; top: 5rem; }` (lines 864-867). `.toc-scroll { max-height: calc(100dvh - 6rem); overflow-y: auto; overscroll-behavior: contain; }` (lines 875-880).
  - **OFFSET MISMATCH (finding):** `top: 5rem` = 80px, but the actual chrome above the scroll container is the 60px TopBar which is OUTSIDE `#main`'s scroll. Because sticky is relative to the scroll container (`#main`, `overflow-y-auto`), `top: 5rem` pins the rail 80px from the TOP OF `#main` (which starts right under the 60px TopBar). So the rail floats with an ~80px gap below the TopBar — a 20px+ visual gap of dead space, not aligned to any chrome edge. Similarly `.toc-scroll` uses `calc(100dvh - 6rem)` (96px) which double-counts. These magic numbers (`5rem`/`6rem`/`5.5rem`) predate the S10 layout and are not derived from `--top-bar-height` (which isn't a token). **No `--chrome-offset` var to anchor to.**
- **scroll-margin offsets** (for deep-link landing): `.metrics-prose` `scroll-margin-block-start: 5.5rem` (line 885); `.section-block` `scroll-margin-block-start: 5.5rem` (line 987). Again 5.5rem = 88px, a magic number not tied to the 60px TopBar. Since `#main` is the scroll container and the TopBar is outside it, deep-linked cards land 88px below the top of `#main` — leaving a large gap, or (worse) if the browser scrolls the window instead of `#main`, the margin is mis-sized.
- **Mobile ToC pill** (`TocPill`, `<lg`): `position: fixed; bottom: calc(20px + env(safe-area-inset-bottom))`, `z-index: var(--z-sheet)` (TocPill.svelte:160-166). Floating, not a rail.
- **No rails** in the RailLayout/ControlsRail sense — the metrics surface uses its own bespoke 2-col grid, not the shared `RailLayout` (which stickies at `top: 5.5rem`).

---

## 3. CONTAINERS — max-widths, grid templates, padding rhythm

- **Article** (`.metrics-article`, 774-779): `display:flex; flex-direction:column; gap:0; width:100%`. Sets no max-width itself.
- **Header inner**: `max-width: var(--container-content)` = **64rem** (tokens.css:88), centered, gutter `var(--space-page-x)` = `clamp(1rem,4vw,5rem)` (tokens.css:43).
- **Body grid** (`.body-grid`, 805-815):
  - Mobile: `max-width: var(--container-wide)` = **72rem**, `margin: 0 auto`, `padding-inline: var(--space-page-x)`, `padding-block: 1.5rem`, `grid-template-columns: 1fr`, `gap: var(--space-card-gap)` (`clamp(1rem,2vw,1.5rem)`), `overflow-x: clip`.
  - Desktop (≥1024px, 834-847): `max-width: none; width:100%`, `grid-template-columns: minmax(14rem,18rem) minmax(0,1fr)` (ToC rail | reading column), `gap: 2.5rem`, `align-items:start`, `padding-block: 2.5rem`.
- **Sections column** (855-862): desktop `max-width: 60rem`, `justify-self: start`, `width:100%`. Mobile: full width, `flex-direction:column; gap:1rem` (827-832).
- **Prose measures**: preamble/prose `max-width: 68ch` (lines 895, 908, 1018); caveats `max-width: 72ch` (line 1053). Reasonable reading measures.
- **Padding rhythm inside cards** (CollapsibleSection): header `px-6 py-4` (line 169), body `px-6 pb-6 pt-3` (line 183). Card gap between sub-blocks `.metric__body { gap: 1.25rem }` (line 994); block internal `gap: 0.5rem` (line 1011). Consistent.

**Container note:** header caps at 64rem (content) but the body grid caps at 72rem (wide) then the reading column at 60rem — so the reading column (60rem) is NARROWER than the header's content cap (64rem) yet the whole grid is WIDER (72rem). The masthead and the reading column are on different measures, and at wide viewports the ToC rail + gap + 60rem column left-aligns within 72rem, leaving right-side whitespace. Not broken, but the measures aren't unified.

---

## 4. HEADINGS — hierarchy sanity

Heading elements actually emitted (SectionLabel emits `<span>`, NOT a heading — SectionLabel.svelte:38-42, so overlines/cluster labels do NOT enter the heading tree; good):

- **h1**: the page title, via `SurfaceHeader` → `SectionHeading level={1}` (SurfaceHeader.svelte:26-27,47 default level=1; SectionHeading renders `<svelte:element this={h1}>`, SectionHeading.svelte:34,38). ONE h1. ✓
- **h2**: EACH `CollapsibleSection` card title is an `<h2 class="section-title">` (CollapsibleSection.svelte:147). So all 14 metric cards + live-positions + structural-gaps = **16 h2s**. ✓ (siblings of the h1, correct level).
- **h3**: sub-headings inside the preamble and inside the live-positions / structural-gaps cards:
  - `metrics-measure__heading` (h3) for the 3 how-we-measure notes (lines 568, 572, 576).
  - `metrics-live__heading` (h3) per live-positions point (line 713).
  - `metrics-lacunes__heading` (h3) per gap (line 744).

**Hierarchy findings:**
1. **The h3s in the provenance preamble (§B2 how-we-measure) are NOT nested under an h2.** The preamble is a `<section aria-labelledby="metrics-provenance">` whose label is a `SectionLabel` **span** (line 547), not a heading. So the three `<h3>` how-we-measure headings jump **h1 → h3 with no h2 in between** (there is no h2 for the preamble section itself). **Skipped level (h1→h3).** This is an accessibility/outline defect.
2. Inside a metric card the level is fine (card = h2, but the card's internal blocks "Definition / The math / The SQL / …" are `SectionLabel` **spans**, line 637 etc., not headings) — so a card is a single h2 with no sub-headings, which is consistent but means the 5 sub-sections of every metric are invisible to a screen-reader's heading nav.
3. Live-positions & structural-gaps cards are h2 (the card) → h3 (each point/gap): correct nesting. ✓
4. `aria-labelledby="metrics-provenance"` points at the SectionLabel **span** id (line 544,547) — a labelledby target that isn't a heading; acceptable for `aria-labelledby` but reinforces that the preamble has no heading in the outline.

**Net:** one h1, clean h2 run for cards, but the **provenance preamble creates an h1→h3 skip** and every metric card's 5 internal sub-blocks are non-heading spans (no in-card heading nav).

---

## 5. ABSENCE STATES — how missing data is shown

This is a **static prose page** — the ONLY live data is the supplementary `provenance` resource (`createResource(getProvenance)`, line 105). Absence handling for it is well done and honest:

- **Conformance badge absent**: if `provenance.data?.conformance` is falsy AND the fetch errored (`provenanceUnavailable`, lines 112-114), renders `<p class="metrics-provenance-down" role="status">{t.provenance.unavailable}</p>` (line 557) — a localized "the live check is momentarily out" line, muted, not a data color, gated on `provenance.settled` so it never flashes mid-load. ✓
- **Doctrine constants absent**: `doctrineConstants` is null when `min_n_rate`/`wilson_z` aren't finite numbers (lines 123-136); the template shows `t.provenance.howWeMeasure.constants.absent` in a `<p role="status" class="metric__not">` (lines 588-595) instead of hardcoding `30 / 1.96`. Excellent honest-absence — refuses to print a fabricated constant. ✓
- **Per-metric live pipeline note**: `methodologyNote(entry)` returns null when unmapped/absent → the whole `{#if note}` block is omitted (lines 676-681). Silent stand-down (the static science is complete without it), which is correct here.

**AbsentValue / absentReason / describeAbsence / MaybeValue usage: ZERO** in the metrics feature (grep = 0 hits). This is **appropriate** — the site-wide unknown-data layer (`AbsentValue`/`describeAbsence`) is for *data surfaces* that render nullable metric values; /metrics renders no metric VALUES, only methodology prose, so there is nothing for it to guard. No bare-dash / null-leak: the only `null`s in the .svelte are logic guards, never rendered (`—` occurrences are all in comment prose, line 12-13 etc., not output). ✓

**Verdict:** absence handling is honest and complete for what this page serves; no dash/null leaks.

---

## 6. EXPLAINER LINKS — do metrics link to their /metrics entry?

This page **IS** the explainer (the "how-we-measure" destination), so the relevant contract is INBOUND:
- `MetricInfo.svelte` (the `(i)` affordance) renders a popover with a link `href` → `/[lang]/metrics#<anchor>` (MetricInfo.svelte:26,304-312). Confirmed consumers deep-link here: `metricInfoFor()` (metrics.content.ts:1226) supplies the anchor, and reliability surfaces use it — `Section0Verdict`, `Section1WhenToRide`, `Section3RunAndFit`, `Section4WorstStops`, `RouteDetail`, stops `SectionWeekday`/`SectionTimeOfDay`, `hotspots`, `alerts/AlertHistory` all import MetricInfo/metricInfoFor (grep §). ✓
- **Deep-link reveal contract**: on a default-closed page, the hash opener (`openFromHash`, lines 362-374; onMount + `hashchange` listener lines 376-393) opens the target card before the native anchor scroll lands. Anchors are validated against `openableAnchors` (lines 347-353); the provenance preamble is deliberately excluded (it's a non-card `<section>` that just scrolls). Malformed fragments are swallowed (lines 365-372). This is careful, correct work. ✓

**OUTBOUND (within /metrics):** each card ends with a `Back to top` link → `#metrics-provenance` (lines 683,718,749). The ToC (`TocNav`/`TocPill`) navigates between sections via `navigate()` (lines 438-445) which opens-then-scrolls. ✓

**Gap:** metrics do NOT cross-link to each OTHER (e.g. the avg-delay card mentions p50/p90 as "the honest typical" — content line 221 — but there's no in-prose anchor link to the p50-p90 card). All the anchors exist; the prose just doesn't hyperlink related metrics. A portfolio page would wire those.

---

## 7. MOBILE-390 READ FROM CODE

- **Breakpoints**: exactly ONE — `@media (min-width: 1024px)` (line 834) is the desktop switch. Below 1024px (so at 390px): single-column body grid, ToC rail hidden (`.toc-nav-shell { display: none }` line 823-825), TocPill shown (`lg:hidden` on the container, but pill container is `lg:hidden` → visible <1024; TocNav shell display:none <1024). Tailwind `lg:` = 1024px, consistent. No `sm`/`md` breakpoints in the feature — a single hard switch.
- **Container at 390px**: `.body-grid` `max-width: 72rem` (irrelevant at 390), `padding-inline: var(--space-page-x)` = `clamp(1rem,4vw,5rem)` → at 390px, 4vw = 15.6px, so gutter ≈ 16px each side. `overflow-x: clip` (line 811) + `.context-column/.sections-column { min-width: 0 }` (818-820) guard against horizontal blowout. ✓
- **Overflow risks at 390px:**
  1. **SQL CodeBlock** — the biggest risk. `.codeblock__pre { overflow-x: auto; white-space: pre; }` (CodeBlock.svelte:98-107), `tabindex=0 role=region` keyboard-scrollable. The SQL blocks are wide (many 60-90 char lines, e.g. the OTP weekly rollup). At 390px they will horizontally scroll WITHIN the block (contained by `overflow-x:auto`), which is the correct strategy — but each card body is `px-6` (24px each side) inside a ~358px card, leaving ~310px for a `pre` that needs ~600px → heavy horizontal scroll. The block scrolls, the page does not. **Contained, but a poor read** (tiny window on wide SQL). No line-wrap/soft-wrap option offered.
  2. **`.metric__prose--mono`** (the math line, line 645/1020) is `font-family: mono, white-space` default (normal) so it wraps — OK.
  3. **`.metric__meta`** row (`sciName` code + confidence chip, lines 631-634) is `flex-wrap: wrap` (line 998) — OK.
  4. **MetricInfo popover** is `position:fixed` viewport-anchored with edge-aware flip/shift + `max-inline-size: min(18rem, calc(100vw - 16px))` (MetricInfo.svelte:375) — cannot overflow at 390px. ✓ (but MetricInfo lives on OTHER surfaces, not on /metrics itself.)
- **Touch-target sizes (from classes):**
  - Quiet toggle: `min-height: 44px` (line 1142) ✓. Remember pin: `min-height: 44px` (line 1203) ✓. Both wrap (`.metrics-quiet-controls { flex-wrap: wrap }` line 1134) so at 390px they may stack — fine.
  - ToC pill: `min-height: 44px` (TocPill.svelte:172), `padding: 12px 20px`, `max-width: calc(100vw - 2rem)`, name ellipsizes ✓.
  - ToC drawer items: `min-height: 44px` `padding: 12px 14px` (TocPill.svelte:230-233) ✓.
  - Card header (the whole card is tappable): header button `px-6 py-4` → ≥44px tall ✓; plus the whole card is a click surface (onCardClick, CollapsibleSection.svelte:123-132).
  - **Back-to-top links** (`.metric__top`, line 1246): `font-size: var(--text-caption)` inline text link, `align-self: flex-start` — NO min-height, so the tap target is just the text line-height (~16-18px). **Below 44px** — a touch-target miss, though low-severity (rarely used).
  - Desktop ToC rail items: `min-height: 44px` (TocNav.svelte:164), sub-items `min-height: 36px` (line 201) — but rail is hidden at 390px so N/A.
- **Chart sizing on small screens**: N/A — this page has NO charts (prose + SQL only; doctrine note lines 50-56 confirms "no data marks here").
- **Sticky behavior at 390px**: the sticky rail is `display:none` <1024px, so no sticky at all on mobile — the floating TocPill (fixed, bottom-center) replaces it. `env(safe-area-inset-bottom)` respected (TocPill.svelte:162). ✓ No sticky-offset problems on mobile because there's no sticky element.

**Mobile risk level: LOW–MEDIUM.** No horizontal-page overflow (guarded by `overflow-x:clip` + `min-width:0`). The one real friction is **wide SQL blocks scrolling in a ~310px window** (usable but cramped, no wrap toggle). Minor: back-to-top link tap target <44px.

---

## 8. TOP 5 GAPS vs an A++ portfolio case-study page

1. **Default-closed accordion hides the entire story on first paint; no collapsed-state summary.** The `oneLiner` field already exists per metric (metrics.content.ts:92,125) but is never rendered here — it's only the (i) hover tip elsewhere. **Fix:** render `oneLiner` as a subtitle under each collapsed card title, turning the closed 14-card stack into a scannable executive summary, and/or add an "Expand all" control. Right now a cold visitor sees a wall of closed bars.

2. **No cluster-level or page-level narration bridging context → evidence.** Clusters are bare mono overlines (`01 Punctuality`). Add a 1-2 sentence framing per cluster ("Is the bus on time?" → "Is the wait predictable?" → "Did service run at all?") and a page-intro line ("14 proxy metrics across 5 reliability questions"). This is what makes it read as a *narrative*, not a taxonomy.

3. **Heading hierarchy skip (h1 → h3) in the provenance preamble + no in-card headings.** The how-we-measure notes are h3 with no h2 parent (the preamble's label is a span). And every metric card's 5 sub-blocks (Definition/Math/SQL/…) are spans, invisible to screen-reader heading nav. Promote the preamble to an h2 section and consider making the per-card sub-labels headings (h3) so the document outline is complete and navigable.

4. **Chrome-offset magic numbers, unaligned sticky/scroll-margin.** `top: 5rem`, `calc(100dvh - 6rem)`, `scroll-margin: 5.5rem` are hardcoded and don't correspond to the actual 60px TopBar (which is outside the `#main` scroll container). Deep-linked cards land with an ~88px gap; the sticky rail floats with dead space. Introduce a `--chrome-offset`/`--top-bar-height` token and derive these, so anchors land flush and the rail aligns to a real edge.

5. **No cross-metric linking, no worked example, no visual anchor.** A++ methodology pages show a *worked example* (real numbers flowing through the formula: "Route 80 had 1,204 readings, 1,060 in the on-time band → 88%") and hyperlink related metrics (avg-delay ↔ p50/p90). This page states the math abstractly and never links metric-to-metric though all anchors exist. Adding one concrete worked example per metric + inline cross-links would lift it from "reference doc" to "case study." (Also: the page has zero imagery/diagram — a single schematic of the pipeline flow, feed → rollup → published number, would orient readers and match the "detail-header-grid schematic" brand it already gestures at.)

---

## Appendix — key file:line index

- Mount: `metrics/+page.svelte:9,12` · `metrics/+layout.svelte:26`
- Shell scroll container: `routes/+layout.svelte:480-484` (`#main overflow-y-auto`) · TopBar height `shell/TopBar.svelte:273`
- Header band + masthead: `MetricsExplainer.svelte:454-504` · SurfaceHeader `surface/SurfaceHeader.svelte:45-54` · h1 `brand/SectionHeading.svelte:34-44`
- Quiet/Focus + Remember: `MetricsExplainer.svelte:250-340,462-501` (min-height:44px 1142,1203)
- Body grid: `MetricsExplainer.svelte:805-881` · tokens `styles/tokens.css:43,45,88,89`
- Provenance/how-we-measure/legend: `MetricsExplainer.svelte:542-610`; absence `557,588-595`; live resource `105,112-114,127-136`
- Cards: `MetricsExplainer.svelte:614-752` · CollapsibleSection h2 `shared/CollapsibleSection.svelte:147`; default-closed `626,702,733`; signals `100-114`
- ToC: rail `shared/TocNav.svelte`; pill `shared/TocPill.svelte`; model `shared/toc.ts`; sticky `MetricsExplainer.svelte:864-880`
- SQL block (mobile scroll): `components/CodeBlock.svelte:98-107`
- Inbound explainer link: `metrics/MetricInfo.svelte:26,304-312` · anchors `metrics.content.ts` per entry · `metricInfoFor` `metrics.content.ts:1226`
- Content inventory: 14 metrics `metrics.content.ts:115-1115`; copy `metrics.copy.ts:163-414`
- `--chrome-offset`: NOT PRESENT anywhere (0 grep hits)
