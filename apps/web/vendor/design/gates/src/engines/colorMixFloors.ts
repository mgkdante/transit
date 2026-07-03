// brand-alpha TEXT floor engine — extracted from yesid.dev @ 2bdb611d
// apps/web/src/tests/contrast-floors.test.ts (Engine A). `color:` declarations
// mixing brand tokens below the floor fail AA on brand surfaces; backgrounds/
// borders may mix lower — only `color:` lines are scanned. The regexes are
// ASSEMBLED from config but compile byte-identical to the source gate for the
// default token list (primary|accent|blog-accent @ 85%, foreground @ 65%).
//
// Exemption contract (byte-equivalent): aria-hidden ornaments are WCAG 1.4.3
// "pure decoration" — the marker on the line (or within `markerWindow` lines
// above) skips it.

export interface ColorMixFloorConfig {
	/** Brand tokens whose text mixes must clear `brandFloor` %. */
	brandTokens?: readonly string[];
	brandFloor?: number;
	foregroundFloor?: number;
	exemptMarker?: string;
	/** Lines above a hit in which the marker clears it. Source gate: 3. */
	markerWindow?: number;
}

export const YESID_COLOR_MIX_DEFAULTS = {
	brandTokens: ['primary', 'accent', 'blog-accent'],
	brandFloor: 85,
	foregroundFloor: 65,
	exemptMarker: 'contrast-exempt',
	markerWindow: 3,
} as const;

export function buildColorMixPatterns(brandTokens: readonly string[]): {
	colorMixText: RegExp;
	fgMixText: RegExp;
} {
	// (?<![-\w]) keeps `border-color:` / `outline-color:` (boundaries, not text)
	// out of the scan — only bare `color:` declarations are text.
	return {
		colorMixText: new RegExp(
			`(?<![-\\w])color:\\s*color-mix\\(in srgb,\\s*var\\(--(?:${brandTokens.join('|')})[^)]*\\)\\s*(\\d+(?:\\.\\d+)?)%`,
		),
		fgMixText: /(?<![-\w])color:\s*color-mix\(in srgb,\s*var\(--foreground\)\s*(\d+(?:\.\d+)?)%/,
	};
}

/** Scan one file's source; returns 'L<n>: <trimmed line>' entries. */
export function colorMixViolations(src: string, config: ColorMixFloorConfig = {}): string[] {
	const brandTokens = config.brandTokens ?? YESID_COLOR_MIX_DEFAULTS.brandTokens;
	const brandFloor = config.brandFloor ?? YESID_COLOR_MIX_DEFAULTS.brandFloor;
	const foregroundFloor = config.foregroundFloor ?? YESID_COLOR_MIX_DEFAULTS.foregroundFloor;
	const exemptMarker = config.exemptMarker ?? YESID_COLOR_MIX_DEFAULTS.exemptMarker;
	const markerWindow = config.markerWindow ?? YESID_COLOR_MIX_DEFAULTS.markerWindow;
	const { colorMixText, fgMixText } = buildColorMixPatterns(brandTokens);

	const lines = src.split('\n');
	const bad: string[] = [];
	lines.forEach((line, i) => {
		const window = lines.slice(Math.max(0, i - markerWindow), i + 1).join('\n');
		if (window.includes(exemptMarker)) return;
		const brand = line.match(colorMixText);
		if (brand && Number(brand[1]) < brandFloor) bad.push(`L${i + 1}: ${line.trim()}`);
		const fg = line.match(fgMixText);
		if (fg && Number(fg[1]) < foregroundFloor) bad.push(`L${i + 1}: ${line.trim()}`);
	});
	return bad;
}
