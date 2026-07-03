# METRIC CENSUS — the SHOWN side (apps/web)

Read-only analysis. Enumerates every metric VALUE displayed on any surface of `apps/web`,
scoring each on its presentation contract:

- **CONTEXT** — does the number arrive with what it means / its period / window? (a label
  alone is NOT context; there must be a meaning or period signal — a section eyebrow, a
  window caption, a `(i)` tip, an always-visible explanation column, or a grain rail).
- **COMPARISON** — vs network avg / vs prior period / vs a threshold. (a target tick, a
  Δ-vs-prior chip, a Wilson CI straddling a band boundary, a recurrence natural-frequency,
  or a delta chip all count).
- **VERDICT** — is the number framed good/bad? (a VerdictBanner sentence, a status verdict
  badge, a severity-coloured bar/dot on the dataviz status scale, a tone class).
- **EXPLAINER LINK** — does the number link to a `/metrics#<anchor>` how-we-measure entry
  (via the shared `MetricInfo` `(i)` affordance / `metricInfoFor`) or an explainer component?

Grade: **STORY-COMPLETE** = context + explainer link + at least one of {comparison, verdict}.
**STORY-PARTIAL** = context + (explainer link OR verdict/comparison) but missing one axis.
**STORY-BARE** = value with a label only; no explainer, no comparison, no verdict.

---

## 0. The explainer catalog (the link target)

`src/lib/features/metrics/metrics.content.ts` is the canonical registry.

- **14 primary metrics** (`METRICS[]`), each with a stable `anchor` (a `/metrics#<anchor>`
  target) + oneLiner tip + full definition/math/SQL/caveats:
  `otp` (otp), `avgDelay` (avg-delay), `p50p90` (p50-p90), `severe` (severe),
  `weakStops` (weak-stops), `regularityCov` (regularity), `headway` (headway),
  `excessWait` (excess-wait), `cancellation` (cancellation), `skippedStop` (skipped-stop),
  `serviceSpan` (service-span), `occupancy` (occupancy), `habits` (habits),
  `seasonality` (seasonality).
- **10 supplemental keys** (`SUPPLEMENTAL_METRIC_TIPS`) — no own section, deep-link to the
  nearest primary anchor: `riderImpact`→cancellation, `coverage`→regularity,
  `vehicleCount`→headway, `affectedCounts`→metrics-provenance, `silentTrip`→skipped-stop,
  `alertCause`/`alertEffect`/`alertSeverity`/`alertDuration`/`alertReach`→metrics-provenance.

The shared render path: `metricInfoFor(key, locale)` → `{ tip, href:`/metrics#anchor`, anchor }`,
wired into `MetricInfo.svelte` (the `(i)` popover) at `metrics.content.ts:1226`. The `(i)`
popover contains BOTH the one-line tip AND a keyboard-reachable "how this is measured →" link
(`MetricInfo.svelte:304-312`). So **"CONTEXT" and "EXPLAINER LINK" both ride the same `(i)`
affordance** — where `MetricInfo` is present, both are satisfied.

Absence system: `MetricDisplay` / `ExplainedMetricCard` / `RankedRow` / `MetricBullet` /
`MaybeValue` / `AbsentValue` all render a styled honest-absence chip (typed reason + WHY) for
null values, never a fabricated 0. This is site-wide and does not by itself grade a metric's
story — it is the absence contract, present on essentially every surface.

---

## 1. Display primitives (the render kit)

| Primitive | file | carries |
|---|---|---|
| `MetricDisplay` | `src/lib/components/brand/MetricDisplay.svelte` | big value + quiet label + honest absence. NO built-in explainer/comparison/verdict — caller must add `MetricInfo` beside it. |
| `ExplainedMetricCard` | `src/lib/components/dataviz/ExplainedMetricCard.svelte` | wraps MetricDisplay + optional `info` snippet (the `(i)`) + optional always-visible `explanation` column (col2). Explainer link only if caller passes the `info` snippet. |
| `MetricBullet` | `src/lib/features/lines/reliability/sections/MetricBullet.svelte` | value + a LayerChart bullet (scale context, optional target tick = COMPARISON) + optional `info` snippet. |
| `RankedRow` | `src/lib/components/dataviz/RankedRow.svelte` | rank + title + SeverityBar (VERDICT via dataviz-severity scale) + optional Δ chip (COMPARISON, `delta`/`deltaDisplay`/`higherIsBetter`) + honest absence. NO explainer of its own. |
| `MetricInfo` | `src/lib/features/metrics/MetricInfo.svelte` | THE `(i)` affordance = CONTEXT (tip) + EXPLAINER LINK (`/metrics#anchor`). |
| `VerdictBanner` | `src/lib/features/lines/reliability/sections/VerdictBanner.svelte` | the plain-language two-sided VERDICT sentence + BAN + band colour. |
| `ReliabilityBadge` | `src/lib/components/surface/ReliabilityBadge.svelte` | per-row status VERDICT + OTP%. NO explainer. |
| `MapDelayTag` / `StatusDot` / `StatusBadge` | dataviz/brand | plain-language delay/status VERDICT marks, honest absence. NO explainer. |

Note: `KpiCard` and `InsightCard` named in the task do NOT exist as components. The KPI role
is played by `ExplainedMetricCard` / `MetricDisplay` / `MetricBullet`; the "InsightCard verdict"
role is played by `VerdictBanner` (lines §0) + the per-row `SeverityBar`/`ReliabilityBadge`
verdicts + the `selectVerdict`/`bestTimeInsight` takeaway sentences.

MetricInfo usage by feature (count of `.svelte` files wiring it):
network sections 10 · stops sections 7 · receipt sections 5 · lines sections 5 · metrics 2 ·
homepage 1 · repeat-offenders 2 · hotspots 1 · alerts 1.

---

## 2. Per-surface census

### 2A. `/lines/[id]` — line reliability (RouteReliabilityClusters §0–§4) — GOLD STANDARD
Orchestrator `src/lib/features/lines/RouteDetail.svelte`; reliability tab mounts
`.../reliability/RouteReliabilityClusters.svelte` → Section0Verdict…Section4WorstStops.

| Metric (id/label) | file:line | CTX | CMP | VRD | LINK | grade |
|---|---|---|---|---|---|---|
| On-time % (`otp`) | Section0Verdict.svelte:206 (MetricBullet) + VerdictBanner:200 | Y | Y (80% SLA target tick `OTP_DOMAIN target=80`, Section0Verdict.svelte:88-92; Wilson CI band `verdict.ts:130-146`) | Y (VerdictBanner sentence + band, VerdictBanner.svelte:37; otpTone) | Y (`otp`) | **COMPLETE** |
| Avg delay (`avgDelay`) | Section0Verdict.svelte:214 | Y | partial (fixed `DELAY_STOP_DOMAIN` scale, no target) | neutral tone | Y (`avgDelay`) | **COMPLETE** |
| Typical p50 (`p50p90`) | Section0Verdict.svelte:221 | Y | fixed domain | neutral | Y (`p50p90`) | **COMPLETE** |
| Worst-case p90 (`p50p90`) | Section0Verdict.svelte:229 | Y | fixed `DELAY_DIST_DOMAIN` | neutral | Y (`p50p90`) | **COMPLETE** |
| Severe-delay share (`severe`) | Section0Verdict.svelte:288-298 | Y | fixed `SEVERE_DOMAIN` | Y (`severeTone` bad/warn bands :153) | Y (`severe`) | **COMPLETE** |
| Delay distribution p50/p90 readout | Section0Verdict.svelte:263-277 | Y | — | — | Y (`p50p90`) | **PARTIAL** (evidence readout) |
| Repeat-problem heatmap cells (`habits`) | Section1WhenToRide.svelte:401-424 | Y | — (relative-to-own-worst, classed tiers) | Y (tiered CVD ramp + best-time verdict sentence :410) | Y (`habits`) | **COMPLETE** |
| Per-shift severe strip (`severe`) | Section1WhenToRide.svelte:448-467 | Y | mean reference rule | Y (severity dots) | Y (`severe`) | **COMPLETE** |
| Weekday/weekend severe bars (`severe`) | Section1WhenToRide.svelte:469-474 | Y | fixed SEVERE_DOMAIN | Y | Y (`severe`) | **COMPLETE** |
| On-time-by-time-of-day vs prior (`otp`) | Section1WhenToRide.svelte:433-445 | Y | **Y (Δ-vs-prior z-tested, `proportionPriorDelta`, DeltaStat :373)** | Y | Y (`otp`) | **COMPLETE** |
| Shift×daytype OTP crosstab (`otp`) | Section1WhenToRide.svelte:482-491 | Y | two-line compare | Y | Y (`otp`) | **COMPLETE** |
| Weekday seasonality mean delay (`seasonality`) | Section1WhenToRide.svelte:494-503 | Y | fixed cycle | neutral | Y (`seasonality`) | **COMPLETE** |
| Headway / excess-wait / CoV / bunched per-shift (`headway`,`excessWait`,`regularityCov`) | Section2TheWait.svelte:316-332, (i) wired :230-235 | Y | **Y (comparison-vs-prior `prior_observed_min`/`prior_observation_count` :328-330)** | Y (bunching/CoV severity bars) | Y | **COMPLETE** |
| Service span first/last-trip (`serviceSpan`) | Section3RunAndFit.svelte (i) :91 | Y | timeline | — | Y (`serviceSpan`) | **COMPLETE** |
| Cancellation / skipped-stop rate (`cancellation`,`skippedStop`) | Section3RunAndFit.svelte | Y | — | severity | Y | **COMPLETE** |
| Occupancy mix (`occupancy`) | Section3RunAndFit.svelte:280 (i) | Y | — | calm dataviz-status scale | Y (`occupancy`) | **COMPLETE** |
| Worst stops ladder (`weakStops`) | Section4WorstStops.svelte | Y | Wilson CI on bar | Y (severity) | Y (`weak-stops`) | **COMPLETE** |

**Verdict: the lines surface is uniformly STORY-COMPLETE.** It is the only surface with a
plain-language VerdictBanner and the only place with Δ-vs-prior comparison and a target-tick
threshold. All ~17 metrics complete (delay-dist readout is a partial evidence twin).

### 2B. `/network` (+ homepage pulse) — network reliability (NetworkSurface)
`src/lib/features/network/reliability/sections/*` orchestrated by `NetworkSurface.svelte`.
LIVE region has a `SectionLabel "the network, right now"` eyebrow = context.

| Metric | file:line | CTX | CMP | VRD | LINK | grade |
|---|---|---|---|---|---|---|
| On-time % (`otp`) | SectionLiveHeadline.svelte:46-63 (glance) | Y | — | — | Y (`otp`) | **PARTIAL** |
| Coverage % (`coverage` suppl) | headlineKpis.ts:62-67 → SectionLiveHeadline | Y | — | — | Y (`coverage`) | **PARTIAL** |
| Delay p50 (`p50p90`) | headlineKpis.ts:68-73 | Y | — | — | Y | **PARTIAL** |
| Delay p90 (`p50p90`) | headlineKpis.ts:74-79 | Y | — | — | Y | **PARTIAL** |
| Vehicles in service (`vehicleCount` suppl) | SectionReporting.svelte:59-79 | Y | — | — | Y (`vehicleCount`) | **PARTIAL** |
| Non-responding (`silentTrip` suppl) | SectionReporting.svelte | Y | — | — | Y (`silentTrip`) | **PARTIAL** |
| Silent-lines ranked list | SectionReporting.svelte:88-121 (RankedRow) | Y | fixed `NON_RESPONDING_DOMAIN` | Y (severity bar) | via section (i) | **PARTIAL** |
| Status mix (share bars) | SectionStatusMix.svelte (occupancy `(i)` :41) | Y | — | Y (dataviz-status scale) | Y (`occupancy`) | **PARTIAL/COMPLETE** |
| Delay histogram (`p50p90`) | SectionDelayHistogram.svelte:41-49 | Y | p50/p90 reference marks | — | Y (`p50p90`) | **COMPLETE** |
| OTP/avg-delay trend (`otp`) | SectionTrend.svelte:57-63 | Y (window rail 7/30/90d) | trend-over-time | — | Y (`otp`) | **COMPLETE** |
| Cancellation rate + trend (`cancellation`) | SectionCancellations.svelte:42-64 | Y (trend) | trend-over-time (no Δ chip) | severity domain | Y (`cancellation`) | **COMPLETE** |
| Service completeness (`cancellation`) | SectionCompleteness.svelte:40-55 | Y | — | — | Y (`cancellation`) | **PARTIAL** |
| Crowding-by-day (`occupancy`) | SectionCrowdingByDay.svelte:34-40 | Y | day trend | calm scale | Y (`occupancy`) | **COMPLETE** |
| Severe-by-shift ranked (`severe`) | SectionByTimeOfDay.svelte:44-64 | Y | fixed SEVERE_DOMAIN | Y (severity) | Y (`severe`) | **COMPLETE** |
| Weekday/day-type (`seasonality`) | SectionWeekday.svelte:37-57 | Y | — | severity | Y (`seasonality`) | **COMPLETE** |

**Verdict:** every network metric carries context + explainer link + honest absence. The LIVE
glance board (otp/coverage/p50/p90/vehicles/silent) is deliberately glance-mode (context lives
ONLY in the `(i)` hover, no explanation column, no comparison, no verdict framing) → PARTIAL.
The HISTORIC trend/histogram/severe/crowding sections add period-over-period context and/or
severity verdicts → COMPLETE. **No Δ-vs-prior chip anywhere on network** (trend implies change
but never states it numerically). No target-threshold marks. Homepage pulse (`+page.svelte:455-458`,
`pulse()` snippet :516-522) mirrors the LIVE glance board (otp/vehicles/silent/coverage) → same
4 PARTIAL entries (context via "network right now" label + `(i)`, no comparison/verdict).

### 2C. `/receipt` — daily accountability receipt (AccountabilityReceipt)
`src/lib/features/receipt/*`. Period context = the picked date (SurfaceHeader + TerminalChrome
`status`/`issued`), plus each section eyebrow.

| Metric | file:line | CTX | CMP | VRD | LINK | grade |
|---|---|---|---|---|---|---|
| On-time % (`otp`) | headlineKpis.ts:43 → SectionHeadline.svelte:44-62 | Y | — | — | Y (`otp`) | **PARTIAL** |
| Avg delay (`avgDelay`) | headlineKpis.ts:44-49 | Y | — | — | Y (`avgDelay`) | **PARTIAL** |
| Severe share (`severe`) | headlineKpis.ts:50-55 | Y | — | — | Y (`severe`) | **PARTIAL** |
| Rider impact (`riderImpact` suppl) | headlineKpis.ts:56-61 | Y | — | — | Y (`riderImpact`) | **PARTIAL** |
| Affected counts routes/stops/alerts/vehicles (`affectedCounts` suppl) | SectionAffected.svelte via selectAffectedCounts | Y | — | — | Y (`affectedCounts`) | **PARTIAL** |
| Worst line of day (delta) | day-worst.ts → SectionWorst.svelte | Y | **Y (routeDeltaLabel, otp_delta_pts)** | Y (worst framing) | Y | **COMPLETE** |
| Worst stop of day (delay) | day-worst.ts → SectionWorst.svelte | Y | stop delay | Y (worst framing) | Y | **PARTIAL/COMPLETE** |
| Severe-by-shift ranked (`severe`) | SectionTimeOfDay.svelte (fixed SEVERE_DOMAIN) | Y | fixed domain | Y (severity) | Y (`severe`) | **COMPLETE** |
| Service states delivered/cancelled/silent + completeness | SectionStateCuts.svelte | Y | share split | — | Y (`(i)` wired) | **PARTIAL** |
| Not-reported lines list | SectionNotReported.svelte | Y | — | — | **NO `(i)`** | **PARTIAL/BARE** |

**Verdict:** headline KPIs are glance-mode (context + explainer, no comparison/verdict) →
PARTIAL. Worst-of-day carries a real delta = COMPLETE. `SectionNotReported` renders values
with no explainer wiring.

### 2D. `/hotspots` — worst spots ladder (HotspotsBoard)
`src/lib/features/hotspots/*`. Ranks each route/stop cell by severe-delay rate.

| Metric | file:line | CTX | CMP | VRD | LINK | grade |
|---|---|---|---|---|---|---|
| Severe-delay rate per cell (`severe`) | hotspotLadder.ts:94-125 → HotspotSection | Y (severeInfo `(i)` :81; window caption) | Y (Wilson CI flipped onto bar :57-60; per-row note severe%·avg·n :169-177) | Y (severity scale, DB Wilson-LB rank) | Y (`severe`) | **COMPLETE** |
| Per-row evidence note (severe% · avg · n) | HotspotsBoard.svelte:169-177 | Y | n + CI | — | inherits `severe` | evidence twin |
| Un-ranked tray cells | HotspotsBoard.svelte:206-223 | Y (explicitly "not ranked") | — | — | — | intentional (sub-MIN_N transparency) |

**Verdict: STORY-COMPLETE** — one metric (severe rate) with context + Wilson-CI comparison +
severity verdict + `severe` explainer link.

### 2E. `/repeat-offenders` — recurrence ladder (RepeatOffenders)
`src/lib/features/repeat-offenders/*`.

| Metric | file:line | CTX | CMP | VRD | LINK | grade |
|---|---|---|---|---|---|---|
| Severe-delay rate per entity (`severe`) | offenderLadder.ts → RepeatOffendersSection; severeInfo :83 | Y | Y (Wilson CI, `severe%·n` note) | Y (severity scale, Wilson-LB rank) | Y (`severe`) | **COMPLETE** |
| Recurrence "N of M observed days" (`severe`) | RepeatOffenders.svelte:156-165, 197-211 | Y | **Y (natural-frequency recurrence line = a form of comparison)** | Y | Y (`severe`) | **COMPLETE** |
| Headline card (label + explanation, value:null) | RepeatOffenders.svelte:304-321 | Y (explanation col) | — | — | Y (`severe`) | **COMPLETE** (context card) |
| Legacy fallback ledger (avg delay) | RepeatOffenders.svelte:377-401 (RankedRow domain DELAY_DIST_DOMAIN) | Y | fixed domain | Y (severity) | Y (severeInfo :361) | **COMPLETE** |

**Verdict: STORY-COMPLETE** — severe rate + recurrence natural-frequency + Wilson CI + severity
verdict + `severe` explainer. No plain-language verdict SENTENCE (unlike lines).

### 2F. `/stops/[id]` reliability (StopReliabilitySurface) + StopDetail live
`src/lib/features/stops/reliability/*` + `src/lib/features/stops/StopDetail.svelte`.

| Metric | file:line | CTX | CMP | VRD | LINK | grade |
|---|---|---|---|---|---|---|
| OTP / avg-delay / severe (ReliabilityPane) | StopReliabilitySurface.svelte:318-326 (3× `(i)` on pane heading) | Y (grain rail) | period grades | Y (ReliabilityPane grading) | Y (`otp`/`avgDelay`/`severe`) | **COMPLETE** |
| Day percentiles p50/p90 | SectionPercentiles.svelte | Y | — | — | **NO per-section `(i)`** | **PARTIAL** |
| Weekday seasonality severe/avg | SectionWeekday.svelte (stops) | Y | — | severity | **NO `(i)`** | **PARTIAL** |
| Time-of-day shift/day-type | SectionTimeOfDay.svelte (stops) | Y | — | severity | **NO `(i)`** | **PARTIAL** |
| Crowding mix | SectionCrowding.svelte | Y | — | calm scale | **NO `(i)`** | **PARTIAL** |
| By-route association delays | SectionByRoute.svelte | Y | — | severity | **NO `(i)`** | **PARTIAL** |
| Habits 7×24 heatmap | SectionHabits.svelte | Y | tiered | Y (tiers) | **NO `(i)`** | **PARTIAL** |
| Daily trend | SectionDailyTrend.svelte | Y (date window) | trend | — | **NO `(i)`** | **PARTIAL** |
| Live next-departure delays | StopDetail.svelte:414-424 (delayLabel) | Y | — | Y (delayTone + plain label) | — (live, not catalog) | **PARTIAL** |
| Stop info position/code/wheelchair | StopDetail.svelte:491-523 | Y | — | — | — | static attribute (N/A) |

**Verdict:** the intrinsic OTP/avgDelay/severe pane carries all three `(i)` explainers →
COMPLETE. But the seven stop sub-section metrics (percentiles, weekday, time-of-day, crowding,
by-route, habits, daily-trend) render marks WITHOUT any per-section `(i)` explainer link — the
explainer is only on the pane heading. → PARTIAL. **Weakest reliability surface for
per-metric explainer coverage.**

### 2G. `/alerts` — alert history (AlertHistory)
`src/lib/features/alerts/*`.

| Metric | file:line | CTX | CMP | VRD | LINK | grade |
|---|---|---|---|---|---|---|
| Alerts-in-window count + median duration | AlertHistory.svelte:277-286 (ExplainedMetricCard + explanation col) | Y (explanation + sublabel) | — | — | **PARTIAL — href = bare `/metrics` NOT `#anchor`** (AlertHistory.svelte:254) | **PARTIAL** |
| Cause distribution rows | AlertBreakdown.svelte:43-53 (RankedRow) | Y (section label) | — | Y (severity bar) | **NO `(i)` / no link** | **PARTIAL** |
| Effect distribution rows | AlertBreakdown.svelte:60-70 | Y | — | Y | **NO link** | **PARTIAL** |
| Severity distribution rows | AlertBreakdown.svelte:76-86 | Y | — | Y | **NO link** | **PARTIAL** |
| Per-alert reach/duration/cause/effect/severity in log rows | AlertLog.svelte (buildAlertRow) | Y | — | Y (severity band) | — | **PARTIAL** |

**Verdict:** the headline card's `(i)` link is hand-rolled to bare `/metrics` (no anchor) and
does NOT use `metricInfoFor` — the ONLY surface that breaks the deep-link convention. The
breakdown RankedRows (cause/effect/severity) — which map to the `alertCause`/`alertEffect`/
`alertSeverity` supplemental keys — carry NO explainer at all. All PARTIAL; the breakdown rows
lean BARE on the link axis.

### 2H. `/trip/[id]` — live trip (TripDetail)
`src/lib/features/trips/TripDetail.svelte`.

| Metric | file:line | CTX | CMP | VRD | LINK | grade |
|---|---|---|---|---|---|---|
| Live status | TripDetail.svelte:161-168 (StatusDot + label) | Y | — | Y (status dot + word) | — | **PARTIAL** |
| Live delay | TripDetail.svelte:171-181 (delayLabel + tone, MaybeValue) | Y | — | Y (chipTone) | — | **PARTIAL** |
| Per-stop ETA + delay prediction | TripDetail.svelte:197-216 | Y (prediction caveat) | — | Y (delayTone) | — | **PARTIAL** |

**Verdict:** live ephemeral entity; honest absence + plain-language verdict tone, but no
explainer link (delay/status is not framed as a catalog metric here). All PARTIAL.

### 2I. `/map` — live map selection detail (MapSelectionDetail)
`src/lib/features/map/MapSelectionDetail.svelte`.

| Metric | file:line | CTX | CMP | VRD | LINK | grade |
|---|---|---|---|---|---|---|
| Vehicle crowding/occupancy | MapSelectionDetail.svelte:179-192 (MaybeValue, filter chip) | Y | — | Y (calm occupancy scale) | — | **PARTIAL** |
| Vehicle delay | :199, :353, MapDelayTag :437/:489/:546 | Y | — | Y (MapDelayTag tone + plain label) | — | **PARTIAL** |
| Next-stop ETA / departure delays | :211-222, :299-307, :489-552 | Y | — | Y | — | **PARTIAL** |
| Route / trip identity | :145-239 | Y | — | — | — | attribute (N/A) |

**Verdict:** honest absence + plain-language delay/occupancy verdicts throughout; no explainer
links (live attributes). All PARTIAL.

### 2J. `/lines` + `/stops` index rows (LinesIndex / StopsIndex)
`src/lib/features/lines/LinesIndex.svelte:196` + `src/lib/features/stops/StopsIndex.svelte`.

| Metric | file:line | CTX | CMP | VRD | LINK | grade |
|---|---|---|---|---|---|---|
| Per-row reliability badge (status verdict + OTP%) | ReliabilityBadge.svelte:57-64 | Y (row context) | Y (implicit vs 90/75 floors, `reliabilityVerdict.ts:22-31`) | **Y (status verdict word + glyph + colour)** | — (no `(i)` on rows) | **PARTIAL** |

**Verdict:** the list rows deliver a genuine VERDICT (otpVerdict on-time/late/severe against
the 90/75 OTP floors) but no explainer link → PARTIAL (verdict-strong, link-absent).

### 2K. `/status` — data health (HealthStatus)
`src/lib/features/health/*`. These are DATA-HEALTH/diagnostic values, NOT citizen reliability
metrics, and are intentionally OUTSIDE the /metrics science catalog.

| Metric | file:line | CTX | CMP | VRD | LINK | grade |
|---|---|---|---|---|---|---|
| Per-feed freshness / age | SectionFreshness.svelte | Y | — | Y (run-status verdict) | — | diagnostic (N/A to catalog) |
| Lane file counts + gate verdict | SectionLanes.svelte | Y | — | Y (gate verdict) | — | diagnostic |
| Retention detail/aggregate days | SectionRetention.svelte | Y | — | — | — | diagnostic |
| Conformance verdict + unknown members | SectionConformance.svelte | Y | — | Y (conformance verdict) | — | diagnostic |
| Build envelope (run id / schema / methodology version) | SectionEnvelope.svelte | Y | — | — | — | diagnostic |
| Pipeline notes (methodology strings) | SectionNotes.svelte | Y | — | — | (IS the explainer copy) | diagnostic |

**Verdict:** correctly no `/metrics` link — these are the "how we run the pipeline" numbers,
carrying their own verdicts (freshness/gate/conformance) + honest absence. Not scored against
the citizen-metric story rubric; listed for completeness.

### 2L. `/metrics` — the explainer page itself (MetricsExplainer)
`src/lib/features/metrics/MetricsExplainer.svelte`. This is the LINK TARGET, not a metric
display surface — it renders definitions/math/SQL/caveats for the 14 primary metrics. It is
where every other surface's `(i)` link lands. Not scored (it is the story destination).

---

## 3. Roll-up counts

Counting distinct metric-VALUE renders scored against the citizen rubric (excluding: the
`/status` diagnostics [6], static attributes [stop position/code/wheelchair, route identity],
the `/metrics` page itself, and the un-ranked tray transparency cells).

Approximate distinct scored metrics: **~62**.

| grade | count | where |
|---|---|---|
| STORY-COMPLETE | ~33 | ALL of lines §0–§4 (17); hotspots severe (1); repeat-offenders severe+recurrence+headline+legacy (4); receipt worst-of-day + severe-shift (2); network historic trend/histogram/cancellation/crowding/severe-shift/weekday/status-mix (7); stops intrinsic OTP/avgDelay/severe pane (counts once, 1); receipt not fully — see partial |
| STORY-PARTIAL | ~26 | network LIVE glance board (6) + homepage pulse (4, same metrics) + completeness (1); receipt headline KPIs (4) + affected counts (1) + state-cuts (1); stops 7 sub-section metrics; alerts headline + log rows (2); trip live (3); map live (3); index reliability badge (2 surfaces) — verdict-strong-but-no-link |
| STORY-BARE | ~3 | alerts breakdown cause/effect/severity RankedRows (no explainer, no comparison — verdict-only) + receipt not-reported list. |

Metrics WITH an explainer `(i)` link (`metricInfoFor` → `/metrics#anchor`): every lines,
network, receipt-headline, hotspots, repeat-offenders, homepage-pulse, and stops-pane metric —
roughly **~45 of ~62 rendered metrics carry a working deep-link `(i)`**. The gaps are: stops
sub-sections (7), alerts breakdown rows (3), alerts headline (bare `/metrics`, 1), receipt
not-reported (1), and all live/attribute renders (trip 3, map 3, index badge 2 — link-not-
applicable by design for live entities).

---

## 4. Worst surfaces (weakest story on the SHOWN side)

1. **`/alerts` breakdown (AlertBreakdown.svelte:43-86)** — cause/effect/severity RankedRows
   have NO explainer link and NO comparison; verdict-only via the severity bar. These map to
   real supplemental keys (`alertCause`/`alertEffect`/`alertSeverity`) that EXIST in the
   catalog but are never wired. **The only truly BARE metric renders.**
2. **`/alerts` headline (AlertHistory.svelte:251-258)** — the ONE surface whose `(i)` link is
   hand-rolled to bare `/metrics` (no `#anchor`) instead of `metricInfoFor`. A convention break.
3. **`/stops/[id]` reliability sub-sections** — 7 metrics (percentiles, weekday, time-of-day,
   crowding, by-route, habits, daily-trend) render with context + verdict but NO per-section
   explainer `(i)`; the explainer only sits on the pane heading. Widest per-metric link gap
   among the reliability surfaces (contrast: lines wires `(i)` on every sub-section).
4. **`/receipt` `SectionNotReported`** — value list with no explainer wiring.
5. **network + homepage LIVE glance boards** — deliberately glance-mode (PARTIAL by design):
   context+link but no comparison, no verdict framing. Defensible, but they are the highest-
   traffic numbers on the site and carry the least story.

## 5. Cross-cutting observations

- **Comparison is the scarcest axis site-wide.** Only `/lines` has Δ-vs-prior (z-tested) and a
  target-threshold tick; `/receipt` worst-of-day and hotspots/repeat-offenders have deltas/CIs.
  Network, homepage, receipt headline, stops, alerts show NO period-over-period delta on the
  headline numbers (trends imply change but never state it numerically).
- **Verdict framing** is strong on ranked/severity surfaces (dataviz-status scale bars/dots
  everywhere) and on the list-row `ReliabilityBadge`, but a plain-language verdict SENTENCE
  exists ONLY on `/lines` §0 (`VerdictBanner`) and the §1 best-time takeaway. No other surface
  gives the citizen a written good/bad conclusion.
- **Explainer link coverage is high (~45/62) and mostly convention-clean** via the shared
  `metricInfoFor`→`MetricInfo` path. The two convention breaks are the alerts headline
  (bare `/metrics`) and the alerts breakdown rows (no link at all).
- **Honest absence is universal** (MetricDisplay/MaybeValue/AbsentValue on every surface) — it
  is not a differentiator; every surface passes it.
