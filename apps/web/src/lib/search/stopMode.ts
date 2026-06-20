// Transit-mode hint for a "smart STOP" result card. PREFERS the real `mode`
// field now emitted on the stops index (metro|tram|rail|bus|ferry); falls back
// to a name-prefix heuristic only for snapshots published before the field
// existed. STM names métro platforms 'Station <name>' and commuter-rail stops
// 'Gare <name>'; everything else is a street-level bus stop.
//
// `glyph` reuses the existing mono identity vocabulary (metro '◉', rail '╪', the
// default stop '■') — no new symbol, no colour, no hex. The route-level glyph is
// owned by `routeModeHint` below, the single glyph source consumed by BOTH the
// LinesIndex and SearchSurface line rows. `label` is a locale-invariant
// transit-mode proper noun (Métro / Train), so it needs no bilingual copy entry.

import type { StopIndexEntry } from '$lib/v1/schemas/stops_index';
import { foldDiacritics, foldSearchText } from './normalize';

export interface StopModeHint {
	/** Mono glyph for the result card, on the shared identity vocabulary. */
	readonly glyph: string;
	/** Locale-invariant mode tag, or null for a plain bus stop (no tag). */
	readonly label: 'Métro' | 'Train' | null;
}

/** Minimal stop shape the hint needs: a name (for the fallback) + optional mode. */
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

/**
 * Mode hint for a stop. Uses the real `mode` field when present (metro/rail get
 * a glyph + tag; tram/bus/ferry render as a plain stop). When `mode` is absent
 * or null (pre-field snapshot), falls back to the accent/case-insensitive name
 * prefix ('station ' → métro, 'gare ' → train).
 *
 * NOTE: this drives the GLYPH + the dedupe GROUPING (a métro station collapses
 * to one row). For the VISIBLE per-row mode TAG that covers every mode (tram /
 * bus / ferry too), use `stopModeTag` — kept separate so the grouping behaviour
 * (and its tests) stays unchanged.
 */
export function stopModeHint(stop: StopModeInput): StopModeHint {
	if (stop.mode) {
		if (stop.mode === 'metro') return METRO_HINT;
		if (stop.mode === 'rail') return RAIL_HINT;
		return PLAIN_HINT; // tram | bus | ferry — plain stop, no tag
	}
	const folded = foldDiacritics(stop.name).trimStart();
	if (folded.startsWith('station ')) return METRO_HINT;
	if (folded.startsWith('gare ')) return RAIL_HINT;
	return PLAIN_HINT;
}

// Locale-invariant transit-mode proper nouns shared by the stop + route tags.
// Métro / Tram / Train / Bus / Ferry need no bilingual copy entry (proper nouns
// read the same in EN + FR). An unknown future mode string → no tag (honest).
const MODE_TAGS = {
	metro: 'Métro',
	tram: 'Tram',
	rail: 'Train',
	bus: 'Bus',
	ferry: 'Ferry',
} as const;
/** The canonical transit-mode key (the GTFS/feed mode discriminator). */
export type TransitModeKey = keyof typeof MODE_TAGS;
export type TransitModeTag = (typeof MODE_TAGS)[keyof typeof MODE_TAGS];

// The reverse of MODE_TAGS (tag proper-noun → mode key), derived from the SAME
// source so a filter can map a visible tag back to its mode without a hand-kept
// duplicate that could silently drift.
const TAG_TO_MODE_KEY = Object.fromEntries(
	(Object.entries(MODE_TAGS) as [TransitModeKey, TransitModeTag][]).map(([key, tag]) => [tag, key]),
) as Record<TransitModeTag, TransitModeKey>;

/** Mode key for a visible mode tag (the reverse of MODE_TAGS); null when unknown. */
export function modeKeyForTag(tag: TransitModeTag | null | undefined): TransitModeKey | null {
	return tag ? (TAG_TO_MODE_KEY[tag] ?? null) : null;
}

/**
 * The VISIBLE mode tag for a stop — covers EVERY known mode (metro/tram/rail/
 * bus/ferry), unlike `stopModeHint.label` which only tags metro/rail. Uses the
 * real `mode` field; falls back to the métro/train name prefix when absent so a
 * pre-field snapshot still tags its stations. Returns null for an unknown mode
 * with no name hint (no fabricated tag).
 */
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

// GTFS route_type → the shared identity glyph (0 tram '╤' · 1 metro '◉' · 2 rail
// '╪' · 3 bus '═' · 4 ferry '≈'). This map (via routeModeHint) is the SINGLE glyph
// source for route rows — LinesIndex and SearchSurface both derive from it, so
// there is no duplicate TYPE_GLYPH constant. Bus '═' is the unmapped-type default.
const ROUTE_TYPE_GLYPH: Record<number, string> = {
	0: '╤',
	1: '◉',
	2: '╪',
	3: '═',
	4: '≈',
};

// GTFS route_type → the visible mode tag (proper noun, no bilingual entry).
const ROUTE_TYPE_TAG: Record<number, TransitModeTag> = {
	0: MODE_TAGS.tram,
	1: MODE_TAGS.metro,
	2: MODE_TAGS.rail,
	3: MODE_TAGS.bus,
	4: MODE_TAGS.ferry,
};

export interface RouteModeHint {
	/** Mono glyph for the result row, on the shared identity vocabulary. */
	readonly glyph: string;
	/** Locale-invariant mode tag (Métro / Tram / Bus …), or null for an unmapped type. */
	readonly tag: TransitModeTag | null;
}

/**
 * Mode hint for a ROUTE from its GTFS route_type — extends the stop mode
 * vocabulary to lines so a search line result carries the same glyph + a mode
 * tag (Métro / Tram / Bus / Train / Ferry). Bus is the glyph default for any
 * unmapped type; the tag is null when the type is unknown (no fabricated tag).
 */
export function routeModeHint(type: number): RouteModeHint {
	return {
		glyph: ROUTE_TYPE_GLYPH[type] ?? '═',
		tag: ROUTE_TYPE_TAG[type] ?? null,
	};
}

/**
 * Dedupe key for collapsing search results to ONE row per logical stop. A métro
 * station (real mode 'metro', or a 'Station …' name pre-field) is attached to
 * many physical stops — the platforms + every bus pole at that terminal — so it
 * groups by NAME (one result for the whole station; direction lives on the
 * detail page). Ordinary stops group by their unique rider code (falling back to
 * id), so only true duplicates collapse and distinct bus stops stay separate.
 */
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
