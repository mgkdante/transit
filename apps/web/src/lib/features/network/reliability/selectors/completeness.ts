// selectCompleteness — the network SERVICE-COMPLETENESS view-model (S9B · DECISIONS B4).
//
// service_completeness_rate is GC2's schedule-aware delivered/scheduled share (100 × Σdelivered /
// Σscheduled) on the network TrendPoint — a DIFFERENT denominator than cancellation_rate. It is
// null across the whole retained window on prod today (pre-0073 ramp-in), so this selector must be
// honest about absence: it stands UP only once ANY windowed point carries a non-null rate, and
// reports the LATEST such bucket's value as a single served rate (a completeness SHARE — a
// percentage on the full [0,100] whole — NOT a second flat trend line to zoom).
//
// The delivered/scheduled/silent SPLIT is NOT on the network TrendPoint (it lives per-route on
// CancellationPeriod), so this surface carries ONLY the rate; the "silent = scheduled but never
// appeared" framing is COPY, not a served split.

import type { TrendPoint } from '$lib/v1';

/** The service-completeness view-model the tile consumes. */
export interface CompletenessVM {
	/**
	 * True when ANY windowed point carries a non-null service_completeness_rate. False → the tile
	 * stands DOWN behind the honest-absence layer (no fabricated 0, no phantom bar) — today's prod
	 * reality until the GC2 scheduled-universe data accrues across the retained window.
	 */
	readonly hasData: boolean;
	/**
	 * The LATEST non-null completeness rate in the window (%), or null when hasData is false. A
	 * single served share, rendered on the absolute [0,100] whole (A3 completeness grammar).
	 */
	readonly latest: number | null;
}

/**
 * Build the completeness VM from the ALREADY-windowed trend series. Scans newest-first so a partial
 * series (recent buckets carry the rate, older ones null) reports the freshest served value.
 */
export function selectCompleteness(points: readonly TrendPoint[]): CompletenessVM {
	for (let i = points.length - 1; i >= 0; i--) {
		const r = points[i].service_completeness_rate;
		if (r != null && !Number.isNaN(r)) return { hasData: true, latest: r };
	}
	return { hasData: false, latest: null };
}
