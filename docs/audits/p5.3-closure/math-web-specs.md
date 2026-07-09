# MATH RE-VERIFICATION — Lane 1: P5.2 ChartSpec selector math

HEAD: `2273280` (P5.2 chart-library migration). Repo: `apps/web/src`. READ-ONLY analysis.

Files audited:
- `lib/components/dataviz/chart/ChartSpec.ts` — the typed contract + `checkAbsoluteDomain`
- `lib/components/dataviz/chart/sparkDomain.ts` — `sparkZoomDomain`
- `lib/components/dataviz/chart/share.ts` — `shareSegments` / `stackedShareSpec`
- `lib/features/reliability/domains.ts` — domain literals + `otpTrendDomain`
- `lib/v1/stats.ts` — Wilson kernel(s)
- `lib/features/network/reliability/selectors/{trendChart,statusMix,occupancyMix,delayHistogram}.ts`
- `lib/features/lines/reliability/selectors/{weakStops,verdict,punctualityTrend,punctualityDistribution,occupancyShare}.ts`
- `lib/features/stops/reliability/selectors/{dailyRange,dailyTrend}.ts`
- `lib/features/alerts/selectors/alertLog.ts` + `sections/AlertBreakdown.svelte`
- `lib/features/lines/reliability/chartDoctrine.test.ts` — the gate
- `lib/components/dataviz/chart/marks/ciWhiskerGeometry.ts`

---

## (1) Share normalization — VERDICT: SOUND

Two share paths, both explicitly renormalize to 100 after filtering.

**`share.ts:24-48`** (`shareSegments`, the shared helper used by `statusMix.ts` and `occupancyMix.ts`):
```
const clean = (v) => (v != null && Number.isFinite(v) ? Math.max(0, v) : 0);
const total = inputs.reduce((sum, i) => sum + clean(i.value), 0);
if (total <= 0) return [];
... share: (v / total) * 100 ...   // per surviving band
```
- null / NaN / negative → coerced to 0 (`clean`, line 24). Honest: a null band never contributes.
- Zero/empty denominator: `total <= 0 → return []` (line 32) → caller emits an `absence` spec (`statusMix.ts:42-50`, `occupancyMix.ts:36`). No divide-by-zero, no fabricated even split.
- **Renormalization after filtering: YES and CORRECT.** `total` is the sum of ALL cleaned inputs; zero-share bands are then dropped in the emit loop (line 35 `if (v <= 0) continue`). Because zero bands contribute 0 to `total`, dropping them does not change the denominator — surviving shares still sum to exactly 100. Verified: inputs {A:30, B:0, C:70} → total=100 → shares {A:30, C:70} sum=100. ✓

**`occupancyShare.ts:33-49`** (lines A7/A9/A10 path): same structure — `total = Σ (v>0 ? v : 0)`, `total<=0 → null`, `share: (v/total)*100`. Zero/null bands skipped BEFORE the total is computed AND in the emit loop; the total only sums positive bands, so surviving shares sum to 100. ✓

Do shares sum to 1/100%? **Yes, to 100** (the contract is percent, `ShareSegment.share ∈ [0,100]`, `ChartSpec.ts:332`). Floating-point residue only (e.g. 33.33+33.33+33.33=99.99) — the stacked-share mark is self-normalising and the residue is sub-pixel; the Chart Doctrine explicitly exempts this kind from the absolute-domain law (`ChartSpec.ts:347-352`).

Numeric check: {30,0,70} → [30,70]; {160,40} → [80,20]; all-null → [] → absence. SOUND.

---

## (2) sparkDomain — VERDICT: SOUND

**`sparkDomain.ts:29-51`** (`sparkZoomDomain`). This is DELIBERATELY NOT zero-based, and the Chart Doctrine explicitly sanctions that here:
- A sparkline is a `kind: 'sparkline'` MAGNITUDE kind (`ChartSpec.ts:62-72`), but the file header (`sparkDomain.ts:1-15`) records the adjudication: a tickless inline shape channel with no axis / no cross-view comparison, so pinning it to `[0,hi]` would erase the wiggle. The honest form is a data-anchored window computed ONCE in the selector (the SPEC carries the literal; the mark never derives it).
- Padding is LITERAL symmetric: `pad = Math.max(1, Math.round((hi-lo)*0.1))` (line 44) — NOT `/max` normalization. It floors at 1 unit so a flat-ish series still has a visible band.
- Clamp: `min = Math.max(clampLo??0, lo-pad)`, `max = clampHi!=null ? Math.min(clampHi,max) : hi+pad` (lines 45-48). `min>max` swap guard (line 49).
- Guard: `reals < 2 → null` (line 42) → caller stands down (`selectVehiclesSpark` returns null, `trendChart.ts:116`). No one-point zoom.

Numeric check: values [40,42,41,45] → lo=40, hi=45, pad=max(1,round(0.5))=1 → [39,46]. ✓ Matches.

**Is it zero-based where the Doctrine requires absolute magnitude domains?** The Doctrine's zero-based law is scoped to CROSS-VIEW magnitude marks; the sparkline is explicitly carved out as a shape channel (header comment + `domains.ts` S9B ruling it extends). The type still forces an explicit `domain` (`SparklineSpec.domain: AbsoluteDomain`, `ChartSpec.ts:217`), so the invariant "the spec owns the scale, the mark never auto-derives" holds. `checkAbsoluteDomain` would fire on a sparkline whose lo≠0 (`ChartSpec.ts:607`) — BUT sparklines are constructed only via `sparkZoomDomain` whose lo can be >0, so at RUNTIME `checkAbsoluteDomain` is NOT called on spark specs (it is a dev/gate assertion on the magnitude-bars/trend path). This is an intentional, documented divergence, not a bug: the spark is a within-series shape read. SOUND (the carve-out is explicit and consistent).

---

## (3) otpTrendDomain — VERDICT: SOUND

**`domains.ts:124-154`** (`otpTrendDomain`). The ONE documented exception to bare-[0,100] for the NETWORK OTP trend only (`trendChart.ts:78`; lines' OTP trend stays `OTP_DOMAIN [0,100]`, `punctualityTrend.ts:99`).

Bounds logic:
- `lo/hi` via plain reduce over non-null values (lines 126-132), NOT `Math.max(...spread)` (deliberately, to stay green on the chart-doctrine gate — line 118 comment).
- All-null / empty → `[0,100]` honest full scale (line 134). No fabricated zoom.
- Reference pull-in: `lo=min(lo,80); hi=max(hi,80)` (lines 137-138) so the 80% target line always sits INSIDE the window (never a falsely-positioned floor anchor).
- Literal symmetric pad `OTP_TREND_PAD=2`: `min=max(0,floor(lo-2))`, `max=min(100,ceil(hi+2))` (lines 140-141) — CLAMPED to [0,100]. Axis can never exceed the real whole.
- Min-span floor `OTP_TREND_MIN_SPAN=8` (lines 144-152): if span<8, grow symmetrically, then if still <8 push off whichever wall was hit (min===0 → max=8; max===100 → min=92). Guarantees legible slope for a near-flat network week WITHOUT magnifying it (a genuinely flat 88/88 stays flat inside an 8-pt window).

**Stable across windows?** YES — the domain is derived from the ALREADY-windowed series (`trendChart.ts:78`, comment lines 76-77): every mark on the surface reads the same slice, so the axis tracks the visible window's real extremes deterministically. Same input window → same [min,max]. The reference pull-in + clamp make it monotone and bounded. It is NOT relative-to-in-view-max: padding is a literal ±2, not `value/max`.

Numeric checks:
- [87,88,86,89] → lo=86,hi=89 → ref→lo=80,hi=89 → min=78,max=91 → span 13 ≥ 8 → [78,91]. ✓
- flat [88,88] → lo=hi=88 → ref→lo=80 → min=78,max=90 → span 12 → [78,90]. ✓
- all-null → [0,100]. ✓

SOUND.

---

## (4) Wilson usage in specs — VERDICT: SOUND

**Kernel `stats.ts:57-90`.** `wilsonBoundsProportion` is the single source; `wilsonBounds` (percent, `round1`) wraps it; `wilsonLo/wilsonHi` wrap that.
- z: `WILSON_Z = 1.96` (line 22), default arg on every entry point (lines 60,85,96,105). Two-sided 95%. ✓
- Formula (lines 65-72) is the textbook Wilson score interval:
  `center=(p+z²/2n)/(1+z²/n)`, `margin=z·√(p(1-p)/n + z²/4n²)/(1+z²/n)`, clamped `[0,1]`.
- n source & degenerate guard: `if (successes==null || !n || !Number.isFinite(n) || n<=0) return null` (line 62). `k=clamp(successes,0,n)` (line 64) — successes clamped into [0,n] so p∈[0,1]. No NaN/negative escape.

Numeric checks (hand-recomputed vs Python replica):
- 78/100 → [68.9, 85.0]% ✓
- 9/10 → [59.6, 98.2]% ✓ (wide, honest at small n — the whole point vs Wald)
- 0/50 → [0, 7.1]% ✓ (lo clamped at 0, non-degenerate upper — Wald would give [0,0])

**CI drawn from the SAME n as the point estimate?** YES in every consumer:
- `verdict.ts:132-133`: `numer = onTime ?? round(otp/100·n)`; `wilsonBoundsProportion(numer, n)` — same `n=observationCount` as the OTP% band sentence. The natural-frequency numerator and the Wilson denominator are the same n. ✓ (`verdict.ts:98` gates on `n>0 && onTime!=null` before deriving onTen/lateTen from the same counts.)
- `punctualityTrend.ts:69-76` (daily path): plots the EXACT rate `on_time/observation_count·100` (comment lines 68-71: integer `otp_pct` fell outside its own band on ~22% of points — FIXED), and the band `wilson_lo/wilson_hi` are server-emitted from the SAME `observation_count`. Point estimate and band share n. ✓
- `dailyTrend.ts:55-56`: `wilsonBounds(severe_count, observation_count)` — band on the severe proportion, same `observation_count` as `severe_pct` (`y: p.severe_pct`, line 60). ✓
- `dailyRange.ts:101-102`: pooled `severePct = 100·Σsevere_count/Σobs`, `wilson = wilsonBoundsProportion(severeCount, observations)` — CI from the SAME summed Σobs as the point estimate. Both gated on `observations >= MIN_N_RATE` (line 98). ✓

**Interval orientation (weakStops severe-rate flip)** — `weakStops.ts:51-59,114-116`. This is the one place orientation matters and it is handled correctly:
- The bar encodes `severe_pct`, but the CONTRACT's `wilson_lo/wilson_hi` bracket the COMPLEMENTARY not-severe rate. The selector flips: `severeCiLo = round1(100 - wilson_hi)`, `severeCiHi = round1(100 - wilson_lo)` (lines 56-59). Correct: reflecting [lo,hi] on not-severe about 50 gives [100-hi, 100-lo] on severe, preserving width and orientation (lo≤hi).
- Numeric: not-severe 160/200 → [73.9, 85.0]% → flipped severe → [15.0, 26.1]% — brackets the ~20% severe point value. ✓ Null on either missing bound (honest absence, line 57/59).
- The whisker geometry (`ciWhiskerGeometry.ts:53,58-59`) draws from `wilsonLo/wilsonHi` on the row, clamped to the SAME `domain` as the bar (line 58-59), both-bounds gate (line 53), non-finite drop (line 63). So the drawn CI is on the same scale as the point estimate. ✓

Ranking uses the Wilson LOWER bound, never the point estimate (`stats.ts:92-98,116-128` `rankByLowerBound`; contract `weak_stops_by_grain` pre-ranked by not-severe Wilson LB, `weakStops.ts:81`). ✓

Minor note (NOT a bug): the `verdict.ts:9` header comment example "78%, 95% sure between 71 and 84%" is illustrative prose; the real kernel gives [68.9,85.0] for 78/100. It is a doc example, not a computed/asserted value — no defect.

SOUND.

---

## Chart Doctrine violation sweep (/max normalization) — VERDICT: CLEAN

Swept `lib/features` + `lib/components/dataviz` for `Math.max(...spread)`, `/max`, `/worst*`, `d3.extent`, `.nice()`, `Math.max(literal, Math.ceil(...))`.

- **The gate itself** (`chartDoctrine.test.ts`) is live, recursive over the whole feature tree + renderer, ALLOWLIST is EMPTY (lines 34-44 — S14 punch-list complete), and bans all the escape hatches (spread-max, `/worst`, `/worstX`, reduce-max→Ceil-domain, `extent(`, `nice`). It also requires every mounted `<LcChart` to pin an explicit `xDomain/yDomain` (lines 195-204). Strong.
- **No cross-view magnitude mark uses relative-to-in-view-max.** Every magnitude ChartSpec carries a LITERAL domain from `domains.ts` (`OTP_DOMAIN`, `SEVERE_DOMAIN`, `DELAY_POS_DOMAIN`, `DELAY_DIST_DOMAIN`, `HEADWAY_DOMAIN`, `COV_DOMAIN`, `HABITS_DOMAIN`, histogram/service-span fixed axes). `checkAbsoluteDomain` (`ChartSpec.ts:586-611`) enforces lo===0 (or straddle-0 for histogram) at runtime.
- **Sanctioned within-distribution peaks** (count / that-distribution's-own-max) appear in exactly the places the Doctrine carves out, and use `reduce`, never spread:
  - `punctualityDistribution.ts:57-58` and `delayHistogram.ts:74-75`: `maxCount = bins.reduce(...)`, `countDomain = [0, Math.max(maxCount, 1)]`. This is the histogram COUNT axis (`HistogramSpec.countDomain`, `ChartSpec.ts:277-284`) — read by shape within ONE distribution, explicitly NOT a cross-view length. `Math.max(maxCount,1)` is `Math.max(<var>, <literal>)` NOT the banned `Math.max(literal, Math.ceil(...))`, and NOT a spread. The gate's own test asserts this exact shape is spared (`chartDoctrine.test.ts:149-159`). ✓
  - `alertLog.ts:279,291`: `maxCount = real.reduce((m,b)=>Math.max(m,b.count??0),0)`; `value: count/maxCount`. This feeds the legacy `RankedRow` primitive (`AlertBreakdown.svelte:49,66,83`), NOT a ChartSpec magnitude `domain`. It is a WITHIN-distribution by-cause/effect/severity bar (comparing buckets inside ONE alert distribution), the doctrine's named `max*` within-distribution pattern; the real count rides `display` (`alertLog.ts:292`). `Math.max(m, x)` is a 2-arg reduce accumulator, not a spread — the gate does not (and should not) flag it. ✓

No relative-to-in-view-max magnitude mark found. CLEAN.

---

## SUMMARY OF VERDICTS

| Item | Verdict |
|---|---|
| (1) Share normalization | SOUND — renormalizes to 100 after filtering; null/zero-denom → absence, never fabricated split |
| (2) sparkDomain | SOUND — data-anchored shape channel (explicitly carved out), literal ±10%/floor-1 pad, `reals<2→null` |
| (3) otpTrendDomain | SOUND — literal ±2 pad, [0,100]-clamped, 8-pt min-span floor, ref inside window, stable per window |
| (4) Wilson usage | SOUND — z=1.96, one kernel, CI from same n as point estimate everywhere; weakStops complement-flip correct |
| Chart Doctrine /max sweep | CLEAN — gate live + allowlist empty; only sanctioned within-distribution peaks (reduce, not spread) |

No BUGs found.
