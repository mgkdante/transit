import type { AbsoluteDomain } from './ChartSpec';

export interface SparkDomainOpts {
	readonly clampLo?: number;
	readonly clampHi?: number;
}

export function sparkZoomDomain(
	values: ReadonlyArray<number | null>,
	opts: SparkDomainOpts = {},
): AbsoluteDomain | null {
	let lo = Number.POSITIVE_INFINITY;
	let hi = Number.NEGATIVE_INFINITY;
	let reals = 0;
	for (const v of values) {
		if (v == null || Number.isNaN(v)) continue;
		reals++;
		if (v < lo) lo = v;
		if (v > hi) hi = v;
	}
	if (reals < 2) return null;
	const pad = Math.max(1, Math.round((hi - lo) * 0.1));
	const clampLo = opts.clampLo ?? 0;
	let min = Math.max(clampLo, lo - pad);
	let max = hi + pad;
	if (opts.clampHi != null) max = Math.min(opts.clampHi, max);
	if (min > max) [min, max] = [max, min];
	return [min, max];
}
