// axisGutter.ts — size a chart's CATEGORY-label gutter from the labels themselves.
//
// WHY (operator): "axes must always have enough spacing — the math has to take into account
// the SIZE of the characters and HOW MANY characters." A fixed left gutter either clips long
// labels (stop / street names) or wastes width on short ones (plain numbers). This computes the
// gutter from the longest label's character count × the mono glyph advance, clamped so a very
// long name can't eat the whole plot — and returns a truncation matched to the gutter so a label
// is only ever cut at the point it genuinely no longer fits (never sooner).
//
// Pure (data project): no DOM. The advance is derived from the axis tick font size + the
// monospace ratio, so the SIZE of the characters is part of the math, as asked.

/** Axis tick font size in px — the marks render category ticks at var(--text-mono) = 0.875rem. */
const TICK_PX = 14;
/** Monospace advance width ≈ 0.6em. Slightly generous so a label reserves enough room (never clips). */
const GLYPH_W = TICK_PX * 0.6;
/** Breathing room between the longest label and the plot edge (px). */
const GUTTER_PAD = 14;

export interface CategoryGutter {
	/** Left padding (px) to pass as the plot's gutter. */
	readonly left: number;
	/** How many characters fit in that gutter (for honest truncation). */
	readonly maxChars: number;
	/** Truncate a label to what the gutter fits, with an ellipsis; short labels pass through. */
	readonly truncate: (label: string) => string;
}

export interface CategoryGutterOpts {
	/** Smallest gutter (px) — keeps short-label charts from looking cramped. Default 88. */
	readonly min?: number;
	/** Largest gutter (px) — keeps a long name from eating the plot. Default 200. */
	readonly max?: number;
}

/**
 * Compute the category-label gutter for the given row labels.
 *
 * left  = clamp(min, longestLabelChars × glyphWidth + pad, max)
 * chars = how many glyphs actually fit in that left gutter (the truncation budget)
 */
export function categoryGutter(
	labels: readonly (string | null | undefined)[],
	opts: CategoryGutterOpts = {},
): CategoryGutter {
	const min = opts.min ?? 88;
	const max = opts.max ?? 200;
	const longest = labels.reduce<number>((m, l) => Math.max(m, (l ?? '').length), 0);
	const left = Math.round(Math.min(max, Math.max(min, longest * GLYPH_W + GUTTER_PAD)));
	// How many glyphs the gutter holds (≥ 6 so a tiny gutter still shows something legible).
	const maxChars = Math.max(6, Math.floor((left - GUTTER_PAD) / GLYPH_W));
	const truncate = (label: string): string =>
		typeof label === 'string' && label.length > maxChars
			? `${label.slice(0, maxChars - 1)}…`
			: label;
	return { left, maxChars, truncate };
}
