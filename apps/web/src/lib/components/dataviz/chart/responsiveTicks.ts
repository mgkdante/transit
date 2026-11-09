/**
 * Keep labels apart in screen space without dropping any data marks.
 * Values for which `keep` returns true are always shown (e.g. the zero line on a
 * delay axis); the others are added left to right when they clear every label
 * already chosen by at least `gap` pixels.
 */
export function spacedTicks<T>(
	values: readonly T[],
	position: (value: T, index: number) => number,
	gap: number,
	keep: (value: T) => boolean = () => false,
): T[] {
	const pixels = values.map((value, index) => position(value, index));
	const chosen = new Set(values.flatMap((value, index) => (keep(value) ? [index] : [])));
	values.forEach((_, index) => {
		if (chosen.has(index)) return;
		for (const other of chosen) if (Math.abs(pixels[index]! - pixels[other]!) < gap) return;
		chosen.add(index);
	});
	return values.filter((_, index) => chosen.has(index));
}
