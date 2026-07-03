# Surface Anatomy — "stops" (Stops index / catalogue)

Route: `apps/web/src/routes/[[lang=locale]]/stops/+page.svelte`
Feature root: `apps/web/src/lib/features/stops/StopsIndex.svelte`
Copy: `apps/web/src/lib/features/stops/stops.copy.ts`

Scope note: this report covers the **Stops INDEX** (search/catalogue surface), i.e. `StopsIndex.svelte`, per the task. The per-stop detail (`StopDetail.svelte`) and its reliability sections under `reliability/` are a DIFFERENT surface (route `/stop/[id]`) and are only referenced where they contrast with the index (e.g. explainer links).

---

## 0. Entry-point chain (files followed)

- `routes/[[lang=locale]]/stops/+page.svelte:1-14` — pure thin mount. No `+page.ts`, no `+layout` under `stops/`. Comment (lines 1-8) states the locale comes from `getLocale()` context and the (~847KB / ~9k-stop) index is loaded **client-side** via `createResource`. So: **no SSR of the list**, no server load, no prerender of results.
- `StopsIndex.svelte:1-417` — owns all presentation + data.
- Composed shared primitives (all read):
  - `components/layout/Surface.svelte` (width/gutter/pad shell)
  - `components/surface/SurfaceHeader.svelte` → `brand/SectionLabel` + `brand/SectionHeading.svelte`
  - `components/layout/ControlsRail.svelte`
  - `components/surface/SearchInput.svelte`
  - `components/ui/line-combobox/line-combobox.svelte` (bits-ui Combobox)
  - `components/surface/GrainPicker.svelte` (repurposed as the sort segmented control)
  - `components/ui/separator/*.svelte` (variant="hazard")
  - `components/surface/ResourceBoundary.svelte` → `components/edge/EdgeState`
  - `components/surface/EntityList.svelte` (→ `layout/DashboardGrid` only in grid mode, not used here)
  - `components/surface/EntityRow.svelte`
  - `components/surface/ReliabilityBadge.svelte` → `dataviz/StatusBadge`
  - `components/surface/MapDrilldownLink.svelte`
- App chrome wrapper: `routes/+layout.svelte:462-512` (AppShell + persistent `#main` scroll container + Footer).

---

## 1. SECTION ORDER + STORY ARC

The page has essentially **one head + one control panel + one result region** — it is a *tool*, not a scrollytelling narrative. Top-to-bottom DOM order inside `<Surface>` (`StopsIndex.svelte:222-301`):

| # | Section | Component (file:line) | Data source / selector |
|---|---------|----------------------|-------------------------|
| 1 | Surface head: kicker `STOPS · CATALOGUE`, `h1` "Stops", mono subheading `// SEARCH`, lede "Search a stop by name or code… We never invent data." | `SurfaceHeader` (`StopsIndex.svelte:223`) w/ copy `stops.copy.ts:143-147` | static copy |
| 2 | Controls panel (one `ControlsRail`): (a) free-text `SearchInput`; (b) `LineCombobox` "Filter by line"; (c) `GrainPicker` used as sort segmented control (Route order \| Least reliable) | `ControlsRail` (`:227-254`) | `query` ephemeral state (`:81`); `selectedLineId` seeded from `?route=` (`:88-100`); `sort` state (`:185`) |
| 3 | Hazard separator (decorative divider between chrome and canvas) | `Separator variant="hazard"` (`:257`) | none |
| 4 | Result region (inside `ResourceBoundary`), ONE of five mutually-exclusive states: (a) by-line grouped stop list w/ `h2` "Stops on line X" + per-direction `h3` + `EntityList`; (b) by-line settled-empty note; (c) pre-search prompt "Start typing…"; (d) no-matches note; (e) text-match `EntityList` w/ "+N more" | `:259-300` | `visibleGroups` selector (`:214-218`) / `sortedMatches` (`:219`) / `matches` (`:169-179`) |
| 5 | Each result row: `EntityRow` (glyph + name + code subtitle + mode tag + route chips) + `ReliabilityBadge` (OTP% + status dot) + `MapDrilldownLink` "Map" | `stopRow` snippet (`:303-323`) | `stopModeHint` (`:304`); reliability from `createReliabilityLoader('stop')` viewport-probe (`:74-75, :305, :316`) |
| — | (App-level) Footer | `routes/+layout.svelte:503-509` | manifest attribution |

### Story-arc assessment — question answered at each scroll depth

- **Depth 0 (head):** "What is this page and can I trust the numbers?" — Answered well. The lede sets the honesty contract ("We never invent data").
- **Depth 1 (controls):** "How do I reach a stop?" — Answered: three combinable paths (type, pick a line, sort by reliability). This is the strongest part of the page.
- **Depth 2 (empty state before typing):** The reader lands on a near-empty page — head + controls + hazard tape + a single muted line "Start typing to filter stops." (`:285`, copy `:126`). **The story stalls hard here.** With no query and no line, the entire evidence region is one sentence. There is no featured content, no "worst stops in the network right now," no recently-viewed, no nearby stops, no examples. A portfolio reviewer landing cold sees an almost blank page.
- **Depth 3 (after a query / line):** "Which stop, and is it reliable?" — Answered per row: name + code + mode + routes + OTP badge + map link. Good density. But the OTP badge is **unexplained** on this surface (see §6) and the "Least reliable" sort silently depends on badges that stream in lazily (`:190-204`) — a reader who picks "Least reliable" before badges load sees no reordering and no feedback that sorting is pending.

### Where the story breaks / what's missing for context → evidence → verdict

- **No CONTEXT band.** There is no network-level framing ("STM has ~9,000 stops; median on-time X%"). The catalogue jumps straight to a search box. A case-study page would open with a one-line network stat so the reader knows the scale and baseline.
- **No VERDICT layer.** The page is pure retrieval. There is no synthesized read — e.g. "the 5 least-reliable stops this week" as a default featured list — so the reader must already know what to search for. The "Least reliable" sort exists but only re-orders an *existing* result set; it never surfaces the worst stops network-wide because nothing is shown until you type.
- **Absent-until-typed = zero first paint value.** The single biggest arc gap: the default state is empty. Compare the sibling network/lines surfaces which show data immediately.
- **Reliability badges are decorative-until-loaded.** Because they fail-soft to nothing (`ReliabilityBadge.svelte:62-63,69`), most rows for less-trafficked stops will show name only, so the "at-a-glance reliability read" promised in the file header (`StopsIndex.svelte:5`) is frequently invisible. Reader can't tell "no badge = still loading" from "no badge = no history."

Verdict: a competent, honest **search tool**; NOT a narrative case-study page. It reads as context → (nothing) → retrieval, missing the evidence-forward and verdict layers.

---

## 2. CHROME — headers, sticky elements, offsets, rails

- **App chrome** (outside the surface): `AppShell` TopBar + persistent `<main id="main">` scroll container (`routes/+layout.svelte:480-484`). The `#main` div is the scroll container (`overflow-y-auto`), `tabindex="-1"`, skip-link target. TopBar is the app nav; its positioning lives in AppShell (`z-index: 30/32`, `position: absolute` overlays — `AppShell.svelte:405-483`).
- **`--chrome-offset`: NOT used anywhere in the web app** (grep over `src/` returns zero hits). The sticky-offset convention in this codebase is `--rail-sticky-top` (default `5.5rem`), used by `ControlsRail --sticky` and `RailLayout`.
- **Sticky elements on THIS surface: NONE.** `StopsIndex` composes `<ControlsRail label={...} class="stops-controls-rail">` **without** the `sticky` prop (`StopsIndex.svelte:227`), so the control panel scrolls away with the page. `ControlsRail` only becomes `position: sticky; top: var(--rail-sticky-top, 5.5rem)` at `min-width:1024px` when `sticky` is passed (`ControlsRail.svelte:108-125`) — not the case here. So on a long result list the search box + line picker + sort scroll out of reach. This is a real ergonomics gap for a catalogue.
- **Rails: none.** The surface uses `Surface width="bleed"` (full content-column width), not a `RailLayout`. No left/right rail on this surface.
- **Hazard separator** (`:257`) is pure decorative chrome (`aria-hidden`), between controls and canvas.

---

## 3. CONTAINERS — max-widths, grid templates, padding rhythm

- **Surface shell** (`Surface.svelte`): `width="bleed"` ⇒ `--surface-maxw: none` (`Surface.svelte:22-28`), so the surface is NOT capped to a reading column — it spans the full rail-inset main width. `gutter=true` (default) ⇒ `padding-inline: var(--space-page-x)` = `clamp(1rem, 4vw, 5rem)` (`tokens.css:43`). `pad="surface"` default ⇒ `padding-block: clamp(1.5rem, 4vw, 2.5rem)`. Vertical rhythm between direct children: `gap: clamp(1.75rem, 4vw, 2.75rem)` (`Surface.svelte:48`).
- Container tokens (`tokens.css:88-89`): `--container-content: 64rem`, `--container-wide: 72rem`. **This surface opts OUT of both** (bleed = none). The result list therefore has no reading-measure cap — rows run edge-to-edge at any viewport width. On an ultra-wide monitor a single-column list of short rows stretches very wide.
- **Result grid:** `EntityList` is used in **default (single-column flex) mode** here (`grid` prop not passed → `EntityList.svelte:56-95,101-107`), a stacked `<ul>` with per-row bottom borders (`:108-113`). The catalogue does NOT use the 2-up `DashboardGrid` board that `EntityList` supports (`EntityList.svelte:67-85`) — a missed opportunity for wide screens.
- **Row grid** (`StopsIndex.svelte:383-389`): `.stop-result` is `display: grid; grid-template-columns: minmax(0,1fr) auto auto; gap: 0.5rem` = [row body | badge | map link]. At `max-width: 32rem` it collapses to `minmax(0,1fr) auto` with named areas `main/map` over `badge/map` (`:396-416`).
- **Controls layout** (`:334-364`): the `controls-rail-body` is forced `flex-direction: column` (`:337-341`); the line+sort pair is a wrapping flex row (`.stops-controls`, `:342-346`, `gap: 1.25rem`); the line control flexes `1 1 18rem` (`:353-356`).
- **Padding rhythm:** notes/prompts pad `0.5rem 0.875rem` (`:326-331, :371-382`); rows pad `0.75rem 0.875rem` via EntityRow (`EntityRow.svelte:110`). Reasonably consistent 0.875rem inline gutter across list children.

---

## 4. HEADINGS — hierarchy sanity

- **h1** — "Stops" via `SurfaceHeader` default `level=1` → `SectionHeading level=1` renders `<h1>` (`SurfaceHeader.svelte:39,47`; `SectionHeading.svelte:34,38`). One per page. Correct.
- **h2** — "Stops on line {short}" (`StopsIndex.svelte:271`), only in the by-line view.
- **h3** — "Direction {n}" group headings (`:275`), children of the h2. Correct nesting h2 → h3.
- **No h4+** on this surface.
- **Skipped-level check:** In the **by-line** view the order is h1 → h2 → h3 (clean). In the **text-search** view there is **no h2 at all** — results render directly under h1 with no section heading (`:288-299`). That is not a *skip* (going straight h1→content is valid), but the two result modes are asymmetric: line results get a labeled hierarchy, text results get none. Minor inconsistency, not an a11y violation.
- Mono labels ("CONTROLS", "Filter by line", "Sort", direction dir label) are `<span>`, not headings — correct (they are `aria-hidden` decorative captions or group labels, `:238,250`). The ControlsRail group is a labeled `role="group"`, not a landmark (`ControlsRail.svelte:58-64`) — deliberate.

Verdict: **hierarchy is sane; no skipped levels.** Only nit: text-search results lack a section heading that the by-line view has.

---

## 5. ABSENCE STATES — how missing data is shown

The index does NOT use the site-wide `AbsentValue` / `absentReason` primitives (grep: no `AbsentValue`, no `absentReason`, no `MaybeValue` in `features/stops/StopsIndex.svelte`). Instead absence is handled two ways:

1. **Result-region absence** via `ResourceBoundary` (`:259`) for the top-level stops-index resource: skeleton / error+retry / empty / no-results edge states (`ResourceBoundary.svelte:97-121`). Note: `isNoResults`/`isEmpty`/`emptyReason` props are **not passed** here, so a settled-but-empty *stops index file* would fall to the generic `empty` edge, but in practice the file is non-empty so the boundary almost always hits the `ok` branch and the *search-level* empties are handled by hand below.
2. **Search-level / line-level absence** via hand-written muted `<p class="stops-note">` (`:326-331`):
   - Pre-search: "Start typing to filter stops." (`:285`).
   - No text matches: "No stops match this search." (`:287`).
   - Line picked but no published stop list, gated on `lineRoute.settled`: "No published stop list for this line." (`:266-267`, copy `:161`) — honest and specific. Good.
   - Line + text narrowed to nothing: reuses `noMatches` (`:267`).
- **Reliability absence** (`ReliabilityBadge`): fail-soft — renders **nothing** when there's no verdict/OTP (`ReliabilityBadge.svelte:62-63,69`). Explicitly never a fabricated 0% (per its header comment `:11-13`). This is the honest-null doctrine, BUT: a missing badge is indistinguishable from a still-loading badge to the reader — no "—", no "no history yet" label, no skeleton. So absence here is *silent*, which is honest but not *communicative* (contrast the site's "say WHY data is missing" mandate — the index badge says nothing).
- **No bare-dash / null leaks found.** `stop.code ?? undefined` (`:311,320`), `hint.label ?? undefined` (`:312`), route chips only when `routes.length > 0` (`EntityRow.svelte:90`). Names fall back to id in the line-join (`:158-160`). No `null`/`undefined`/`NaN` reaches the DOM in the paths reviewed.

Verdict: honest absence, but **the reliability read is silently absent rather than explained**, and the index does not adopt the site-wide `absenceReason` primitive that detail surfaces use.

---

## 6. EXPLAINER LINKS — do metrics link to /metrics how-we-measure?

**No.** The StopsIndex surface shows a reliability metric (OTP% + verdict) on every row via `ReliabilityBadge`, but there is **no link to the `/metrics` how-we-measure entry** for it. Evidence:
- grep for `how-we-measure`, `/metrics#`, `metricsHref`, `MetricInfo`, `metricInfoFor` in `StopsIndex.svelte` / `ReliabilityBadge.svelte` → **zero hits**.
- The `MetricInfo` explainer component + `metricInfoFor(...)` are imported and used ONLY in the **stop detail** reliability sections (`reliability/sections/SectionHabits.svelte:18-20`, `SectionWeekday.svelte:14-16`, `StopReliabilitySurface.svelte:43-44`), NOT on the index.
- `ReliabilityBadge` has no `title`/tooltip beyond the composed a11y label "On time · X% on time" (`ReliabilityBadge.svelte:66,82`) — no "what is OTP / how we measure" affordance.

Gap: a reader on the index sees "84% · On time" with no path to the definition. The explainer infrastructure exists (`features/metrics/MetricInfo.svelte`, `metrics.content`) and is wired on the detail surface — the index just doesn't reach it.

---

## 7. MOBILE-390 READ (from code)

**Breakpoints referenced on this surface:**
- `@media (max-width: 32rem)` (= 512px) in `StopsIndex.svelte:396` — the row grid reflow (badge tucks under the row body). At 390px this IS active.
- `@media (min-width: 1024px)` in `ControlsRail.svelte:108` — desktop sticky; NOT active at 390px (and `sticky` isn't passed anyway).
- No 390-specific tuning; the surface relies on flex-wrap + the 32rem row reflow.

**Layout at 390px:**
- Surface is `bleed` with `padding-inline: clamp(1rem,4vw,5rem)` → at 390px, 4vw ≈ 15.6px, clamped floor 1rem=16px, so ~16px side gutters. OK.
- ControlsRail body is forced column (`:337-341`); SearchInput (`max-width: 28rem`, `SearchInput.svelte:64`) fills width; the line+sort row wraps (`.stops-controls` flex-wrap, `:342-346`) — the line control `flex: 1 1 18rem` (`:353`) will take a full row (~358px available > 18rem=288px is fine) and the sort segmented control wraps below. Reasonable.

**Elements at risk of overflow at 390px:**
- **Row body ellipsis is handled**: title/subtitle `text-overflow: ellipsis; white-space: nowrap` (`EntityRow.svelte:152-159,172-179`) with `min-width:0` on body (`:144`). Long stop names truncate rather than overflow. Good.
- **Route chips** (`entity-row-routes`) wrap (`EntityRow.svelte:180-185`) — a stop on many routes grows the row height but won't overflow horizontally.
- **Reliability badge** is `white-space: nowrap` (`ReliabilityBadge.svelte:100`); at the 32rem reflow it moves to its own grid row (`:409-411`), so it won't collide with the name. Good.
- **LineCombobox listbox** is portal-rendered, width = anchor width, max-height `min(20rem, available)` with scroll (`line-combobox.svelte:238-248`) — safe on mobile.
- **Widest risk:** none of the controls or rows overflow; the surface has no wide table/chart. The one aesthetic risk is the **bleed (uncapped) list** running full-width, but that's a wide-screen problem, not 390px.

**Touch-target sizes (from classes) — WCAG 2.5.8 (24px) / Apple 44px:**
- `GrainPicker` sort segments: explicit `min-height: 44px` (`GrainPicker.svelte:146-152`). PASS 44px.
- `SearchInput` control: padding `0.75rem`×2 (24px) + `--text-body` 1.0625rem line → ~41-44px. Borderline PASS.
- `EntityRow` anchor: padding `0.75rem`×2 + text-body → ~41-44px tall tap target. Borderline PASS.
- **`MapDrilldownLink`: `min-height: 2rem` = 32px** (`MapDrilldownLink.svelte:36`). **FAILS 44px** (passes the 24px AA minimum). This is the per-row "Map" pill every reader taps — under-sized for thumb use.
- **`LineCombobox` input: padding `0.5rem`×2 (16px) + `--text-small` 0.9375rem×1.4 ≈ 21px → ~37px tall** (`line-combobox.svelte:193`). **FAILS 44px.**
- **`LineCombobox` clear (✕) and trigger (⌄) buttons: `1.75rem` = 28px** (`line-combobox.svelte:208-209`). **FAILS 44px** (passes 24px AA). Two adjacent 28px targets 2rem apart at the input's trailing edge — fiddly on a phone.

**Chart sizing on small screens:** N/A — the index has no charts. (Charts live on the stop *detail* reliability surface.)

**Sticky behavior on mobile:** none. ControlsRail sticky is desktop-only AND not enabled here, so the search/line/sort controls scroll away on a long mobile result list — the reader must scroll back to the top to change the query. This is the main mobile ergonomics weakness.

**Mobile risk level: LOW-MEDIUM.** No overflow/clipping bugs; the issues are (1) three under-44px touch targets (Map pill, combobox input, combobox clear/trigger), and (2) non-sticky controls forcing scroll-to-top to re-search.

---

## 8. TOP 5 gaps vs an A++ portfolio case-study page

1. **Empty first paint — no default evidence.** Cold load = head + controls + one muted "Start typing" line. An A++ catalogue opens with default content: a network stat line ("~9,000 stops · median OTP X%") and a featured default list (e.g. "Least reliable stops this week" driven by the sort that already exists). Right now the "Least reliable" sort can only re-order what you've already searched; promote it to a *default view* so the page has evidence before input. (`StopsIndex.svelte:284-285`)
2. **Reliability metric is unexplained + silently absent.** The row OTP badge has no link to `/metrics` how-we-measure (the infra exists and is used on the detail surface) and, when history is missing, it renders nothing with no "no history yet" label — indistinguishable from still-loading. Add a MetricInfo/explainer affordance and a communicative absent state. (`ReliabilityBadge.svelte:62-69`; §6)
3. **Controls don't stick.** On a long result list the search/line/sort panel scrolls out of reach on every form factor. Pass `sticky` to the ControlsRail (desktop) and add a mobile equivalent (or a compact re-search affordance) so the reader can refine without scrolling to the top. (`StopsIndex.svelte:227`; `ControlsRail.svelte:108-125`)
4. **Touch targets under 44px.** The per-row "Map" pill (32px), the line combobox input (~37px), and its clear/trigger buttons (28px) all fall below the 44px comfortable tap size. Bump to 44px min-height. (`MapDrilldownLink.svelte:36`; `line-combobox.svelte:193,208-209`)
5. **No reading measure + no board layout.** `width="bleed"` uncaps the list, so a single-column stack runs edge-to-edge on wide screens while wasting the horizontal space (EntityList's 2-up `grid` mode is available but unused). Either cap to `--container-content` or adopt the 2-up board for the catalogue so wide screens read as a designed board, not a stretched list. (`Surface.svelte:22-28`; `EntityList.svelte:67-85`)

Bonus (arc): the text-search result mode has no section heading while the by-line mode does (h2/h3) — normalize so both modes present a labeled result region (`StopsIndex.svelte:288-299` vs `:270-282`).
