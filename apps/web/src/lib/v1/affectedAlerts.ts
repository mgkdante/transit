// affectedAlerts.ts — pure selectors that narrow live service alerts to the
// ones AFFECTING a single stop or route.
//
// Live alerts (live_alerts.json) carry the entities each alert touches as two
// optional arrays: `routes[]` (route ids) and `stops[]` (stop ids). The map
// builds union sets from these (see mapAlerts.buildAlertEntitySets) to recolour
// matching markers; the stop + route DETAIL surfaces instead need "which alerts
// affect THIS entity", which is what these selectors return.
//
// KEYING (conservative + correct, matching the contract's intent):
//   - A route alert affects a route iff the alert's routes[] lists that route id.
//   - A stop alert affects a stop iff EITHER the alert's stops[] lists the stop
//     id OR its code, OR the alert's routes[] intersects the routes that SERVE
//     the stop. The live feed targets stops by their public CODE (e.g.
//     stops:['10254']), which for ~72 stops (metro stations) differs from the
//     static index id — so a direct match on the id alone would silently miss a
//     genuine stop-targeted alert. We match the id OR the code (whichever the
//     feed used). The route-serving arm is what lets a "route 24 detour" surface
//     on every stop on route 24 even when the feed scopes the alert to the route,
//     not each stop — the common GTFS-RT shape (informed entities are usually
//     route-level). We never invent an association: a stop with no routes_served
//     only matches on its own id / code.
//
// ORDER: the matched alerts come back severity-first (critical > high > watch),
// stable within a tier (the publisher's source order is preserved). For a stop,
// a directly-targeted alert (matched by id/code) outranks a purely route-serving
// one when their severity ties — the more-specific alert reads first. These are
// pure filters: no de-duplication beyond what the feed carries, no fabrication.

import type { Alert } from './schemas/alerts';
import { SEVERITY_CODES, type SeverityCode } from './schemas/types';

/**
 * Rank a SeverityCode for descending sort — lower number = more severe.
 * Derived from the contract's canonical SEVERITY_CODES tuple (critical, high,
 * watch), so it can never drift from the enum. An unknown value sorts last.
 */
function severityRank(severity: SeverityCode): number {
	const i = (SEVERITY_CODES as readonly string[]).indexOf(severity);
	return i === -1 ? SEVERITY_CODES.length : i;
}

/** True iff `alert` lists `routeId` in its affected routes[]. */
function alertListsRoute(alert: Alert, routeId: string): boolean {
	return (alert.routes ?? []).includes(routeId);
}

/**
 * The alerts affecting a single ROUTE: every alert whose routes[] includes
 * `routeId`. Sorted severity-first (critical > high > watch), stable within a
 * tier (source order preserved); empty when none match (the caller stands the
 * section down).
 */
export function alertsForRoute(
	alerts: readonly Alert[] | null | undefined,
	routeId: string,
): Alert[] {
	if (!alerts || !routeId) return [];
	return alerts
		.map((alert, order) => ({ alert, order }))
		.filter(({ alert }) => alertListsRoute(alert, routeId))
		.sort(
			(a, b) =>
				severityRank(a.alert.severity) - severityRank(b.alert.severity) || a.order - b.order,
		)
		.map(({ alert }) => alert);
}

/**
 * The alerts affecting a single STOP: every alert that EITHER lists this stop's
 * `stopId` OR its `code` in its stops[], OR lists (in its routes[]) a route that
 * serves this stop (`routesServed`). Sorted severity-first (critical > high >
 * watch); within a tier a directly-targeted alert (matched by id/code) outranks
 * a purely route-serving one, then source order breaks the remaining ties.
 * Empty when none match.
 *
 * `code` is the stop's public code from its static file — the live feed targets
 * stops by code, which for metro stations differs from the static index id, so
 * we match on EITHER. Pass `null` when the stop carries no code.
 *
 * `routesServed` is the stop's `routes_served` from its static file — pass it
 * when known so route-scoped alerts surface on the stop; omit it (or pass empty)
 * to match on the stop id/code alone. No association is fabricated.
 */
export function alertsForStop(
	alerts: readonly Alert[] | null | undefined,
	stopId: string,
	code: string | null | undefined,
	routesServed: readonly string[] | null | undefined,
): Alert[] {
	if (!alerts || !stopId) return [];
	const served = new Set(routesServed ?? []);
	return alerts
		.map((alert, order) => {
			const stops = alert.stops ?? [];
			const direct = stops.includes(stopId) || (code != null && stops.includes(code));
			const viaRoute =
				!direct && served.size > 0 && (alert.routes ?? []).some((route) => served.has(route));
			return { alert, order, matches: direct || viaRoute, direct };
		})
		.filter((m) => m.matches)
		.sort(
			(a, b) =>
				severityRank(a.alert.severity) - severityRank(b.alert.severity) ||
				// More-specific (directly-targeted) alert wins a severity tie.
				Number(b.direct) - Number(a.direct) ||
				a.order - b.order,
		)
		.map(({ alert }) => alert);
}
