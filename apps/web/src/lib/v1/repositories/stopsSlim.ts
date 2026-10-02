import type { StopIndexEntry, StopsIndex } from '$lib/v1/schemas';

export interface SlimStopEntry {
	readonly id: string;
	readonly name: string;
	readonly lat: number;
	readonly lon: number;
	readonly code?: string | null;
}

export interface SlimStopsIndex {
	readonly generated_utc: string;
	readonly stops: readonly SlimStopEntry[];
}

export function toSlimStop(s: StopIndexEntry): SlimStopEntry {
	return { id: s.id, name: s.name, lat: s.lat, lon: s.lon, code: s.code ?? null };
}

export function toSlimStopsIndex(full: StopsIndex): SlimStopsIndex {
	return { generated_utc: full.generated_utc, stops: full.stops.map(toSlimStop) };
}

export function isSlimStopsIndex(v: unknown): v is SlimStopsIndex {
	if (typeof v !== 'object' || v === null) return false;
	const o = v as Record<string, unknown>;
	if (typeof o.generated_utc !== 'string' || !Array.isArray(o.stops)) return false;
	return o.stops.every((s) => {
		if (typeof s !== 'object' || s === null) return false;
		const e = s as Record<string, unknown>;
		return (
			typeof e.id === 'string' &&
			typeof e.name === 'string' &&
			typeof e.lat === 'number' &&
			typeof e.lon === 'number' &&
			(e.code == null || typeof e.code === 'string')
		);
	});
}
