import type { LineDirectory } from '#lib/site/lineDirectory.ts';
import type { RepeatOffenderEntry } from '#lib/v1/schemas/index.ts';
import type { RepeatOffendersCopy } from './repeatOffenders.copy';

export function createOffenderNames(
	directory: () => LineDirectory,
	copy: () => RepeatOffendersCopy,
) {
	const name = (entry: RepeatOffenderEntry) =>
		entry.route?.trim()
			? directory().name(entry.route.trim(), entry.route_name).label
			: (entry.route_name ?? copy().unnamed(entry.id));
	return {
		unnamed: (entry: RepeatOffenderEntry) => name(entry),
		spoken: (entry: RepeatOffenderEntry) =>
			entry.route || entry.route_name ? directory().spoken(name(entry)) : name(entry),
		typeLabel: (type: string) =>
			Object.hasOwn(copy().type, type)
				? copy().type[type as keyof RepeatOffendersCopy['type']]
				: copy().type.other,
	};
}
