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

import { adapter } from '$lib/v1/adapter';
import type { Manifest } from '$lib/v1/schemas';

/** Fetch + validate the snapshot manifest (snapshot root pointer). */
export async function getManifest(): Promise<Manifest> {
	return adapter.manifest.get();
}
