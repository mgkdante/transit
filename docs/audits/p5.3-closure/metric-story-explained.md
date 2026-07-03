# Metric Census — the EXPLAINED side (`/metrics` route)

Read-only analysis. Repo: `/home/mgkdante/Yesito/projects/transit`, web app `apps/web`.
Date: 2026-07-03. All paths absolute.

---

## 1. Route topology — how `/metrics` is assembled

The `/metrics` (+ `/fr/metrics`) route is a THIN mount that renders one feature screen; all
content lives in co-located data modules under `apps/web/src/lib/features/metrics/`.

| File | Role |
|---|---|
| `/home/mgkdante/Yesito/projects/transit/apps/web/src/routes/[[lang=locale]]/metrics/+page.svelte` | Thin mount — imports + renders `<MetricsExplainer />` only (12 lines). |
| `/home/mgkdante/Yesito/projects/transit/apps/web/src/routes/[[lang=locale]]/metrics/+layout.svelte` | Bare pass-through (S10 retired the rotated edge-word / accent-rail chrome). |
| `/home/mgkdante/Yesito/projects/transit/apps/web/src/lib/features/metrics/MetricsExplainer.svelte` | The screen (1276 lines). Renders provenance preamble → 14 metric cards (grouped into 5 clusters) → live-positions card → structural-gaps card. Owns ToC, FOCUS/quiet mode, hash-opener deep-link logic. |
| `/home/mgkdante/Yesito/projects/transit/apps/web/src/lib/features/metrics/metrics.content.ts` | **SINGLE SOURCE OF TRUTH** (1240 lines) — the `METRICS[]` array (14 entries, each carries definition/math/SQL/notReally/caveats), the `SUPPLEMENTAL_METRIC_TIPS`, and `metricInfoFor()` (the surface ↔ page deep-link resolver). |
| `/home/mgkdante/Yesito/projects/transit/apps/web/src/lib/features/metrics/metrics.copy.ts` | Page chrome bilingual copy — provenance preamble body, "How we measure", live-positions card, structural-gaps card, clusters, confidence legend, quiet-mode strings. |
| `/home/mgkdante/Yesito/projects/transit/apps/web/src/lib/features/metrics/MetricInfo.svelte` | The reusable (i) affordance primitive (popover: tip + deep link) that every surface mounts. |
| `/home/mgkdante/Yesito/projects/transit/apps/web/src/lib/features/metrics/EasterProse.svelte`, `easterWordHover.ts`, `easterWords.ts` | Decoration-only easter-word flourish on prose + title (not explainer content). |

Non-content sibling tests: `metrics.content.test.ts`, `metrics.copy`/`metrics.methodology.test.ts`, `MetricsExplainer.svelte.test.ts`, `MetricsExplainer.methodology.svelte.test.ts`, `MetricInfo.svelte.test.ts`.

---

## 2. The 14 explainer entries (the `METRICS[]` array)

Every entry is defined in `metrics.content.ts`. Each COVERS the full set: `definition`,
`math` (formula), `sql` (verbatim Defining SQL), `notReally` ("what it's NOT"),
`caveats` (bilingual list), plus `oneLiner` (the (i) hover tip). Data source is uniformly
GTFS-RT predicted schedule-deviation (see §5). All 14 are `confidence: 'proxy'`.

| # | key | anchor (hash) | cluster | family | sciName | Title EN / FR | Defn line |
|---|---|---|---|---|---|---|---|
| 1 | `otp` | `#otp` | punctuality | 1 | `otp_pct` | On-time % / Ponctualité | content.ts:118 |
| 2 | `avgDelay` | `#avg-delay` | punctuality | 2 | `avg_delay_min` | Average delay / Retard moyen | content.ts:194 |
| 3 | `p50p90` | `#p50-p90` | punctuality | 2 | `p50_min · p90_min` | Typical and worst-case delay / Retard typique et pire des cas | content.ts:247 |
| 4 | `severe` | `#severe` | punctuality | 3 | `severe_pct` | Severe-delay share / Part des retards graves | content.ts:303 |
| 5 | `weakStops` | `#weak-stops` | punctuality | 11 | `weak_stops` | Weak stops / Arrêts les plus en retard | content.ts:367 |
| 6 | `regularityCov` | `#regularity` | waitRegularity | 4 | `headway_cov · bunched_pct` | Headway regularity (CoV) / Régularité des intervalles (CV) | content.ts:425 |
| 7 | `headway` | `#headway` | waitRegularity | 4 | `observed_min · scheduled_min` | Observed and scheduled headway / Intervalle observé et programmé | content.ts:496 |
| 8 | `excessWait` | `#excess-wait` | waitRegularity | 4 | `excess_wait_min` | Excess wait / Attente excédentaire | content.ts:551 |
| 9 | `cancellation` | `#cancellation` | serviceDelivered | 5 | `cancellation_rate_pct` | Cancellation rate / Taux d'annulation | content.ts:602 |
| 10 | `skippedStop` | `#skipped-stop` | serviceDelivered | 8 | `skipped_stop_rate_pct` | Skipped-stop rate / Taux d'arrêts non desservis | content.ts:673 |
| 11 | `serviceSpan` | `#service-span` | serviceDelivered | 7 | `service_span_min · first/last_trip_delay_min` | Service span and first/last-trip punctuality / Amplitude de service et ponctualité du premier/dernier | content.ts:745 |
| 12 | `occupancy` | `#occupancy` | crowding | 6 | `occupancy_mix` | Occupancy mix (crowding) / Achalandage (parts par palier) | content.ts:824 |
| 13 | `habits` | `#habits` | habits | 12 | `habits.matrix · repeat_problem_relative` | Repeat-problem heatmap (7×24) / Carte des problèmes récurrents (7×24) | content.ts:900 |
| 14 | `seasonality` | `#seasonality` | habits | 9 | `day_of_week.severe_pct` | Weekday seasonality / Saisonnalité hebdomadaire | content.ts:973 |

**Anchor uniqueness:** verified — all 14 anchors are unique, URL-safe kebab-case. No collisions.
(The `metrics-content.test.ts` at lines 3, 49-73 pins EN/FR parity + non-empty coverage for
every field, and the anchor kebab-case/uniqueness invariant.)

Cluster order (`METRIC_CLUSTER_ORDER`, content.ts:107): punctuality → waitRegularity →
serviceDelivered → crowding → habits. Cluster overlines (copy.ts:277-283 / 402-408):
`01 Punctuality / 02 Wait regularity / 03 Service delivered / 04 Crowding / 05 Time-of-day habits`.

### The number badge / ToC numbering
The metric cards get a continuous "01 / 02 / …" number badge = 1-based position in the flat
`orderedMetrics` list (MetricsExplainer.svelte:148-152, 188-194). The 3 non-metric sections get
ICON badges (layers / chart / eye), not numbers.

---

## 3. The 3 NON-metric sections on the same page

These render on the same collapsible-card spine but are page-chrome (copy.ts driven), not
`METRICS[]` entries. Their anchors are defined as constants in `MetricsExplainer.svelte`.

| Section | anchor (hash) | Const @ MetricsExplainer.svelte | Copy source | ToC badge |
|---|---|---|---|---|
| Provenance preamble ("Provenance / How we measure / confidence legend") | `#metrics-provenance` | `PROVENANCE_ANCHOR` @ line 175 | copy.ts `provenance.*` (177-200 / 302-325) | icon `layers` |
| Live vehicle positions (almost-real-time explainer) | `#live-positions` | `LIVE_POSITIONS_ANCHOR` @ line 100 | copy.ts `livePositions.*` (219-244 / 344-369) | icon `chart` |
| Structural gaps ("Lacunes structurelles") | `#structural-gaps` | `LACUNES_ANCHOR` @ line 93 | copy.ts `lacunes.*` (201-218 / 326-343) | icon `eye` |

The provenance preamble is a plain `<section>` (NOT a collapsible card) — deep-links to it scroll
without any open logic (MetricsExplainer.svelte:342-353). The other two ARE collapsible cards.

The provenance preamble ALSO carries the live doctrine-constants line
(`min_n_rate` / `wilson_z`) rendered from published `provenance.methodology` (never hardcoded;
MetricsExplainer.svelte:123-136, 577-596) plus a live conformance badge and an honest-absence
stand-down when the supplementary provenance fetch fails.

### Live "Pipeline note (current run)" per card
Each metric card can render a verbatim `provenance.methodology[<key>]` string (set apart from the
static science). The mapping is `METHODOLOGY_METRIC_KEY` (content.ts:1064-1074): 9 methodology keys
map to a metric card — `otp_definition→otp`, `delay_unit→avgDelay`, `percentiles→p50p90`,
`headway→headway`, `headway_regularity→regularityCov`, `service_span→serviceSpan`,
`skipped_stops→skippedStop`, `cancellation→cancellation`, `occupancy→occupancy`.
5 methodology keys have NO metric home by design (`history_freeze`, `service_time_conversion`,
`alert_text_en`, `network_no_data`, `alert_breakdown` — content.ts:1055-1058) — they render on
`/status` instead. Resolver: `methodologyNoteFor()` (content.ts:1092-1101).

---

## 4. Supplemental (i) tips — deep-link BUT no own section

`SUPPLEMENTAL_METRIC_TIPS` (content.ts:1140-1213) — 10 keys that carry ONLY a one-line tip +
a deep-link `anchor` into an EXISTING `/metrics` section (no dedicated explainer of their own).
These are surface labels not among the 14 reliability families.

| Supplemental key | Deep-link anchor | Consumed by a surface? | Consumer file:line |
|---|---|---|---|
| `riderImpact` | `#cancellation` | YES | `lib/features/receipt/selectors/headlineKpis.ts:57` (→ AccountabilityReceipt `info()`) |
| `coverage` | `#regularity` | YES | `lib/features/network/reliability/selectors/headlineKpis.ts:65`; `routes/[[lang=locale]]/+page.svelte:458` |
| `vehicleCount` | `#headway` | YES | `lib/features/network/reliability/selectors/headlineKpis.ts:85`; `routes/[[lang=locale]]/+page.svelte:456` |
| `affectedCounts` | `#metrics-provenance` | YES | `lib/features/receipt/sections/SectionAffected.svelte:28` |
| `silentTrip` | `#skipped-stop` | YES | `lib/features/network/reliability/selectors/headlineKpis.ts:90`; `routes/[[lang=locale]]/+page.svelte:457` |
| `alertCause` | `#metrics-provenance` | **NO — UNUSED** | (none) |
| `alertEffect` | `#metrics-provenance` | **NO — UNUSED** | (none) |
| `alertSeverity` | `#metrics-provenance` | **NO — UNUSED** | (none) |
| `alertDuration` | `#metrics-provenance` | **NO — UNUSED** | (none) |
| `alertReach` | `#metrics-provenance` | **NO — UNUSED** | (none) |

**Finding (dead code):** the 5 `alert*` supplemental keys (`alertCause`, `alertEffect`,
`alertSeverity`, `alertDuration`, `alertReach`) are DEFINED in `SUPPLEMENTAL_METRIC_TIPS` but NEVER
consumed by any surface (full-tree grep across `--include=*.svelte --include=*.ts`, excluding the
definition file + tests, returns zero hits for each). The `/alerts` surface
(`lib/features/alerts/AlertHistory.svelte:252-260`) mounts a `MetricInfo` but hardcodes a BARE
`/metrics` href (`href={`/${locale === 'fr' ? 'fr/' : ''}metrics`}`) with NO `#anchor` and does
NOT call `metricInfoFor` — so the 5 alert-dimension tips have no live wiring. They land on the top
of `/metrics`, not on any alert-specific copy (and there is no alert explainer section anyway).

---

## 5. What each explainer COVERS (uniform contract)

Rendered per metric card in `MetricsExplainer.svelte:630-684`:
- **Definition** (`entry.definition`) — plain-language lead paragraph, via `EasterProse`.
- **The math / Le calcul** (`entry.math`) — formula, mono voice.
- **The SQL / Le SQL** (`entry.sql`) — verbatim Defining SQL in a `CodeBlock` (language-neutral,
  reused for both locales).
- **What it's NOT / Ce que ce n'est PAS** (`entry.notReally`) — the citizen-misread warning.
- **Caveats / Limites** (`entry.caveats`) — bilingual honest-caveat list.
- **`sciName`** mono label + confidence chip in the card meta row.
- Optional live **Pipeline note (current run)** block (§3).

Cross-cutting DATA SOURCE + doctrine (copy.ts provenance body, 179 / 304): source = GTFS-RT
PREDICTED schedule-deviation (`delay_seconds`) + alerts; NO GPS/AVL ground truth; not
agency-certified OTP; observation-weighted; on-time band `[-60s, +300s)`; severe `> 300s`;
ghost guard `|delay| ≤ 3600s`; NULL = "no data" never fabricated 0; `__unrouted__` /
`__unknown_stop__` sentinels are never real. This doctrine is echoed in every entry's caveats.

---

## 6. Deep-link inventory — who reaches the explainer, and which anchor

The (i) affordance is `metricInfoFor(key, locale)` (content.ts:1226-1239), which returns
`{ tip, href, anchor }` with `href = /metrics#<anchor>` (or `/fr/metrics#<anchor>`). Surfaces
call it (directly or through a local `info()` / `{@render metricInfo(key,name)}` snippet) and
feed `MetricInfo.svelte`.

### 6a. Surface files that call `metricInfoFor` (20 files)
All under `apps/web/src`:
- `routes/[[lang=locale]]/+page.svelte:56,214` (home explore lists)
- `lib/features/stops/reliability/sections/StopReliabilitySurface.svelte:44,242`
- `lib/features/stops/reliability/sections/SectionTimeOfDay.svelte:15,30`
- `lib/features/stops/reliability/sections/SectionHabits.svelte:19,34`
- `lib/features/stops/reliability/sections/SectionCrowding.svelte:18,38`
- `lib/features/stops/reliability/sections/SectionByRoute.svelte:15,32`
- `lib/features/stops/reliability/sections/SectionWeekday.svelte:15,29`
- `lib/features/stops/reliability/sections/SectionPercentiles.svelte:15,29`
- `lib/features/lines/RouteDetail.svelte:57,78`
- `lib/features/lines/reliability/sections/Section0Verdict.svelte:33,73`
- `lib/features/lines/reliability/sections/Section1WhenToRide.svelte:41,92`
- `lib/features/lines/reliability/sections/Section2TheWait.svelte:48,233`
- `lib/features/lines/reliability/sections/Section3RunAndFit.svelte:51,94,283,294`
- `lib/features/lines/reliability/sections/Section4WorstStops.svelte:31,50`
- `lib/features/network/reliability/sections/NetworkSurface.svelte:69,114`
- `lib/features/hotspots/HotspotsBoard.svelte:55,78`
- `lib/features/receipt/AccountabilityReceipt.svelte:56,86`
- `lib/features/repeat-offenders/RepeatOffenders.svelte:56,80`

`MetricInfo.svelte` itself is mounted in ~34 surface components (full list gathered; every
reliability section on stops / lines / network / receipt / hotspots / repeat-offenders / home /
alerts, plus `lib/components/dataviz/ExplainedMetricCard.svelte`).

### 6b. Every one of the 14 metric explainers IS deep-linked from ≥1 surface
Verified by tracing the `key` literal passed through `metricInfoFor` / the `metricInfo` snippet:

| Explainer key (anchor) | Reached from (representative surfaces) |
|---|---|
| `otp` (#otp) | Section0Verdict, Section1WhenToRide, network SectionTrend, receipt SectionHeadline/SectionWorst, StopReliabilitySurface, home +page |
| `avgDelay` (#avg-delay) | Section0Verdict, stops SectionByRoute, StopReliabilitySurface |
| `p50p90` (#p50-p90) | Section0Verdict, network SectionDelayHistogram (headlineKpis), stops SectionPercentiles |
| `severe` (#severe) | hotspots, Section0Verdict/Section1WhenToRide, network SectionByTimeOfDay, receipt SectionTimeOfDay, repeat-offenders, stops SectionTimeOfDay/StopReliabilitySurface |
| `weakStops` (#weak-stops) | `Section4WorstStops.svelte:139` (`{@render metricInfo('weakStops', …)}`) |
| `regularityCov` (#regularity) | `Section2TheWait.svelte:692,776,783` |
| `headway` (#headway) | `Section2TheWait.svelte:691,749`; RouteDetail |
| `excessWait` (#excess-wait) | `Section2TheWait.svelte:648,769,791` |
| `cancellation` (#cancellation) | Section3RunAndFit, network SectionCancellations/SectionCompleteness, receipt SectionStateCuts |
| `skippedStop` (#skipped-stop) | `Section3RunAndFit.svelte` |
| `serviceSpan` (#service-span) | `Section2TheWait.svelte:847,873,884,895,906`; RouteDetail |
| `occupancy` (#occupancy) | Section3RunAndFit (283,294), network SectionCrowdingByDay/SectionStatusMix, stops SectionCrowding |
| `habits` (#habits) | `SectionHabits.svelte:97`; Section1WhenToRide |
| `seasonality` (#seasonality) | network SectionWeekday, stops SectionWeekday, Section1WhenToRide |

(NB: the `metricInfo` calls use the `{@render metricInfo('<key>', name)}` snippet form, which is
why a naive `key: '<key>'` grep under-counts wait/service/habits keys — they are all live.)

### 6c. Non-metric section deep-links
- `#live-positions` — deep-linked from the map's "How this works" control:
  `lib/features/map/MapMotionControl.svelte:51`
  (`const explainHref = ${localizeHref('/metrics', locale)}#live-positions`), text from
  `lib/features/map/map.copy.ts:110`. This id is load-bearing per the MetricsExplainer.svelte:95-100
  comment (must not change).
- `#metrics-provenance` — the back-to-top target (`href="#metrics-provenance"` at
  MetricsExplainer.svelte:683,718,749) and the deep-link anchor for the `affectedCounts` +
  the 5 (unused) `alert*` supplemental tips.
- `#structural-gaps` — no external deep-link found (reached only via the page's own ToC / pill).

### 6d. Deep-link REVEAL machinery
The page is DEFAULT-CLOSED (every card collapsed). A `/metrics#<anchor>` deep-link must reveal its
target: `openFromHash()` (MetricsExplainer.svelte:362-374) runs on mount + `hashchange`, and opens
the target card if the anchor is in `openableAnchors` (the 14 metrics + live-positions +
structural-gaps; the provenance preamble is deliberately excluded because it is not a card).

---

## 7. Staleness relative to current metric names

**Verdict: no in-code staleness.** The explainer `name` / `sciName` labels match the current
pipeline field names, and the one known re-point is self-documented and reconciled.

- **`seasonality`** (content.ts:973-1038) — the file's DRIFT NOTE (content.ts:8-17) records that
  this family was re-pointed AHEAD of the Notion "Metric Science Reference" cards (per the
  drift law). On-disk copy already reflects the CURRENT source: `route.spine.dow` projector over
  `gold.route_delay_spine` (whole-history, 730-day retention), migration 0064 dropped the old
  ~10-day `gold.route_delay_day_of_week` fold. Its `sciName` is intentionally kept as the stable
  label `day_of_week.severe_pct`. Caveats (content.ts:1022,1032) name the reconciliation
  explicitly ("ALL-HISTORY window (reconciled S14, 2026-07-02) … the old …-windowed …fold …
  was DROPPED (migration 0064)"). → The stale artifact is the NOTION card, not the on-disk copy.
- **`p50p90`** (content.ts:247-301) — DRIFT NOTE records the retention caveat corrected
  365 → 730 days to cite `provenance.methodology.percentiles` ("retained 730 days"); the on-disk
  caveat (content.ts:291,298) already says 730d. Reconciled.
- **`avgDelay` / `severe` / seasonality** — all carry the corrected honesty framing: `avg_delay_min`
  is called an observation-weighted MEAN, "not a median" (content.ts:226,236 etc.), the historic
  "median" mislabel is explicitly forbidden from returning. Not stale.
- `sciName` labels (`otp_pct`, `avg_delay_min`, `p50_min · p90_min`, `severe_pct`, `weak_stops`,
  `headway_cov · bunched_pct`, `observed_min · scheduled_min`, `excess_wait_min`,
  `cancellation_rate_pct`, `skipped_stop_rate_pct`, `service_span_min · first/last_trip_delay_min`,
  `occupancy_mix`, `habits.matrix · repeat_problem_relative`, `day_of_week.severe_pct`) all read as
  current identifiers; no legacy names (e.g. no "median" sciName, no dropped-table references in a
  live sciName).

### Potential rot to flag (not a name-staleness, but wiring rot)
- The 5 `alert*` supplemental tips (§4) are dead — either the `/alerts` surface should wire them
  through `metricInfoFor` (giving each alert dimension its honest (i) tip + a deep link, currently
  it only links to bare `/metrics`), or the 5 keys should be removed from
  `SUPPLEMENTAL_METRIC_TIPS`. They currently all point at `#metrics-provenance`, which is generic.

---

## 8. Counts summary

- **Total explainer entries (own full section):** 14 (the `METRICS[]` families).
- **Total non-metric sections on the page:** 3 (provenance preamble, live-positions,
  structural-gaps).
- **Total distinct hash anchors on the page:** 17 (14 metric + `metrics-provenance` +
  `live-positions` + `structural-gaps`). All unique.
- **Supplemental (i)-only tips (no own section):** 10 (`SUPPLEMENTAL_METRIC_TIPS`); 5 consumed
  (`riderImpact`, `coverage`, `vehicleCount`, `affectedCounts`, `silentTrip`), 5 UNUSED (the
  `alert*` set).
- **Explainers deep-linked from ≥1 surface:** 14 of 14 metric families (100%); plus
  `live-positions` (from the map). `structural-gaps` has no external deep-link.
- **Surface files that call `metricInfoFor`:** 20. `MetricInfo.svelte` mounted in ~34 components.
- **Stale explainers (name mismatch vs current metric):** 0 on-disk. 2 families (`seasonality`,
  `p50p90`) were reconciled on disk AHEAD of Notion per the drift law (Notion cards are the stale
  side, not the code). 1 wiring-rot flag: 5 dead `alert*` supplemental tips.
