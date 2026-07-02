// easterWords.ts — a tasteful, decoration-only "easter word" layer for /metrics.
//
// The operator asked for a small delight on the methodology page: a fixed set of
// words (science, the transit modes, the agencies, the flagship rail project) get
// a subtle hover flourish wherever they appear in the metric PROSE, reusing the
// house wordmarkHover effect family (bounce / wiggle / wave / spin). It is
// DECORATION ONLY — no semantics, no href, the text stays fully selectable and
// readable, the animation artifacts are aria-hidden, and there is zero layout
// shift. Touch + prefers-reduced-motion users get the plain text (the action
// self-disables; see easterWordHover).
//
// This module is the PURE, SSR-safe half: the word list + the matcher that splits
// a prose string into plain-text runs and matched spans. The GSAP-backed Svelte
// action lives alongside in easterWordHover.ts (browser-only, lazily imported).
// Kept inside the metrics feature (no cross-feature import): it is a page-local
// flourish, not a shared primitive.

/**
 * The easter-word phrases, lower-cased, en + fr surface forms. Two-word phrases
 * ("alto train", "cdpq infra") are matched as whole phrases; single words match
 * on word boundaries only (so "stm" never matches inside "system", and "bus"
 * never matches inside "busiest"). fr forms that differ from en are included
 * ("trains"/"train" already cover fr; "bus" is shared; "autobus"/"autobus" fr).
 *
 * Ordering matters: LONGER phrases first so a greedy left-to-right scan prefers
 * "alto train" over a bare "train", and "octranspo" over any prefix.
 */
export const EASTER_PHRASES: readonly string[] = [
	// two-word phrases first (greedy longest-match)
	'alto train',
	'cdpq infra',
	// agencies + operators
	'octranspo',
	'stm',
	'sto',
	'sts',
	// modes + flagship
	'science',
	'trains',
	'train',
	'buses',
	'autobus', // fr "bus(es)"
	'bus',
];

/** A segment of split prose: a plain-text run, or a matched easter word/phrase. */
export interface EasterSegment {
	/** The exact source text of this segment (original casing preserved). */
	readonly text: string;
	/** True when this segment is one of the {@link EASTER_PHRASES} matches. */
	readonly match: boolean;
}

// Word-character class for boundary checks. Latin letters + digits (+ the ASCII
// underscore, which never appears mid-phrase here). Accented letters count as word
// chars so "science" inside a French word would not falsely boundary-split; the
// phrase list is ASCII, so this is only used to REJECT partial hits.
const WORD_CHAR = /[\p{L}\p{N}_]/u;

function isWordChar(ch: string | undefined): boolean {
	return ch != null && WORD_CHAR.test(ch);
}

/**
 * Split `text` into ordered {@link EasterSegment}s: plain-text runs interleaved
 * with whole-word/phrase matches from {@link EASTER_PHRASES}. Case-insensitive,
 * word-boundary anchored (a match must not be flanked by a word character on
 * either side), greedy-longest (phrases before their sub-words). Adjacent
 * non-match runs are coalesced, so the returned list alternates run / match /
 * run. The concatenation of every segment's `text` is exactly the input (loss-
 * less), so the renderer can rebuild the prose verbatim with only the matched
 * spans wrapped. Never throws; empty input yields an empty list.
 */
export function splitEasterSegments(
	text: string,
	phrases: readonly string[] = EASTER_PHRASES,
): EasterSegment[] {
	if (!text) return [];
	const lower = text.toLowerCase();
	const segments: EasterSegment[] = [];
	let runStart = 0; // start of the pending plain-text run
	let i = 0;

	const flushRun = (end: number): void => {
		if (end > runStart) segments.push({ text: text.slice(runStart, end), match: false });
	};

	while (i < lower.length) {
		let matched = false;
		for (const phrase of phrases) {
			if (!phrase) continue;
			if (!lower.startsWith(phrase, i)) continue;
			// Word-boundary guard: reject a hit flanked by a word char (partial word).
			const before = i > 0 ? lower[i - 1] : undefined;
			const after = i + phrase.length < lower.length ? lower[i + phrase.length] : undefined;
			if (isWordChar(before) || isWordChar(after)) continue;
			// Commit: flush the pending run, emit the match (original casing), advance.
			flushRun(i);
			segments.push({ text: text.slice(i, i + phrase.length), match: true });
			i += phrase.length;
			runStart = i;
			matched = true;
			break;
		}
		if (!matched) i += 1;
	}
	flushRun(lower.length);
	return segments;
}

/** True when `text` contains at least one easter match (cheap pre-check). */
export function hasEasterMatch(text: string, phrases: readonly string[] = EASTER_PHRASES): boolean {
	return splitEasterSegments(text, phrases).some((s) => s.match);
}
