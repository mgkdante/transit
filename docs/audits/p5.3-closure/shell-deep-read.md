# SHELL DEEP-READ — transit web chrome (apps/web)

Scope: `apps/web/src/lib/components/shell/*` + `apps/web/src/lib/components/layout/*`, their
consumers, CSS custom properties, the full-bleed mechanism, and the blast radius of replacing the
top chrome with a yesid.dev-style floating pill nav. **READ-ONLY analysis — nothing modified.**

Headline correction up front: **`--chrome-offset` does not exist anywhere in the codebase.** The
task names it, but a global grep (`grep -rn "chrome-offset" src/`) returns **zero** hits. The real
chrome-offset machinery is two independent systems:

1. **Horizontal rail offset** — `--app-left-rail-offset` / `--app-rail-width-expanded` /
   `--app-rail-width-collapsed` (LeftRail width; the map chrome and non-map `<main>` padding follow
   it). Mirror on the right for the map detail dock: `--app-right-detail-offset` / `--map-detail-offset`.
2. **Vertical chrome-height offset** — a **magic-number literal** `5.5rem` (RailLayout /
   ControlsRail sticky top; `--rail-sticky-top` overridable) AND a separate `--nav-height` **fallback**
   of `64px` (`app.css` global heading `scroll-margin-top`, ReliabilityFilterPill fixed-top). Neither
   is ever *set*; both are hard-coded assumptions of the TopBar's height (actually `60px`).

This split — no single variable ties the chrome height to the offsets that depend on it — is the
central risk for a pill-nav swap. Details below.

---

## 0. Inventory (verified files)

### shell/ (`apps/web/src/lib/components/shell/`)
| File | Role |
|---|---|
| `AppShell.svelte` (18446 B) | Top-level shell wrapper: composes TopBar + `<main>` map-stage + LeftRail overlay + RightPanel/BottomSheet. Owns the rail drag/collapse + offset vars. |
| `TopBar.svelte` (29868 B) | The fixed 60px top chrome strip (brand · city · search · clock/refresh/alerts/theme/lang · mobile burger + mobile menu + mobile search). |
| `LeftRail.svelte` | Desktop left nav overlay (collapsible, container-query reflow, Audit sub-group). |
| `RightPanel.svelte` | Desktop detail dock ("volet", 360px, collapsible to 3.7rem). |
| `BottomSheet.svelte` | Mobile detail surface (bits-ui sheet, `side="bottom"`). |
| `SurfaceNavList.svelte` | Shared SURFACE_NAV link list (used by TopBar mobile menu). |
| `BrandWordmark.svelte` | `yesid.` house wordmark + lazy GSAP hover flourish. |
| `LangSwitch.svelte` | EN⇄FR fingerpost SVG signpost. |
| `LiveClock.svelte` | Live wall-clock `<time>` (America/Toronto, sharedClock). |
| `RefreshButton.svelte` | Manual "refresh data" + freshness readout, drives `dataRefresh`. |
| `ThemeToggle.svelte` | Signal-lamp dark/light `role="switch"`, drives `themeStore`. |
| `index.ts` | Barrel export. |
| `leftRailWidth.ts` | Thin wrapper over `overlayWidth` factory: LEFT rail persisted width. |
| `overlayWidth.ts` | Shared draggable-overlay width factory (clamp + SSR-safe localStorage). |
| `navIcons.ts` | Lucide icon map for SURFACE_NAV + AUDIT_NAV keys. |
| Tests | `TopBar.svelte.test.ts`, `LeftRail.svelte.test.ts`, `RightPanel.svelte.test.ts`, `BottomSheet.svelte.test.ts`, `leftRailWidth.test.ts`, `overlayWidth.test.ts`. |

### layout/ (`apps/web/src/lib/components/layout/`)
| File | Role |
|---|---|
| `Surface.svelte` | Content-column wrapper: max-width band + gutter + block padding; owns the `.surface-bleed` full-bleed escape. |
| `RailLayout.svelte` | Sticky-rail body grid (`minmax(13rem,17rem) | 1fr` at lg; rail sticky `top:5.5rem`). |
| `ControlsRail.svelte` | Bordered mono-labelled control panel; opt-in desktop-sticky `top:var(--rail-sticky-top,5.5rem)`. |
| `DashboardGrid.svelte` | Auto-fit KPI tile field (`repeat(auto-fit,minmax(...))`). |
| `EdgeStateGrid.svelte` | Fixed three-up triptych; stacks on mobile. |
| `ListDetailGrid.svelte` | Master/detail two-pane; stacks on mobile. |
| `MissionControlGrid.svelte` | 60/300/1fr/360 four-track ops console; detail → bottom-sheet below lg. |
| `Footer.svelte` | Site footer (brand cluster + IA nav + attribution + status line). |
| `index.ts` | Barrel export. |
| Tests | `RailLayout.svelte.test.ts`, `ControlsRail.svelte.test.ts`, `DashboardGrid.svelte.test.ts`. |

Shared brand primitive: `apps/web/src/lib/components/brand/BrandCluster.svelte` (the `yesid.` mark ·
divider · `transit` product mark cluster; used by TopBar via `variant="topbar"` and Footer via
`variant="footer"`). The `≤760px` brand collapse lives HERE now, not in TopBar.

---

## 1. TopBar.svelte — annotated structure, props, consumers

### Markup structure (`TopBar.svelte`)
```
<svelte:window onkeydown onpointerdown/>            (L268) — Escape handling + click-outside close
<header bind:this={headerEl}                        (L270)
        class="relative z-40 flex h-[60px] w-full shrink-0 items-center gap-3 border-b border-border bg-card px-3 sm:gap-4 sm:px-4"
        data-slot="topbar">
  <BrandCluster variant="topbar" productHref="/" .../>   (L279)  — brand cluster
  <button data-slot="topbar-city" ...>                   (L285)  — inert city picker (hidden <lg; aria-disabled)
  <form role="search" data-slot="topbar-search">          (L306)  — desktop search (hidden <md; flex-1)
      <input type="search" bind:value={search}/>          (L318)
      {#if showSearchResults} .topbar-search-results ...   (L329)  — absolute dropdown, top:calc(100%+0.4rem)
  <div class="ml-auto ..." data-slot="topbar-controls">   (L360)  — RIGHT cluster
      <LiveClock hidden sm:inline/>                        (L361)
      <button ...topbar-mobile-search-toggle md:hidden/>   (L363)
      <RefreshButton/>                                     (L376)
      <button data-slot="topbar-alerts"> + badge           (L379)  — bell + count pill (bg-primary)
      <ThemeToggle/> <LangSwitch/>                          (L410-411)
      <button ...topbar-menu-toggle md:hidden/>            (L413)  — hamburger, bind:this=mobileMenuToggle
  {#if mobileSearchOpen} backdrop + .topbar-mobile-search  (L427)  — absolute, top:calc(100%+0.5rem)
  {#if mobileMenuOpen}  backdrop + <nav .topbar-mobile-menu (L509) — absolute, top:calc(100%+0.5rem), right:0.75rem
      <SurfaceNavList linkClass="topbar-mobile-menu-link"/> (L523)
      Audit group (AUDIT_NAV)                               (L528)
      yesid. house link (→ yesid.dev, _blank)               (L551)
</header>
```
The mobile menu/search/backdrops are children of `<header>` and positioned `absolute` **relative to
the header** (`top: calc(100% + ...)`). They inherit the header's stacking context. The hamburger
morphs (two `.topbar-menu-line` spans rotate into an X on `[aria-expanded='true']`).

### Props table (`TopBarProps`, L43–70)
| Prop | Type | Default | Passed by |
|---|---|---|---|
| `locale` | `Locale?` | `getLocale() ?? DEFAULT_LOCALE` | AppShell (`{locale}`) |
| `url` | `URL?` | `new URL('https://transit.local/')` | AppShell → `$page.url` |
| `providerName` | `string?` | — | AppShell → `v1.manifest.display_name` |
| `providerShortName` | `string?` | — | AppShell → `v1.manifest.short_name` |
| `alertCount` | `number` | `0` | AppShell (currently always default; no wiring) |
| `search` | `string` (`$bindable`) | `''` | AppShell `bind:search` → layout `topSearch` |
| `onsearch` | `(v:string)=>void?` | — | AppShell → layout `submitSearch` |
| `searchResults` | `readonly ChromeSearchResult[]` | `[]` | AppShell → layout `topSearchResults` |
| `searchScope` | `ChromeSearchScope` | `'all'` | AppShell → layout `searchScope` |
| `onresultselect` | `(r)=>void?` | — | AppShell → layout `selectSearchResult` |
| `onalerts` | `()=>void?` | — | AppShell (not wired by layout today) |
| `availableLocales` | `readonly Locale[]` | `PUBLISHED_LOCALES` | AppShell (default) |
| `class` | `string?` | — | — |

**Only consumer of `<TopBar>`: `AppShell.svelte` (L253).** The other grep hits (`clock.svelte.ts`,
`nav.ts`, `store.svelte.ts`, sibling shell files, `Footer.svelte`) are the string "topbar" in
comments/`data-slot` names, not renders.

### Local state (L170–186)
`mobileSearchOpen`, `mobileMenuOpen`, `mobileSearchInput` (bind), `mobileMenuToggle` (bind, for focus
return), `searchResultsOpen`, `headerEl` (bind, for click-outside). `badgeText` caps at `99+`.

### CSS custom properties (TopBar)
- **Consumed:** `--border`, `--card`, `--primary`, `--primary-foreground`, `--muted`,
  `--secondary-foreground`, `--foreground`, `--border-subtle`, `--ring`, `--popover`,
  `--muted-foreground`, `--radius-sm/md/pill`, `--shadow-sheet/card`, `--font-mono/heading`,
  `--text-caption/micro`, `--duration-fast/normal`, `--ease-default`. Z-index literals: header
  `z-40` (Tailwind = z-index:40); mobile backdrops `z-index:45`; mobile search `55`; mobile menu
  `55`; menu toggle `65`; search results `50`. **These are raw literals, NOT the `--z-*` tokens.**
- **Set:** none via `style=`.

### Height contract
`h-[60px]` (L273) is the ONLY place the TopBar height is declared. Nothing reads it back — the
dependent offsets (`5.5rem`, `64px`) are hard-coded guesses, not derived from this.

---

## 2. AppShell.svelte — the composition + offset engine

### Markup (`AppShell.svelte` L248–376)
```
<div class="flex h-dvh w-full flex-col overflow-hidden ..." data-slot="app-shell">   (L248)
  <TopBar .../>                                                                        (L253)
  <div bind:this={rowEl} class="app-shell-row min-h-0 flex-1 overflow-hidden"          (L271)
       data-rail-collapsed=... data-rail-dragging=...>
    <main class="app-shell-main relative min-w-0 flex-1 overflow-hidden bg-surface-0"  (L278)
          aria-label={mainAriaLabel} data-slot="map-stage">
        {@render main()}                                                               (L283)
    <div class="app-shell-rail-overlay" data-slot="app-shell-rail-overlay">            (L291)
        <LeftRail collapsed=... ontogglecollapse=...> {@render rail()} </LeftRail>      (L293)
        {#if !leftRailCollapsed} <div class="app-shell-rail-handle" role="separator" .../>  (L324) — drag/keyboard resize
    {#if layout.isDesktop}                                                             (L350) — JS branch, detail ONLY
        {#if detailOpen} <div class="app-shell-detail-overlay"> <RightPanel .../> </div>    (L351)
    {:else}
        <BottomSheet bind:open={detailOpen} .../>                                      (L365)
```

### The offset CSS (L378–492) — THE CORE MECHANISM
- `.app-shell-row` declares `--app-rail-width-expanded: 16rem`, `--app-rail-width-collapsed: 4.85rem`,
  `--app-left-rail-offset: 0px` (mobile default).
- `.app-shell-main { position:absolute; inset:0 }`.
- **Full-bleed conditional (L397):** `.app-shell-main:not(:has(.map-hero)) { padding-left: var(--app-left-rail-offset,0px) }`
  — non-map surfaces pad clear of the rail; the map (`.map-hero` present) does NOT, it offsets its
  own floating chrome instead → **full bleed under the rail**.
- `.app-shell-rail-overlay { position:absolute; inset-block:0; left:0; z-index:30; display:none;
  width:var(--app-rail-width-expanded) }` — hidden by default; revealed at `≥1024px`.
- `@media (min-width:1024px)`: `.app-shell-row { --app-left-rail-offset: var(--app-rail-width-expanded) }`;
  `[data-rail-collapsed='true'] { --app-left-rail-offset: var(--app-rail-width-collapsed) }`;
  `.app-shell-rail-overlay { display:block; width:var(--app-left-rail-offset) }`.
- `.app-shell-detail-overlay { position:absolute; inset-block:0; right:0; z-index:32 }`.

### Rail drag/resize (JS, L164–245)
`rowEl` (bind), `railWidthPx` (seeded from `readStoredLeftRailWidth()`), pointer capture on the
handle writes `clampLeftRailWidth(...)` into `railWidthPx`; `$effect` (L190) pushes it into
`rowEl.style.setProperty('--app-rail-width-expanded', ...)`. Keyboard nudge (arrows/Home/End). Persist
on release via `writeStoredLeftRailWidth`. **The map canvas never reads the rail width** — it sizes off
its own container, so resizing the rail can't resize the map (verified in comments L196–198).

### Props table (`AppShellProps`, L61–112)
Threads TopBar props through (locale/url/provider*/alertCount/search/onsearch/searchResults/
onresultselect/searchScope/onalerts) PLUS: `detailOpen` (`$bindable false`), `detailTitle`,
`surfaceKey` (`'empty'`), `ondetailclose`, `railHeading`, `mainLabel` (`BilingualLabel`), and named
snippets `rail`, `main`, `detail`, `detailFooter`. **Only consumer: `+layout.svelte` (L462).**

### `layout.isDesktop` usage
The ONLY JS-breakpoint branch is the **detail surface** presentation (desktop overlay vs mobile
BottomSheet, L350). Persistent chrome (TopBar/LeftRail) is CSS-media-only, correct on first SSR paint.
`layout` comes from `$lib/nav`.

---

## 3. Surface.svelte + the full-bleed mechanism

### Props (`SurfaceProps`, L5–12)
| Prop | Type | Default | Notes |
|---|---|---|---|
| `children` | `Snippet?` | — | |
| `width` | `'content'|'wide'|'bleed'` | `'content'` | → `--surface-maxw`: content=`--container-content`, wide=`--container-wide`, bleed=`none` |
| `gutter` | `boolean` | `true` | adds `.surface-shell--gutter` → `padding-inline: var(--space-page-x)` |
| `pad` | `'surface'|'hub'|'none'` | `'surface'` | block padding |
| `as` | `'section'|'div'|'article'` | `'section'` | polymorphic element |
| `class` | `string?` | — | |

### Markup / CSS
`<svelte:element this={as} class="surface-shell surface-shell--{pad} [surface-shell--gutter]"
style="--surface-maxw:{maxw}">`. `.surface-shell { width:100%; max-width:var(--surface-maxw);
margin-inline:auto; display:flex; flex-direction:column; gap:clamp(1.75rem,4vw,2.75rem) }`.

### THE FULL-BLEED MECHANISM (two layers — do not confuse)
1. **Shell-level full bleed (map):** AppShell `.app-shell-main:not(:has(.map-hero))` padding-left
   trick (§2). The map gets NO left padding, so its canvas + floating chrome fill the whole area
   *under* the rail overlay. The rail floats over it via `pointer-events` confinement. This is the
   "never resizes, never behind the rail" contract from the memory notes.
2. **Content-level full bleed (`.surface-bleed`, Surface.svelte L69–79):** a **global** helper class
   (`:global(.surface-bleed) { margin-inline: calc(-1 * var(--space-page-x)) }`) that lets a child
   *escape the Surface gutter* out to the content-column edges by negative-margining the live gutter.
   It does NOT escape the rail offset. Companion `:global(.surface-measure)` re-applies the gutter +
   re-caps the text column for dense bodies inside a bled band. Reacts live to rail drag because
   `<main>`'s padding moves the box (no JS, no `100vw`).

### Consumers of `<Surface>` (imports, ~28 files)
`+layout.svelte`, home `+page.svelte`, `EntityDetail.svelte`, `EntityList.svelte`, `GrainPicker`,
plus feature surfaces: `AlertHistory`, `HotspotsBoard`, `MapDetailOverlayHarness`, `LinesIndex`,
`RouteReliabilityClusters`, `TripDetail`, `StopsIndex`, `AccountabilityReceipt`, `SearchSurface`,
`NetworkSurface`, `HealthStatus`, `RepeatOffenders`, `_kit/+page.svelte`; referenced in
`chart/share.ts`, `map.copy.ts`, `skeleton.svelte`, `tooltip-content.svelte`, `Chart.svelte`,
barrels `surface/index.ts`, `layout/index.ts`, and AppShell (comment). (Some are substring matches
like `data-slot="surface"`; the real component imports are via `$lib/components/surface` or
`$lib/components/layout`.)

---

## 4. RailLayout + ControlsRail — the VERTICAL chrome-offset assumption

### RailLayout.svelte
- Props: `rail?`, `content?` (Snippets), `railLabel?`, `class?`, rest.
- Grid: mobile 1-col (`rail` then `content`); `@media (min-width:1024px)` →
  `grid-template-columns: minmax(13rem,17rem) minmax(0,1fr); gap:2rem; align-items:start`.
- **`.rail-layout__rail-sticky { position:sticky; top:5.5rem }` (L85–88)** — the `5.5rem` is the
  hard-coded assumption "chrome height above the rail." Comment (L84): "matches the surface header /
  app-shell top bar."
- Consumers: **only `layout/index.ts` barrel + ControlsRail doc comment.** No feature imports it
  directly today (it was extracted from MetricsExplainer but MetricsExplainer still uses its own
  inline `position:sticky; top:5rem` grid — see §7).

### ControlsRail.svelte
- Props: `label?` (bilingual mono overline + group name), `children?`, `sticky` (`false`), `class?`, rest.
- Root: `<div role={label?'group':undefined} aria-label={label} class="controls-rail [controls-rail--sticky]">`.
- **`@media (min-width:1024px) .controls-rail--sticky { top: var(--rail-sticky-top, 5.5rem);
  z-index: var(--z-rail) }` (L115–124)** — this is the ONE place the vertical offset is
  **caller-tunable** (`--rail-sticky-top`). Default `5.5rem`.
- Consumers (real renders): `RouteReliabilityClusters.svelte`, `ReliabilityFilterPill.svelte`,
  `LinesIndex.svelte`, `StopsIndex.svelte`, `StopDetail.svelte`, `AccountabilityReceipt.svelte`,
  `StopReliabilitySurface.svelte`, `NetworkSurface.svelte`, `AlertFilters.svelte`,
  `SurfaceControls.svelte` + their `.copy.ts`/tests + `layout/index.ts`.
- **The one override in the wild:** `RouteReliabilityClusters.svelte:656` sets
  `--rail-sticky-top: 0px` because that surface scrolls in a nested container already below the app
  nav (comment L652–655). This proves the `5.5rem` default is a window-scroll assumption that is
  *already wrong* for at least one surface — a canary for the pill-nav change.

---

## 5. The other layout primitives (consumers + coupling)

- **DashboardGrid** — props `children`, `as('div'|'ul'|'ol'|'section')`, `minTile('240px')`,
  `maxWidth('none')`, `align('stretch')`, `gutter(true)`, `label?`. Sets
  `--min-tile/--board-max/--board-align`; opt-in `role="region"` (suppressed on list elements).
  Consumers: home page, `LinesIndex`, `RouteReliabilityClusters`, `AlertBreakdown`,
  `StopReliabilitySurface`, `NetworkSurface` (+ its sections `SectionStatusMix`, `SectionLiveHeadline`,
  `SectionReporting`), `RepeatOffenders`, `EntityList`, `EdgeStateGrid` (nests it), barrel. **No chrome-height coupling.**
- **EdgeStateGrid** — props `a/b/c` snippets, `align/justify/gutter/label`. 3-up at lg, stacked below.
  Consumer: only barrel (used indirectly). **No chrome coupling.**
- **ListDetailGrid** — props `list/detail` snippets, `listWidth('320px')`, `side('list'|'detail')`,
  `detailActive`, `label`. Two-pane at lg with independent scroll; the list column `overflow-y:auto;
  height:100%`. Consumer: `RouteDetail.svelte` (+barrel). **Height coupling:** relies on its parent
  giving it `height:100%` (works inside the scrolling `#main`); a pill nav that changes `#main`
  height math would ripple here.
- **MissionControlGrid** — props `rail/list/main/detail` snippets, `detailOpen($bindable)`, `label`.
  60/300/1fr/360 console at lg; detail → sticky bottom-sheet below lg (`z-index:var(--z-sheet)`).
  Consumers: barrel + `components/index.ts` only (not actively rendered by a route today). **No
  top-chrome coupling** but it declares its own `<main>` landmark — a second `<main>` if ever used
  under AppShell's `<main>`.
- **Footer** — props `locale?`, `attribution?`, `providerName?`. Renders **only in
  `+layout.svelte`** (non-full-bleed surfaces, inside the `#main` scroll wrapper, L503). Uses
  `env(safe-area-inset-bottom)` (L174). `z-50`. Not top-chrome; unaffected by a pill swap except that
  it currently lives in the same scroll container whose top offset changes.

---

## 6. `--chrome-offset` — the requested variable: FULL FINDING

**`--chrome-offset` is not defined, set, or read anywhere in `apps/web/src`.** (Confirmed:
`grep -rn "chrome-offset" src/` → 0 results.) There is no single "chrome offset" custom property.
Any code or documentation that refers to `--chrome-offset` is referring to a *concept* implemented by
the following disjoint set. **The real blast radius of "the chrome offset" is these:**

### 6a. Horizontal (rail) offset chain — `--app-left-rail-offset`
| Location | Role |
|---|---|
| `AppShell.svelte` L385–475 | **Sole owner/setter.** Declares `--app-rail-width-expanded/collapsed/left-rail-offset`; media query maps offset→width; drag `$effect` writes `--app-rail-width-expanded`. |
| `AppShell.svelte` L398 | reader: non-map `<main>` `padding-left`. |
| `MapOverlayChrome.svelte` L189, L216 | reader: left-anchored floating map chrome. |
| `MapHeadTitle.svelte` L44, L53 | reader: map title left inset + max-width. |
| `MapFeedStallBanner.svelte` L92 | reader: centering calc. |
| `leftRailWidth.ts` / `overlayWidth.ts` | the persisted-px machinery seeding `--app-rail-width-expanded`. |
| `LeftRail.svelte.test.ts` L234–275 | asserts the whole offset contract from source. |

### 6b. Horizontal (detail) offset chain — `--app-right-detail-offset` / `--map-detail-offset` (map only)
Owner: `MapHero.svelte` L1020–1225 (writes both vars on `.map-hero`). Readers: `MapDetailOverlay`,
`MapFreshness`, `MapOverlayChrome`, `MapNearMeControl`, `MapHeadTitle`, `MapFeedStallBanner`,
`MapStage`. Mirror of the left-rail system for the right dock. `mapDetailPanes.ts` = the persisted-px
wrapper (same `overlayWidth` factory). **Independent of the top chrome height.**

### 6c. Vertical (chrome-height) offset — the pill-nav-relevant one
| Location | Value | Role |
|---|---|---|
| `RailLayout.svelte` L87 | `top: 5.5rem` | sticky rail offset (hard literal). |
| `ControlsRail.svelte` L122 | `top: var(--rail-sticky-top, 5.5rem)` | sticky panel offset (tunable). |
| `RouteReliabilityClusters.svelte` L656 | `--rail-sticky-top: 0px` | the one override. |
| `MetricsExplainer.svelte` L866 | `top: 5rem` | its own sticky context panel (NOT RailLayout). |
| `MetricsExplainer.svelte` L885, L987 | `scroll-margin-block-start: 5.5rem` | anchor scroll offset. |
| `SectionConformance.svelte` L85 | `scroll-margin-block-start: 5.5rem` | anchor scroll offset. |
| `RouteReliabilityClusters.svelte` L853 | `scroll-margin-top: 7rem` | anchor scroll offset. |
| `app.css` L535 | `scroll-margin-top: calc(var(--nav-height, 64px) + 1rem)` | **global** heading-anchor offset. |
| `ReliabilityFilterPill.svelte` L96 | `top: calc(var(--nav-height, 64px) + 0.6rem + env(safe-area-inset-top))` | fixed filter pill. |

**`--nav-height` is NEVER set** (`grep "--nav-height:"` → 0). It's a pure `64px` fallback — and the
TopBar is actually `60px`, so the anchor offset is already off by 4px. The `5.5rem`/`7rem`/`5rem`
literals are similarly untethered magic numbers. **There is no single knob.** A pill nav that changes
the effective chrome height requires touching every row above.

### 6d. Map floating-chrome top literals (viewport-anchored, not rail-height)
`MapOverlayChrome.svelte:188 top:5.25rem`, `MapFeedStallBanner.svelte:91 top:3.6rem`,
`MapMotionControl.svelte:211 top:50%`. These position map controls from the *viewport top*, so they
clear the fixed TopBar. A pill nav that floats (transparent, no reserved height) or changes height
shifts what these must clear.

---

## 7. Full-bleed + pill/rounded chrome mechanics as implemented today

- **Full bleed:** two layers, §3. Shell full-bleed = the `:not(:has(.map-hero))` padding trick; the
  map stage is `position:absolute; inset:0` inside an `overflow-hidden` row, so it is edge-to-edge and
  never scrolls/resizes. Content full-bleed = `.surface-bleed` negative-margin gutter escape.
- **Rounded/pill chrome today:** The TopBar itself is a **flat full-width bar** (`border-b`, square
  corners, `h-[60px]`) — NOT a pill. The only "pill" mechanics present:
  - `--radius-pill` used on the alerts badge, search-kind chips, hamburger lines.
  - `ReliabilityFilterPill.svelte` — a genuine floating **pill** (`position:fixed; top:calc(
    --nav-height + ...)`, `border-radius` pill), the closest existing analog to a yesid pill nav. It
    already demonstrates the top-offset-clears-fixed-chrome pattern.
  - `TocPill.svelte` (`components/shared/`) — bottom-anchored floating pill (`bottom:calc(20px +
    safe-area-inset-bottom)`), the mobile jump-to affordance RailLayout's doc references.
- **yesid.dev reference:** the sibling repo path (`../yesid.dev/src`) is **not present** in this
  checkout, so I could not diff against the actual pill-nav source. The transit brand primitives
  (`BrandCluster`, `BrandWordmark`) are the vendored yesid marks; `BrandCluster.svelte` comment L13
  explicitly references the yesid.dev nav pill divider idiom.

---

## 8. Tests touching these components (what they assert)

| Test file | Asserts |
|---|---|
| `TopBar.svelte.test.ts` | grouped selectable search results + select callback; `autocomplete=off`; focused mobile-search open/close; scoped placeholders (route/stop/map, EN+FR); click-outside closes suggestions; long-address wrap CSS; mobile menu opens w/ externalized `yesid.` link + focus-return to burger (Escape + Audit-link close); mobile-menu height cap `min(calc(100dvh-5rem),34rem)` + overflow scroll; brand-mark present + `≤760px` hide (now asserted against `BrandCluster.svelte`); menu `position:absolute` (NOT `fixed inset:0`), `right:0.75rem`, `width:min(19rem,...)`. |
| `LeftRail.svelte.test.ts` | default nav + active highlight; Audit group below primaries (localized EN/FR, active-aware); Audit reachable under custom rail + when collapsed (heading hidden, links named); icon-only collapse symmetry (`--left-rail-tile-size:3.35rem`); **the AppShell one-stable-DOM contract** (no paneforge/Resizable*, no `{#if isDesktop}`, `data-rail-collapsed` toggle); **`--app-left-rail-offset` media-query mapping asserted from source** (L234–250); rail overlay `display:none`→`block@1024`; draggable handle writes only the CSS var; `.app-shell-main:not(:has(.map-hero))` padding-left rule (L237). |
| `RightPanel.svelte.test.ts` | width-only collapse (no padding transition), `data-open='false'` → `width:3.7rem`; B1 resizable-collapse floor (3.7rem not 100%); back action only w/ history; externally-controlled collapse in resizable pane. |
| `BottomSheet.svelte.test.ts` | back action only w/ history. |
| `RailLayout.svelte.test.ts` | both snippets render; rail in `<aside>` before content; source order; `railLabel` names landmark; **sticky wrapper inside the aside**; class forwarding. (Does NOT assert the `5.5rem` value — good, but also means changing it won't fail a test.) |
| `ControlsRail.svelte.test.ts` | controls render in body; bilingual label renders + names group; label omitted → no `role`/`aria-label`; non-sticky default; `--sticky` modifier applied; **`.controls-rail--sticky` carries `z-index:var(--z-rail)` asserted from source**; non-landmark group + class forward. (Also does NOT assert `5.5rem`.) |
| `DashboardGrid.svelte.test.ts` | (grid recipe/label semantics — not chrome-coupled). |
| `leftRailWidth.test.ts` / `overlayWidth.test.ts` | clamp + SSR-safe read/write; junk/degenerate fallback to default. |

---

## 9. KEY JUDGMENT — replacing the top chrome with a yesid.dev floating pill nav

### Structure verdict
The shell is **cleanly composable at the top level** — only `+layout.svelte` renders `<AppShell>`,
and only `AppShell` renders `<TopBar>`. Swapping TopBar's internals for a floating pill is a
localized component edit. **BUT** the vertical chrome-height offset is **not abstracted**: it is a
scatter of magic literals (`5.5rem`, `5rem`, `7rem`, `64px` fallback for an unset `--nav-height`) plus
the map's viewport-top literals. A floating pill (transparent, height-less, insetting from the top
rather than reserving a 60px strip) breaks every one of these assumptions. The horizontal rail-offset
system (`--app-left-rail-offset`) is **well-abstracted and independent** — it survives a pill swap
untouched **unless** the pill also replaces the LeftRail nav.

### Blast-radius file list (enumerated)

**A. The chrome component + composition (must change):**
1. `apps/web/src/lib/components/shell/TopBar.svelte` — rewrite as the pill (or a new `PillNav.svelte`).
2. `apps/web/src/lib/components/shell/AppShell.svelte` — `<TopBar>` is currently a flex-row sibling of
   the map row inside `h-dvh flex-col`. A floating pill must become an **absolute/fixed overlay** over
   the row (so the map goes truly full-height under it); the `flex-col` + `min-h-0 flex-1` height math
   and the `.app-shell-row`/`.app-shell-main` `inset:0` all change.
3. `apps/web/src/routes/+layout.svelte` — passes TopBar props through AppShell; the `#main`
   `overflow-y-auto` wrapper + Footer placement + `isFullBleed` logic assume the 60px strip reserves
   space at top. If the pill floats, `#main` must inset its top (new padding) or content slides under
   the pill.
4. `apps/web/src/lib/components/brand/BrandCluster.svelte` — `variant="topbar"` markup/hooks +
   `≤760px` collapse; a pill likely restyles this.
5. `apps/web/src/lib/components/shell/BrandWordmark.svelte`, `LangSwitch.svelte`, `LiveClock.svelte`,
   `RefreshButton.svelte`, `ThemeToggle.svelte`, `SurfaceNavList.svelte` — the pill re-hosts these
   controls; LangSwitch already has `≤479px`/`≤359px` shrink rules tuned to "the floating nav pill"
   (comment L226) — those breakpoints need re-verification.

**B. Vertical offset readers (must retune — the disjoint "chrome offset"):**
6. `apps/web/src/lib/components/layout/RailLayout.svelte` L87 (`top:5.5rem`).
7. `apps/web/src/lib/components/layout/ControlsRail.svelte` L122 (`top:var(--rail-sticky-top,5.5rem)`).
8. `apps/web/src/lib/features/lines/reliability/RouteReliabilityClusters.svelte` L656
   (`--rail-sticky-top:0px`) + L853 (`scroll-margin-top:7rem`).
9. `apps/web/src/lib/features/metrics/MetricsExplainer.svelte` L866 (`top:5rem`), L885/L987
   (`scroll-margin-block-start:5.5rem`).
10. `apps/web/src/lib/features/health/sections/SectionConformance.svelte` L85 (`scroll-margin`).
11. `apps/web/src/app.css` L535 — the **global** `scroll-margin-top: calc(var(--nav-height,64px)+1rem)`.
    A pill nav should FINALLY define `--nav-height` (or a new `--chrome-inset`) as the single knob and
    point all of the above at it.
12. `apps/web/src/lib/features/lines/reliability/ReliabilityFilterPill.svelte` L96 — fixed pill
    `top:calc(var(--nav-height,64px)+...)`; collides directly with a top-centre pill nav.

**C. Map floating chrome (viewport-top clearers — retune):**
13. `MapOverlayChrome.svelte` (L188 `top:5.25rem`, + L189/L216 left-offset readers).
14. `MapHeadTitle.svelte`, `MapFeedStallBanner.svelte` (L91 `top:3.6rem`, + centering), `MapFreshness.svelte`,
    `MapNearMeControl.svelte`, `MapMotionControl.svelte`, `MapStage.svelte` — all clear the current
    60px strip from the viewport top and/or read the offset vars.

**D. Tests (will break / must update):**
15. `TopBar.svelte.test.ts` — nearly all assertions are structure/class-specific (`topbar-menu-toggle`,
    `topbar-mobile-menu` position/width, `h-[60px]` implied) → heavy rewrite.
16. `LeftRail.svelte.test.ts` — asserts the AppShell offset contract from source (L212–275); if
    AppShell's markup/vars change, these regexes break.
17. `RailLayout.svelte.test.ts`, `ControlsRail.svelte.test.ts` — do NOT assert the `5.5rem` value, so
    they'll pass silently even if the offset is wrong (a testing GAP, not a blocker).

**Rough count: ~17 primary files + the map cluster (~7) ≈ 24 files**, of which ~6 are the actual
component rewrite, ~7 are vertical-offset retunes, ~7 map-chrome retunes, ~3 test rewrites.

### The 3 riskiest hidden couplings
1. **The unabstracted vertical offset (magic `5.5rem` + unset `--nav-height:64px`).** Nothing derives
   these from the real 60px TopBar; the `RailLayout`/`ControlsRail` tests don't assert them; the
   `app.css` global anchor offset uses a different constant than the sticky rails. A pill swap silently
   mis-offsets sticky rails and heading-anchor scroll on **every document surface** with no failing
   test. **Fix: introduce ONE `--chrome-inset`/`--nav-height` token set on the shell and repoint all
   `5.5rem`/`5rem`/`7rem`/`64px` at it.**
2. **AppShell's flex-column height contract + `overflow-hidden` row + `.app-shell-main{inset:0}`.** The
   TopBar today *reserves* 60px in a `flex-col`; the map row takes `flex-1`. A floating pill removes
   the reserved strip, so the map row must become the full `h-dvh` and the pill an absolute overlay —
   and `#main`'s `overflow-y-auto` scroll container (which the sticky `top:5.5rem` is measured against,
   NOT the window) changes its top origin. Get this wrong and either the map loses height or document
   content scrolls under the pill. The map's `:has(.map-hero)` full-bleed branch and the
   `--app-left-rail-offset` overlay anchoring ride on this exact geometry.
3. **Overlay/portal anchoring + z-index literal soup.** TopBar's mobile menu/search are
   `position:absolute; top:calc(100% + ...)` **relative to `<header>`** — a floating pill changes what
   `100%` and the stacking context mean, and the shell uses raw z-index literals (header `z-40`, menu
   `65`) that do NOT match the `--z-*` token scale (`--z-nav:70`, `--z-menu:60`, `--z-rail:30`,
   `--z-sheet:50`). A pill at a new elevation can slip under the RightPanel overlay (`z-index:32`),
   the map chrome, or the `ReliabilityFilterPill`/`TocPill` fixed pills (which also assume the current
   chrome height for their `safe-area-inset-top/bottom` offsets). Safe-area handling is only present on
   Footer + the map/pill bottom controls, not the top chrome — a top-floating pill on notched devices
   would need new `env(safe-area-inset-top)` handling that doesn't exist today.

### No scroll-listener coupling (good news)
`grep` for `scroll`/`scrollY`/`getBoundingClientRect` in `shell/`, `layout/`, `nav*` → **none**. All
sticky/offset behavior is pure CSS. So there is no JS scroll handler reading the chrome height that
would silently break — the risk is entirely in the CSS literals + the flex/overflow geometry.
