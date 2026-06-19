// map focus param — a one-shot "zoom the camera to this entity" hint on the /map
// URL, set when a route/stop/vehicle is picked from search and consumed once by
// the map (which then strips it). Distinct from the filter spine (which decides
// what is *shown*) and from the near target (addresses, which already fly).

export type MapFocusKind = 'route' | 'stop' | 'vehicle';

export interface MapFocus {
	readonly kind: MapFocusKind;
	readonly id: string;
}

export const MAP_FOCUS_PARAM = 'focus';

const FOCUS_KINDS: readonly MapFocusKind[] = ['route', 'stop', 'vehicle'];

/** Serialize a focus target to the `focus` param value (`<kind>:<id>`). */
export function mapFocusValue(kind: MapFocusKind, id: string): string {
	return `${kind}:${id}`;
}

/** Parse the `focus` param, or null when absent/malformed. */
export function parseMapFocus(searchParams: URLSearchParams): MapFocus | null {
	const raw = searchParams.get(MAP_FOCUS_PARAM);
	if (!raw) return null;
	const sep = raw.indexOf(':');
	if (sep <= 0) return null;
	const kind = raw.slice(0, sep);
	const id = raw.slice(sep + 1);
	if (!id || !FOCUS_KINDS.includes(kind as MapFocusKind)) return null;
	return { kind: kind as MapFocusKind, id };
}

/** Add/replace the focus param in place. */
export function setMapFocusSearchParams(
	searchParams: URLSearchParams,
	kind: MapFocusKind,
	id: string,
): void {
	searchParams.set(MAP_FOCUS_PARAM, mapFocusValue(kind, id));
}

/** Remove the focus param in place (the map calls this after consuming it). */
export function clearMapFocusSearchParams(searchParams: URLSearchParams): void {
	searchParams.delete(MAP_FOCUS_PARAM);
}
