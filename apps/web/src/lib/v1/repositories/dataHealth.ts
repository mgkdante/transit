import { adapter } from '$lib/v1/adapter';
import type { AdapterCtx } from '$lib/v1/adapter';
import type { DataHealth } from '$lib/v1/schemas';

export const getDataHealth: (ctx?: AdapterCtx) => Promise<DataHealth | null> = (ctx) =>
	adapter.dataHealth.get(ctx);
