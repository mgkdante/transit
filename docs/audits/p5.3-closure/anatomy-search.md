# Surface Anatomy — `/search` (and `/fr/search`)

Analysis date: 2026-07-03 · Read-only. Scope: the full-surface Search page, its route shell, and every component it composes. The chrome top-bar quick search (`lib/search/chromeSearch.ts`, geocoding via `/api/geocode/montreal`) is a **distinct** surface living in the root layout — noted here only where the two are confused.

## Files read (with roles)

| File | Role |
|---|---|
| `apps/web/src/routes/[[lang=locale]]/search/+page.svelte` | Thin route shell (12 lines). Mounts `SearchSurface`. No `+page.ts`, no `+layout`. |
| `apps/web/src/lib/features/search/SearchSurface.svelte` | **The surface.** All layout, matching, controls, sections. 506 lines. |
| `apps/web/src/lib/features/search/VehicleResultRow.svelte` | Surface-specific bus result row (237 lines). |
| `apps/web/src/lib/features/search/search.copy.ts` | Co-located bilingual copy (137 lines). |
| `apps/web/src/lib/search/normalize.ts` | Shared matcher: `foldSearchText`, `tokenMatchScore`, `dedupeBy`. |
| `apps/web/src/lib/search/stopMode.ts` | Mode glyph/tag/dedupe helpers (route + stop). |
| `apps/web/src/lib/search/routeColor.ts` | GTFS hex swatch guard. |
| `apps/web/src/lib/components/layout/Surface.svelte` | Container shell (width/gutter/pad). |
| `apps/web/src/lib/components/surface/{SurfaceHeader,SearchInput,GrainPicker,EntityRow,EntityList,ReliabilityBadge}.svelte` | Shared surface spine primitives. |
| `apps/web/src/lib/components/edge/{EdgeState,AbsentValue,MaybeValue}.svelte` | Absence + edge primitives. |
| `apps/web/src/lib/components/brand/SectionHeading.svelte` | Display heading (h1 here). |
| `apps/web/src/routes/+layout.svelte` | Root chrome (AppShell + TopBar + chrome search + geocode). |
| `apps/web/src/lib/components/shell/{AppShell,TopBar}.svelte` | Chrome frame / sticky bar. |
| `apps/web/src/routes/api/geocode/montreal/+server.ts` | Geocode API — **not used by SearchSurface**, used by chrome + map. |
| `apps/web/src/lib/styles/tokens.css` | Container/space token values. |

Note: `mapNear.ts`, `mapFocus.ts`, `chromeSearch.ts` under `lib/search/` are **not** imported by SearchSurface (grep confirmed) — they belong to the chrome/map quick-search.

---

## (1) SECTION ORDER + STORY ARC

The surface is a `<Surface width="bleed">` flex-column (gap `clamp(1.75rem,4vw,2.75rem)`). Top-to-bottom:

| # | Section | Component | Data source / selector | Reader question |
|---|---|---|---|---|
| 0 | **Head** (kicker "SEARCH" · h1 "Find a line, stop or bus" · lede) | `SurfaceHeader` (`SectionLabel` + `SectionHeading` + lede `<p>`) | Static copy `t.kicker/heading/lede` (`search.copy.ts:74-76`) | "What can I do here?" |
| 1 | **Search input** | `SearchInput` (`SearchSurface.svelte:238-243`) | `bind:value={query}`; seeded once from URL `?q=` (`:106`) | "Where do I type?" |
| 2 | **Controls** (Scope segmented + Mode chips) — *only when `hasQuery`* (`:245-268`) | `GrainPicker` (scope) + hand-rolled `.search-mode-chip` buttons (mode) | `scopeSegments` (`:205-210`, per-family live counts); `modeChips` (`:228`) | "How do I narrow this?" |
| 3 | **Hazard separator** | `Separator variant="hazard"` (`:270`) | — | (visual divider) |
| 4a | **Idle state** — *when `!hasQuery`* (`:274-280`) | inline `.search-idle` card (glyph ⌕ + title + body) | `t.idleTitle/idleBody` | "What should I search for?" |
| 4b | **No-results** — *when `hasQuery && !hasResults`* (`:281-282`) | `EdgeState variant="no-results"` | — | "Nothing matched — now what?" |
| 4c | **Results** — *when `hasQuery && hasResults`* (`:283-376`) | 3 conditional `<section class="search-group">` | see below | "Where's my line/stop/bus?" |
| 5a | · Lines group (h2 "Lines" + count) | `EntityList` → `EntityRow` + `ReliabilityBadge` | `matchedRoutes` (`:173`, from `getRoutesIndex()` + `tokenMatchScore`) | |
| 5b | · Stops group (h2 "Stops" + count) | `EntityList` → `EntityRow` + `ReliabilityBadge` | `matchedStops` (`:181`, `getStopsIndex()`, deduped by `stopGroupKey`) | |
| 5c | · Live buses group (h2 "Live buses" + count) | `EntityList` → `VehicleResultRow` | `matchedVehicles` (`:191`, live store, **exact** unit-id match `:164-168`) | |

**Story-arc verdict: this is a competent *finder*, not a *story*.** It is a context→control→evidence utility that answers "find X and jump to its detail," and it does that well (rich rows, honest absence, live buses). But it deliberately has **no verdict/narrative layer** — the arc is flat by design. Specific arc observations:

- **Context is thin.** The lede ("Search the network by line number…") explains the *input grammar*, not the *state of the network*. There is no "N lines · M stops · K live buses indexed" orientation line, no "as of HH:MM" freshness, no sense of scale before you type. A portfolio page would open with a one-line network census + data-freshness so the reader has *ground truth* before acting.
- **The story stalls at idle.** Before typing, the reader gets only an instructional card (a restatement of the lede). There is no zero-query affordance to *start the journey*: no "popular lines," no "métro lines," no recent/nearby, no example chips. The empty state is honest but inert — a dead-end, not a launch pad.
- **Evidence is per-row, never aggregated.** Each result row carries a reliability badge (OTP% + verdict) — good micro-evidence. But there is no group-level or cross-result synthesis ("3 of your 5 matches are running late"), no ranking rationale shown to the reader (the tier score at `normalize.ts:71-89` is invisible), and no "best match" call-out. The reader must eyeball.
- **No verdict / no close.** The page never *concludes* anything. A finder legitimately hands off to detail pages — but an A++ case-study framing would still close each result with a "why this matters" or a single most-relevant next action. Here every row is an equal-weight link.
- **Missing narrative connective tissue:** freshness stamp (the surface polls live vehicles but never shows "buses as of HH:MM"), result provenance (which come from static index vs live feed is only implied by group), and any explainer of *what OTP% means* (see §6).

Net: **context → evidence → verdict** is present only as **input → links**. It reads as a solid product utility; it does not read as a narrative case study.

---

## (2) CHROME

The search surface has **no in-page chrome of its own** — all chrome is the shared app frame from the root layout.

- **TopBar** (`shell/TopBar.svelte:273`): `relative z-40 flex h-[60px] … border-b bg-card`. Fixed **60px** tall, `z-40`. It sits *above* the scroll container, not inside it — so it never scrolls away and is not `position:sticky`; it's a flex sibling of the scrolling `#main`.
- **Scroll container**: `#main` in `+layout.svelte:480-484` is `overflow-y-auto` for non-full-bleed surfaces (search is not full-bleed → it scrolls under the fixed 60px bar). Footer renders at natural bottom (`:503-509`).
- **`--chrome-offset`**: **does not exist** anywhere in the codebase (grep: 0 hits). Anchor-scroll offset instead uses `--nav-height` (default **64px**) in `app.css:527-536` (`scroll-margin-top: calc(var(--nav-height,64px)+1rem)` on `h1..h6[id]` and `[data-section-index]`).
  - **Latent mismatch:** the real bar is `60px` but the anchor offset assumes `64px`, and no `--nav-height` is ever *set* (only the `64px` fallback is used — grep found no `--nav-height:` definition). It is inert on `/search` because **the search surface has no `id`'d headings / no in-page anchors**, so no anchor-scroll ever fires here. Still, it's a repo-wide 4px drift worth noting.
- **No sticky elements in the surface.** The controls block (scope + mode) is **not sticky** — it scrolls away with the results. On a long results list a mobile reader loses the scope/mode controls entirely once scrolled. (Contrast: `lines/reliability/ReliabilityFilterPill.svelte:96` and health/metrics sections *do* use `top: calc(var(--nav-height,64px)+…)` sticky offsets — search does not.)
- **Rails**: none. The surface is a single centered column; it does **not** use `RailLayout` / `ControlsRail` / `ListDetailGrid`. The desktop 3-zone shell (LeftRail/MapStage/RightPanel) is bypassed — search renders in the shell's plain `main` snippet.

---

## (3) CONTAINERS

- **Root**: `<Surface width="bleed" class="surface">` (`SearchSurface.svelte:235`). `width="bleed"` → `--surface-maxw: none` (`Surface.svelte:26`), so **no max-width cap** — the column spans the full main width. (Content/wide surfaces cap at `--container-content: 64rem` / `--container-wide: 72rem` per `tokens.css:88-89`; search opts out.)
- **Gutter**: `gutter=true` (default) → `padding-inline: var(--space-page-x)` = `clamp(1rem, 4vw, 5rem)` (`tokens.css:43`).
- **Vertical pad**: `pad="surface"` → `padding-block: clamp(1.5rem, 4vw, 2.5rem)` (`Surface.svelte:53-55`).
- **Section rhythm**: Surface flex gap `clamp(1.75rem, 4vw, 2.75rem)` between head / input / controls / separator / results block. Inside results: `.search-results` gap `2rem` between groups (`:470-474`); `.search-group` gap `0.5rem` head-to-list (`:475-479`).
- **Grid templates**: **none in the surface.** `EntityList` default mode is a flex column (`:101-107`); it *supports* a `grid` prop (DashboardGrid auto-fit, `minTile` default 360px) but SearchSurface **does not pass `grid`**, so all three groups are single stacked columns even on a wide desktop — a lot of empty horizontal space at `width="bleed"`.
- **Rows**: `EntityRow` / `VehicleResultRow` padding `0.75rem 0.875rem`, `gap 0.875rem`, `radius-md`, separated by `1px var(--border-subtle)` rules (`EntityList.svelte:108-113`).
- **Control widths**: `SearchInput` field capped `max-width: 28rem` (`SearchInput.svelte:64`). `.search-controls` is `flex-wrap` with `gap: 1.25rem 2rem` (`:383-388`).
- **Padding rhythm** is consistent (0.4/0.5/0.75/0.875rem family) and token-driven; no hardcoded px except the `1px` borders and the 44px min tap target.

---

## (4) HEADINGS — hierarchy sanity

| Level | Text | Source | Note |
|---|---|---|---|
| **h1** | "Find a line, stop or bus" | `SurfaceHeader` `level=1` default → `SectionHeading` renders `h1` (`SectionHeading.svelte:34`) | One h1 — correct. |
| **h2** | "Lines" / "Stops" / "Live buses" | `<h2 class="search-group-head">` (`SearchSurface.svelte:287,321,356`) | Direct h2 under h1 — **no skipped level**. |

- **No h3/h4** exist on the surface. Hierarchy is a clean, shallow **h1 → h2** with no gaps. ✔
- **Caveat (visual, not semantic):** the h2 group heads are styled *small* (`.search-group-label` = `var(--text-subheading)`, `font-heading`), while the idle-card title (`.search-idle-title`) is *also* `--text-subheading` but is a `<p>`, not a heading — so a screen-reader user in the idle state has **no h2-level landmark**, and the visual weight of the idle title matches a real h2. Minor; the idle card is a `role="note"`.
- The h1 itself is visually huge (`clamp(2.5rem, 6vw, 4rem)`, weight 900, `SectionHeading.svelte:52-57`) — a strong display head, but the jump to the small h2s is a large visual gap with nothing in between (reinforces the "flat arc" — no mid-level framing).

---

## (5) ABSENCE STATES

Absence handling is a **strength** of this surface — thorough and honest, no bare-dash/null leaks found.

- **Whole-surface empty (no query)** → `.search-idle` instructional card (`:274-280`), `role="note"`. Honest, calm.
- **Whole-surface empty (query, zero matches)** → `EdgeState variant="no-results"` (`:281-282`) → "No results · Nothing matches this filter. Try widening your search." (`EdgeState.svelte:128-139`), `role="status"` live region, doctrine `--dataviz-status-unknown` accent.
- **Per-group empty** → the group `<section>` simply doesn't render (`showRoutes/showStops/showVehicles` gates, `:196-200`). Clean — no empty group headers.
- **Reliability badge absence** → `ReliabilityBadge` renders **nothing** until phase `ready` with non-null OTP (`ReliabilityBadge.svelte:63,69`). Fail-soft by construction: a still-loading, 404'd, or null-OTP row shows **no badge** — never a spinner, never a fabricated 0%. (Comment `:11-13`.) This is honest but *silent* — the reader can't tell "loading" from "no history exists."
- **Vehicle row per-field absence** (`VehicleResultRow.svelte`), all via `MaybeValue` → `AbsentValue` "unknown · why" chip with `reason='not-reported'`:
  - **next-stop** unresolved/omitted → styled chip, never the raw GTFS id (`:66,108-110`).
  - **occupancy** null → chip, never a fabricated band (`:114-119`).
  - **delay** null → chip, never a fabricated 0 (`:50,124`). A real measured 0 → "On time" (present).
  - **bearing** null → no arrow (falls back to `▣` glyph, `:86-97`), no fabricated heading.
- **`MaybeValue` zero-safety**: a measured `"0"`/`"0%"`/`"0 min"` is PRESENT (`MaybeValue.svelte:66`) — only null/undefined/"" becomes the chip. No zero-as-absent bug.
- **Route swatch absence** → `routeColor()` returns null for missing/malformed hex → no swatch rendered (`EntityRow.svelte:72`, `routeColor.ts:20-33`). No fabricated default hue.
- **Bare-dash / null leak audit**: grep + read — **none found**. No `—`, `–`, `N/A`, `null`, or `undefined` reaches the DOM on any branch. All absence routes through `AbsentValue`/`EdgeState`/omission.

One honesty gap: the **reliability badge's silent-nothing** state (§5) is *less* honest than the rest of the surface's "unknown · why" pattern — a row with no OTP history looks identical to a row still fetching. An `AbsentValue`-style "no history yet" would match the surface's own doctrine.

---

## (6) EXPLAINER LINKS

**None. This is a real gap.** Grep for `metrics` / `how-we-measure` / `/metrics` / explainer in `lib/features/search/` → **0 hits**.

- Result rows surface an **OTP% + verdict** (`ReliabilityBadge`, "82% on time · Late") with **no link** to the `/metrics` "how we measure" entry that defines on-time-performance, the sample window, or the late/severe thresholds. A first-time reader sees "Late 82%" with no way to learn what "on time" means or over what period.
- The vehicle row surfaces **crowding** (occupancy band) and **signed delay** — again with no explainer link to their definitions.
- The codebase *has* the explainer infrastructure: `MetricsExplainer.svelte` (with `id`'d, anchor-scrollable entries, `app.css` scroll-margin) and `ExplainedMetricCard`/`ExplainedMetricCard` in dataviz. The search surface composes **none** of it. A portfolio page would deep-link each metric badge (or an `(i)`) to `/metrics#otp` etc.

Verdict: **metrics do NOT link to their how-we-measure entries.** Zero explainer affordances on the surface.

---

## (7) MOBILE-390 READ FROM CODE

- **Breakpoints used by the surface itself: ZERO width-based media queries.** The only two `@media` in `SearchSurface.svelte` (`:500`) and `VehicleResultRow.svelte` (`:230`) are `prefers-reduced-motion`. Responsiveness is entirely `flex-wrap` + `clamp()`. The desktop/mobile split (`layout.isDesktop`, `matchMedia('(min-width: 1024px)')`, `nav/layout.svelte.ts:27`) is used **only** to pick the `EdgeState` skeleton density (`edgeLayout`, `:80`) — layout itself is fluid.
- **Fluid scaling at 390px**: gutter `--space-page-x` → `clamp(1rem,4vw,5rem)` = ~1rem side padding at 390px (≈15.6px). Head h1 `clamp(2.5rem,6vw,4rem)` = ~2.5rem (~40px) — large but fits. Vertical pad `clamp(1.5rem,4vw,2.5rem)` = ~1.5rem. All comfortable.
- **Overflow risks at 390px:**
  - **`EntityRow` title / route chips**: title uses `text-overflow: ellipsis; white-space: nowrap` (`EntityRow.svelte:152-159`) — truncates safely. `.entity-row-routes` is `flex-wrap` (`:180`) — safe. Route chips *can* stack into several lines for a busy stop, growing row height (acceptable).
  - **`VehicleResultRow` marks row** (`.vehicle-row-marks`) is `flex-wrap` with StatusBadge + crowding chip + (in meta cell) the delay — wraps, safe. The crowding label + status pill + arrow lead + id together are tight at 390px but wrap.
  - **`AbsentValue` inline chip** is explicitly `flex-wrap` + `overflow-wrap: anywhere` (`AbsentValue.svelte:97-115`) — designed to wrap in narrow cells. Safe.
  - **Scope `GrainPicker`** (`.grain-picker`) is `inline-flex; flex-wrap: wrap` (`:129-137`) — the 4 scope segments ("All", "Lines (12)", "Stops (34)", "Vehicles (1)") wrap to 2 lines at 390px. The count strings can make a segment fairly wide; likely 2 rows. Functional but can look ragged.
  - **Mode chips** (`.search-mode-chips`) `flex-wrap` (`:404-408`) — 5 chips (Métro/Tram/Bus/Train/Ferry) wrap to ~2 lines at 390px. Safe.
  - The **`.search-controls`** wrapper stacks scope-block and mode-block via `flex-wrap` with `gap 1.25rem 2rem` — at 390px they stack vertically. Safe.
- **Touch-target sizes (from classes):**
  - **`GrainPicker` segments**: explicitly `min-height: 44px` (`GrainPicker.svelte:146-151`) — **WCAG 2.5.8 compliant** (comment even cites the standard). ✔
  - **Mode chips** (`.search-mode-chip`): `padding: 0.4rem 0.75rem`, `font-size: var(--text-small)` (0.9375rem), `line-height: 1.2`. Computed height ≈ `0.4*2rem + 0.9375*1.2rem` ≈ **~28–31px** — **BELOW the 44px touch target**. ✗ These are the *only* interactive controls on the surface that miss 44px, and they are the primary mobile facet filter. (The surface even has the 44px fix applied to GrainPicker but not to its own hand-rolled mode chips.)
  - **`SearchInput`**: `padding: 0.75rem 0.875rem` + `text-body` (1.0625rem) ≈ **~44px** tall. ✔
  - **Result rows** (`EntityRow`/`VehicleResultRow`): `padding: 0.75rem 0.875rem` with multi-line body → comfortably ≥44px. ✔
- **Chart sizing on small screens**: N/A — the surface renders **no charts** (only badges/chips/rows). No SVG/ChartSpec on this surface.
- **Sticky behavior on mobile**: **none.** Controls scroll away (see §2). On a long results list a phone user must scroll back to the top to change scope/mode. The TopBar (60px) stays fixed above the scroll region, so results scroll under it.
- **Mobile risk level: LOW–MEDIUM.** No horizontal-overflow risk (everything wraps/ellipsizes). The two real issues are (a) **mode chips under 44px tap target** and (b) **non-sticky controls** forcing scroll-to-top to refilter. Neither breaks layout; both degrade mobile UX.

---

## (8) TOP 5 GAPS vs an A++ portfolio case-study page

1. **No orientation / no story spine.** The page opens with input grammar, not network context. Add a census + freshness header ("~220 lines · ~9,000 stops · N live buses · as of HH:MM") and a zero-query launch state (popular/métro lines, example chips, recent searches) so the reader has ground truth and a starting move. Today the idle state is an inert restatement of the lede — the arc dead-ends before it begins.
2. **Metrics have no explainer links (§6).** OTP%, crowding, and signed-delay all render as bare verdicts with zero path to the existing `/metrics` how-we-measure entries. Deep-link each badge/`(i)` to `/metrics#otp` etc. A case-study page never shows a number the reader can't interrogate.
3. **Evidence is never synthesized.** Results are equal-weight links; the tier-ranked match score (`normalize.ts`) and per-row reliability are invisible as a *narrative*. Add a "best match" call-out, a group-level reliability roll-up ("2 of 3 matching lines running late"), and show *why* the top result ranks first. Turn "a list of links" into "here's what your search reveals."
4. **Wide desktop is wasted; controls aren't sticky.** At `width="bleed"` with single-column `EntityList`, a desktop shows one narrow column in a huge frame — pass `grid` to `EntityList` for a 2-up board (already supported, `minTile`), and make the scope/mode controls sticky (`top: calc(var(--nav-height)+…)`, a pattern the lines/health surfaces already use) so refiltering doesn't require scroll-to-top. Also cap the bleed to `--container-wide` for a reading measure.
5. **Two honesty/a11y polish gaps that an A++ bar would close:** (a) the reliability badge's *silent-nothing* absence (§5) is inconsistent with the surface's own "unknown · why" doctrine — a row with no OTP history looks identical to one still loading; give it an honest "no history yet" chip. (b) The **mode chips miss the 44px touch target** (§7) that the sibling GrainPicker explicitly enforces — a portfolio page ships uniform tap targets. Bonus: no freshness stamp despite live polling, and the repo-wide `--nav-height` 64px-vs-60px drift (§2).

---

## Doctrine compliance (positive notes)

- **Four-color / `--primary` interactive-only**: honored. Data marks (status, crowding, severity) ride the dataviz scale; `--primary` only on the active scope/mode chip, focus rings, the heading dot, and the vehicle-identity arrow (an interactive entity affordance, documented `VehicleResultRow.svelte:153-160`).
- **Tokens, no hex**: honored. The one dynamic color is the guarded GTFS route swatch (`routeColor.ts`), the documented exception.
- **Bilingual**: complete — all strings in `search.copy.ts` + intrinsic component copy; FR canonical.
- **Honest absence**: best-in-class per-field (§5), the surface's standout quality.
- **Svelte 5 runes / keyed `{#each}` / fail-soft**: all present.
