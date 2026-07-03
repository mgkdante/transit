# Surface Anatomy — `/repeat-offenders` (Récidivistes)

Route: `apps/web/src/routes/[[lang=locale]]/repeat-offenders/+page.svelte`
Feature root: `apps/web/src/lib/features/repeat-offenders/`
Analyzed head: `main` (post P5.2, commit 2273280). READ-ONLY analysis; no files modified.

## File map (what composes this surface)

| Layer | File | Role |
|---|---|---|
| Route | `routes/[[lang=locale]]/repeat-offenders/+page.svelte` | Thin mount. Imports + renders `<RepeatOffenders />`. No `+page.ts`, no `+layout`. Locale from context. |
| Root layout | `routes/+layout.svelte` | Wraps EVERY page in `AppShell`; provides `#main` scroll container (`overflow-y-auto`), locale + v1 context, Footer. |
| Orchestrator | `lib/features/repeat-offenders/RepeatOffenders.svelte` (466 lines) | Owns the resource, grain/worst-N state + URL mirror, the ONE mapping pass, all layout. |
| Section presenter | `.../sections/RepeatOffendersSection.svelte` (399 lines) | Pure. trip\|vehicle tabs, ladder chart, recurrence list, tray, worst-N picker. |
| Copy | `.../repeatOffenders.copy.ts` | Bilingual EN/FR strings, all user-facing prose. |
| Selectors | `.../selectors/offenderLadder.ts` (primary, magnitude-bars spec), `.../selectors/offenderLedger.ts` (legacy fallback RankedRow VM) |
| Data helpers | `.../data/presentGrains.ts` (grain availability), `.../data/ladderCap.ts` (worst-N rungs) |
| Shared surface | `components/surface/{SurfaceHeader,FreshnessStamp,SurfaceControls,ResourceBoundary,GrainPicker}.svelte`, `components/layout/{Surface,ControlsRail,DashboardGrid}.svelte`, `components/dataviz/{ExplainedMetricCard,RankedRow}.svelte`, `components/dataviz/chart/{Chart,ChartFrame,MagnitudeBarsMark}.svelte`, `components/brand/{SectionLabel,SectionHeading}.svelte`, `components/edge/AbsentValue.svelte`, `features/metrics/MetricInfo.svelte` |

There are TWO render paths (mutually exclusive, chosen in the orchestrator):
- **PRIMARY** (`hasGrains`, `by_grain` populated): the S14 recurrence ladders with grain rail + tabs.
- **LEGACY FALLBACK** (`hasLegacy`, only scalar `offenders[]`): a flat `RankedRow` list on `DELAY_DIST_DOMAIN [0,15]`.
- **EMPTY** (neither): a single centered `AbsentValue` block.

---

## (1) SECTION ORDER + STORY ARC

Top-to-bottom DOM order inside `<Surface width="bleed">` (RepeatOffenders.svelte:286–412).

### Primary path (the shipped state)

| # | Heading / element | Component | Data source / selector | Reader question answered |
|---|---|---|---|---|
| 1 | `SurfaceHeader` — kicker `ACCOUNTABILITY · REPEAT OFFENDERS`, h1 "Repeat offenders", subheading `// RÉCIDIVISTES`, lede | `SurfaceHeader` (RO:287) | copy `t.kicker/heading/subheading/lede` | "What is this page?" — the trips/vehicles that run severely late day after day. |
| 1b | Freshness stamp (nested in header) | `FreshnessStamp variant="updated"` (RO:288) | `offenders.data.generated_utc` | "How fresh is this?" |
| — | Hazard separator | `Separator variant="hazard"` (RO:291) | — | visual break |
| 2 | Headline metric tile — label "Severe-delay rate", **value = null**, always-visible explanation, (i) → /metrics#severe | `ExplainedMetricCard` (RO:304–321) | static copy `t.headline.*`; `severeInfo` (metricInfoFor) | "What does the ranking measure and how do I read it?" |
| 3 | Grain rail (Week / Month) — **only rendered when >1 grain populated** | `SurfaceControls sticky` (RO:323–336) | `present`/`grainAvailability` from `presentGrains` | "Over what window?" |
| 4 | The ladder region — trip\|vehicle TABS, each: heading "Worst offenders · shown/total" + (i), worst-N picker, window caption, lollipop chart, per-row recurrence list, un-ranked tray | `RepeatOffendersSection` (RO:338–351) | `tripLadder/vehicleLadder` (selectOffenderLadder), `tripRecurrence/...`, `tripTray/...` | "Who are the worst offenders, how bad, and how often?" |
| 5 | Caveat paragraph | `<p class="repeat-offenders-caveat">` (RO:354) | `t.caveat` | "How much should I trust this?" |

### Legacy fallback path (RO:356–404)

| # | Heading / element | Component | Data | Question |
|---|---|---|---|---|
| 1 | Same `SurfaceHeader` + freshness + hazard separator | — | — | "What is this?" |
| 2 | Section label "Worst first" + (i) | `SectionLabel variant="station"` + `MetricInfo` (RO:359–368) | `t.listSection` | "What list is this?" |
| 3 | Row caption | `<p>` (RO:369) | `t.rowCaption` | — |
| 4 | Ranked list — `RankedRow bare` on `DELAY_DIST_DOMAIN [0,15]`, `absentReason="no-observations"` | `DashboardGrid as="ul"` + `RankedRow` (RO:370–402) | `legacyRows` (buildOffenderLedger) | "Which entities, ranked by avg delay?" |
| 5 | Caveat | `<p>` (RO:403) | `t.caveat` | trust |

### Story-arc assessment

**Context → Evidence → Verdict trace (primary path):**
- **Context** is present and strong: h1 + lede + the always-visible `ExplainedMetricCard` explanation is one of the best "how to read this" openers in the app. It defines the severe-delay rate, the Wilson-LB ranking rationale, and the recurrence line, all before the reader hits a single bar.
- **Evidence** is present: the ladder bars (magnitude on absolute [0,100]), the per-row recurrence line ("late-prone on N of M observed days"), the CI whiskers, n counts, and the tray for sub-floor entities.
- **Verdict** is the WEAK link. The page never resolves to a takeaway. There is no "the single worst offender is X", no count roll-up ("42 trips are chronic offenders this week"), no trend ("worse than last week"). The reader gets a ranked list and a caveat, then the page ends. It reads as a *table with good chrome*, not a *story that concludes*.

**Where the story stalls / breaks:**
1. **The headline tile has no number.** `ExplainedMetricCard value={null}` (RO:305) renders the "empty" state of a metric card as the page's hero. It is a paragraph in a card, not a headline metric. A portfolio hero should state the finding: e.g. "12 trips chronically severe this week" or the worst offender's rate. Right now scroll-depth-0 gives definition, not signal.
2. **The grain rail vanishes when only one grain is populated** (`showGrainPicker = present.size > 1`, RO:113). In the common single-grain state the reader has no cue that a Week/Month choice exists at all — the story loses its "over what window" beat silently. The window caption still appears inside the section, but the control disappears.
3. **Tabs hide half the data by default.** trip vs vehicle are LOCAL tabs (RepeatOffendersSection:128) with no URL persistence and no at-a-glance count on the inactive tab. The reader must click to discover vehicles exist; the inactive kind's magnitude is invisible. For a "who are the offenders" story this splits the answer.
4. **No cross-entity comparison / no map or line context.** Each row drills to `/lines/{route}`, but the page itself never situates an offender against the network (is 30% severe bad? vs the network median?). Evidence is per-row, never benchmarked.
5. **The tray ("below the reliable-reading floor") is narratively inverted** — it appears AFTER the ranked ladder as a quiet dashed block, but it is a coverage caveat, not a finding. Fine as-is, but it competes with the closing caveat paragraph for the "trust" beat.

**Missing beats for an A++ story:** a stated verdict/count in the hero; a "vs last period" delta; a compact leaderboard that shows both kinds at once (or count chips on tabs); an explicit "what would fix this" or "who owns this" accountability line to match the ACCOUNTABILITY kicker.

---

## (2) CHROME

- **No page-level chrome inside this surface.** All persistent chrome (TopBar h≈60px, LeftRail, Footer) lives in `AppShell` via `routes/+layout.svelte`. The route file is a 3-line mount.
- **Scroll container:** the page scrolls inside `#main` (`routes/+layout.svelte:480–484`, `overflow-y-auto`), NOT the window. `#main` begins BELOW the 60px TopBar.
- **Sticky element:** exactly one — the grain rail. `SurfaceControls sticky` (RO:329) → `ControlsRail --sticky` → `position: sticky; top: var(--rail-sticky-top, 5.5rem)` (ControlsRail.svelte:122), gated `@media (min-width:1024px)` only. `z-index: var(--z-rail)`.
  - **`--chrome-offset`: not used anywhere.** Grep found no `--chrome-offset` token in the repo. The sticky offset variable is `--rail-sticky-top`.
  - **BUG RISK (offset mismatch):** this surface does NOT set `--rail-sticky-top`, so it inherits the default `5.5rem` (~88px). That default is documented as "the window-scrolled assumption" (ControlsRail.svelte:118–121). But here the scroll container is `#main`, which already starts under the TopBar. So the rail will pin **~88px below the top of its scroll container**, with scrolled content visible through that gap. The only surface that fixes this — `RouteReliabilityClusters.svelte:656` — sets `--rail-sticky-top: 0px`. This surface should almost certainly do the same (or a small value covering the ExplainedMetricCard). This is a concrete, verifiable chrome defect.
- **Rails:** the grain rail is the only rail; there is no left ToC / jump-nav rail (`SurfaceControls` supports a `nav` slot but this surface passes none). No RailLayout / two-column rail split (unlike /lines).
- **Full-bleed:** `Surface width="bleed"` (RO:286) → `max-width: none`, so the surface spans the whole content column; inner regions re-cap width (see Containers).

---

## (3) CONTAINERS

- **Outer:** `Surface width="bleed" pad="surface" gutter=true` (RO:286). `max-width: none`; `padding-inline: var(--space-page-x)`; `padding-block: clamp(1.5rem,4vw,2.5rem)`; `gap: clamp(1.75rem,4vw,2.75rem)` between direct children (Surface.svelte:42–61).
- **Inner width caps (re-narrow the bled surface):**
  - `.repeat-offenders-region` — `max-width: 76rem` (RO:419), `display:flex column`, `gap:1rem`. This holds the whole primary path (hero tile, rail, section, caveat).
  - `.dashboard-grid.repeat-offenders-ranked` (legacy list) — `max-width: 76rem` (RO:433).
  - `DashboardGrid minTile="360px" gutter=false` for the legacy list (RO:370–376) — auto-fit grid of ≥360px tiles.
- **ExplainedMetricCard:** `container-type: inline-size`; internal 2-up (`minmax(7rem,12rem) minmax(0,1fr)`) engages `@container (min-width:23rem)` (ExplainedMetricCard.svelte:152). Card padding `1.1rem 1.25rem`.
- **ControlsRail:** `padding:1rem`, `border:1px var(--border)`, `border-radius:var(--radius-lg)`, `background:var(--card)`.
- **Section internals (RepeatOffendersSection):** `.offender-section` flex column `gap:0.625rem`; tab pane `gap:0.625rem; padding-top:1rem`; captions capped `max-width:52ch`; tray separated by `1px dashed var(--border)` top border.
- **Padding rhythm:** consistent token use (`--space-page-x`, `--radius-lg`, clamp-based block padding). Gaps are small and hand-tuned (0.625/0.75/1rem) — coherent but the region uses a flat `1rem` gap for everything (hero, rail, section, caveat) so there is little visual grouping/hierarchy between a hero and a data section.
- **Lede + captions:** measure-capped at `52ch` (SurfaceHeader.svelte:66, section captions). Good reading discipline.

---

## (4) HEADINGS — hierarchy sanity

**This is the biggest structural gap on the page.**

- **h1:** exactly one, via `SurfaceHeader → SectionHeading level=1` (SurfaceHeader.svelte:47, default `level=1`). Text: "Repeat offenders". Correct and unique.
- **h2 / h3 / h4: NONE.** Every sub-section heading below the h1 is a `SectionLabel`, which renders a **`<span>`** (SectionLabel.svelte:38), not a heading element and with no `role="heading"`:
  - "Worst offenders" ladder heading → `SectionLabel variant="metric"` (RepeatOffendersSection:166,199,243) = `<span>`.
  - "Below the reliable-reading floor" tray heading → `<span>` (RepeatOffendersSection:211).
  - Legacy "Worst first" section → `SectionLabel variant="station"` (RO:361) = `<span>`.
  - The trip/vehicle tabs are `<button>`s, not headings.
- **Consequence:** the document outline is `h1 → (nothing)`. A screen-reader user navigating by heading lands on the page title and then finds NO way to jump to the ladder, the tray, or the offender list. There are no skipped levels (h1→h3) because there are simply no sub-headings at all. This is a hierarchy/semantics failure, not a level-skip.
- **Fix direction:** the ladder heading should be an `<h2>`, tray an `<h3>` (or `SectionLabel` should support an `as`/`level` prop). This is shared-primitive behavior, so worth noting it likely affects other surfaces too.

---

## (5) ABSENCE STATES

The surface is unusually disciplined here (this is a strength, consistent with the site-wide unknown-data layer).

- **Whole-surface empty:** `ResourceBoundary` `isEmpty` gate (RO:296–300) → `AbsentValue variant="block" reason="no-observations"` centered (RO:407–409). Honest "no data + why".
- **Per-kind empty (tab with tray but no ranked rows):** `AbsentValue variant="block" reason="no-observations"` (RepeatOffendersSection:202).
- **Whole-section empty (grain served no ranked entry of either kind):** `AbsentValue variant="block"` (RepeatOffendersSection:246).
- **Selector-level absence:** `selectOffenderLadder` returns an `{kind:'absence'}` spec when `shown===0` (offenderLadder.ts:80–92), rendered by `Chart` → `AbsentValue`.
- **Per-row null value:** `value: e.severe_pct ?? null` (offenderLadder.ts:100) → MagnitudeBars draws its own no-data swatch; severity of a null bands to quietest via `severeShareToSeverity(null)`.
- **Per-row evidence note null-guards:** `ladderNote` (RO:156–165) and `recurrenceLinesFor` (RO:197–209) fall back to `t.recurrence.unknown` ("recurrence not recorded") when counts are absent — never a fabricated frequency.
- **Legacy rows:** `RankedRow ... absentReason="no-observations"` (RO:396); `buildOffenderLedger` uses published severity, unknown → quietest `'watch'` (offenderLedger.ts:29–32) — never a fabricated hot band. `fmtMin(null)` returns null → RankedRow shows honest absence.
- **Grain disabled reason:** `SurfaceControls` surfaces a `describeAbsence` reason via `aria-describedby` + `title` on disabled grain radios (SurfaceControls.svelte:151–174).

**Bare dash / null leaks:** none found. The per-row evidence note joins fragments with ` · ` (RO:164) — if a middle fragment is absent it is simply omitted, no empty `·` dangling (each fragment is conditionally pushed). Copy explicitly forbids em-dashes in absence strings and uses "no data"/"aucune donnée". **No leak detected.**

---

## (6) EXPLAINER LINKS

**Yes — wired correctly, in three places, all to `/metrics#severe`.**

- Built in the orchestrator: `severeInfo = buildInfo('severe', ...)` → `metricInfoFor('severe', locale)` → `href: ${localizeHref('/metrics', locale)}#severe` (RO:78–83; metrics.content.ts:1226–1237). So EN → `/metrics#severe`, FR → `/fr/metrics#severe`. The `severe` metric entry has `anchor:'severe'` (metrics.content.ts:303–304), which exists on the /metrics page.
- Rendered via `MetricInfo` (the (i) popover) in:
  1. the headline `ExplainedMetricCard info` snippet (RO:312–320),
  2. inside the section on the ladder heading (RepeatOffendersSection:167–174),
  3. the legacy-path section label (RO:362–367).
- The popover is same-tab, back-button-friendly, edge-aware, keyboard/focus accessible (MetricInfo.svelte).

**Gap:** only the SEVERE metric is explained. The surface also surfaces the **recurrence** concept ("N of M observed days"), the **Wilson CI / ranking**, and "observed days coverage" — none of these have an (i) link, though they're arguably the more novel concepts a citizen needs. The always-visible `explanation` prose covers them, but there is no deep-link to a canonical definition for recurrence or Wilson-LB ranking. For A++ every distinct metric idea on the page should link out.

---

## (7) MOBILE-390 READ (from code)

**Breakpoints in play:**
- `@media (min-width:1024px)` — the ONLY structural breakpoint that touches this surface. It (a) reveals the LeftRail (AppShell), and (b) turns ON `position:sticky` for the grain rail (ControlsRail.svelte:108). **Below 1024px the grain rail is NOT sticky** (a deliberate "don't eat phone viewport" choice, ControlsRail.svelte:12–14). Good.
- `@container (min-width:23rem)` — ExplainedMetricCard flips to 2-up (ExplainedMetricCard.svelte:152). At 390px viewport minus gutters minus 76rem cap, the card is ~330–350px wide → likely just above 23rem (368px), so it MAY go 2-column on a 390px phone, squeezing the 12rem label track. Borderline; worth a visual check.
- No other component-level mobile media queries in the feature files.

**Elements at risk of overflow at 390px:**
- **The magnitude-bars chart.** `MagnitudeBarsMark` sets `frameHeight = rows*1.35+3 rem` and a left gutter `categoryGutter(labels, {min:96, max:216})` (MagnitudeBarsMark.svelte:38–46). On a 390px screen with a worst-N of 10 and long route names, the gutter can eat up to 216px, leaving <150px for the bars — bars become tiny and value ticks ("100") crowd. The chart has NO horizontal scroll for the bars (ScrollFrame is used only by the heatmap, not by MagnitudeBarsMark). It relies on container width + label truncation. Risk: cramped bars + truncated labels on narrow screens; the drill-tooltip carries the full name so it is not data loss, but it is a legibility risk.
- **The trip/vehicle tab bar** — `TabsList class="w-full justify-start"` with two `.station-tab` buttons; two tabs fit, low risk.
- **The section head row** — `.offender-section-head` is `flex-wrap:wrap; justify-content:space-between` (RepeatOffendersSection:265–271): the worst-N `GrainPicker` wraps to its own row on narrow, so no crush. Good.
- **The grain rail body** — `flex-wrap:wrap` (SurfaceControls / ControlsRail body). Good.
- **Recurrence list rows** — `flex-wrap:wrap` (RepeatOffendersSection:338–347). Good.
- **Lede / captions** — `52ch` cap; on a 390px phone 52ch mono may still slightly exceed width but wraps; low risk.

**Touch-target sizes (from classes):**
- **GOOD:** `GrainPicker` pills (grain rail Week/Month AND the worst-N rungs) explicitly enforce `min-height:44px` (GrainPicker.svelte:151, with a WCAG 2.5.8 comment). RankedRow links are full-width blocks.
- **AT RISK — trip/vehicle tabs:** `.station-tab` (RepeatOffendersSection:293–309) has `padding:0.5rem 1rem`, `font-size:var(--text-small)` (0.9375rem), NO `min-height`. Computed height ≈ 15px text + 16px padding ≈ **~31–34px** — below the 44px target the sibling GrainPicker deliberately meets. These are the primary navigation control of the section. This is a concrete touch-target gap.
- **AT RISK — MetricInfo (i) trigger:** `1.05rem × 1.05rem` (~17px) circle (MetricInfo.svelte:329–331) — well below 44px. It's a secondary affordance but still a small tap target; appears 1–3× on the page.
- **Tray links** (`.offender-tray-link`) — inline-flex, no min-height; small mono text rows, likely <44px tall. Secondary/quiet, but a tap target.

**Chart sizing strategy on small screens:** width-fluid via `ChartFrame` (100% width, ResizeObserver-gated so it never mounts at 0×0 — good for the tab-hidden case); height grows with row count. No small-screen-specific reflow (no switch to a stacked/list form). The chart depends entirely on container width + label truncation to fit 390px.

**Sticky behavior on mobile:** grain rail sticky is **disabled** below 1024px (correct). No other sticky elements. So no mobile sticky-offset problem — the `--rail-sticky-top` bug (see §2) is a **desktop-only** defect.

---

## (8) TOP 5 GAPS vs an A++ portfolio case-study page

1. **The hero states no finding.** `ExplainedMetricCard value={null}` (RO:305) makes the page open on a definition-in-a-card, not a headline number. A++ opens with the verdict: the worst offender's severe rate, or a count ("N chronic offenders this week"), with the explanation as support. Right now context is excellent but the *lead* is buried. → give the hero a real value (worst-rate or offender count) + a delta vs prior period.

2. **No semantic sub-headings (h1→nothing).** Every section heading is a `<span>` via `SectionLabel` (SectionLabel.svelte:38; used at RO:361, RepeatOffendersSection:166/199/211/243). The document outline and SR heading-nav are broken below the title. → make ladder = `<h2>`, tray = `<h3>` (add `as`/`level` to `SectionLabel`).

3. **Desktop sticky-rail offset is wrong.** The grain rail inherits `--rail-sticky-top:5.5rem` while its scroll container `#main` already starts under the TopBar, so it floats ~88px down with content bleeding through (ControlsRail.svelte:118–122; fix pattern at `RouteReliabilityClusters.svelte:656`). → set `--rail-sticky-top:0` (or a small hero-clearing value) on this surface.

4. **The answer is split behind tabs with no at-a-glance totals or verdict.** trip vs vehicle are local, un-persisted tabs (RepeatOffendersSection:128) with no count on the inactive tab and no combined leaderboard. The reader can't see "how many offenders total" or compare kinds without clicking. → add count chips to each tab label, persist the active kind in the URL, and/or show a one-line roll-up ("X trips + Y vehicles chronically severe").

5. **Thin metric explainer + touch-target inconsistency undercut polish.** Only `severe` links to /metrics; recurrence and Wilson-LB ranking (the page's novel ideas) have no deep link. And the section's primary tab control (`.station-tab`, ~31px) plus the (i) glyph (~17px) fall below the 44px target that the neighboring GrainPicker explicitly enforces — a visible inconsistency on a page that otherwise nails accessibility. → add (i) links for recurrence + ranking; give `.station-tab` `min-height:44px`.

### Notable strengths (for balance)
- Best-in-app "how to read this" via the always-visible `ExplainedMetricCard` explanation.
- Rigorous, leak-free absence handling end to end (selector → chart → row → legacy).
- Honest doctrine-clean magnitude domain (absolute [0,100], no in-view normalization), off the chart-doctrine allowlist.
- Clean URL codec mirroring (grain + worst-N via one `replaceState`, defaults omitted).
- Correct mobile decision to drop rail stickiness below 1024px; 44px pills on the pickers.
