// Manifest repository — thin async delegation over adapter.manifest.
//
// The manifest is the snapshot root: it carries the dataset version, the file
// pointers for every tier (live / static / historic / provenance), per-tier
// ttl_s + generated_utc freshness anchors, and the FR label table. Boot reads
// it once; freshness + the live store derive their cadence/staleness from it.
//
// Repositories never touch fetch/URL/R2 directly — only the adapter port does
// (it owns the R2 base URL, conditional-GET plumbing, and parsePort validation).
// This module is a pure delegator so the import surface stays stable while the
// transport underneath can change.

import { adapter, type AdapterCtx } from '$lib/v1/adapter';
import { resolveUrl } from '$lib/v1/config';
import { ManifestSchema, type Manifest } from '$lib/v1/schemas';

/**
 * Fetch + validate the snapshot manifest (snapshot root pointer).
 *
 * `ctx` carries the SSR `fetch` (event.fetch). It MUST be threaded under SSR:
 * the snapshot base is a same-origin relative path (`/data/v1`), and the global
 * `fetch` rejects a relative URL in a Worker — only the load `fetch` resolves it
 * against the request origin.
 */
export async function getManifest(ctx?: AdapterCtx): Promise<Manifest> {
	return adapter.manifest.get(ctx);
}

/**
 * Re-read the manifest from one stable edge URL, bypassing only the boot path's
 * per-request memo. Normal HTTP cache semantics avoid a forced network request
 * when the response is still fresh; an expired response revalidates at the same
 * shared cache key.
 *
 * Browser-only (it uses the global `fetch` against the same-origin `/data/v1`
 * base); never call it under SSR. Throws on a non-200 or a schema-invalid body so
 * the caller can swallow a transient failure and retry on the next tick.
 */
export async function getManifestFresh(): Promise<Manifest> {
	const url = resolveUrl('manifest.json');
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`[v1.manifest] fresh manifest fetch failed: ${res.status} ${url}`);
	}
	return ManifestSchema.parse(await res.json());
}
