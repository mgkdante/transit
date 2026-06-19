// Transit-mode hint for a "smart STOP" result card. PREFERS the real `mode`
// field now emitted on the stops index (metro|tram|rail|bus|ferry); falls back
// to a name-prefix heuristic only for snapshots published before the field
// existed. STM names métro platforms 'Station <name>' and commuter-rail stops
// 'Gare <name>'; everything else is a street-level bus stop.
//
// `glyph` reuses the existing mono identity vocabulary (LinesIndex TYPE_GLYPH:
// metro '◉', rail '╪', the default stop '■') — no new symbol, no colour, no hex.
// `label` is a locale-invariant transit-mode proper noun (Métro / Train), so it
// needs no bilingual copy entry.

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
