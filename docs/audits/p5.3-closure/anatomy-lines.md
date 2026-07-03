# Surface Anatomy — "Lines" index (`/lines`)

Entry route: `apps/web/src/routes/[[lang=locale]]/lines/+page.svelte` (13 lines, thin mount).
Feature screen: `apps/web/src/lib/features/lines/LinesIndex.svelte` (owns ALL composition + data load; 285 lines).
Co-located copy: `apps/web/src/lib/features/lines/lines.copy.ts` (`indexCopy` block, lines 130–167).

> NOTE ON SCOPE: the large `apps/web/src/lib/features/lines/reliability/**` subtree (sections/, selectors/, RouteReliabilityClusters, VerdictBanner, MetricBullet, habits heatmaps, etc.) belongs to the **detail** page `lines/[id]/+page.svelte`, NOT this index. The index composes only the shared surface spine + `ReliabilityBadge`. Confirmed: `LinesIndex.svelte` imports nothing from `./reliability`.

---

## 0. Composition tree (what the index actually mounts)

```
+page.svelte  (mount)
└─ LinesIndex.svelte
   ├─ Surface            (layout/Surface.svelte)            width="bleed" pad="hub"
   │  ├─ SurfaceHeader   (surface/SurfaceHeader.svelte)     kicker/heading/lede
   │  │  ├─ SectionLabel (brand/SectionLabel.svelte)        variant="station"
   │  │  ├─ SectionHeading(brand/SectionHeading.svelte)     level=1, dot
   │  │  └─ ControlsRail (layout/ControlsRail.svelte)       label="Controls" (NON-sticky here)
   │  │     ├─ SearchInput (surface/SearchInput.svelte)     bind:query
   │  │     ├─ GrainPicker (surface/GrainPicker.svelte)     sort: alpha|worst  (radiogroup)
   │  │     └─ GrainPicker (surface/GrainPicker.svelte)     status: all|problem (radiogroup)
   │  ├─ Separator       (ui/separator, variant="hazard")
   │  └─ ResourceBoundary(surface/ResourceBoundary.svelte)  gate on getRoutesIndex()
   │     └─ EntityList   (surface/EntityList.svelte)        grid minTile="360px"
   │        └─ DashboardGrid (layout/DashboardGrid.svelte) as="ul", auto-fit board
   │           └─ (per row) .line-result
   │              ├─ EntityRow          (surface/EntityRow.svelte)   → /lines/<id>
   │              ├─ ReliabilityBadge   (surface/ReliabilityBadge.svelte)  status dot + OTP%
   │              └─ MapDrilldownLink   (surface/MapDrilldownLink.svelte)  → /map?route=<id>
```

Chrome wrapper (from root layout, every page): `routes/+layout.svelte` renders `AppShell` (TopBar h60 + persistent LeftRail overlay) and puts the page tree inside `#main` (`overflow-y-auto`). So the page scrolls **inside `#main`**, not the window.

Data sources:
- Static catalogue: `getRoutesIndex()` → `RoutesIndex` (`src/lib/v1/schemas/routes_index.ts`). Each `RouteIndexEntry` = `{ id, short, type (GTFS route_type int), long?, color?, reliability? }`. Wrapped in `createResource` (LinesIndex L53).
- Per-row headline reliability: `createReliabilityLoader('route')` (`src/lib/v1/reliabilitySnapshot.svelte.ts`) — per-id cache, concurrency cap, viewport-gated via `use:observeReliability={r.id}` action (LinesIndex L58–59, L187). Feeds `ReliabilityBadge`.

---

## 1. SECTION ORDER + STORY ARC

This surface is a **catalogue/index**, not a narrative dashboard. Top-to-bottom there are effectively **3 blocks** (header, divider, list):

| # | "Section" | Heading text | Component | Data / selector |
|---|-----------|--------------|-----------|-----------------|
| 1 | Surface head | `Lines` (h1) + kicker `LINES · NETWORK` + lede | `SurfaceHeader` (LinesIndex L140–166) | copy only (`indexCopy[locale]`, lines.copy.ts 130–167) |
| 1a | Controls (nested in head) | mono overline `Controls` | `ControlsRail` → `SearchInput` + 2× `GrainPicker` | local `$state` query/sort/status |
| 2 | Divider | — | `Separator variant="hazard"` (L168) | — |
| 3 | The catalogue | (no heading) | `ResourceBoundary` → `EntityList grid` (L170–205) | `getRoutesIndex()` filtered/sorted/status-filtered; per-row `ReliabilityBadge` from lazy loader |

### Story-arc assessment

Reader questions by scroll depth:
- **Head:** "What is this page?" → answered well. Kicker + heading + a lede that names the /v1 provenance ("Measured from the /v1 contract."). Good context framing.
- **Controls:** "How do I find/rank a line?" → answered: filter box, sort (Alphabetical | Least reliable), reliability filter (All | Late). This is genuinely good — the "Least reliable" sort + "Late" filter give the catalogue an editorial point of view (worst-first), which is more than a bare A–Z list.
- **List:** "Which line do I want, and is it healthy?" → answered at the row level via the `ReliabilityBadge` (status dot + OTP%). Each row is context (name) + evidence (OTP badge) + affordance (open detail / open on map).

Where the story **breaks or stalls**:
1. **No network-level verdict / summary.** The page jumps straight from "here's what this is" to a raw list of ~220 rows. There is no "the network is X% on time today", no count of how many lines are Late/Severe, no "N lines need attention". A portfolio story wants context → **evidence (aggregate)** → verdict before dropping the reader into the enumerated list. The worst-first sort *implies* a verdict but never states one.
2. **The badge is the only evidence, and it is silent for a large fraction of rows.** `ReliabilityBadge` renders **nothing** unless `phase==='ready' && verdict!=null && otp!=null` (ReliabilityBadge L63). Metro rows and any route without published `route_reliability` show name + glyph only — no badge, no "no data" chip. Honest, but the story reads as half-empty: many rows have no evidence at all, and there's no on-row honest-absence marker explaining *why* (unlike the rest of the site's `AbsentValue` doctrine).
3. **No freshness stamp on the surface.** Other analytics surfaces show a `FreshnessStamp`; the index shows no "as of" for the reliability badges (which are "always the latest day" per the file's DEFER note L24–26). The reader can't tell how current the OTP numbers are.
4. **The worst-first ordering is unstable while badges stream in.** By design (L96–104) unloaded rows sink to rank 99, so the "Least reliable" list re-sorts as verdicts arrive on scroll. The intent is documented and defensible, but as a *story* it means the "worst lines" ranking is never authoritative on first paint — the top of the list can reshuffle.
5. **No grouping.** All modes (metro, bus, tram) are flat-sorted numeric-alpha. There is no "Métro / Bus" sectioning, no route-type facet. A rider scanning for the 4 metro lines vs 200 bus lines has only the glyph to distinguish them.

What's **missing for it to read as a story** (context → evidence → verdict):
- A **verdict band** at the top: network OTP aggregate + count of Late/Severe lines (this is the missing "verdict").
- Per-row **honest absence** when no badge (a MaybeValue/AbsentValue chip, matching the site-wide unknown-data doctrine).
- A **freshness stamp** so the evidence is dated.
- Optional **mode grouping/facet** so the enumerated list has structure.

Net: it is a **competent, honest catalogue with a good filter/sort editorial layer but no narrative spine** — it never states the network-level verdict that the "worst-first" sort is gesturing at.

---

## 2. CHROME

- **App chrome (from `routes/+layout.svelte` → `AppShell.svelte`):**
  - `TopBar` — fixed strip, `h-[60px]`, `z-40`, `border-b`, `bg-card` (`shell/TopBar.svelte` L273). This is the only true sticky/fixed chrome for this page.
  - `LeftRail` — desktop overlay column, `z-30`, revealed ≥1024px, width via `--app-left-rail-offset` (default expanded `16rem`, collapsed `4.85rem`; mobile `0px`). Draggable/resizable handle. (`AppShell.svelte` L383–477.)
  - `#main` scroll container — `overflow-y-auto` for document surfaces (non-map). The page scrolls here; the window does not. Non-map `<main>` gets `padding-left: var(--app-left-rail-offset)` so content clears the rail (AppShell L397–399).
  - `Footer` at the natural bottom of the scroll flow (layout L503–509).
- **`--chrome-offset`:** NOT used anywhere in the codebase (grep across `.svelte`/`.ts`/`.css` returned zero hits). The rail offset var is `--app-left-rail-offset`; the sticky-rail offset var is `--rail-sticky-top` (default `5.5rem`).
- **Sticky elements ON this surface:** effectively **none inside the page**. `ControlsRail` supports `sticky` (position:sticky, `top: var(--rail-sticky-top, 5.5rem)`, `z-index: var(--z-rail)`, ControlsRail L108–125) **but LinesIndex does NOT pass `sticky`** (L146). So the search/sort/status controls scroll away with the list — a UX gap on a long catalogue (you must scroll back up to re-filter).
- **Rails:** `RailLayout` exists in `layout/` but is NOT used here. The index is a single-column Surface, not a rail layout.

---

## 3. CONTAINERS

- **Surface** (`Surface.svelte`): `width="bleed"` → `max-width: none` (Surface L22–28). **The catalogue is NOT capped to a reading measure** — it spans the full content column (viewport minus rail minus page gutter). `pad="hub"` → `padding-block: clamp(2rem, 6vw, 4rem)`. `gutter=true` (default) → `padding-inline: var(--space-page-x)` = `clamp(1rem, 4vw, 5rem)` (tokens.css L43). Internal `gap: clamp(1.75rem, 4vw, 2.75rem)` between head / separator / list.
- **Container tokens** (`src/lib/styles/tokens.css`): `--container-content: 64rem` (L88), `--container-wide: 72rem` (L89), `--space-page-x: clamp(1rem,4vw,5rem)` (L43). The index uses **none of the caps** (bleed).
- **Grid template — the catalogue board** (`DashboardGrid.svelte` L122–124, via `EntityList grid`):
  `grid-template-columns: repeat(auto-fit, minmax(min(var(--min-tile), 100%), 1fr))`, `--min-tile: 360px` (passed by LinesIndex L182), `gap: var(--space-card-gap)`. So the board is 2-up (or more on a wide viewport), reflowing to 1 column when a 360px tile no longer fits. `gutter={false}` passed by EntityList (its own gutter is off; the outer Surface owns page gutter).
- **Row template** (`.line-result`, LinesIndex L251–257): `grid-template-columns: minmax(0,1fr) auto auto` (body | badge | map), `align-items:center`, `gap:0.75rem`, `padding:0.75rem 0.875rem`.
- **Tile chrome** (`EntityList.svelte` L118–123, grid mode): each `<li>` → `border:1px solid var(--border)`, `border-radius: var(--radius-lg)`, `background: var(--card)`.
- **Padding rhythm:** consistent 0.75rem/0.875rem inside rows and controls; head gap 0.75rem (SurfaceHeader L59). ControlsRail body gap overridden to 0.85rem column stack (LinesIndex L225–229).

---

## 4. HEADINGS — hierarchy sanity

- **h1:** `Lines` — the ONLY heading on the page. `SurfaceHeader` passes `level=1` to `SectionHeading` (SurfaceHeader L47; default level=1 L39). ✅ correct page-level h1.
- **No h2/h3/h4 anywhere on the index.** The catalogue list has **no section heading** at all (the `<ul>`/`DashboardGrid` carries no `<h2>` and no `aria-label` region — DashboardGrid suppresses the region landmark for list elements, L98–100).
- **Skipped levels:** none in the strict sense (there is only h1). But the **absence** of any h2 for the list means the enumerated catalogue is an unheaded region — a screen-reader user navigating by heading finds only "Lines" and then nothing structural. The `ControlsRail` uses a `<span>` mono overline ("Controls"), not a heading — correct (it's a labelled `group`, ControlsRail L58–64), but it means the controls zone also contributes no heading.
- **Verdict:** hierarchy is *technically* clean (single h1, no skips) but **structurally thin** — a portfolio page would give the list an h2 ("All lines" / "220 lines") and possibly mode-group h3s.

---

## 5. ABSENCE STATES

- **Whole-resource states** — handled by `ResourceBoundary` (L170) → `EdgeState`:
  - loading → `skeleton` (layout-aware; desktop 3-volet shimmer, mobile card).
  - error → `error-v1` (red dataviz-severe, retry button, honesty pledge copy).
  - empty (`isEmpty={(d)=>d.routes.length===0}`, L170) → `empty` variant ("Nothing to show / No data published yet").
  - `no_results` is available in EdgeState/ResourceBoundary but **NOT wired here** — the text filter (`query`) narrows the list *inside* the loaded data, so filtering everything out yields an **empty `<ul>` with no "No results, widen your search" message**. This is a real gap: `ResourceBoundary.isNoResults` is supported (ResourceBoundary L54–60) but LinesIndex passes only `isEmpty`, so a query matching zero routes shows a blank board, not the `no-results` edge state.
- **Per-row absence** — `ReliabilityBadge` is **fail-soft by omission** (L62–63, L69): renders literally nothing when no verdict/OTP. Consequences:
  - No bare dash / null leak (✅ honest — never a fabricated 0%).
  - BUT also **no honest-absence marker** — a metro row or an un-probed route shows name+glyph with an empty meta cell and **no explanation** ("no reliability data" / "metro has no realtime"). This diverges from the site-wide unknown-data doctrine (`AbsentValue`/`MaybeValue`/`absentReason` in `lib/components/edge/`) that the rest of the app adopted. The index row does **not** use `AbsentValue`.
  - SR nuance for the filtered case IS handled: when the "problem" filter is on and no visible row has a verdict yet, a polite `role=status` sr-only caption announces "Loading reliability for the visible lines…" (LinesIndex L132–136, L174–176). Good, but sighted users see the same rows badge-less with no visible hint.
- **No bare dash/`null`/`NaN` leaks found** anywhere on the index. The honesty posture is strong at the value level; the weakness is the *missing* absence explanation, not a leaked sentinel.

---

## 6. EXPLAINER LINKS (link to `/metrics` how-we-measure)

- **NONE.** Grep for `metricsHrefFor` / `/metrics#` / `howWeMeasure` / `MetricLink` / any `/metrics` href across `features/lines` and `components/surface` returned **zero hits**.
- The lede says "Measured from the /v1 contract." (lines.copy.ts L152) but **does not link** anywhere. The `ReliabilityBadge` surfaces an OTP% and a verdict word (On time / Late / Severe) with **no link** to the definition of "on time", the delay band thresholds, or how OTP is computed.
- The detail page (`lines/[id]`) and `/metrics` own the "how we measure" content, but the **index gives the reader no path to it** — the OTP% and the Late/Severe verdicts appear with no way to learn what they mean from this surface.
- **Verdict:** explainer-link coverage on this surface = **0%.** This is a concrete A++ gap: every metric shown (OTP%, verdict) should link to its `/metrics` how-we-measure entry (or at least the lede's "/v1 contract" phrase should be a link).

---

## 7. MOBILE-390 READ (from code)

- **Breakpoints in play for this surface:**
  - `@media (max-width: 32rem)` (=512px) — LinesIndex L264–284: the row collapses from 3-col (body|badge|map) to a 2-col `grid-template-areas` (`'main map' / 'badge map'`), badge tucks under the name, `row-gap:0.25rem`, badge indented `padding-left:0.875rem`. At 390px this branch is active.
  - `@media (min-width: 1024px)` — desktop rail reveal (AppShell) + ControlsRail sticky (unused here). Below 1024px the LeftRail is hidden (`--app-left-rail-offset:0px`), TopBar burger owns nav. So at 390px the content is full-width minus page gutter only.
  - DashboardGrid auto-fit with `minTile=360px`: at 390px viewport minus `--space-page-x` (min 1rem each side → ~358px usable) the 360px min **does not fit → single column** via the `min(var(--min-tile),100%)` guard (DashboardGrid L124). So one tile per row on a phone. ✅ no horizontal overflow from the grid.
- **Overflow risks at 390px:**
  - `EntityRow` title uses `white-space:nowrap; text-overflow:ellipsis` with `min-width:0` on the body (EntityRow L152–159, L143–145) → long line long-names truncate cleanly. ✅
  - The row's 2-col mobile template puts the map pill in a full-height `map` area spanning both text rows. With a long `short` title + badge, the `minmax(0,1fr)` body column absorbs shrink; low overflow risk. The `MapDrilldownLink` is `min-height:2rem` (32px) fixed — it won't wrap.
  - `ControlsRail` body is `flex-wrap:wrap` (ControlsRail L100–106) and LinesIndex stacks it column at all sizes (L225–229) with `.lines-controls` also `flex-wrap:wrap` (L230–234) → the two GrainPickers wrap onto their own rows. Each GrainPicker is itself `flex-wrap:wrap` (GrainPicker L131). Low overflow risk; may get tall on a phone.
  - `SearchInput` field is `max-width:28rem` (SearchInput L64) and `width:100%` control — fine at 390px.
- **Touch-target sizes (from classes):**
  - `GrainPicker` segments: `min-height:44px` explicitly (GrainPicker L146–151, with a WCAG 2.5.8 comment noting they were fixed up from ~31px). ✅ 44px.
  - `MapDrilldownLink`: `min-height:2rem` = **32px** (MapDrilldownLink L36). ❌ **below the 44px touch target** — the "Map" pill is a small tap target on a phone. Concrete gap.
  - `EntityRow` anchor: `padding:0.75rem 0.875rem` (~12px vertical) around a `--text-body` title → row anchor is comfortably >44px tall. ✅
  - `SearchInput` control: `padding:0.75rem` → ~44px+ tall. ✅
- **Chart sizing on small screens:** N/A — the index has **no charts**. The only data mark is the inline `ReliabilityBadge` (a dot + mono OTP%, `white-space:nowrap`, tabular-nums, ReliabilityBadge L92–101) which is size-stable and doesn't reflow. No small-screen chart strategy needed.
- **Sticky behavior on mobile:** none. TopBar is fixed (h60) above `#main`; the page controls are non-sticky and scroll away. `ControlsRail` explicitly drops sticky on mobile by design (ControlsRail L98–107, sticky only inside the `min-width:1024px` block) — but it's not sticky on desktop here either (not passed).
- **Mobile risk level: LOW–MEDIUM.** No overflow, grid degrades to 1-col cleanly, titles ellipsize. The two real mobile defects are (a) the **32px "Map" pill** (sub-44px tap target) and (b) **controls scroll away** on a long list (no sticky filter), forcing scroll-to-top to re-filter.

---

## 8. TOP 5 gaps vs an A++ portfolio case-study page

1. **No network-level verdict / summary band (missing the "verdict").** The page enumerates ~220 rows with no aggregate: no network OTP, no "N lines Late / M Severe today", no headline. The worst-first sort implies a verdict it never states. Add a compact verdict/summary block between the head and the list (context → aggregate evidence → verdict, THEN the list). Highest-impact narrative fix.
2. **Metrics have no explainer links (0% coverage).** OTP% and the On-time/Late/Severe verdicts appear with no path to `/metrics` "how we measure". The lede's "Measured from the /v1 contract" isn't even a link. Every shown metric should deep-link its definition — a core trust/portfolio expectation. (Section 6.)
3. **Per-row honest-absence is missing.** Rows with no reliability data (metro, un-probed routes) show an empty meta cell with no explanation, diverging from the site-wide `AbsentValue`/`MaybeValue` unknown-data doctrine the rest of the app adopted. A large fraction of the list is silently evidence-less. Add an on-row absent-reason chip ("no reliability data" / "metro — no realtime"). (Section 5.)
4. **No `no-results` state for the text filter + non-sticky controls.** Filtering to zero matches renders a blank board (only `isEmpty` is wired, not `isNoResults` — ResourceBoundary supports it). And the search/sort/status controls scroll away on a long catalogue. Wire `isNoResults` for a "widen your search" edge state, and make `ControlsRail sticky` (it already supports it) so filtering stays reachable. (Sections 5, 2.)
5. **Thin structure: no list heading, no freshness stamp, no mode grouping, sub-44px map pill.** The catalogue region has no h2 and no `region` label (unheaded for SR heading-nav); there's no `FreshnessStamp` dating the "latest day" reliability; metro/bus/tram are one flat list with only a glyph to distinguish; the "Map" pill is a 32px tap target. Each is a small, concrete polish item that separates a competent index from an A++ one. (Sections 4, 1, 7.)

---

## Appendix — exact file:line index

- Mount: `routes/[[lang=locale]]/lines/+page.svelte:13`
- Screen: `lib/features/lines/LinesIndex.svelte` — Surface L139, SurfaceHeader L140, ControlsRail L146, SearchInput L147, sort GrainPicker L158, status GrainPicker L162, Separator hazard L168, ResourceBoundary L170 (isEmpty only, no isNoResults), EntityList grid minTile 360 L182, per-row `.line-result` L187, EntityRow L188, ReliabilityBadge L196, MapDrilldownLink L197. Worst-first rank L100–114. Problem filter L119–125. SR pending caption L132–136 / L174–176. Mobile `@media 32rem` L264–284.
- Copy: `lib/features/lines/lines.copy.ts:130–167` (indexCopy). Lede (no link) L152 (en) / L134 (fr).
- Surface (bleed = no max-width): `lib/components/layout/Surface.svelte:22–28`, pad hub L56–58, gutter L50–52.
- ControlsRail sticky support (unused): `lib/components/layout/ControlsRail.svelte:108–125`.
- DashboardGrid auto-fit: `lib/components/layout/DashboardGrid.svelte:122–124` (minTile via EntityList).
- EntityList grid tile chrome: `lib/components/surface/EntityList.svelte:118–123`.
- EntityRow title ellipsis / min-width-0: `lib/components/surface/EntityRow.svelte:143–159`.
- ReliabilityBadge fail-soft gate: `lib/components/surface/ReliabilityBadge.svelte:62–63,69`.
- GrainPicker 44px target: `lib/components/surface/GrainPicker.svelte:146–151`.
- MapDrilldownLink 32px (sub-44px): `lib/components/surface/MapDrilldownLink.svelte:36`.
- SearchInput: `lib/components/surface/SearchInput.svelte:64` (max-width 28rem).
- ResourceBoundary states (skeleton/error/empty/no_results): `lib/components/surface/ResourceBoundary.svelte:97–121`.
- EdgeState variants + honest-absence reason copy: `lib/components/edge/EdgeState.svelte:115–236`.
- Chrome: `routes/+layout.svelte:462–512` (AppShell + #main overflow-y-auto L482), `lib/components/shell/AppShell.svelte:383–477` (rail offset var), `lib/components/shell/TopBar.svelte:273` (h-[60px]).
- Tokens: `lib/styles/tokens.css:43` (--space-page-x), `:88` (--container-content 64rem), `:89` (--container-wide 72rem).
- RouteIndexEntry shape: `lib/v1/schemas/routes_index.ts:9–21`.
- Reliability loader: `lib/v1/reliabilitySnapshot.svelte.ts` (createReliabilityLoader, viewport-gated action).
- `--chrome-offset`: NOT present anywhere (grep confirmed).
- `/metrics` explainer link on this surface: NONE (grep confirmed).
