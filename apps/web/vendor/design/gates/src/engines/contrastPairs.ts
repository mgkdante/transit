// computed WCAG AA contrast gate engine — the luminance/ratio math is
// byte-equivalent to yesid.dev's contrast-floors.test.ts (Engine B) and
// transit's tokens-aa.test.ts (which adapted it). The token accessor is
// transit's dotted-path leaf() — a superset of yesid's flat accessor (it
// resolves both `foreground` and `dataviz.status.on-time`).
export type Mode = 'dark' | 'light' | 'brand';

/** [label, [fgMode, fgPath], [bgMode, bgPath], floor] */
export type ContrastPair = [string, [Mode, string], [Mode, string], number];

export function leaf(tokens: Record<string, unknown>, path: string): unknown {
	return path.split('.').reduce<unknown>((node, key) => {
		if (node && typeof node === 'object' && key in (node as Record<string, unknown>)) {
			return (node as Record<string, unknown>)[key];
		}
		return undefined;
	}, tokens);
}

/** Resolve a `color.<mode>.<path>` token to its 6-digit hex value. Throws loudly otherwise. */
export function makeHexAccessor(tokens: Record<string, unknown>) {
	return function hex(mode: Mode, path: string): string {
		const node = leaf(tokens, `color.${mode}.${path}`) as { $value?: unknown } | undefined;
		const v = node?.$value;
		if (typeof v !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(v)) {
			throw new Error(`token color.${mode}.${path} is not a 6-digit hex color: ${String(v)}`);
		}
		return v;
	};
}

export function luminance(h: string): number {
	const [r, g, b] = [1, 3, 5]
		.map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
		.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
	return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

export function ratio(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return ((hi as number) + 0.05) / ((lo as number) + 0.05);
}

export interface PairResult {
	label: string;
	ratio: number;
	floor: number;
	pass: boolean;
}

/** Compute every pair; consumers assert `pass` per entry (and print the table). */
export function runContrastPairs(
	tokens: Record<string, unknown>,
	pairs: readonly ContrastPair[],
): PairResult[] {
	const hex = makeHexAccessor(tokens);
	return pairs.map(([label, fg, bg, floor]) => {
		const r = ratio(hex(fg[0], fg[1]), hex(bg[0], bg[1]));
		return { label, ratio: r, floor, pass: r >= floor };
	});
}

/** Identity assertions (e.g. yesid's "terminal IS the site background"). */
export type TokenIdentity = [string, [Mode, string], [Mode, string]];

export function runIdentities(
	tokens: Record<string, unknown>,
	identities: readonly TokenIdentity[],
): Array<{ label: string; a: string; b: string; pass: boolean }> {
	const hex = makeHexAccessor(tokens);
	return identities.map(([label, a, b]) => {
		const av = hex(a[0], a[1]);
		const bv = hex(b[0], b[1]);
		return { label, a: av, b: bv, pass: av === bv };
	});
}
