import { adapter, type AdapterCtx } from '$lib/v1/adapter';
import type { NetworkFile, VehiclesFile } from '$lib/v1/schemas';

export const getVehicles: () => Promise<VehiclesFile> = () => adapter.live.vehicles();

export const getNetwork: (ctx?: AdapterCtx) => Promise<NetworkFile> = (ctx) =>
	adapter.live.network(ctx);
