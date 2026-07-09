# Surface Anatomy — "data-health" (/status)

Route: `apps/web/src/routes/[[lang=locale]]/status/+page.svelte` (EN `/status`, FR `/fr/status`).
No dedicated `/data-health` route exists. `routes/health/+server.ts` is an unrelated JSON uptime probe at `/health` (no locale prefix, not a page) — out of scope.

## Files in the composition tree

Entry / thin mount
- `apps/web/src/routes/[[lang=locale]]/status/+page.svelte` — 18 lines; imports and mounts `<HealthStatus />`. No `+page.ts`, no `+layout` of its own (unlike `/metrics`, which has `metrics/+layout.svelte`).

Screen orchestrator
- `apps/web/src/lib/features/health/HealthStatus.svelte` — the whole surface; two live resources + section layout.

Sections (all under `apps/web/src/lib/features/health/sections/`)
- `SectionLanes.svelte`, `SectionFreshness.svelte`, `SectionSources.svelte`, `SectionGaps.svelte`, `SectionNotes.svelte`, `SectionRetention.svelte`, `SectionConformance.svelte`, `SectionEnvelope.svelte`

Selectors (pure view-models, `apps/web/src/lib/features/health/selectors/`)
- `provenanceViews.ts` — verdictFor / freshnessOf / sourcesOf / gapsOf / pipelineNotesOf / retentionOf
- `laneHealth.ts` — selectLaneRows (+ maintenance not-applicable row)
- `envelope.ts` — selectEnvelope (publish id + schema/methodology versions)

Copy
- `apps/web/src/lib/features/health/health.copy.ts` — bilingual EN/FR, extends `SurfaceHeadCopy`.

Data sources
- `apps/web/src/lib/v1/repositories/dataHealth.ts` → `getDataHealth()` (data_health.json, live lane; null on legacy publish)
- `apps/web/src/lib/v1/repositories/provenance.ts` → `getProvenance()` (provenance.json, daily doc)

Shared spine (briefly — not surface-specific)
- `layout/Surface.svelte` (width/gutter/pad wrapper), `surface/SurfaceHeader.svelte` (kicker+heading+lede), `surface/ResourceBoundary.svelte` (skeleton/error/empty gate), `surface/FreshnessStamp.svelte` (Updated N ago), `brand/SectionLabel.svelte` (mono overline — a `<span>`), `brand/SectionHeading.svelte` (the only real `<h1>`), `brand/MetricDisplay.svelte`, `brand/StatusDot.svelte`, `dataviz/ExplainedMetricCard.svelte`, `edge/AbsentValue.svelte`, `surface/ConformanceBadge.svelte`, `shared/CollapsibleSection.svelte`, `ui/separator` (hazard variant).
- Mount chrome: `routes/+layout.svelte` → `shell/AppShell.svelte` → `shell/TopBar.svelte`.

---

## (1) SECTION ORDER + STORY ARC

Render order top-to-bottom in `HealthStatus.svelte`. Every section is preceded by a `<Separator variant="hazard" />` (yellow/black safety tape, decorative, `aria-hidden`). Every section except the header is CONDITIONAL — it stands down (renders nothing, no placeholder) when its slice is empty.

| # | Heading (EN) | Component | Data source / selector | Gate |
|---|---|---|---|---|
| 0 | **Data health** (h1) + kicker `DATA · HONESTY` + subhead `// PROVENANCE` + lede | `SurfaceHeader` | copy `t.heading/kicker/subheading/lede` | always renders (even on error/loading — see chrome) |
| 0b | `AS OF` + "Updated N ago" stamp | `.health-asof` div + `FreshnessStamp variant="updated"` | `prov.generated_utc` | inside ResourceBoundary ok-branch |
| 1 | **Pipeline lanes** | `SectionLanes` | `dataHealth.data` → `selectLaneRows` (laneHealth.ts) | `laneRows.length > 0` — needs data_health.json (live lane) |
| 2 | **Feed freshness** | `SectionFreshness` | `prov.freshness` → `freshnessOf` + `verdictFor` | `freshness.length > 0` |
| 3 | **Source feeds** | `SectionSources` | `prov.sources` → `sourcesOf` | `sources.length > 0` |
| 4 | **Known data gaps** | `SectionGaps` | `prov.gaps` → `gapsOf` + `humanizeGap` | `gaps.length > 0` |
| 5 | **Pipeline notes** | `SectionNotes` | `prov.methodology` → `pipelineNotesOf` (excludes threaded /metrics keys) | `pipelineNotes.length > 0` |
| 6 | **Retention** | `SectionRetention` | `prov.retention` → `retentionOf` | `detail != null OR aggregate != null` |
| 7 | **Feed conformance** | `SectionConformance` | `prov.conformance` + `ConformanceBadge` + `CollapsibleSection` | `conformance` truthy |
| 8 | **Build accountability** | `SectionEnvelope` | `selectEnvelope(prov, dh)` → publish id + schema/methodology versions | `hasEnvelope` (any of 3 present) |

**Section count: 8 content sections + header (9 vertical blocks total).**

### Story-arc assessment

The reader's implicit journey, by scroll depth:
- **Header (depth 0):** "Is the data honest, and as of when?" — answered well. Kicker/heading/lede frame the whole page as a provenance manifest; the "Updated N ago" stamp anchors recency. Strong opening.
- **Lanes (depth 1):** "Is the pipeline actually running, and did the last publish pass its checks?" — the strongest evidence block: per-lane cadence, last-publish age, files written/total, and a gate verdict chip. This is the true "health" heartbeat and it is (correctly) placed first after the header.
- **Freshness (depth 2):** "Did each feed's last ingestion run succeed?" — reinforces lanes at feed granularity.
- **Sources (depth 3):** "Where did each feed come from and when did it land?" — lineage/provenance detail.
- **Gaps (depth 4):** "What is knowingly missing?" — the honesty callout (e.g. "Metro: no realtime feed").
- **Pipeline notes (depth 5):** "How are the un-carded methodology bits built?" — verbatim methodology dump.
- **Retention (depth 6):** "How long is data kept?"
- **Conformance (depth 7):** "How cleanly did the latest schedule match the model?" + collapsible unmodelled-field list.
- **Build accountability (depth 8):** "Which exact publish run produced this page?" — the citable stamp.

**Verdict: a competent evidence LEDGER, not yet a STORY.** The arc is context (header) → a long flat run of eight co-equal evidence panels → and it stops. It never lands a verdict.

Where the story breaks / stalls:
1. **No top-line verdict.** The page never states an overall health judgement ("All lanes healthy · last publish 2h ago · gate passed"). The reader must synthesize nine sections themselves. An A++ page opens with a single-sentence status headline (green/amber verdict) then lets the evidence justify it. Here the lanes gate verdict — the single most decision-relevant fact — is buried three cells deep inside row 1.
2. **Flat hierarchy = no crescendo.** Every section is the same visual weight (identical `.health-block`, same hazard separator, same mono caption). Nothing signals "this is the headline vs this is the appendix." Retention + pipeline-notes + conformance-detail read as important as the lanes heartbeat.
3. **No navigation / ToC.** Eight sections on a single scroll with no in-page anchors or sticky rail (contrast `/metrics`, which has a ToC layout). On a long payload the reader cannot jump; there is no sense of "where am I."
4. **Ordering is pipeline-internal, not reader-priority.** Order mirrors the pipeline's tier order (live→static→rollup lanes, then feeds, then lineage, then methodology). A citizen cares most about "is it fresh and did it pass," least about retention windows and unmodelled feed fields — but those low-salience sections sit in the same run with no de-emphasis.
5. **The ending fizzles.** The last thing the reader sees is "Build accountability" (a hash + version numbers) — the most technical, least narrative content — instead of a closing verdict or a "what this means for you." No resolution beat.
6. **Missing the "so what."** Sections state facts (files written, ages, versions) but rarely interpret them. Only the lanes gate has a plain-language explainer (`gateExplain`) and the envelope card has an always-visible explanation. Freshness/sources/retention give numbers without a "this is normal / this is why it matters."

What's missing for it to read as a story (context → evidence → verdict):
- A **verdict header band** (roll-up of lane gate + freshness into one green/amber line) directly under the h1.
- **Section grouping** into 2–3 acts (e.g. "Is it running?" [lanes+freshness], "Where's it from & what's missing?" [sources+gaps], "How we keep & measure it" [retention+conformance+notes+envelope]) with real sub-headings.
- A **closing statement** (or link back to the metrics/methodology story).

---

## (2) CHROME

- **No page-local header/sticky/rail.** `/status` is a "document surface": `routes/+layout.svelte` renders it into AppShell's `main` snippet inside `<div id="main" class="flex h-full w-full flex-col overflow-y-auto">` (line 480-484). `isFullBleed` is `seoPath === '/map'` only, so `/status` gets `overflow-y-auto` and a trailing `<Footer>`. The page scrolls INSIDE `#main`, not the window.
- **App chrome (outside the page):** `TopBar` is `h-[60px]`, `shrink-0`, `border-b`, `z-40`, sits ABOVE the scroll container (AppShell is `h-dvh flex-col`: TopBar then the scrolling row). So the TopBar is effectively fixed relative to the scroll region without being `position:sticky`.
- **No `--chrome-offset` anywhere in the repo.** Grep for `chrome-offset` returns zero hits. The chrome offset mechanism used elsewhere is `--app-left-rail-offset` (AppShell.svelte:387), which pads `.app-shell-main` left by the LeftRail width at ≥1024px (`padding-left: var(--app-left-rail-offset)` on `.app-shell-main:not(:has(.map-hero))`). `/status` is not a map-hero, so it IS inset by the rail on desktop.
- **No sticky elements on the /status page itself.** The only `scroll-margin-block-start` is in `SectionConformance.svelte:85` (`.section-block { scroll-margin-block-start: 5.5rem }`) — a defensive anchor offset for the collapsible, but nothing on the page is a scroll anchor target (no ToC links here), so it is presently inert.
- **Rails:** none on this surface. No `RailLayout`, no `ControlsRail`, no sticky ToC. Contrast `/metrics` which owns a layout with a section rail.
- **Separators:** `Separator variant="hazard"` between every section — a decorative yellow/black safety-tape band (`ui/separator/separator.svelte`), `aria-hidden`, `hazardSize="md"` default (`h-1.5`).

---

## (3) CONTAINERS

- **Root wrapper:** `<Surface width="content" class="health">` (HealthStatus.svelte:101).
  - `width="content"` → `max-width: var(--container-content)` = **64rem (1024px)** (`tokens.css:88`).
  - `gutter` default true → `padding-inline: var(--space-page-x)` = **clamp(1rem, 4vw, 5rem)** (`tokens.css:43`).
  - `pad="surface"` default → `padding-block: clamp(1.5rem, 4vw, 2.5rem)`.
  - `.surface-shell` is `display:flex; flex-direction:column; gap: clamp(1.75rem, 4vw, 2.75rem)` — this vertical rhythm gap sits between the header, the as-of stamp, and each hazard-separator+section unit.
- **Section internals:** every section root is `.health-block { display:flex; flex-direction:column; gap:0.75rem }`. Notes/captions capped at `max-width: 60ch`; verbatim methodology + gate text at `72ch`.
- **Grid templates (only two on the page):**
  - `SectionRetention` `.health-retention`: `grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.25rem 2rem; max-width: 28rem`.
  - `SectionEnvelope` `.envelope-rows`: identical `repeat(2, minmax(0,1fr)); max-width:28rem`.
  - `SectionLanes` uses flex-wrap, not grid: `.lane-meta { display:flex; flex-wrap:wrap; gap:0.75rem 2rem }` — cells reflow.
  - `ExplainedMetricCard` (envelope publish-id) is self-contained with a **container query** (`@container (min-width:23rem)` → 2-up `minmax(7rem,12rem) minmax(0,1fr)`), so it reflows to single-column on narrow cards regardless of viewport.
- **Padding rhythm:** lane rows `padding:0.875rem 1rem`; gaps callout `padding:0.875rem 1rem`; conformance members chips `padding:0.15rem 0.5rem`. Consistent ~0.75–0.875rem block padding across bordered blocks.

**Note:** all bordered blocks use `background: var(--muted)` + `border: 1px solid var(--border)` + `border-radius: var(--radius-md)`, except the gaps callout which adds a `border-left: 3px solid var(--dataviz-status-late)` accent (the only colored accent on the page besides status dots).

---

## (4) HEADINGS — hierarchy sanity

**This is the most significant structural defect.**

- **Exactly ONE real heading element on the page: the `<h1>`** — rendered by `SectionHeading` (level default overridden to 1 in `SurfaceHeader` via `level=1`), text "Data health". Verified `SectionHeading.svelte:34,38` emits `<svelte:element this={h${level}}>`.
- **All eight section titles are `<span>`s, NOT headings.** Each section calls `<SectionLabel ... variant="station" />`. `SectionLabel.svelte:38` renders a `<span data-slot="section-label">`. The `<section>` elements associate the label via `aria-labelledby={id}` (e.g. `aria-labelledby="health-lanes"` + `id="health-lanes"` on the span). So AT gets an accessible region name, but the DOCUMENT OUTLINE has no h2/h3/h4 at all.
- **Consequence:** heading levels effectively go **h1 → (nothing)**. There is no h2. Skipped levels in the strict sense don't occur (there are no lower headings to skip TO), but the practical result is worse: a screen-reader "headings list" / rotor shows only "Data health" and none of the 8 sections. A crawler / reader-mode / a11y-tree sees a flat page with one heading.
- **Nested labels:** inside `SectionNotes` each note uses `<SectionLabel variant="metric" />` (again a span) for the per-note label; inside `SectionConformance` the collapsible members block uses `<SectionLabel variant="metric" />`. All spans — no nesting depth is expressed as headings either.
- **Verdict:** the visual hierarchy (display h1 + mono station overlines) reads fine sighted, but the semantic heading tree is a single h1 with zero sub-headings. An A++ portfolio page would emit real `<h2>` per section (SurfaceHeader/SectionHeading can already take `level`, but the sections deliberately use the span-based `SectionLabel` instead).

---

## (5) ABSENCE STATES

Honesty handling is a genuine strength here — the surface is built around it. No bare dash / null leaks were found.

- **Section-level stand-down:** each section is gated (`{#if slice.length > 0}` / `{#if hasRetention}` / `{#if conformance}` / `{#if hasEnvelope}`) — an absent slice renders NOTHING (no empty box, no placeholder). Documented as "stands down" throughout. This is honest but has a downside for story (a legacy publish silently drops the entire Lanes + Build-accountability sections with no note that they exist).
- **Field-level absence uses the shared primitive, `AbsentValue variant="inline" reason="not-reported"`:**
  - `SectionLanes.svelte:80` — file counts absent → `<AbsentValue reason="not-reported">`
  - `SectionLanes.svelte:94` — gate verdict absent → `<AbsentValue reason="not-reported">` (never an assumed pass)
- **MetricDisplay honest-absence path** (renders the styled chip via `emptyLabel={copy.noData}` + `absentReason="not-reported"`, value=null → no fabricated 0):
  - `SectionRetention.svelte:29-45` — detail + aggregate windows
  - `SectionConformance.svelte:44-53` — extra-row count (explicitly guards `typeof === 'number'`, else null)
  - `SectionEnvelope.svelte:55-70` — schema + methodology versions
- **ExplainedMetricCard** (`SectionEnvelope.svelte:43-51`) — publish id absent → same `emptyLabel`/`absentReason` honest chip.
- **FreshnessStamp** renders localized "unknown" when `generatedUtc`/age is null (never a fabricated time) — used for the as-of stamp and per-lane last-publish.
- **Text fallbacks (localized, never a dash):** `humanizeAge` → `t.freshness.noAge` ("no age signal"); `lastLoaded` → `t.sources.neverLoaded` ("not yet loaded"); source chain → `t.sources.noChain` ("no lineage recorded"); gap/verdict tokens fall back to humanized-key (underscores→spaces) so an unknown token still renders readable.
- **AbsentValue doctrine:** tone "unknown" → rides `--dataviz-status-unknown`, never `--primary`/`--destructive` (an absence is not an error). `aria-label` states "label, why".
- **`copy.noData`** = "no data" / "aucune donnée".

**Absence verdict: exemplary. Zero bare `—`/null leaks. The one gap is that whole-SECTION stand-down is invisible** (a missing Lanes section on a legacy publish gives the reader no signal the lane heartbeat exists at all).

---

## (6) EXPLAINER LINKS

**No metric on this page links to its `/metrics` "how we measure" entry. Zero `href`s to `/metrics` exist in the entire health feature.** (grep confirmed.)

- The relationship to `/metrics` is INVERTED here: `pipelineNotesOf` (provenanceViews.ts:74-91) takes `METHODOLOGY_METRIC_KEY` (the set of methodology keys already threaded to a /metrics card) and EXCLUDES them — the Pipeline-notes section shows only the methodology strings that have NO /metrics card, and prints them VERBATIM inline (`SectionNotes.svelte:27`). So instead of linking out, un-carded methodology is dumped as prose.
- In-place explainers exist for two things: the lanes gate (`gateExplain`, one honest sentence) and the envelope publish-id (`generationIdExplain`, always-visible via ExplainedMetricCard). These are good but local.
- **Gap:** metrics that DO have a /metrics card (freshness verdict semantics, conformance, retention model, the Wilson-z / min-n rows that appear as pipeline notes) are not linked to their metrics-page explanation. A reader wanting "what does 'loaded' / 'conformance' mean" has no click-through. An A++ page would deep-link each measured concept to its `/metrics#anchor`.

---

## (7) MOBILE-390 READ FROM CODE

**Breakpoints actually in play on this surface:**
- The page CSS contains **zero `@media` and zero `@container` queries** (grep confirmed for the health feature). All responsiveness comes from (a) fluid tokens and (b) flex-wrap.
- Fluid tokens: `--space-page-x: clamp(1rem, 4vw, 5rem)` → at 390px the gutter is ~1rem each side (4vw≈15.6px, floored effectively at 1rem). `--container-content: 64rem` never binds below 1024px. `.surface-shell` gap `clamp(1.75rem,4vw,2.75rem)`; section pad `clamp(1.5rem,4vw,2.5rem)`.
- App shell: rail overlay is `display:none` below 1024px (`AppShell.svelte:409` + media query at 464), so at 390px `--app-left-rail-offset` is `0px` and `.app-shell-main` has no left inset. Full content width available minus gutter.

**Elements at risk of overflow at 390px:**
1. **Lane rows (`SectionLanes`)** — `.lane-meta` is `flex-wrap:wrap; gap:0.75rem 2rem` with three cells (last-publish stamp, files count, gate chip). Wraps fine. But `.lane-cell-value` / gate verdict / FreshnessStamp are `white-space:nowrap` mono strings; a long publish-age absolute stamp ("Jun 21, 14:32 EDT") plus the mono labels is safe. **Low risk.**
2. **Feed-freshness rows** — `.health-row` is `justify-content:space-between` with `.health-row-feed` set `overflow:hidden; text-overflow:ellipsis; white-space:nowrap` and the meta column `flex-shrink:0`. A long feed name ellipsizes rather than overflowing. **Safe by design.**
3. **Sources rows** — feed name is `white-space:nowrap; overflow:hidden; ellipsis`; the chain string is `overflow-wrap:anywhere` and can wrap to many lines but won't overflow. **Safe.**
4. **Retention + Envelope grids** — HARD-CODED `grid-template-columns: repeat(2, minmax(0,1fr))` with NO mobile single-column fallback. `minmax(0,1fr)` prevents horizontal overflow (columns shrink), but at 390px two metric tiles side-by-side inside `max-width:28rem` become cramped (~180px each minus gap). Labels like "Aggregate window" / "Methodology version" may wrap awkwardly. **Medium risk — squeeze, not overflow.**
5. **Conformance members list** — `.health-members-list { flex-wrap:wrap }` chips with `overflow-wrap:anywhere`; a long unmodelled field name wraps inside its chip. **Safe.**
6. **Verbatim methodology text (SectionNotes)** — `overflow-wrap:anywhere`, `max-width:72ch` (won't bind at 390px). Long SQL-ish strings wrap. **Safe.**
7. **Header display h1** — `font-size: clamp(2.5rem, 6vw, 4rem)` → at 390px ≈ 2.5rem (40px) with `letter-spacing:-2px`. "Data health" / "Santé des données" fits. FR is longer but wraps. **Low risk.**

**Touch-target sizes (from classes):**
- The ONLY interactive control on the page is the **Conformance collapsible trigger** (`CollapsibleSection` → `<button class="section-header flex w-full items-center gap-2.5 px-6 py-4">`, CollapsibleSection.svelte:166-173). `py-4` = 16px top+bottom padding + line box → button is comfortably **≥48px tall and full-width** — exceeds the 44px min touch target. **Good.**
- No other tappable controls (no pickers, no tabs, no filter chips — the entire surface is read-only). The only other affordance is the ResourceBoundary error-state retry button (shared EdgeState), only shown on load failure.

**Chart sizing on small screens:** there are NO charts on this surface — it is entirely rows, chips, metric tiles, and dots (StatusDot). So no chart-sizing strategy is needed; the "dataviz" here is `StatusDot` marks and the `ConformanceBadge`, all intrinsically responsive.

**Sticky behavior on mobile:** none on the page. The TopBar (h60) is fixed above the `overflow-y-auto` `#main` scroll region on all breakpoints; the page content scrolls under it. No page-level sticky, no bottom nav on this surface (BottomSheet only appears for map/detail selections, not here).

**Mobile risk verdict: LOW.** No horizontal-scroll hazards (ellipsis + flex-wrap + `minmax(0,1fr)` everywhere), good touch target, no charts. The only mobile weakness is the two hard 2-column grids (retention, envelope) that don't collapse to 1-up on narrow screens — a cosmetic squeeze, not a break.

---

## (8) TOP 5 GAPS vs an A++ portfolio case-study page

1. **No verdict / no headline judgement.** The page is a flat evidence ledger with no top-line status ("Healthy — last publish 2h ago, all gates passed") and no closing resolution. An A++ page states its verdict first, then justifies it. Here the single most decision-relevant fact (the lanes gate pass/fail) is a chip buried in cell 3 of row 1. FIX: add a verdict band under the h1 rolling up lane-gate + freshness into one green/amber sentence.

2. **Broken semantic heading tree (h1-only).** All 8 section titles are `<span>`s (`SectionLabel`), so the document outline is a lone `<h1>` with no `<h2>`s. Screen-reader heading navigation and reader-mode see one heading for a nine-section page. FIX: render real `<h2>` per section (SectionHeading already supports `level`), keeping the mono-overline styling.

3. **No in-page navigation / ToC / section grouping.** Eight co-equal sections on one scroll, no anchors, no sticky rail, no acts. Unlike `/metrics` (which has a ToC layout), there is no way to jump or to sense structure. FIX: group into 2–3 narrative acts with a sticky section rail and anchor links.

4. **No explainer links to `/metrics`.** Zero click-throughs from any measured concept (freshness verdict, conformance, retention, Wilson-z / min-n) to its how-we-measure entry. Methodology is instead dumped verbatim as prose. FIX: deep-link each metric/section to `/metrics#anchor`; keep the verbatim dump only for truly un-carded keys.

5. **Flat visual hierarchy + weak "so what."** Every section is identical weight (same block, same hazard tape, same mono caption), so the lane heartbeat reads no more important than retention-window numbers or unmodelled feed fields, and most sections give numbers without interpretation. Whole-section stand-down is also invisible (a legacy publish silently drops Lanes + Build-accountability with no trace they exist). FIX: promote the heartbeat, demote/collapse the appendix-grade sections (retention, conformance detail, envelope), add a one-line "what this means" per section, and show a muted "not published on this build" stub instead of total silence for stood-down sections.

---

## Doctrine / quality notes (positive)

- **Honesty layer is exemplary** — every field routes through AbsentValue / MetricDisplay honest-absence; no fabricated 0/pass; no bare dash. This is the page's core strength and is fully realized.
- **Status marks ride the dataviz status scale** (StatusDot on_time/late/unknown), never `--primary` — Chart Doctrine clean. The only `--primary` on the page is the SectionHeading flourish dot (a brand flourish, aria-hidden, doctrine-permitted).
- **Clean separation of concerns** — selectors are pure/i18n-free and unit-tested (`*.test.ts` beside each), sections are dumb renderers, orchestrator only fetches+maps+lays out. Matches the operator's per-slice de-monolith mandate.
- **Auto-refresh** — both resources use `freshness:true`, so a new publish bumps the shared dataPulse epoch and the page advances with no polling.
