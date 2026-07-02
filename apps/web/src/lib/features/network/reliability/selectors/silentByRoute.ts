// selectSilentByRoute — the non-responding (silent) scheduled trips, ranked per route.
//
// Ported VERBATIM from the NetworkHealth god-file. `non_responding_by_route` is per-ROUTE
// counts of scheduled trips running NOW with no live vehicle (already ordered count DESC /
// route_id ASC by the builder). Honest: silent trips have no vehicle id, so this is a
// per-LINE silent-trip tally, NOT vehicle ids (the global-signal caveat lives in the copy).
//
// Chart-doctrine: a FIXED absolute [0,10] domain for the count bars (per-route entity
// comparison) — NEVER the in-view worst line. 10 simultaneous silent trips on ONE line ≈ a
// line-level AVL outage → saturates the bar; a typical 1-4 reads honestly small and the same
// across every snapshot. The rank + the "N trips" display carry the precise cross-line
// comparison. The bar rides RankedRow/SeverityBar on this domain (the A-code absolute law).

import type { SeverityCode, NonRespondingRoute } from '$lib/v1/schemas';

/** The fixed absolute count domain for the silent-trip bars (never the in-view worst). */
export const NON_RESPONDING_DOMAIN: readonly [number, number] = [0, 10];

/** One ranked silent-line row (a RankedRow-ready shape carrying its absolute domain). */
export interface SilentRow {
	readonly key: string;
	readonly rank: number;
	readonly title: string;
	readonly subtitle: string;
	readonly severity: SeverityCode;
	/** Raw count on NON_RESPONDING_DOMAIN (forwarded to RankedRow/SeverityBar). */
	readonly value: number;
	readonly display: string;
	readonly href: string;
	readonly ariaLabel: string;
}

/** Already-localized label functions (i18n stays out of the selector). */
export interface SilentRowLabels {
	/** rid → the rider-facing route name through the unknown-data layer (e.g. "Route 24"). */
	routeName: (routeId: string) => string;
	/** Per-row subtitle prefix (e.g. "Line"). */
	rowLabel: string;
	/** rid → the localized count display (e.g. "2 trips"). */
	display: (routeId: string, count: number) => string;
	/** rid → the deep-link href (localized /lines/[id]). */
	href: (routeId: string) => string;
	/** rid → the localized link accessible name (e.g. "View line 51"). */
	viewDetail: (routeId: string) => string;
}

export function selectSilentByRoute(
	rows: readonly NonRespondingRoute[] | null | undefined,
	labels: SilentRowLabels,
): SilentRow[] {
	if (rows == null || rows.length === 0) return [];
	return rows.map((r, i) => ({
		key: r.route_id,
		rank: i + 1,
		title: labels.routeName(r.route_id),
		subtitle: labels.rowLabel,
		// A silent scheduled trip is a service gap → the bar reads on the critical band.
		severity: 'critical' as SeverityCode,
		value: r.count,
		display: labels.display(r.route_id, r.count),
		href: labels.href(r.route_id),
		ariaLabel: labels.viewDetail(r.route_id),
	}));
}
