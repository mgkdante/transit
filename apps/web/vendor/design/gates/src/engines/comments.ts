// Comment blanking + line numbering — byte-equivalent to transit's
// brand-doctrine.test.ts helpers (the two-track scan contract: violations are
// detected on comment-STRIPPED source; allowlist markers are honored on the
// ORIGINAL source at the same line index).

/**
 * Blank out Svelte/JS/CSS comment CONTENT in place so doctrine prose (which
 * legitimately NAMES the banned tokens to explain why they're avoided) never
 * trips the scan. Newlines are PRESERVED — every comment char becomes a space —
 * so line numbers stay 1:1 with the original (the allowlist window is checked
 * against the original at the same index).
 */
export function blankComments(src: string): string {
	const blank = (m: string) => m.replace(/[^\n]/g, ' ');
	return src
		.replace(/<!--[\s\S]*?-->/g, blank)
		.replace(/\/\*[\s\S]*?\*\//g, blank)
		.replace(/(^|[^:])(\/\/.*)$/gm, (_full, pre: string, comment: string) => pre + blank(comment));
}

/** Split into [lineNo, text] keeping original numbers (for allowlist windows). */
export function numbered(src: string): Array<[number, string]> {
	return src.split('\n').map((line, i) => [i + 1, line]);
}
