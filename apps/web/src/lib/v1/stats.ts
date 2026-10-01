export const MIN_N_RATE = 30;
const RATE_DISPLAY_FLOOR = 10;
const SENTENCE_FLOOR = 3;
export const MIN_POINTS_FOR_LINE = 7;
export const WILSON_Z = 1.96;

export type DisplayTier = 'full' | 'strip' | 'sentence' | 'none';

export function tierFor(n: number | null | undefined): DisplayTier {
	if (n == null || !Number.isFinite(n) || n <= 0) return 'none';
	if (n <= SENTENCE_FLOOR) return 'sentence';
	if (n < MIN_N_RATE) return 'strip';
	return 'full';
}

export function isReliableRate(n: number | null | undefined): boolean {
	return n != null && Number.isFinite(n) && n >= MIN_N_RATE;
}

export function isSuppressedCount(n: number | null | undefined): boolean {
	return n != null && n > 0 && n < RATE_DISPLAY_FLOOR;
}

export function wilsonBoundsProportion(
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
	const lo = Math.max(0, center - margin);
	const hi = Math.min(1, center + margin);
	return [lo, hi];
}

export function wilsonBounds(
	successes: number | null | undefined,
	n: number | null | undefined,
	z: number = WILSON_Z,
): [number, number] | null {
	const p = wilsonBoundsProportion(successes, n, z);
	if (p == null) return null;
	return [round1(p[0] * 100), round1(p[1] * 100)];
}

export function wilsonLo(
	successes: number | null | undefined,
	n: number | null | undefined,
	z: number = WILSON_Z,
): number | null {
	return wilsonBounds(successes, n, z)?.[0] ?? null;
}

export function wilsonHi(
	successes: number | null | undefined,
	n: number | null | undefined,
	z: number = WILSON_Z,
): number | null {
	return wilsonBounds(successes, n, z)?.[1] ?? null;
}

export function rankByLowerBound<T>(
	items: readonly T[],
	lowerBound: (item: T) => number | null | undefined,
): T[] {
	return items
		.map((item, i) => ({ item, i, lb: lowerBound(item) }))
		.sort((a, b) => {
			const av = a.lb == null || Number.isNaN(a.lb) ? -Infinity : a.lb;
			const bv = b.lb == null || Number.isNaN(b.lb) ? -Infinity : b.lb;
			return bv - av || a.i - b.i;
		})
		.map((entry) => entry.item);
}

function round1(x: number): number {
	return Math.round(x * 10) / 10;
}
