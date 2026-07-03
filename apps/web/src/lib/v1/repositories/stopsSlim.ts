// Slim stops index — the typeahead/map fast-path (P5.3e §C8 item 3).
//
// WHY: the full `stops_index.json` is 1.15 MB raw / 177 KB encoded (8,986 stops ×
// {id,name,lat,lon,code,mode,routes[]}). The bulk is the per-stop `routes[]`
// reverse index (up to 5 route ids each) + `mode`. The MAP only needs
// {id,name,lat,lon,code} — it plots points, labels them by name/code, and fetches
// the FULL per-stop record (`getStop`) on click — so shipping the whole catalogue
// to the map wastes ~93% of the parse. The JSON.parse of 1.15 MB on the client is
// the named TBT/INP risk in the perf snapshot.
//
// The slim projection drops `mode` + `routes[]`, so the map/near-me pay a much
// smaller client payload + parse. It is an ADDITIVE FAST-PATH: `/stops` and
// `/search` (which render mode glyphs + route chips) still load the FULL index via
// `getStopsIndex`. Honest-absence is preserved — the slim endpoint fails soft to a
// client-side projection of the full index, so the map always resolves every stop.

import type { StopIndexEntry, StopsIndex } from '$lib/v1/schemas';

/** The minimal stop shape the map + near-me ranking consume. */
export interface SlimStopEntry {
	readonly id: string;
	readonly name: string;
	readonly lat: number;
	readonly lon: number;
	/** Rider-facing stop code (map popup / filter chip); null/absent when unknown.
	    Kept `string | null | undefined` so a slim entry stays assignable to the full
	    `StopIndexEntry` the map's stop-layer + filter consumers are typed against. */
	readonly code?: string | null;
}

export interface SlimStopsIndex {
	readonly generated_utc: string;
	readonly stops: readonly SlimStopEntry[];
}

/** Project a full stops-index entry down to the slim map/typeahead shape. */
export function toSlimStop(s: StopIndexEntry): SlimStopEntry {
	return { id: s.id, name: s.name, lat: s.lat, lon: s.lon, code: s.code ?? null };
}

/** Project the full stops index to its slim form (drops `mode` + `routes[]`). */
export function toSlimStopsIndex(full: StopsIndex): SlimStopsIndex {
	return { generated_utc: full.generated_utc, stops: full.stops.map(toSlimStop) };
}

/** Runtime guard for the slim payload returned by `/api/stops/slim`. */
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
