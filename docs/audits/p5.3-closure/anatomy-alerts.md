# Surface Anatomy — /alerts ("Avis" / Alert History)

Route: `apps/web/src/routes/[[lang=locale]]/alerts/+page.svelte`
Screen: `apps/web/src/lib/features/alerts/AlertHistory.svelte`
Analysis date: 2026-07-03 · READ-ONLY

---

## 0. Entry-point wiring

- **`+page.svelte`** (`apps/web/src/routes/[[lang=locale]]/alerts/+page.svelte:1-13`) — a *thin mount* by contract: imports and renders `<AlertHistory />`. No `+page.ts`, no `+layout.svelte` of its own. Locale comes from `getLocale()` context.
- **No route-scoped `+page.ts`/`+layout`.** The only layout in the ancestry is the root `apps/web/src/routes/+layout.svelte` + `+layout.ts` (boots the `/v1` snapshot context, provides locale, renders the `AppShell`). There is no `alerts/+layout.*`.
- **Data port:** `AlertHistory.svelte:76` — `createResource(() => getAlertHistory(), { freshness: true })`. Browser-only, daily-rebuilt archive (`generated_utc`, not live). No SSR data; the surface hydrates client-side.
- **Orchestrator shape:** `AlertHistory.svelte` is a "thin orchestrator" — owns the data port + a codec (URL seed → clamp → one batched `mirrorSearchParams`) + one mapping pass through pure selectors (`./selectors/alertLog`, `./selectors/entityOptions`), then hands each zone to a pure presenter. Three section presenters: `AlertFilters`, `AlertLog`, `AlertBreakdown`. All copy in `./alerts.copy.ts` (bilingual EN/FR).

---

## 1. SECTION ORDER + STORY ARC

Top-to-bottom, as rendered inside `<Surface width="bleed" class="alert-history">` (`AlertHistory.svelte:261-340`):

| # | Element | Component / source | Data source / selector | Reader's question |
|---|---------|--------------------|--------------------------|-------------------|
| 1 | **Surface header** — kicker `ALERTS · ARCHIVE`, h1 `Alerts`, mono subheading `// HISTORY`, lede, `FreshnessStamp` | `SurfaceHeader` + `FreshnessStamp variant="updated"` (`:262-264`) | copy `t.kicker/heading/subheading/lede`; `generatedUtc = history.data?.generated_utc` (`:209`) | "What is this page, and how fresh is it?" |
| — | Hazard separator | `Separator variant="hazard"` (`:266`) | — | visual divider |
| 2 | **In-window headline card** — big count + median-duration sublabel + `(i)` explainer | `ExplainedMetricCard` inside `.alert-history-headline` (`:277-286`) | `headlineCount = filtered.length` (`:197`); `headlineMedian = medianOf(durations)` (`:198-203`); `(i)` → `MetricInfo` snippet (`:251-259`) | "How many alerts match my current view, and how long did they last?" |
| — | Hazard separator | `Separator variant="hazard"` (`:288`) | — | divider |
| 3 | **Log section head** — `SectionLabel "Past alerts"` + capped-count caption + optional truncated note | `.alert-history-head` / `.alert-history-count` / `.alert-history-truncated` (`:291-303`) | `t.count(visibleRows.length, filtered.length)`; `truncated`/`totalInWindow` (`:215-216`) | "How many am I seeing of how many?" |
| 4 | **Filter rail** — entity-type + severity radiogroups, Line + Stop typeaheads, date range, clear | `AlertFilters` (`:305-318`) | binds `affects/severity/route/stop/pickedWindow`; `lineOptions/stopOptions` (`:177-178`); `availableDates` (`:107-109`) | "Let me narrow to the lines/stops/severity/dates I care about." |
| 5a | **No-match note** (mutually exclusive with 5b) | `.alert-history-no-match` (`:320-322`) | `!hasMatches` (`:166`) | "My filters matched nothing." |
| 5b | **Chronological alert log** — severity-coded cards + "+N more" | `AlertLog` (`:324-332`) | `visibleRows` = `visibleEntries.map(buildAlertRow(...))` (`:171-173`) | "What actually happened, newest first — window, duration, reach, impact, link." |
| — | Hazard separator | `Separator variant="hazard"` (`:337`) | — | divider |
| 6 | **Tier-2 breakdown** — By cause / By effect / By severity ranked distributions (or honest-absence chip) | `AlertBreakdown` (`:338`) | `causeRows/effectRows/severityRows` from `history.data?.breakdown?.*` (`:234-245`); `hasBreakdown` | "What kinds of disruptions dominate — cause, effect, severity mix?" |

All six live inside the `ResourceBoundary` (`:270-339`) except the header (1) and its separator, which render *above* the boundary so the page title + freshness show during load/error/empty.

### Story-arc assessment

**Verdict: it is a competent, honest *log with filters* — but it reads as a filterable data table, not a story. It states context (what) and shows evidence (the log + breakdown) but never delivers a verdict (so-what).**

- **Context → evidence → verdict is incomplete.** The header (context) and log/breakdown (evidence) are strong, but there is **no verdict layer**: nothing tells the reader "the network had a rough week" vs "a quiet one," no trend vs a prior period, no top-line synthesis sentence. The headline card is a *count*, not a *judgment*.
- **The headline card is the weakest hinge.** It answers "how many + median duration" — but that count is **filter-dependent** and moves as the reader toggles filters, so it can't anchor the page. On first load (no filters) it's just "N alerts, median X min" with no comparison, no baseline, no "is that a lot?" A portfolio page would open with a *stable, unfiltered verdict* (e.g. "12 disruptions this month, down from 19 — mostly short detours") and *then* let filters drill in.
- **The narrative stalls between the log and the breakdown.** The breakdown (cause/effect/severity mix) is the most analytical content on the page, yet it sits *last, below the fold, after a potentially 25+ item log*. The distribution that would help a reader *understand* the log is buried *beneath* it. Story order is inverted: evidence-detail before evidence-summary.
- **The filter is doing the story's job.** Because there's no verdict/trend, the only way to "get a story" is to actively filter — the page offloads sense-making onto the reader. That's a tool, not a case study.
- **Missing for a story read:**
  - A **trend/comparison** ("this window vs prior window" — more/fewer/longer alerts).
  - A **synthesis sentence** at the top ("Most alerts were short detours on the Green line").
  - **Severity-first framing** — the log is chronological only; a reader can't see "the worst disruption this month" without scrolling/filtering.
  - **Reach context** — "affected N lines / M stops" as a network-level headline, not per-row.
  - The breakdown **surfaced before or beside the log**, not after it.

---

## 2. CHROME

- **App-level chrome (root layout, not surface-owned):**
  - `TopBar` — `apps/web/src/lib/components/shell/TopBar.svelte:273` — `h-[60px]`, `relative z-40`, `border-b`, `bg-card`. This is the persistent app header. It is **not `position: sticky`** — it lives in the flex column above the scroll container; the `<main>` scroll region is `#main` in the root layout (`+layout.svelte:480-484`, `overflow-y-auto`). So the TopBar stays fixed because it's a flex sibling *outside* the scroller, not via sticky.
  - `LeftRail` — desktop nav overlay (≥1024px), width via `--app-left-rail-offset` (`AppShell.svelte:383-388`, expanded default `16rem`, collapsed `4.85rem`). Non-map surfaces (including /alerts) get `padding-left: var(--app-left-rail-offset)` on `<main>` (`AppShell.svelte:397-399`) so content clears the rail. Below 1024px the offset is `0px` and the burger owns nav.
  - `Footer` — rendered at the natural bottom of the scroll flow for non-full-bleed surfaces (`+layout.svelte:503-509`). /alerts is not full-bleed (`isFullBleed` is `/map` only, `+layout.svelte:112`).
- **Surface-owned sticky/rails: NONE.** The alerts surface has **zero sticky elements and no rail**. The filter panel (`AlertFilters` → `ControlsRail`) is rendered **non-sticky** — `AlertHistory` calls `<AlertFilters>` which renders `<ControlsRail label=...>` with **no `sticky` prop** (`AlertFilters.svelte:79`), so `ControlsRail`'s `sticky` defaults `false` (`ControlsRail.svelte:50`). The filters scroll away with the content.
- **`--chrome-offset` usage: NONE on this surface.** No `--chrome-offset` anywhere in the alerts feature. The only sticky-offset token in the codebase family is `ControlsRail`'s `--rail-sticky-top` (default `5.5rem`, `ControlsRail.svelte:122`) and `RailLayout`'s `top:5.5rem` — **neither is engaged here** because the surface uses no sticky rail. So on a long log the reader loses the filters entirely on scroll (see §8 gap).
- **Separators:** three `Separator variant="hazard"` (yellow/black safety-tape motif, `separator.svelte:2,34`) at `:266, :288, :337` — brand chrome, not data.

---

## 3. CONTAINERS

- **Root:** `<Surface width="bleed" pad="surface" gutter=true>` (`AlertHistory.svelte:261`).
  - `width="bleed"` ⇒ `--surface-maxw: none` (`Surface.svelte:26`) — the surface is **full content-width, uncapped**. It fills the rail-inset `<main>` box edge-to-edge.
  - `gutter` ⇒ `padding-inline: var(--space-page-x)` = `clamp(1rem, 4vw, 5rem)` (`tokens.css:43`).
  - `pad="surface"` ⇒ `padding-block: clamp(1.5rem, 4vw, 2.5rem)` (`Surface.svelte:53-55`).
  - Vertical rhythm between top-level children: `gap: clamp(1.75rem, 4vw, 2.75rem)` (`Surface.svelte:48`).
- **Content measure caps (the only reading-width discipline):**
  - **AlertLog list** — `max-width: 52rem` (`AlertLog.svelte:158-159`). This is the *only* place the log text is capped to a reading measure. Because the Surface is `bleed` (uncapped), on a wide desktop the header/lede, the headline card, the filter rail, and the breakdown all stretch the **full rail-inset width** (could be well over `--container-content` 64rem), while the log alone stops at 52rem — an **inconsistent measure** down the page.
  - **SurfaceHeader lede** — `max-width: 52ch` (`SurfaceHeader.svelte:66`). Good.
- **Grid templates:**
  - **Breakdown** — `DashboardGrid minTile="240px" gutter={false}` (`AlertBreakdown.svelte:38`) ⇒ `repeat(auto-fit, minmax(240px, 1fr))`. The three distribution tiles reflow 3-up → 2-up → 1-up purely by container width, no breakpoints. Each tile `.alert-history-dist` is a bordered `--card` box, `padding: 1rem`.
  - **Headline card** — `ExplainedMetricCard` uses an internal **container query** (`@container (min-width: 23rem)`, `ExplainedMetricCard.svelte:152-158`) to flip figure|explanation 2-up. On /alerts it is a single card at full width, so it's always in 2-up mode on desktop.
  - **Filter rail body** — `ControlsRail__body` is `display:flex; flex-wrap:wrap; gap:0.625rem` (`ControlsRail.svelte:100-106`). Each picker `.alert-history-pick` is `flex: 1 1 16rem` (`AlertFilters.svelte:131`) — grows/wraps.
  - **Log meta** — `.alert-history-meta` is `display:flex; flex-wrap:wrap; gap:0.3rem 0.7rem` (`AlertLog.svelte:211-216`).
- **Padding rhythm:** card paddings vary — headline card `1.1rem 1.25rem`, breakdown tile `1rem`, ControlsRail `1rem`, log row `0.6rem 0.7rem 0.6rem 0.9rem`. Block gaps: `.alert-history-block gap:0.75rem` (`:346-350`, `AlertBreakdown.svelte:97`), log list `gap:0.5rem`. Reasonably consistent but not on a single spacing scale.

---

## 4. HEADINGS — hierarchy sanity

**This is a real defect.** The page has **exactly one semantic heading: the h1**.

- `SurfaceHeader` renders `SectionHeading level=1` → an `<h1>` "Alerts" (`SurfaceHeader.svelte:47`, `SectionHeading.svelte:36-37`, default from SurfaceHeader `level=1`).
- **Every other "heading" on the page is a `<span>`, not a heading element:**
  - `SectionLabel text="Past alerts" variant="station"` (`AlertHistory.svelte:292`) → renders a `<span>` (`SectionLabel.svelte:38`).
  - `SectionLabel text="Breakdown"` (`AlertBreakdown.svelte:32`) → `<span>`.
  - `SectionLabel text="By cause" / "By effect" / "By severity" variant="metric"` (`AlertBreakdown.svelte:41,58,75`) → `<span>`s.
  - The `ExplainedMetricCard` label "Alerts in window" is a `MetricDisplay` label (a styled `<span>`/`div`, not a heading).
- **Net hierarchy:** `h1` → (nothing). There are **no h2/h3** at all. The document outline is a single node with visually-styled but semantically-flat spans beneath it. For a screen-reader user navigating by heading, the page is one undifferentiated block after the title — "Past alerts", "Breakdown", "By cause/effect/severity" are invisible to heading navigation.
- **No skipped levels** (there's only h1), but that's because levels 2–4 are *missing entirely* where they're visually implied. The `SurfaceHeader` and `SectionHeading` both accept a `level` prop and `AlertBreakdown`/log heads *should* pass `<h2>`/`<h3>` (or use a heading-rendering label). They don't.

**Verdict: heading structure is broken for a11y — one h1 and no sub-headings, despite three clearly-titled sections.**

---

## 5. ABSENCE STATES

The surface is thorough on honest absence — this is a strength. Inventory:

1. **Whole-archive empty (the GOOD empty)** — `ResourceBoundary ... isEmpty={d => (d.alerts?.length ?? 0)===0} emptyVariant="empty-avis"` (`AlertHistory.svelte:270-275`). Zero alerts ⇒ green "network is running normally, no disruptions reported" verdict (`EdgeState.svelte:152-161`, glyph `●` on `--dataviz-status-on-time`). Excellent — a zero-length log reads as a positive, not a grey void.
2. **Load / error** — `ResourceBoundary` renders `EdgeState` skeleton (loading) and `error-v1` with retry (`ResourceBoundary.svelte:99-108`). Density tracks the shell breakpoint.
3. **No-match after filtering** — `.alert-history-no-match` mono caption "No alerts match the selected filters." (`AlertHistory.svelte:320-322`, copy `t.filters.noMatch`). Never a blank void or `·`.
4. **No published breakdown** — `AlertBreakdown` renders `<AbsentValue variant="block" reason="no-observations">` when `!hasBreakdown` (`AlertBreakdown.svelte:33-36`) — the styled honest-absence chip, calm unknown tone, not a silent vanish.
5. **Empty date coverage** — `DateRangePicker` renders `<AbsentValue variant="block">` when `availableDates` empty (`DateRangePicker.svelte:202-204`); the whole date control hides behind honest absence rather than a dead control.
6. **Per-row nulls are OMITTED, not faked** — `AlertLog` guards every meta field with `{#if}` (`AlertLog.svelte:89-112`): duration, routes, stops, impact, url, window bounds each render only when present. A null field simply doesn't appear (the documented "null is omitted, never a fabricated 0" rule).
7. **Truncated window** — honest cap note `t.truncatedNote(entries.length, totalInWindow)` (`AlertHistory.svelte:298-303`) when `history.data.truncated===true`.
8. **windowTime middot guard** — `windowTime()` drops `formatUtc`'s no-data `·` so a bad ISO never leaks a bare middot (`AlertHistory.svelte:150-154`).

**Bare-dash / null leaks: none found in the alerts feature.** The one place a `·` appears as literal text is the multi-window list separator (`AlertLog.svelte:66`, between From and Until) and the breakdown/route joiners (`' · '`) — those are intentional glyph separators between *present* values, not absence markers.

**Caveat (minor):** in the multi-window list (`AlertLog.svelte:62-70`) a period with `from` but no `until` (or vice-versa) renders just the one bound with no "ongoing"/"open" label — honest (omits the absent bound) but slightly ambiguous to a reader ("From 08:00" with nothing after).

---

## 6. EXPLAINER LINKS — does the metric link to its /metrics how-we-measure entry?

**This is the sharpest content gap on the page.**

- The **only** explainer affordance is the headline card's `(i)` → `MetricInfo` (`AlertHistory.svelte:251-259`). Its `href` is:
  ```
  href={`/${locale === 'fr' ? 'fr/' : ''}metrics`}   // AlertHistory.svelte:254
  ```
  — **bare `/metrics`, no `#anchor`.** It dumps the reader at the *top* of a long metrics explainer page.
- **Worse: there is no alerts entry on /metrics to land on.** The alert metric content (`alertCause`, `alertEffect`, `alertSeverity`, `alertDuration`, `alertReach`) IS authored in `lib/features/metrics/metrics.content.ts:1178-1210`, but the file's own comment says they are **"deliberately left out — they render on the /status page"** (`metrics.content.ts:1056-1057`). They are **not** in `orderedMetrics`, so `MetricsExplainer` never renders an anchored `#alert-*` section. So the reader who clicks "How this is measured" for the alerts count:
  1. leaves for `/metrics`,
  2. lands at the page top (no anchor),
  3. and finds **no alerts explainer there at all**.
- **The anchor pattern demonstrably exists and works elsewhere** — other surfaces deep-link correctly: `/metrics#otp`, `/metrics#occupancy` (`Section3RunAndFit.svelte:280`), `/metrics#live-positions`, `/metrics#avg-delay` (`metrics.content.test.ts`). MetricsExplainer renders each metric at `id={entry.anchor}` (`MetricsExplainer.svelte:189, 620`). The alerts page is the odd one out.
- **The `(i)` tip text itself is fine** (`t.headline.tip` — "The count of distinct alerts whose active window overlaps the chosen range"), and `linkLabel` is "How this is measured." But the link's *destination* is a dead end.
- **No other metric on the page has an explainer.** The log's per-row fields (duration, "Passages affected (est.)", reach, severity) and the entire breakdown (cause/effect/severity) carry **no `(i)` affordance and no /metrics link** — despite "Passages affected (est.)" being an estimate that begs a methodology link, and despite the alert cause/effect/severity content existing in `metrics.content.ts`.

**Verdict: the single explainer link is effectively broken (no anchor + no target section), and most metrics on the page have no explainer at all.**

---

## 7. MOBILE-390 READ (from code)

The alerts feature ships **zero media queries and zero `min-width` breakpoints of its own** (grep of `lib/features/alerts/` returns only `min-width:0` overflow guards). All responsive behavior is inherited from primitives. Reading the inherited behavior at a 390px viewport:

- **Breakpoints in play (all inherited):**
  - App shell desktop/mobile split at `min-width:1024px` (`AppShell.svelte:464`). At 390px: LeftRail hidden, `--app-left-rail-offset:0`, burger nav, `<main>` full width.
  - `ExplainedMetricCard` internal **container query** `@container (min-width:23rem)` (`ExplainedMetricCard.svelte:152`). 23rem = 368px. At a 390px viewport minus page gutter (`clamp(1rem,4vw,5rem)` ≈ 16px each side ⇒ ~358px content), the card container is **~358px < 368px**, so the headline card **stacks single-column** (figure over explanation) on a 390 phone — good, no cramped 2-up.
  - `DashboardGrid minTile="240px"`: at ~358px content it renders **1 column** — the three breakdown distributions stack. Good.
- **Elements at risk of overflow at 390px:**
  - **Alert URL links** — `.alert-history-link a` uses `word-break: break-all` (`AlertLog.svelte:271`), so long hostnames wrap rather than overflow. Safe.
  - **AbsentValue inline** wraps (`AbsentValue.svelte:97-99` `flex-wrap:wrap`, `overflow-wrap:anywhere`). Safe.
  - **Log meta rows** flex-wrap (`AlertLog.svelte:211`). Safe.
  - **Filter rail** — the `.alert-history-pick` items are `flex:1 1 16rem` (`AlertFilters.svelte:131`). 16rem = 256px basis; at ~358px content they wrap to **one picker per row** — five stacked controls (entity radiogroup, severity radiogroup, Line, Stop, date range, clear). Functional but **tall**: the filter panel alone will consume a large fraction of the phone viewport before any log is visible.
  - **Severity radiogroup** — `severitySegments` = All + critical/high/watch = 4 chips; entity = 3 chips. `GrainPicker` is `inline-flex; flex-wrap:wrap` (`GrainPicker.svelte:130`). At narrow width the 4-chip severity group may wrap to 2 rows. Acceptable.
  - **The MetricInfo popover** is `position:fixed` with viewport-edge clamping + flip (`MetricInfo.svelte:85-153`, `max-inline-size: min(18rem, calc(100vw - 16px))`). Handles 390px correctly — repositions, never overflows.
- **Touch-target sizes (from classes/CSS):**
  - `GrainPicker` segments: **`min-height:44px`** (`GrainPicker.svelte:146-148`) — WCAG 2.5.8 compliant. ✅ (both entity + severity radiogroups)
  - `DateRangePicker` selects + clear: **`min-height:44px`** (`DateRangePicker.svelte:300, 316`). ✅
  - `AlertLog` "+N more" / `AlertFilters` "Clear filters" / `AlertLog` external link: these are **text links with `padding:0.15rem 0`** (`AlertLog.svelte:290`, `AlertFilters.svelte:152`) — effective height ≈ `text-small` line + 0.3rem ≈ **~24-26px, BELOW the 44px floor**. ⚠️ Under-sized touch targets.
  - **`LineCombobox` (Line + Stop typeaheads): input `padding:0.5rem …; line-height:1.4` on `--text-small`** (`line-combobox.svelte:194-206`) ⇒ trigger height ≈ **~34px, below 44px**. Its clear + trigger buttons are **`1.75rem` (28px) square** (`line-combobox.svelte:210`) — **well below 44px**. ⚠️ The two most-used pickers on the surface miss the touch floor, and their inline clear/dropdown buttons are 28px.
- **Chart sizing on small screens:** no charts — the only "viz" is `RankedRow`'s `SeverityBar` (a horizontal magnitude bar) inside the breakdown tiles. Bars are width-fluid (fill the 1-column tile), no fixed pixel width, so they scale down cleanly. No canvas/SVG chart to reflow.
- **Sticky behavior on mobile:** none. `ControlsRail` explicitly drops its (unused-here) sticky offset below 1024px anyway (`ControlsRail.svelte:14, 108`). So on a 390 phone the filter panel scrolls away above the log — the reader who scrolls into a long log cannot re-filter without scrolling back to the top.

**Mobile risk level: LOW–MEDIUM.** No horizontal-overflow risk (everything wraps; measures are fluid). The real mobile debts are (a) **sub-44px touch targets** on the Line/Stop comboboxes (input ~34px + 28px clear/trigger buttons) and on the text-link controls, and (b) a **tall, non-sticky filter stack** that pushes the actual log far down the first screen and vanishes on scroll.

---

## 8. TOP 5 gaps vs an A++ portfolio case-study page

1. **No verdict / no trend — the page is a filterable log, not a narrative.** There is no top-line synthesis ("12 disruptions this window, down from 19 — mostly short detours on the Green line") and no comparison to a prior window. Context (header) and evidence (log + breakdown) are present; the *so-what* verdict layer is entirely missing. The headline card is a filter-dependent *count*, so it can't even serve as a stable anchor. **Fix:** add an unfiltered top-line verdict + a window-over-window delta, and let filters drill *below* it.

2. **The explainer link is a dead end, and most metrics have no explainer.** The lone `(i)` links to bare `/metrics` with no `#anchor`, and the alert methodology (`alertCause/effect/severity/duration/reach`) is *deliberately excluded* from `/metrics` (`metrics.content.ts:1056-1057`) — so it lands nowhere useful. Meanwhile the per-row "Passages affected (est.)", duration, reach, and the whole cause/effect/severity breakdown carry no explainer at all. Every peer surface deep-links (`/metrics#otp`, `#occupancy`, …). **Fix:** publish an anchored alerts explainer on /metrics and point `(i)` at `/metrics#alerts`; add `(i)` to the estimate + breakdown.

3. **Broken heading hierarchy — one h1, zero sub-headings.** "Past alerts", "Breakdown", "By cause/effect/severity" are all `<span>`s via `SectionLabel` (`SectionLabel.svelte:38`). A screen-reader heading walk finds only the title; the document outline is flat. **Fix:** render the section labels as real `<h2>`/`<h3>` (both `SectionHeading` and the section heads accept a `level`).

4. **Story order is inverted + measure is inconsistent.** The analytical *summary* (cause/effect/severity distribution) sits **last, below a 25-item log**, when it should frame or sit beside the log. And because `Surface width="bleed"` is uncapped, the header/headline/filters/breakdown stretch full rail-inset width while only the log caps at `52rem` (`AlertLog.svelte:158`) — the reading measure jumps around down the page. **Fix:** move/mirror the breakdown above or beside the log; give the whole surface a consistent content measure (or cap at `--container-content`).

5. **Filters aren't sticky + under-sized touch targets undercut the tool.** The filter rail is the page's primary interaction, yet it is non-sticky (`AlertFilters` never passes `sticky` to `ControlsRail`) — on a long log or on mobile it scrolls away and can't be re-reached without scrolling to the top. The Line/Stop comboboxes (~34px input, 28px clear/trigger) and the text-link controls miss the 44px touch floor. **Fix:** make the filter rail a sticky rail (`ControlsRail sticky` + a `RailLayout`, or a sticky wrapper with `--rail-sticky-top` set to the 60px TopBar), and raise the combobox/link controls to 44px.

---

## Appendix — files read

- `apps/web/src/routes/[[lang=locale]]/alerts/+page.svelte`
- `apps/web/src/routes/+layout.svelte`
- `apps/web/src/lib/features/alerts/AlertHistory.svelte`
- `apps/web/src/lib/features/alerts/sections/{AlertFilters,AlertLog,AlertBreakdown}.svelte`
- `apps/web/src/lib/features/alerts/alerts.copy.ts`
- `apps/web/src/lib/features/metrics/MetricInfo.svelte`
- `apps/web/src/lib/components/layout/{Surface,ControlsRail,DashboardGrid}.svelte`
- `apps/web/src/lib/components/surface/{SurfaceHeader,GrainPicker,DateRangePicker,ResourceBoundary}.svelte`
- `apps/web/src/lib/components/shell/{AppShell,TopBar}.svelte`
- `apps/web/src/lib/components/dataviz/{ExplainedMetricCard,RankedRow}.svelte`
- `apps/web/src/lib/components/edge/AbsentValue.svelte`
- `apps/web/src/lib/components/brand/{SectionHeading,SectionLabel}.svelte`
- `apps/web/src/lib/components/ui/{separator,line-combobox}/*.svelte`
- `apps/web/src/lib/features/metrics/{metrics.content.ts,MetricsExplainer.svelte}` (anchor/target verification)
- `apps/web/src/lib/styles/tokens.css`, `apps/web/src/app.css` (container/gutter tokens)
