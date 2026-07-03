// sparkDomain — the data-anchored zoom domain for TICKLESS mini-trends (P5.2).
//
// ADJUDICATION (extends the S9B ruling in features/reliability/domains.ts): a
// sparkline is a SHAPE channel — a tickless inline read with no axis, no
// cross-view comparison — so pinning it to a fixed absolute domain would erase
// the very wiggle it exists to show (the legacy Sparkline normalised to the
// in-view extremes for exactly this reason). The honest form is the S9B one:
// a DATA-ANCHORED window with literal symmetric padding, computed ONCE in the
// selector so the SPEC carries an explicit domain the mark never derives.
// Cross-view magnitude marks stay on their fixed domains — this helper is for
// `kind: 'sparkline'` specs only.
//
// Loop-form min/max on purpose: the chartDoctrine gate bans `Math.max(...xs)`
// feeding a chart scale (the in-view /max smell); this helper is the one
// blessed, documented owner of the data-anchored zoom.

import type { AbsoluteDomain } from './ChartSpec';

export interface SparkDomainOpts {
	/** Clamp bounds (e.g. [0, 100] for a percentage). Defaults: lo 0, hi unbounded. */
	readonly clampLo?: number;
	readonly clampHi?: number;
}

/**
 * The padded [lo, hi] window around the series' real extremes. Returns null when
 * fewer than two real points exist (no shape to zoom — the caller stands down).
 */
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
	// Literal symmetric padding: 10% of the real span, floored at 1 unit.
	const pad = Math.max(1, Math.round((hi - lo) * 0.1));
	const clampLo = opts.clampLo ?? 0;
	let min = Math.max(clampLo, lo - pad);
	let max = hi + pad;
	if (opts.clampHi != null) max = Math.min(opts.clampHi, max);
	if (min > max) [min, max] = [max, min];
	return [min, max];
}
