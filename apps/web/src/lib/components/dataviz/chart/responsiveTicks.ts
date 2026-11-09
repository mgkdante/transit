/** Keep labels apart in screen space without dropping any data marks. */
export function spacedTicks<T>(
	values: readonly T[],
	position: (value: T, index: number) => number,
	gap: number,
): T[] {
	let previous = -Infinity;
	return values.filter((value, index) => {
		const pixel = position(value, index);
		if (pixel - previous < gap) return false;
		previous = pixel;
		return true;
	});
}
