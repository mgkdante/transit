import { intl } from '#lib/i18n/index.ts';
import type { LineDirectory } from '#lib/site/lineDirectory.ts';
import type { AlertHistoryEntry } from '#lib/v1/schemas/index.ts';
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
	const collator = intl.collator('en', { numeric: true, sensitivity: 'base' });
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
	directory: LineDirectory,
): ComboboxOption[] {
	return distinctIds(entries, 'routes').map((id) => {
		const label = directory.name(id).label;
		return { value: id, label, search: fold(`${id} ${label}`) };
	});
}

export function buildStopOptions(
	entries: readonly AlertHistoryEntry[],
	fold: (raw: string) => string,
): ComboboxOption[] {
	return buildEntityOptions(entries, 'stops', fold);
}
