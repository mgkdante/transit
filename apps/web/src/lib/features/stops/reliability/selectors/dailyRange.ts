// dailyRange — pool the served StopReliability.daily[] over a date window EXACTLY.
//
// SERVE-THE-COUNTS contract (DB lane): each StopDailyPoint carries the EXACT
// observation_count + severe_count ingredients, so an arbitrary sub-range is
// pooled by SUMMING those counts and recomputing severe_pct + a Wilson interval
// client-side ($lib/v1/stats) — with NO fabricated re-aggregation. avg_delay_min
// is pooled as an OBSERVATION-WEIGHTED mean of the per-day averages (the only
// honest pool without the raw per-day delay sum; days with a null avg drop out of
// that mean but still count toward observations/severe). Honest absence: below
// MIN_N_RATE the share is withheld (the caller shows the belowMinN note), and a
// window with zero pooled observations returns an empty verdict.
//
// The severe_pct pooling MUST match the server's _severe_pct (100·severe/obs,
// half-away 1dp) — the stop_daily.test.ts pooling invariant pins this.

import { wilsonBoundsProportion, MIN_N_RATE } from '$lib/v1/stats';
import type { StopDailyPoint } from '$lib/v1';
import type { DateWindow } from '$lib/filters';

/** The pooled verdict over a window — all fields honest-null when unpoolable. */
export interface DailyRangeVerdict {
	/** Days that fell inside the window AND carried observations (the true span, honest about gaps). */
	readonly daysWithData: number;
	/** The first / last dated day actually pooled (null when empty). */
	readonly from: string | null;
	readonly to: string | null;
	/** Σ observation_count over the pooled days. */
	readonly observations: number;
	/** Σ severe_count over the pooled days. */
	readonly severeCount: number;
	/**
	 * Pooled severe-delay share in PERCENT (Σsevere / Σobs × 100, 1dp), or null
	 * when observations < MIN_N_RATE (too thin to print a reliable percentage).
	 */
	readonly severePct: number | null;
	/** Wilson 95% bounds on the severe share in PERCENT, or null below MIN_N / no obs. */
	readonly wilsonLo: number | null;
	readonly wilsonHi: number | null;
	/** Observation-weighted mean avg delay (min), or null when no day carried one. */
	readonly avgDelayMin: number | null;
	/** True when observations ≥ MIN_N_RATE (a reliable percentage may print). */
	readonly reliable: boolean;
}

function round1(x: number): number {
	// Half-away at 1dp (severe_pct ≥ 0 always, so === Math.round for these inputs) —
	// byte-matches the server's _severe_pct so the pool never diverges from the wire.
	return Math.round(x * 10) / 10;
}

/**
 * Pool the daily series into a single verdict over `window` (inclusive, ISO
 * yyyy-mm-dd string compare). A null/undefined window pools the WHOLE series
 * (the default full-window view before S8B's picker narrows it). Zero-observation
 * days are already absent from the series, so every pooled day contributes.
 */
export function poolDailyRange(
	daily: readonly StopDailyPoint[] | null | undefined,
	window?: DateWindow | null,
): DailyRangeVerdict {
	const inRange = (daily ?? [])
		.filter((p) => (window ? p.date >= window.from && p.date <= window.to : true))
		// Only days that actually carried observations pool (defensive: the series
		// should already omit zero-observation days, but never divide by a phantom).
		.filter((p) => p.observation_count > 0)
		.slice()
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

	if (inRange.length === 0) {
		return {
			daysWithData: 0,
			from: null,
			to: null,
			observations: 0,
			severeCount: 0,
			severePct: null,
			wilsonLo: null,
			wilsonHi: null,
			avgDelayMin: null,
			reliable: false,
		};
	}

	let observations = 0;
	let severeCount = 0;
	// Observation-weighted avg-delay accumulator (only over days carrying a real avg).
	let avgWeightedSum = 0;
	let avgWeightN = 0;
	for (const p of inRange) {
		observations += p.observation_count;
		severeCount += p.severe_count;
		if (p.avg_delay_min != null) {
			avgWeightedSum += p.avg_delay_min * p.observation_count;
			avgWeightN += p.observation_count;
		}
	}

	const reliable = observations >= MIN_N_RATE;
	// The pooled share is a REAL re-computation off the summed counts (not a stored
	// average) — withheld below MIN_N so a thin window never prints a firm percentage.
	const severePct = reliable ? round1((100 * severeCount) / observations) : null;
	const wilson = reliable ? wilsonBoundsProportion(severeCount, observations) : null;
	const avgDelayMin = avgWeightN > 0 ? round1(avgWeightedSum / avgWeightN) : null;

	return {
		daysWithData: inRange.length,
		from: inRange[0].date,
		to: inRange[inRange.length - 1].date,
		observations,
		severeCount,
		severePct,
		wilsonLo: wilson ? round1(wilson[0] * 100) : null,
		wilsonHi: wilson ? round1(wilson[1] * 100) : null,
		avgDelayMin,
		reliable,
	};
}
