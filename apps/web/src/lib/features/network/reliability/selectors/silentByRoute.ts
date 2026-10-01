import type { SeverityCode, NonRespondingRoute } from '$lib/v1/schemas';

export const NON_RESPONDING_DOMAIN: readonly [number, number] = [0, 10];

export interface SilentRow {
	readonly key: string;
	readonly rank: number;
	readonly title: string;
	readonly subtitle: string;
	readonly severity: SeverityCode;
	readonly value: number;
	readonly display: string;
	readonly href: string;
	readonly ariaLabel: string;
}

export interface SilentRowLabels {
	routeName: (routeId: string) => string;
	rowLabel: string;
	display: (routeId: string, count: number) => string;
	href: (routeId: string) => string;
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
		severity: 'critical' as SeverityCode,
		value: r.count,
		display: labels.display(r.route_id, r.count),
		href: labels.href(r.route_id),
		ariaLabel: labels.viewDetail(r.route_id),
	}));
}
