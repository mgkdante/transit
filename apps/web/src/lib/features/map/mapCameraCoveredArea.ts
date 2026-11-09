import type { MapFitPadding } from '#lib/components/map/viewport.ts';

/** Insets describe the covered edges; symmetric margins cancel for point focus. */
export function coveredArea(padding: MapFitPadding, margin = 0) {
	const box =
		typeof padding === 'number'
			? { top: padding, right: padding, bottom: padding, left: padding }
			: { top: 0, right: 0, bottom: 0, left: 0, ...padding };
	return {
		padding,
		routePadding: {
			top: box.top + margin,
			right: box.right + margin,
			bottom: box.bottom + margin,
			left: box.left + margin,
		},
		pointOffset: [(box.left - box.right) / 2 || 0, (box.top - box.bottom) / 2] as [number, number],
	};
}
