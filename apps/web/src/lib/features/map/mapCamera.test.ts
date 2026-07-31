import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Map as MapLibreMap } from 'maplibre-gl';
import type { RouteFile } from '$lib/v1';

const mocks = vi.hoisted(() => ({
	animate: true,
	slower: 500,
	deferInset: vi.fn(
		(
			_map: unknown,
			consume: (inset: {
				pointOffset: [number, number];
				routePadding: { top: number; right: number; bottom: number; left: number };
			}) => void,
		) =>
			consume({
				pointOffset: [-280, -160],
				routePadding: { top: 64, right: 624, bottom: 384, left: 64 },
			}),
	),
}));

vi.mock('@yesid/motion/policy', () => ({
	shouldAnimate: () => mocks.animate,
}));

vi.mock('@yesid/motion/tokens', () => ({
	duration: {
		get slower() {
			return mocks.slower;
		},
	},
}));

vi.mock('./mapFocusInset', () => ({
	deferMapFocusInset: mocks.deferInset,
}));

async function loadModule() {
	vi.resetModules();
	return import('./mapCamera');
}

function stubMap(zoom = 12) {
	const flyTo = vi.fn();
	const easeTo = vi.fn();
	const jumpTo = vi.fn();
	const fitBounds = vi.fn();
	const fitScreenCoordinates = vi.fn();
	const setPadding = vi.fn();
	const map = {
		getZoom: () => zoom,
		flyTo,
		easeTo,
		jumpTo,
		fitBounds,
		fitScreenCoordinates,
		setPadding,
	} as unknown as MapLibreMap;
	return { map, flyTo, easeTo, jumpTo, fitBounds, fitScreenCoordinates, setPadding };
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
	mocks.slower = 500;
	vi.clearAllMocks();
});

describe('panTo', () => {
	it('defers one inset sample then tags an offset flyTo without persistent padding', async () => {
		const { panTo } = await loadModule();
		const { map, flyTo, easeTo, jumpTo, fitScreenCoordinates, setPadding } = stubMap();

		panTo(map, [-73.6, 45.5], 16);

		expect(mocks.deferInset).toHaveBeenCalledOnce();
		expect(flyTo).toHaveBeenCalledOnce();
		const [options, eventData] = flyTo.mock.calls[0]!;
		expect(options).toMatchObject({
			center: [-73.6, 45.5],
			zoom: 16,
			offset: [-280, -160],
			essential: true,
		});
		expect(options).not.toHaveProperty('padding');
		expect(options).not.toHaveProperty('curve');
		expect(options).not.toHaveProperty('maxDuration');
		expect(eventData).toEqual({ cameraIntent: 'focus' });
		expect(easeTo).not.toHaveBeenCalled();
		expect(jumpTo).not.toHaveBeenCalled();
		expect(fitScreenCoordinates).not.toHaveBeenCalled();
		expect(setPadding).not.toHaveBeenCalled();
	});

	it('uses the local cubic-bezier(0.2, 0.8, 0.2, 1) numeric ease-out', async () => {
		const { panTo } = await loadModule();
		const { map, flyTo } = stubMap();

		panTo(map, [-73.6, 45.5], 16);
		const easing = flyTo.mock.calls[0]?.[0]?.easing as (t: number) => number;

		expect(easing(0)).toBe(0);
		expect(easing(0.25)).toBeCloseTo(0.7672843, 6);
		expect(easing(0.5)).toBeCloseTo(0.94607946, 6);
		expect(easing(1)).toBe(1);
	});

	it('uses an instantaneous tagged easeTo with the non-zero offset under reduced motion', async () => {
		mocks.animate = false;
		const { panTo } = await loadModule();
		const { map, flyTo, easeTo, jumpTo, setPadding } = stubMap();

		panTo(map, [-73.6, 45.5], 16);

		expect(easeTo).toHaveBeenCalledOnce();
		const [options, eventData] = easeTo.mock.calls[0]!;
		expect(options).toMatchObject({
			center: [-73.6, 45.5],
			zoom: 16,
			duration: 0,
			offset: [-280, -160],
		});
		expect(options).not.toHaveProperty('padding');
		expect(eventData).toEqual({ cameraIntent: 'focus' });
		expect(flyTo).not.toHaveBeenCalled();
		expect(jumpTo).not.toHaveBeenCalled();
		expect(setPadding).not.toHaveBeenCalled();
	});

	it('is a no-op without a map', async () => {
		const { panTo } = await loadModule();
		expect(() => panTo(null, [-73.6, 45.5], 16)).not.toThrow();
		expect(mocks.deferInset).not.toHaveBeenCalled();
	});
});

describe('focusCoordinate', () => {
	it('returns synchronously and never zooms out from the current view', async () => {
		const { focusCoordinate } = await loadModule();
		const { map, flyTo } = stubMap(18);

		expect(focusCoordinate(map, [-73.6, 45.5], 16)).toBe(true);
		expect(flyTo.mock.calls[0]?.[0]).toMatchObject({
			center: [-73.6, 45.5],
			zoom: 18,
			offset: [-280, -160],
		});
	});

	it('raises to the floor when the current view is wider', async () => {
		const { focusCoordinate } = await loadModule();
		const { map, flyTo } = stubMap(11);

		focusCoordinate(map, [-73.6, 45.5], 16);
		expect(flyTo.mock.calls[0]?.[0]).toMatchObject({ zoom: 16 });
	});

	it('returns false without a map', async () => {
		const { focusCoordinate } = await loadModule();
		expect(focusCoordinate(null, [-73.6, 45.5], 16)).toBe(false);
	});
});

describe('fitRouteBounds', () => {
	it('tags a route fit with asymmetric inset padding, token duration, and no offset', async () => {
		mocks.animate = true;
		mocks.slower = 731;
		const { fitRouteBounds } = await loadModule();
		const { map, fitBounds, fitScreenCoordinates, setPadding } = stubMap();

		expect(fitRouteBounds(map, routeWithShape())).toBe(true);
		expect(fitBounds).toHaveBeenCalledOnce();
		const [bounds, options, eventData] = fitBounds.mock.calls[0]!;
		expect(bounds).toEqual([
			[-73.6, 45.5],
			[-73.58, 45.5],
		]);
		expect(options).toMatchObject({
			padding: { top: 64, right: 624, bottom: 384, left: 64 },
			maxZoom: 15,
			duration: 731,
		});
		const easing = options.easing as (t: number) => number;
		expect(easing(0)).toBe(0);
		expect(easing(0.25)).toBeCloseTo(0.7672843, 6);
		expect(easing(0.5)).toBeCloseTo(0.94607946, 6);
		expect(easing(1)).toBe(1);
		expect(options).not.toHaveProperty('offset');
		expect(options).not.toHaveProperty('maxDuration');
		expect(eventData).toEqual({ cameraIntent: 'focus' });
		expect(fitScreenCoordinates).not.toHaveBeenCalled();
		expect(setPadding).not.toHaveBeenCalled();
	});

	it('uses the same framing with duration zero under reduced motion', async () => {
		mocks.animate = false;
		const { fitRouteBounds } = await loadModule();
		const { map, fitBounds, flyTo, easeTo, fitScreenCoordinates, setPadding } = stubMap();

		fitRouteBounds(map, routeWithShape());

		expect(fitBounds.mock.calls[0]?.[1]).toMatchObject({
			padding: { top: 64, right: 624, bottom: 384, left: 64 },
			duration: 0,
		});
		expect(fitBounds.mock.calls[0]?.[1]).not.toHaveProperty('offset');
		expect(fitBounds.mock.calls[0]?.[2]).toEqual({ cameraIntent: 'focus' });
		expect(flyTo).not.toHaveBeenCalled();
		expect(easeTo).not.toHaveBeenCalled();
		expect(fitScreenCoordinates).not.toHaveBeenCalled();
		expect(setPadding).not.toHaveBeenCalled();
	});

	it('returns false without usable route geometry and schedules no sample', async () => {
		const { fitRouteBounds } = await loadModule();
		const { map, fitBounds } = stubMap();

		expect(fitRouteBounds(map, routeNoShape())).toBe(false);
		expect(fitBounds).not.toHaveBeenCalled();
		expect(mocks.deferInset).not.toHaveBeenCalled();
	});

	it('returns false without a map', async () => {
		const { fitRouteBounds } = await loadModule();
		expect(fitRouteBounds(null, routeWithShape())).toBe(false);
	});
});

describe('MapLibre camera vendor fact pin', () => {
	it('pins 5.24.0: duration-0 sync, eventData threading, fit padding deletion, and PRM offset omission', () => {
		const packageJson = JSON.parse(
			readFileSync(resolve(process.cwd(), 'node_modules/maplibre-gl/package.json'), 'utf8'),
		) as { version: string };

		expect(packageJson.version).toBe('5.24.0');
	});
});
