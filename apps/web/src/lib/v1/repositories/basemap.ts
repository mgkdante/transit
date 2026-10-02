import { adapter } from '$lib/v1/adapter';
import type { AdapterCtx } from '$lib/v1/adapter';
import type { BasemapFile } from '$lib/v1/schemas';

export async function getBasemap(ctx?: AdapterCtx): Promise<BasemapFile | null> {
	return adapter.basemap.get(ctx);
}
