export type MapFocusKind = 'route' | 'stop' | 'vehicle';

export interface MapFocus {
	readonly kind: MapFocusKind;
	readonly id: string;
}

export const MAP_FOCUS_PARAM = 'focus';

const FOCUS_KINDS: readonly MapFocusKind[] = ['route', 'stop', 'vehicle'];

export function mapFocusValue(kind: MapFocusKind, id: string): string {
	return `${kind}:${id}`;
}

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

export function setMapFocusSearchParams(
	searchParams: URLSearchParams,
	kind: MapFocusKind,
	id: string,
): void {
	searchParams.set(MAP_FOCUS_PARAM, mapFocusValue(kind, id));
}

export function clearMapFocusSearchParams(searchParams: URLSearchParams): void {
	searchParams.delete(MAP_FOCUS_PARAM);
}
