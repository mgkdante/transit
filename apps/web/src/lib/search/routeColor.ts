// routeColor.ts — guard + normalize a GTFS route brand colour for a swatch.
//
// A line's brand colour is DATA from the /v1 contract (RouteIndexEntry.color, a
// GTFS hex like "009EE0", or null when the feed omits it). It is the ONE allowed
// dynamic colour in the markup — applied via an inline `background` bound to this
// guarded value — because no design token can carry an arbitrary per-route hue.
//
// This guard is the safety boundary: it accepts ONLY a well-formed 3- or 6-digit
// hex (optionally '#'-prefixed) and returns a canonical `#RRGGBB` string;
// anything else (null, empty, 'transparent', a CSS expression, junk) returns
// null so the caller renders NO swatch rather than injecting an unsafe value.
// HONESTY: a missing colour is no swatch, never a fabricated default hue.

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Normalize a GTFS route colour to a safe `#RRGGBB` string, or null when it is
 * absent / malformed. Expands a 3-digit shorthand to 6 digits and lower-cases.
 */
export function routeColor(raw: string | null | undefined): string | null {
	if (raw == null) return null;
	const trimmed = raw.trim();
	const m = HEX_RE.exec(trimmed);
	if (!m) return null;
	let hex = m[1].toLowerCase();
	if (hex.length === 3) {
		hex = hex
			.split('')
			.map((c) => c + c)
			.join('');
	}
	return `#${hex}`;
}
