import type { Alert, Vehicle } from '$lib/v1/schemas';

export interface AlertEntitySets {
	readonly routes: ReadonlySet<string>;
	readonly stops: ReadonlySet<string>;
}

export function buildAlertEntitySets(alerts: readonly Alert[]): AlertEntitySets {
	const routes = new Set<string>();
	const stops = new Set<string>();

	for (const alert of alerts) {
		for (const route of alert.routes ?? []) routes.add(route);
		for (const stop of alert.stops ?? []) stops.add(stop);
	}

	return { routes, stops };
}

export function vehicleHasAlert(vehicle: Vehicle, sets: AlertEntitySets): boolean {
	return (
		(vehicle.route != null && sets.routes.has(vehicle.route)) ||
		(vehicle.next_stop != null && sets.stops.has(vehicle.next_stop))
	);
}
