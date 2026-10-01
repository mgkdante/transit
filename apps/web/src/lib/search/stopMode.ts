import type { StopIndexEntry } from '$lib/v1/schemas/stops_index';
import { foldDiacritics, foldSearchText } from './normalize';

export interface StopModeHint {
	readonly glyph: string;
	readonly label: 'Métro' | 'Train' | null;
}

export interface StopModeInput {
	readonly name: string | null | undefined;
	readonly mode?: StopIndexEntry['mode'];
}

const DEFAULT_STOP_GLYPH = '■';
const METRO_GLYPH = '◉';
const RAIL_GLYPH = '╪';

const METRO_HINT: StopModeHint = { glyph: METRO_GLYPH, label: 'Métro' };
const RAIL_HINT: StopModeHint = { glyph: RAIL_GLYPH, label: 'Train' };
const PLAIN_HINT: StopModeHint = { glyph: DEFAULT_STOP_GLYPH, label: null };

export function stopModeHint(stop: StopModeInput): StopModeHint {
	if (stop.mode) {
		if (stop.mode === 'metro') return METRO_HINT;
		if (stop.mode === 'rail') return RAIL_HINT;
		return PLAIN_HINT;
	}
	const folded = foldDiacritics(stop.name).trimStart();
	if (folded.startsWith('station ')) return METRO_HINT;
	if (folded.startsWith('gare ')) return RAIL_HINT;
	return PLAIN_HINT;
}

const MODE_TAGS = {
	metro: 'Métro',
	tram: 'Tram',
	rail: 'Train',
	bus: 'Bus',
	ferry: 'Ferry',
} as const;
export type TransitModeKey = keyof typeof MODE_TAGS;
export type TransitModeTag = (typeof MODE_TAGS)[keyof typeof MODE_TAGS];

const TAG_TO_MODE_KEY = Object.fromEntries(
	(Object.entries(MODE_TAGS) as [TransitModeKey, TransitModeTag][]).map(([key, tag]) => [tag, key]),
) as Record<TransitModeTag, TransitModeKey>;

export function modeKeyForTag(tag: TransitModeTag | null | undefined): TransitModeKey | null {
	return tag ? (TAG_TO_MODE_KEY[tag] ?? null) : null;
}

export const TRANSIT_MODE_FILTERS = [
	{ key: 'metro', tag: MODE_TAGS.metro },
	{ key: 'tram', tag: MODE_TAGS.tram },
	{ key: 'bus', tag: MODE_TAGS.bus },
	{ key: 'rail', tag: MODE_TAGS.rail },
	{ key: 'ferry', tag: MODE_TAGS.ferry },
] as const satisfies readonly { key: TransitModeKey; tag: TransitModeTag }[];

export function stopModeTag(stop: StopModeInput): TransitModeTag | null {
	if (stop.mode && stop.mode in MODE_TAGS) {
		return MODE_TAGS[stop.mode as keyof typeof MODE_TAGS];
	}
	if (!stop.mode) {
		const folded = foldDiacritics(stop.name).trimStart();
		if (folded.startsWith('station ')) return MODE_TAGS.metro;
		if (folded.startsWith('gare ')) return MODE_TAGS.rail;
	}
	return null;
}

export function stopModeKey(stop: StopModeInput): TransitModeKey | null {
	return modeKeyForTag(stopModeTag(stop));
}

const ROUTE_TYPE_GLYPH: Record<number, string> = {
	0: '╤',
	1: '◉',
	2: '╪',
	3: '═',
	4: '≈',
};

const ROUTE_TYPE_TAG: Record<number, TransitModeTag> = {
	0: MODE_TAGS.tram,
	1: MODE_TAGS.metro,
	2: MODE_TAGS.rail,
	3: MODE_TAGS.bus,
	4: MODE_TAGS.ferry,
};

export interface RouteModeHint {
	readonly glyph: string;
	readonly tag: TransitModeTag | null;
}

export function routeModeHint(type: number): RouteModeHint {
	return {
		glyph: ROUTE_TYPE_GLYPH[type] ?? '═',
		tag: ROUTE_TYPE_TAG[type] ?? null,
	};
}

export function routeModeKey(type: number): TransitModeKey | null {
	return modeKeyForTag(routeModeHint(type).tag);
}

export function stopGroupKey(stop: {
	readonly name: string;
	readonly code?: string | null;
	readonly id: string;
	readonly mode?: StopIndexEntry['mode'];
}): string {
	return stopModeHint(stop).label
		? `name:${foldSearchText(stop.name)}`
		: `code:${stop.code ?? stop.id}`;
}
