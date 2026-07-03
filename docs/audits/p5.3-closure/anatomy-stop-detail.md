# Surface Anatomy — Stop Detail (`/stop/[id]`)

**Scope:** the singular dynamic stop-detail surface (`/stop/{id}`, `/fr/stop/{id}`), distinct from the plural `/stops` catalogue index. Deliberate URL split (like lines vs line-detail), but — unlike lines — there is *no* `/lines`-style consolidation route; `/stop/[id]` is a standalone tabbed detail.

## Entry points & mount chain

- Route dir: `apps/web/src/routes/[[lang=locale]]/stop/[id]/`
  - `+page.ts:11-16` — thin loader. Returns `{ id: params.id, lang: pathLocale(url.pathname) }`. No `/v1` reads here; all data reads are owned by the feature slice (client-side, reactive to `id`).
  - `+page.svelte:1-18` — pure mount. `<StopDetail id={data.id} />`. Zero logic/markup/copy. Locale comes from `getLocale()` context inside the feature, NOT from `data.lang`.
- No route-local `+layout` for stop; inherits the app shell (`[[lang=locale]]/+layout` / root `AppShell`).
- Feature root: `apps/web/src/lib/features/stops/StopDetail.svelte` (805 lines) — the real surface.
- Reliability sub-surface: `apps/web/src/lib/features/stops/reliability/sections/StopReliabilitySurface.svelte` (407 lines) + 7 `Section*.svelte` presenters + pure selectors under `reliability/selectors/`.
- Copy: `stops.copy.ts` (`detailCopy`, tabs/next/schedule/info/alerts) + `reliability/stops-reliability.copy.ts` (`stopReliabilityCopy`, everything reliability).

## Data tiers (`StopDetail.svelte`)

- **LIVE** — `createLiveStore(getV1Context().manifest)` (`:107`), started `onMount`, stopped on destroy. `departures = live.index.byStopId.get(id)` (`:114-116`); `null` before first tick → skeleton, `[]` → real "no departures". Also `live.alerts` (→ `stopAlerts` via `alertsForStop`, `:128-130`), `live.network.non_responding_by_route` (silent-signal, `:161-165`), `live.generatedUtc/ageSeconds/isStale` (freshness).
- **STATIC** — `stop = createResource(() => getStop(id))` (`:119`). Feeds info + schedule tabs, plus `stopWindow` (service-window inference) and alert route/code matching.
- **HISTORIC** — `reliability = createResource(() => getStopReliability(id))` (`:140`). Unconditional (no per-stop `reliability` availability flag exists in `stops_index`, unlike routes — see `:133-139`), fail-soft 404 → null → empty.

---

## (1) SECTION ORDER + STORY ARC

The page is **tabbed, not scrolled** — the spine is `EntityDetail` (`components/surface/EntityDetail.svelte`) rendering a masthead + a 4-tab `Tabs`. Only one tab's content is visible at a time. "Section order" therefore has two axes: the **masthead** (always visible) and the **within-tab** vertical order.

### Masthead (always visible) — `EntityDetail.svelte:77-91`, header snippet `StopDetail.svelte:302-311`
| Order | Element | Component | Data source |
|---|---|---|---|
| M1 | Breadcrumb (only if trail > 1) | `Breadcrumb` | `resolveBreadcrumbTrail(page.url.pathname)` |
| M2 | Back link "← Stops" | `<a>` in EntityDetail | `back={{href:'/stops', label:t.back}}` |
| M3 | Kicker "STOP / ARRÊT" | `SectionLabel variant="station"` | `t.kicker` |
| M4 | Stop name plate + map drilldown | `StopLabel` + `MapDrilldownLink` | `stop.data?.name ?? '#'+id` |
| — | Hazard separator | `Separator variant="hazard"` | — |
| M5 | Tab strip (Next / Schedule / Info / Reliability) | `TabsList` (line variant, signage-active) | `tabs` (`:85-90`), active mirrored to `?tab` |

### Tab: **Next** (LIVE, default) — `StopDetail.svelte:314-432`
| Order | Heading | Component | Data / selector |
|---|---|---|---|
| N1 | "Next departures" | `SectionLabel variant="station"` + `FreshnessStamp variant="live"` | `t.next.heading`; `live.generatedUtc/ageSeconds/isStale` |
| N2 | Filter controls: status chips (on-time/late/severe/early) + by-route chips + live count | `ControlsRail` + hand-rolled `.stop-chip` buttons | `statusFilter` (SvelteSet), `routeFilter`, `departureRoutes` (`:260-270`) |
| — | Hazard separator (sm) | `Separator variant="hazard"` | — |
| N3 | Departures list (route · ETA · delay caption w/ colour+glyph) | `<ul.stop-departures>` | `filteredDepartures` (`:278-288`), `formatUtc`, `delayLabel/delayTone` |
| N-empty | Honest-absence card | `EdgeState variant="empty" emptyReason=…` | `departuresAbsenceReason` (`:171-180`, from `stopWindow` + silent signal) |

### Tab: **Schedule** (STATIC) — `StopDetail.svelte:433-476`
| Order | Heading | Component | Data / selector |
|---|---|---|---|
| S1 | "Scheduled service" | `SectionLabel variant="station"` | `t.schedule.heading` |
| S2 | Per-route blocks: route code + headsign + 5-col column-major time grid, "+N more" over cap | `<ul.stop-schedule-times>` | `s.scheduled[]`, `SCHEDULE_CAP=30` (`:82`) |
| S-empty | route-with-no-times honest chip | `AbsentValue variant="inline" reason="no-observations"` | per-entry `:470` |
| wraps | boundary + whole-tab empty | `ResourceBoundary isEmpty=(scheduled.length===0)` | `:435-439` |

### Tab: **Info** (STATIC) — `StopDetail.svelte:477-541`
| Order | Heading | Component | Data / selector |
|---|---|---|---|
| I1 (left col) | Position / Stop code / Accessibility (tri-state) | `MetricDisplay size="sm"` ×3 | `s.lat/lon`, `s.code`, `s.wheelchair` (`:491-523`) |
| I2 (left col) | "Routes served" chips | `SectionLabel variant="metric"` + `Badge variant="tag"` | `s.routes_served` (`:525-534`) |
| I3 (right col) | Live service alerts affecting this stop | `AffectedAlerts` | `stopAlerts` (`:537`); stands down when empty → left col spans |

### Tab: **Reliability** (HISTORIC) — `StopDetail.svelte:542-563` → `StopReliabilitySurface.svelte`
| Order | Heading | Component | Data / selector |
|---|---|---|---|
| R0 | Grain rail (day/week/month) + window caption | `SurfaceControls` (desktop) / `GrainPicker` in `ControlsRail` (mobile) | `presentGrains(data.periods)`, `?grain` codec seed |
| — | Hazard separator | `Separator variant="hazard"` | — |
| R1 | **Daily trend** (severe-share line + range verdict tiles + Wilson CI + DateRangePicker) — full-width hero | `SectionDailyTrend` | `data.daily[]`, `selectDailyTrend`, `poolDailyRange`, `?from/?to` |
| R2 | **Daily delay** percentiles (typical p50 / worst p90) | `SectionPercentiles` | `selectDayPercentiles(data.periods, grain)` |
| R3 | **On-time & delay** pane (OTP / avg delay / severe by period) | `ReliabilityPane` inside a tile | `selectGradedPeriods(data.periods, grain)` |
| R4 | **Severe delays by hour** — 7×24 habits heatmap (full-width hero) | `SectionHabits` (Chart/ChartSpec) | `selectHabitsHeatmap(data.habits.matrix)` |
| R5 | **By day of week** | `SectionWeekday` | `selectWeekdaySeasonality(data.day_of_week)` |
| R6 | **By time of day** (shift + weekday-vs-weekend) | `SectionTimeOfDay` | `selectTimeOfDay(data.periods)` |
| R7 | **Crowding on buses seen here** (100%-stacked occupancy) | `SectionCrowding` | `selectCrowdingMix(data.occupancy_mix)` |
| R8 | **Avg delay by route** ranked | `SectionByRoute` | `selectRankedRoutes(data.by_route)` |
| wraps | boundary + whole-tab empty | `ResourceBoundary isEmpty=(all facets empty)` (`:547-556`) | — |

Layout for R2-R8 is a `DashboardGrid minTile="340px"` auto-fit board; R1/R4 span full width (`.stop-tile--wide`). Each `{#if}` stands a section down entirely; an absent pair-mate lets its survivor span the row.

### STORY-ARC ASSESSMENT

**Reader question at each scroll depth:**
- Masthead: "Which stop am I looking at, and where is it on the map?" — answered (name plate + map link).
- Next tab (default): "When's my bus, and is it on time right now?" — answered well; honest-absence when closed/silent is a genuine strength.
- Schedule tab: "What's the planned timetable?" — answered.
- Info tab: "Where exactly is this stop, is it accessible, what serves it, any alerts?" — answered.
- Reliability tab: "How reliable is this stop over time?" — answered richly but **only after the reader (a) discovers the tab, (b) picks a grain, and (c) scrolls a dense board of 8 sections.**

**Where the story breaks / stalls:**
1. **No top-level verdict.** The masthead has kicker + name + map link and then jumps straight to tabs. There is *no one-line synthesis* ("this stop runs on time 82% of the time" / "severe delays cluster at 5-6 PM"). The stops *index* has a full `SurfaceHeader` with kicker+heading+subheading+lede (`StopsIndex.svelte:223`); the *detail* has none. Context→evidence→verdict is inverted: the page opens with a live board (evidence) and the verdict is buried three tabs deep behind a grain picker.
2. **Reliability is gated behind a tab AND a grain pick.** The single most portfolio-worthy content (habits heatmap, daily trend, percentiles) is invisible on load. A reader who never clicks "Reliability" leaves with only "next 3 buses."
3. **No cross-tab narrative thread.** The four tabs are parallel silos with no connective tissue — e.g. the live "Next" board doesn't foreshadow "this stop is usually 4 min late at this hour" from the historic tier, even though that data is loaded.
4. **Story is a matrix, not an arc, within Reliability.** 8 co-equal tiles with mono `SectionLabel` captions read as a dashboard, not a narrative. No lead sentence per tile telling the reader what to conclude ("verdict" cards exist only inside the daily-trend section).

**Missing for it to read as a story (context → evidence → verdict):**
- A hero summary line under the name plate: a computed reliability grade / "typical delay" / "best & worst hour," derived from data already in hand (`reliability.periods`, `habits`).
- A "verdict-first" ordering inside Reliability (put the pooled read + habits at top, the raw period pane lower).
- A connective callout on the Next tab surfacing the historic context for *this hour* ("Buses here usually run N min late around now").

---

## (2) CHROME

- **Masthead** — `EntityDetail.surface-head` (`:77-89`): breadcrumb + back link + kicker + header snippet, `flex-direction:column; gap:.75rem`. Not sticky.
- **Tab strip** — `TabsList variant="line" class="w-full justify-start"` (`:94`). Signage-active chip (`--signage-bg/--signage-text`, theme-invariant). **Not sticky** — scrolls away with content.
- **`--chrome-offset`: NOT USED anywhere in the web app** (grep of `src` returns zero hits). The task's specific probe finds no `--chrome-offset`.
- **Sticky elements on THIS surface: none.** `ControlsRail` *supports* `sticky` (position:sticky, `top: var(--rail-sticky-top, 5.5rem)`, `z-index:var(--z-rail)`; `ControlsRail.svelte:108-125`) but **neither ControlsRail on the stop page passes `sticky`** — not the Next-tab filter rail (`:348`) nor the mobile grain rail (`:280`). The desktop grain rail uses `SurfaceControls`, also not sticky here. So on a long Reliability tab the grain picker scrolls out of reach.
- The shared 5.5rem sticky offset is a repo convention (`RailLayout.svelte:86-87`, `MissionControlGrid.svelte:123`) but this surface opts out of it.
- **Rails:** the Next-tab filters and the Reliability grain picker are collected into `ControlsRail` "control panel" cards (bordered `--card`, mono overline), discerned from the data canvas by a `Separator variant="hazard"`. Two independent rails can coexist (Next filters + grain) — `SurfaceControls` namespaces its aria ids via `$props.id()` so they don't collide (`StopReliabilitySurface.svelte:22-23`).

---

## (3) CONTAINERS

- **Outer surface** — `Surface width="bleed"` (`EntityDetail.svelte:66`). `width="bleed"` → `max-width:none` (`Surface.svelte:22-28`); the detail page is a **full-bleed data dashboard** that fills the rail-inset `<main>` edge-to-edge. Gutter kept via `surface-shell--gutter` → `padding-inline: var(--space-page-x)`. Vertical rhythm: `gap: clamp(1.75rem,4vw,2.75rem)` between shell children; block padding `clamp(1.5rem,4vw,2.5rem)`.
- **Content measure:** because it's `bleed`, there is NO `--container-content` cap on the page body. Dense text blocks would need `.surface-measure` to re-cap, but the detail panes don't apply it (they're tiles/lists, not long prose — acceptable, but the daily-trend caveat paragraphs run to the full bleed width).
- **Reliability board** — `DashboardGrid minTile="340px" gutter={false}` (`StopReliabilitySurface.svelte:312`). Grid template: `repeat(auto-fit, minmax(min(340px,100%), 1fr))`, `gap: var(--space-card-gap)`. `gutter={false}` because it's already inside the Surface gutter. Full-width heroes: `.stop-tile--wide { grid-column: 1 / -1 }` only `@min-width:1024px` (`:401-405`) — below 1024px auto-fit reflow handles it.
- **Tiles** — `.stop-tile` chrome declared `:global` on the surface (`:383-392`): `padding:1rem; border:1px solid var(--border); radius:var(--radius-lg); background:var(--card)`.
- **Padding rhythm:** section gaps `1rem–1.25rem`; tile internal gap `.6rem`; departure rows `.75rem .875rem`; chip padding `.35rem .75rem`; schedule time grid gap `.4rem .75rem`. Info metrics gap `1.5rem`. Reasonably consistent on the brand-token scale, though a mix of raw `rem` values (`.35`, `.4`, `.6`, `.875`) rather than spacing tokens.
- **Info pane grid:** `grid-template-columns: minmax(0,1fr) minmax(0,1fr)`, `gap:1.5rem 2rem` (`:654-659`); collapses to 1 col `@max-width:48rem`. `:only-child` survivor spans (`:650-653`).

---

## (4) HEADINGS — hierarchy sanity ⚠️ **MAJOR GAP**

**The stop-detail page renders NO real heading elements (`<h1>`–`<h6>`) at all.**
- Kicker → `SectionLabel` = a `<span>` (`SectionLabel.svelte:38`).
- Stop name → `StopLabel` = a `<div>` (`StopLabel.svelte:22`).
- Every section title ("Next departures," "Scheduled service," "On-time and delay," all 8 reliability tiles) → `SectionLabel` = `<span>`.
- Only `SectionDailyTrend` uses a real `<section>` landmark (`:89`) but its title is still a `<span>` SectionLabel (`:95`).
- Confirmed by grep: real `<h2>/<h3>` exist only in `StopsIndex.svelte` (the *index*), never in the detail tree, EntityDetail, or Surface.

**Consequences:**
- No `<h1>` → the page has no accessible document title/outline. Screen-reader heading navigation (a common AT shortcut) yields nothing on this page.
- SEO: the `<title>`/JSON-LD may be set elsewhere, but the DOM has no heading landmark for the entity name.
- There is a `SectionHeading` brand primitive that *does* render a real heading via `<svelte:element this={tag}>` (`SectionHeading.svelte:38`) — but StopDetail never uses it; it uses `SectionLabel` (span) everywhere. RouteDetail parity should be checked (EntityDetail is shared).

**Skipped-levels:** N/A because there are zero heading levels. This is worse than a skipped level — the whole outline is flat spans.

---

## (5) ABSENCE STATES — strong, systematic

The page is a good citizen of the site-wide honest-absence layer. Inventory:
- **Live board empty** → `EdgeState variant="empty" emptyReason={departuresAbsenceReason}` (`:336-341`). `departuresAbsenceReason` is *inferred* (`:171-180`) from the stop's own service window (`stopServiceWindow` over all scheduled times) + the live silent signal (`stopNonResponding`), yielding specific copy: "Service closed — opens at 06:00" / "No service at this hour" / "Scheduled but no vehicle reporting." Explicitly no metro-gap inference at stop level (a stop can serve mixed modes — `:148-150`). This is genuinely excellent.
- **Filter returns nothing** → `.stop-departures-empty` p with `t.next.filter.noMatches` (`:401-404`) + a live `showing X of Y` count (`:393-395`, `aria-live="polite"`).
- **Schedule: route with no times** → `AbsentValue variant="inline" reason="no-observations"` (`:470`).
- **Info: accessibility unknown** → tri-state; `MetricDisplay value={null} absentReason="no-observations"` when `wheelchair` is absent (`:515-522`) rather than omitting the field. `false` → "Not wheelchair accessible." Good — distinguishes unknown from negative.
- **Info: alerts** → `AffectedAlerts` stands down entirely when `stopAlerts` empty (survivor spans grid).
- **Reliability whole-tab empty** → `ResourceBoundary isEmpty` when all facets empty (`:547-556`).
- **Daily trend empty** → `AbsentValue variant="block" reason="no-observations"` (`SectionDailyTrend.svelte:108`); verdict tiles each carry `absentReason="no-observations"` (`:129/139/146`); below-MIN_N honest note (`:154-158`).
- **Crowding no telemetry** → dedicated empty tile with `AbsentValue variant="block"` (`SectionCrowding.svelte:79`) + honest "not a property of the stop" caveat copy.
- **Percentiles / by-route / weekday** → `MetricDisplay absentReason` / `AbsentValue variant="block"` (grep-confirmed in each Section*).
- **Delay caption semantics:** a `null` delay rides the muted `'none'` tone (no fill, no glyph) so absence never reads as an on-time claim (`:200-237`). Doctrine-clean.

**Bare-dash / null leaks:** none found. The one nuance: on the **Next** board, an absent `delay_min` falls back via `delayLabel(d.delay_min, t.next)` to "on time" (documented at `:290-293`) — this surface deliberately reads no-realtime-delta as "on time," NOT "no data." That's an intentional prior-semantics choice but is arguably a mild honesty seam (an absent delta shown as "on time" while the *colour* channel correctly shows no-data). Worth flagging.

---

## (6) EXPLAINER LINKS — partial coverage

- **Reliability tab: full coverage.** Every reliability section mounts a `MetricInfo` `(i)` popover that deep-links into the in-app `/metrics#anchor` explainer (`metricInfoFor(key, locale)` → `{ tip, href }`). Confirmed in `SectionPercentiles` (`p50p90`), `SectionByRoute` (`avgDelay`), `SectionWeekday` (`seasonality`), `SectionTimeOfDay` (`severe`), `SectionHabits` (`habits`), `SectionCrowding` (`occupancy`), and the pane heading in `StopReliabilitySurface.svelte:319-324` (`otp`/`avgDelay`/`severe`). `MetricInfo` is a proper click/focus popover (not a tooltip) so the link is keyboard-reachable, in-app, same-tab, back-button-friendly (`MetricInfo.svelte:1-17`). This is A-grade.
- **Next / Schedule / Info tabs: NO explainer links.** Defensible — these are live/static facts, not measured metrics. The one candidate is the Next-board delay statuses (early/on-time/late/severe): these *are* a measured vocabulary (`STATUS_LABELS`, `delayTone` thresholds, "severe" = >5 min) with a `/metrics` home, but the status chips carry no `(i)` explaining what "severe" means or the 5-min threshold. Minor gap.
- The daily-trend "severe-delay share" caveat is inline copy (`:159`) rather than a `/metrics` link, though the same metric elsewhere links out — slightly inconsistent.

---

## (7) MOBILE-390 READ FROM CODE

**Breakpoints used on this surface:**
- `@media (max-width: 48rem)` (=768px) — StopDetail: masthead stacks (`:795-799`); Info grid → 1 col (`:800-803`); schedule 5-col grid → 1 col (`:715-721`).
- `@media (max-width: 1023.98px)` / `(min-width: 1024px)` — StopReliabilitySurface: swaps the desktop `SurfaceControls` grain rail for the mobile `GrainPicker`-in-`ControlsRail` (`:369-378`); `.stop-tile--wide` full-span only ≥1024px (`:401-405`).
- No 390px-specific breakpoint; the smallest is 768px, so a 390px phone gets the "mobile" branch of everything.

**Elements at risk of overflow at 390px:**
- **Tab strip (highest risk).** `TabsList` is `inline-flex w-fit` with `justify-start w-full`; triggers are `flex-1 whitespace-nowrap` (`tabs-list.svelte:9`, `tabs-trigger.svelte:17`). The custom `.station-tab` sets `min-width:max-content` (`EntityDetail.svelte:128`) and the TabsList has **no `overflow-x:auto`**. EN labels (Next/Schedule/Info/Reliability) are short and likely fit, but **FR** (Prochains/Horaire/Info/Fiabilité) is longer; 4 non-wrapping min-content chips at 390px minus the page gutter can exceed the width, and with no horizontal scroll on the list they can spill/clip. **Verify in browser.**
- **Departure row** — `.stop-departure` is `flex; gap:.875rem` with route (min 3ch, mono) · ETA (flex 1) · delay caption (mono, shrink 0). Delay caption + glyph + route are all `flex-shrink:0`; a long delay label ("+12 min late" / "12 min d'avance") at 390px can squeeze the ETA. Moderate risk.
- **Filter chip rows** — wrap (`flex-wrap:wrap`), so no overflow, but many route chips produce a tall stack.
- **Info position value** — `${lat.toFixed(5)}, ${lon.toFixed(5)}` in a `MetricDisplay` — long mono string; on 390px in a 1-col grid it fits but is wide.
- **Daily-trend caveat paragraphs** — full-bleed width (no `.surface-measure`), so long caveat sentences run edge-to-edge; readable but wide measure.

**Touch-target sizes (from classes) — ⚠️ below 44px in places:**
- `.stop-chip` (status + route filters): `padding: .35rem .75rem`, `font-size:var(--text-small)`, `line-height:1.2` → computed height ≈ **28–30px**. **Below the 44px minimum** the operator's audits flag.
- `.station-tab` (tabs): `padding: .5rem 1rem` → height ≈ **~36px**. Below 44px.
- `MapDrilldownLink`: `min-height: 2rem` (32px) + `padding:.25rem .65rem` → ~32px. Below 44px.
- `MetricInfo` `(i)` trigger: `1.05rem × 1.05rem` (**~17px**) — well below 44px; a hard tap target on mobile.
- Back link, breadcrumb links: text links, no min-height — small tap targets.
- **None of the interactive controls on this surface meet 44px.** This is the biggest mobile risk after the tab strip.

**Chart sizing strategy on small screens:**
- Charts render via `Chart`/`ChartFrame`. `ChartFrame` is width-fluid (`width:100%`) with a fixed `height` per mark (line 16rem, trend/histogram 9rem, bullet 2.75rem, etc.) and a `ResizeObserver` that gates render until the box is non-zero (`ChartFrame.svelte:35-53`) — this also fixes the hidden-tab 0×0 measurement trap (relevant because charts live in the inactive Reliability tab).
- Wide charts (habits 7×24 heatmap, daily trend) sit in a `ScrollFrame` with `overflow-x:auto; overflow-y:hidden` + edge shadows (`ScrollFrame.svelte:104-106`) — so on 390px they **horizontally scroll inside their own container** rather than overflowing the page. Good, correct strategy.
- Heights are fixed rem, not viewport-relative — charts don't shrink vertically on small screens (fine).

**Sticky behavior on mobile:** none. `ControlsRail` sticky only activates `@min-width:1024px` AND only when `sticky` is passed (it isn't). So on mobile the grain picker and filter rail scroll away with the content — the reader loses the grain control after scrolling into the 8-tile reliability board.

**Mobile risk level: MEDIUM–HIGH.** Driven by (a) sub-44px touch targets across every control, (b) tab-strip overflow risk in FR with no horizontal scroll, (c) grain/filter rails not sticky so controls scroll out of reach. Charts and absence states are handled well.

---

## (8) TOP 5 GAPS vs. an A++ portfolio case-study page

1. **No verdict / hero summary — the page has no thesis.** It opens with a live board and buries the reliability read three tabs + one grain-pick deep. An A++ page leads with a computed one-line verdict under the name ("Usually ~4 min late; worst around 5–6 PM; on-time 78% this month"), synthesized from data already loaded (`reliability.periods`, `habits`). Today the detail page is strictly *less* framed than its own index (which has kicker+heading+subheading+lede via `SurfaceHeader`).
2. **Zero real headings — flat span outline.** No `<h1>` for the stop, no `<h2>` per tab/section (all `SectionLabel` spans, `StopLabel` div). Breaks screen-reader heading nav, document outline, and SEO. Fix: route section titles through the existing `SectionHeading` primitive (renders a real heading tag) and give the masthead an `<h1>`.
3. **Sub-44px touch targets on every control + tab-strip overflow risk.** Filter chips ~29px, tabs ~36px, `(i)` triggers ~17px, map link ~32px; tab strip has no `overflow-x:auto` and long FR labels can clip at 390px. An A++ page hits 44px targets and gives the tab row a horizontal-scroll fallback.
4. **Reliability is a matrix of 8 co-equal tiles, not a narrative.** No per-tile lead sentence telling the reader what to conclude, no verdict-first ordering (the raw period pane and the habits hero sit mid-board). An A++ page orders context→evidence→verdict *within* the tab and gives each tile a one-line takeaway.
5. **No cross-tier connective tissue + rails not sticky.** The live "Next" board doesn't surface the historic "buses here usually run late around now" context even though the historic tier is loaded; and the grain/filter controls scroll out of reach on long tabs (no `sticky` passed). An A++ page threads the tiers together and pins the controls that drive the view.

### Secondary / smaller notes
- Full-bleed body has no `.surface-measure` re-cap → caveat paragraphs run to full width.
- Absent live delay renders text "on time" (colour channel correctly shows no-data) — a mild honesty seam vs. the rest of the site's strict absence discipline.
- Next-tab delay statuses (esp. "severe" = >5 min) have no `(i)` explainer despite being a measured vocabulary with a `/metrics` home.
- Padding uses a mix of raw rem values rather than spacing tokens in a few spots.

## Verdict counts
- Tabs: **4** (Next / Schedule / Info / Reliability).
- Distinct content sections across all tabs: **~15** (Next: 3 · Schedule: 1 · Info: 3 · Reliability: 8, plus the grain rail).
- Real `<h1>`–`<h6>` on the page: **0**.
- `--chrome-offset` usages: **0** (repo-wide).
- Sticky elements on this surface: **0**.
- Explainer `(i)` links: **7** reliability metrics; **0** on Next/Schedule/Info.
- Interactive controls meeting 44px touch target: **0**.
