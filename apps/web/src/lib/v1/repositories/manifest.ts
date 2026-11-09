import { adapter, type AdapterCtx } from '#lib/v1/adapter/index.ts';
import type { Manifest } from '#lib/v1/schemas/manifest.ts';

export const getManifest: (ctx?: AdapterCtx) => Promise<Manifest> = (ctx) =>
	adapter.manifest.get(ctx);

export const getManifestFresh: (ctx?: AdapterCtx) => Promise<Manifest> = (ctx) =>
	adapter.manifest.getFresh(ctx);
