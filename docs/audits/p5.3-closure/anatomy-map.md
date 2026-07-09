# Surface Anatomy — `/map` (Live Vehicle Map)

Route entry: `apps/web/src/routes/[[lang=locale]]/map/+page.svelte`
Feature root: `apps/web/src/lib/features/map/MapHero.svelte` (49KB orchestrator)
Analyzed at repo head `2273280` (main), 2026-07-03. READ-ONLY.

---

## 0. Fundamental frame: this is NOT a scroll-story page

`/map` is a **full-bleed, non-scrolling live application surface**, not a context→evidence→verdict
scroll narrative like `/metrics` or `/line/[slug]`. This is by explicit contract:

- `+page.svelte` (lines 1-12) is a THIN mount — no `+page.ts`, no `+layout` in the route dir; just
  `<MapHero />`. Locale comes from `getLocale()` context.
- Root layout `apps/web/src/routes/+layout.svelte:112` flags `/map` as the ONLY `isFullBleed` surface:
  `const isFullBleed = $derived(seoPath === '/map')`.
- `+layout.svelte:480-510`: on full-bleed the `#main` wrapper gets `overflow-hidden` (never scrolls)
  and the site `<Footer>` is OMITTED (a trailing footer would cram under the height:100% canvas).
- `MapHero.svelte:1211-1237`: `.map-hero { position:relative; width:100%; height:100%; overflow:hidden }`
  and `.map-surface { position:absolute; inset:0 }`. The GL canvas is the base layer (z-1); everything
  else floats over it as absolute overlays (z-5 vignette, z-10+ chrome, z-30 rail, z-32 detail).

Therefore "SECTION ORDER + STORY ARC" below is expressed as **overlay layers / interaction depth**,
not vertical scroll depth. There is no scroll position; the "story" is the click-to-drill flow:
map → hover peek → click → detail panel → drill to related entity.

---

## 1. SECTION ORDER + STORY ARC

### 1a. Overlay-layer inventory (z-order = reading priority)

All mounted inside `.map-hero` → `.map-surface` (MapHero.svelte:1122-1209). Ordered by z-index (paint order):

| z | Layer / "section" | Component | Data source / selector | Reader question |
|---|---|---|---|---|
| 1 | GL canvas (basemap + buses + stops + routes + near-target) | `MapStage` via `MapSurfaceCanvasLayer` (`mapBody` snippet, MapHero:1043-1068) | `getBasemap()` loader; `live` store (`createLiveStore(manifest)`, MapHero:255); `stops`/`routesIndex`/`selectedRoutes` resources | "Where are the buses right now?" |
| 5 | Edge vignette | `MapSurfaceCanvasLayer.svelte:31,48-66` | none (pure CSS token gradient) | (composition framing only) |
| 10 | Title block (kicker + h1 + head-freshness) | `MapHeadTitle` (MapOverlayChrome:102-109) | `t.kicker`/`t.heading`; `live.generatedUtc`/`ageSeconds`/`isStale` | "What am I looking at, how fresh?" |
| 10 | Near-me control (collapsed → expandable) | `MapNearMeControl` (MapOverlayChrome:111-125) | geolocation + `/api/geocode/montreal`; `nearbyStops` = `nearestStops(origin, stopList, 5, 1200)` (MapHero:314) | "What stops are near me?" |
| 10 | Left Controls panel (motion toggle + filters) | `MapFilters` in `controlsMode` w/ `MapMotionControl` header (MapOverlayChrome:134-136; snippets MapHero:1101-1115) | `filters` store (`createFilterStore(fromSearchParams(...))`, MapHero:212); `routesIndex.data.routes`; `stops.data.stops` | "How do I narrow the map / how are buses drawn?" |
| 10 | Floating freshness pill (desktop) | `MapFreshness placement="floating"` (MapOverlayChrome:140) → shared `FreshnessStamp variant="live"` | `live.generatedUtc`/`ageSeconds`/`isStale` | "How stale is the feed?" |
| 12 | Live-edge notice (unavailable / no-vehicles) | inline in `MapOverlayChrome:157-166` | `liveEdgeState`/`liveEdgeMessage` derived MapHero:411-424 | "Why is the map empty?" |
| 13 | Feed-stall banner (top-centre, isStale only) | `MapFeedStallBanner` (MapOverlayChrome:151) | `isStale` + ticking age off `sharedClock` | "The feed stopped — is this data live?" |
| 24 | Hover peek (desktop only) | `MapSelectionDetail compact` inside `.map-peek` (MapOverlayChrome:168-180) | `hoverDetail` = `resolveMapSelection(hovered, ...)` MapHero:467 | "What's this bus/stop under my cursor?" |
| var (fixed) | Mobile Controls pill + drawer (<1024px) | `MapFilterPill` (MapOverlayChrome:138) | `filters` store chip count; shared `controls` snippet | (mobile equivalent of left panel) |
| 30 | Left nav rail overlay | `LeftRail` via `AppShell` (root layout) | `$lib/nav` layout manifest | site navigation |
| 32 | Right DETAIL panel (desktop, on `detailOpen`) | `MapDetailOverlay` → `RightPanel` → `MapSelectionDetail` (MapHero:1070-1093, 1181-1189) | `selectedDetail` = `resolveMapSelection(selected, {index, stops, routes, stopFiles, alerts})` MapHero:458 | "Tell me everything about what I clicked." |
| (sheet) | Mobile detail bottom sheet (<1024px, on `detailOpen`) | `MapMobileDetailSheet` → `BottomSheet` → `MapSelectionDetail` (MapHero:1194-1208) | same `selectedDetail` | mobile detail |
| 45/55 | TopBar (search, theme, lang, alerts bell, burger) | `TopBar` via `AppShell` | chrome search resources (routes/stops/vehicles/addresses) | global chrome |

### 1b. The detail panel is the real "story body"

`MapSelectionDetail.svelte` (36KB) is the content spine and DOES follow a mini context→evidence→verdict arc
per selected entity. Three `detail.kind` branches:

- **vehicle** (MapSelectionDetail:115-315): header (kind + title) → id chip → not-reporting caution note →
  6-cell attribute grid (Route / Status / Crowding / Delay / Next stop / Trip, each a drill button) →
  Past stops `<ol>` → Next stops `<ol>` (ETA + delay tag). Chain: what bus → is it reporting → how's it doing → where's it going.
- **route** (MapSelectionDetail:316-411): id chip → long-name/direction grid → "N visible buses" stat →
  Live buses list (max 8) → Stops by direction (`h4` direction blocks with inferred-label marker).
- **stop** (MapSelectionDetail:412-562): stop-code chip → departures/vehicles stat row → Live buses (max 8) →
  Departures list (max 4) → Route-times cards (Past/Next/Live 3-column, container-query collapsible).

Alerts render last in every branch via `MapDetailAlerts` (MapSelectionDetail:564).

### 1c. STORY-ARC VERDICT

**As a live operational surface the arc is strong and coherent: context (title+freshness) → live evidence
(the map + freshness/stall/edge honesty chrome) → drill-down verdict (the rich, honest per-entity detail
panel). The narrative break is that the surface answers "where are the buses NOW" extremely well but never
closes a loop to "so is service GOOD?" — there is no network-level verdict, no summary stat, and no bridge
to the analytics surfaces (/metrics, /line) that hold the reliability story.**

Specific arc gaps / stalls:
1. **No network-level "verdict" anywhere.** Title reads "Live map / NETWORK · LIVE" but the surface never
   states a single network-health number (on-time %, active vehicles, active alerts). First-time reader gets
   motion but no judgement. `liveEdgeState` (MapHero:411) only surfaces empty/down states.
2. **Cross-surface dead-end.** The only outbound analytics link on the whole surface is the motion explainer
   (`MapMotionControl.svelte:99` → `/metrics#live-positions`). A clicked route/stop/bus in the detail panel
   drills to OTHER map selections (MapSelectionDetail `onselect`), never to `/line/[slug]`, `/stop/[id]`, or a
   receipt — the live map is walled off from the reliability story it should feed.
3. **Alert story is thin.** `MapDetailAlerts` shows alerts on the selected entity, but there is no global
   "N active alerts on the network" affordance on the map (TopBar bell exists but MapHero never wires
   `alertCount` — AppShell defaults it to 0, AppShell:119).
4. **The "no-vehicles" absence is honest but incurious** (MapHero:402-410 TODO): it cannot say *why*
   (overnight vs partial feed) because no network service-span signal is published. Documented debt.

---

## 2. CHROME (headers, sticky, offsets, rails)

- **TopBar** (`TopBar.svelte:273`): `relative z-40 flex h-[60px] w-full shrink-0` — fixed 60px tall, full
  width, NON-sticky (a flex row above the shell body, AppShell:248-265). The shell is `h-dvh overflow-hidden`,
  so the whole app never scrolls; the map body is the remaining `flex-1`.
- **No `--chrome-offset` variable exists anywhere in the repo** (grep clean). The map uses two custom vars:
  - `--app-left-rail-offset` (defined AppShell:387; `0px` mobile, `16rem` expanded / `4.85rem` collapsed at
    ≥1024px, AppShell:464-477). Left-anchored overlays offset off it: `.map-head`/`.map-filter-panel`
    `left: calc(var(--app-left-rail-offset,0rem) + 1rem)` (MapHeadTitle:44, MapOverlayChrome:189).
  - `--map-detail-offset` (defined MapHero:1225, `0rem`; written live by MapHero:1017-1024 effect to the open
    detail width, `3.7rem` collapsed, `0` closed). Right-anchored chrome (freshness, near-me, peek, live-edge,
    feed-stall) reads it so it slides clear of the open detail panel — e.g. MapFreshness:45
    `right: calc(var(--map-detail-offset,0rem)+1rem)`.
- **Rails**: LeftRail = absolute OVERLAY (z-30, AppShell:404-414), draggable-width + collapsible, hidden
  <1024px. Right DETAIL = absolute OVERLAY (z-32, MapDetailOverlay:145-155), draggable left-edge (6px handle) +
  collapse-to-the-right to a 3.7rem icon strip. **Neither rail ever resizes the GL canvas** — the map sizes off
  its own ResizeObserver (documented law, MapHero:1166-1170, MapDetailOverlay:1-15). This is the surface's
  defining architectural invariant.
- **Floating chrome top offsets** (from canvas top): title/near-me/live-edge `1.15rem`/`1rem`
  (MapHeadTitle:43, MapOverlayChrome:215), freshness `1rem` (MapFreshness:44), filter panel `5.25rem`
  (MapOverlayChrome:188), feed-stall `3.6rem` (MapFeedStallBanner:91). Near-me/filter-pill anchor to the
  BOTTOM (`bottom: 5.1rem` MapNearMeControl:283; `bottom: 2.5rem` MapFilterPill:98).

---

## 3. CONTAINERS (max-widths, grids, padding rhythm)

The surface itself has **no max-width** — full-bleed 100%×100%. Container discipline lives in the overlays:

- **Detail panel**: `RightPanel.svelte:183` `width: 360px` default; resizable via `--app-right-detail-offset`
  (MapHero seeds 360px, MapHero:1224); collapse strip `3.7rem` (RightPanel:201). Clamp bounds in
  `mapDetailPanes.ts` (`MIN/MAX_DETAIL_PANEL_WIDTH`). Declares `container: right-panel / inline-size`
  (RightPanel:197) so the detail body reflows against the DOCK width, not the viewport.
- **Detail attribute grid** (MapSelectionDetail:732-746): `grid-template-columns: 5.75rem minmax(0,1fr)`
  label/value, `min-height: 2.4rem` rows, `padding-block: 0.5rem`, hairline row separators. Collapses to one
  column at `@media (max-width:42rem)` AND `@container right-panel (max-width:21rem)` (MapSelectionDetail:1109, 1149).
- **Route-time 3-column grid** (MapSelectionDetail:1089-1093): `repeat(3, minmax(0,1fr))`; → 1 col at 42rem
  viewport / 21rem container, then Past-dropped stacked list at `@container right-panel (max-width:17rem)`
  (MapSelectionDetail:1193-1215).
- **Hover peek**: `max-width: min(20rem, calc(100%-2rem))`, `padding: 0.85rem 0.9rem` (MapOverlayChrome:195-196).
- **Live-edge / feed-stall pills**: `max-width: min(26rem, calc(100%-2rem))` centred between rail+detail offsets
  (MapOverlayChrome:220, MapFeedStallBanner:97).
- **Motion control**: `width: max-content; max-width: 13.5rem` (MapMotionControl:116-117) — sized for FR
  "Presque en temps réel" on one line.
- **Mobile filter drawer**: `width: min(21rem, calc(100vw-2rem)); max-height: min(72dvh, calc(100dvh-7rem))`
  (MapFilterPill:203-204).
- **Padding rhythm**: detail sections use `gap: 1.15rem` outer / `0.55-0.7rem` inner (MapSelectionDetail:572-575);
  compact/peek variant `gap: 0.7rem` (MapSelectionDetail:576-580). Tokenized (`--radius-*`, `--shadow-*`),
  consistent.

---

## 4. HEADINGS (hierarchy sanity)

Full heading census across the map feature:

| Level | Where | Text |
|---|---|---|
| h1 | `MapHeadTitle.svelte:33` | "Live map." (surface title) — exactly one h1. GOOD. |
| h2 | `MapSelectionDetail.svelte:112` | `{detail.title}` (selected entity title) |
| h3 | `MapSelectionDetail.svelte:246,275,338,368,423,496` | Past/Next stops, Live buses, Stops, Routes |
| h3 | `MapDetailAlerts.svelte:30` | Alerts |
| h4 | `MapSelectionDetail.svelte:371,521,531,541` | Direction blocks; Past/Next/Live time columns |

**Verdict: hierarchy is clean and correctly nested — h1(title) → h2(entity) → h3(section) → h4(sub-block),
no skipped levels.** Caveats:
- The h1 lives in a floating overlay (`MapHeadTitle`), the h2 lives in the CONDITIONAL detail panel
  (`detailOpen`). When nothing is selected the DOM has an h1 and no h2/h3 — valid but sparse until interaction.
- The hover-peek renders a SECOND `MapSelectionDetail` with its own h2 (MapOverlayChrome:170). While hovering
  AND a detail is open there are **two live h2s** simultaneously (peek + docked detail) — a duplicate-h2 that a
  strict outline audit would flag (both describe distinct live regions, so it's minor).

---

## 5. ABSENCE STATES (missing-data honesty)

This surface is a **strong exemplar** of the site-wide unknown-data layer (`$lib/components/edge`
`AbsentValue`/`MaybeValue`, `$lib/site/absence`). Enumerated:

- **Vehicle detail fields** wrap every nullable live field in `<MaybeValue present={...} reason={vehicleAbsence}>`
  — Route (MapSelectionDetail:145), Crowding (181), Trip (228), Next stop (211, reason `detail.nextStopAbsence`).
  `vehicleFieldAbsence({stale, metro})` yields the honest reason: metro→"no live data here",
  stale→"not reporting", else→"not reported".
- **Delay** never bare-dashes: `MapDelayTag` takes `ctx={{stale, metro}}` and renders its own absence
  (MapSelectionDetail:198-204).
- **Not-reporting caution** (MapSelectionDetail:135-140): per-bus stale-GPS note "Not reporting GPS · last
  updated position N ago", driven by `vehicleAbsence(selectedDetail, sharedClock.serverNow)` (MapHero:479).
- **Stop names never leak a bare id**: `stopRefName` snippet (MapSelectionDetail:98-104) →
  `stopNameFallback(id,locale)` "Stop {id} (name unavailable)". Route long-name fallback `routeNameFallback`
  (MapSelectionDetail:326).
- **Inferred direction label** marked via `<AbsentValue reason="inferred">` (MapSelectionDetail:377).
- **ETA absent** → `<MaybeValue reason="no-prediction">` "ETA unavailable" instead of dropping the row (MapSelectionDetail:299).
- **Empty Live column** → honest `<AbsentValue reason="no-prediction">` row, never dropped (MapSelectionDetail:551-552).
- **Past/Next time lists** fall back to `{t.noData}` `<li>` when empty (MapSelectionDetail:525, 535).
- **Sequence-unknown** stops get `aria-label="Sequence unknown"` + empty index cell (MapSelectionDetail:256, 393).
- **Map-level**: `liveEdgeState` = `unavailable` / `no-vehicles` renders a calm floating pill
  (MapOverlayChrome:157-166); `isStale` renders the feed-stall banner. Both honest, non-blocking, never blank
  the canvas.

**Bare-dash / null leaks found: NONE.** The one honest gap is documented debt (MapHero:402-410): "no-vehicles"
cannot yet infer overnight-vs-partial, and per-bus "last seen N ago" is deferred because `updated_utc` is the
uniform snapshot capture time (MEMORY: vehicle-updated-utc-uniform). This is a data-pipeline limitation, not a
UI leak.

---

## 6. EXPLAINER LINKS (link to /metrics how-we-measure?)

- **The ONLY explainer link on the surface** is the motion control: `MapMotionControl.svelte:51,99`
  `href = localizeHref('/metrics', locale) + '#live-positions'` → "How this works". Correctly locale-prefixed.
  Genuinely good for the raw-vs-smooth motion concept.
- **Everything else in the detail panel is UNLINKED to its metric explainer.** The detail surfaces Status,
  Crowding, Delay, ETA, on-time semantics — none link to their `/metrics` how-we-measure entry. A reader who
  wonders "what does 'Late' mean / how is delay measured?" has no in-context path. The detail drill buttons
  (`onfilter`/`onselect`) only re-filter the MAP; they never open the definition.
- **Freshness / feed-stall / staleness** (3×ttl = 90s window) are explained only in code comments, never
  surfaced to the reader with a "why 90s?" link.

**Verdict: 1 of ~6 metric-bearing concepts is explainer-linked (motion only). This is the single biggest
"portfolio polish" gap after cross-surface navigation.**

---

## 7. MOBILE-390 READ FROM CODE

**Breakpoints in play** (three distinct lines — a mild smell):
- `1024px` = canonical `layout.isDesktop` / rail / Controls-panel-vs-pill line (AppShell:464, MapFilterPill:239,
  MapOverlayChrome:254, MapHero `isDesktopViewport()` matchMedia MapHero:158).
- `1023px` max = panel/peek hide (MapOverlayChrome:254), title compaction (MapHeadTitle:92).
- `760px` max = floating freshness→head-freshness swap (MapFreshness:87), feed-stall repositions to bottom
  (MapFeedStallBanner:114), near-me mobile block (MapNearMeControl:583).
- `42rem` (~672px) + container `21rem`/`17rem` = detail-panel reflow (MapSelectionDetail).

At **390px** the layout is: no left rail (offset 0), TopBar burger, mobile **Controls pill** fixed bottom-left
(`bottom: calc(2.5rem + safe-area)`, `left: 0.75rem`, MapFilterPill:97-99), near-me bottom-anchored,
head-placement freshness tucked into the kicker row, detail in a **BottomSheet** (`max-h-[85svh]`, BottomSheet:71).

**Touch-target audit (from classes):**
- Mobile Controls pill: `min-height: 44px` ✓ (MapFilterPill:107) — the one control that meets 44px.
- Filter chips (`.mf-chip`): `min-height: var(--mf-control-size)` = **2rem / 32px** (MapFilters:471,716) — BELOW 44px.
  Collapsed chips `2rem × 2rem` squares (MapFilters:734-742) — 32px, below.
- Motion switch: `min-height: 2rem` (32px) expanded (MapMotionControl:166); collapsed round button `2rem`
  (MapMotionControl:260-261) — below 44px.
- Detail drill buttons: `.map-inline-action min-height: 1.7rem` (~27px, MapSelectionDetail:772);
  `.map-id-action`/`.map-selection-id min-height: 1.85rem` (~30px, MapSelectionDetail:638,659);
  `.map-stop-action`/`.map-vehicle-action` rows ~40px tall via grid + `padding: 0.5rem` (MapSelectionDetail:951,1015).
- Near-me stop rows / submit: `min-height: 2rem` (32px, MapNearMeControl:313,404); near-me toggle at ≤760px
  gets `2.75rem` (44px) (MapNearMeControl:594-596) ✓.
- **Verdict: most interactive controls are 32px, below the 44px touch minimum.** Only the mobile Controls pill
  and the ≤760px near-me toggle explicitly hit 44px.

**Overflow risk at 390px:**
- GL canvas is full-bleed 100vw — no horizontal page scroll possible (shell `overflow-hidden`).
- Detail `map-inline-action` pills switch to `white-space: normal` + wrap at 42rem/container queries
  (MapSelectionDetail:1119-1128), so long stop names wrap instead of overflowing — GOOD.
- Route-time 3-column collapses to 1 col / stacked list (MapSelectionDetail:1138, 1194) — GOOD.
- Title h1 compacts to `--text-subheading` + `right: 0.75rem` bound at ≤1023px (MapHeadTitle:92-102) — safe.
- Minor risk: the ≤760px **kicker row** holds mono kicker + head-freshness with `margin-left:auto`
  (MapFreshness:96); a long FR kicker "RÉSEAU · EN DIRECT" + freshness chip could crowd on 390px, though both
  use `white-space:nowrap` micro text.
- Feed-stall + live-edge pills go full-width bottom / `0.75rem` inset at ≤760px (MapFeedStallBanner:114-123) — safe.

**Chart/canvas sizing on small screens**: the map is the "chart" — it fits the ISLAND bounds with
`MAP_FIT_PADDING_PX = 40` uniform padding on non-desktop (MapHero:196-205; the desktop fraction padding only
applies when `isDesktopLayout`). On 390px the island frames with a 40px inset — stable.

**Sticky behavior on mobile**: nothing is `position:sticky`. The Controls pill and near-me are `position:fixed`
bottom-anchored with `env(safe-area-inset-bottom)` respected (MapFilterPill:98, MapFeedStallBanner:117) — good
notch handling. BottomSheet is `max-h-[85svh]` (uses `svh`, good).

**MOBILE RISK LEVEL: LOW–MEDIUM.** No horizontal-overflow risk (full-bleed + wrapping detail). Real mobile debt
is **touch-target sizing (mostly 32px chips/pills/drill-buttons vs the 44px guideline)** and the three-breakpoint
spread (1024/1023/760) that could drift.

---

## 8. TOP 5 GAPS vs an A++ portfolio case-study page

1. **No network-level verdict / summary.** The surface shows motion but never answers "is the network doing
   well right now?" Add a compact live stat cluster (active vehicles, active alerts, network on-time-ish pulse)
   so the map opens with a judgement, not just dots. Nothing in MapHero surfaces a network aggregate. (§1c-1.)

2. **Walled off from the analytics story — no cross-surface links.** The detail panel drills route→stop→bus
   only WITHIN the map (`onselect`). Add "View reliability →" links from a route detail to `/line/[slug]`,
   from a stop to `/stop/[id]`, so the live map FEEDS the analytics surfaces instead of dead-ending. (§1c-2.)

3. **Metric explainer coverage is 1-of-6.** Only motion links to `/metrics`. Status, Crowding, Delay, ETA, and
   the 90s staleness window have no how-we-measure link. An A++ page makes every measured claim self-explaining. (§6.)

4. **Touch targets below 44px.** Filter chips, motion switch, and inline drill pills are ~32px
   (`--mf-control-size: 2rem`, `.map-inline-action 1.7rem`). Bump interactive controls to a 44px min hit area
   for a credible mobile case study. (§7.)

5. **Empty-state incuriosity + thin global alert story.** "No vehicles" can't say why (documented pipeline debt,
   MapHero:402-410), and there's no on-map "N active alerts" affordance (TopBar `alertCount` isn't wired from
   MapHero). Publishing a network service-span + wiring the alert count would let the map narrate its own quiet/
   degraded states. (§1c-3, §1c-4, §5.)

**Honorable mentions (already A-grade, keep):** the absence-honesty layer (§5) is exemplary; the
full-bleed-canvas-never-resizes overlay architecture is disciplined and well-documented; the motion
raw-vs-smooth honesty toggle with its explainer link is a standout portfolio detail; freshness/feed-stall
chrome is calm and honest.
