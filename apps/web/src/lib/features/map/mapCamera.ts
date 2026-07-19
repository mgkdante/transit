// mapCamera — the imperative camera moves for the /map hero (GL glue).
//
// The actual map.flyTo / map.jumpTo / map.fitBounds calls + the reduced-motion
// jump-vs-fly decision + the zoom floors, pulled out of MapHero so the camera
// behaviour is one focused module. MapHero keeps the thin focusStop/focusVehicle/
// focusRoute wrappers (they do the reactive list lookups), then delegate the
// actual move here with plain data. Nothing here reads stores or reactive state —
// it takes a map instance + plain coords/bounds and moves the camera.

import type { Map as MapLibreMap } from 'maplibre-gl';
import { shouldAnimate } from '@yesid/motion/policy';
import type { RouteFile } from '$lib/v1';
import { routeBoundsFromFile } from './mapGeo';

/**
 * Pan/zoom the camera to a point, honouring prefers-reduced-motion: jumpTo (no
 * flight) under reduce, flyTo otherwise. `essential` alone does NOT respect reduced
 * motion, so we branch on the shared motion policy. No-op without a map.
 */
export function panTo(map: MapLibreMap | null, center: [number, number], zoom: number): void {
	if (!map) return;
	if (shouldAnimate('motion-gated')) map.flyTo({ center, zoom, essential: true });
	else map.jumpTo({ center, zoom });
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
	map.fitBounds(bounds, {
		padding: 64,
		maxZoom: 15,
		duration: shouldAnimate('motion-gated') ? 600 : 0,
	});
	return true;
}
