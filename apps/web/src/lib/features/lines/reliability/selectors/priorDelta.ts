// priorDelta.ts — period-over-period Δ-vs-prior-window significance (PR-WEB-3).
//
// The windowed §1/§2 breakdown rows each carry the SAME metric over the immediately-prior
// equal-length window (prior_otp_pct / prior_observed_min + the prior denominator), so the
// web can render an honest "+N vs prior week" delta — GATED on significance so a swing
// within sampling noise never shouts. Two gates, one per metric SHAPE:
//
//   • proportionPriorDelta — for a RATE (on-time %). A textbook two-proportion z-test
//     (pooled standard error) on (this on_time / n) vs (prior on_time / prior n). Real at
//     95% (|z| ≥ WILSON_Z) AND both windows clear MIN_N_RATE. This is the rigorous path:
//     the reliability denominators run to the thousands, so a 1-pt move at n≈80k is a real
//     difference, while a 5-pt move at n≈30 is not — the test, not the magnitude, decides.
//
//   • meanPriorDelta — for a continuous MEAN (observed headway, minutes). A mean has no
//     binomial variance, so the proportion test is invalid; instead a two-sample z on the
//     means using the window's carried CoV (stddev/mean) as a SHARED dispersion estimate
//     s = (|value| + |priorValue|)/2 × cov (the average of the two means, so a rise and its
//     mirror-image fall get the SAME standard error — anchoring s to the current value alone
//     would skew the gate toward whichever direction lowered the mean). It is assumed stable
//     across two adjacent equal-length windows of the same shift (the contract carries no
//     prior CoV). SE = s·√(1/n + 1/priorN) folds the (small) headway gap-sample sizes in, so
//     a sparse window only clears the gate on a large, real move. Real at 95% AND both
//     windows clear MIN_POINTS_FOR_LINE gap observations AND a CoV is present.
//
// Both return delta=null + hasPrior=false when there is no prior window (the first window /
// the month grain / a shift the prior window never ran) — honest absence, never a fake 0.
// A has-prior-but-not-significant change keeps a real `delta` with significant=false (the
// consumer renders it neutrally, "within noise"). PURE (no runes/DOM, no Date/Math.random)
// → lives in the fast "data" vitest project, like the sibling stat selectors.

import { MIN_N_RATE, MIN_POINTS_FOR_LINE, WILSON_Z } from '$lib/v1/stats';

export interface PriorDelta {
	/** this − prior, in the metric's own unit (whole points for a rate, minutes for headway).
	 *  null ONLY when there is no prior window to compare against (honest absence). */
	readonly delta: number | null;
	/** True when a prior window exists (delta is non-null), regardless of significance. */
	readonly hasPrior: boolean;
	/** True ONLY when the change clears the 95% significance gate — safe to surface as a
	 *  coloured direction arrow. A has-prior-but-not-significant change reads "within noise". */
	readonly significant: boolean;
}

const ABSENT: PriorDelta = { delta: null, hasPrior: false, significant: false };

const isNum = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

/** Round to `dp` decimals (half-up), normalising -0 → 0. */
function round(x: number, dp: number): number {
	const f = 10 ** dp;
	const r = Math.round(x * f) / f;
	return r === 0 ? 0 : r;
}

export interface ProportionDeltaOpts {
	/** Exact current numerator (on_time). Falls back to round(pct/100 · n) when absent. */
	readonly onTime?: number | null;
	/** Min denominator each window must clear for significance. Default MIN_N_RATE. */
	readonly minN?: number;
}

/**
 * Two-proportion z-test Δ for a percentage metric. `pct` / `priorPct` are 0..100; `delta`
 * = pct − priorPct in whole points (the contract rounds OTP to an int). Significance pools
 * the two proportions for the standard error and requires both denominators ≥ minN.
 */
export function proportionPriorDelta(
	pct: number | null | undefined,
	n: number | null | undefined,
	priorPct: number | null | undefined,
	priorN: number | null | undefined,
	opts: ProportionDeltaOpts = {},
): PriorDelta {
	// No current OR no prior percentage → nothing to compare (honest absence).
	if (!isNum(pct) || !isNum(priorPct)) return ABSENT;
	const delta = round(pct - priorPct, 0);
	// A prior window exists; significance needs both real denominators.
	if (!isNum(n) || !isNum(priorN) || n <= 0 || priorN <= 0)
		return { delta, hasPrior: true, significant: false };
	const minN = opts.minN ?? MIN_N_RATE;
	const k1 = isNum(opts.onTime)
		? Math.min(Math.max(opts.onTime, 0), n)
		: Math.round((pct / 100) * n);
	const k2 = Math.round((priorPct / 100) * priorN);
	const p1 = k1 / n;
	const p2 = k2 / priorN;
	const pPool = (k1 + k2) / (n + priorN);
	const se = Math.sqrt(pPool * (1 - pPool) * (1 / n + 1 / priorN));
	const significant =
		n >= minN && priorN >= minN && se > 0 && Math.abs((p1 - p2) / se) >= WILSON_Z && delta !== 0;
	return { delta, hasPrior: true, significant };
}

export interface MeanDeltaOpts {
	/** The window's coefficient of variation (stddev/mean) — the shared dispersion estimate.
	 *  Absent/≤0 → the spread is unknown, so the change can never be called significant (the
	 *  `delta` still surfaces, neutrally). */
	readonly cov?: number | null;
	/** Decimals to round the delta to (the metric's display precision). Default 1. */
	readonly dp?: number;
	/** Min sample each window must clear for significance. Default MIN_POINTS_FOR_LINE. */
	readonly minN?: number;
}

/**
 * Two-sample z-test Δ for a continuous MEAN (e.g. observed headway, minutes). `delta` =
 * value − priorValue. Significance uses the window's CoV as a shared dispersion estimate
 * (s = |value| × cov) and the carried gap-sample sizes; it is deliberately conservative at
 * small n (the headway windows are sparse) so a sub-minute jitter never reads as real.
 */
export function meanPriorDelta(
	value: number | null | undefined,
	n: number | null | undefined,
	priorValue: number | null | undefined,
	priorN: number | null | undefined,
	opts: MeanDeltaOpts = {},
): PriorDelta {
	if (!isNum(value) || !isNum(priorValue)) return ABSENT;
	const dp = opts.dp ?? 1;
	const delta = round(value - priorValue, dp);
	if (!isNum(n) || !isNum(priorN) || n <= 0 || priorN <= 0)
		return { delta, hasPrior: true, significant: false };
	const minN = opts.minN ?? MIN_POINTS_FOR_LINE;
	const cov = opts.cov;
	let significant = false;
	if (isNum(cov) && cov > 0 && n >= minN && priorN >= minN) {
		// Symmetric shared dispersion: anchor s to the AVERAGE of the two means (not the current
		// one) so a rise and its mirror-image fall yield the same SE — an honest, direction-neutral
		// gate (the contract carries no prior CoV to do a full two-sample SE).
		const s = ((Math.abs(value) + Math.abs(priorValue)) / 2) * cov;
		const se = s * Math.sqrt(1 / n + 1 / priorN);
		significant = se > 0 && Math.abs((value - priorValue) / se) >= WILSON_Z && delta !== 0;
	}
	return { delta, hasPrior: true, significant };
}
