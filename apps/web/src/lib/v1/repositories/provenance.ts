// Provenance repository — thin async delegation over adapter.provenance.
//
// provenance.json is the honesty layer: per-feed freshness/age, source chain +
// last-loaded timestamps, declared data gaps, retention windows, and the
// methodology dictionary that the receipts/network surfaces cite. The adapter
// owns the URL + parsePort validation; this module just delegates.

import { adapter } from '$lib/v1/adapter';
import type { Provenance } from '$lib/v1/schemas';

/** Fetch + validate the provenance/honesty document. */
export async function getProvenance(): Promise<Provenance> {
	return adapter.provenance.get();
}
