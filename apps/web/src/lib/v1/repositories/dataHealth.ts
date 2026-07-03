// Data-health repository — thin async delegation over adapter.dataHealth.
//
// status/data_health.json is the LIVE-lane per-lane publish-freshness + last-gate
// summary that powers the /status "Pipeline lanes" section. The adapter owns the
// URL + parsePort validation + the 404-as-null contract; this module just
// delegates. Returns null when the payload is not published yet (pre-S11 manifest
// or a 404) so the section stands down honestly.

import { adapter } from '$lib/v1/adapter';
import type { DataHealth } from '$lib/v1/schemas';

/** Fetch + validate the data-health document, or null when not published. */
export async function getDataHealth(): Promise<DataHealth | null> {
	return adapter.dataHealth.get();
}
