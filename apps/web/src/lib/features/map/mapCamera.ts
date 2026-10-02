import type { Map as MapLibreMap } from 'maplibre-gl';
import { shouldAnimate } from '@yesid/motion/policy';
import { duration } from '@yesid/motion/tokens';
import type { RouteFile } from '$lib/v1';
import { routeBoundsFromFile } from './mapGeo';
import { deferMapFocusInset } from './mapFocusInset';

const FOCUS_EVENT_DATA = { cameraIntent: 'focus' } as const;

function easeOut(t: number): number {
	if (t <= 0) return 0;
	if (t >= 1) return 1;
	let lower = 0;
	let upper = 1;
	let parameter = 0;
	for (let iteration = 0; iteration < 24; iteration += 1) {
		parameter = (lower + upper) / 2;
		const x = parameter ** 3 - 0.6 * parameter ** 2 + 0.6 * parameter;
		if (x < t) lower = parameter;
		else upper = parameter;
	}
	return 0.4 * parameter ** 3 - 1.8 * parameter ** 2 + 2.4 * parameter;
}

export function panTo(map: MapLibreMap | null, center: [number, number], zoom: number): void {
	if (!map) return;
	deferMapFocusInset(map, ({ pointOffset }) => {
		const camera = { center, zoom, offset: pointOffset, easing: easeOut };
		if (shouldAnimate('motion-gated')) {
			map.flyTo({ ...camera, essential: true }, FOCUS_EVENT_DATA);
		} else {
			map.easeTo({ ...camera, duration: 0 }, FOCUS_EVENT_DATA);
		}
	});
}

export function focusCoordinate(
	map: MapLibreMap | null,
	coord: [number, number],
	minZoom: number,
): boolean {
	if (!map) return false;
	panTo(map, coord, Math.max(map.getZoom(), minZoom));
	return true;
}

export function fitRouteBounds(map: MapLibreMap | null, route: RouteFile): boolean {
	if (!map) return false;
	const bounds = routeBoundsFromFile(route);
	if (!bounds) return false;
	deferMapFocusInset(map, ({ routePadding }) => {
		map.fitBounds(
			bounds,
			{
				padding: routePadding,
				maxZoom: 15,
				duration: shouldAnimate('motion-gated') ? duration.slower : 0,
				easing: easeOut,
			},
			FOCUS_EVENT_DATA,
		);
	});
	return true;
}
