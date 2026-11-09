export const RIGHT_SIZES = [56, 320, 400, 560] as const;
export const LEFT_SIZES = [56, 300] as const;
export function snapSize(width: number, sizes: readonly number[], fallback = sizes[0]): number {
	if (!Number.isFinite(width)) return fallback;
	return sizes.reduce((best, size) =>
		Math.abs(size - width) < Math.abs(best - width) ? size : best,
	);
}
export function stepSize(
	width: number,
	key: string,
	sizes: readonly number[],
	side: 'left' | 'right',
): number | null {
	const index = sizes.indexOf(snapSize(width, sizes));
	if (key === 'Home') return sizes[0];
	if (key === 'End') return sizes[sizes.length - 1];
	const grow = side === 'right' ? 'ArrowLeft' : 'ArrowRight';
	if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return null;
	const delta = key === grow || key === 'ArrowUp' ? 1 : -1;
	return sizes[Math.max(0, Math.min(sizes.length - 1, index + delta))];
}
export function sizeText(width: number, locale: 'en' | 'fr', side: 'left' | 'right'): string {
	const names =
		side === 'right'
			? locale === 'fr'
				? ['replié', 'compact', 'standard', 'large']
				: ['rail', 'compact', 'standard', 'wide']
			: locale === 'fr'
				? ['replié', 'ouvert']
				: ['rail', 'open'];
	const sizes: readonly number[] = side === 'right' ? RIGHT_SIZES : LEFT_SIZES;
	return (locale === 'fr' ? 'Taille du panneau : ' : 'Panel size: ') + names[sizes.indexOf(width)];
}
