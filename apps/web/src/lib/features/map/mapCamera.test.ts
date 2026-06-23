import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Map as MapLibreMap } from 'maplibre-gl';
import type { RouteFile } from '$lib/v1';

const mocks = vi.hoisted(() => ({ animate: true }));
vi.mock('$lib/motion/policy', () => ({
	shouldAnimate: () => mocks.animate,
}));

async function loadModule() {
	vi.resetModules();
	return import('./mapCamera');
}

/** Stub map exposing the camera surface mapCamera touches. */
function stubMap(zoom = 12) {
	const flyTo = vi.fn();
	const jumpTo = vi.fn();
	const fitBounds = vi.fn();
	const map = { getZoom: () => zoom, flyTo, jumpTo, fitBounds } as unknown as MapLibreMap;
	return { map, flyTo, jumpTo, fitBounds };
}

const EAST_LEG: [number, number][] = [
	[-73.6, 45.5],
	[-73.58, 45.5],
];
function routeWithShape(): RouteFile {
	return {
		generated_utc: '2026-06-21T00:00:00Z',
		id: '161',
		directions: [{ dir: 0, shape: { type: 'LineString', coordinates: EAST_LEG } }],
	} as unknown as RouteFile;
}
function routeNoShape(): RouteFile {
	return {
		generated_utc: '2026-06-21T00:00:00Z',
		id: '161',
		directions: [{ dir: 0, shape: null }],
	} as unknown as RouteFile;
}

afterEach(() => {
	mocks.animate = true;
});

describe('panTo', () => {
	it('flyTo (essential) when motion is allowed', async () => {
		mocks.animate = true;
		const { panTo } = await loadModule();
		const { map, flyTo, jumpTo } = stubMap();
		panTo(map, [-73.6, 45.5], 16);
		expect(flyTo).toHaveBeenCalledWith({ center: [-73.6, 45.5], zoom: 16, essential: true });
		expect(jumpTo).not.toHaveBeenCalled();
	});

	it('jumpTo (no flight) under reduced motion', async () => {
		mocks.animate = false;
		const { panTo } = await loadModule();
		const { map, flyTo, jumpTo } = stubMap();
		panTo(map, [-73.6, 45.5], 16);
		expect(jumpTo).toHaveBeenCalledWith({ center: [-73.6, 45.5], zoom: 16 });
		expect(flyTo).not.toHaveBeenCalled();
	});

	it('is a no-op without a map', async () => {
		const { panTo } = await loadModule();
		expect(() => panTo(null, [-73.6, 45.5], 16)).not.toThrow();
	});
});

describe('focusCoordinate', () => {
	it('zooms to AT LEAST the floor, never out from the current view', async () => {
		const { focusCoordinate } = await loadModule();
		// Current zoom 18 > floor 16 → keeps 18.
		const { map, flyTo } = stubMap(18);
		expect(focusCoordinate(map, [-73.6, 45.5], 16)).toBe(true);
		expect(flyTo).toHaveBeenCalledWith({ center: [-73.6, 45.5], zoom: 18, essential: true });
	});

	it('raises to the floor when the current view is wider', async () => {
		const { focusCoordinate } = await loadModule();
		const { map, flyTo } = stubMap(11);
		focusCoordinate(map, [-73.6, 45.5], 16);
		expect(flyTo).toHaveBeenCalledWith({ center: [-73.6, 45.5], zoom: 16, essential: true });
	});

	it('returns false (no move) without a map', async () => {
		const { focusCoordinate } = await loadModule();
		expect(focusCoordinate(null, [-73.6, 45.5], 16)).toBe(false);
	});
});

describe('fitRouteBounds', () => {
	it('fits the route linework with the padding + maxZoom and an animated duration', async () => {
		mocks.animate = true;
		const { fitRouteBounds } = await loadModule();
		const { map, fitBounds } = stubMap();
		expect(fitRouteBounds(map, routeWithShape())).toBe(true);
		expect(fitBounds).toHaveBeenCalledWith(
			[
				[-73.6, 45.5],
				[-73.58, 45.5],
			],
			{ padding: 64, maxZoom: 15, duration: 600 },
		);
	});

	it('uses a zero-duration fit under reduced motion', async () => {
		mocks.animate = false;
		const { fitRouteBounds } = await loadModule();
		const { map, fitBounds } = stubMap();
		fitRouteBounds(map, routeWithShape());
		expect(fitBounds.mock.calls[0][1]).toMatchObject({ duration: 0 });
	});

	it('returns false (no move) when the route has no usable geometry', async () => {
		const { fitRouteBounds } = await loadModule();
		const { map, fitBounds } = stubMap();
		expect(fitRouteBounds(map, routeNoShape())).toBe(false);
		expect(fitBounds).not.toHaveBeenCalled();
	});

	it('returns false (no move) without a map', async () => {
		const { fitRouteBounds } = await loadModule();
		expect(fitRouteBounds(null, routeWithShape())).toBe(false);
	});
});
