import type { RouteIndexEntry } from '#lib/v1/schemas/routes_index.ts';

export interface LineName {
	readonly number: string | null;
	readonly name: string | null;
	readonly label: string;
	readonly spoken: string;
}
export interface LineDirectory {
	spoken(label: string): string;
	name(id: string, publishedName?: string | null): LineName;
	number(id: string): string;
}

export function createLineDirectory(
	routes: readonly (Pick<RouteIndexEntry, 'id' | 'short'> & Partial<RouteIndexEntry>)[] | null,
	copy: { line: (id: string) => string },
): LineDirectory {
	const index = new Map((routes ?? []).map((route) => [route.id, route]));
	const spoken = (label: string) => copy.line(label);
	return {
		spoken,
		number: (id) => index.get(id)?.short || id,
		name(id, publishedName) {
			const route = index.get(id);
			const number = route?.short?.trim() || null;
			const name = publishedName?.trim() || route?.long?.trim() || null;
			const suffix = number && name !== number ? name : null;
			const label = [number, suffix].filter(Boolean).join(' · ') || name || copy.line(id);
			return { number, name, label, spoken: spoken(label) };
		},
	};
}
