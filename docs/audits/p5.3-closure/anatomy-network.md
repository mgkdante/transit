# Surface Anatomy — `/network` (Network health)

Route: `apps/web/src/routes/[[lang=locale]]/network/+page.svelte` (thin mount, 632 B).
Mounts `NetworkSurface` from `apps/web/src/lib/features/network/reliability/index.ts:9`.
Orchestrator: `apps/web/src/lib/features/network/reliability/sections/NetworkSurface.svelte` (611 lines).
Copy: `apps/web/src/lib/features/network/reliability/network-reliability.copy.ts`.

- **No `+page.ts` / no `+page.server.ts`** for `/network` — thin mount by contract (slice-9.3 comment in `+page.svelte:1-10`). All data loads client-side from the `/v1` context booted once in the root layout.
- Root layout: `apps/web/src/routes/+layout.svelte` (AppShell + i18n + v1 context + SEO/JSON-LD + PWA + chrome search).
- Shell: `apps/web/src/lib/components/shell/AppShell.svelte` (fixed TopBar + LeftRail overlay + persistent `<main>` map-stage zone).

---

## (1) SECTION ORDER + STORY ARC

The surface is split into two `<section class="network-region">` landmarks: **LIVE now** and **HISTORIC trend**, separated by hazard `Separator`s.

### Head (NetworkSurface.svelte:394-419)
- `Surface width="bleed"` → `SurfaceHeader` with `kicker` "NETWORK · LIVE" / heading "Network health" / `lede` (the honesty promise: "a missing signal shows as 'no data', not a fabricated zero").
- Feed-health row: `FreshnessStamp variant="live"` (snapshot-publish age) + a **second** worker-feed-age chip (`feed_freshness_s + live.ageSeconds`, NetworkSurface.svelte:149-153, 405-414) + `ConformanceBadge` (provenance verdict).
- Reader question answered: *"Is this data live and trustworthy right now?"* — strong opening.

### LIVE region (NetworkSurface.svelte:431-461) — station label "Live now"
| # | Heading (SectionLabel span) | Component | Data source / selector |
|---|---|---|---|
| L1 | (region has 4 unlabeled glance cards) | `SectionLiveHeadline` | `selectHeadlineKpis(live.network).headline` → on_time_pct · coverage_pct · delay_p50 · delay_p90 (`selectors/headlineKpis.ts:55-80`) |
| L2 | "Reporting & coverage" | `SectionReporting` | `selectHeadlineKpis(...).reporting` (vehicles_in_service, non_responding) + `selectSilentByRoute(non_responding_by_route)` ranked list + global-signal caveat |
| L3 | "Status mix" / "Crowding" | `SectionStatusMix` | `selectStatusMix(status_dist)` + `selectOccupancyMix(occupancy_mix)` — 100%-stacked ChartSpecs; each band links to `/map` pre-filtered |
| L4 | "Delay distribution" | `SectionDelayHistogram` | `selectDelayHistogram(delay_histogram, p50, p90)` — signed 8-bucket histogram, median+p90 rules |

Fallbacks: `live.error` → `EdgeState variant="error-v1"` with retry; pre-first-tick → `EdgeState variant="skeleton"` (NetworkSurface.svelte:452-460).

### HISTORIC region (NetworkSurface.svelte:468-576) — station label "Historic trend"
Controls rail first (grain day/week/month via `SurfaceControls`, or `ControlsRail` when only one grain populated), then a `DashboardGrid minTile=360px`:

| # | Heading (SectionLabel span) | Component | Data source / selector |
|---|---|---|---|
| H1 | "Daily trend" (+ "Vehicles reporting each day") | `SectionTrend` (grid `1 / -1` full-width) | `selectTrendChart(windowed, effectiveRetard)` + `selectVehiclesSpark(windowed)` — dual-axis OTP% vs p90/avg delay, OTP-zoom domain |
| H2 | "Cancellations" | `SectionCancellations` (gated `hasCancel`) | `selectCancelTrend(windowed)` — single-series % + latest ExplainedMetricCard |
| H3 | "Service delivered" | `SectionCompleteness` (ALWAYS rendered) | `selectCompleteness(windowed)` — GC2 service_completeness_rate, null on prod today (ramp-in absence chip) |
| H4 | "Crowding by day" | `SectionCrowdingByDay` (gated day-grain + non-empty) | `selectOccupancyTrend(windowed)` — one 100%-stacked strip per day |
| H5 | "By time of day" | `SectionByTimeOfDay` (gated `hasShift`) | `selectShiftRank(trend.data.by_shift)` — ranked OTP list, severe-share bars |
| H6 | "Weekday vs weekend" | `SectionWeekday` (gated `hasDayType`) | `selectShiftRank(trend.data.by_daytype)` |

**Section count:** ~10 discrete section blocks (4 live + 6 historic) under 2 region landmarks; ~22 `SectionLabel` titles total.

### STORY-ARC ASSESSMENT
**Verdict: strong evidence layer, weak narrative spine — it reads as a well-built *dashboard*, not a *story*.** Context→evidence→verdict is missing at every scroll depth.

- **Context is present but abstract.** The lede sets an honesty frame, not a question. There is no "here's how the network is doing today" one-line verdict up top — the reader must synthesize 4 numbers into a judgment themselves.
- **Evidence is excellent and honest.** Every metric is measured from `/v1`, absences are styled, doctrine domains are fixed, every number has an (i) explainer. This is the surface's strength.
- **No verdicts anywhere.** Nothing says "on-time is *good/bad* vs its own baseline", "cancellations are *rising*", "the network is *healthier than last week*". The OTP-zoom domain (SectionTrend.svelte:11-18) is engineered to *show* week-over-week movement but the surface never *states* the direction. Compare: memory notes call for "InsightCard verdicts" — not yet on this surface.
- **The two regions don't connect.** LIVE ("right now") and HISTORIC ("trend") are two separate stories glued by a hazard bar. A reader gets no bridge sentence ("today's 88% sits inside the recent 87–89% band").
- **Story stalls at L3/L4.** After the 4-KPI hit + the reporting row, momentum drops into two distribution bars and a histogram that are *shape* readouts with no takeaway — visually dense, narratively flat.
- **Ordering is defensible** (live→historic, headline→detail) but the historic grid is an *un-prioritized tile field*: Daily trend (the hero) is full-width, but Cancellations / Completeness / Crowding / Shift / Weekday are equal-weight auto-fit tiles with no rank, so the reader has no guided path.
- **Missing for a story read:** (a) a one-line network verdict/health-summary at the top; (b) directional deltas ("↑ 1.2pts vs 7d ago") on the KPIs; (c) a bridge between live and historic; (d) an ordered narrative through the historic tiles rather than a grid.

---

## (2) CHROME — headers, sticky elements, offsets, rails

- **TopBar** (`components/shell/AppShell.svelte:253`): full-width, sits ABOVE `.app-shell-row` in the `h-dvh flex-col` shell. It is NOT inside the scroll container. Height ~60px ("TopBar (h60)", AppShell.svelte:7).
- **Scroll container:** the shell `<main>` (`app-shell-main`, `overflow-hidden`, AppShell.svelte:279) contains the root layout's `#main` div which is `overflow-y-auto` (`+layout.svelte:480-484`). **`#main` is the real scroll container for document surfaces** and it begins BELOW the TopBar.
- **LeftRail overlay** (AppShell.svelte:291): draggable/collapsible nav overlay, `≥1024px` only (mobile uses TopBar burger). Non-map surfaces pad clear of it via `--app-left-rail-offset` (AppShell.svelte:397-399).
- **Footer** (`+layout.svelte:503-509`): rendered at natural bottom of the scroll flow (network is not full-bleed → footer present).

### Sticky rail — THE OFFSET BUG (medium severity)
- Historic controls use `SurfaceControls sticky` (NetworkSurface.svelte:493-504) → `ControlsRail sticky` → `position: sticky; top: var(--rail-sticky-top, 5.5rem)` (`components/layout/ControlsRail.svelte:197-206`).
- The `5.5rem` default assumes a **window-scrolled** page. But the network surface's scroll container (`#main`) already begins *below* the TopBar. The ControlsRail comment itself (lines 199-204) documents this: *"A surface whose scroll container already begins below the app nav (the reliability dashboard) sets it to 0 so the rail pins FLUSH under the header — not floating ~88px below it."*
- **The lines surface does this correctly** (`RouteReliabilityClusters.svelte:656`: `--rail-sticky-top: 0px;`). **The network surface does NOT set `--rail-sticky-top` anywhere** (grep of `lib/features/network/` = NONE). So the network sticky control rail pins ~88px too low, with scrolling content bleeding through the gap above it. This is a real, code-visible defect.
- **`--chrome-offset`:** searched the whole web `src` — **not used anywhere** (0 hits). The chrome-offset concept here is `--rail-sticky-top` / `--app-left-rail-offset`, not a `--chrome-offset` var.

---

## (3) CONTAINERS — max-widths, grids, padding rhythm

- **Outer:** `Surface width="bleed"` (NetworkSurface.svelte:394) → `--surface-maxw: none` (`layout/Surface.svelte:26-28`). The surface is UNCAPPED width — it fills the full content column (rail-inset) at any viewport. Padding: `padding-inline: var(--space-page-x)` (gutter on) + `padding-block: clamp(1.5rem, 4vw, 2.5rem)`; region gap `clamp(1.75rem, 4vw, 2.75rem)` (Surface.svelte:43-56).
- **DashboardGrid** (`layout/DashboardGrid.svelte:333`): `repeat(auto-fit, minmax(min(var(--min-tile), 100%), 1fr))`, gap `--space-card-gap`.
  - Live headline: `minTile=220px` (SectionLiveHeadline.svelte:43) → 4-up desktop, 1-up phone.
  - Reporting cards: `minTile=220px` (SectionReporting.svelte:59).
  - Status/Crowding: `minTile=320px` (SectionStatusMix.svelte:44).
  - Historic board: `minTile=360px align=start gutter=false` (NetworkSurface.svelte:522) — `align=start` lets tiles take natural height (deliberate, uneven content).
- **Full-width escape:** `SectionTrend` uses `.network-tile--wide { grid-column: 1 / -1 }` at `≥1024px` (SectionTrend.svelte:89-93); `SectionDelayHistogram` is its own `width:100%` section outside the grid.
- **Tile chrome (repeated in EVERY section — duplication):** `.network-tile { padding: 1rem; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card); gap: 0.75rem }` is copy-pasted verbatim into SectionStatusMix, SectionDelayHistogram, SectionTrend, SectionCancellations, SectionCompleteness, SectionCrowdingByDay, SectionByTimeOfDay, SectionWeekday (8 copies). No shared tile primitive.
- **Padding rhythm** is consistent (1rem tiles, 0.75rem inner gaps, mono captions at `--text-small`).

---

## (4) HEADINGS — hierarchy sanity (CRITICAL GAP)

- `SurfaceHeader` → `SectionHeading level=1` (`surface/SurfaceHeader.svelte:400`, `SectionHeading` renders `<h{level}>`, brand/SectionHeading.svelte:34-38). This is the **only real heading element on the surface — a single `<h1>`**.
- **Every other section title is a `SectionLabel`, which renders a `<span>`, NOT a heading** (`brand/SectionLabel.svelte:38-41`). Confirmed: grep of `sections/` for `SectionHeading|<h1..h6|role="heading"` = **ZERO matches**; `SectionLabel` appears 22× across the sections.
- Result: the document outline is `h1` → (nothing). "Live now", "Reporting & coverage", "Status mix", "Crowding", "Delay distribution", "Daily trend", "Cancellations", "Service delivered", "Crowding by day", "By time of day", "Weekday vs weekend" are all visually-styled spans with **no heading semantics and no h2/h3 outline**.
- Partial mitigation: the two regions are `<section aria-label>` landmarks (NetworkSurface.svelte:432, 468) and `SectionReporting` is a named `<section>` (SectionReporting.svelte:51-55). But landmark-labeling ≠ a heading outline; screen-reader users navigating by heading (H key) get one stop and then nothing.
- **Skipped levels:** N/A (there are no h2-h6 at all — the problem is *absent* levels, not skipped ones). This is the single biggest a11y/semantic defect on the page.
- **`SectionDelayHistogram`'s `<section>` (line 45) has NO `aria-label`** → an unnamed landmark (minor a11y noise).

---

## (5) ABSENCE STATES — how missing data is shown

Strong and consistent — this surface is the honest-absence exemplar.
- **KPIs:** `ExplainedMetricCard` → `MetricDisplay` → `AbsentValue variant="inline"` when value is null, driven by a typed `absentReason` + `locale` (`brand/MetricDisplay.svelte:81-86`; `dataviz/ExplainedMetricCard.svelte:100-109`).
  - Headline: `absentReason='not-reported'` on all 4 (selectors/headlineKpis.ts:60-78).
  - Cancellations / Completeness: `absentReason='no-observations'` (SectionCancellations.svelte:51, SectionCompleteness.svelte:50); Completeness *always renders* with a ramp-in `standDown` note under a null value (SectionCompleteness.svelte:47-49) — "no data + why", never a silently missing section.
- **Ranked rows:** `RankedRow absentReason='no-observations'` → styled AbsentValue when display is null (SectionByTimeOfDay.svelte:64, SectionWeekday.svelte:57; RankedRow.svelte:231-244).
- **Charts:** selectors emit an `AbsenceSpec` when there's no distribution; `Chart` paints the honest "no data + why" block; histogram section stands DOWN entirely when spec is an absence (SectionDelayHistogram.svelte:40-44).
- **Whole sections gate honestly:** Cancellations (`hasCancel`), Crowding (`hasOccupancy`/day-grain), Shift/Weekday (`hasShift`/`hasDayType`) render nothing rather than a flat-zero line.
- **Feed-age chip** hides when null (NetworkSurface.svelte:405).
- **Bare-dash / null leaks:** NONE found. `fmtCount` uses `noData: ''` (NetworkSurface.svelte:136) but only feeds required-int fields (vehicles/non_responding are contract ints, never null). `MetricDisplay` explicitly avoids bare "·" (MetricDisplay.svelte:22-23). No `{value ?? '-'}` or `|| '—'` leaks in the tree.

---

## (6) EXPLAINER LINKS — do metrics link to /metrics?

**Yes — every metric and every section heading carries an (i) affordance that deep-links to `/metrics#<anchor>` (in-app SPA, same tab, back-button-friendly).**
- Wiring: `info(key, name)` in NetworkSurface.svelte:113-116 → `metricInfoFor(key, locale)` → `{ href: ${localizeHref('/metrics', locale)}#${entry.anchor} }` (metrics.content.ts:1226-1240). Rendered by `MetricInfo` (features/metrics/MetricInfo.svelte:304-312).
- Coverage of keys → anchors (all resolve; verified in metrics.content.ts):
  - Headline: otp→`#otp`, coverage→`#regularity`, p50p90→`#p50-p90` (×2), (SectionLiveHeadline via headlineKpis.ts:59-77).
  - Reporting: vehicleCount→`#headway`, silentTrip→`#skipped-stop`.
  - Status/Crowding: occupancy→`#occupancy`.
  - Delay histogram: p50p90→`#p50-p90`.
  - Daily trend: otp→`#otp`; Cancellations: cancellation→`#cancellation`; Completeness: cancellation→`#cancellation`; Crowding-by-day: occupancy→`#occupancy`; By-time-of-day: severe→`#severe`; Weekday: seasonality→`#seasonality`.
- **Minor content nit:** `coverage`→`#regularity` and `vehicleCount`→`#headway` and `silentTrip`→`#skipped-stop` are *approximate* anchor mappings (the supplemental keys point at the nearest existing /metrics section, not a dedicated "coverage"/"vehicle count" section). Functional but the deep-link lands on an adjacent explainer rather than an exact one.

---

## (7) MOBILE-390 READ (from code)

**Breakpoints used:**
- Only one real breakpoint in the surface tree: `@media (min-width: 1024px)` (SectionTrend.svelte:89 full-width; ControlsRail.svelte:190 sticky; AppShell rail reveal). **No 390/640px-specific handling** — everything below 1024px is one "mobile/tablet" bucket.
- Grids are breakpoint-free (auto-fit `minmax`), so at 390px every DashboardGrid collapses to 1 column (220/320/360px mins all exceed the ~330px available inner width → single column). Good, no bookkeeping needed.

**Chrome / sticky on mobile:**
- LeftRail overlay is hidden `<1024px`; nav is the TopBar burger. Good.
- `ControlsRail` sticky offset is `@media (min-width:1024px)` only → **on mobile the control rail is NOT sticky** (ControlsRail.svelte:190) — it scrolls away. So the offset bug from §2 is desktop-only; mobile is unaffected but loses sticky controls entirely.

**Elements at risk of overflow at 390px:**
- **Charts scale, don't scroll.** Trend (9rem), Histogram (9rem), StackedShare, Sparkline all use fluid-width `ChartFrame` (`width:100%`, ChartFrame.svelte:29,59) — none use `ScrollFrame`. So **no horizontal overflow**, BUT: the **signed 8-bucket delay histogram + dual-axis trend cram into ~330px** with x/y axis titles ("Delay (min)"/"Trips") + median/p90 reference rules → labels and ticks will be tight/overlapping. This is the highest visual-risk element on small screens.
- **`SectionCrowdingByDay`** uses `grid-template-columns: 5.5rem minmax(0,1fr)` per day (SectionCrowdingByDay.svelte:83). 5.5rem (~88px) date gutter + a 1fr strip on a ~330px row leaves ~230px for the stacked bar — usable but tight; date label at `--text-micro`.
- **Reporting caveat + shift caveats** are long mono paragraphs (`--text-small`) — fine (they wrap), but they add vertical bulk on mobile.
- The **feed-health header row** (`flex-wrap; gap 0.5rem 1.25rem`, NetworkSurface.svelte:580-585) wraps its 3 chips onto multiple lines on a phone — OK.

**Touch-target sizes (from classes):**
- `GrainPicker .grain-seg`: `min-height: 44px` — **WCAG 2.5.8 compliant** (explicit comment GrainPicker.svelte:835-841). Grain + window + retard toggles all inherit this. Good.
- `MetricInfo .metric-info__trigger`: `1.05rem × 1.05rem` ≈ **17×17px — WELL under the 44px target** (MetricInfo.svelte:331-332). Every metric/section (i) glyph is a sub-target tap zone. Real mobile accessibility risk (many of them, packed next to labels).
- Silent-line links (`.network-silent-link`): block links wrapping a `RankedRow` — row height is comfortable; focus ring present (SectionReporting.svelte:166-169). OK.
- Map cross-filter links are on chart bands (via spec `href`) — band tap targets depend on the Chart mark height (~ chart-frame height), generally OK but thin bands in a 100%-stacked strip can be narrow.

**Chart sizing strategy on small screens:** fixed pixel/rem heights (9rem trend/histogram) + fluid 100% width; scales down uniformly. No mobile-specific height reduction, no `ScrollFrame` fallback, no reflow of dual-axis to single-axis. Legible-but-cramped, not broken.

**Mobile risk level: MEDIUM.** No overflow/breakage, grids reflow cleanly, controls hit 44px — but (a) sub-target (i) glyphs everywhere, (b) dense histogram/dual-axis-trend labels at ~330px, (c) no sticky controls on mobile.

---

## (8) TOP 5 GAPS vs an A++ portfolio case-study page

1. **No heading outline (semantic + narrative).** One `<h1>` and 22 span-titles. Add real `<h2>`/`<h3>` for the two regions and each section (promote `SectionLabel` to render an optional heading element, or wrap titles in headings). Fixes the accessibility outline AND is the prerequisite for a scannable story spine. (§4)
2. **No verdicts / no story arc.** The page shows evidence but never states a takeaway. Add a top-of-page network health verdict ("Network is running slightly better than its 7-day norm"), directional deltas on the 4 KPIs (↑/↓ vs prior window), and an InsightCard-style one-liner per historic section. Turn the un-ranked historic tile grid into an ordered narrative. (§1)
3. **Sticky control-rail offset bug (desktop).** Network never sets `--rail-sticky-top: 0` (the lines surface does at RouteReliabilityClusters.svelte:656), so the sticky rail floats ~88px below the header with content bleeding through the gap. One-line fix; visible polish defect. (§2)
4. **Sub-target (i) explainer glyphs on mobile.** 17px tap zones repeated next to every metric/section fail WCAG 2.5.8 on touch. Bump `MetricInfo` trigger to a 44px hit area (padding/pseudo-element) without growing the visual glyph. (§7)
5. **Repeated `.network-tile` chrome + no shared tile primitive.** The exact card CSS (padding/border/radius/card bg/gap) is duplicated in 8 section files. Extract a `NetworkTile`/shared `Tile` primitive — reduces drift, and is where the missing per-tile verdict/delta slot would live. (§3) *(Secondary: the LIVE↔HISTORIC regions need a connective bridge; the crowding-by-day 5.5rem gutter is tight at 390px; SectionDelayHistogram's `<section>` is an unnamed landmark.)*

---

## Component inventory (what the surface composes)
- **Shared (brief):** `Surface`, `DashboardGrid`, `ControlsRail` (layout); `SurfaceHeader`, `SurfaceControls`, `GrainPicker`, `FreshnessStamp`, `ConformanceBadge`, `ResourceBoundary` (surface); `EdgeState`, `AbsentValue` (edge); `SectionLabel`, `SectionHeading` (brand); `MetricDisplay`, `ExplainedMetricCard`, `RankedRow`, `Chart` (dataviz/brand); `MetricInfo`, `metricInfoFor`, `metricsCopy` (features/metrics); `Separator`.
- **Surface-specific (deep-dived):** `NetworkSurface` (orchestrator) + 10 `Section*` presenters + 11 selectors (`headlineKpis`, `statusMix`, `occupancyMix`, `delayHistogram`, `silentByRoute`, `trendChart`, `cancelTrend`, `completeness`, `occupancyTrend`, `shiftRank`) + 2 data helpers (`presentGrains`, `trendWindow`) + `network-reliability.copy.ts`.
