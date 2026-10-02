import type { Alert } from './schemas/alerts';
import { SEVERITY_CODES, type SeverityCode } from './schemas/types';

function severityRank(severity: SeverityCode): number {
	const i = (SEVERITY_CODES as readonly string[]).indexOf(severity);
	return i === -1 ? SEVERITY_CODES.length : i;
}

function alertListsRoute(alert: Alert, routeId: string): boolean {
	return (alert.routes ?? []).includes(routeId);
}

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
				Number(b.direct) - Number(a.direct) ||
				a.order - b.order,
		)
		.map(({ alert }) => alert);
}
