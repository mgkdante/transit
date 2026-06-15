// Labels repository — thin async delegation over adapter.labels.
//
// Labels are the code -> human-text dictionary for the active UI language
// (metric./status./severity./occupancy./methodology. namespaces). boot.ts loads
// them once for the request locale and threads the merged table through
// V1Context; components resolve codes via resolveLabel(code, labels).
//
// The manifest already carries a base label table; the per-language labels file
// (labels/{lang}.json) refines it. The adapter owns the URL/locale plumbing —
// this module just delegates.

import { adapter } from '$lib/v1/adapter';
import type { Locale } from '$lib/i18n';

/**
 * Fetch + validate the label dictionary for a UI language.
 *
 * Returns a flat `code -> text` map. Missing file / never-published labels
 * resolve to an empty map so resolveLabel() falls back to the raw code.
 */
export async function getLabels(lang: Locale): Promise<Record<string, string>> {
	return adapter.labels.get(lang);
}
