# Surface Anatomy — "home" (Hub landing)

**Route:** `apps/web/src/routes/[[lang=locale]]/+page.svelte` (749 lines incl. leading doc-comment + `<style>`).
**Locale:** EN = no prefix; `/fr/` via the optional `[[lang=locale]]` param (`+layout.ts` `pathLocale`).
**No `+page.ts` / `+page.server.ts`** for the home route — **zero page-level data loading**. All data comes from **context** provided once by the root layout:
- Locale via `getLocale()` (context reader set in `+layout.svelte:91`).
- v1 snapshot via `getV1Context().manifest` (`+page.svelte:67`) — booted in `+layout.ts` / `+layout.server.ts`.
- Live tier via `createLiveStore(manifest)` (`+page.svelte:82`), started `onMount`, stopped on unmount (`:83-86`).

There is **one root layout only** (`apps/web/src/routes/+layout.svelte`); no nested `[[lang=locale]]/+layout`. The page renders into the AppShell `main` snippet (`+layout.svelte:474-511`), guarded by a `{#if !v1}` error edge state (`:486-501`).

---

## (1) SECTION ORDER + STORY ARC

Single `<Surface width="wide" pad="hub" class="hub">` (`:413`) with three movements. Top-to-bottom:

| # | Section (DOM) | Heading | Component(s) | Data source / selector |
|---|---|---|---|---|
| 0 | `<header class="hub-head">` (`:415-419`) | **h1 = `manifest.display_name`** (SectionHeading, `dot`) + kicker `SectionLabel variant="station"` (`t.kicker`="CITIZEN DASHBOARD") + `.hub-tagline` (`t.tagline`) | `SectionLabel`, `SectionHeading`, `<p>` | `manifest.display_name`; copy templated on `shortName`/`city` (`:71-72`) |
| 1 | CONTROL-ROOM HERO — `<TerminalChrome class="hub-pulse">` (`:421-460`) | terminal title `t.terminalTitle` ("network.control-room"); `tag`=LIVE/STANDBY; `status`="Last updated {lastBuilt}" | `TerminalChrome`, `StatusDot`, `SectionLabel`, `FreshnessStamp`, `DashboardGrid as="ul" minTile=160px`, `MetricDisplay`+`MetricInfo` (via `pulse` snippet `:516-522`) | Live store `live.network` (`net`, `:93`): `on_time_pct`, `vehicles_in_service`, `non_responding`, `coverage_pct`; `live.generatedUtc/ageSeconds/isStale` for the stamp |
| — | `<Separator variant="hazard" hazardSize="sm">` (`:462`) | — | Separator | — |
| 2 | WHAT THIS IS — `<section class="hub-what">` (`:465-484`) | **h2 = `t.whatTitle`** ("What this is") + subheading `t.whatSub` ("// INDEPENDENT · HONESTY FIRST") | `SectionHeading level=2`, `<p class="what-body">`, `.what-link`→`/metrics`, `DashboardGrid as="ul" minTile=180px` of 3 `.pillar` cards | Static bilingual copy (`T[locale]`, `PILLARS` `:228-253`) |
| 3 | EXPLORE EVERYTHING — `<nav class="hub-explore">` (`:487-510`) | 3 group `<h2>`s (Explore / Accountability / Trust), each wrapping `SectionLabel variant="station"` | Per group `<section class="explore-group">` + `DashboardGrid as="ul" minTile=240px` of `.hub-tile` buttons/links (via `tileBody` snippet `:524-531`) | Static `GROUPS` (`:281-410`). `surface` entries → `openSurface(target)`; `link` entries → `localizeHref(href)` |

### Story-arc assessment

**What the reader answers at each depth:**
- **Depth 0 (hero head):** "Whose network is this, what is this site?" — provider name as h1 + kicker + tagline. Strong immediate identity.
- **Depth 1 (control-room pulse):** "How is the network doing *right now*?" — 4 live KPIs + LIVE/STANDBY verdict + ticking freshness stamp. The evidence/"right now" beat.
- **Depth 2 (what this is):** "Can I trust these numbers?" — honesty thesis (measured proxy, not certified OTP; null=missing) + 3 pillars (Live/Honest/Accountable). The credibility/context beat, but it lands *after* the evidence.
- **Depth 3 (explore):** "Where next?" — full site map grouped by intent.

**Narrative verdict — a competent hub/launcher, NOT a case-study story.** Arc is *identity → live evidence → thesis → navigation*, a legitimate dashboard shape but not *context → evidence → verdict*. Breaks:
1. **No verdict.** The pulse shows 4 raw numbers, never a synthesized judgment ("on time" / "degraded"). The LIVE/STANDBY tag is a *liveness* verdict, not a *performance* one.
2. **Thesis after evidence.** The "measured proxy" framing sits below the KPIs; a first-timer sees numbers before learning how to read them.
3. **The pulse is a dead end.** 4 static tiles — no trend, sparkline, "vs. yesterday", or band. Evidence appears then the page pivots straight to navigation.
4. **No baseline on the pulse numbers.** A freshness stamp exists, but a reader can't tell if 82% on-time is good/typical/bad.
5. **Explore is flat scope-dumping.** 11 surfaces / 3 groups is thorough wayfinding but reads as a directory — no curated "start here" / hero CTA.

Overall: polished, honest, on-brand control-room launcher — but as a portfolio case study it stops at "here are live numbers and here's everything," never reaching "and here's the verdict."

---

## (2) CHROME — headers, sticky, rails, offsets

- **TopBar** (`lib/components/shell/TopBar.svelte:273`): `h-[60px]`, `z-40`, `shrink-0`, `border-b`, `bg-card`. **NOT `position:sticky/fixed` for scroll** — it is a flex child of the shell column (`AppShell.svelte:248-265`). The shell is `h-dvh overflow-hidden` and **never scrolls as a whole**; the page scrolls inside `#main` (`+layout.svelte:480-484`, `overflow-y-auto`). TopBar stays pinned by flex layout, not sticky.
- **`--chrome-offset`: NOT used anywhere** (grep-clean in shell/layout/home). The pinned-chrome pattern is pure flexbox, so no page reserves a top offset. The home page has **no sticky elements of its own**.
- **App sticky elements** exist only in `ControlsRail`/`RailLayout`/`MissionControlGrid` (`position:sticky; top:5.5rem`) — **the home page uses NONE**. It uses the plain `Surface` container: no sticky rail, no in-page ToC, no sticky sub-nav.
- **LeftRail** (`AppShell.svelte:291-341`): desktop-only (`@media min-width:1024px`) absolute overlay, width `--app-left-rail-offset` (16rem expanded / 4.85rem collapsed, `:385-387,464-477`), draggable. Non-map `<main>` pads left by `--app-left-rail-offset` (`:397-399`) → home sits right of the rail on desktop, **flush-left on mobile** (offset 0 below 1024px, `:387`).
- **Footer** (`+layout.svelte:503-509`) at the natural bottom of the scroll flow (home is non-`/map`).

---

## (3) CONTAINERS — max-widths, grid templates, padding rhythm

- **Outer:** `Surface width="wide"` → `max-width: var(--container-wide)` = **72rem** (`Surface.svelte:22-28`; `tokens.css:89`). `margin-inline:auto`. `pad="hub"` → `padding-block: clamp(2rem,6vw,4rem)` (`:56-58`). `gutter` default true → `padding-inline: var(--space-page-x)` = `clamp(1rem,4vw,5rem)` (`tokens.css:43`). Movement gap `clamp(1.75rem,4vw,2.75rem)` (`Surface.svelte:48`).
- **Reading measures:** `.hub-head max-width:62ch`; `.hub-tagline 56ch`; `.what-body 60ch` (`:539,:545,:606`). Good.
- **DashboardGrid recipe** (`DashboardGrid.svelte:122-138`): `grid-template-columns: repeat(auto-fit, minmax(min(var(--min-tile),100%),1fr))`; `gap: var(--space-card-gap)` = `clamp(1rem,2vw,1.5rem)` (`tokens.css:45`); `align-items:stretch`. All three home grids pass `gutter={false}` + `maxWidth="none"` — the parent Surface owns the page gutter (**no double gutter**).
  - Pulse `minTile=160px` (`:447`); Pillar `minTile=180px` (`:475`); Explore `minTile=240px` (`:493`).
- **`.hub-what` split** (`:586-595`): single column; `@media (min-width:1024px)` → `grid-template-columns: minmax(0,1.4fr) minmax(0,1fr)` (prose left, pillars right).
- **Card padding rhythm:** `.pillar` `1rem 1.1rem` (`:637`); `.hub-tile` `1.25rem 1.5rem` (`:692`); both `1px solid var(--border)`, `radius var(--radius-lg,0.75rem)`, `box-shadow var(--shadow-card)`, `bg var(--card)`.

---

## (4) HEADINGS — hierarchy sanity

- **h1** — `manifest.display_name` (SectionHeading level=1, `:417`). `clamp(2.5rem,6vw,4rem)`, weight 900, `letter-spacing:-2px` (`SectionHeading.svelte:52-57`). Kicker above is a `<span>` SectionLabel — correct.
- **h2** — "What this is" (SectionHeading level=2, `:467`). **SectionHeading renders the same visual size at every level** — so this h2 is *visually as large as the h1* (semantics fine; visual weight not differentiated by level).
- **h2 ×3** — group labels Explore/Accountability/Trust (`<h2 class="explore-group-label">` wrapping `SectionLabel variant="station"`, `:490-492`). Semantic h2 but render as tiny mono uppercase overlines (`label-station`: `--text-small`, letter-spacing 3px).

**Verdict:** No skipped levels (h1→h2, no orphan h3/h4). SR outline is clean 1→2→2→2→2 (tests assert h1 + the 3 group h2s, `page.svelte.test.ts:102,:191-193`). **But visual hierarchy contradicts semantic hierarchy twice:** (a) "What this is" h2 is as big as the h1; (b) the three explore-group h2s render far smaller than that sibling h2. **No h3/h4 at all** — pulse KPI labels, pillar titles, tile titles are all `<span>`s (defensible: list items, not sections).

---

## (5) ABSENCE STATES

- **Pulse KPIs** use `MetricDisplay` with `emptyLabel={t.noData}` ("no data" / "aucune donnée") via the `pulse` snippet (`:519`). When `net` is null (SSR + pre-first-tick + missing live tier), `fmtPct`/`fmtCount` return `null` (`:119-125`; shared `utils/format.ts:89,106` return null not "0"), and MetricDisplay renders the muted `.metric-empty` caption (`MetricDisplay.svelte:81-86,106-111`). **Never a fabricated 0, never a bare dash** — verified by tests (`page.svelte.test.ts:122-127,175-183` assert ≥4 "no data" and exact `textContent==='no data'`).
- **DOWNGRADE (the one absence-quality gap):** the pulse uses the **plain `emptyLabel` path, NOT the richer `absentReason`/`AbsentValue` path.** MetricDisplay supports `absentReason`+`locale` to render the styled honest-absence (glyph + calm tone + a WHY) via `AbsentValue` (`MetricDisplay.svelte:35-38,82-83`). The home pulse passes neither, so its no-data state is the **bare muted "no data" string with no reason/why.** This is a step below the site-wide unknown-data doctrine ("EVERY no data clearly says NO DATA + WHY"). The *why* here ("live feed not yet reported / unreachable") is currently unstated on the flagship front door.
- **Freshness stamp** stands down to `t.unknown` ("unknown") with no resolvable timestamp (`FreshnessStamp.svelte:99-111`); `lastBuilt`→`t.builtUnknown` in the terminal `status` (`:425`). Honest.
- **LIVE/STANDBY tag** (`:424`) is an honest liveness verdict driven by `isLive = net != null` (`:220`).
- **No bare `·`/`—`/`null`/`undefined`/`NaN` leaks** found.

---

## (6) EXPLAINER LINKS — do metrics link to /metrics?

**Yes, on the pulse — all four.** Each pulse tile carries a `MetricInfo` `(i)` affordance (`:520`) built from `metricInfoFor(key, locale)` (`:213-216`), keyed `otp`/`vehicleCount`/`silentTrip`/`coverage` (`:455-458`). Each resolves a one-line `tip` + a deep link to `/metrics#<anchor>` (anchors confirmed in `metrics.content.ts`: `otp`→`otp` `:118-119`; supplemental keys `coverage`/`vehicleCount`/`silentTrip` `:1123-1126`). Link label "How this is measured" (`metrics.copy.ts:411`), trigger "About {name}" (`:410`). Tests assert one `(i)` per tile with correct names (`page.svelte.test.ts:157-173`).

Metrics is reachable **three ways** from the hub: the pulse `(i)` popovers, the `.what-link`→`/metrics` ("How we measure", `:469-472`), and the Trust-group tile→`/metrics` (`:389-397`).

**Interaction gap:** the `MetricInfo` popover is position:fixed and **dismisses on any scroll / resize / orientationchange** (`MetricInfo.svelte:243-266`). On touch it's tap-to-open then tap-the-link, and mid-scroll it vanishes — desktop-optimized.

---

## (7) MOBILE-390 READ FROM CODE

**Breakpoints:**
- The page has exactly **one** media query: `@media (min-width:1024px)` on `.hub-what` (2-col, `:590`). Everything else is intrinsic (auto-fit + clamps) — no phone breakpoint, by design.
- Chrome: LeftRail reveals at `@media (min-width:1024px)` (`AppShell.svelte:464`); below that rail offset = 0, TopBar burger owns nav. At 390px the page is **full-bleed left**.

**Computed layout at 390px:**
- `--space-page-x` = `clamp(1rem,4vw,5rem)`; 4vw of 390 = 15.6px < 1rem floor → **16px each side**. Content ≈ **358px**.
- Pulse grid `minTile=160px`: 358/160 → **2 columns** (4 KPIs → 2×2). Fits.
- Pillar grid `minTile=180px`: 2×180=360 > 358 → **1 column** (3 stacked). Fits.
- Explore grids `minTile=240px`: → **1 column** (tiles stack). Fits.
- `.hub-what` → single column. Fits.
- **Overflow net:** every grid item/card has `min-width:0` (`:571,:643,:681,:724`) so long tokens can't blow out tracks. Doc-comment claims "fits and centers without overflow at 360px."

**Elements at risk of overflow:**
- **h1 = `manifest.display_name`** at `clamp(2.5rem,6vw,4rem)` (floor 40px at 390px) with `letter-spacing:-2px` and **no `overflow-wrap`/`hyphens`** on `.section-heading-text`. A long provider name (e.g. "Société de transport de Montréal") at 40px in 358px **will wrap or, as a single long token, could overflow**. **Highest overflow risk.** (Demo/STM short names are fine.)
- **TerminalChrome titlebar** (`:421-426`): title + tag + long "Last updated 3 minutes ago" status on one flex row that **does NOT `flex-wrap`** (`TerminalChrome.svelte:105-112`), unlike `.pulse-head` which does (`:552-556`). On a narrow screen the status can crowd. Minor.

**Touch-target sizes (from classes/CSS):**
- `.hub-tile` (buttons+links): padding `1.25rem 1.5rem` → comfortably **>44px tall**. Good.
- `.what-link`: inline link, no min-height → **~20px, below 44px**.
- **`MetricInfo` `(i)` trigger: `inline/block-size: 1.05rem` = ~16.8px square, no hit-area expansion** (`MetricInfo.svelte:331-332`). **Well below the 44px minimum** — four on the pulse row. Clearest touch-target defect.
- `StatusDot` are decorative, not tap targets.

**Chart sizing on small screens:** **N/A — there are no charts.** The only quantitative marks are the 4 numeric KPI tiles (no sparkline/trend). This absence is itself a content gap (§8).

**Sticky on mobile:** none on the page. TopBar pinned via the flex shell (content scrolls in `#main`), not sticky. No in-page sticky ToC/controls. Footer at natural bottom.

**Mobile risk level: LOW–MODERATE.** Reflows cleanly to 1-column with `min-width:0` guards everywhere; real risks are (a) long `display_name` h1 with no wrap guard, (b) sub-44px touch targets on the four `(i)` triggers and `.what-link`.

---

## (8) TOP 5 gaps vs. an A++ portfolio case-study page

1. **No synthesized verdict.** The pulse shows 4 raw numbers, never what they *mean* right now. Add a one-line network verdict derived from the pulse (InsightCard-style), turning evidence into a claim. *(The "verdict" beat is entirely missing.)*
2. **No baseline / trend / comparison on the KPIs.** 82% on-time is meaningless without "vs. typical" or a 24h/7d sparkline + a good/bad band. The numbers are context-free point-in-time values with no chart at all.
3. **Thesis lands after evidence; no context-first framing.** "Measured proxy, not certified OTP" sits *below* the KPIs. Reorder/interleave so the credibility frame precedes or accompanies the first evidence.
4. **Absence state is the bare "no data" string, not the site's own AbsentValue-with-a-WHY.** The hub — the site's front door and honesty showcase — uses the weaker `emptyLabel` path while the rest of the site uses `absentReason`/`AbsentValue`. Wire `absentReason` (e.g. "live feed not yet reported") into the pulse tiles so the flagship honesty moment states *why*.
5. **Explore reads as a flat directory + weak mobile affordances.** 11 tiles / 3 groups is complete but offers no "start here" hero CTA, and the metric `(i)` triggers (~17px) + `.what-link` are sub-44px and dismiss-on-scroll on mobile. Add one clear primary action and 44px-min targets. *(Secondary: the h1 has no `overflow-wrap` guard for long provider names — a real 390px overflow risk.)*

---

## Component inventory

**Surface-specific to the hub:** the `pulse` + `tileBody` snippets, the `T` copy table, `PILLARS`, `GROUPS`, and all `.hub-*` styles — all inline in `+page.svelte`. No home-only child components; the page composes shared primitives directly.

**Shared primitives composed (dived where load-bearing):**
- `Surface` (`components/layout/Surface.svelte`) — width/pad/gutter; wide=72rem.
- `DashboardGrid` (`components/layout/DashboardGrid.svelte`) — auto-fit `minmax(min(minTile,100%),1fr)`; polymorphic `as="ul"`.
- `TerminalChrome` (`components/brand/TerminalChrome.svelte`) — titlebar (3-StatusDot signal-head) + hazard Separator + body; `--terminal` tokens; titlebar does not flex-wrap.
- `MetricDisplay` (`components/brand/MetricDisplay.svelte`) — value/label; honest `emptyLabel` + optional `absentReason`→AbsentValue (unused here).
- `MetricInfo` (`features/metrics/MetricInfo.svelte`) — hand-rolled fixed-position `(i)` popover, deep link to `/metrics#anchor`; dismiss-on-scroll; 16.8px trigger.
- `FreshnessStamp` (`components/surface/FreshnessStamp.svelte`) — the one site freshness readout; live variant; server-anchored shared-clock age; honest "unknown".
- `SectionHeading` / `SectionLabel` (`components/brand/`) — h1/h2 + mono overlines (station=yellow, metric/section=muted); heading size is level-agnostic.
- `StatusDot`, `Separator` (`components/ui/separator`).
- Selectors/stores: `createLiveStore` + `getV1Context` (`$lib/v1`), `openSurface` (`$lib/nav`), `sharedClock` (`$lib/stores`), `fmtPct`/`fmtCount` (`$lib/utils`), `metricInfoFor`/`metricsCopy` (`$lib/features/metrics`).
