import type { LineDirectory } from '#lib/site/lineDirectory.ts';
import type { RepeatOffenderEntry } from '#lib/v1/schemas/index.ts';
import type { RepeatOffendersCopy } from './repeatOffenders.copy';

export function createOffenderNames(lines: () => LineDirectory, copy: () => RepeatOffendersCopy) {
	const name = (entry: RepeatOffenderEntry) => {
		const route = entry.route?.trim();
		if (route) return lines().name(route, entry.route_name);
		const label = entry.route_name ?? copy().unnamed(entry.id);
		return { label, spoken: entry.route_name ? lines().spoken(label) : label };
	};
	return {
		unnamed: (entry: RepeatOffenderEntry) => name(entry).label,
		spoken: (entry: RepeatOffenderEntry) => name(entry).spoken,
		typeLabel: (type: string) =>
			new Map(Object.entries(copy().type)).get(type) ?? copy().type.other,
	};
}
