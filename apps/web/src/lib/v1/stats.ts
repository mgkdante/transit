// $lib/v1/stats — the Chart Doctrine honesty spine (client side).
//
// The single place the web defines "reliable enough" and the confidence channel,
// mirroring the server-authoritative values surfaced in Provenance.methodology
// (min_n_rate / wilson_z). See the Transit Chart Doctrine § "Constants Registry"
// (Notion → Architecture). DISPLAY-ONLY: the pipeline never suppresses a rate, so
// the web keeps the raw observation_count and gates presentation here.
//
// SSR-safe: pure functions + constants, no DOM, no `window`, no Math.random.

/** Proportion reliability floor (OTP / cancellation / silent / on-time-band %). */
export const MIN_N_RATE = 30;
/** Below this denominator, show the raw fraction — a percentage string is forbidden. */
export const RATE_DISPLAY_FLOOR = 10;
/** 4..MIN_N_RATE → render raw marks (strip/dot), not a summary. */
export const STRIP_FLOOR = 4;
/** n ≤ this → prose, never a chart. */
export const SENTENCE_FLOOR = 3;
/** A connected time-series line needs at least this many real points. */
export const MIN_POINTS_FOR_LINE = 7;
/** 95% two-sided Wilson score interval. */
export const WILSON_Z = 1.96;

/** Degradation ladder bucket for a sample of size `n` (Doctrine §4.0). */
export type DisplayTier = 'full' | 'strip' | 'sentence' | 'none';

/**
 * The honest display tier for a sample size. `none` when n is missing/zero;
 * `sentence` for n ≤ {@link SENTENCE_FLOOR}; `strip` for STRIP_FLOOR..<MIN_N_RATE;
 * `full` at/above {@link MIN_N_RATE}. Unknown depth (null/undefined) → `none` so a
 * caller never assumes `full` off a missing count.
 */
export function tierFor(n: number | null | undefined): DisplayTier {
	if (n == null || !Number.isFinite(n) || n <= 0) return 'none';
	if (n <= SENTENCE_FLOOR) return 'sentence';
	if (n < MIN_N_RATE) return 'strip';
	return 'full';
}

/** True when a rate has enough observations to print as a reliable percentage. */
export function isReliableRate(n: number | null | undefined): boolean {
	return n != null && Number.isFinite(n) && n >= MIN_N_RATE;
}

/** True when a non-zero count is too small to show even as a raw figure. */
export function isSuppressedCount(n: number | null | undefined): boolean {
	return n != null && n > 0 && n < RATE_DISPLAY_FLOOR;
}

/**
 * 95% Wilson score interval [lo, hi] in PERCENT (0..100) for `successes`/`n`, or
 * null when the numerator is unknown or the denominator is falsy/≤0. Byte-for-byte
 * the server's `_wilson_bounds` (same z, same clamp, same rounding) so a
 * client-computed bound (live tier) matches a server-emitted one. `successes` is
 * clamped into [0, n].
 */
export function wilsonBounds(
	successes: number | null | undefined,
	n: number | null | undefined,
	z: number = WILSON_Z,
): [number, number] | null {
	if (successes == null || !n || !Number.isFinite(n) || n <= 0) return null;
	const total = n;
	const k = Math.min(Math.max(successes, 0), total);
	const p = k / total;
	const z2 = z * z;
	const denom = 1 + z2 / total;
	const center = (p + z2 / (2 * total)) / denom;
	const margin = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
	const lo = Math.max(0, (center - margin) * 100);
	const hi = Math.min(100, (center + margin) * 100);
	return [round1(lo), round1(hi)];
}

/** Wilson lower bound in percent, or null. Rank on THIS, never the raw rate. */
export function wilsonLo(
	successes: number | null | undefined,
	n: number | null | undefined,
	z: number = WILSON_Z,
): number | null {
	return wilsonBounds(successes, n, z)?.[0] ?? null;
}

/** Wilson upper bound in percent, or null. */
export function wilsonHi(
	successes: number | null | undefined,
	n: number | null | undefined,
	z: number = WILSON_Z,
): number | null {
	return wilsonBounds(successes, n, z)?.[1] ?? null;
}

/**
 * Stable descending rank by a lower-bound accessor (the Wilson lower bound a
 * period already carries, or a client-computed one). Items whose bound is
 * null/NaN sort LAST in their original order — a missing bound never out-ranks a
 * real one. Returns a new array; the input is not mutated.
 */
export function rankByLowerBound<T>(
	items: readonly T[],
	lowerBound: (item: T) => number | null | undefined,
): T[] {
	return items
		.map((item, i) => ({ item, i, lb: lowerBound(item) }))
		.sort((a, b) => {
			const av = a.lb == null || Number.isNaN(a.lb) ? -Infinity : a.lb;
			const bv = b.lb == null || Number.isNaN(b.lb) ? -Infinity : b.lb;
			return bv - av || a.i - b.i; // ties + missing keep input order (stable)
		})
		.map((entry) => entry.item);
}

function round1(x: number): number {
	return Math.round(x * 10) / 10;
}
