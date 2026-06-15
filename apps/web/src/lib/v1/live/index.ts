// Live index — O(1) lookup structures over the live snapshot files.
//
// The raw live files are array/map shaped for transport; surfaces need keyed
// access ("the vehicle for this id", "every vehicle on this route"). This module
// builds those indexes ONCE per live tick so render reads are O(1).
//
// DESIGN NOTES (match the contract exactly):
//   - byTripId is built from trips.json, which IS ALREADY trip-keyed (a
//     tripId -> Trip object) — we wrap it in a Map, we do NOT re-key it.
//   - byStopId is built from stop_departures.json (stopId -> StopDeparture[]),
//     the AUTHORITATIVE per-stop board. We do NOT invert trips.json to derive
//     stop departures — that would double-count and drift from the publisher.
//   - routeId/stopId -> Set<vehicleId> come from the VEHICLES array (route /
//     next_stop fields), i.e. "which vehicles are on this route / heading to
//     this stop right now".

import type {
	AlertsFile,
	NetworkFile,
	StopDeparture,
	StopDeparturesFile,
	Trip,
	TripsFile,
	Vehicle,
	VehiclesFile,
} from '$lib/v1/schemas';

/** The raw live files a tick produced (any subset may be absent pre-fetch). */
export interface LiveSnapshot {
	readonly vehicles?: VehiclesFile | null;
	readonly trips?: TripsFile | null;
	readonly stopDepartures?: StopDeparturesFile | null;
	readonly alerts?: AlertsFile | null;
	readonly network?: NetworkFile | null;
}

/** All O(1) lookup structures derived from a live snapshot. */
export interface LiveIndex {
	/** vehicleId -> Vehicle. */
	readonly byVehicleId: ReadonlyMap<string, Vehicle>;
	/** tripId -> Trip (trips.json is already trip-keyed). */
	readonly byTripId: ReadonlyMap<string, Trip>;
	/** stopId -> StopDeparture[] (from stop_departures.json, NOT inverted trips). */
	readonly byStopId: ReadonlyMap<string, readonly StopDeparture[]>;
	/** routeId -> set of vehicleIds currently on that route. */
	readonly vehiclesByRoute: ReadonlyMap<string, ReadonlySet<string>>;
	/** stopId -> set of vehicleIds heading to that stop (vehicle.next_stop). */
	readonly vehiclesByStop: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Insert `value` into the Set stored at `key`, creating the Set on first use. */
function addToSet<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
	const existing = map.get(key);
	if (existing) {
		existing.add(value);
	} else {
		map.set(key, new Set([value]));
	}
}

/**
 * Build every live lookup index from a snapshot. Absent files yield empty maps,
 * so callers can index a partial tick (e.g. vehicles arrived, trips pending)
 * without null-guards at every read site.
 */
export function buildLiveIndex(snapshot: LiveSnapshot): LiveIndex {
	const byVehicleId = new Map<string, Vehicle>();
	const byTripId = new Map<string, Trip>();
	const byStopId = new Map<string, readonly StopDeparture[]>();
	const vehiclesByRoute = new Map<string, Set<string>>();
	const vehiclesByStop = new Map<string, Set<string>>();

	// Vehicles: identity index + the route/stop -> vehicle adjacency sets.
	for (const vehicle of snapshot.vehicles?.vehicles ?? []) {
		byVehicleId.set(vehicle.id, vehicle);
		if (vehicle.route) {
			addToSet(vehiclesByRoute, vehicle.route, vehicle.id);
		}
		if (vehicle.next_stop) {
			addToSet(vehiclesByStop, vehicle.next_stop, vehicle.id);
		}
	}

	// Trips: trips.json is ALREADY trip-keyed — wrap, do not re-key.
	for (const [tripId, trip] of Object.entries(snapshot.trips?.trips ?? {})) {
		byTripId.set(tripId, trip);
	}

	// Stop departures: the authoritative per-stop board, keyed by stopId.
	for (const [stopId, departures] of Object.entries(snapshot.stopDepartures?.stops ?? {})) {
		byStopId.set(stopId, departures);
	}

	return {
		byVehicleId,
		byTripId,
		byStopId,
		vehiclesByRoute,
		vehiclesByStop,
	};
}

/** Empty index — the pre-fetch / no-data identity for the live store. */
export function emptyLiveIndex(): LiveIndex {
	return buildLiveIndex({});
}
