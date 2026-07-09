# Surface Anatomy — Line Detail (`/lines/[id]`)

Scope: the per-line detail surface. Route dir `apps/web/src/routes/[[lang=locale]]/lines/[id]/` (thin mount), the feature screen `$lib/features/lines/RouteDetail.svelte`, and the 4-section reliability cluster under `$lib/features/lines/reliability/`. Legacy `/route/[id]` now holds only a 301 redirect shim.

All paths below are absolute-relative to `apps/web/`.

---

## 0. Mount chain (how the page is assembled)

| Layer | File | Role |
|---|---|---|
| Route page | `src/routes/[[lang=locale]]/lines/[id]/+page.svelte` (18 lines) | THIN mount: renders `<RouteDetail id={data.id} />`. No layout, no chrome of its own. |
| Loader | `src/routes/[[lang=locale]]/lines/[id]/+page.ts` (15 lines) | Routing backbone only — returns `{ id: params.id, lang: pathLocale(url.pathname) }`. NO data fetch (all `/v1` reads happen client-side in `RouteDetail`). |
| Legacy shim | `src/routes/[[lang=locale]]/route/[id]/+server.ts` | `GET`/`HEAD` → `redirect(301, …/lines/{encodeURIComponent(id)}{search})`. Preserves locale prefix + query string. Correct 301 + HEAD parity. |
| Feature screen | `src/lib/features/lines/RouteDetail.svelte` (715 lines) | Owns the `EntityDetail` tabbed scaffold + all data loads. 3 tabs: Detail / Schedule / Reliability. |
| Reliability orchestrator | `src/lib/features/lines/reliability/RouteReliabilityClusters.svelte` (916 lines) | The Reliability tab body: control spine + 5 stacked bands. |
| Sections | `src/lib/features/lines/reliability/sections/Section{0..4}*.svelte` | The 5 rider-question bands (§0 has no heading offset — see below). |

Note: there is a NO-DATA-fetch loader, so the initial paint is skeleton-driven per pane (via `ResourceBoundary` + `createResource`). There is no SSR seed of the entity — the breadcrumb leaf and SEO leaf are the raw URL id, not the line name (`EntityDetail.svelte:55-63` documents this as a tracked follow-up).

---

## 1. SECTION ORDER + STORY ARC

The page is TWO nested stories: (a) the top-level 3-tab scaffold, and (b) within the Reliability tab, a 5-section vertical narrative. A first-time reader lands on the **Detail** tab (default), NOT reliability.

### 1a. Top-level tabs (`RouteDetail.svelte:256-487`)

| Order | Tab | Component / data source | Reader question answered |
|---|---|---|---|
| Header | Line id + map link | `SectionHeading level={1}` + `MapDrilldownLink` (`RouteDetail.svelte:262-271`) | "Which line am I on? Show it on the map." |
| Tab 1 (default) | **Detail** | `getRoute(id)` static → `LineDirections` + live roster + `AffectedAlerts` (`RouteDetail.svelte:274-402`) | "Where does this line go (stops per direction), which buses are on it right now, any alerts?" |
| Tab 2 | **Schedule** | `getRoute(id)` static → first/last departure + service periods (`RouteDetail.svelte:403-478`) | "What's the PLANNED service — first/last bus, headway per period?" |
| Tab 3 | **Reliability** | `getRouteReliability(id)` historic → `RouteReliabilityClusters` (`RouteDetail.svelte:479-485`) | "Can I actually count on this line?" |

**Tab-arc problem:** the emotional payload of the page — the reliability verdict ("Can you count on this line?") — is on the THIRD tab, behind a click, and is NOT the default. The default Detail tab is a live-ops utility (stops + current buses), which is the shallowest story. A portfolio case-study page would either (i) surface a reliability verdict headline ABOVE the tabs, or (ii) make Reliability the default. Today the story opens on plumbing, not on the answer. The tab is deep-linkable via `?tab=` (`RouteDetail.svelte:88-99`), so a marketing/case-study link can jump straight to reliability — but the un-parameterised canonical URL does not.

### 1b. Reliability tab internal arc (`RouteReliabilityClusters.svelte:571-638`)

Control spine first (grain rail: Today / This week / This month / Date range + a jump-to TOC), then a hazard-tape separator, then 5 bands top-to-bottom. Each band is a `CollapsibleSection` (open by default, `CollapsibleSection.svelte:39`) with a mono eyebrow + a display-scale plain-language question, a PRIMARY always-visible chart, and a progressive-disclosure `<Detail>` expander for analyst depth.

| # | id / anchor | Component | Question (en, `reliability.copy.ts:715-724`) | Data selector(s) | Windowed? |
|---|---|---|---|---|---|
| §0 | `rel-verdict` | `Section0Verdict.svelte` | "Can you count on this line?" | `selectVerdict` + punctuality headline (OTP/avg/p50/p90/severe) + `selectPunctualityTrend` + `selectPunctualityDistribution` | ↻ always (trend) |
| §1 | `rel-when-to-ride` | `Section1WhenToRide.svelte` | "When is it good, and when does it fall apart?" | `selectHabitsHeatmap` (7×24), `selectBestTimeInsight`, `selectPunctualityTimeOfDay`, `selectPunctualityCrosstab`, `selectWeekdayCycle`, `selectShiftBars` | mixed (heatmap ∞, breakdowns ↻ via `clusters.punctuality.windowed`) |
| §2 | `rel-the-wait` | `Section2TheWait.svelte` | "How long will you wait, and do buses bunch?" | `selectHeadwayDumbbell`, `selectShiftBars` ×3, `selectDirectionAsymmetry`, `selectServiceSpan`, `meanPriorDelta` | ↻ via `clusters.waitRegularity.windowed` |
| §3 | `rel-run-and-fit` | `Section3RunAndFit.svelte` | "Will the bus run, and will you fit?" | `completeness()` (cancel/skip rates), `selectOccupancyShare`, `selectCrowdingDelay` | ↻ always |
| §4 | `rel-worst-stops` | `Section4WorstStops.svelte` | "Where does the delay pile up?" | `selectWeakStops` (worst-N lollipop) | ↻ via `clusters.punctuality.weakStopsWindowed` |

**Internal arc verdict — this part is genuinely strong.** It IS a context→evidence→verdict story done right: §0 leads with a text-led plain-language verdict sentence + BAN ("Ran reliably today, about 8 in 10 trips on time (78%, 95% sure between 71 and 84%); 2 in 10 ran late.", `reliability.copy.ts:734`), then each subsequent section frames a rider question, shows a PRIMARY chart, and hides analyst depth behind a `<Detail>` expander. The rider-question IA (context first, then evidence) is exactly the case-study spine.

**Where the internal story stalls / breaks:**

1. **Two competing narratives with no bridge.** The Detail/Schedule tabs (live + planned) and the Reliability tab (historic) never reference each other except one line: the schedule intro points to the Reliability tab (`lines.copy.ts:190-191`, `262-263`). But the Reliability tab never points back to "see current buses" or the schedule. A reader on Reliability has no thread back to the live picture. The three tabs read as three separate mini-apps, not one story about one line.

2. **§0 verdict has a documented HOLE.** The plain-language two-sided verdict sentence exists (`selectVerdict`), but §0's file header (`Section0Verdict.svelte:18-20`) and §1's (`Section1WhenToRide.svelte:23-25`) both carry a "NOTE (Phase 2)" that the verdict SENTENCE lands "once the verdict rules engine is built" — some of the promised narrative glue is still Phase-1 framing. §1's takeaway sentence (`bestTimeText`) IS built (`Section1WhenToRide.svelte:117-128`), but the header comment implies the section-level verdict language is partial.

3. **Grain rail scope confusion is patched with copy, not design.** §1's heatmap reads FULL history regardless of the window, so "Today" and "This week" render identically. The team papered over this with an explicit note ("today and this week look the same — explain why", `Section1WhenToRide.svelte:413-419`) + a ∞/↻ scope glyph on the TOC (`RouteReliabilityClusters.svelte:517-522`). Functional, but the reader must decode a scope glyph — a story break the UI explains rather than avoids.

4. **No cross-line context.** Every number is absolute or relative-to-this-line. There is no "this line ranks Nth of 200 for reliability" or "worse than the network median" anywhere on the surface. The verdict says "reliable/patchy/unreliable" against a fixed 80% SLA, but a rider cannot tell if this line is typical or an outlier. For an A++ case-study the missing beat is comparative context.

5. **Missing closing beat.** The story ends on §4 "Where it's worst" (a worst-stops lollipop) — an accountability note, not a resolution. There's no "so what / what next" (e.g. "try direction X instead", "ride at 10am not 5pm" as a consolidated takeaway). §1 and §2 each earn a one-line takeaway callout, but the page never gathers them into a single verdict-plus-advice close.

---

## 2. CHROME (headers, sticky, rails, offsets)

- **Masthead** (`EntityDetail.svelte:77-89`): breadcrumb (only when trail>1) + back link ("← Lines") + station-voice kicker ("LINE"/"LIGNE") + the surface header snippet. Inside `<Surface width="bleed">` — fills the rail-inset `<main>` edge-to-edge, keeps the page gutter `--space-page-x`.
- **Line header** (`RouteDetail.svelte:262-271`): `SectionHeading heading={id} level={1} dot` (the brand orange dot) + a `MapDrilldownLink`. Laid out `.route-detail-head` flex space-between, collapses to column below 520px (`RouteDetail.svelte:683-688`).
- **Tabs** (`EntityDetail.svelte:93-112`): `TabsList variant="line"`, full-width, left-justified. Active tab = metro-signage chip (`--signage-*`, theme-invariant amber-on-dark). Tabs are NOT sticky — they scroll away.
- **Hazard-tape separator** between masthead and tabs (`EntityDetail.svelte:91`), and another below the reliability control rail (`RouteReliabilityClusters.svelte:569`).
- **Reliability grain rail** (`RouteReliabilityClusters.svelte:535-549`): `SurfaceControls sticky`. Desktop-only sticky. **Offset:** the surface sets `--rail-sticky-top: 0px` (`RouteReliabilityClusters.svelte:656`), overriding the shared default of `5.5rem` (`ControlsRail.svelte:122`, `top: var(--rail-sticky-top, 5.5rem)`). The comment explains this surface's scroll container already begins below the app nav, so 0 pins it flush. `z-index: var(--z-rail)` lifts it above scrolling data marks.
- **`--chrome-offset`:** NOT used anywhere in `src/` (grep clean). The surface uses `--rail-sticky-top` + `scroll-margin-top: 7rem` on each band (`RouteReliabilityClusters.svelte:853`) so a TOC jump-to clears the sticky rail.
- **Mobile floating pills** (`RouteReliabilityClusters.svelte:554-566`): below `lg` the sticky rail is hidden (`max-width: 1023.98px` → `display:none`, lines 823-827) and replaced by a floating `ReliabilityFilterPill` (grain drawer) + `TocPill` (section jump-to that tracks the active section via IntersectionObserver). Exactly one controls affordance at every width.

---

## 3. CONTAINERS (max-widths, grids, padding rhythm)

- **Surface width** = `bleed` (full `<main>` width, no reading-column cap on the dashboard itself). No page-level `max-width` — this is a data dashboard, by design (`EntityDetail.svelte:66-76`).
- **Detail tab** uses `ListDetailGrid listWidth="360px"` (`RouteDetail.svelte:283`): desktop = `[360px list][1fr detail]` grid at ≥1024px; below that it STACKS (list first). The list column stands down entirely when there's no live bus AND no alert (`hasListColumn`, `RouteDetail.svelte:215`) → directions take full width.
- **Schedule tab**: a `@container route-schedule` (`RouteDetail.svelte:650-653`); at ≥40rem container width the grid splits `minmax(0,18rem) minmax(0,1fr)` (`674-681`), else stacked. Service-period cards are a `repeat(auto-fit, minmax(min(14rem,100%),1fr))` grid at ≥640px (`637-641`).
- **LineDirections**: its own `@container line-directions`; two directions side-by-side at ≥44rem container width (`LineDirections.svelte:131-138`), auto-fit collapses to one column for a single-direction route.
- **Reliability bands**: `.reliability-clusters` gap `clamp(3rem, 7vw, 5rem)` — the deliberately-large between-section rhythm (`RouteReliabilityClusters.svelte:646-650`). Each band is `.surface-bleed` (negative-margin escape) re-padded with `padding-inline: var(--space-page-x)` (`843-854`) so content edges land back on the gutter line. Bands after the first carry a hairline top rule + extra top pad `clamp(1.75rem,4vw,2.75rem)` (`866-869`).
- **KPI tiles**: `repeat(auto-fit, minmax(min(11rem,100%),1fr))` (§0, `Section0Verdict.svelte:307-311`) / `minmax(min(13rem,100%),1fr)` (§3, `Section3RunAndFit.svelte:575-579`) — never below one column on a phone.
- **Reading measures**: captions capped at ~52ch, insight callouts ~60-64ch, verdict sentence 60ch (`VerdictBanner.svelte:69`), section title `max-inline-size: 28ch` with `text-wrap: balance` (`RouteReliabilityClusters.svelte:912-913`).
- **Graph cards**: each `[data-card]` inside a band gets a hairline frame + `padding: clamp(0.9rem,2.2vw,1.35rem)`; the PRIMARY card gets an orange left rule (`--border-rule`) (`RouteReliabilityClusters.svelte:875-885`).

---

## 4. HEADINGS (hierarchy sanity)

Levels top-to-bottom:

- **h1** = the line id — `SectionHeading level={1}` (`RouteDetail.svelte:267`). Correct single page title.
- **h2** = each reliability section title — `CollapsibleSection` wraps the eyebrow+question in a real `<h2>` (`CollapsibleSection.svelte:51`, WAI accordion pattern, correct). So the 5 reliability sections are all h2.
- **Detail / Schedule tab section labels** ("Directions", "Service periods", "Buses in service", "Service span") are rendered via `SectionLabel` — which is a styled `<span>`/mono eyebrow, **NOT a heading element**. So on the Detail and Schedule tabs there are NO h2/h3 headings at all between the h1 and the content: the sub-section labels are non-semantic.
- **Within reliability sections**, the chart-block titles ("On-time", "The wait by shift", etc.) are also `SectionLabel` spans, not h3. `.section-question` is the visually-huge title but it lives inside the h2 button.

**Verdict — hierarchy is technically valid (h1 → h2, no skips), but SHALLOW and INCONSISTENT across tabs.**
- On the Detail/Schedule tabs the document outline is just `h1` (line id) with everything else as non-heading `SectionLabel` spans → a screen-reader heading-nav user gets ONE landmark on those two tabs.
- On the Reliability tab, the 5 h2 section titles give a good outline, but the ~20 chart-block sub-titles are `SectionLabel` spans, so there is no h3 layer — a user cannot heading-jump within a section.
- The kicker ("LINE") and all metric labels are `SectionLabel` spans by design (mono eyebrows), which is fine, but it means the only real headings are h1 + five h2. No h4/h5/h6 anywhere. No skipped levels (no h1→h3 jump), so no WCAG 1.3.1 order violation — the gap is DEPTH, not order.

---

## 5. ABSENCE STATES

The surface has a mature honest-absence system and uses it heavily, but there are a few leaks.

**Well-handled (styled absence, says WHY):**
- Whole-section empties render `AbsentValue variant="block" reason="no-observations"` — §1 (`Section1WhenToRide.svelte:396-398`), §2 (`Section2TheWait.svelte:680-683`), §3 (`Section3RunAndFit.svelte:373-376`, plus per-sub-block at 388-392, 447-451), §4 (`Section4WorstStops.svelte:154-159`).
- Per-value absence uses `MaybeValue`/`AbsentValue` with a reason: §0 distribution readouts (`Section0Verdict.svelte:267-273`, `294-296`), §2 direction table cells (`Section2TheWait.svelte:817-829`), §3 weekday/weekend + per-DOW crowding cells (`Section3RunAndFit.svelte:500-513`, `530-534`).
- `MetricBullet` renders `MaybeValue reason="no-observations"` + NO bar for a null value (`MetricBullet.svelte:54-63`) — never a fabricated 0-length bar.
- `MetricDisplay` on the schedule tab passes `emptyLabel` + `absentReason="not-in-schedule"` (`RouteDetail.svelte:419-426`, `429-437`) and §2 span tiles pass `absentReason="no-observations"` (`Section2TheWait.svelte:865-907`).
- Detail-tab live gaps: roster null delay → `t.roster.noData` ("No data", never 0, `RouteDetail.svelte:227-230`); per-stop "no live bus" placeholder (`LineDirections.svelte:96-98`); the inferred-reason absence note (metro/closed/silent) via `inferAbsenceReason` + `EdgeState emptyReason` (`RouteDetail.svelte:171-182`, `385-393`).
- ResourceBoundary routes a null load (HTTP 404) to the empty edge state, not an error (`RouteDetail.svelte:12-13`; `ResourceBoundary.svelte` render priority).

**LEAKS / gaps found:**

1. **Schedule tab — empty `service_periods` is a SILENT GAP (no absence chip).** `RouteDetail.svelte:447-473`: the "Service periods" `SectionLabel` renders, then `{#if (file.service_periods ?? []).length > 0}` renders the list — but there is **NO `{:else}`**. If a route file has zero service periods, the reader sees the label with nothing beneath it (blank), not an `AbsentValue`/"no data" chip. This is a bare-absence leak — the label promises data that isn't stated-absent.

2. **Schedule tab — no whole-tab empty state.** If `first_departure`, `last_departure` AND `service_periods` are all empty, the tab renders two `MetricDisplay` "no data" tiles + the orphan "Service periods" label + the intro paragraph. There's no consolidated "no schedule published" state; the intro paragraph still claims to describe the schedule.

3. **§1 heatmap-note / §3 window-caption never null-guard the window copy** — these are always-present strings, not a leak per se, but the ramp-in note (`Section3RunAndFit.svelte:385`) is shown even when data exists, which is intended but can read as a permanent caveat.

No bare `—`/`null`/`NaN` leaks were found in the numeric formatters — every `min()`/`pct()`/`count()` returns `null` on absence and every consumer routes null through `MaybeValue`/`AbsentValue`/`emptyLabel`. The one structural leak is #1 (empty `service_periods`).

---

## 6. EXPLAINER LINKS (do metrics link to `/metrics`?)

**Yes — comprehensively, and correctly first-party.** Every metric label on the Reliability tab AND the Schedule tab carries a `MetricInfo` (i) affordance.

- `MetricInfo.svelte` is a hand-rolled click/focus popover (not a tooltip, so it can host a focusable link, `MetricInfo.svelte:8-11`). It shows a one-line tip + a link "How this is measured".
- The link target is `/metrics#<anchor>` resolved via `metricInfoFor` → `localizeHref('/metrics', locale) + '#' + entry.anchor` (`metrics.content.ts:1236`). First-party SPA nav, same-tab, back-button friendly (`MetricInfo.svelte:4-6`).
- Anchors are defined per metric in `metrics.content.ts` (`otp`, `avg-delay`, `p50-p90`, `severe`, `weak-stops`, `regularity`, `headway`, `excess-wait`, `cancellation`, `skipped-stop`, `service-span`, `occupancy`, `habits`, `seasonality`; plus supplemental keys mapping to `metrics-provenance`).
- Wired in every section: §0 (otp/avgDelay/p50p90/severe, `Section0Verdict.svelte:188-191`), §1 (habits/otp/severe/seasonality), §2 (headway/regularityCov/excessWait/serviceSpan), §3 (cancellation/skippedStop/occupancy), §4 (weakStops), and the Schedule tab (serviceSpan/headway via `scheduleInfo`, `RouteDetail.svelte:244-254`).

**Gaps:** the Detail tab (directions + live roster) has NO explainer links — but those are live-ops readouts, not statistical metrics, so this is defensible. The §0 verdict SENTENCE itself and the §1/§2 takeaway callouts have no (i) — a reader cannot deep-link "how is the verdict computed". Minor.

---

## 7. MOBILE-390 READ (from code)

**Breakpoints in the cluster** (census): `min-width: 640px`, `768px`, `1024px`; `max-width: 520px`, `28rem` (448px), `1023.98px`; container queries `route-schedule (min-width:40rem)`, `line-directions (min-width:44rem)`. Plus §0/§3 KPI RAM grids and `--dataviz` chart scaling. At 390px: all `min-width` desktop rules are OFF, all `max-width` mobile rules are ON.

**Layout at 390px:**
- Tabs stay a horizontal `TabsList` with `min-width: max-content` per tab (`EntityDetail.svelte:128`) — 3 short tab labels fit; no overflow expected.
- Line header collapses to column (`max-width: 520px`, `RouteDetail.svelte:683-688`) — heading + map link stack. Good.
- Detail tab: `ListDetailGrid` stacks (list first, then directions). `LineDirections` is one column (below the 44rem container threshold). Schedule grid stacked; service-period cards one column (below 640px).
- Reliability: sticky rail hidden, floating `ReliabilityFilterPill` + `TocPill` take over. Bands full-bleed re-padded to the gutter.

**Overflow risks at 390px:**
1. **§1 7×24 heatmap** — the widest element on the page. Mitigated: horizontal scroll + a frozen day-label gutter live INSIDE the mark (ScrollFrame), and the wrapper only bounds width (`Section1WhenToRide.svelte:515-521`, `max-width:100%`). So it scrolls inside its own frame, not the page body. Lowest-risk of the charts.
2. **§2 direction table** — reflows to stacked label/value rows under 28rem (448px) via a `display:block` + `::before content:attr(data-col)` pattern (`Section2TheWait.svelte:1102-1142`). At 390px this is ON → no clip. Good.
3. **§2 headway dumbbell + §1 crosstab lines + §4 lollipop** — LayerChart marks. They use SHORT shift labels on narrow axes (`Section1WhenToRide.svelte:327` crosstab uses `shiftLabelShort`; `Section2TheWait.svelte` dumbbell uses full `shiftLabel`). The §2 dumbbell keeps FULL shift labels ("AM peak"…) — on a 390px axis these are the most likely to crowd/truncate. Chart sizing strategy is delegated to the `<Chart>`/LayerChart primitive (responsive via container), not inspected here, but the code comments repeatedly flag phone-width shift-label overlap as the reason short labels were chosen elsewhere — the dumbbell is the one that DIDN'T switch to short, a residual risk.
4. **`.line-stop-name`** uses `white-space: nowrap; text-overflow: ellipsis` in a `2ch / 1fr / auto` grid (`LineDirections.svelte:196-202`, `177-178`) — long Montréal stop names ellipsis rather than overflow. Safe, but the live-readout column (`.line-stop-live`, grid-column 2, `LineDirections.svelte:206-213`) sits UNDER the name in the same grid track — on a very narrow phone the ETA + delay chip + "no live bus" could compete for the 1fr track. Micro-text (`--text-micro`), likely fits, low risk.
5. **Reliability TOC desktop nav** forces `flex-wrap: nowrap; overflow-x: auto` at ≥768px (`RouteReliabilityClusters.svelte:811-819`) so a long locale scrolls rather than wraps — but at 390px the desktop nav is hidden entirely (pills instead), so N/A.

**Touch-target sizes (from classes):**
- Roster bus link: `padding: 0.4rem 0.5rem` (`RouteDetail.svelte:565`) → ~thin; the row height depends on RankedRow content, likely ≥40px but the pad alone is small.
- Roster "map" pill: `padding: 0.3rem 0.6rem` (`RouteDetail.svelte:599`) — SMALL, likely under 44px tall. **At-risk touch target.**
- TOC chip links: `min-height: 28px` explicit (`RouteReliabilityClusters.svelte:752`) — **below the 44px guideline** (but desktop-only; on mobile the TocPill replaces them).
- Line-stop link: `padding: 0.5rem` + grid content (`LineDirections.svelte:183`) — roughly ok (~44px with a body-text row).
- MetricInfo (i) trigger: `1.05rem × 1.05rem` (~17px, `MetricInfo.svelte:331-332`) — **well below 44px**; this is a hit-target concern on touch across EVERY metric label (there are ~20 on the reliability tab).
- Section collapse toggle: full-width button, generous (`CollapsibleSection.svelte:84-96`) — good.
- Detail tabs: `padding: 0.5rem 1rem` (`EntityDetail.svelte:133`) — ok.

**Sticky behavior on mobile:** the reliability rail's sticky is desktop-only (`@media min-width:1024px` in ControlsRail); at 390px NOTHING is sticky — the floating pills are `position:fixed` overlays instead. The tabs are never sticky at any width, so on a long reliability scroll the reader loses the tab bar (must scroll back up to switch tabs). Minor wayfinding cost.

**Mobile risk level: LOW-MEDIUM.** The hard cases (heatmap scroll-frame, direction-table reflow) are explicitly solved. Residual risks are (a) sub-44px touch targets on the ~20 (i) triggers + roster map pills, and (b) the §2 dumbbell keeping full shift labels on a narrow axis. Nothing overflows the page body.

---

## 8. TOP 5 GAPS vs an A++ portfolio case-study page

1. **The verdict is buried behind a tab and is not the default.** The page's strongest asset — the plain-language reliability verdict ("Can you count on this line?") — sits on tab 3, un-defaulted; the page opens on live plumbing (stops + current buses). A case-study page leads with the answer. Fix: hoist a one-line verdict headline above the tabs (or default to Reliability), so the reader gets the payoff on landing. (`RouteDetail.svelte:82-97`, `256-271`.)

2. **No comparative / ranking context anywhere.** Every metric is absolute or self-relative; there is no "this line is Nth of ~200 / worse than the network median / among the 10 least reliable". A rider cannot tell if 78% on-time is good for this network. The `/lines` index already sorts by "least reliable", so the data exists. Adding a single "ranks Nth for reliability" beat to §0 would convert a data readout into a story with stakes.

3. **Three tabs read as three apps with one thread.** Only the schedule→reliability pointer links them (`lines.copy.ts:190-191`); there's no reliability→live or reliability→schedule bridge, and no shared header verdict that ties the live/planned/historic views into one narrative about the line. A case-study page has ONE spine; this has three parallel ones.

4. **Shallow, inconsistent heading outline + sub-44px touch targets.** The Detail/Schedule tabs expose only an h1 (all sub-labels are non-semantic `SectionLabel` spans); the reliability chart sub-titles have no h3 layer. Combined with ~20 (i) triggers at ~17px and 28px TOC chips, the surface is a11y/touch-shallow relative to an A++ bar. Fix: promote sub-block labels to real headings; enlarge (i) hit areas to 44px.

5. **The story lacks a closing "so what / what next."** It ends on §4 accountability (worst stops), not a resolution. §1 and §2 each earn a takeaway callout, but they're never gathered into a single "best way to ride this line" close (e.g. "avoid weekday PM peak; the ride home waits longer; stop X is the worst" as one consolidated advice card). Plus the one hard absence leak — empty `service_periods` renders a blank under the label (`RouteDetail.svelte:447`, no `{:else}`) — is exactly the kind of unpolished edge a portfolio reviewer catches.

---

## Appendix — component inventory (surface-specific vs shared)

**Surface-specific (deep-dived):** `RouteDetail.svelte`, `RouteReliabilityClusters.svelte`, `Section0Verdict`–`Section4WorstStops`, `CollapsibleSection`, `VerdictBanner`, `MetricBullet`, `LineDirections`, `ReliabilityFilterPill`, `lines.copy.ts`, `reliability.copy.ts`, `Cluster05Habits.copy.ts`, the `selectors/*` + `clusters.ts` (view-model layer).

**Shared (noted, not deep-dived):** `EntityDetail`, `ListDetailGrid`, `SectionHeading`, `SectionLabel`, `MetricDisplay`, `MetricInfo`, `SurfaceControls`/`ControlsRail`/`GrainPicker`/`DateRangePicker`, `TocPill`, `Separator`(hazard), `ResourceBoundary`, `EdgeState`, `AbsentValue`/`MaybeValue`, `AffectedAlerts`, `MapDrilldownLink`, `FreshnessStamp`, `RankedRow`, `Chart`(LayerChart), `ChartLegend`, `DeltaStat`.
