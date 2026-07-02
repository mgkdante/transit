// ladderCap — the S12 worst-N ladder cap helpers (data-only; no runes, no locale).
//
// The worst-N cap is a codec-owned FilterState axis (?n — see $lib/filters): one of
// the fixed truthful rungs WORST_N_LADDER (5/10/20/30/50/100) or the uncapped 'all',
// default 10. This module maps that wire value to (a) a numeric slice cap the ladder
// selector truncates against and (b) the GrainPicker segment list the rail renders.
//
// TRUTH DISCIPLINE (WEB3): the cap is a DISPLAY axis only. Truncating to N never
// rescales the ranks — the ladder's absolute domain [0,100] is fixed and the DB
// Wilson-LB order is preserved (the selectWeakStops invariant). A smaller N shows
// fewer rows of the SAME bars, never longer ones.

import { WORST_N_LADDER, type WorstN } from '$lib/filters';
import type { GrainSegment } from '$lib/components/surface';

/** The surface default cap when ?n is absent (DECISIONS WEB3). */
export const DEFAULT_WORST_N: WorstN = '10';

/**
 * The numeric slice cap for a worst-N value. 'all' → Infinity (no truncation); a
 * numeric rung → its integer. The selector uses this only to `.slice(0, cap)`.
 */
export function worstNCap(n: WorstN): number {
	return n === 'all' ? Number.POSITIVE_INFINITY : Number(n);
}

/**
 * The GrainPicker segments for the worst-N rail control: every numeric rung labelled
 * by its own number, then an 'all' rung using the caller's localized "All" label. The
 * active chip is an INTERACTIVE affordance (--primary), never a data mark.
 */
export function worstNSegments(allLabel: string): GrainSegment<WorstN>[] {
	return [
		...WORST_N_LADDER.map((rung) => ({ key: rung, label: rung })),
		{ key: 'all' as const, label: allLabel },
	];
}

/**
 * The smallest rung — the control renders only when the full ranked count EXCEEDS it
 * (below it there's nothing to cap; the S7 `total > 5` gate). A number, not a string,
 * so callers compare against `total` directly.
 */
export const SMALLEST_WORST_N = Number(WORST_N_LADDER[0]);
