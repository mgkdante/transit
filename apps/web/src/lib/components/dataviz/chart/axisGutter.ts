const TICK_PX = 14;
const GLYPH_W = TICK_PX * 0.6;
const GUTTER_PAD = 14;

export interface CategoryGutter {
	readonly left: number;
	readonly maxChars: number;
	readonly truncate: (label: string) => string;
}

export interface CategoryGutterOpts {
	readonly min?: number;
	readonly max?: number;
}

export function categoryGutter(
	labels: readonly (string | null | undefined)[],
	opts: CategoryGutterOpts = {},
): CategoryGutter {
	const min = opts.min ?? 88;
	const max = opts.max ?? 200;
	const longest = labels.reduce<number>((m, l) => Math.max(m, (l ?? '').length), 0);
	const left = Math.round(Math.min(max, Math.max(min, longest * GLYPH_W + GUTTER_PAD)));
	const maxChars = Math.max(6, Math.floor((left - GUTTER_PAD) / GLYPH_W));
	const truncate = (label: string): string =>
		typeof label === 'string' && label.length > maxChars
			? `${label.slice(0, maxChars - 1)}…`
			: label;
	return { left, maxChars, truncate };
}
