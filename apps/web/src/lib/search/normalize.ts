// Shared search normalization + scoring — the ONE matcher behind every entity
// search surface (top-bar chrome search, /search, /lines, /stops).
//
// Why this exists: STM data is accented French ('Station Crémazie', 'Côte-Vertu',
// 'Berri-UQAM') and riders type however they like — no accents on an EN keyboard,
// cross-streets in either order, a space where the data has a hyphen. The old
// per-surface `.trim().toLowerCase().includes()` matchers were accent-blind and
// order-sensitive, so 'cremazie' / 'berri uqam' / 'fleury berri' all returned
// zero hits. foldSearchText + tokenMatchScore fix that once, for all of them.

/**
 * Diacritic fold ONLY — NFKD decompose + strip combining marks + lowercase.
 * Behaviour-identical to the geocoder's historical normalizeSearchText, so it
 * can back that module without shifting its dedup/relevance semantics.
 */
export function foldDiacritics(value: string | null | undefined): string {
	return (value ?? '')
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
}

/**
 * Full search fold: diacritics + fold separators (hyphen, slash, period, comma,
 * underscore, straight/curly apostrophe) to spaces + collapse whitespace + trim.
 * So 'Station Berri-UQAM' → 'station berri uqam' and "Place-d'Armes" →
 * 'place d armes' — making hyphen/space/accent differences irrelevant to matching.
 */
export function foldSearchText(value: string | null | undefined): string {
	return foldDiacritics(value)
		.replace(/[-_/.,'’]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Folded query split into tokens. Empty input → []. */
export function tokenize(value: string | null | undefined): string[] {
	const folded = foldSearchText(value);
	return folded ? folded.split(' ') : [];
}

/**
 * Rank a query against a set of candidate strings for one entity. Lower is a
 * better match; null means no match. Tiers (folded on both sides):
 *   0 — a candidate equals the full query                (exact)
 *   1 — a candidate starts with the full query           (prefix)
 *   2 — the full query is a contiguous substring         (substring)
 *   3 — every query token appears in ONE candidate,      (token-AND,
 *       in any order, possibly non-contiguous             word-order free)
 * Tiers 0–2 preserve the old exact/prefix/substring ordering; tier 3 is the new
 * capability that resolves 'berri uqam' / 'fleury berri' / multi-word queries.
 */
export function tokenMatchScore(
	haystacks: readonly (string | null | undefined)[],
	query: string,
): number | null {
	const q = foldSearchText(query);
	if (!q) return null;

	const folded = haystacks.map((h) => foldSearchText(h)).filter((h) => h.length > 0);
	if (folded.length === 0) return null;

	if (folded.some((h) => h === q)) return 0;
	if (folded.some((h) => h.startsWith(q))) return 1;
	if (folded.some((h) => h.includes(q))) return 2;

	const tokens = q.split(' ');
	if (folded.some((h) => tokens.every((token) => h.includes(token)))) return 3;

	return null;
}
