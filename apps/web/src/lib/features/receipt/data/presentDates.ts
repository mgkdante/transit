// presentDates — the receipt's DEFAULT day resolution (S13 · WEB3).
//
// The picker defaults to the LATEST published day (the freshest receipt) and honours
// a deep-linked ?date when it points at a real, ENABLED published day. A ?date that
// is a gap/empty/unknown day self-heals to the latest default (never a dead pick, and
// never a fabricated day the index does not carry). Pure — no URL/DOM access; the
// orchestrator supplies the seeded ?date and the enabled-dates list.

/**
 * Resolve the effective receipt day: the deep-linked `seed` when it is a real enabled
 * published day, else the LATEST enabled day. `enabledDates` is the ascending list of
 * navigable days (from selectAvailability). Empty ⇒ null (the surface stands down).
 */
export function resolveReceiptDate(
	seed: string | null | undefined,
	enabledDates: readonly string[],
): string | null {
	if (enabledDates.length === 0) return null;
	if (seed && enabledDates.includes(seed)) return seed;
	// Latest published day = the last of the ascending enabled list.
	return enabledDates[enabledDates.length - 1];
}
