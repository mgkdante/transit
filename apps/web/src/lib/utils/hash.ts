// $lib/utils/hash — deterministic hashing + jitter for dataviz.
//
// The Chart Doctrine determinism rule: any "random" placement (strip/beeswarm
// jitter, stable tie-breaks) must be seeded from a STABLE id, NEVER Math.random
// — so a chart renders byte-identical across loads/SSR and never "changes visit
// to visit". FNV-1a (32-bit) is fast, dependency-free, and well-distributed for
// short string ids (trip_id, stop_id). SSR-safe: pure, no DOM.

/** FNV-1a 32-bit hash of a string → unsigned 32-bit integer. */
export function hashStr(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** A stable fraction in [0, 1) from an id (the unit interval of {@link hashStr}). */
export function hashUnit(id: string): number {
	return hashStr(id) / 0x100000000;
}

/**
 * Deterministic jitter in [-band, band] from a stable id — the strip/beeswarm
 * vertical offset. Same id ⇒ same offset, every render (never Math.random).
 * Default band 4 (px) matches the Doctrine STRIP_JITTER_BAND (±4 = full band 8).
 */
export function hashJitter(id: string, band = 4): number {
	return (hashUnit(id) * 2 - 1) * band;
}
