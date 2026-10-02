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

export interface LiveSnapshot {
	readonly vehicles?: VehiclesFile | null;
	readonly trips?: TripsFile | null;
	readonly stopDepartures?: StopDeparturesFile | null;
	readonly alerts?: AlertsFile | null;
	readonly network?: NetworkFile | null;
}

export interface LiveIndex {
	readonly byVehicleId: ReadonlyMap<string, Vehicle>;
	readonly byTripId: ReadonlyMap<string, Trip>;
	readonly byStopId: ReadonlyMap<string, readonly StopDeparture[]>;
	readonly vehiclesByRoute: ReadonlyMap<string, ReadonlySet<string>>;
	readonly vehiclesByStop: ReadonlyMap<string, ReadonlySet<string>>;
}

function addToSet<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
	const existing = map.get(key);
	if (existing) {
		existing.add(value);
	} else {
		map.set(key, new Set([value]));
	}
}

export function buildLiveIndex(snapshot: LiveSnapshot): LiveIndex {
	const byVehicleId = new Map<string, Vehicle>();
	const byTripId = new Map<string, Trip>();
	const byStopId = new Map<string, readonly StopDeparture[]>();
	const vehiclesByRoute = new Map<string, Set<string>>();
	const vehiclesByStop = new Map<string, Set<string>>();

	for (const vehicle of snapshot.vehicles?.vehicles ?? []) {
		byVehicleId.set(vehicle.id, vehicle);
		if (vehicle.route) {
			addToSet(vehiclesByRoute, vehicle.route, vehicle.id);
		}
		if (vehicle.next_stop) {
			addToSet(vehiclesByStop, vehicle.next_stop, vehicle.id);
		}
	}

	for (const [tripId, trip] of Object.entries(snapshot.trips?.trips ?? {})) {
		byTripId.set(tripId, trip);
	}

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

export function emptyLiveIndex(): LiveIndex {
	return buildLiveIndex({});
}
