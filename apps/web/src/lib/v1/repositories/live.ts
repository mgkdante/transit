import { adapter, type AdapterCtx } from '$lib/v1/adapter';
import type { NetworkFile, TripsFile, VehiclesFile } from '$lib/v1/schemas';

export async function getVehicles(): Promise<VehiclesFile> {
	return adapter.live.vehicles();
}

export async function getTrips(): Promise<TripsFile> {
	return adapter.live.trips();
}

export async function getNetwork(ctx?: AdapterCtx): Promise<NetworkFile> {
	return adapter.live.network(ctx);
}
