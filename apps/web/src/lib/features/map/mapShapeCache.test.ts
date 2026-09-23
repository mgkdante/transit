import { describe, expect, it, vi } from 'vitest';

import type { RouteFile } from '$lib/v1';
import { RouteFileSchema } from '$lib/v1/schemas/route';
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
			matched: 1,
			stale: 0,
		},
	};
}

/** Flush pending microtasks so the fire-and-forget getRoute().then() resolves. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createShapeCacheManager.prefetch', () => {
	it('replaces refreshed geometry without restoring an older accepted resource value', () => {
		const mgr = createShapeCacheManager(async (id) => routeFile(id));
		const old = routeFile('24');
		const nextLeg = EAST_LEG.map(([lon, lat]) => [lon, lat + 0.01]);
		const next = RouteFileSchema.parse({
			...old,
			generated_utc: '2026-06-22T00:00:00Z',
			directions: [{ dir: 0, shape: { type: 'LineString', coordinates: nextLeg } }],
		});

		mgr.remember(old);
		mgr.remember(next);
		mgr.remember(old);

		expect(mgr.shapeFor(feature('24', -73.59, 45.51))).toEqual(nextLeg);
		expect(mgr.shapeFor.revision?.()).toBe(2);
	});

	it.each(['resolve', 'reject'] as const)(
		'ignores an evicted request that later %ss while its replacement is pending',
		async (outcome) => {
			let resolveFirst!: (route: RouteFile) => void;
			let rejectFirst!: (error: Error) => void;
			let resolveSecond!: (route: RouteFile) => void;
			const first = new Promise<RouteFile>((resolve, reject) => {
				resolveFirst = resolve;
				rejectFirst = reject;
			});
			const second = new Promise<RouteFile>((resolve) => {
				resolveSecond = resolve;
			});
			const getRoute = vi
				.fn<(id: string) => Promise<RouteFile | null>>()
				.mockResolvedValue(routeFile('24'))
				.mockReturnValueOnce(first)
				.mockReturnValueOnce(second);
			const mgr = createShapeCacheManager(getRoute);
			mgr.prefetch([vehicle('a', '24')]);
			mgr.remember(routeFile('24'));
			for (let i = 0; i < MAX_CACHED_ROUTE_SHAPES; i += 1) mgr.remember(routeFile(`r${i}`));
			expect(mgr.shapeFor(feature('24'))).toBeNull();
			mgr.prefetch([vehicle('a', '24')]);

			if (outcome === 'resolve') resolveFirst(routeFile('24'));
			else rejectFirst(new Error('evicted request failed'));
			await flush();
			mgr.prefetch([vehicle('a', '24')]);
			expect(getRoute).toHaveBeenCalledTimes(2);
			expect(mgr.shapeFor(feature('24'))).toBeNull();

			resolveSecond(routeFile('24'));
			await flush();
			expect(mgr.shapeFor(feature('24'))).toEqual(EAST_LEG);
		},
	);

	it('reuses geometry remembered from a route selection without another fetch', () => {
		const getRoute = vi.fn(async (id: string) => routeFile(id));
		const mgr = createShapeCacheManager(getRoute);

		mgr.remember(routeFile('24'));
		mgr.prefetch([vehicle('a', '24')]);

		expect(mgr.shapeFor(feature('24'))).toEqual(EAST_LEG);
		expect(mgr.shapeFor.revision?.()).toBe(1);
		expect(getRoute).not.toHaveBeenCalled();
	});

	it('keeps remembered geometry when an older pending request fails', async () => {
		let rejectRoute!: (error: Error) => void;
		const getRoute = vi.fn(
			() =>
				new Promise<RouteFile | null>((_resolve, reject) => {
					rejectRoute = reject;
				}),
		);
		const mgr = createShapeCacheManager(getRoute);
		mgr.prefetch([vehicle('a', '24')]);
		mgr.remember(routeFile('24'));
		rejectRoute(new Error('older request failed'));
		await flush();
		mgr.prefetch([vehicle('a', '24')]);

		expect(mgr.shapeFor(feature('24'))).toEqual(EAST_LEG);
		expect(mgr.shapeFor.revision?.()).toBe(1);
		expect(getRoute).toHaveBeenCalledOnce();
	});

	it('bounds remembered routes with the same eviction policy as fetched routes', () => {
		const mgr = createShapeCacheManager(async (id) => routeFile(id));
		for (let i = 0; i <= MAX_CACHED_ROUTE_SHAPES; i += 1) mgr.remember(routeFile(`r${i}`));

		expect(mgr.shapeFor(feature('r0'))).toBeNull();
		expect(mgr.shapeFor(feature(`r${MAX_CACHED_ROUTE_SHAPES}`))).toEqual(EAST_LEG);
	});

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
		const revision = () => mgr.shapeFor.revision?.();

		// Before any fetch resolves, the bus freezes (no shape).
		expect(mgr.shapeFor(feature('161'))).toBeNull();
		expect(revision()).toBe(0);

		mgr.prefetch([vehicle('a', '161')]);
		// Starting a request does not advertise new shape supply.
		expect(revision()).toBe(0);
		await flush();

		// The point sits on the east leg → resolves to that variant.
		expect(mgr.shapeFor(feature('161'))).toEqual(EAST_LEG);
		expect(revision()).toBe(1);
	});

	it('fails soft and allows a later retry when a fetch rejects', async () => {
		const getRoute = vi
			.fn<(id: string) => Promise<RouteFile | null>>()
			.mockRejectedValueOnce(new Error('network'))
			.mockResolvedValueOnce(routeFile('161'));
		const mgr = createShapeCacheManager(getRoute);
		const revision = () => mgr.shapeFor.revision?.();

		mgr.prefetch([vehicle('a', '161')]);
		expect(revision()).toBe(0);
		await flush();
		// The failed route is un-cached (the requested flag was cleared on reject).
		expect(mgr.shapeFor(feature('161'))).toBeNull();
		// The catch-path un-ledger is itself a supply-state change.
		expect(revision()).toBe(1);

		// A subsequent poll retries the same route — now it resolves and caches.
		mgr.prefetch([vehicle('a', '161')]);
		expect(revision()).toBe(1);
		await flush();
		expect(mgr.shapeFor(feature('161'))).toEqual(EAST_LEG);
		expect(getRoute).toHaveBeenCalledTimes(2);
		expect(revision()).toBe(2);
	});

	it('ledgers null and empty results without advancing the revision', async () => {
		const getRoute = vi.fn(async (id: string) =>
			id === 'null-route' ? null : { ...routeFile(id), directions: [] },
		);
		const mgr = createShapeCacheManager(getRoute);

		mgr.prefetch([vehicle('a', 'null-route'), vehicle('b', 'empty-route')]);
		await flush();
		expect(mgr.shapeFor(feature('null-route'))).toBeNull();
		expect(mgr.shapeFor(feature('empty-route'))).toBeNull();
		expect(mgr.shapeFor.revision?.()).toBe(0);

		mgr.prefetch([vehicle('a', 'null-route'), vehicle('b', 'empty-route')]);
		await flush();
		expect(getRoute).toHaveBeenCalledTimes(2);
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

		// Eviction removes the request-ledger entry too, so the old route can return.
		mgr.prefetch([vehicle('again', 'r0')]);
		expect(getRoute).toHaveBeenCalledTimes(MAX_CACHED_ROUTE_SHAPES + 2);
		await flush();
		expect(mgr.shapeFor(feature('r0'))).toEqual(EAST_LEG);
	});

	it('dedupes two prefetches while the first request is still pending', async () => {
		let resolveRoute!: (route: RouteFile | null) => void;
		const pending = new Promise<RouteFile | null>((resolve) => {
			resolveRoute = resolve;
		});
		const getRoute = vi.fn(() => pending);
		const mgr = createShapeCacheManager(getRoute);

		mgr.prefetch([vehicle('a', '161')]);
		mgr.prefetch([vehicle('b', '161')]);

		expect(getRoute).toHaveBeenCalledTimes(1);

		resolveRoute(routeFile('161'));
		await flush();
		expect(mgr.shapeFor(feature('161'))).toEqual(EAST_LEG);
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
