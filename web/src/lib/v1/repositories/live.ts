// Live repository — thin async delegation over adapter.live.
//
// The five live files refresh on the live tier's short ttl (default 30s):
//   vehicles.json         — array of live Vehicle positions/status
//   trips.json            — TRIP-KEYED map: tripId -> Trip (stops + status)
//   stop_departures.json  — STOP-KEYED map: stopId -> StopDeparture[]
//   alerts.json           — array of service Alerts
//   network.json          — single network-health rollup
//
// The reactive poller lives in $lib/v1/live/store.svelte.ts; these async getters
// are the one-shot path (SSR load, tests, manual refresh). Both go through the
// same adapter port, which owns conditional-GET + parsePort validation.

import { adapter } from '$lib/v1/adapter';
import type {
	AlertsFile,
	NetworkFile,
	StopDeparturesFile,
	TripsFile,
	VehiclesFile,
} from '$lib/v1/schemas';

/** Fetch + validate live vehicle positions (vehicles.json). */
export async function getVehicles(): Promise<VehiclesFile> {
	return adapter.live.vehicles();
}

/** Fetch + validate the trip-keyed live trips map (trips.json). */
export async function getTrips(): Promise<TripsFile> {
	return adapter.live.trips();
}

/** Fetch + validate the stop-keyed departures map (stop_departures.json). */
export async function getStopDepartures(): Promise<StopDeparturesFile> {
	return adapter.live.stopDepartures();
}

/** Fetch + validate active service alerts (alerts.json). */
export async function getAlerts(): Promise<AlertsFile> {
	return adapter.live.alerts();
}

/** Fetch + validate the live network-health rollup (network.json). */
export async function getNetwork(): Promise<NetworkFile> {
	return adapter.live.network();
}
