import type { LineDirectory } from '#lib/site/lineDirectory.ts';
import type { RepeatOffenderEntry } from '#lib/v1/schemas/index.ts';
import type { RepeatOffendersCopy } from './repeatOffenders.copy';

export function createOffenderNames(
	directory: () => LineDirectory,
	copy: () => RepeatOffendersCopy,
) {
	const name = (entry: RepeatOffenderEntry, spoken = false) =>
		entry.route?.trim()
			? directory().name(entry.route.trim(), entry.route_name)[spoken ? 'spoken' : 'label']
			: (entry.route_name ?? copy().unnamed(entry.id));
	return {
		unnamed: (entry: RepeatOffenderEntry) => name(entry),
		spoken: (entry: RepeatOffenderEntry) => name(entry, true),
		typeLabel: (type: string) =>
			Object.hasOwn(copy().type, type)
				? copy().type[type as keyof RepeatOffendersCopy['type']]
				: copy().type.other,
	};
}
