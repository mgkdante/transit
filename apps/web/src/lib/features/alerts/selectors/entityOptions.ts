// entityOptions.ts — the PURE line/stop picker option builders (S15 de-monolith).
//
// The /alerts surface offers TWO typeahead pickers (a "Line" and a "Stop" combobox)
// over the distinct routes/stops PRESENT in the loaded log — so a rider can narrow to
// alerts touching one line or one stop without a new fetch. This module builds those
// {@link ComboboxOption} lists: distinct ids, numeric-aware sort, a folded search
// haystack per option. Copy-free (the visible label is just the bare id; the picker's
// group label carries the "Line"/"Stop" type ONCE, so no per-row prefix). DOM-free.

import type { AlertHistoryEntry } from '$lib/v1/schemas';
import type { ComboboxOption } from '@yesid/ui/combobox';

/** Which id family a picker draws from an entry. */
type EntityField = 'routes' | 'stops';

/**
 * Distinct ids of `field` across the log, numeric-aware ascending (a route "9" sorts
 * before "10"; a non-numeric id falls to a locale compare). Pure: a transient dedup map,
 * never reactive state.
 */
function distinctIds(entries: readonly AlertHistoryEntry[], field: EntityField): string[] {
	const seen: Record<string, true> = {};
	const out: string[] = [];
	for (const e of entries) {
		for (const id of e[field] ?? []) {
			if (seen[id]) continue;
			seen[id] = true;
			out.push(id);
		}
	}
	const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
	return out.sort((a, b) => collator.compare(a, b));
}

/**
 * Build the combobox options for one id family. The visible `label` is the bare id (the
 * group label names the type once — no "Line NN"/"Stop NNNNN" prefix), and the folded
 * search haystack is the id itself so typing is diacritics-insensitive + stable.
 */
function buildEntityOptions(
	entries: readonly AlertHistoryEntry[],
	field: EntityField,
	fold: (raw: string) => string,
): ComboboxOption[] {
	return distinctIds(entries, field).map((id) => ({
		value: id,
		label: id,
		search: fold(id),
	}));
}

/** The distinct lines (routes) present in the log, as picker options. */
export function buildLineOptions(
	entries: readonly AlertHistoryEntry[],
	fold: (raw: string) => string,
): ComboboxOption[] {
	return buildEntityOptions(entries, 'routes', fold);
}

/** The distinct stops present in the log, as picker options. */
export function buildStopOptions(
	entries: readonly AlertHistoryEntry[],
	fold: (raw: string) => string,
): ComboboxOption[] {
	return buildEntityOptions(entries, 'stops', fold);
}
