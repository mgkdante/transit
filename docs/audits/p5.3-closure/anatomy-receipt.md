# Surface Anatomy — /receipt (Accountability Receipt)

**Route:** `apps/web/src/routes/[[lang=locale]]/receipt/+page.svelte` (thin mount, 13 lines)
**Orchestrator:** `apps/web/src/lib/features/receipt/AccountabilityReceipt.svelte` (417 lines)
**Copy:** `apps/web/src/lib/features/receipt/receipt.copy.ts`
**No `+page.ts`, no `+layout.*`** in the route dir — locale comes from `getLocale()` context; both resources (`getReceiptsIndex`, `getReceipt`) are browser-only via `createResource` (`$effect`). Only file present: `+page.svelte`.

The surface is: an availability-aware single-date calendar drives a per-date fetch of one day's "receipt", rendered as receipt line-groups inside a brand `TerminalChrome` window frame, with three S13 "cuts" hoisted BELOW the frame.

---

## 1) SECTION ORDER + STORY ARC

Top-to-bottom render order (`AccountabilityReceipt.svelte`):

| # | Section / element | Component | Data source / selector | File |
|---|---|---|---|---|
| 0 | Surface head (kicker `ACCOUNTABILITY · DAILY`, h1 `Accountability receipt`, `// RECEIPT` subheading, lede) + **FreshnessStamp** (`variant="updated"`, from chosen receipt's `generated_utc`) | `SurfaceHeader` + `FreshnessStamp` | `t.kicker/heading/subheading/lede`; `receipt.data?.generated_utc` | `AccountabilityReceipt.svelte:218-221` |
| — | Hazard `Separator` (full) | `Separator variant="hazard"` | — | `:223` |
| — | **Empty-index guard**: if `!hasDates` → `t.emptyIndex` note; else the picker+body | — | `selectAvailability(index.data)` → `availability.hasAny` | `:228-231` |
| 1 | **Date picker** in a bare `ControlsRail` (label `Day`) — single-date availability-bound calendar (gap/empty/schedule-only days disabled + reasoned) | `ControlsRail` + `DateRangePicker mode="single"` | `selectAvailability` (`data/presentAvailability`), seeded via `resolveReceiptDate` (`data/presentDates`) + `fromSearchParams(...).date` | `:237-253` |
| — | Hazard `Separator` (sm) | — | — | `:255` |
| — | **Per-date branch** (explicit, not via ResourceBoundary): `error` → EdgeState error-v1; `loading/!settled` → EdgeState skeleton; `data == null` → `t.emptyReceipt` note; else the receipt | `EdgeState` | `receipt` resource | `:260-271` |
| 2 | **TerminalChrome frame** (title `service-receipt`, tag `DAILY`, status = formatted date, footer `For <date>`) wrapping the readout board | `TerminalChrome` | `receipt.data.date` | `:273-297` |
| 2a | **Headline** — On-time %, Average delay, Severe delays, Rider impact (4 `MetricDisplay` + per-metric `MetricInfo` (i)) | `SectionHeadline` | `selectHeadlineKpis` ← `otp_pct/avg_delay_min/severe_pct/rider_impact_score` | `:284-290` |
| 2b | **Affected on the day** — Lines / Stops / Alerts counts (`MaybeValue` cells; vehicles dropped upstream) | `SectionAffected` | `selectAffectedCounts` ← `affected_routes/affected_stops/alerts/vehicles` | `:291` |
| 2c | **Worst of the day** — worst line (→`/lines/[id]`) + worst stop (→`/stop/[id]`) as `EntityRow`s. Mounted ONLY when `worst.hasWorst`; grid reflows past it otherwise | `SectionWorst` | `selectWorstOfDay` ← `worst_route/worst_stop` | `:292-294` |
| 3 | **Cuts container** (below frame, `.receipt-cuts`, capped to `--container-content`) | — | — | `:303-335` |
| 3a | **By time of day** — severe-delay share ranked worst-first by shift (`RankedRow` on absolute `SEVERE_DOMAIN`). Mounted only when `timeOfDay.hasTimeOfDay` | `SectionTimeOfDay` | `selectReceiptTimeOfDay` ← `by_shift[]` | `:304-313` |
| 3b | **Service delivered** — one completeness number (`ExplainedMetricCard`) + delivered/cancelled/silent share bars (`RankedRow`, `CANCEL_RATE_DOMAIN`, rank suppressed). Mounted only when `stateCuts.hasData` | `SectionStateCuts` | `selectStateCuts` ← `service_states` | `:314-326` |
| 3c | **Scheduled but never appeared** — not-reported (silent) lines list, each a ranked link to `/lines/[id]` (`RankedRow bare` on `NOT_REPORTED_DOMAIN [0,20]`) + shown/total honesty note. Mounted only when `notReported.hasData` | `SectionNotReported` | `selectNotReportedLines` ← `service_states.not_reported_routes[]` | `:327-334` |
| 4 | **Caveat** — "A daily summary of observed reliability, not a certified service report…" (mono, muted) | plain `<p class="receipt-caveat">` | `t.caveat` | `:338` |

### Story-arc assessment

**Narrative shape today: context → evidence, but the VERDICT beat is missing.** The reader answers, at each scroll depth:

- **Head/picker:** "What is this and which day am I looking at?" — strong. Kicker+heading+lede establish the accountability frame; the smart calendar with honest disabled days is an excellent, honest context primitive.
- **2a Headline:** "How did the service do overall that day?" — the four KPIs are the crux, well-placed as the first thing inside the frame.
- **2b Affected:** "How much of the network was touched?" — reasonable magnitude context.
- **2c Worst:** "Who was worst?" — the natural pointed follow-up; good that it links out to line/stop detail (the ONLY drill-down affordances on the page).
- **3a Time of day:** "When in the day was it worst?" — a genuine deepening.
- **3b Service delivered:** "Did the scheduled service actually run?" — the completeness/cancelled/silent split is a distinct, strong accountability question.
- **3c Not reported:** "Which specific lines vanished?" — the sharpest accountability moment (the operator item), and the second drill-down surface.
- **4 Caveat:** the honesty footer.

**Where the story breaks / stalls:**

1. **No verdict / no synthesis.** The page never states a one-line judgment ("This was a below-average day: on-time 78%, 3 lines went silent"). The reader assembles the verdict themselves from four bare tiles. An A++ accountability receipt should OPEN or CLOSE with a plain-language grade or headline sentence. There is a static lede and a static caveat, but nothing day-specific and evaluative.
2. **No comparison / no baseline.** Every number is absolute and context-free. On-time 82% — good or bad? There is no "vs the trailing 30-day median", no delta chip, no trend sparkline, no "worse than usual" flag. The worst-line row carries `otp_delta_pts` (vs network) — the ONLY relative figure on the whole page — but the headline KPIs have no such anchor. This is the single biggest story gap: accountability without a baseline is just numbers.
3. **The three S13 cuts (3a/3b/3c) all stand DOWN during the GC2 ramp** (`hasTimeOfDay`/`hasData` gating). On a typical current-day receipt, the page likely renders ONLY head → picker → frame (headline/affected/worst) → caveat. So the richest "evidence" half of the arc is frequently absent, leaving a very short page that stalls right after "worst of the day."
4. **The TerminalChrome-inside / cuts-outside split is a conceptual seam.** The reader crosses a visual boundary (framed window → unframed stacked lists) mid-story. It is documented (WEB4 hoist) and defensible, but it reads as two documents rather than one continuous receipt.
5. **The date picker is the only interactive control, and it sits between the head and the evidence** — there is no "compare two days" or "jump to worst recent day" affordance, so exploration is one-day-at-a-time.

**Missing for it to read as a full story (context → evidence → verdict):**
- A day-specific **headline verdict sentence / grade** (synthesis).
- **Baseline deltas** on the headline KPIs (this-day vs trailing median).
- A **trend/where-does-this-day-sit** micro-viz (e.g. this day's OTP as a dot on a 30-day strip).
- Something to keep the arc alive when the S13 cuts are absent.

---

## 2) CHROME

- **No sticky elements on this surface.** The `ControlsRail` is rendered WITHOUT the `sticky` prop (`AccountabilityReceipt.svelte:237`), so it scrolls with content. `ControlsRail`'s sticky path (`position:sticky; top: var(--rail-sticky-top, 5.5rem)`) is dormant here.
- **No `--chrome-offset` anywhere in the codebase** (grep: 0 hits). The nav offset token is `--nav-height` (default `64px`, `app.css:535`), used for global `scroll-margin-top` and by other features (ReliabilityFilterPill, RouteReliabilityClusters) — but the receipt surface itself declares **no `scroll-margin-top`, no sticky offset, no rail**. It relies solely on the global app chrome (AppShell nav) above it.
- **In-frame chrome (TerminalChrome):** a title bar (signal-head StatusDots + mono title + tag + status), a hazard `Separator`, a scrollable body (`overflow-y:auto`, `padding:0.75rem 1rem`), and a footer metric row. This is decorative window furniture, not page chrome, and does not pin.
- **Rails:** the bare `ControlsRail` is the only rail-like element; it is a quiet bordered `--card` panel, non-sticky, `margin-bottom:1rem` (override at `:345-347`).

---

## 3) CONTAINERS

- **Surface** `width="bleed"` → `max-width: none` (`Surface.svelte`); default `pad="surface"` (`padding-block: clamp(1.5rem,4vw,2.5rem)`), `gutter` on (`padding-inline: var(--space-page-x)`), vertical `gap: clamp(1.75rem,4vw,2.75rem)`.
- Despite the bleed surface, real content is re-capped to **`--container-content` = 64rem**:
  - TerminalChrome: `:global(.receipt [data-slot='terminal-chrome']) { max-width: var(--container-content) }` (`:348-350`).
  - Cuts container: `.receipt-cuts { max-width: var(--container-content) }` (`:401`).
  - So the "bleed" is effectively unused for width — everything lands at 64rem. (Container tokens: `--container-content:64rem`, `--container-wide:72rem`, `tokens.css:88-89`.)
- **Grid templates:**
  - `.receipt-layout` (`:358-393`): single column by default; at **`@container receipt (min-width: 34rem)`** → 2-col with `headline headline / affected worst`; `.no-worst` collapses to `affected affected`. Driven by a `@container` on `.receipt-frame` (`container-type: inline-size; container-name: receipt`) — reacts to the FRAME width, not viewport. Good.
  - `SectionHeadline` `.receipt-metrics` (`SectionHeadline.svelte:81-91`): 2-col, → 4-col at `@container receipt (min-width: 46rem)`.
  - `SectionAffected` `.receipt-counts` (`:74-84`): 2-col, → 4-col at `@container receipt-affected (min-width: 30rem)` (its own nested container).
  - `SectionNotReported` `.receipt-not-reported-list` (`:85-93`): `repeat(auto-fit, minmax(min(16rem,100%), 1fr))` — 1 col on phone, several on desktop. The `min(16rem,100%)` guard prevents overflow. Good.
- **Padding rhythm:** panels (`.receipt-panel`) `padding:1.1rem 1.2rem`, `gap:0.85rem`, `border:1px var(--border)`, `radius-lg`, `background:var(--card)`. Cuts stack `gap:1.5rem`, `margin-top:1.25rem`. Terminal body `0.75rem 1rem`. Rhythm is consistent and token-driven.

---

## 4) HEADINGS — hierarchy sanity

**FLAT OUTLINE — a real defect.** The page has exactly **one heading element (`<h1>`)** and **zero `<h2>`+**.

- `SurfaceHeader` renders `SectionHeading level={1}` → a real `<h1>` (`SectionHeading.svelte:34-44`, `svelte:element this={`h${level}`}`). This is the only heading node. (default `level=1` in SurfaceHeaderProps.)
- **Every section title inside the receipt uses `SectionLabel`, which renders a plain `<span>`** with `data-slot="section-label"` and **no `role="heading"`, no `aria-level`** (`SectionLabel.svelte:38-43`; grep confirms zero heading role). Affected sections: SectionHeadline (`:34`), SectionAffected (`:33`), SectionWorst (`:33`), SectionTimeOfDay (`:37`), SectionStateCuts (`:51`), SectionNotReported (`:36`), plus `splitLabel` (`variant="metric"`).
- **Consequence:** the document outline is `h1` then nothing. A screen-reader heading navigation lands on the page title and finds no sub-structure. "The receipt", "Affected on the day", "Worst of the day", "By time of day", "Service delivered", "Scheduled but never appeared" are all visually headings but semantically spans. Sections DO carry `aria-label` on the `<section>` in the cuts (SectionTimeOfDay/StateCuts/NotReported use `aria-label={heading}`), which gives landmark-ish naming, but the in-frame sections (Headline/Affected/Worst) wrap the label in a `<span class="receipt-section">` with no region role and no heading — those have neither a heading nor an aria-labelled region.
- **No skipped levels** in the strict sense (there is only one level), but the ABSENCE of h2/h3 is itself the hierarchy failure: a rich multi-section page should be `h1 → h2 (each section)`, optionally `h3` for the split sub-label. This is the clearest, cheapest A11y/structure fix on the page.

---

## 5) ABSENCE STATES

Absence handling is a documented first-class concern here and is largely excellent:

- **Headline KPIs:** `MetricDisplay ... absentReason="no-observations" emptyLabel={noData}` (`SectionHeadline.svelte:47-54`). Null → styled honest-absence chip, never a fabricated 0. Formatters return `null` on no-data (`fmtPct/fmtMinTile/...` at `AccountabilityReceipt.svelte:141-149`).
- **Affected counts:** `MaybeValue value={cell.value} reason="no-observations"` (`SectionAffected.svelte:47`). A real measured 0 stays 0; null → chip. `vehicles` cell is DROPPED upstream in the selector (`affectedCounts.ts`) rather than shown as a permanent no-data row — good (avoids a perpetual dead chip).
- **Worst of the day:** whole panel stands down (`{#if worst.hasWorst}`, `AccountabilityReceipt.svelte:292`) — grid reflows, no empty card. Inline metas use `fmtMinInline`/`fmtDelta` which emit `t.noData` ("no data" / "aucune donnée") STRINGS when null (`:151-156`) — a localized string, not a bare dash.
- **State cuts completeness:** `ExplainedMetricCard ... note={completenessDisplay == null ? standDown : undefined} absentReason="no-observations" emptyLabel={noData}` (`SectionStateCuts.svelte:56-65`) — null completeness shows the chip PLUS a ramp-in stand-down note. Share bars pass `absentReason="no-observations"` (`:93`).
- **Whole cuts stand down on ramp-in:** `hasTimeOfDay`/`stateCuts.hasData`/`notReported.hasData` gate each cut (`:304/314/327`). An absent list is honest-absence, never an empty "everything delivered" card (documented in selectors).
- **Empty index:** `t.emptyIndex` note (`:230`). **404 receipt:** explicit `receipt.data == null` branch → `t.emptyReceipt` note (`:269-270`) — deliberately branched OUTSIDE ResourceBoundary because a 404 loads as `null` the boundary can't distinguish from "not yet loaded."
- **Freshness:** `generatedUtc ?? null` → FreshnessStamp reads localized "unknown" when null (per FreshnessStamp doctrine).

**Bare-dash / null leaks found:** none in the receipt feature code. All no-data paths route through `MetricDisplay`/`MaybeValue`/`ExplainedMetricCard` absent chips or localized `t.noData` strings. The caveat copy explicitly states "a blank figure means no data, never zero." This is a model implementation of the site's unknown-data doctrine.

---

## 6) EXPLAINER LINKS (→ /metrics how-we-measure)

Strong coverage. `AccountabilityReceipt.svelte:84-88` builds `info(key, name)` = `metricInfoFor(key, locale)` (`metrics.content.ts`) → `{ tip, href: '/metrics#<anchor>', label, linkLabel }`, and every heading + KPI wires a `MetricInfo` (i) popover with a deep link into `/metrics`.

- Headline section heading → `info('otp', heading)`; each KPI → `info(kpi.key, kpi.label)` with keys `otp / avgDelay / severe / riderImpact` (`SectionHeadline.svelte:29,45`; keys from `selectHeadlineKpis`).
- Affected heading → `info('affectedCounts', heading)` (`SectionAffected.svelte:28`).
- Worst heading → `info('otp', heading)` (`SectionWorst.svelte:28`).
- Time-of-day heading → `info('severe', heading)` (`SectionTimeOfDay.svelte:32`).
- State-cuts completeness → `info('cancellation', completenessLabel)` (`SectionStateCuts.svelte:47`).

**Key resolution verified:** `otp`, `avgDelay`, `severe` are in `METRICS_BY_KEY` (`metrics.content.ts:118/194/303`); `riderImpact`, `affectedCounts` are in `SUPPLEMENTAL_METRIC_TIPS` (`:1143/1164`); `cancellation` in `METRICS_BY_KEY` (`:602`). `metricInfoFor` falls through to the supplemental map correctly (`:1231-1233`). No dangling keys.

**Gap:** the individual **affected-count cells** (Lines/Stops/Alerts) and the **not-reported list** carry NO per-item explainer — only the section heading has one (and SectionNotReported has none at all: it takes no `info` prop). Also the **worst section reuses `otp`** for its heading tip, which is a slight semantic mismatch (worst-of-day is a ranking, not the OTP definition). Minor.

---

## 7) MOBILE-390 READ FROM CODE

- **Breakpoints:** the surface avoids viewport media queries in favor of `@container` queries, which is the right call for a 390px read:
  - `.receipt-layout` stays single-column until the FRAME hits 34rem (`:380`). At 390px viewport the frame is well under 34rem, so headline/affected/worst stack vertically — no 2-col squeeze.
  - `.receipt-metrics` (4 KPIs) is 2-col until frame ≥46rem (`SectionHeadline.svelte:87`) → 2×2 on phone. Good.
  - `.receipt-counts` 2-col until container ≥30rem (`SectionAffected.svelte:80`) → 2-col on phone (3 cells → 2+1). Fine.
  - `.receipt-not-reported-list` `auto-fit minmax(min(16rem,100%),1fr)` → 1 col on phone, the `min(...,100%)` guard prevents horizontal overflow. Good.
- **Overflow risks at 390px:**
  - `TerminalChrome` `.terminal-body { overflow-y: auto }` (vertical only). No `overflow-x` guard on the body; content relies on children being width-safe. The grids above are all `minmax(0,1fr)`/single-col, so low risk.
  - **`EntityRow` metas** (worst line/stop): title + subtitle + right-aligned meta string (`On-time vs network -8 pts`) in one row (`EntityRow.svelte`, `padding:0.75rem 0.875rem`). On a narrow phone a long localized meta beside a long stop name could crowd; EntityRow's layout should wrap but this is the most likely tight spot. Worth a visual check.
  - **Terminal titlebar** (`justify-content: space-between`, `gap:0.75rem`): title `service-receipt` + tag `DAILY` on the left, formatted date status on the right. A long localized date (FR) plus tag could get tight at 390px but titlebar text is small mono (`--text-caption`); low risk.
  - The `.receipt-caveat` is capped at `52ch` and the `t.caveat`/`t.lede` are long sentences — fine, they wrap.
- **Touch-target sizes (from classes/CSS):**
  - **Date `<select>` (the primary control): `min-height: 44px`** (`DateRangePicker.svelte:300,317`) — COMPLIANT. Native select, free mobile picker.
  - **MetricInfo (i) trigger: `inline-size: 1.05rem; block-size: 1.05rem; padding:0`** (~17px) (`MetricInfo.svelte:327-333`) — **FAR below the 44px minimum.** These (i) glyphs appear next to every heading and every KPI (7+ on the frame) and are the densest tap targets on the page. High-priority mobile touch-target defect.
  - **Not-reported links** (`.receipt-not-reported-link { display:block }`) wrap a full `RankedRow` — block-level, so the tap area is the whole row (tall enough). Fine.
  - **EntityRow** anchors: `padding:0.75rem 0.875rem` → ~2.25rem+content tall; likely ≥40px, borderline but acceptable for a row.
- **Chart sizing on small screens:** the only "charts" are `RankedRow` severity bars (time-of-day, state split, not-reported) and `ExplainedMetricCard`. All are full-width flex/grid rows with fixed absolute domains (SEVERE_DOMAIN, CANCEL_RATE_DOMAIN, NOT_REPORTED_DOMAIN) — bar width is a % of an absolute scale, not viewport-dependent geometry, so they degrade cleanly to 100% width. No SVG axis/label rotation risk. Good.
- **Sticky behavior on mobile:** none — the ControlsRail is non-sticky, so no phone-viewport-eating sticky bar. Correct per ControlsRail's own mobile doctrine.

**Mobile risk verdict: MEDIUM-LOW.** Layout reflows correctly via container queries and the primary control is 44px. The material risks are (a) the sub-20px (i) info triggers (real, and numerous), and (b) EntityRow meta crowding — both cosmetic/interaction, not layout-breaking. No horizontal-overflow trap found.

---

## 8) TOP 5 GAPS vs an A++ portfolio case-study page

1. **No day-specific verdict / synthesis beat.** The page presents evidence but never renders a plain-language judgment of the day ("Below-average day: 78% on-time, 3 lines silent"). An A++ accountability receipt leads or closes with a one-sentence grade. Currently the reader must synthesize four bare tiles themselves. *(Story arc — biggest gap.)*
2. **No baseline / comparison anywhere on the headline.** Every headline KPI is an absolute number with no "vs trailing median", delta chip, or trend context — the reader can't tell if 82% is good. Only the worst-line row has a relative figure (`otp_delta_pts`). Add per-KPI deltas and/or a "this day on a 30-day strip" micro-viz. *(Story arc / evidence.)*
3. **Flat heading outline (one h1, zero h2+).** All six section titles are `SectionLabel` `<span>`s with no heading role (`SectionLabel.svelte:38`). Semantically the page has no sub-structure. Promote section titles to real `h2` (and the split sub-label to `h3`). Cheap, high-value a11y + structure fix. *(Headings.)*
4. **Sub-20px (i) explainer triggers fail the 44px touch target** (`MetricInfo.svelte:327` — 1.05rem), and they are the densest tap targets on the page (7+ on the frame). On mobile these are hard to hit. *(Mobile.)*
5. **The richest half of the page (the 3 S13 cuts) is frequently absent during the GC2 ramp** (`hasTimeOfDay`/`hasData` gating). On a typical current receipt the page is just head → picker → 3 tiles → caveat — short and anticlimactic. Either accelerate the data ramp or add an always-present evidence element (trend strip, comparison) so the arc doesn't stall right after "worst of the day." Secondary: the framed-vs-unframed seam between the TerminalChrome tiles and the hoisted cuts reads as two documents. *(Story arc / data completeness.)*
