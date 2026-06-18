// Coarse transit-mode hint derived from an STM stop NAME — a web-only heuristic
// so a "smart STOP" result card can show a métro/train glyph + tag instead of a
// generic dot, WITHOUT any pipeline change. STM names métro platform stops
// 'Station <name>' and commuter-rail stops 'Gare <name>'; everything else is a
// street-level bus stop. Best-effort by design: replace with a real `mode` field
// on the stops index once the pipeline emits one (see slice fast-follow).
//
// `glyph` reuses the existing mono identity vocabulary (LinesIndex TYPE_GLYPH:
// metro '◉', rail '╪', the default stop '■') — no new symbol, no colour, no hex.
// `label` is a locale-invariant transit-mode proper noun (Métro / Train), so it
// needs no bilingual copy entry.

import { foldDiacritics } from './normalize';

export interface StopModeHint {
	/** Mono glyph for the result card, on the shared identity vocabulary. */
	readonly glyph: string;
	/** Locale-invariant mode tag, or null for a plain bus stop (no tag). */
	readonly label: 'Métro' | 'Train' | null;
}

const DEFAULT_STOP_GLYPH = '■';
const METRO_GLYPH = '◉';
const RAIL_GLYPH = '╪';

/**
 * Map a stop name to a coarse mode hint. Returns the default stop glyph + no tag
 * for ordinary stops; a métro/train glyph + tag when the name prefix signals a
 * station. Accent/case-insensitive ('station'/'gare').
 */
export function stopModeHint(name: string | null | undefined): StopModeHint {
	const folded = foldDiacritics(name).trimStart();
	if (folded.startsWith('station ')) return { glyph: METRO_GLYPH, label: 'Métro' };
	if (folded.startsWith('gare ')) return { glyph: RAIL_GLYPH, label: 'Train' };
	return { glyph: DEFAULT_STOP_GLYPH, label: null };
}
