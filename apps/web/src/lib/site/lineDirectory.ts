import type { RouteIndexEntry } from '#lib/v1/schemas/routes_index.ts';

export interface LineName {
	readonly number: string | null;
	readonly name: string | null;
	readonly label: string;
	readonly spoken: string;
}
export interface LineDirectory {
	name(id: string, publishedName?: string | null): LineName;
	number(id: string): string;
}

export function createLineDirectory(
	routes: readonly (Pick<RouteIndexEntry, 'id' | 'short'> & Partial<RouteIndexEntry>)[] | null,
	copy: { line: (id: string) => string },
): LineDirectory {
	const index = new Map((routes ?? []).map((route) => [route.id, route]));
	return {
		number: (id) => index.get(id)?.short || id,
		name(id, publishedName) {
			const route = index.get(id);
			const number = route?.short?.trim() || null;
			const name = publishedName?.trim() || route?.long?.trim() || null;
			const distinct = name != null && name !== number;
			return {
				number,
				name,
				label: number ? (distinct ? `${number} · ${name}` : number) : name || copy.line(id),
				spoken: number
					? distinct
						? `${copy.line(number)}, ${name}`
						: copy.line(number)
					: name || copy.line(id),
			};
		},
	};
}
