# METRIC STORY — reconciling SHOWN ↔ EXPLAINED

Read-only reconciliation of the two censuses:
- SHOWN: `…/reports/metric-story-shown.md` (every displayed metric + its presentation contract).
- EXPLAINED: `…/reports/metric-story-explained.md` (the `/metrics` explainer catalog).

Repo: `/home/mgkdante/Yesito/projects/transit`, web app `apps/web`. All paths absolute unless
prefixed `src/…` (then relative to `apps/web/`). Date: 2026-07-03.

**Canonical registry:** `apps/web/src/lib/features/metrics/metrics.content.ts` —
14 primary `METRICS[]` (each with a stable `/metrics#<anchor>`) + 10 `SUPPLEMENTAL_METRIC_TIPS`
(deep-link tips, no own section) + the `metricInfoFor(key, locale)` resolver (content.ts:1226-1239).

---

## 0. Ground-truth correction to the SHOWN census (verified against source THIS pass)

The SHOWN census (`metric-story-shown.md`) contains ONE material error that changes the orphan
lists. I verified the true wiring by reading source directly:

- **SHOWN §2F / §4.3 claim the seven `/stops/[id]` reliability sub-sections have "NO per-section
  `(i)`".** This is **FALSE.** Every stops sub-section imports `MetricInfo` + calls `metricInfoFor`
  and renders a `(i)` on its heading. Verified:
  - `src/lib/features/stops/reliability/sections/SectionPercentiles.svelte:15,29,50` → `p50p90`
  - `.../SectionWeekday.svelte:15,29,49` → `seasonality`
  - `.../SectionTimeOfDay.svelte:15,30,50` → `severe`
  - `.../SectionCrowding.svelte:18,38,62` → `occupancy`
  - `.../SectionByRoute.svelte:15,32,53` → `avgDelay`
  - `.../SectionHabits.svelte:19,34,97` → `habits`
  - `.../StopReliabilitySurface.svelte:321-323` → `otp`/`avgDelay`/`severe` (pane)
  - The EXPLAINED census §6a is the correct one — it lists all these files as `metricInfoFor`
    callers. `SectionDailyTrend.svelte` is the ONE stops sub-section with no `MetricInfo`
    (verified: zero hits), and its metric — a daily OTP/delay TREND — has no distinct catalog
    family beyond `otp`/`avgDelay` already explained on the pane.

  → **Net effect:** the stops reliability surface is NOT a SHOWN-BUT-UNEXPLAINED cluster. It drops
  out of the orphan list. The genuine SHOWN-BUT-UNEXPLAINED set is smaller and concentrated on
  **alerts** + a few glance/live surfaces.

Everything else in the SHOWN census reconciles with source and with the EXPLAINED census. Confirmed
true (verified this pass):
- `AlertHistory.svelte:254` href = bare `` `/${locale === 'fr' ? 'fr/' : ''}metrics` `` (NO
  `#anchor`, does NOT call `metricInfoFor`). The ONLY convention break. Confirmed.
- `src/lib/features/alerts/sections/AlertBreakdown.svelte` — grep for `MetricInfo`/`metricInfoFor`
  returns ZERO. Cause/effect/severity RankedRows carry no explainer. Confirmed.
- `src/lib/features/receipt/sections/SectionNotReported.svelte` — zero `MetricInfo`. Confirmed.
- Home pulse tiles (`src/routes/[[lang=locale]]/+page.svelte:455-458`) link `otp`, `vehicleCount`,
  `silentTrip`, `coverage` — all deep-linked via `info()`→`metricInfoFor` (line 214). Confirmed.
- Network `SectionReporting.svelte:70`, `SectionCompleteness.svelte:40,55`, receipt
  `SectionStateCuts.svelte:47,67` all wire `MetricInfo`. Confirmed.

---

## 1. SHOWN-BUT-UNEXPLAINED — displayed metrics with no `/metrics#anchor` link

"Unexplained" = the rendered value has **no working deep-link** to a `/metrics#<anchor>` explainer
(either no `(i)` at all, or an `(i)` that links to bare `/metrics` with no anchor). Live-entity
attributes (trip/map/next-departure) are listed separately as **BY-DESIGN** (they are ephemeral
vehicle attributes, not catalog reliability families — this is the intended contract, not a defect).

Ranked by visibility per the task order: **home > line detail > network > the rest.**

### 1.1 TRUE ORPHANS (a catalog family exists but the render does not link it)

| Rank | Metric (render) | Surface / visibility | file:line | Catalog family it SHOULD link | Why it's an orphan |
|---|---|---|---|---|---|
| 1 | Alert **cause** distribution rows | `/alerts` breakdown (mid-traffic) | `src/lib/features/alerts/sections/AlertBreakdown.svelte:43-53` (RankedRow) | supplemental `alertCause` → `#metrics-provenance` (content.ts:1178) | The `alertCause` tip EXISTS in `SUPPLEMENTAL_METRIC_TIPS` but is NEVER consumed. No `(i)` on the rows at all. |
| 2 | Alert **effect** distribution rows | `/alerts` breakdown | `AlertBreakdown.svelte:60-70` | supplemental `alertEffect` → `#metrics-provenance` (content.ts:1185) | Same — defined, never wired. No `(i)`. |
| 3 | Alert **severity** distribution rows | `/alerts` breakdown | `AlertBreakdown.svelte:76-86` | supplemental `alertSeverity` → `#metrics-provenance` (content.ts:1192) | Same — defined, never wired. No `(i)`. |
| 4 | Alert per-row **reach / duration / cause / effect / severity** in log | `/alerts` log | `src/lib/features/alerts/sections/AlertLog.svelte` (buildAlertRow) | supplemental `alertReach`/`alertDuration` (+cause/effect/severity) → `#metrics-provenance` (content.ts:1199-1213) | The 5 `alert*` tips cover exactly these dimensions; none wired. No `(i)`. |
| 5 | Alerts **headline** (count + median duration) | `/alerts` headline (top of surface) | `AlertHistory.svelte:251-258`; href @ :254 | should resolve via `metricInfoFor('alertDuration'…)` → `#metrics-provenance` | Has an `(i)`, but href is **bare `/metrics`** (no `#anchor`) and does NOT call `metricInfoFor`. Convention break — lands on page top, not on any alert copy. |
| 6 | Receipt **not-reported lines** list | `/receipt` bottom section | `src/lib/features/receipt/sections/SectionNotReported.svelte` | closest = `silentTrip` → `#skipped-stop` (already used by network reporting) | No `MetricInfo` at all. A "silent/not-reporting" render with no honest-definition link, unlike the network `silentTrip` render which IS linked. |

### 1.2 GLANCE-MODE (linked but no comparison/verdict) — NOT unexplained, listed for the WEAK-STORY list

These DO carry the explainer link (`(i)`) — they are **not** SHOWN-BUT-UNEXPLAINED. They are
STORY-PARTIAL because they lack comparison/verdict. Handled in §3.

- Home pulse: `otp`, `vehicleCount`, `silentTrip`, `coverage` — `+page.svelte:455-458` (linked).
- Network LIVE glance: `otp`/`coverage`/`p50`/`p90`/`vehicleCount`/`silentTrip` —
  `SectionLiveHeadline.svelte` + `headlineKpis.ts:62-90` (linked).
- Receipt headline: `otp`/`avgDelay`/`severe`/`riderImpact`/`affectedCounts` (linked).

### 1.3 BY-DESIGN (live-entity attributes, no catalog family — NOT counted as orphans)

Correctly unlinked; the SHOWN census agrees these are link-not-applicable:
- `/trip/[id]` live status / live delay / per-stop ETA — `TripDetail.svelte:161-216`.
- `/map` vehicle crowding / delay / next-stop ETA — `MapSelectionDetail.svelte:179-552`.
- `/stops/[id]` live next-departure delays — `StopDetail.svelte:414-424`.
- `/lines` + `/stops` index reliability badge — `ReliabilityBadge.svelte:57-64` (verdict-strong,
  intentionally link-free on list rows).
- `/status` diagnostics — outside the citizen-metric catalog by design.

**SHOWN-BUT-UNEXPLAINED orphan count (§1.1): 6 render sites, all on `/alerts` (5) + `/receipt`
not-reported (1).** They map to 5 catalog tips that exist but are never wired (`alertCause`,
`alertEffect`, `alertSeverity`, `alertDuration`, `alertReach`) plus the `silentTrip` tip that the
receipt not-reported list should reuse.

---

## 2. EXPLAINED-BUT-UNSHOWN — explainer entries reaching no surface

Two tiers: **(A) primary `METRICS[]` families** (own section) and **(B) `SUPPLEMENTAL_METRIC_TIPS`**
(deep-link tips). "Unshown" = no surface renders a value that deep-links to it.

### 2.A Primary families (14) — ALL are shown. Zero orphans.

Every one of the 14 primary explainers is deep-linked from ≥1 surface (EXPLAINED §6b, verified via
the `metricInfo('<key>', …)` snippet form): `otp`, `avgDelay`, `p50p90`, `severe`, `weakStops`,
`regularityCov`, `headway`, `excessWait`, `cancellation`, `skippedStop`, `serviceSpan`, `occupancy`,
`habits`, `seasonality`. **0 EXPLAINED-BUT-UNSHOWN among primaries.**

### 2.B Supplemental tips (10) — 5 shown, 5 UNSHOWN

| Supplemental key | anchor | Consumed? | Consumer |
|---|---|---|---|
| `riderImpact` | `#cancellation` | SHOWN | `src/lib/features/receipt/selectors/headlineKpis.ts:57` |
| `coverage` | `#regularity` | SHOWN | network `headlineKpis.ts:65`; home `+page.svelte:458` |
| `vehicleCount` | `#headway` | SHOWN | network `headlineKpis.ts:85`; home `+page.svelte:456` |
| `affectedCounts` | `#metrics-provenance` | SHOWN | `src/lib/features/receipt/sections/SectionAffected.svelte:28` |
| `silentTrip` | `#skipped-stop` | SHOWN | network `headlineKpis.ts:90`; home `+page.svelte:457` |
| **`alertCause`** | `#metrics-provenance` | **UNSHOWN** | none — `AlertBreakdown` cause rows exist but don't wire it |
| **`alertEffect`** | `#metrics-provenance` | **UNSHOWN** | none — `AlertBreakdown` effect rows exist but don't wire it |
| **`alertSeverity`** | `#metrics-provenance` | **UNSHOWN** | none — `AlertBreakdown` severity rows exist but don't wire it |
| **`alertDuration`** | `#metrics-provenance` | **UNSHOWN** | none — alerts headline/log show duration but don't wire it |
| **`alertReach`** | `#metrics-provenance` | **UNSHOWN** | none — alert log shows reach but doesn't wire it |

**EXPLAINED-BUT-UNSHOWN count: 5** — the entire `alert*` supplemental set (content.ts:1178-1213).

**Symmetry note:** the §1.1 orphans and the §2.B orphans are the SAME defect seen from two sides.
The alerts surface renders exactly the dimensions the 5 dead tips describe (cause/effect/severity/
duration/reach), but the surface never calls `metricInfoFor` for them. Wire them and BOTH orphan
lists shrink to (near) zero. This is a single, well-scoped fix on `/alerts`.

Also: the non-metric section `#structural-gaps` has no EXTERNAL deep-link (reached only via the
`/metrics` page's own ToC). Not a metric, so not counted as an orphan, but noted (EXPLAINED §6c).

---

## 3. WEAK-STORY list — shown metrics graded STORY-PARTIAL/BARE + the ONE addition to complete each

"Complete story" = context + explainer link + at least one of {comparison, verdict} (SHOWN rubric
§17-19). Each row names the SINGLE most-leveraged addition. Grouped by visibility.

### 3.1 HIGHEST visibility — home pulse (the site's most-seen numbers)

| Metric | file:line | Has | Missing | ONE addition to complete |
|---|---|---|---|---|
| On-time % (`otp`) | `+page.svelte:455` | CTX + LINK | comparison + verdict | **Verdict sentence** ("on time" / "running late" vs the 90/75 OTP floors already codified in `reliabilityVerdict.ts:22-31`) OR a Δ-vs-yesterday chip. A verdict word is cheaper and higher-impact here. |
| Vehicles in service (`vehicleCount`) | `+page.svelte:456` | CTX + LINK | comparison | **Δ-vs-typical chip** (vs the usual count for this time-of-day) — turns a bare count into "more/fewer than usual". |
| Non-responding (`silentTrip`) | `+page.svelte:457` | CTX + LINK | comparison + verdict | **Verdict tone** (green/amber threshold on the silent share) — a count of silent lines means nothing without "is that a lot?". |
| Coverage % (`coverage`) | `+page.svelte:458` | CTX + LINK | comparison + verdict | **Target/typical reference** (a "usually ~X%" tick) so the citizen can read the % as good/bad. |

### 3.2 HIGH visibility — network reliability (`/network`)

| Metric | file:line | Has | Missing | ONE addition |
|---|---|---|---|---|
| LIVE glance `otp`/`coverage`/`p50`/`p90` | `SectionLiveHeadline.svelte:46-63` + `headlineKpis.ts:62-79` | CTX + LINK | comparison + verdict | **Δ-vs-prior chip** — network has NO period-over-period delta anywhere; the trend sections imply change but never state it numerically. Add one Δ chip to the glance board. |
| Vehicles / non-responding | `SectionReporting.svelte:59-79` | CTX + LINK | comparison + verdict | **Verdict tone on the silent share** (same as home 3.1). |
| Service completeness (`cancellation`) | `SectionCompleteness.svelte:40-55` | CTX + LINK | verdict | **Severity tone** on the completeness % (it currently shows a share with no good/bad framing). |

### 3.3 HIGH visibility — line detail is ALREADY the gold standard

`/lines/[id]` §0-§4 is uniformly STORY-COMPLETE (SHOWN §2A): the ONLY surface with a plain-language
`VerdictBanner` sentence, a Δ-vs-prior (z-tested) chip, and an 80% SLA target tick. Nothing to add.
It is the template every other surface's "ONE addition" should copy.

### 3.4 MID visibility — receipt (`/receipt`)

| Metric | file:line | Has | Missing | ONE addition |
|---|---|---|---|---|
| Headline `otp`/`avgDelay`/`severe`/`riderImpact` | `receipt/selectors/headlineKpis.ts:43-61` → `SectionHeadline.svelte:44-62` | CTX + LINK | comparison + verdict | **Δ-vs-prior-day chip** — a receipt is inherently a "vs yesterday" document; the worst-of-day section already computes `otp_delta_pts`, so the delta infra exists. |
| Service states (delivered/cancelled/silent) | `SectionStateCuts.svelte:47,67` | CTX + LINK | verdict | **Severity tone** on the cancelled/silent split. |
| Not-reported lines | `SectionNotReported.svelte` | CTX only | LINK + verdict | **Explainer link** — wire `metricInfoFor('silentTrip', …)` → `#skipped-stop` (the network reporting list already does this). This is also §1.1 orphan #6. |

### 3.5 MID visibility — alerts (`/alerts`) — the weakest surface, and the §1.1/§2.B nexus

| Metric | file:line | Has | Missing | ONE addition |
|---|---|---|---|---|
| Headline (count + median duration) | `AlertHistory.svelte:251-258` | CTX + partial link | proper anchor + comparison/verdict | **Fix the link** — replace the bare `/metrics` href @ :254 with `metricInfoFor('alertDuration', locale)` → `#metrics-provenance#…`. |
| Cause / effect / severity rows | `AlertBreakdown.svelte:43-86` | CTX + VRD (severity bar) | LINK | **Explainer link** — render `MetricInfo` on each RankedRow heading via the matching `alert*` supplemental tip (`alertCause`/`alertEffect`/`alertSeverity`). This is the single fix that clears §1.1 #1-3 and §2.B simultaneously. |
| Per-alert reach/duration in log | `AlertLog.svelte` | CTX + VRD | LINK | **Explainer link** — `alertReach`/`alertDuration` tips on the log-row dimension headers. Clears §1.1 #4. |

### 3.6 LOWER visibility — stops sub-sections (already linked; only comparison/verdict thin)

Correction to SHOWN §2F: these ARE linked (see §0). They are STORY-PARTIAL only on the
comparison/verdict axis, not the link axis:

| Metric | file:line | Has | Missing | ONE addition |
|---|---|---|---|---|
| Percentiles p50/p90 | `SectionPercentiles.svelte:50` (`p50p90` link) | CTX + LINK | comparison + verdict | **p50/p90 reference marks** (the network `SectionDelayHistogram` already draws these). |
| Daily trend | `SectionDailyTrend.svelte` | CTX only | LINK + verdict | **Explainer link** — the one stops sub-section with no `(i)`; add `metricInfoFor('otp'|'avgDelay', …)`. |
| Weekday / time-of-day / crowding / by-route / habits | `SectionWeekday`/`SectionTimeOfDay`/`SectionCrowding`/`SectionByRoute`/`SectionHabits` | CTX + LINK + (severity VRD) | comparison | **Δ-vs-prior** where the spine supports it; otherwise these are near-complete (they already carry a severity verdict). |

### 3.7 The ONLY truly BARE renders (context + no link + no comparison, verdict-only)

- `AlertBreakdown.svelte:43-86` cause/effect/severity rows — verdict-only via the severity bar,
  no link, no comparison. → §3.5 fix (add the `alert*` explainer link) upgrades them to PARTIAL.
- `SectionNotReported.svelte` — → §3.4 fix (add `silentTrip` link).

---

## 4. Proposed canonical metric-id ↔ explainer-anchor mapping table

The definitive resolver is `metricInfoFor(key, locale)` (content.ts:1226-1239). This table is the
canonical `metric-id ↔ /metrics#anchor` map, annotated with whether each id is currently SHOWN.
Use it as the wiring contract when fixing the orphans in §1/§2.

### 4.A Primary metric families (own `/metrics#<anchor>` section) — all SHOWN

| metric-id | `/metrics#anchor` | content.ts defn | SHOWN on (representative) |
|---|---|---|---|
| `otp` | `#otp` | :118 | lines §0, network trend, receipt headline, home pulse, stops pane |
| `avgDelay` | `#avg-delay` | :194 | lines §0, stops by-route + pane, receipt headline |
| `p50p90` | `#p50-p90` | :247 | lines §0, network histogram, stops percentiles |
| `severe` | `#severe` | :303 | lines §0/§1, network by-time, hotspots, repeat-offenders, receipt, stops |
| `weakStops` | `#weak-stops` | :367 | lines §4 (`Section4WorstStops.svelte:139`) |
| `regularityCov` | `#regularity` | :425 | lines §2 (`Section2TheWait.svelte:692,776,783`) |
| `headway` | `#headway` | :496 | lines §2 (:691,749), RouteDetail |
| `excessWait` | `#excess-wait` | :551 | lines §2 (:648,769,791) |
| `cancellation` | `#cancellation` | :602 | lines §3, network cancellations/completeness, receipt state-cuts |
| `skippedStop` | `#skipped-stop` | :673 | lines §3 |
| `serviceSpan` | `#service-span` | :745 | lines §2 (:847,873,884,895,906), §3, RouteDetail |
| `occupancy` | `#occupancy` | :824 | lines §3, network crowding/status-mix, stops crowding |
| `habits` | `#habits` | :900 | stops habits (:97), lines §1 |
| `seasonality` | `#seasonality` | :973 | network weekday, stops weekday, lines §1 |

### 4.B Supplemental ids (deep-link tip, no own section) — 5 shown / 5 UNSHOWN

| supplemental-id | `/metrics#anchor` | content.ts defn | Status | Should be wired on |
|---|---|---|---|---|
| `riderImpact` | `#cancellation` | :1143 | SHOWN | receipt headline |
| `coverage` | `#regularity` | :1150 | SHOWN | network + home pulse |
| `vehicleCount` | `#headway` | :1157 | SHOWN | network reporting + home pulse |
| `affectedCounts` | `#metrics-provenance` | :1164 | SHOWN | receipt affected |
| `silentTrip` | `#skipped-stop` | :1171 | SHOWN | network reporting + home pulse; **ALSO wire on `receipt/SectionNotReported.svelte`** (fix §1.1 #6) |
| `alertCause` | `#metrics-provenance` | :1178 | **UNSHOWN** | **`AlertBreakdown.svelte:43-53` cause rows** |
| `alertEffect` | `#metrics-provenance` | :1185 | **UNSHOWN** | **`AlertBreakdown.svelte:60-70` effect rows** |
| `alertSeverity` | `#metrics-provenance` | :1192 | **UNSHOWN** | **`AlertBreakdown.svelte:76-86` severity rows** |
| `alertDuration` | `#metrics-provenance` | :1199 | **UNSHOWN** | **`AlertHistory.svelte:254` headline (replace bare `/metrics`) + `AlertLog.svelte` rows** |
| `alertReach` | `#metrics-provenance` | :1206 | **UNSHOWN** | **`AlertLog.svelte` reach dimension** |

### 4.C Non-metric page sections (anchors, not metric ids)

| section | anchor | external deep-link |
|---|---|---|
| Provenance preamble | `#metrics-provenance` | back-to-top target + the `affectedCounts`/`alert*` tips land here |
| Live positions | `#live-positions` | `MapMotionControl.svelte:51` ("How this works") |
| Structural gaps | `#structural-gaps` | none external (ToC-only) |

**Wiring recommendation:** the 5 `alert*` tips all currently point at the generic
`#metrics-provenance`. There is no alert-specific explainer section. Either (a) wire the tips onto
the alerts surface as-is (each alert dimension gets its honest one-line tip + a deep link to the
provenance section, which does describe `alert_breakdown` methodology per EXPLAINED §3), or (b) add
a dedicated `#alerts` explainer card to `METRICS[]`/copy so the 5 tips can re-point to a real
alert-specific anchor. Option (a) is the minimal fix that clears every orphan in §1 and §2.
