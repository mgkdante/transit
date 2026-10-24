import { adapter } from '$lib/v1/adapter';
import type { AdapterCtx } from '$lib/v1/adapter';
import type { BasemapFile } from '$lib/v1/schemas';

export const getBasemap: (ctx?: AdapterCtx) => Promise<BasemapFile | null> = (ctx) =>
	adapter.basemap.get(ctx);
