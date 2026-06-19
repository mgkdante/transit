// Route stop predictions: the SOONEST live predicted arrival per stop on a route.
//
// The Detail tab on a line lists every stop in route order. Each stop wants a
// live readout: "next departure" + the approaching bus's on-time status. Fetching
// a per-stop departures board would be 30+ requests for one route, so instead we
// DERIVE the prediction from data the live tick ALREADY holds:
//
//   route -> live vehicles on it (index.vehiclesByRoute)
//          -> each vehicle's trip (index.byTripId)
//          -> the trip's ordered remaining-stop ETAs (Trip.stops: StopEta[])
//
// Every StopEta carries a predicted `eta_utc` + the bus's `delay_min` AT that
// stop. We fold all the route's live trips into a per-stop map, keeping the
// SOONEST eta_utc for each stop (the next bus to reach it). A stop with no live
// trip currently predicting it gets NO entry; the caller renders an honest
// "no live bus", never a fabricated time.
//
// Pure + index-only: no fetch, no DOM. The live store already polls trips.json
// every tick, so this re-derives for free from the in-memory index. Testable in
// isolation against a hand-built LiveIndex.

import type { LiveIndex } from './index';
import type { StopEta } from '$lib/v1/schemas';

/** The soonest live predicted arrival at one stop, plus the bus's delay there. */
export interface StopPrediction {
	/** ISO 8601 (UTC) predicted arrival of the next bus to reach this stop. */
	readonly etaUtc: string;
	/** That bus's delay (minutes) at this stop; null when the feed omits it. */
	readonly delayMin: number | null;
}

/** Parse an ISO timestamp to epoch ms; NaN when unparseable (defensive). */
function etaMs(iso: string): number {
	return Date.parse(iso);
}

/**
 * Fold every live trip on `routeId` into a per-stop map of the soonest predicted
 * arrival. Keyed by stop id; a stop absent from the map has no live bus currently
 * predicting it (honest empty: the caller must NOT fabricate a time).
 *
 * Soonest wins: when several live buses on the route predict the same stop, the
 * one arriving first is kept (it is the "next departure" a rider waits for).
 * Unparseable / non-positive ETAs are ignored rather than crowding out a real one.
 */
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
			if (existing && etaMs(existing.etaUtc) <= ms) continue;
			out.set(eta.stop, { etaUtc: eta.eta_utc, delayMin: eta.delay_min ?? null });
		}
	}

	return out;
}
