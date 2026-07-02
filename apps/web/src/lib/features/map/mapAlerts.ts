// mapAlerts.ts — the MAP-RUNTIME alert helpers.
//
// The alert→entity index (which routes/stops any alert touches) + the per-vehicle
// "has an alert" test the live map paints with. These are map-runtime (they read a
// Vehicle's route/next_stop), so they STAY in features/map (S15). The pure i18n
// alert helpers moved to $lib/v1: `alertDisplayText` → $lib/v1/alertDisplay,
// `causeLabel`/`effectLabel` → $lib/v1/gtfsAlertLabels — so the alerts surface (and
// every consumer) reads them from the shared kernel without a cross-feature import.

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
