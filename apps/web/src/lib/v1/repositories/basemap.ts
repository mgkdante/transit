// Basemap repository — thin async delegation over adapter.basemap.
//
// Resolves the manifest's `basemap` pointer (or the default static/basemap.json)
// to the hosted PMTiles archive descriptor, or null when no archive is hosted
// (the map then degrades to the minimal-dark style). The adapter owns the URL +
// parsePort validation + the 404→null contract; this module just delegates.

import { adapter } from '$lib/v1/adapter';
import type { AdapterCtx } from '$lib/v1/adapter';
import type { BasemapFile } from '$lib/v1/schemas';

/** Fetch the basemap pointer, or null when no PMTiles archive is hosted. */
export async function getBasemap(ctx?: AdapterCtx): Promise<BasemapFile | null> {
	return adapter.basemap.get(ctx);
}
