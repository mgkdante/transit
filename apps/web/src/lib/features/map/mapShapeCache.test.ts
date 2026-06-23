import { describe, expect, it, vi } from 'vitest';

import type { RouteFile } from '$lib/v1';
import type { Vehicle } from '$lib/v1/schemas';
import type { VehicleFeature } from '$lib/components/map';
import { createShapeCacheManager, MAX_CACHED_ROUTE_SHAPES } from './mapShapeCache';

const EAST_LEG: [number, number][] = [
	[-73.6, 45.5],
	[-73.58, 45.5],
];

/** A RouteFile with one usable east-leg LineString variant. */
function routeFile(id: string): RouteFile {
	return {
		generated_utc: '2026-06-21T00:00:00Z',
		id,
		long: 'Test',
		directions: [{ dir: 0, shape: { type: 'LineString', coordinates: EAST_LEG } }],
	} as unknown as RouteFile;
}

function vehicle(id: string, route: string | null): Vehicle {
	return { id, lat: 45.5, lon: -73.59, status: 'on_time', route } as unknown as Vehicle;
}

function feature(route: string, lon = -73.59, lat = 45.5005): VehicleFeature {
	return {
		type: 'Feature',
		geometry: { type: 'Point', coordinates: [lon, lat] },
		properties: {
			id: 'v',
			body: 'bus',
			bearing: 90,
			hasHeading: 1,
			route,
			selected: 0,
			hovered: 0,
			matched: 1,
			opacity: 1,
			silenceAgeS: 0,
			stale: 0,
		},
	};
}

/** Flush pending microtasks so the fire-and-forget getRoute().then() resolves. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createShapeCacheManager.prefetch', () => {
	it('fetches each route at most once across polls (deduped)', async () => {
		const getRoute = vi.fn(async (id: string) => routeFile(id));
		const mgr = createShapeCacheManager(getRoute);

		mgr.prefetch([vehicle('a', '161'), vehicle('b', '161'), vehicle('c', '24')]);
		await flush();
		// 161 + 24 — the duplicate 161 bus did not re-request.
		expect(getRoute).toHaveBeenCalledTimes(2);

		// A second poll with the same routes requests nothing new.
		mgr.prefetch([vehicle('a', '161'), vehicle('c', '24')]);
		await flush();
		expect(getRoute).toHaveBeenCalledTimes(2);
	});

	it('skips vehicles with no route id (null / empty)', async () => {
		const getRoute = vi.fn(async (id: string) => routeFile(id));
		const mgr = createShapeCacheManager(getRoute);

		mgr.prefetch([vehicle('a', null), vehicle('b', '')]);
		await flush();
		expect(getRoute).not.toHaveBeenCalled();
	});

	it('caches a resolved shape so shapeFor upgrades a bus to its route polyline', async () => {
		const getRoute = vi.fn(async (id: string) => routeFile(id));
		const mgr = createShapeCacheManager(getRoute);

		// Before any fetch resolves, the bus freezes (no shape).
		expect(mgr.shapeFor(feature('161'))).toBeNull();

		mgr.prefetch([vehicle('a', '161')]);
		await flush();

		// The point sits on the east leg → resolves to that variant.
		expect(mgr.shapeFor(feature('161'))).toEqual(EAST_LEG);
	});

	it('fails soft and allows a later retry when a fetch rejects', async () => {
		const getRoute = vi
			.fn<(id: string) => Promise<RouteFile | null>>()
			.mockRejectedValueOnce(new Error('network'))
			.mockResolvedValueOnce(routeFile('161'));
		const mgr = createShapeCacheManager(getRoute);

		mgr.prefetch([vehicle('a', '161')]);
		await flush();
		// The failed route is un-cached (the requested flag was cleared on reject).
		expect(mgr.shapeFor(feature('161'))).toBeNull();

		// A subsequent poll retries the same route — now it resolves and caches.
		mgr.prefetch([vehicle('a', '161')]);
		await flush();
		expect(mgr.shapeFor(feature('161'))).toEqual(EAST_LEG);
		expect(getRoute).toHaveBeenCalledTimes(2);
	});

	it('does not cache a route that resolves to null or an empty shape set', async () => {
		const getRoute = vi.fn(async (id: string) => (id === 'null-route' ? null : routeFile(id)));
		const mgr = createShapeCacheManager(getRoute);

		mgr.prefetch([vehicle('a', 'null-route')]);
		await flush();
		expect(mgr.shapeFor(feature('null-route'))).toBeNull();
	});

	it('evicts the oldest cached route once the cap is exceeded', async () => {
		const getRoute = vi.fn(async (id: string) => routeFile(id));
		const mgr = createShapeCacheManager(getRoute);

		// Fill the cache to exactly the cap, then one more → the first is evicted.
		const ids = Array.from({ length: MAX_CACHED_ROUTE_SHAPES + 1 }, (_, i) => `r${i}`);
		mgr.prefetch(ids.map((id, i) => vehicle(String(i), id)));
		await flush();

		// The oldest (r0) was dropped; the newest is still resolvable. The east-leg
		// point sits on every route's identical shape, so resolution proves presence.
		expect(mgr.shapeFor(feature('r0'))).toBeNull();
		expect(mgr.shapeFor(feature(`r${MAX_CACHED_ROUTE_SHAPES}`))).toEqual(EAST_LEG);
	});
});

describe('createShapeCacheManager.shapeFor', () => {
	it('returns null for a feature with no route id', () => {
		const mgr = createShapeCacheManager(async (id) => routeFile(id));
		expect(mgr.shapeFor(feature(''))).toBeNull();
	});

	it('returns null when the point is too far from the cached shape', async () => {
		const mgr = createShapeCacheManager(async (id) => routeFile(id));
		mgr.prefetch([vehicle('a', '161')]);
		await flush();
		// ~5 km north of the east leg — beyond the on-route band.
		expect(mgr.shapeFor(feature('161', -73.59, 45.6))).toBeNull();
	});
});
