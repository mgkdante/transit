# Surface Anatomy — `trip` (`/trip/[id]`)

Scope: `apps/web/src/routes/[[lang=locale]]/trip/[id]/` → mounts `TripDetail`. Trip is **detail-only** (no index route). Reached via deep links from map/stop/line surfaces. It is an **ephemeral live entity** (ids rotate) → `noindex`, absent from sitemap.

## Files read (with roles)

| File | Role |
|---|---|
| `apps/web/src/routes/[[lang=locale]]/trip/[id]/+page.svelte` | Thin mount — renders `<TripDetail id={data.id} />`, no logic |
| `apps/web/src/routes/[[lang=locale]]/trip/[id]/+page.ts` | `PageLoad` — passes `id` (route param) + `lang` (path-derived). No data fetch here |
| `apps/web/src/lib/features/trips/TripDetail.svelte` | **THE surface** (480 lines). Owns all presentation + the live `getTrips()` read |
| `apps/web/src/lib/features/trips/trips.copy.ts` | Bilingual co-located copy (FR canonical, EN mirror) |
| `apps/web/src/routes/+layout.svelte` | Root chrome: AppShell (TopBar + rail) + v1 context + SEO + noindex-for-ephemeral |
| `apps/web/src/lib/components/layout/Surface.svelte` | Width/gutter/pad shell — TripDetail uses `width="wide"` |
| `apps/web/src/lib/components/surface/{ResourceBoundary,SurfaceHeader,FreshnessStamp,MapDrilldownLink}.svelte` | Shared surface spine |
| `apps/web/src/lib/components/brand/{SectionLabel,SectionHeading,StatusDot}.svelte` | Brand primitives |
| `apps/web/src/lib/components/edge/{MaybeValue,AbsentValue}.svelte` | Honest-absence primitives |
| `apps/web/src/lib/site/delayPresentation.ts` | Shared delay→tone→label helpers |
| `apps/web/src/lib/v1/schemas/trips.ts` | Zod `Trip`/`StopEta`/`TripsFile` types |

---

## 1. SECTION ORDER + STORY ARC

The page has **two mutually-exclusive top-level branches** inside `ResourceBoundary`'s loaded snippet (`TripDetail.svelte:110`): a **stand-down** branch (`:111` `trip == null`) and the **live** branch (`:120` `:else`). Below is the live branch, top to bottom.

| # | Heading / label | Component | Data source / selector | File:line |
|---|---|---|---|---|
| — | (skeleton / error / empty gate) | `ResourceBoundary` → `EdgeState` | `createResource(() => getTrips())` | `:52`, `:109` |
| 0a | Stand-down: kicker `TRIP`, `standDownHeading` "Trip not broadcasting", `standDownBody` | plain `<div>` + `SectionLabel` + `<h1>` + `<p>` | `trip == null` (id absent from broadcast) | `:111`–`:119` |
| 0b | **Head** — kicker `TRIP` · heading `Trip {id}` · subheading `// LIVE` · lede | `SurfaceHeader` (→ `SectionLabel` + `SectionHeading`) | static copy + `id` | `:121`–`:137` |
| 0c | Head actions: freshness chip + "View on map" pill | `FreshnessStamp variant="live"` + `MapDrilldownLink` | `trips.data.generated_utc`; `mapHrefFor({trip:id})` | `:127`–`:136` |
| — | hazard rule | `Separator variant="hazard"` | — | `:139` |
| 1 | **Line** (`t.route`) — route code chip → `/lines/{route}` | `SectionLabel variant="metric"` + `MaybeValue` + `<a>` + chevron | `trip.route` | `:143`–`:158` |
| 2 | **Status** (`t.statusHeading`) — colored dot + label | `SectionLabel` + `StatusDot color={trip.status}` + label | `trip.status` (v1 `StatusCode`) | `:160`–`:169` |
| 3 | **Delay** (`t.delayLabel`) — toned reading | `SectionLabel` + `MaybeValue` + `.trip-delay[data-tone]` | `trip.delay_min` via `chipTone`/`delayLabel` | `:171`–`:181` |
| 4 | **Remaining stops** (`t.remainingStops`) — ordered ETA list | `SectionLabel` + `<ol>` of stop rows | `trip.stops[]` (each `{stop, eta_utc, delay_min}`) | `:184`–`:222` |
| 4a | per-stop row: stop id → `/stop/{stop}`, ETA `<time>`, "Live prediction", delay chip, chevron | `<a>` grid + `<time>` + `MaybeValue` + `.trip-stop-delay[data-tone]` | each `stop` | `:189`–`:214` |
| 4b | caveat: `predictionCaveat` "Predictions … can drift; not guaranteed" | `<p class="trip-prediction-caveat">` | static copy | `:216` |
| 4c | (empty stops fallback) `noRemainingStops` | `<p class="trip-novalue">` | `stops.length === 0` | `:217`–`:221` |

### Story-arc assessment

The three summary cells (Line / Status / Delay) sit in a single wrapping flex row (`.trip-summary`), so scroll depth is: **head → one-glance summary → stop-by-stop ETA list → caveat**. Question the reader answers at each depth:

- **Head:** "What am I looking at, is it live, and how fresh?" — answered well (kicker + `// LIVE` + `FreshnessStamp`).
- **Summary row:** "Which line, is it on time, how late?" — answered, but as three bare cells with **no verdict sentence**. The reader has to synthesize "late + 8 min + severe dot" themselves.
- **Stops list:** "When does it reach the stops ahead?" — answered as a chronological list of predictions with per-stop delay basis. This is the strongest section.
- **Caveat:** "How much should I trust these?" — answered honestly.

**Where the story breaks / stalls:**

1. **No context → evidence → verdict spine.** The page is pure evidence. There is no opening one-liner verdict ("Trip 12345 on line 161 is running ~8 min late; next stop in 4 min"). The lede is generic and identical for every trip (`t.lede` at `trips.copy.ts:69/103`) — it never mentions THIS trip's state. A portfolio case-study page leads with the verdict.
2. **The three summary cells never resolve into a sentence.** Status and Delay are the same fact twice (the `chipTone` even derives the chip color FROM `trip.status` to keep them coherent — `:87`–`:105`) yet they are shown as two separate labeled cells. This is redundant, not narrative.
3. **No destination / trip-shape context.** A trip has a route and an ordered stop list but the page never states the headsign/direction, origin, or final destination — the reader sees stop ids (`stop.stop` is a raw id, `:196`) with no human name, so the "story" of where the bus is going is missing.
4. **Stop names are raw ids.** `.trip-stop-name` renders `{stop.stop}` (`:196`) — a GTFS stop id, not a stop name. The narrative "next stops" list reads as opaque codes. (Contrast: the route link shows `trip.route` which is at least a short line code.)
5. **No "where is it now" anchor.** The map pill exists but the page never shows position/progress inline (e.g. "3 of 12 stops remaining" or a progress rail), so the list has no sense of how far along the trip is.
6. **Dead-ends after the caveat.** No cross-links to the line's reliability page beyond the bare route chip, no "see this line's on-time record", no related-trips. The story stops at the caveat.

**Verdict:** honest and clean, but it is a **data readout, not a story** — it presents facts without ever stating what they mean for this specific trip, and the summary's Status/Delay duplication plus raw stop-id list keep it from reading as a narrative.

---

## 2. CHROME

- **Root chrome** comes entirely from `+layout.svelte` → `AppShell` (`shell/AppShell.svelte`): a **TopBar** (documented `h60`, `AppShell.svelte:7`) at the top of a flex column, then a growing row. The content surface renders inside `#main` which is `flex h-full w-full flex-col overflow-y-auto` (`+layout.svelte:480–484`) — i.e. **the page scrolls INSIDE `#main`, the TopBar does not scroll away** because it is a sibling above the scroll container, not `position: sticky`. TopBar `position: fixed` styles apply only to mobile search/menu overlays and backdrops (`TopBar.svelte:570,578`), not the bar itself in the content-surface layout.
- **`--chrome-offset`: NOT used** anywhere in TripDetail or its shared components (grepped: zero hits). The surface has **no sticky elements of its own** — no sticky header, no sticky rail, no sticky summary. `.trip-summary` scrolls away with the page.
- **Rails:** TripDetail uses **no rail**. It is a single-column `Surface` (unlike line/stop detail which use `RailLayout`/`ListDetailGrid`). The AppShell LeftRail overlay (nav) is present site-wide at ≥1024px but is chrome, not part of this surface.
- **Footer:** rendered by the layout (`+layout.svelte:503`) since trip is not full-bleed (`isFullBleed` is `/map`-only, `:112`).
- **z-index:** all z-index is chrome-level (TopBar 45–65, AppShell rail 30/32). TripDetail declares none.

---

## 3. CONTAINERS

- **`Surface width="wide"`** (`TripDetail.svelte:108`) → `max-width: var(--container-wide)` = **72rem** (`tokens.css:89`). Centered via `margin-inline: auto`. (Content width would be 64rem; wide chosen even though the content is a narrow single column — see gaps.)
- **Gutter:** `padding-inline: var(--space-page-x)` = `clamp(1rem, 4vw, 5rem)` (`tokens.css:43`) — 16px on mobile up to 80px on wide desktop.
- **Vertical pad:** `pad="surface"` → `padding-block: clamp(1.5rem, 4vw, 2.5rem)` (`Surface.svelte`).
- **Surface internal gap:** `gap: clamp(1.75rem, 4vw, 2.75rem)` between direct children (Surface flex column).
- **TripDetail grid/spacing rhythm (all rem-relative, no fixed px containers):**
  - `.trip-head-actions` — flex, wrap, `gap: 1rem` (`:250`)
  - `.trip-body` — flex column, `gap: 1.5rem` (`:257`)
  - `.trip-summary` — **flex wrap**, `gap: 1.5rem 2.5rem` (`:262`) — the Line/Status/Delay cells; NO grid template, they wrap freely
  - `.trip-summary-cell` — flex column, `gap: 0.4rem`
  - `.trip-stops-section` — flex column, `gap: 0.6rem`
  - `.trip-stop-link` — **`display:grid; grid-template-columns: minmax(0,1fr) auto auto`** (`:364–365`), `gap: 0.875rem`, with a negative-margin bleed `width: calc(100% + 1rem); margin-inline: -0.5rem; padding: 0.625rem 0.5rem` (`:368–370`) so the hover background extends past the text column.
  - `.trip-standdown-body` / `.trip-prediction-caveat` capped at `max-width: 52ch` (`:245,461`).

Padding rhythm is consistent and token-driven. The one hardcoded radius fallback: `.trip-stop-link border-radius: var(--radius-sm, 0.375rem)` (`:371`).

---

## 4. HEADINGS

- **h1:** exactly one per branch.
  - Stand-down: `<h1 class="trip-standdown-heading">` (`:117`).
  - Live: `SurfaceHeader` defaults `level=1` → `SectionHeading` renders `<h1>` (`SurfaceHeader.svelte:39`, `SectionHeading.svelte:34`).
- **h2–h6:** **NONE.** Every section label (Line / Status / Delay / Remaining stops) is a `SectionLabel` = a `<span>` (`SectionLabel.svelte:38`), **not a heading**. The remaining-stops list has no `<h2>` — its "Remaining stops" label is a styled span.

**Hierarchy verdict:** No *skipped* levels (there is only an h1). But the document **outline is flat** — a screen-reader rotor sees a single h1 and then no structural landmarks for the four content sections. For an A++ page the four section labels (esp. "Remaining stops") should be real `<h2>`s (or the `SectionLabel` should render an `aria`-appropriate heading) so the page has a navigable outline. This is an accessibility + story-structure gap, not a visual one.

---

## 5. ABSENCE STATES

Absence handling is **thorough and idiomatic** — this is the page's strongest dimension.

- **Whole-resource gate:** `ResourceBoundary` (`:109`) renders skeleton / `error-v1` (with retry) / empty via `EdgeState`, so load/error/empty never leak raw.
- **Trip-not-broadcasting stand-down:** `trip == null` → a localized note (`standDownHeading` + `standDownBody`, `:115`–`:119`) instead of a fabricated trip. This is the *expected* path for a stale deep link and is handled first-class.
- **Per-field honest absence via `MaybeValue` (→ `AbsentValue` chip, reason `not-reported`):**
  - Route absent: `MaybeValue present={trip.route != null}` (`:148`)
  - Trip delay absent: `MaybeValue present={trip.delay_min != null}` (`:176`) — comment explicitly says "never a 0"
  - Per-stop delay absent: `MaybeValue present={stop.delay_min != null}` (`:205`)
- **Empty stop list:** `stops.length === 0` → `noRemainingStops` note (`:220`), not a blank `<ol>`.
- **Null-delay never renders 0:** `delayLabel` (`delayPresentation.ts:76`) returns `noDelay` on null, never "0 min"; `delayTone`/`chipTone` return `'none'` which suppresses the `::before` dot (`:329`).
- **No bare dash / `N/A` / `null` leaks** in user-facing copy — verified (`trips.copy.ts` + template scan). The only em-dashes are in JS/HTML comments.

**Minor gap:** the `reason` is always the generic `"not-reported"` for every absent field. Richer reasons exist in `$lib/site/absence` (closed / metro / silent / service-window) but this surface never infers a specific reason — so an absent delay always reads "not reported in the live feed", even when a more specific cause might apply. Also: `t.noRoute` (`trips.copy.ts:72/105`) is defined but **unused** (the route absence goes through `AbsentValue`, not `noRoute`) — dead copy.

---

## 6. EXPLAINER LINKS

**None. This is a real gap.**

- The metrics on this page — **Status** (early/on-time/late/severe band), **Delay** (`delay_min` semantics), and the per-stop **"Live prediction"** — are all methodology-loaded terms, yet **no metric links to its `/metrics` how-we-measure entry.** Grep confirms `TripDetail.svelte` and `trips.copy.ts` reference `/metrics` **zero** times.
- The site has a **canonical pattern for exactly this**: `MetricInfo.svelte` (`features/metrics/MetricInfo.svelte`) — an `(i)` popover with a one-line tip + a deep link to `/metrics#<anchor>`. It is wired on `RouteDetail` (`:56,246`), `NetworkSurface`, `Section2TheWait`, `Section3RunAndFit`, `HotspotsBoard`, `AccountabilityReceipt`. TripDetail is a conspicuous omission.
- The only methodology gesture on the page is the inline `predictionCaveat` sentence (`:216`) — honest, but not a link into the explainer, and Status/Delay get no explanation at all.

An A++ version would attach `MetricInfo` to the **Status** and **Delay** labels (deep-linking to the status-band and delay explainer anchors) and to the **Live prediction** framing.

---

## 7. MOBILE-390 READ (from code)

- **Breakpoints in TripDetail:** effectively **none for layout**. The only `@media` is `prefers-reduced-motion: reduce` (`:467`). All responsiveness is via `flex-wrap` on `.trip-summary` (`:264`) and `.trip-head-actions` (`:252`), plus `clamp()` gutters/pads from `Surface`/tokens. So at 390px the summary cells stack when they no longer fit and the head actions wrap — graceful, but no *intentional* mobile layout.
- **Overflow risks at 390px:**
  - `.trip-stop-link` is `grid-template-columns: minmax(0,1fr) auto auto` with `gap: 0.875rem` and three items on ONE line: stop-name (ellipsis-truncated, `:380–382` — safe) | `.trip-stop-live` (ETA + "LIVE PREDICTION" uppercase + delay chip) | chevron. The **middle `auto` column `.trip-stop-live`** packs `time` + an uppercase "Live prediction" label + a delay chip in a nowrap inline-flex (`:385–391`, `gap:0.5rem`). At 390px, with the negative-margin bleed adding `calc(100% + 1rem)` width (`:368`), this middle cluster is the **top overflow risk** — "LIVE PREDICTION" (13 chars uppercased, mono) beside an ETA and a delay chip can exceed the `auto` track and squeeze the `1fr` name column to near-zero. There is no mobile rule to drop the "Live prediction" label or wrap the cluster below the name.
  - `.trip-delay` / `.trip-stop-delay` are mono nowrap (`:406`) — "X min late" stays on one line; low risk.
  - `.absent-value--inline` (the honest-absence chip) is `flex-wrap: wrap; max-width:100%` (`AbsentValue.svelte`) — wraps cleanly, safe.
- **Touch-target sizes (from classes) — several BELOW 44px:**
  - `.map-drilldown-link` — `min-height: 2rem` = **32px** (`MapDrilldownLink.svelte:35`). Under 44px.
  - `.trip-route-link` — no min-height; `inline-flex` around a single mono line ≈ **~24px** tall. Under 44px.
  - `.trip-stop-link` — `padding: 0.625rem 0.5rem` = 10px block padding on one `--text-body` line ≈ **~40px** tall (`:370`). Just under 44px. This is the primary tap target (the whole row), so it should reach 44px.
  - Positive: focus-visible rings present on all three (`:296,451`, `MapDrilldownLink:54`).
- **Chart sizing on small screens:** **N/A — there are no charts.** The surface has zero dataviz marks (no LayerChart, no SVG), only text + status dots. So no small-screen chart strategy is needed (and none exists).
- **Sticky behavior on mobile:** none. `#main` scrolls (`overflow-y-auto`, `+layout.svelte:482`); TripDetail has no sticky summary, so on a long stop list the reader loses the Line/Status/Delay context as they scroll — a case for a sticky mini-summary on mobile.

**Mobile risk level: MODERATE.** No layout breakpoints and sub-44px tap targets are real issues, and the 3-column stop row's middle cluster is a genuine narrow-viewport overflow risk, but flex-wrap + ellipsis + token clamps keep it from hard-breaking.

---

## 8. TOP 5 GAPS vs an A++ portfolio case-study page

1. **No verdict / no context→evidence→verdict spine.** The page opens with a generic, trip-agnostic lede and shows three bare summary cells. A++ leads with a synthesized one-liner for THIS trip ("Line 161 · running ~8 min late · next stop in 4 min · 9 stops remaining") and collapses the redundant Status+Delay pair into a single verdict, so the reader gets the answer before the evidence.
2. **Raw stop ids instead of names + no destination/direction.** `.trip-stop-name` shows the GTFS `stop` id (`:196`) and the page never states headsign/final destination or "N of M stops remaining." The "next stops" narrative is opaque. A++ resolves stop names (there is a stops index available in the shell) and frames progress along the trip.
3. **Zero explainer links.** Status, Delay, and "Live prediction" are methodology-heavy but link to nothing, while the site's `MetricInfo` `(i)` pattern is used on every other data surface. A++ wires `MetricInfo` → `/metrics#…` on each metric.
4. **Flat heading outline + no charts / no visual evidence.** Only one `h1`; all section labels are spans, so there is no navigable outline; and the page is text-only — no timeline/progress rail, no delay sparkline, no map inline. A++ gives the ETA list real `<h2>` structure and at least one visual (a progress-along-route rail or a delay-over-stops mini chart), turning the list into a story.
5. **Mobile polish: sub-44px tap targets + no sticky context + narrow-row overflow risk.** The whole-row stop link (~40px), map pill (32px), and route link (~24px) miss 44px; there is no sticky mini-summary so context is lost on scroll; and the 3-up stop row's middle cluster ("LIVE PREDICTION" + ETA + chip) risks crowding at 390px with no mobile fallback. A++ hits 44px targets, adds a sticky summary on mobile, and wraps/drops the prediction label on narrow rows.

### Smaller notes
- `Surface width="wide"` (72rem) for a single narrow text column wastes measure on desktop; `content` (64rem) or an intentional two-column (summary rail + stops) would read tighter.
- `t.noRoute` copy is defined but unused (dead) — route absence routes through `AbsentValue`.
- Absence `reason` is always the generic `"not-reported"`; richer `$lib/site/absence` reasons are never inferred here.
