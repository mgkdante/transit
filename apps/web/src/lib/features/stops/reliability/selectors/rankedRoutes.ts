// rankedRoutes — the per-route ranked severity bars for a stop's by_route[].
//
// Ports the StopDetail inline `rankedRoutes` transform VERBATIM: rank the by_route
// breakdown worst-delay first, band each bar off its avg_delay_min on the dataviz
// severity scale, and scale it by the FIXED DELAY_POS_DOMAIN (never the in-view
// worst) so the same delay reads the same bar length across stops. Rows with a
// null delay are DROPPED (no fake-0 ranking).

import { DELAY_POS_DOMAIN } from '$lib/features/reliability/shiftGrains';
import type { SeverityCode, StopByRoute } from '$lib/v1/schemas';

/** One ranked route row (a RankedRow-ready shape carrying its absolute domain). */
export interface RankedRouteRow {
	readonly key: string;
	readonly rank: number;
	readonly title: string;
	readonly severity: SeverityCode;
	/** Raw avg delay (min) — the magnitude mark reads it on `domain`. */
	readonly value: number;
	readonly domain: readonly [number, number];
	readonly unit: string;
	readonly display: string;
}

/** `fmtMin`: the caller's minute formatter (kept out so i18n/rounding stays upstream). */
export function selectRankedRoutes(
	byRoute: readonly StopByRoute[] | null | undefined,
	fmtMin: (v: number | null) => string,
): RankedRouteRow[] {
	const rows = (byRoute ?? [])
		.filter((br): br is StopByRoute & { avg_delay_min: number } => br.avg_delay_min != null)
		.slice()
		.sort((a, b) => b.avg_delay_min - a.avg_delay_min);
	return rows.map((br, i) => {
		const delay = br.avg_delay_min;
		// ABSOLUTE severity off the real avg delay (never the in-view worst).
		const severity: SeverityCode = delay >= 10 ? 'critical' : delay >= 5 ? 'high' : 'watch';
		return {
			key: br.route,
			rank: i + 1,
			title: br.route,
			severity,
			value: delay,
			domain: DELAY_POS_DOMAIN,
			unit: ' min',
			display: fmtMin(delay),
		};
	});
}
