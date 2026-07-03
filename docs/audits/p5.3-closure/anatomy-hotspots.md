# Surface Anatomy — /hotspots

**Route:** `apps/web/src/routes/[[lang=locale]]/hotspots/+page.svelte` (13 lines, thin mount)
**Feature root:** `apps/web/src/lib/features/hotspots/HotspotsBoard.svelte` (orchestrator, 308 lines)
**Section presenter:** `apps/web/src/lib/features/hotspots/sections/HotspotSection.svelte` (338 lines)
**Data/selectors:** `data/presentGrains.ts`, `data/ladderCap.ts`, `selectors/hotspotLadder.ts`
**Copy:** `hotspots.copy.ts` (bilingual en/fr)

## Component tree (composition, follow-the-imports)

```
+page.svelte  (mounts, no data/logic)
└── HotspotsBoard.svelte  (owns resource, grain+worstN state, URL mirror, ONE mapping pass)
    ├── Surface (layout, width="bleed")                    lib/components/layout/Surface.svelte
    ├── SurfaceHeader (kicker/heading/subheading/lede)     lib/components/surface/SurfaceHeader.svelte
    │   ├── SectionLabel variant="station"  (kicker)       lib/components/brand/SectionLabel.svelte  (<span>)
    │   ├── SectionHeading dot level=1       (heading h1)  lib/components/brand/SectionHeading.svelte (<h1>)
    │   └── FreshnessStamp variant="updated"               lib/components/surface/FreshnessStamp.svelte (<span>+<time>)
    ├── Separator variant="hazard"                         lib/components/ui/separator/separator.svelte
    ├── ResourceBoundary (skeleton/error/empty gate)       lib/components/surface/ResourceBoundary.svelte
    │   ├── [isEmpty branch] AbsentValue variant="block"   lib/components/edge/AbsentValue.svelte
    │   └── [loaded branch] <section aria-label=heading>
    │       ├── SurfaceControls (grain rail, sticky) *only when >1 grain populated*
    │       │   └── ControlsRail → GrainPicker              lib/components/layout/ControlsRail.svelte + surface/GrainPicker.svelte
    │       ├── Separator variant="hazard" hazardSize="sm"
    │       ├── HotspotSection  (route|stop TABS)
    │       │   ├── Tabs/TabsList/TabsTrigger/TabsContent   lib/components/ui/tabs
    │       │   ├── [per tab] SectionLabel variant="metric" (heading, <span> NOT a heading el)
    │       │   ├── [per tab] MetricInfo (i) explainer      lib/features/metrics/MetricInfo.svelte
    │       │   ├── [per tab] GrainPicker (worst-N)         (only when total > 5)
    │       │   ├── [per tab] Chart spec=magnitude-bars     lib/components/dataviz/chart/Chart.svelte
    │       │   │             → MagnitudeBarsMark (LayerChart lollipop)
    │       │   └── [per tab] tray <ul> of sub-MIN_N links
    │       └── <p class=hotspots-caveat>  (honest caveat)
```

---

## (1) SECTION ORDER + STORY ARC

Top-to-bottom render order inside `Surface`:

| # | Element | Component | Data source / selector | Reader question answered |
|---|---------|-----------|------------------------|--------------------------|
| 1 | Surface header block | `SurfaceHeader` | static copy `t.kicker/heading/subheading/lede` (`hotspots.copy.ts:141-145`) | "What is this page?" — kicker `ACCOUNTABILITY · HOTSPOTS`, h1 `Hotspots`, sub `// WORST FIRST`, lede "stops and lines dragging the network down, ranked worst first by severe-delay rate" |
| 2 | Freshness stamp | `FreshnessStamp` (child of header, `HotspotsBoard.svelte:234`) | `hotspots.data.generated_utc` (`:85`) | "How current is this?" |
| 3 | Hazard separator | `Separator variant="hazard"` (`:237`) | — | visual divider (brand safety-tape) |
| 4 | Grain rail (sticky) | `SurfaceControls` (`:250-260`) | `present`/`grainAvailability` from `presentGrains()` (`:90,107`) — **rendered only when `present.size > 1`** (`:118,249`) | "Over what time window? day/week/month/peak-hours" |
| 5 | Hazard separator (sm) | `Separator` (`:261`) | — | divider under rail (only when rail shows) |
| 6 | The ONE ladder section | `HotspotSection` (`:267-278`) | `routeLadder`/`stopLadder` via `ladderFor()` → `selectHotspotLadder()` (`:185-202`); trays via `trayFor()` (`:206-223`) | "WHICH stops/lines are worst, and by how much?" |
| 6a | · route\|stop tabs | `Tabs` (`HotspotSection.svelte:120`) | `tabs` = kinds with ≥1 ranked OR tray row (`:97`) | "route vs stop cut" |
| 6b | · section label + (i) | `SectionLabel` + `MetricInfo` (`:140-148`) | `headingTextFor()` → `t.shownOfTotal` (`:113`); `info` = `severeInfo` (`HotspotsBoard.svelte:81`) | "Worst spots · 10/42" + explainer |
| 6c | · worst-N picker | `GrainPicker` (`:151`) | `worstN` bind, `worstNSegments()` (`ladderCap.ts:32`) — only when `total > 5` (`:109-111,150`) | "show how many rows?" |
| 6d | · window caption | `<p class=caption>` (`:154`) | `windowCaption` = `t.window[grainKey]` (`HotspotsBoard.svelte:226`) | "Ranked over the latest service day/week/month/peak." |
| 6e | · the ladder chart | `Chart` → `MagnitudeBarsMark` (`:156`) | `tab.ladder.spec` (magnitude-bars lollipop, SEVERE_DOMAIN [0,100]) | THE EVIDENCE: severe-delay rate per entity, worst on top, Wilson CI whisker, drill-on-click |
| 6f | · un-ranked tray | `<ul>` links (`:170-198`) | `tab.tray` (`trayFor()`) | "these exist but can't be ranked (< 30 readings)" — transparency |
| 7 | Honest caveat | `<p class=hotspots-caveat>` (`HotspotsBoard.svelte:281`) | `t.caveat` | "Trailing-window ranking, not a certified league table; small samples vary." |

**Story-arc assessment (context → evidence → verdict):**

- **Context (strong):** the header + lede state the promise plainly ("worst first by severe-delay rate, we never invent data"). Window caption + caveat give honest framing. Good.
- **Evidence (present but flat):** ONE ladder chart is the entire evidence layer. The bar encodes severe-delay rate on an absolute [0,100] domain (doctrine-clean), with per-row Wilson CI + a compact note (`severe X% · avg Y min · n=Z`, `HotspotsBoard.svelte:169-177`). This is rigorous but it is a **single visualization repeated across two tabs** — the page is essentially "one ranked bar chart with a time filter."
- **VERDICT LAYER IS MISSING (the story break):** the page ranks but never *concludes*. There is no headline sentence ("Line X is the network's worst hotspot this week, N% severe"), no #1-callout, no comparison-to-network-baseline, no trend/"getting worse or better" signal. The `otp_delta_pts` field is fetched (schema `hotspots.ts:33`) and `deltaLost` copy exists (`hotspots.copy.ts:66,129,180`) but is **never rendered anywhere** — the "how much on-time is lost" verdict was designed and then dropped. So the reader gets *ranked evidence* but must draw the conclusion themselves.
- **Where the story stalls:**
  - **No narrative between context and evidence.** After the lede + hazard bar, the reader lands straight on the tabbed chart. There is no "here's the single worst spot" hero moment; the eye has to parse a lollipop chart to find the #1.
  - **Single-section monotony.** Unlike the lines/metrics surfaces (multi-section arcs with ToC), hotspots is one section. The `HotspotsBoard` header comment even documents the "per-city fork" — the design *expects* multiple sections eventually (a section per served city) but today degenerates to one, so there is no ToC, no scroll rhythm, no progressive disclosure.
  - **Tray-vs-ladder relationship is quiet.** The tray ("below the reliable-reading floor") is honest but sits at the bottom of each tab with a dashed border; a first-time reader may not connect why an entity they expected isn't ranked.
- **What is missing to read as a story:** a **lede-level verdict** (auto-generated worst-spot sentence), a **network baseline** to make "severe-delay rate" legible (is 8% bad?), a **direction of travel** (worse/better than the prior window), and **at least one more section** (e.g. worst *movers* / most-improved, or worst-by-time-of-day) so the scroll has an arc rather than one chart.

---

## (2) CHROME — headers, sticky elements, offsets

- **App chrome (from `+layout.svelte` + `AppShell.svelte`):**
  - `TopBar` — fixed 60px tall (`TopBar.svelte:273` `h-[60px]`), `shrink-0`, sibling ABOVE the scroll container, `z-40`. Spans full width.
  - `LeftRail` — desktop overlay (≥1024px) at `--app-rail-width-expanded: 16rem` (draggable 12–…rem), collapses to `4.85rem`; **mobile (<1024px) hidden entirely** (`AppShell.svelte:404-411,464-477`), TopBar burger owns nav. Map-stage padding-left offsets by `--app-left-rail-offset` (`AppShell.svelte:397-399`); hotspots (a document surface, not `.map-hero`) inherits this left inset on desktop.
  - The scroll container is `#main` (`+layout.svelte:480-484`) = `flex h-full w-full flex-col overflow-y-auto` — **document surfaces scroll here**, TopBar is OUTSIDE it. Footer renders at the natural bottom (`:503-509`).
- **Surface-local sticky element:** `SurfaceControls sticky` (`HotspotsBoard.svelte:258`) → `ControlsRail --sticky` → `position:sticky; top: var(--rail-sticky-top, 5.5rem)` **only at ≥1024px** (`ControlsRail.svelte:108-125`). On mobile the sticky offset is dropped (`ControlsRail` has no sticky rule below 1024px) — intentional (a sticky control bar would eat phone viewport).
- **`--chrome-offset`:** NOT used anywhere in this codebase (grep: 0 hits). The relevant knob is **`--rail-sticky-top`** (default `5.5rem` = 88px).
- **⚠️ STICKY-OFFSET FOOTGUN (confirmed):** hotspots does **NOT** set `--rail-sticky-top`. The `#main` scroll container already begins *below* the 60px TopBar (TopBar is a sibling, not inside the scroller). ControlsRail's own doc comment (`ControlsRail.svelte:117-122`) warns: a surface whose scroll container already begins below the app nav should set `--rail-sticky-top: 0` "so the rail pins FLUSH under the header — not floating ~88px below it with scrolling content showing through." The reliability dashboard does exactly this (`RouteReliabilityClusters.svelte:656` `--rail-sticky-top: 0px`). **Hotspots does not**, so on desktop the sticky grain rail parks ~88px down from the top of the viewport with content scrolling through the gap above it. This is a real, documented defect — but note it only fires when `present.size > 1` (the rail only renders with ≥2 populated grains).
- No other sticky/rail elements on this surface. No right-panel/detail overlay (hotspots is a plain document surface).

---

## (3) CONTAINERS — max-widths, grid, padding rhythm

- **Outer `Surface width="bleed"`** (`HotspotsBoard.svelte:232`): `max-width: none` (`Surface.svelte:26,43-44`) — full-bleed, no reading-measure cap at the Surface level. Gutter `padding-inline: var(--space-page-x)` = `clamp(1rem, 4vw, 5rem)` (`tokens.css:43`). Block padding `clamp(1.5rem, 4vw, 2.5rem)` (pad="surface"). Vertical gap between direct children `clamp(1.75rem, 4vw, 2.75rem)`.
- **Inner region cap:** `.hotspots-region { max-width: 76rem }` (`HotspotsBoard.svelte:288-293`) — so the *content* is capped at 76rem even though Surface is bleed. Note: `--container-content` is 64rem and `--container-wide` is 72rem (`tokens.css:88-89`); **76rem is a bespoke width larger than both design-token containers** — a one-off, not a token.
- **No CSS grid.** Everything is flexbox column: `.hotspots-region` (gap 1rem), `.hotspot-section` (gap 0.625rem), `.hotspot-tab-pane` (gap 0.625rem, padding-top 1rem).
- **Caveat/caption measure:** `.hotspots-caveat` and `.caption` cap at `max-width: 52ch` — good reading measure. Lede caps at 52ch (`SurfaceHeader.svelte:66`).
- **Chart container:** `ChartFrame` is `width:100%`, fluid (`ChartFrame.svelte:52,58-60`); height grows with row count `Math.max(3, rows.length) * 1.35 + 3` rem (`MagnitudeBarsMark.svelte:40`).
- **Padding rhythm:** consistent 0.625rem inter-element gaps in the section; heading-row `.hotspot-section-head` gap `0.5rem 1rem` with `flex-wrap` (`HotspotSection.svelte:227-233`). Tray block `margin-top .75rem; padding-top .75rem; border-top dashed`.

---

## (4) HEADINGS — hierarchy sanity

- **h1:** `SurfaceHeader` → `SectionHeading level=1` renders a real `<h1>` (`SectionHeading.svelte:34,level=1` passed at `HotspotsBoard.svelte:233`; SurfaceHeader default level=1 `SurfaceHeader.svelte:39`). Font `clamp(2.5rem,6vw,4rem)`. ✅ exactly one h1.
- **NO h2/h3/h4 ANYWHERE ON THE SURFACE.** Every sub-heading below the h1 is rendered by `SectionLabel`, which is a plain `<span>` (`SectionLabel.svelte:38`), NOT a heading element:
  - Ladder section heading "Worst spots · 10/42" → `SectionLabel variant="metric"` (`HotspotSection.svelte:140,161,205`) = `<span>`.
  - Tray heading "Below the reliable-reading floor" → `SectionLabel variant="metric"` (`:173`) = `<span>`.
  - The kicker "ACCOUNTABILITY · HOTSPOTS" → `SectionLabel variant="station"` = `<span>`.
- **The `<section>` regions ARE labelled** via `aria-label` (`HotspotsBoard.svelte:248` `aria-label={t.heading}`) so they are landmark-named, and the tabs carry proper ARIA via bits-ui. But **there is no heading-level structure below h1** — a screen-reader heading-navigation (H key) jumps from the page h1 straight to nothing. This is a genuine hierarchy gap: the ladder section and the tray deserve `h2`/`h3`.
- **Verdict:** no *skipped* levels in the classic sense (there's only h1), but the tree is **heading-starved** — the visual hierarchy (section labels, tray labels) is not reflected in semantic headings.

---

## (5) ABSENCE STATES

Absence is handled thoroughly and honestly — this is the surface's strongest axis:

- **Whole-file empty** (no grain populated at all): `isEmpty` (`HotspotsBoard.svelte:229`) → `AbsentValue variant="block" reason="no-observations"` centered (`:243-246`).
- **Pre-load states:** `ResourceBoundary` gates skeleton (loading) / `error-v1` (with retry) / generic empty (settled no data) — no bare nulls (`ResourceBoundary.svelte:97-121`).
- **Per-kind empty tab** (kind has tray rows but no ranked ladder): `AbsentValue variant="block" reason="no-observations"` (`HotspotSection.svelte:158-166`).
- **Whole-section empty** (grain served no ranked entry of EITHER kind — but tabs.length===0): `AbsentValue variant="block"` (`HotspotSection.svelte:202-210`).
- **Selector-level absence:** `selectHotspotLadder` returns an `{kind:'absence', reason:'no-observations'}` spec when `shown===0` (`hotspotLadder.ts:80-92`), and `Chart` routes it to `AbsentValue` (`Chart.svelte:41-48`).
- **Null value rows:** a null `severe_pct` row renders `value:null` → MagnitudeBars' own no-data swatch (`hotspotLadder.ts:100`; `MagnitudeBarsMark.svelte:30` `reals = rows.filter(value != null)` — null rows are excluded from bars but still listed in the sr-only table `:134-147`).
- **Per-row evidence null-guards:** `ladderNote()` null-guards each fragment (`HotspotsBoard.svelte:169-177`) — no `NaN`/`undefined` leaks.
- **Disabled grains:** unavailable grains are disabled (never hidden) in `SurfaceControls` with an aria-describedby reason (`SurfaceControls.svelte:151-174`). But note: `showGrainPicker` HIDES the whole rail when only one grain is populated (`:118`) — a deliberate dead-control removal, not an absence leak.
- **Bare-dash / null-leak scan:** none found. The em-dash/`—` idiom is not used raw; all missing values route through AbsentValue or are omitted from the note.

---

## (6) EXPLAINER LINKS — /metrics how-we-measure

- **YES — wired and valid.** The severe-rate column carries a `MetricInfo` (i) affordance (`HotspotSection.svelte:141-148`). Its VM is `severeInfo` (`HotspotsBoard.svelte:81`) = `info('severe', t.ladder.severeRateLabel)` → `metricInfoFor('severe', locale)` (`:77-80`). The metrics-content entry `key:'severe'` has `anchor:'severe'` (`metrics.content.ts:303-304`), so the deep link resolves to a real `/metrics#severe` (localized) — confirmed the anchor exists and matches. The link opens **in-app same-tab** (SPA, back-button friendly), not Notion/new-tab (`MetricInfo.svelte:32,306-312`).
- **Coverage gap:** ONLY the severe-delay-rate metric has an explainer. The per-row note also surfaces **avg delay (min)** and **n (observation count)** (`HotspotsBoard.svelte:172-176`) — neither has an (i) link, and the metrics catalogue *does* have an `avg-delay` anchor (`metrics.content.ts:195`). So `avg_delay_min`, shown as evidence, is unexplained here. Minor.
- The (i) popover is a hand-rolled focus popover (not bits-ui Tooltip) so the link is focusable/keyboard-reachable, edge-aware placement, Escape-dismiss — solid a11y (`MetricInfo.svelte` whole file).

---

## (7) MOBILE-390 READ FROM CODE

**Breakpoints in play:**
- Global `@media (min-width:1024px)` — the ONLY structural breakpoint. Below it: LeftRail hidden (burger nav), ControlsRail sticky rule dropped, ResourceBoundary edge density = `mobile`. At 390px everything is single-column flex.
- No surface-local media queries in hotspots files.

**Overflow risks at 390px:**
- **Chart (LOW risk):** `MagnitudeBarsMark` is `width:100%` fluid (LayerChart measures its container and fits) — it does NOT scroll horizontally; instead it compresses the value axis into the available width. The y-axis label gutter is clamped `min:96, max:216` px (`MagnitudeBarsMark.svelte:46`) with truncation matched to the gutter, so long stop names truncate on the tick (full name in tooltip + sr-table + drill). At 390px minus page gutter (~2rem) minus a 96px label gutter, the plot area is ~230px — usable but tight; ticks reduced to 4 (`:83`). No `ScrollFrame` is used here (that primitive exists for the wide 7×24 heatmap; the lollipop doesn't need it). Height grows with rows (up to 100 rows × 1.35rem) so a "show all" ladder can be very tall — the page scrolls, which is fine.
- **Grain rail chips (LOW):** `ControlsRail__body` and `GrainPicker` both `flex-wrap` (`ControlsRail.svelte:100-106`, `GrainPicker.svelte:130-137`) — chips reflow onto new rows, no overflow.
- **Section head (LOW):** `.hotspot-section-head` is `flex-wrap` with `justify-content: space-between` (`HotspotSection.svelte:227-233`) — the worst-N picker wraps below the label on narrow screens (documented intent, `:226`).
- **Tabs (LOW-MED):** `TabsList variant="line" class="w-full justify-start"`; station-tab has `min-width: max-content` (`HotspotSection.svelte:263`). With only 2 tabs (Line/Stop) at ~padding 0.5rem 1rem each, no overflow at 390px. If a city-loop is ever added, this could scroll.
- **Heading h1 (LOW):** `clamp(2.5rem,6vw,4rem)` — at 390px = ~2.5rem; letter-spacing -2px; "Hotspots"/"Points chauds" both fit.
- **MetricInfo popover (LOW):** `position:fixed`, edge-aware, `max-inline-size: min(18rem, calc(100vw - 16px))` (`MetricInfo.svelte:375`) — never overflows the viewport, flips/shifts to stay on screen.

**Touch-target sizes (from classes):**
- **GrainPicker chips (grain rail + worst-N): `min-height: 44px`** ✅ (`GrainPicker.svelte:146-152`, explicit WCAG 2.5.8 comment). Padding `0.4rem 0.8rem`.
- **Station tabs (route/stop):** padding `0.5rem 1rem` + `font-size var(--text-small)` + `gap .5rem`; height ≈ 0.5rem×2 + line-height ≈ ~34–36px — **BELOW 44px**. No explicit min-height. ⚠️ minor tap-target shortfall on the tab triggers.
- **Tray links:** `.hotspot-tray-link` is `inline-flex flex-wrap align-items:baseline` with `font-size var(--text-small)`, NO min-height/padding for touch — the link is just text-height (~18–20px). ⚠️ **below 44px** touch target; only a focus outline, no padding. This is the weakest touch affordance on the page.
- **MetricInfo (i) trigger:** `1.05rem × 1.05rem` ≈ 17px (`MetricInfo.svelte:331-332`) — **well below 44px**. ⚠️ tiny tap target (though it also opens on the row's hover group).
- **Chart rows (drill):** the whole band is the click target (`MagnitudeBarsMark.svelte:52-55,77`); row band height ≈ 1.35rem×0.58 (padding 0.42) ≈ still generous vertically across the row width — acceptable.

**Chart sizing strategy on small screens:** fluid-width compress (NOT horizontal scroll), reduced tick count, clamped label gutter with truncation, tooltip/sr-table hold the full data. Reasonable.

**Sticky behavior on mobile:** sticky is DROPPED below 1024px (ControlsRail sticky rule is inside `@media (min-width:1024px)`). So on a 390px phone the grain rail scrolls away with content — intended, no phone-viewport theft. (The desktop `--rail-sticky-top` gap bug from §2 does NOT affect mobile.)

**Overall mobile risk: LOW-MEDIUM.** Layout reflows cleanly (all flex-wrap, fluid chart, no horizontal overflow). The medium comes from **sub-44px touch targets** on tray links, tab triggers, and the (i) glyph — not layout breakage but a tap-comfort/WCAG-2.5.8 shortfall.

---

## (8) TOP 5 GAPS vs an A++ portfolio case-study page

1. **No verdict layer — the page ranks but never concludes.** There is no auto-generated headline ("Line 105 is the network's worst hotspot this week — 14% of readings severely late, ~3× the network median"), no #1 hero callout, no network baseline to make "severe-delay rate" legible. The designed `otp_delta_pts` evidence and the `deltaLost` copy (`hotspots.copy.ts:66,129,180`) are **fetched-and-dropped dead code** — the "on-time points lost" verdict was cut. A++ pages open with the answer, then show the ranked evidence. *Fix: render a lede-level worst-spot sentence + a network-median reference line/marker on the domain.*

2. **Single-section, no arc, no ToC, no direction-of-travel.** The surface is one ladder chart with a time filter — no progressive disclosure, no "worst movers / most-improved," no trend vs the prior window. The `HotspotsBoard` header even documents the intended multi-section (per-city) structure that today degenerates to one. Compared to the lines/metrics surfaces (multi-section + sticky ToC), hotspots has no scroll rhythm. *Fix: add ≥1 more section (e.g. biggest deteriorations, or worst-by-time-of-day) and a section ToC; add a per-row "▲ worse / ▼ better than last week" delta.*

3. **Heading hierarchy is starved (a11y + SEO).** Exactly one real heading (h1); every section/tray/tab label is a `<span>` (`SectionLabel`), so there is no `h2`/`h3` structure. Screen-reader heading nav finds nothing below the title; the doc outline is flat. *Fix: promote the ladder-section and tray labels to real headings (h2/h3), or give SectionLabel an `as`/`level` option and use it here.*

4. **Sub-44px touch targets + the desktop sticky-rail gap.** Tray links (text-height only, no padding), station tabs (~35px), and the (i) glyph (~17px) all miss WCAG 2.5.8's 44px. Separately, the sticky grain rail floats ~88px below the header on desktop because hotspots never sets `--rail-sticky-top: 0` (the exact footgun ControlsRail documents and the reliability dashboard fixes at `RouteReliabilityClusters.svelte:656`). *Fix: pad tray links + tabs to a 44px hit box; add `style="--rail-sticky-top:0"` (or `0px`) to the surface root / SurfaceControls.*

5. **Thin explainer coverage + no methodology visibility for supporting metrics.** Only `severe` has an (i) link; the avg-delay and sample-count evidence shown in every row note are unexplained even though `/metrics#avg-delay` exists. There's no inline "how we rank" (Wilson lower-bound, MIN_N=30 floor) affordance beyond the tray reason string and the bottom caveat — an A++ accountability page makes its ranking method one click away at the point of use. *Fix: add (i) links for avg-delay + n, and a short "how we rank" popover on the section heading (the Wilson-LB + MIN_N story).*

---

## Cross-references (exact anchors)

- Sticky footgun: `ControlsRail.svelte:117-122` (doc) vs `HotspotsBoard.svelte:258` (sticky, no override) vs `RouteReliabilityClusters.svelte:656` (the fix pattern).
- Dead verdict field: schema `apps/web/src/lib/v1/schemas/hotspots.ts:33` (`otp_delta_pts`), copy `hotspots.copy.ts:66,129,180` (`deltaLost`), NOT rendered in any `.svelte` (grep-confirmed).
- Heading gap: h1 at `SectionHeading.svelte:34`+`HotspotsBoard.svelte:233`; span-labels at `HotspotSection.svelte:140,161,173,205` via `SectionLabel.svelte:38`.
- Bespoke width: `.hotspots-region max-width:76rem` (`HotspotsBoard.svelte:292`) vs tokens `--container-content:64rem`/`--container-wide:72rem` (`tokens.css:88-89`).
- Touch targets: GrainPicker 44px ✅ (`GrainPicker.svelte:146-152`); station-tab ~35px (`HotspotSection.svelte:263`); tray link text-height (`HotspotSection.svelte:316-324`); (i) 1.05rem (`MetricInfo.svelte:331`).
