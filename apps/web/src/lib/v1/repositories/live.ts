import { adapter, type AdapterCtx } from '#lib/v1/adapter/index.ts';
import type { NetworkFile, VehiclesFile } from '#lib/v1/schemas/index.ts';

export const getVehicles: () => Promise<VehiclesFile> = () => adapter.live.vehicles();

export const getNetwork: (ctx?: AdapterCtx) => Promise<NetworkFile> = (ctx) =>
	adapter.live.network(ctx);
