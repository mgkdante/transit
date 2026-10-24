import { adapter, type AdapterCtx } from '$lib/v1/adapter';
import type { Manifest } from '$lib/v1/schemas/manifest';

export const getManifest: (ctx?: AdapterCtx) => Promise<Manifest> = (ctx) =>
	adapter.manifest.get(ctx);

export const getManifestFresh: (ctx?: AdapterCtx) => Promise<Manifest> = (ctx) =>
	adapter.manifest.getFresh(ctx);
