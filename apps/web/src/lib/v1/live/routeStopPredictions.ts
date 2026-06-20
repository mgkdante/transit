// Route stop predictions: the SOONEST live predicted arrival per stop on a route.
//
// The Detail tab on a line lists every stop in route order. Each stop wants a
// live readout: "next departure" + the approaching bus's on-time status. Fetching
// a per-stop departures board would be 30+ requests for one route, so instead we
// DERIVE the prediction from data the live tick ALREADY holds, in two passes:
//
//   Pass 1 (precise) — per-trip stop ETAs:
//     route -> live vehicles (index.vehiclesByRoute)
//           -> each vehicle's trip (index.byTripId)
//           -> the trip's ordered remaining-stop ETAs (Trip.stops: StopEta[])
//     Each StopEta carries a predicted `eta_utc` + `delay_min` AT that stop; the
//     SOONEST eta_utc per stop wins (the next bus a rider waits for).
//
//   Pass 2 (fallback) — vehicle `next_stop`:
//     The realtime trips feed often carries NO per-stop ETAs (only VehiclePositions
//     are live), so Pass 1 can be empty even with buses out. Each route vehicle
//     still exposes the stop it is heading to (`next_stop`) + its `delay_min` there.
//     We mark that stop as "approaching" (etaUtc = null, no precise time) — but ONLY
//     when Pass 1 left it uncovered, so a real ETA always beats an etaless approach.
//
// A stop neither pass touches gets NO entry; the caller renders an honest
// "no live bus", never a fabricated time. Pure + index-only: no fetch, no DOM.

import type { LiveIndex } from './index';
import type { StopEta } from '$lib/v1/schemas';

/** The soonest live predicted arrival at one stop, plus the bus's delay there. */
export interface StopPrediction {
	/**
	 * ISO 8601 (UTC) predicted arrival of the next bus to reach this stop, or
	 * `null` when the prediction comes from a vehicle's `next_stop` (the bus is
	 * approaching, but the feed gave no per-stop ETA — the caller shows
	 * "approaching" rather than a fabricated time).
	 */
	readonly etaUtc: string | null;
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

	// Pass 1 — precise per-trip stop ETAs. Soonest eta_utc per stop wins.
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
			// Compare only against another precise ETA; an etaless approach never blocks one.
			if (existing && existing.etaUtc != null && etaMs(existing.etaUtc) <= ms) continue;
			out.set(eta.stop, { etaUtc: eta.eta_utc, delayMin: eta.delay_min ?? null });
		}
	}

	// Pass 2 — vehicle next_stop fallback. Fills only stops a precise ETA did not
	// cover, so the trips feed (when populated) always wins over an etaless approach.
	for (const vehicleId of vehicleIds) {
		const vehicle = index.byVehicleId.get(vehicleId);
		const nextStop = vehicle?.next_stop;
		if (!nextStop || out.has(nextStop)) continue;
		out.set(nextStop, { etaUtc: null, delayMin: vehicle.delay_min ?? null });
	}

	return out;
}
