import { adapter, type AdapterCtx } from '$lib/v1/adapter';
import type { Manifest } from '$lib/v1/schemas/manifest';

export async function getManifest(ctx?: AdapterCtx): Promise<Manifest> {
	return adapter.manifest.get(ctx);
}

export async function getManifestFresh(ctx?: AdapterCtx): Promise<Manifest> {
	return adapter.manifest.getFresh(ctx);
}
