// mapCamera — the imperative camera moves for the /map hero (GL glue).
//
// The actual map.flyTo / map.easeTo / map.fitBounds calls + the reduced-motion
// instant-vs-flight decision + the zoom floors, pulled out of MapHero so the camera
// behaviour is one focused module. MapHero keeps the thin focusStop/focusVehicle/
// focusRoute wrappers (they do the reactive list lookups), then delegate the
// actual move here with plain data. Nothing here reads stores or reactive state —
// it takes a map instance + plain coords/bounds and moves the camera.

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
	let parameter = t;
	for (let iteration = 0; iteration < 24; iteration += 1) {
		parameter = (lower + upper) / 2;
		const x = parameter ** 3 - 0.6 * parameter ** 2 + 0.6 * parameter;
		if (x < t) lower = parameter;
		else upper = parameter;
	}
	return 0.4 * parameter ** 3 - 1.8 * parameter ** 2 + 2.4 * parameter;
}

/**
 * Pan/zoom the camera to a point after one rendered inset sample. Reduced motion
 * uses duration-zero easeTo so the ephemeral offset survives; motion-allowed focus
 * uses flyTo. `essential` alone is not the policy gate. No-op without a map.
 */
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

/**
 * Focus a point at AT LEAST `minZoom`, never zooming out from the current view
 * (`Math.max(currentZoom, minZoom)`). Returns false (no move) without a map. This
 * is the shared shape behind focusStop/focusVehicle/near-me: centre + zoom-in.
 */
export function focusCoordinate(
	map: MapLibreMap | null,
	coord: [number, number],
	minZoom: number,
): boolean {
	if (!map) return false;
	panTo(map, coord, Math.max(map.getZoom(), minZoom));
	return true;
}

/**
 * Frame a route's full linework. Returns false (no move) when the route has no
 * usable geometry or there is no map. Mirrors the camera-fit MapLibre's fitBounds
 * expects; the flight duration is reduced-motion-gated.
 */
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
