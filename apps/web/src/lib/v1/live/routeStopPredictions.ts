import type { LiveIndex } from './index';
import type { StopEta } from '$lib/v1/schemas';

export interface StopPrediction {
	readonly etaUtc: string | null;
	readonly delayMin: number | null;
}

function etaMs(iso: string): number {
	return Date.parse(iso);
}

export function deriveRouteStopPredictions(
	routeId: string,
	index: LiveIndex,
): ReadonlyMap<string, StopPrediction> {
	const out = new Map<string, StopPrediction>();
	const vehicleIds = index.vehiclesByRoute.get(routeId);
	if (!vehicleIds) return out;

	for (const vehicleId of vehicleIds) {
		const vehicle = index.byVehicleId.get(vehicleId);
		const tripId = vehicle?.trip;
		if (!tripId) continue;
		const trip = index.byTripId.get(tripId);
		if (!trip) continue;

		for (const eta of trip.stops ?? ([] as readonly StopEta[])) {
			const ms = etaMs(eta.eta_utc);
			if (!Number.isFinite(ms)) continue;
			const existing = out.get(eta.stop);
			if (existing && existing.etaUtc != null && etaMs(existing.etaUtc) <= ms) continue;
			out.set(eta.stop, { etaUtc: eta.eta_utc, delayMin: eta.delay_min ?? null });
		}
	}

	for (const vehicleId of vehicleIds) {
		const vehicle = index.byVehicleId.get(vehicleId);
		const nextStop = vehicle?.next_stop;
		if (!nextStop || out.has(nextStop)) continue;
		out.set(nextStop, { etaUtc: null, delayMin: vehicle.delay_min ?? null });
	}

	return out;
}
