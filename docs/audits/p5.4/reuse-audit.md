# P5.4 REUSE AUDIT — transit ⇄ yesid.dev

READ-ONLY audit. Goal: actually REUSE yesid components instead of hand-rolling lookalikes that drift, and unify the page-header family across all surfaces except metrics + status (which adopt the yesid `projects/[slug]` detail architecture).

## 0. THE STRUCTURAL FACT THAT REFRAMES EVERYTHING

The shared design repo `@yesid/{tokens,motion,gates}` (vendored at `apps/web/vendor/design`) ships **ZERO Svelte components** — only design tokens, motion actions, and gate logic.

- `packages/motion/package.json` exports `./actions`, `./policy`, `./tokens`, `./stores/reducedMotion`, `./utils/*` — all `.ts`.
- `packages/gates/package.json` exports `./presets/yesid` + `./presets/transit` — `.ts`.
- `find packages -name '*.svelte'` → **0 files**.

Therefore **every shared *component* is currently a COPY-FORK** between `yesid.dev/apps/web/src/lib/components` and `transit/apps/web/src/lib/components`: `StatusDot`, `TerminalChrome`/`TerminalPanel`, `TocNav`, `TocPill`, `TocBadge`, `CollapsibleSection`, `SectionHeading`, `SectionLabel`, `MetricDisplay`, `CornerMarks`, `ChevronToggle`, `StopLabel`, `MetroStation`, the whole `ui/` shadcn set, and `SectionIcon`. Several have ALREADY drifted:

- `shared/TocNav.svelte` — transit ≠ yesid (differ).
- `shared/CollapsibleSection.svelte` — transit ≠ yesid (differ).
- `brand/SectionHeading.svelte` — transit heavily extended (overline mode, NumberedChip, explainer slot, LAW doc) vs yesid's minimal version.
- `ui/card/card.svelte` — transit added `interactive` prop + `card-surface` class.

**Consequence for the whole audit:** "PROMOTE-TO-DESIGN-REPO-v0.4.0" is not a matter of moving one file — it means **standing up a `@yesid/ui` Svelte-component package (v0.4.0) that does not exist yet**, then having BOTH apps consume it. That is the real backbone deliverable P5.4 is circling. Until that package exists, every "reuse" is really "re-sync a fork," and forks drift (proven above). The TerminalPanel dots the operator flagged are a *symptom of fork drift*, not a one-off.

Recommended v0.4.0 package split:
- `@yesid/ui-primitives` — the `ui/` shadcn set + `StatusDot`, `SectionIcon`, `CornerMarks`, `ChevronToggle` (pure, token-driven, app-agnostic).
- `@yesid/ui-brand` — `TerminalChrome`, `SectionHeading`, `SectionLabel`, `MetricDisplay`, `StopLabel`, `MetroStation`.
- `@yesid/ui-detail` — the detail-page *system*: `DetailShell` (full-bleed header + hazard sep + 3-col grid + mobile pill + CtaBand orchestration), `TocNav`, `TocPill`, `TocBadge`, `CollapsibleSection`, `toc.ts`.

---

## 1. TERMINAL PANEL — verdict: **BUILD-LOCAL-FROM-PRIMITIVES** (drop dots) · panel core → PROMOTE

### What yesid actually does
`yesid.dev .../brand/TerminalChrome.svelte:52-81` renders a titlebar with a **three-aspect SIGNAL HEAD**, not macOS traffic-light dots:
```
<span data-slot="signal-head" aria-hidden="true">
  <StatusDot color="green" pulse size="sm" />
  <StatusDot color="caution" size="sm" class="opacity-25" />
  <StatusDot color="stop" size="sm" class="opacity-25" />
</span>
```
i.e. **one lit green (proceed, pulsing) + caution + stop at 25% opacity** — a single "proceed" lamp with two dimmed aspects. The header comment (`GO2-W5`) explicitly says this *replaced* an earlier single-orange-dot and is a railway signal head, NOT window chrome. `StatusDot.svelte:36-42` colors: green=`--signal-proceed`, caution=`--signal-caution`, stop=`--signal-stop`.

Real yesid usages: `home/CloserTerminalBoard`, `cms/blocks/CodeBlock`, `contact/ContactPage`, `about/AboutCta` — only 4, all decorative/board contexts.

### What transit does
`transit .../brand/TerminalPanel.svelte:80-97` renders the **IDENTICAL** three-aspect signal head (same green-pulse + caution/stop @ opacity-25). Transit's TerminalPanel is otherwise a faithful superset (absorbed TerminalChrome; adds `footerItems`, `noGlow`, cursorGlow rest-glow, occlusion-law solid `--surface-2`). It is used far more heavily than yesid's (11 surfaces incl. HealthStatus, receipt sections, NetworkSurface, StopDetail, home).

### The drift the operator saw
The two components render the same markup, so the complaint "traffic-light dots = reimplementation drift" resolves to one of:
1. **Perceptual drift** — three colored dots (even with two dimmed) read as macOS window chrome / a stoplight to a first-time viewer, especially at `size="sm"` where the 25%-opacity dims are barely visible. On transit's dense data surfaces they add nothing and cost brand clarity.
2. **Fork drift risk** — because TerminalChrome and TerminalPanel are independent copies, any future signal-head change on one silently diverges.

### Corrected spec (transit TerminalPanel titlebar)
- **DROP the 3-dot signal head entirely** on transit. Keep the titlebar as: `border-rule` framed chassis + **mono `--text-micro` title** (`.terminal-title`) + optional tag + right `meta`/`status` slot. Keep the hazard `Separator` rule under the titlebar, the body, and the mono footer readout. This preserves the "control-room framed panel" idiom (border-rule + mono title + footer stats) without the stoplight.
- If a live/heartbeat cue is wanted, use ONE `StatusDot color="green" pulse` (a single proceed lamp) — never the 3-dot cluster — and only where a live signal is meaningful (feed-fresh panels), not on every static panel.
- **Promote the panel core**: the framed-panel chassis (border-rule frame, radius-lg, solid surface, hazard-rule titlebar, mono title + footer) is a genuine shareable primitive → put a `TerminalChrome` in `@yesid/ui-brand` v0.4.0 with the signal head as an *opt-in* prop (`signalHead?: boolean`, default **false**), so yesid can keep it and transit omits it. Both apps then consume ONE component; the dot decision becomes a prop, not a fork.

---

## 2. PAGE HEADER SYSTEM — verdict: **BUILD-LOCAL header family + PROMOTE the header primitive**

### yesid header DNA
Three tiers, all sharing tokens + the dot-grid schematic:
- **Home hero / Manifesto** — full-bleed circuit/dot grid, CornerMarks, edge mono-metadata (upright, not rotated), centered kicker→title→lede→pills.
- **Detail header** (`projects/ProjectDetailHeader.svelte`, `blog/BlogDetailHeader.svelte`) — full-bleed `.detail-header-grid` dot-grid extending behind the nav (`margin-top: -nav-clearance; padding-top: nav-clearance`, `:152-165`), CornerMarks + chevrons + crosshair decorations, absolute **upright mono edge-metadata** columns (`edge-left` PRJ/SRC/ENV/VER/STATUS + metrics; `edge-right` LAYER/stack/NODES, `:93-114`), centered back-link → `h1` display title (with `text-shadow` glow) → subtitle lede → tech pills → QuietModeButton.
- **Section heads** (in-page) — `brand/SectionHeading` + `SectionLabel` overline.

Key DNA points: kicker/overline (mono, `--tracking-eyebrow`), **display title + trailing dot / glow**, capped lede, mono meta row, and an **edge-to-edge hazard `Separator`** as the closing rule under the header.

### transit today — TWO competing head systems
1. `surface/SurfaceHeader.svelte` — kicker (`SectionLabel variant="station"`) + `SectionHeading dot` + lede. Used on **14 surfaces** (lines, stops, network, hotspots, alerts, search, repeat-offenders, receipt, trips, EntityDetail, metrics layout…). This is the de-facto standard head.
2. `layout/ArticleShell.svelte` (P5.3b) — kicker → SectionHeading+dot → lede → mono meta → hazard tape → content. A *masthead* variant. Barely wired (Surface, SectionProgress, HealthStatus, MetricsExplainer references only).

Plus `layout/DetailTemplate.svelte` owns a `head` slot but no head content. So transit has SurfaceHeader (the real one) + ArticleShell (a near-duplicate masthead) + the full-bleed `.detail-header-grid` band hand-inlined inside `MetricsExplainer`. Three ways to draw a head.

### ONE consistent transit header family (spec)
Adopt a single **`SurfaceMasthead`** used by ALL non-metrics/status surfaces:
> **kicker/overline** (mono, station-voice, `--tracking-eyebrow`, `--accent`) · **display title + orange dot** (`SectionHeading dot`, real `h1`) · **lede** (muted, ≤52ch) · **meta row** (mono micro: provider · window · generated_utc) · closed by an **edge-to-edge hazard `Separator`** — the tape rhythm that already ends yesid detail heads.

This is essentially `SurfaceHeader` + ArticleShell's `meta` row + the mandatory closing hazard tape, merged. **Retire ArticleShell** (fold its `meta`/`tape` into the merged head) so there is ONE head. metrics + status do NOT use this — they use the **full-bleed detail header** (§3).

### Promotion
The head primitive (kicker/title-dot/lede/meta/tape) is brand-shared → **PROMOTE to `@yesid/ui-brand` v0.4.0** as `Masthead`, tokenized, so yesid's SectionHeading-based heads and transit's surface heads are one component. The full-bleed *detail* header (dot-grid band + edge metadata) belongs in `@yesid/ui-detail` (§3).

---

## 3. DETAIL TEMPLATE — verdict: **PROMOTE a real `DetailShell` system; transit's DetailTemplate is a hollow lookalike**

### yesid architecture (read EXACTLY)
`projects/ProjectDetailPage.svelte` and `blog/BlogDetailPage.svelte` are the SAME architecture, and — critically — **neither uses a shared shell component; each hardcodes the identical grid CSS**:
- `<article>` → full-bleed `*DetailHeader` → **`<Separator variant="hazard">`** (edge-to-edge) → **3-col CSS grid** → mobile `ProjectGlancePanel`/`BlogEntryRail` → `CtaBand` → floating **`TocPill`**.
- Grid: `ProjectDetailPage.svelte:595-605` `grid-template-columns: 1fr 2fr 1fr` at ≥1024px, `gap:2rem`; left `.toc-column` (sticky `TocNav` at `top:5rem` + gallery/links stacks), center `.sections-column` (`CollapsibleSection` per section, `open`, `data-section-index`, prose lane `--text-detail-body-*`), right `.glance-column` (`ProjectGlancePanel`). Blog variant: `body-grid:329-365` `minmax(12rem,1fr) minmax(0,46rem) minmax(12rem,1fr)`, sticky context rail `top:5rem`.
- Both share: `observeActiveToc` single IntersectionObserver feeding TocNav + TocPill; locale-stable heading ids for scroll-restore; `scrollChain` on the rail; README/mermaid handling (projects only).

**So yesid ITSELF has a promote-worthy duplication** (ProjectDetailPage ≈ BlogDetailPage, copy-pasted grid + ToC wiring). This is the strongest PROMOTE candidate in the whole audit: one `DetailShell` would DRY *three* consumers across two apps (yesid projects, yesid blog, transit metrics+status).

### transit today
- `layout/DetailTemplate.svelte` — a thin `head/left/center/right/mobileSummary` grid shell. `1fr 2fr 1fr` at **1280px** (yesid uses 1024px), sticky rails at `top:var(--chrome-offset)`. It has NO header band, NO hazard separator, NO ToC wiring, NO CtaBand, NO mobile pill — it's just the grid box. **Not wired to any page** (grep: only Surface/SectionProgress/HealthStatus/MetricsExplainer *reference* it, none render the metrics/status detail through it).
- `features/metrics/MetricsExplainer.svelte` — hand-inlines the ENTIRE yesid detail architecture (its 50-line header comment even says "built 1:1 on the yesid.dev blog/project detail-page shell… we are one brand, not lookalikes"): full-bleed `.detail-header-grid` band + `SurfaceHeader` + hazard `Separator` + `.body-grid` 2-col (`minmax(13rem,17rem) | minmax(0,1fr)`) + sticky `TocNav` + per-metric `CollapsibleSection` + `TocPill`. It is a faithful hand-port with **hardcoded** grid CSS living in the feature, not a shell.

### Faithful port for metrics + status
Build/adopt **one `DetailShell`** (promote to `@yesid/ui-detail` v0.4.0) with slots `header · left(Toc) · center(sections) · right(rail) · mobileSummary`, owning: full-bleed header band + edge hazard `Separator` + 3-col grid (`1fr 2fr 1fr`, or 2-col when no right rail) + sticky rails at `top:var(--chrome-offset)` + `observeActiveToc` + `TocPill` + optional `CtaBand`. Then:
- **metrics** = DetailShell(header=full-bleed detail header, left=metrics ToC, center=per-metric CollapsibleSections, right=Provenance/Coverage/Freshness). Delete the inlined grid from MetricsExplainer.
- **status** = DetailShell(left=lanes ToC, center=pipeline lanes, right=per-feed stat cards).
- yesid projects + blog re-platform onto the same `DetailShell` (kills their copy-paste). **This is the "one detail system both apps consume."**
- **DELETE transit `DetailTemplate.svelte` + `ArticleShell.svelte`** — superseded by DetailShell + Masthead.

---

## 4. CARDS / CHIPS / BADGES — verdict: **PROMOTE `ui/` set; low drift but forked**

- `ui/card/card.svelte` — transit forked yesid's and added `size='sm'` support + `interactive` prop + `card-surface` class + the E1 glow map (`:11-21,28-32`). Defensible local extension, but it's a *fork* → will drift. Fold into `@yesid/ui-primitives` with `interactive` as a shared prop.
- `ui/badge`, `ui/toggle`, `ui/tabs`, `ui/separator`, `ui/collapsible`, `ui/scroll-area`, `ui/resizable`, `ui/toggle-group` — all present in BOTH apps as forks. yesid's `ui/` set is the same shadcn base. **PROMOTE the whole `ui/` set to `@yesid/ui-primitives`.**
- Chips/pills: transit's tech-pill / tag idiom (`.header__pill` style in yesid `ProjectDetailHeader:281-301`, transit's SectionLabel/tag pills) are reimplemented per-surface rather than a shared `Chip`/`Pill`. Minor; fold a `Pill` into primitives during promotion.
- **Drift verdict:** cards/chips/badges are the *least* drifted (near-byte-identical) but still forked — promote to stop future drift, not to fix a visible bug.

---

## 5. LEFT GRAIN/FILTER/ToC RAIL — verdict: **BUILD-LOCAL `SurfaceRail` from DetailShell left-rail + yesid rail patterns**

### Today (fragmented)
Grain/filter controls are scattered: `surface/GrainPicker.svelte`, `surface/SurfaceControls.svelte`, `layout/ControlsRail.svelte`, `DateRangePicker`, plus per-feature filter pills (`lines/reliability/ReliabilityFilterPill`, `alerts/sections/AlertFilters`, `hotspots/sections/HotspotSection`, `repeat-offenders/sections/RepeatOffendersSection`, `stops/reliability/sections/StopReliabilitySurface`, `network/.../NetworkSurface`). GrainPicker alone is consumed by **16 files**. There is a floating top grain bar rather than a sticky left rail. yesid's rail model is the sticky left column (`toc-rail`/`context-panel` at `top:5rem`, bare — no StickyPanel box) from ProjectDetailPage/BlogDetailPage.

### Target: ONE `SurfaceRail`
A reusable **sticky left rail** (mirrors DetailShell's `left` slot) composing, top-to-bottom:
1. **GrainPicker** (existing primitive, reused — the grain matrix control).
2. **FilterGroup** (yesid ships `shared/FilterGroup.svelte` + `FilterSummary` + `ListingMobileFilters` — transit currently has none of these; **REUSE/port yesid's FilterGroup** rather than the per-feature pill reimplementations).
3. **TocNav** (existing shared, reused — section jump list).

Behavior: sticky `top:var(--chrome-offset)`, follows FOCUS/quiet-mode (S10 pattern), collapses to a mobile drawer (`ListingMobileFilters` from yesid) + `TocPill`. **DRY target:** one `SurfaceRail` for line-reliability / stop-reliability / network / hotspots / alerts — replacing the floating top grain bar and the 5+ per-feature filter reimplementations. GrainPicker + TocNav are reused as-is; FilterGroup is the missing shared piece to port from yesid (candidate for `@yesid/ui-detail`).

---

## 6. SCHEDULE TABLE — verdict: **BUILD-LOCAL one `ScheduleTable`; today two divergent implementations**

Schedules render in TWO places with TWO bespoke layouts, no shared component:
- **Stop schedule** — `features/stops/StopDetail.svelte:476-517`: static `scheduled[]` grouped by route → a **column-major 5-col grid** (`.stop-schedule-times`, `--sched-rows=ceil(n/5)`, `grid-auto-flow:column`), route-code + headsign head, `SCHEDULE_CAP` + "more" overflow, `AbsentValue` for empty. Also the **next-departures board** (`:448-471`) is a separate `.stop-departures` list (route · eta · color-coded delay glyph).
- **Line schedule** — `features/lines/RouteDetail.svelte:463+`: a `schedule` tab with its own `.route-schedule-grid` / `.route-schedule-cq` container-query layout, headway-minutes formatting, first/last-departure readout — completely independent CSS from StopDetail.

**Target shape:** one `ScheduleTable` primitive taking `rows` of `{ route, headsign?, times[] | departures[] }` with modes: **`grid`** (column-major time grid, the StopDetail idiom) and **`board`** (route · time · delay-glyph departures, the next-bus idiom), a `cap`+more control, `AbsentValue` empty state, and the shared status-scale delay coloring. Both stop schedule + line schedule + the next-departures board consume it. Local (transit-domain: routes/headsigns/delays) — not a yesid concept, so BUILD-LOCAL, not promote.

---

## 7. EDGE-LETTERS (VerticalSectionTitle) — verdict: **RETIRE / FULL REMOVAL**

`layout/VerticalSectionTitle.svelte` is a rotated giant section word in the left gutter (`writing-mode:vertical-rl; transform:rotate(180deg)`, ≥1280px only, `aria-hidden`, decorative). Its OWN header comment admits: *"Restores the yesid listing-page 'edge word' ornament that **S10 retired** from /metrics."* yesid detail/blog/project pages do **NOT** use rotated edge letters — their edge metadata is **upright mono text** (`ProjectDetailHeader edge-left/edge-right`, `font-size:10px`, upright, `:212-237`). Grep confirms yesid uses no `writing-mode: vertical` rotated section word anywhere in page chrome.

Currently mounted on 3 transit surfaces: `NetworkSurface`, `EntityDetail`, `MetricsExplainer`. **Plan:** delete `VerticalSectionTitle.svelte` + `verticalSectionTitle.copy.ts` + its 3 mount sites + tests. It contradicts the "reuse yesid, don't invent lookalikes yesid already retired" mandate directly. Zero semantic loss (decorative/aria-hidden). If any edge texture is wanted, use yesid's **upright mono edge-metadata** columns from the detail header instead.

---

## 8. EDGE-TO-EDGE gaps — verdict: mostly full-bleed; metrics/status inline-boxed pending DetailShell

yesid detail pages are full-bleed header + edge-to-edge hazard `Separator` + gutter-padded grid (`padding-inline: var(--space-page-x)`), never a boxed max-width card wrapping the page. transit is largely full-bleed (Surface P5.3a stripped `--container-content` from Surface; TerminalPanel uses solid full-width chrome). Remaining boxed/not-full-bleed:
- **metrics** — `.body-grid` is `max-width: container-wide; margin:0 auto` (centered/capped) rather than full-bleed like yesid projects (which use `max-width:none` at lg, `ProjectDetailPage:596-600`). Blog uses `container-wide` centered too, so this is *consistent with yesid blog* but not with yesid projects. Decide one: adopt the projects full-bleed grid via DetailShell.
- **status** (`features/health/HealthStatus.svelte`) — uses ArticleShell/TerminalPanel; verify it goes edge-to-edge under DetailShell.
- Prose lanes (ArticleShell `--container-content`/72ch) are intentionally capped — that's the reading measure, not a full-bleed violation.

Net: no egregious boxed surface; fold metrics/status into DetailShell to normalize the header→hazard→gutter-grid rhythm.

## 9. TOOLTIP clarity — verdict: (i) explainers are wired but thin

The (i) explainer affordance flows as a `explainer` **snippet** through `SurfaceHeader:28`, `SectionHeading`, and `ExplainedMetricCard` (`info` snippet) — good separation (components don't import features; the feature owns MetricInfo wiring). The underlying `ui/tooltip/*` (bits-ui) is a fork of yesid's. Clarity gaps to flag for the build phase:
- The (i) content is a **hover-only popover**; on the reliability surface it deep-links to `/metrics` at the metric anchor (good), but the tooltip body itself is terse. ExplainedMetricCard's col2 "always-visible explanation" is the honest pattern — extend that (explanation in-place, tooltip as the deep-link jump) rather than relying on hover for meaning.
- GrainPicker (`surface/GrainPicker.svelte`) imports Tooltip — the grain/sub-grain matrix explanation is a known confusing spot (per the granularity-matrix memory); its tooltip should state "what this grain shows + its sub-grain" explicitly.
- Chart-mark tooltips (`DotStripMark`, `LineMark`) are per-mark; a shared `ChartTooltip`/`useChartTooltip` exists in dataviz — ensure the (i) explainer voice and the chart hover voice don't diverge.
- No confusing tooltip is *broken*, but the "hover-to-understand" reliance is the weak point; prefer in-place explanation (ExplainedMetricCard model) + tooltip-as-jump.

---

## REUSE-DRIFT REGISTER (ranked by visibility)

| # | transit component | reimplements yesid pattern | state | action |
|---|---|---|---|---|
| 1 | `brand/TerminalPanel` | `brand/TerminalChrome` (3-dot signal head) | forked; dots read as stoplight on data surfaces | drop dots; promote shared `TerminalChrome` w/ `signalHead` prop (§1) |
| 2 | `features/metrics/MetricsExplainer` (inlined) | `ProjectDetailPage`/`BlogDetailPage` detail shell | hand-ported grid, not a shell | replace with promoted `DetailShell` (§3) |
| 3 | `layout/DetailTemplate` | yesid detail 3-col grid | hollow (no header/sep/toc/pill), unwired | delete → `DetailShell` (§3) |
| 4 | `layout/VerticalSectionTitle` | edge-word yesid **retired** in S10 | reinvents a killed ornament | RETIRE fully (§7) |
| 5 | `layout/ArticleShell` | SectionHeading-based masthead | near-dup of SurfaceHeader | fold into one `Masthead` (§2) |
| 6 | `surface/SurfaceHeader` + ArticleShell (two heads) | yesid single head DNA | two competing head systems | merge to one header family (§2) |
| 7 | per-feature filter pills (5+) | yesid `shared/FilterGroup`/`FilterSummary` | transit lacks FilterGroup; reinvents pills | port FilterGroup → `SurfaceRail` (§5) |
| 8 | `stop-schedule` vs `route-schedule` grids | (transit-domain; no yesid analog) | two divergent bespoke tables | one `ScheduleTable` (§6) |
| 9 | `shared/TocNav`, `shared/CollapsibleSection` | yesid same-named shared | **already drifted** (files differ) | promote to `@yesid/ui-detail`, single source |
| 10 | `brand/SectionHeading` | yesid `brand/SectionHeading` | drifted (transit heavily extended) | promote superset to `@yesid/ui-brand` |
| 11 | `ui/card` (+ `interactive`) | yesid `ui/card` | forked, minor extension | promote `ui/` set to `@yesid/ui-primitives` |

---

## PROMOTE-TO-DESIGN-REPO v0.4.0 vs BUILD-LOCAL

**PROMOTE (stand up `@yesid/ui-*` Svelte packages — the backbone):**
- `@yesid/ui-primitives`: full `ui/` shadcn set (card w/ `interactive`, badge, tabs, toggle, separator, collapsible, scroll-area, resizable, tooltip) + `StatusDot`, `SectionIcon`, `CornerMarks`, `ChevronToggle`, a `Pill`.
- `@yesid/ui-brand`: `TerminalChrome` (signalHead opt-in, dots OFF by default), `SectionHeading`, `SectionLabel`, `Masthead` (§2 header family), `MetricDisplay`, `StopLabel`, `MetroStation`.
- `@yesid/ui-detail`: `DetailShell` (§3 — full-bleed header + hazard sep + 3-col grid + observeActiveToc + TocPill + CtaBand), `TocNav`, `TocPill`, `TocBadge`, `CollapsibleSection`, `FilterGroup`/`FilterSummary`/`ListingMobileFilters`, `toc.ts`. **DetailShell also DRYs yesid's own project≈blog copy-paste.**

**BUILD-LOCAL (transit-domain, no yesid analog):**
- `SurfaceRail` (GrainPicker + FilterGroup + TocNav composition, §5).
- `ScheduleTable` (grid + board modes, §6).
- The one merged `SurfaceMasthead` wiring on transit surfaces (consumes promoted `Masthead` + adds transit meta/tape).

**DELETE:** `VerticalSectionTitle`, `DetailTemplate`, `ArticleShell` (superseded).

---

## HEADER-FAMILY ONE-LINE SPEC

**One `Masthead` on every non-metrics/status surface:** mono kicker/overline (station-voice, `--accent`, `--tracking-eyebrow`) → display **title + orange dot** (real `h1`) → capped lede (≤52ch, muted) → mono meta row (provider · window · generated_utc) → closed by an edge-to-edge `<Separator variant="hazard">` tape; **metrics + status instead mount the full-bleed `DetailShell` header** (dot-grid `.detail-header-grid` band + upright mono edge-metadata + QuietMode) — the yesid `projects/[slug]` / `blog/[slug]` detail architecture, promoted so both apps consume one system.
