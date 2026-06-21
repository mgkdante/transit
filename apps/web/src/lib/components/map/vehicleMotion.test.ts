import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Deterministic gsap stub: capture each tween's progress object + callbacks so a
// test can drive frames by hand (set progress.value, fire onUpdate/onComplete)
// instead of waiting on a real timeline. `to` records the LATEST tween.
interface FakeTween {
	progress: { value: number };
	onUpdate?: () => void;
	onComplete?: () => void;
	killed: boolean;
	duration: number;
}
let lastTween: FakeTween | null = null;
vi.mock('$lib/motion/utils/gsap', () => ({
	gsap: {
		to(progress: { value: number }, vars: Record<string, unknown>) {
			const tween: FakeTween = {
				progress,
				onUpdate: vars.onUpdate as (() => void) | undefined,
				onComplete: vars.onComplete as (() => void) | undefined,
				killed: false,
				duration: (vars.duration as number) ?? 0,
			};
			lastTween = tween;
			return { kill: () => (tween.killed = true) };
		},
	},
}));

import type { Map as MapLibreMap } from 'maplibre-gl';
import { createVehicleMotionController, interpolateVehicleFeatures } from './vehicleMotion';
import { VEHICLE_SOURCE, type VehicleFC } from './vehicleLayer';

const from = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [-73.6, 45.5] },
			properties: {
				id: '40061',
				body: 'old-body',
				bearing: 350,
				hasHeading: 1,
				route: '161',
				selected: 0,
				hovered: 0,
				matched: 1,
				opacity: 1,
				silenceAgeS: 0,
			},
		},
	],
} as const;

const to = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [-73.58, 45.52] },
			properties: {
				id: '40061',
				body: 'new-body',
				bearing: 10,
				hasHeading: 1,
				route: '161',
				selected: 1,
				hovered: 1,
				matched: 1,
				opacity: 1,
				silenceAgeS: 0,
			},
		},
		{
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [-73.7, 45.6] },
			properties: {
				id: 'new-bus',
				body: 'new-body',
				bearing: 90,
				hasHeading: 1,
				route: '80',
				selected: 0,
				hovered: 0,
				matched: 1,
				opacity: 1,
				silenceAgeS: 0,
			},
		},
	],
} as const;

describe('interpolateVehicleFeatures', () => {
	it('interpolates coordinates and shortest-arc bearing while preserving target styling', () => {
		const mid = interpolateVehicleFeatures(from, to, 0.5);

		expect(mid.features[0].geometry.coordinates).toEqual([-73.59, 45.51]);
		expect(mid.features[0].properties.bearing).toBe(0);
		expect(mid.features[0].properties.body).toBe('new-body');
		expect(mid.features[0].properties.selected).toBe(1);
		expect(mid.features[0].properties.hovered).toBe(1);
	});

	it('snaps new vehicles directly to their target point', () => {
		const mid = interpolateVehicleFeatures(from, to, 0.5);

		expect(mid.features[1].properties.id).toBe('new-bus');
		expect(mid.features[1].geometry.coordinates).toEqual([-73.7, 45.6]);
	});

	it('carries the target silence opacity through interpolation (a silent bus keeps its fade)', () => {
		const fadedTarget = {
			type: 'FeatureCollection',
			features: [
				{
					...to.features[0],
					properties: { ...to.features[0].properties, opacity: 0.25 },
				},
			],
		} as const;
		const mid = interpolateVehicleFeatures(from, fadedTarget, 0.5);
		expect(mid.features[0].properties.opacity).toBe(0.25);
	});

	it('does NOT move a silent bus reporting the same position (from === to → no drift)', () => {
		// A non-reporting bus repeats its last fix, so from and to coincide.
		const still = interpolateVehicleFeatures(from, from, 0.5);
		expect(still.features[0].geometry.coordinates).toEqual(from.features[0].geometry.coordinates);
	});
});

// --- Controller-level tests with a stubbed map + fake gsap tween --------------

/** A feature collection of one bus at a given lon/lat. */
function fc(lon: number, lat: number): VehicleFC {
	return {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [lon, lat] },
				properties: {
					id: '40061',
					body: 'bus',
					bearing: 0,
					hasHeading: 1,
					route: '161',
					selected: 0,
					hovered: 0,
					matched: 1,
					opacity: 1,
					silenceAgeS: 0,
				},
			},
		],
	};
}

/** Stub MapLibre map: only getSource('vehicles').setData is exercised. */
function stubMap() {
	const setData = vi.fn();
	const map = {
		getSource: (id: string) => (id === VEHICLE_SOURCE ? { setData } : undefined),
	} as unknown as MapLibreMap;
	return { map, setData };
}

/** Lon of the bus pushed by the most recent setData call. */
function lastSetLon(setData: ReturnType<typeof vi.fn>): number {
	const fcArg = setData.mock.calls.at(-1)?.[0] as VehicleFC;
	return fcArg.features[0].geometry.coordinates[0];
}

describe('createVehicleMotionController', () => {
	beforeEach(() => {
		lastTween = null;
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('(a) animate=false → snaps immediately (single setData, lands at target)', () => {
		const { map, setData } = stubMap();
		const c = createVehicleMotionController(map);

		c.set(fc(-73.58, 45.52), { tickKey: 't1', animate: false });

		expect(setData).toHaveBeenCalledTimes(1);
		expect(lastSetLon(setData)).toBe(-73.58); // exact target, no interpolation
		expect(lastTween).toBeNull(); // no tween started
	});

	it('(b) stale → snaps even when animate is true', () => {
		const { map, setData } = stubMap();
		const c = createVehicleMotionController(map);

		// First fix establishes `current` so a subsequent set could animate.
		c.set(fc(-73.6, 45.5), { tickKey: 't1', animate: true });
		setData.mockClear();

		c.set(fc(-73.58, 45.52), { tickKey: 't2', stale: true, animate: true });

		expect(setData).toHaveBeenCalledTimes(1);
		expect(lastSetLon(setData)).toBe(-73.58);
	});

	it('(c) same tickKey → re-targets without restarting the tween', () => {
		const { map } = stubMap();
		const c = createVehicleMotionController(map);

		c.set(fc(-73.6, 45.5), { tickKey: 't1', animate: true }); // snap (no current yet)
		c.set(fc(-73.58, 45.52), { tickKey: 't2', animate: true }); // starts a tween
		const startedTween = lastTween;
		expect(startedTween).not.toBeNull();

		// Same tickKey: should re-target the SAME tween, not create a new one.
		c.set(fc(-73.5, 45.55), { tickKey: 't2', animate: true });

		expect(lastTween).toBe(startedTween); // no new tween created
		expect(startedTween?.killed).toBe(false); // existing tween not killed/restarted
	});

	it('(d) rapid tween frames coalesce (~30fps) but the terminal frame lands exactly on target', () => {
		const { map, setData } = stubMap();
		// Drive a monotonic performance.now() so the throttle is deterministic.
		let nowMs = 1000;
		vi.spyOn(performance, 'now').mockImplementation(() => nowMs);

		const c = createVehicleMotionController(map);
		c.set(fc(-73.6, 45.5), { tickKey: 't1', animate: true }); // snap baseline
		c.set(fc(-73.5, 45.6), { tickKey: 't2', animate: true, durationSec: 28 }); // tween
		const tween = lastTween;
		expect(tween).not.toBeNull();
		setData.mockClear();

		// Three 60fps onUpdate frames (~16ms apart): the first clears the ~33ms gate
		// (>33ms since the snap that seeded the throttle), the next two coalesce.
		tween!.progress.value = 0.1;
		nowMs += 40;
		tween!.onUpdate?.();
		tween!.progress.value = 0.2;
		nowMs += 16;
		tween!.onUpdate?.();
		tween!.progress.value = 0.3;
		nowMs += 16;
		tween!.onUpdate?.();
		expect(setData).toHaveBeenCalledTimes(1); // 2 of 3 coalesced at the ~30fps cap

		// A frame >33ms after the last setData passes the gate.
		tween!.progress.value = 0.4;
		nowMs += 40;
		tween!.onUpdate?.();
		expect(setData).toHaveBeenCalledTimes(2);

		// The terminal frame (onComplete → snap) is NEVER throttled, even back-to-back.
		tween!.progress.value = 1;
		nowMs += 1; // <33ms since last setData — would be skipped if throttled
		tween!.onComplete?.();
		expect(setData).toHaveBeenCalledTimes(3);
		expect(lastSetLon(setData)).toBe(-73.5); // lands EXACTLY on the real target
	});

	it('destroy() kills the running tween', () => {
		const { map } = stubMap();
		const c = createVehicleMotionController(map);
		c.set(fc(-73.6, 45.5), { tickKey: 't1', animate: true });
		c.set(fc(-73.5, 45.6), { tickKey: 't2', animate: true });
		const tween = lastTween;
		expect(tween?.killed).toBe(false);

		c.destroy();
		expect(tween?.killed).toBe(true);
	});
});
