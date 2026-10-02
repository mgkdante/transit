import type { AlertHistoryEntry } from '$lib/v1/schemas';
import type { ComboboxOption } from '@yesid/ui/combobox';

type EntityField = 'routes' | 'stops';

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

export function buildLineOptions(
	entries: readonly AlertHistoryEntry[],
	fold: (raw: string) => string,
): ComboboxOption[] {
	return buildEntityOptions(entries, 'routes', fold);
}

export function buildStopOptions(
	entries: readonly AlertHistoryEntry[],
	fold: (raw: string) => string,
): ComboboxOption[] {
	return buildEntityOptions(entries, 'stops', fold);
}
