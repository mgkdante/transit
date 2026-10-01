import type { Receipt } from '$lib/v1/schemas';

export interface AffectedCountVM {
	readonly key: 'routes' | 'stops' | 'alerts' | 'vehicles';
	readonly label: string;
	readonly value: string | null;
}

export interface AffectedCountLabels {
	readonly routes: string;
	readonly stops: string;
	readonly alerts: string;
	readonly vehicles: string;
	readonly fmtCount: (v: number | null | undefined) => string | null;
}

export function selectAffectedCounts(
	receipt: Pick<Receipt, 'affected_routes' | 'affected_stops' | 'alerts' | 'vehicles'>,
	labels: AffectedCountLabels,
): AffectedCountVM[] {
	const cells: AffectedCountVM[] = [
		{ key: 'routes', label: labels.routes, value: labels.fmtCount(receipt.affected_routes) },
		{ key: 'stops', label: labels.stops, value: labels.fmtCount(receipt.affected_stops) },
		{ key: 'alerts', label: labels.alerts, value: labels.fmtCount(receipt.alerts) },
	];
	if (receipt.vehicles != null) {
		cells.push({
			key: 'vehicles',
			label: labels.vehicles,
			value: labels.fmtCount(receipt.vehicles),
		});
	}
	return cells;
}
