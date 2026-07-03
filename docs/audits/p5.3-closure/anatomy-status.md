# Surface Anatomy — `/status` (data-health)

Route: `apps/web/src/routes/[[lang=locale]]/status/+page.svelte` (684 B thin mount)
Feature screen: `apps/web/src/lib/features/health/HealthStatus.svelte` (209 lines)
Copy: `apps/web/src/lib/features/health/health.copy.ts` (414 lines, EN+FR)
Sections: `apps/web/src/lib/features/health/sections/*.svelte` (8 files)
Selectors: `apps/web/src/lib/features/health/selectors/*.ts` (3 pure view-model modules)

No `+page.ts`, no `+layout.svelte` in the `status/` dir — the screen fetches
`provenance.json` + `data_health.json` client-side via `createResource`; locale
from `getLocale()` context. Renders into the root layout's `#main` scroll box.

---

## 0. FILE / IMPORT MAP (what composes this surface)

`+page.svelte` → `HealthStatus.svelte` which imports:
- Layout: `Surface` (`$lib/components/layout`, `layout/Surface.svelte`)
- Surface spine: `SurfaceHeader`, `ResourceBoundary`, `FreshnessStamp` (`$lib/components/surface`)
- UI: `Separator` (`$lib/components/ui/separator`, variant `hazard`)
- Data: `getProvenance`, `getDataHealth`, `freshnessRelative` (`$lib/v1`), `createResource` (`$lib/v1/resource.svelte`)
- Selectors: `provenanceViews.ts` (`verdictFor`, `freshnessOf`, `sourcesOf`, `gapsOf`, `pipelineNotesOf`, `retentionOf`), `laneHealth.ts` (`selectLaneRows`), `envelope.ts` (`selectEnvelope`)
- 8 section components (below)
- `METHODOLOGY_METRIC_KEY` from `$lib/features/metrics/metrics.content` (used only to EXCLUDE keys that have a /metrics card — no link is emitted)

Section components + their leaf primitives:
- `SectionLanes.svelte` (226 ln) → `SectionLabel`, `StatusDot`, `FreshnessStamp`, `AbsentValue`
- `SectionFreshness.svelte` (105 ln) → `EntityList`, `SectionLabel`, `StatusDot`
- `SectionSources.svelte` (90 ln) → `EntityList`, `SectionLabel`
- `SectionGaps.svelte` (67 ln) → `SectionLabel`
- `SectionNotes.svelte` (68 ln) → `SectionLabel` (station + metric variants)
- `SectionRetention.svelte` (67 ln) → `MetricDisplay`, `SectionLabel`
- `SectionConformance.svelte` (115 ln) → `ConformanceBadge`, `CollapsibleSection`, `SectionLabel`, `MetricDisplay`
- `SectionEnvelope.svelte` (93 ln) → `ExplainedMetricCard`, `SectionLabel`, `MetricDisplay`

---

## 1. SECTION ORDER + STORY ARC

Order top-to-bottom (all gated by a `{#if}` presence guard in `HealthStatus.svelte`; each preceded by `<Separator variant="hazard" />` except the header/as-of):

| # | Heading (EN) | Component | Data source / selector | HealthStatus.svelte lines |
|---|---|---|---|---|
| — | (page head) "Data health" `// PROVENANCE` + lede | `SurfaceHeader` | static copy (`t.kicker/heading/subheading/lede`) | 105 |
| — | "AS OF" + "Updated N ago" stamp | `FreshnessStamp variant="updated"` | `prov.generated_utc` | 132–135 |
| 1 | "Pipeline lanes" | `SectionLanes` | `data_health.json` → `selectLaneRows(dh, laneLabels)` | 138–141 |
| 2 | "Feed freshness" | `SectionFreshness` | `provenance.freshness[]` → `freshnessOf` + `verdictFor` | 144–147 |
| 3 | "Source feeds" | `SectionSources` | `provenance.sources[]` → `sourcesOf` | 150–153 |
| 4 | "Known data gaps" | `SectionGaps` | `provenance.gaps[]` → `gapsOf` | 156–159 |
| 5 | "Pipeline notes" | `SectionNotes` | `provenance.methodology{}` minus threaded keys → `pipelineNotesOf` | 162–165 |
| 6 | "Retention" | `SectionRetention` | `provenance.retention` → `retentionOf` | 168–177 |
| 7 | "Feed conformance" | `SectionConformance` | `provenance.conformance` | 180–183 |
| 8 | "Build accountability" | `SectionEnvelope` | `selectEnvelope(prov, dh)` (prov-first, dh fallback) | 186–189 |

### Reader-question walk (scroll depth → question answered)
- **Head + AS OF:** "What is this page and how current is it?" — answered. Lede explicitly promises the honesty contract ("A missing signal shows as 'no data', never a fabricated value").
- **§1 Pipeline lanes:** "Are the publish pipelines running, and did the last value-gate pass?" — the strongest section: per-lane cadence + last-publish age + file counts + gate chip (pass/warn/fail on the status scale) + an honest not-applicable Maintenance row. This is the closest thing to a verdict on the page.
- **§2 Feed freshness:** "Did each feed's last ingestion run succeed, and how long ago?" — StatusDot + verdict word + age per feed.
- **§3 Source feeds:** "Where did each feed come from (storage chain) and when did it last land?"
- **§4 Known data gaps:** "What is knowingly missing?" — honesty callout with a warm/late left-border.
- **§5 Pipeline notes:** "How are the un-carded methodology bits computed?" — verbatim methodology strings.
- **§6 Retention:** "How long is data kept?" — 2 stats.
- **§7 Feed conformance:** "How cleanly did the latest schedule match the model?" — `ConformanceBadge` + a collapsible full unknown-member list + exact extra-row count.
- **§8 Build accountability:** "Which exact publish run produced this page? What contract/methodology version?" — the envelope.

### Story-arc assessment (context → evidence → verdict)
**Verdict: this reads as a well-organized honest DATA DICTIONARY / provenance dump, not as a narrative case study.** It is evidence-rich but verdict-poor, and it opens on plumbing.

Where the story stalls / breaks:
1. **No top-line verdict / no summary.** There is no "Everything is healthy" (or "3 lanes green, gate passed") banner at the top. The reader must scan 8 sections and mentally aggregate the StatusDots to decide if the system is OK. An A++ page opens with the answer (a health verdict) then unfolds the evidence. Here the very first thing after the header is a low-level "Pipeline lanes" table — evidence before verdict, inverted arc.
2. **Ordering is roughly reverse-pyramid by newness (S11 lanes/envelope bolted on top/bottom), not by reader priority.** "Build accountability" (§8, the most niche, engineer-facing content) is last, which is fine — but "Pipeline notes" (§5, dense verbatim methodology) sits in the middle of the operational story between Gaps and Retention, breaking the "is it healthy?" thread.
3. **Two independent freshness stories sit unreconciled.** §1 lanes show *publish* freshness (live/static/rollup last-publish age); §2 shows *ingestion-run* freshness per feed; the AS-OF stamp shows the *provenance doc's* generated_utc. Three different "how fresh" readings with no connective tissue telling the reader how they relate.
4. **No scannable navigation.** 8 hazard-striped sections in one long single column with no table-of-contents / ToC rail (contrast the sibling `/metrics` surface, which has a ToC rail inside `MetricsExplainer.body-grid`). On a tall page the reader can't jump or see the shape.
5. **Missing "so what."** Each section states facts but rarely a consequence. E.g. gaps names `metro_realtime` as missing but doesn't say what that costs the reader (which surfaces show no metro live data). Conformance shows unknown members but no "this is fine / this is expected" framing beyond the section note.

What's missing for it to read as a story: a **verdict header** (aggregate health state), a **ToC / section index**, and a **narrative spine** ("here's how fresh → here's where it comes from → here's what's missing → here's how long we keep it → here's how clean it is → here's the exact build") — the pieces exist but aren't sequenced as context→evidence→verdict.

---

## 2. CHROME

- **Global chrome (root layout `apps/web/src/routes/+layout.svelte` + `AppShell.svelte`):**
  - `TopBar` — fixed height `h-[60px]` (`TopBar.svelte:273`), `border-b`, `bg-card`, `z-40`, `shrink-0`. Spans full width on all breakpoints.
  - `LeftRail` overlay — desktop-only (`@media (min-width:1024px)`), width `--app-rail-width-expanded: 16rem` (collapsed `4.85rem`), drives `--app-left-rail-offset`. Below 1024px the rail is `display:none` (offset `0px`) and nav folds into the TopBar burger.
  - `<main>` padding-left = `var(--app-left-rail-offset)` for non-map surfaces (`AppShell.svelte:397-399`) — so on desktop the status content is inset by the rail width.
  - Scroll container: root layout `#main` div is `overflow-y-auto` for non-full-bleed surfaces (`+layout.svelte:482`); `/status` is NOT full-bleed, so it scrolls internally with a `Footer` at the bottom of flow (`+layout.svelte:503-509`).
- **Sticky elements on `/status`: NONE.** The page has no rails, no sticky headers, no sticky controls. The only sticky-ish CSS is `scroll-margin-block-start: 5.5rem` on `.section-block` in `SectionConformance.svelte:85` — a scroll-anchor offset for the collapsible (so a deep-linked/opened collapsible clears the 60px TopBar + gap), NOT a sticky element.
- **`--chrome-offset`: NOT USED anywhere in the codebase.** Sticky offsets elsewhere are the hardcoded literal `5.5rem` (`RailLayout.svelte:87`, `ControlsRail.svelte:122` default `--rail-sticky-top:5.5rem`, `SectionConformance` scroll-margin). `/status` uses none of these rail layouts.
- **Rails on this surface: none.** Single-column `Surface width="content"`.

---

## 3. CONTAINERS

- **Outer:** `<Surface width="content" class="health">` (`HealthStatus.svelte:101`).
  - `Surface.svelte`: `max-width: var(--container-content)` = **64rem** (`tokens.css:88`); `margin-inline:auto`; `display:flex; flex-direction:column; gap: clamp(1.75rem, 4vw, 2.75rem)` (vertical rhythm between sections).
  - `padding-inline: var(--space-page-x)` = **`clamp(1rem, 4vw, 5rem)`** (`tokens.css:43`) via `surface-shell--gutter` (gutter defaults true).
  - `padding-block: clamp(1.5rem, 4vw, 2.5rem)` via `surface-shell--surface`.
- **Per-section container (`.health-block`, repeated in every section):** `display:flex; flex-direction:column; gap:0.75rem`. Section notes capped at `max-width: 60ch`; verbatim methodology/gate text at `72ch`.
- **Grid templates (the only grids on the page):**
  - `SectionRetention .health-retention`: `grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.25rem 2rem; max-width: 28rem` — a 2-up stat pair, fixed 2 columns (does NOT collapse to 1 on narrow; see mobile risk).
  - `SectionEnvelope .envelope-rows`: same `repeat(2, minmax(0,1fr)); max-width:28rem` — same fixed-2-col caveat.
  - `SectionLanes .lane-meta`: `display:flex; flex-wrap:wrap; gap:0.75rem 2rem` — cells wrap, mobile-safe.
  - `SectionConformance .health-members-list`: `flex-wrap:wrap` chip cloud, mobile-safe.
  - `ExplainedMetricCard` (envelope generation-id): `container-type:inline-size`, 2-up `figure | explanation` only `@container (min-width:23rem)`, else single column — mobile-safe.
- **Padding rhythm:** section gap from `Surface` `clamp(1.75rem…2.75rem)`; within-section gap `0.75rem`; card/callout padding `0.875rem 1rem` (lanes/gaps), `1.1rem 1.25rem` (ExplainedMetricCard). Consistent and token-driven.

---

## 4. HEADINGS — hierarchy sanity

- **Only ONE real heading element on the page:** the `<h1>` from `SurfaceHeader` → `SectionHeading` (`SectionHeading.svelte`, `level=1` default in `SurfaceHeader`). Text: "Data health".
- **Every section "heading" is a `<span>`, NOT h2–h6.** `SectionLabel.svelte:38` renders a `<span data-slot="section-label">`. All 8 sections label their `<section>` via `aria-labelledby` pointing at the `SectionLabel`'s `id` (e.g. `id="health-lanes"`, `health-freshness`, `health-sources`, `health-gaps`, `health-pipeline-notes`, `health-retention`, `health-conformance`, `health-envelope`).
  - Consequence: `aria-labelledby` gives each `<section>` an accessible name (good), so screen-reader region navigation works. BUT there is **no h2 heading hierarchy** — a heading-list navigation (VoiceOver rotor "Headings", document outline) sees only the single h1 and skips all 8 section titles. This is a **flat outline / skipped-levels-by-omission** issue: h1 then nothing.
  - Within `SectionNotes`, each note uses a second `SectionLabel variant="metric"` (`SectionNotes.svelte:26`) as a sub-label — again a `<span>`, so no h3 either.
  - `SectionConformance` and `SectionEnvelope` sub-labels ("Fields beyond the standard model", metric labels) are also `<span>`s.
- **Verdict:** No *skipped* numeric levels (there's only h1), but the semantic heading tree is **collapsed to a single node** — everything below the page title is visually-styled `<span>` text. For an A++ portfolio page this is the notable a11y/outline gap: sections should be real `<h2>` (and note sub-labels `<h3>`), or `SectionLabel` needs an `as`/`level` prop for these labelled regions.

---

## 5. ABSENCE STATES

**Strong — this is the page's best-executed dimension.** The whole surface is built on honest-absence primitives and section stand-down.

- **Section stand-down (whole-section absence):** every section is wrapped in a presence `{#if}` in `HealthStatus.svelte` (lanes 138, freshness 144, sources 150, gaps 156, notes 162, retention 168, conformance 180, envelope 186). Selectors return `[]`/`null` on absent slices (`provenanceViews.ts` guards; `laneHealth.selectLaneRows` returns `[]` when `data_health` is null → the whole lanes section disappears on a legacy publish). Honest: an absent slice removes its section rather than showing an empty shell.
- **Field-level absence via `AbsentValue variant="inline" reason="not-reported"`:**
  - `SectionLanes.svelte:80` (files count null), `:94` (gate null → "not checked" honest absence, never assumed pass).
- **Field-level absence via `MetricDisplay ... absentReason="not-reported" emptyLabel={copy.noData}`:**
  - `SectionRetention.svelte:29-44` (both detail + aggregate windows render; a null one shows the styled chip, not vanish).
  - `SectionConformance.svelte:44` (extra_row_count null → styled chip, never fabricated 0).
  - `SectionEnvelope.svelte:55,63` (schema/methodology version rows).
- **`ExplainedMetricCard ... absentReason="not-reported"`:** `SectionEnvelope.svelte:43-51` (publish_generation_id).
- **Resource-level absence (whole body):** `ResourceBoundary` (`HealthStatus.svelte:107`) gates the provenance body — renders `EdgeState` skeleton/error/empty when provenance is loading/failed/absent. `data_health` is soft (null → lanes stand down, no error).
- **Absence primitive contract (`AbsentValue.svelte`):** pure renderer, "unknown" tone on `--dataviz-status-unknown` (NOT --primary/--destructive — absence ≠ error), uses `describeAbsence` from the logic layer, middle-dot separator (never em-dash), `aria-label` = "label, why".
- **`MetricDisplay` empty logic (`MetricDisplay.svelte:74,82-85`):** `isEmpty` when `value == null || value === ''`; renders `AbsentValue` if `absentReason` + `locale`, else the muted `emptyLabel` span. Falls back gracefully.

**Bare dash / null leaks:** NONE found in rendered markup. Every `—` match in the health tree is inside HTML comments. Chains use `s.chain ?? t.noChain` ("no lineage recorded"), never a bare dash. No `null`/`N/A`/`undefined` string leaks. The copy explicitly bans fabricated values (lede). **Clean.**

---

## 6. EXPLAINER LINKS (do metrics link to /metrics how-we-measure?)

**NO. There is not a single link from `/status` to `/metrics` (or anywhere).**

- `grep` of the whole health feature for `href`/`localizeHref`/`/metrics` link usage: zero anchor/link elements. `/metrics` appears only in comments and in the `METHODOLOGY_METRIC_KEY` import, which is used to *exclude* already-carded methodology keys from the "Pipeline notes" section (`pipelineNotesOf`, `provenanceViews.ts:74-91`) — the inverse of linking.
- Metrics that WOULD warrant a how-we-measure link and don't have one:
  - Feed conformance verdict / extra-row semantics (§7) — no link to a conformance explainer.
  - Retention windows (§6) — no link.
  - The value-gate ("Value check" pass/warn/fail, §1) — explained inline via `t.gateExplain` (good, self-contained), but no deep link to a fuller methodology entry.
  - Envelope schema/methodology version (§8) — `ExplainedMetricCard` carries an always-visible col2 explanation for the generation-id (good in-place explainer), but schema/methodology-version rows are bare `MetricDisplay` with no explainer or link.
- **Verdict:** The page relies entirely on *inline* explanation (section `.note` paragraphs + the gate explainer + the one ExplainedMetricCard). That's honest but insular — it never threads the reader to the canonical `/metrics` "how we measure" surface, and conversely `/metrics` methodology keys that have a card are silently dropped here rather than linked. An A++ page would cross-link: each status metric → its `/metrics#anchor` entry.

---

## 7. MOBILE-390 READ (from code)

- **Breakpoints used ON this surface: effectively NONE.** There is not a single `@media` / `min-width` / `@container` query inside `lib/features/health/`. All responsiveness is *intrinsic*: `flex-wrap`, `minmax(0,1fr)`, `max-width` caps, `overflow-wrap:anywhere`, `text-overflow:ellipsis`. The only breakpoints that touch the page are global: the 1024px rail reveal in `AppShell` (below 1024 the rail is hidden, content sits flush, gutter = `clamp(1rem,4vw,5rem)` → `1rem` at 390px).
- **Container width at 390px:** `Surface` maxw 64rem is irrelevant; effective width = viewport − 2×`1rem` gutter ≈ 358px content column. Comfortable single column.

**Elements at risk of overflow at 390px:**
1. **`SectionRetention .health-retention` (`:62-65`) — `grid-template-columns: repeat(2, minmax(0,1fr))` with NO breakpoint collapse.** Two stat tiles stay side-by-side at 390px inside a ~358px column (2×~155px). `minmax(0,1fr)` prevents blowout, but the tiles get cramped; a null window renders an `AbsentValue` chip in a very narrow track. **Moderate risk** — readable but tight; would be better stacking on small screens.
2. **`SectionEnvelope .envelope-rows` (`:87-91`) — same fixed `repeat(2, minmax(0,1fr))`.** Schema-version + methodology-version rows side-by-side at 390px. Same tightness. **Moderate risk.**
3. **Long tokens** — `chain` strings (`SectionSources` `.health-row-chain` `overflow-wrap:anywhere`), gap tokens (`overflow-wrap:anywhere`), verbatim methodology (`72ch`, `overflow-wrap:anywhere`), unknown-member chips (`overflow-wrap:anywhere`), publish_generation_id (a long hash in `ExplainedMetricCard`). All have wrap guards → **low risk** (they wrap, they don't overflow).
4. **`SectionFreshness .health-row-feed`** — `overflow:hidden; text-overflow:ellipsis; white-space:nowrap` — a long feed name truncates rather than overflows. Low risk.
5. **`FreshnessStamp`** (as-of + per-lane last-publish) — inline-flex, `flex-wrap` on the `.health-asof` container. Low risk.

**Chart sizing on small screens:** there are **no charts** on this surface (it's tables/stats/chips only). The one adaptive card, `ExplainedMetricCard`, uses `container-type:inline-size` and only goes 2-up `@container (min-width:23rem)`, else single-column — sizes off its own box, viewport-independent, **mobile-safe**.

**Sticky behavior on mobile:** none on the page. Global TopBar (60px) stays fixed at top; the page scrolls under it in the `#main` `overflow-y-auto` box. No sticky sub-nav → on a long 8-section page the reader must scroll the whole way with no anchor.

**Touch-target sizes of controls (from classes):**
- Only interactive control on the page: the `CollapsibleSection` trigger in `SectionConformance` (the "Unmodelled fields" disclosure). Trigger = `flex w-full items-center gap-2.5 px-6 py-4` (`CollapsibleSection.svelte:169`). `py-4` = 1rem top+bottom + line-height → comfortably ≥44px tall, full-width. **Meets 44px touch target.**
- Everything else (StatusDots, chips, stamps, stats) is non-interactive display — no small tap targets.
- The `ResourceBoundary` error state's retry button (only on failure) inherits `EdgeState` sizing (not on the happy path).

**Mobile risk level: LOW-to-MODERATE.** No overflow blowouts (wrap guards everywhere), no charts to squeeze, one adequate touch target. The only real mobile weakness is the two fixed 2-column stat grids (retention, envelope) that stay 2-up and get cramped at 390px, plus the no-ToC long-scroll ergonomics.

---

## 8. TOP 5 GAPS vs an A++ portfolio case-study page

1. **No top-line health VERDICT.** The page opens on a low-level lanes table and never states an aggregate "the system is healthy / N issues" answer. A++ leads with the verdict (a hero health state derived from the StatusDots + gate) then unfolds evidence. Today the reader reverse-engineers the verdict from 8 sections. (context→evidence→verdict is inverted.)
2. **No ToC / section index / navigation.** 8 hazard-striped sections in one 64rem single column with zero jump-nav — unlike the sibling `/metrics` surface which has a ToC rail. On mobile it's a blind long-scroll. Add a sticky/anchored section index (and real anchors).
3. **Flat heading outline (a11y + scannability).** Only one real `<h1>`; all 8 section titles and every sub-label are `<span>` via `SectionLabel` (`SectionLabel.svelte:38`). Heading-navigation and the document outline see nothing below the title. A++ needs `<h2>`/`<h3>` (add a `level`/`as` prop to `SectionLabel` for these labelled regions).
4. **No cross-linking to `/metrics` how-we-measure.** Zero links out (§6). Conformance, retention, the value-gate, and the envelope versions all deserve a "how we measure this" deep link into `/metrics`; instead the page silently drops carded methodology keys. Thread every metric to its canonical explainer.
5. **Three unreconciled "freshness" readings + missing "so what."** The AS-OF stamp (provenance doc age), §1 lane publish ages, and §2 per-feed ingestion ages tell three different currency stories with no connective framing; and gaps/conformance state facts without consequences ("metro_realtime missing" → which surfaces show no metro live?). A++ narrates how the freshness signals relate and what each absence costs the reader.

Runner-up: the two fixed 2-column stat grids (Retention, Build accountability) don't collapse to one column at 390px — cramped on phones (§7).

---

## Appendix — token values referenced
- `--container-content: 64rem`, `--container-wide: 72rem` (`tokens.css:88-89`)
- `--space-page-x: clamp(1rem, 4vw, 5rem)` (`tokens.css:43`)
- `--text-subheading: 1.1875rem`, `--text-small: 0.9375rem`, `--text-caption: 0.8125rem` (`tokens.css:32,34,38`)
- `--tracking-eyebrow: 0.1em` (`tokens.css:42`), `--radius-md: 8px` (`tokens.css:47`)
- TopBar height `h-[60px]` (`TopBar.svelte:273`); rail expanded `16rem` / collapsed `4.85rem` (`AppShell.svelte:385-386`); rail reveal `@media (min-width:1024px)`.
