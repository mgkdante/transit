import { adapter } from '#lib/v1/adapter/index.ts';
import type { AdapterCtx } from '#lib/v1/adapter/index.ts';
import type { BasemapFile } from '#lib/v1/schemas/index.ts';

export const getBasemap: (ctx?: AdapterCtx) => Promise<BasemapFile | null> = (ctx) =>
	adapter.basemap.get(ctx);
