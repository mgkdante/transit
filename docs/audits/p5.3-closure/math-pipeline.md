# MATH RE-VERIFICATION — Lane 2 (pipeline formula chain, apps/db @ HEAD 2273280)

Scope: spot-re-verify the five pipeline formulas a 2026-07-01 audit blessed, confirming they STILL hold at current HEAD. Read-only.

Summary of verdicts:
1. CDF percentile (p50/p90 histogram interp) — **SOUND** (one cosmetic underflow-edge note, non-load-bearing).
2. Wilson score interval — **SOUND** (no continuity correction, by design; z, n, center, margin all correct).
3. EWT excess wait time — **SOUND** (Welding/Osuna-Newell AWT; units consistent in minutes).
4. CoV coefficient of variation — **SOUND** (Bessel n-1, guarded n>=2 AND mean>0).
5. GC2 scheduled-universe denominator — **SOUND for STO calendar_dates-only resolution**, but a real **UNIVERSE-SKEW BUG** in `silent_trip_days`/`delivered_trip_days`: the RT-observed numerator (`obs.total_trip_days`) is counted over a CAPTURE-day window that mixes GTFS service days, while the scheduled denominator is a single service-day universe. Details in §5.

---

## 1. CDF-based percentile (p50/p90 delay + headway)

Core: `src/transit_ops/gold/reader/percentile.py:24` `cdf_percentile(hist, q, edges)`.
Wrapper (delay, sec→min, round): `percentile.py:51` `pctile_min_from_hist`.
Delay edges (21): `src/transit_ops/gold/rollups.py:786` `DELAY_HISTOGRAM_EDGES` (21 entries, sec).
Gap edges (21→20 bins): `rollups.py:804` `HEADWAY_GAP_HISTOGRAM_EDGES` (min).
Delay histogram build (21 bins, bin_idx 0..20): `rollups.py:833-936` (`width_bucket` → `LEAST(GREATEST(wb,1),21)-1`).
Gap histogram build (20 bins, bin_idx 0..19): `rollups.py:1899` (`LEAST(GREATEST(wb,1),20)-1`).
Callers: `_spine.py:81` (delay via `pctile_min_from_hist`), `_spine.py:506`/`_spine.py:566` (gap median via `cdf_percentile`).

Formula: target = q·total; walk bins accumulating counts; in the first bin where `cumulative+count >= target`, interpolate linearly `lo + (hi-lo)·(target-cumulative)/count`. Terminal overflow bin (bin_idx+1 >= len(edges)) floors at `lo`.

Bin/edge alignment check:
- Delay: 21 edges, 21 histogram bins. bin_idx i uses `edges[i]` as lo, `edges[i+1]` as hi. For i=20, `edges[21]` is out of range (len=21) → the terminal floor branch returns `edges[20]=3600`. This is the documented [3600,+inf) pin. CORRECT.
- Gap: 21 edges, 20 histogram bins. Max bin_idx=19 uses `edges[19]=180` lo, `edges[20]=240` hi — always a valid finite interp. Terminal branch is dead code (finite clamp 0<gap<240). CORRECT.

Hand-verify (delay p90). hist has total=100. Suppose cumulative reaches 88 just before bin_idx=15 (edges[15]=300, edges[16]=420), and that bin has count=8. target=0.9·100=90. cumulative(before)=88, so 88+8=96 >= 90 → lands here. frac=(90-88)/8=0.25 → raw = 300 + (420-300)·0.25 = 330 sec → /60 = 5.5 min → round_half_away(5.5,1)=5.5. Correct interpolation, correct unit conversion.

Empty-bucket handling: `if not hist: return None`; `total<=0: return None`; per-bin `if count<=0: continue` (skips empty bins cleanly — a run of empty bins can't be the landing bin because the guard requires count>0 at the `>=target` test). CORRECT (honest-None).

Boundary/DST/tz:
- No timezone in the interpolator (pure array math). Bins were filled at build time by `EXTRACT(HOUR FROM timezone(dp.timezone, captured_at_utc))` grouping (`rollups.py:837`), which is provider-local and DST-correct.
- **Cosmetic underflow-edge note (NOT a bug):** `width_bucket` returns 0 for `x < edges[0]`; `GREATEST(wb,1)` folds that underflow into bin_idx 0, whose CDF `lo` is `edges[0]` (-3600 for delay, 0.0 for gap). A delay below -3600 is already ghost-clamped out at build (`ABS(delay)<=3600`), so no such value ever reaches bin 0; for gaps the clamp is `gap>0` so nothing lands below edges[0]=0.0. So the fold is unreachable in practice. No published value moves.

**Verdict: SOUND.**

---

## 2. Wilson score interval (on-time / severe / cancellation proportions)

Source: `src/transit_ops/gold/reader/rates.py:47` `wilson_bounds(successes, n, *, z=1.96)`.
Constants: `rates.py:23` MIN_N_RATE=30 (display-only), `rates.py:24` WILSON_Z=1.96.
Callers: `_spine.py:287,366,681`, `stop_reliability.py:329,348`, `network_trend.py:324`.

Code:
```
p = k/total;  z2 = z*z
denom  = 1 + z2/total
center = (p + z2/(2*total)) / denom
margin = z * sqrt( p*(1-p)/total + z2/(4*total^2) ) / denom
lo = max(0, (center-margin)*100);  hi = min(100, (center+margin)*100)
```

This is the textbook Wilson score interval (no continuity correction):
center = (p̂ + z²/2n)/(1+z²/n); margin = z/(1+z²/n)·sqrt(p̂(1-p̂)/n + z²/4n²). Matches exactly.

- **z**: 1.96 = 95% two-sided. Correct.
- **continuity**: NOT applied. This is a deliberate choice (plain Wilson, the common ranking-lower-bound convention). Not a bug — plain Wilson is a valid, widely used interval; the CC variant is more conservative but not "more correct". Documented intent (rank on lower bound to defeat tiny-n flukes).
- **n definition**: `n = known` (the on-time DENOMINATOR = delay observations in [-60,300) band's denominator = `known_obs`/`obs`), and `successes = on_time`/`severe_k`. `k` is clamped into [0,n] (`rates.py:63`) so a numerator overshoot can't produce p>1. Consistent with the point-estimate `otp_pct` (same numerator/denominator). CORRECT.

Hand-verify (n=1, k=1): p=1, z2=3.8416, denom=1+3.8416=4.8416, center=(1+1.9208)/4.8416=0.6027, margin=1.96·sqrt(0 + 3.8416/4)/4.8416 = 1.96·sqrt(0.9604)/4.8416 = 1.96·0.98/4.8416=0.3967. lo=(0.6027-0.3967)·100=20.6%, hi=100%. So 1-of-1 gives lower bound 20.6% (not 100%) — exactly the tiny-n guard intended. Matches the known Wilson value for 1/1 at 95% (≈0.207). CORRECT.

Guards: `successes is None or not n → None`; `total<=0 → None`. Honest-None, mirrors `otp_pct`. CORRECT.

**Verdict: SOUND.**

---

## 3. EWT excess wait time

Source: `src/transit_ops/gold/reader/histogram.py:85` `ewt_min(sum_gap, sum_gap_sq, scheduled)`.
Caller: `_spine.py:575` `ewt_min(sum_gap_min, sum_gap_sq_min, sched)`.
Moment sums built: `rollups.py:1933-1934` `SUM(gap_min)`, `SUM(gap_min*gap_min)` (both MINUTES; gap_min = EPOCH(Δ)/60 at `rollups.py:1891`).
Scheduled headway (minutes): `_helpers.py:637` `_scheduled_headway_by_shift` → `_median_headway` (`_helpers.py:294`, returns minutes).

Formula:
AWT = E[H²]/(2·E[H]) = Σgap²/(2·Σgap); SWT = scheduled/2; EWT = max(0, AWT − SWT).

- This is the standard passenger-weighted (Welding / Osuna-Newell) EWT. E[H²]/(2E[H]) is the mean wait of a random arrival under gap distribution H (long gaps catch proportionally more riders). Correct.
- **Units**: numerator Σgap² and denominator Σgap are both minute-based, so AWT is in minutes. `scheduled/2` is minutes (scheduled headway is minutes). max(0, min − min) = min. Consistent. CORRECT.
- **Clamp**: `max(0, ...)` — actual-more-frequent-than-scheduled → honest 0, never negative. CORRECT.
- **Guards**: `sum_gap>0` else AWT=None→None; `scheduled is None → None`. Honest-None. CORRECT.

Hand-verify: gaps [4,4,10] min (Σgap=18, Σgap²=16+16+100=132). AWT=132/(2·18)=132/36=3.667 min. If scheduled=6 (so SWT=3), EWT=max(0, 3.667−3)=0.667 → round_half_away(.,1)=0.7 min. Even service would give AWT=mean/2·(1)= for even 6-min service AWT=3 (=SWT) → EWT 0; the bunched [4,4,10] correctly shows positive excess. CORRECT.

Boundary: Σgap>0 division-guard present. No tz math (moments pre-summed). SOUND.

**Verdict: SOUND.**

---

## 4. CoV coefficient of variation (regularity)

Source: `src/transit_ops/gold/reader/histogram.py:105` `_COV_CASE_TEMPLATE` / `cov_case_sql`.
Caller: `_spine.py:536` `cov_case_sql(n="SUM(gap_count)", total="SUM(sum_gap_min)", total_sq="SUM(sum_gap_sq_min)")`.

SQL:
```
CASE WHEN n>=2 AND total>0 THEN
  ROUND( sqrt( GREATEST( (total_sq - total^2/n)/(n-1), 0) ) / (total/n) , 4)
END
```

Decompose: mean = total/n = Σgap/n. sample variance (Bessel n-1) = (Σgap² − (Σgap)²/n)/(n−1). SD = sqrt(variance). CoV = SD/mean. This is the correct pooled recomposition of `stddev_samp(gap)/avg(gap)` from additive moments. CORRECT.

- **mean/std source**: both recomposed from the same additive moment sums (Σgap, Σgap², n) on `route_headway_shift_daily` — self-consistent, no cross-source drift.
- **guard against mean≈0**: `total>0` gates the CASE, and mean = total/n so mean>0 whenever total>0 and n>=2. No division by zero. (Since gaps are clamped `gap_min>0` at build, total is a sum of strictly-positive values, so total>0 ⟺ at least one gap ⟺ safe.) CORRECT.
- **n>=2 guard**: Bessel divides by (n−1); n>=2 → denominator >=1. CORRECT.
- **GREATEST(...,0)**: guards a tiny negative variance from float cancellation before sqrt. CORRECT (defensive, right).

Hand-verify: gaps [4,4,10], n=3, total=18, total_sq=132. variance=(132 − 18²/3)/(3−1)=(132−108)/2=12. SD=sqrt(12)=3.464. mean=18/3=6. CoV=3.464/6=0.5774 → ROUND(.,4)=0.5774. Matches stddev_samp([4,4,10])/mean = 3.4641/6. CORRECT.

**Verdict: SOUND.**

---

## 5. GC2 scheduled-universe denominator (STO calendar_dates-only)

### 5a. Service-on-date resolution (the STO concern) — SOUND
Source: `rollups.py:389` `UPSERT_ROUTE_SCHEDULED_TRIPS_DAILY`, `active_service` CTE `rollups.py:403-433`.

Rule (matches GTFS canon, `rollups.py:377-382`):
```
active(service_id, D) =
  ( calendar covers D AND weekday-bool(isodow(D)) true
    AND NOT EXISTS calendar_dates(type=2 removal) for (service_id, D) )
  OR EXISTS calendar_dates(type=1 addition) for (service_id, D)
```
- The UNION's second arm (type=1 additions) fires with **zero calendar rows** — so a calendar_dates-only feed (STO) resolves entirely through additions. CORRECT for STO.
- Edition pinned to `is_current=true` (`rollups.py:392-402`), last-writer-wins on conflict. Scheduled count = `COUNT(DISTINCT trip_id)` per route active on D joined via `active_service`. CORRECT.
- Shared predicate with `_helpers.py` `_REP_DATES_SQL` (H2) by cross-referenced duplication (`rollups.py:385-387`) — no drift. Reasonable.
- ISODOW weekday map + `BETWEEN start_date AND end_date` correct; type-2 removals correctly subtract via NOT EXISTS. CORRECT.

### 5b. Numerator vs denominator UNIVERSE ALIGNMENT — **BUG (universe skew)**
Numerator side (`route_cancellation_daily`, `rollups.py:288`):
- `trip_day` CTE (`rollups.py:291-305`): DISTINCT `(trip_id, start_date)` filtered ONLY by `f.snapshot_date_key = :date_key` (the **capture** day = local_date). It groups by `f.start_date` as `service_date` but **does NOT filter `start_date = :local_date`**.
- `obs` CTE (`rollups.py:306-320`): collapses to `GROUP BY provider_id, route_id` — summing `total_trip_days` over **all service days observed within capture-day D**.

Denominator side (`route_scheduled_trips_daily`): trips active on **exactly service day D** (via `active_service` for D = :local_date).

Join + derived splits (`rollups.py:341-348`):
```
scheduled_trip_days = sch.scheduled_trip_count            -- service-day-D universe
delivered_trip_days = obs.total - obs.canceled            -- capture-day-D universe (mixed service days)
silent_trip_days    = GREATEST(scheduled - obs.total, 0)  -- mixes the two universes
```

**Failure case:** STM/STO run overnight (cross-midnight) service. On capture-day D, `fact_trip_delay_snapshot` contains the post-midnight TAIL of service-day D−1 trips (captured 00:00–~05:00 local on day D) AND the daytime service-day-D trips. `trip_day` counts BOTH (distinct on start_date, but obs sums across start_dates). So `obs.total_trip_days` for route R on day D can EXCEED the true count of service-day-D trip-days by the overnight-tail trips whose start_date = D−1. Then:
- `silent_trip_days = GREATEST(scheduled(D) − obs.total, 0)` is UNDER-counted (the inflated obs.total eats into the silent gap), potentially clamping a genuinely-silent route to 0.
- `delivered_trip_days` is OVER-counted (includes D−1 tail deliveries against a D-only scheduled denominator).
- Read-time `service_completeness_pct = 100·delivered/scheduled` (`route_reliability.py:174`) is therefore inflated for routes with overnight service — and the GC2 comment at `route_reliability.py:158` treats `delivered > scheduled` as "legitimate (added trips)", which will MASK this skew rather than flag it.

Note the pipeline is aware the two dates differ elsewhere: `route_service_span` and the headway builder both deliberately re-grain by GTFS **service day** using a 2-day window filtered `start_date = local_date−1` (`rollups.py:694`, `rollups.py:1872`), precisely to avoid this capture-vs-service split. The cancellation/scheduled join did NOT get that treatment — obs stays on the capture-day grain with no `start_date = :local_date` filter, while scheduled is service-day-D.

Severity: moderate. It does NOT corrupt the RT-observed `cancellation_rate_pct` (numerator and denominator there are both from `trip_day`, self-consistent — `rollups.py:316`). It only skews the scheduled-aware split columns (`silent_trip_days`, `delivered_trip_days`) and the read-time `service_completeness_pct`. Magnitude ∝ share of overnight-tail trips (small for a mostly-daytime network, non-trivial for 24h night routes). This is a pre-existing GC2 design characteristic (H1), so it likely predates the 2026-07-01 audit — flagging because the task asks whether the denominator "matches the numerator's universe (same service day…)": **it does not**.

Suggested fix direction (not applied — read-only): add `AND f.start_date = :local_date` to the `trip_day` WHERE (aligning obs to service-day-D), OR widen scheduled to the same capture-day universe. The service-span/headway 2-day-window pattern is the established precedent.

**Verdict: service-on-date resolution SOUND (STO works); numerator/denominator UNIVERSE MISMATCH = BUG for `silent_trip_days`/`delivered_trip_days`/`service_completeness_pct` on routes with cross-midnight service.**

---

## Cross-cutting boundary/tz/DST notes
- All local-day grains key off `snapshot_date_key` (indexed YYYYMMDD, provider-local) + `snapshot_local_date`; hour buckets use `timezone(dp.timezone, captured_at_utc)` — DST-correct at build. Percentile-day watermark uses `timezone('UTC', local_date::timestamp)` as an injective date→ts key, identical in writer and reader (`rollups.py:183` vs `rollups.py:209`) — synthetic, not a real UTC instant, so DST is irrelevant there. No DST hazard found in formulas 1–4.
- The one genuine date-universe hazard is §5b (capture-day vs service-day), an aggregation-grain issue, not a tz/DST arithmetic issue.
