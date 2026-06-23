import { describe, expect, it, vi } from 'vitest';

import type { Map as MapLibreMap } from 'maplibre-gl';
import {
	createVehicleMotionController,
	power1Out,
	projectEntry,
	type FixResolver,
	type MotionRuntime,
	type ShapeResolver,
	type VehicleFix,
} from './vehicleMotion';
import { VEHICLE_SOURCE, type VehicleFC, type VehicleFeature } from './vehicleLayer';
import { STALE_CUTOFF_S } from './vehicleProjection';
import { cumulativeLengths, projectToPolyline, type Coord } from './polyline';

// A long, due-east straight shape near Montréal so an advanced point stays on it
// for any plausible projection distance (km of headroom). East leg → tangent ~90°.
const W = [-73.7, 45.5] as Coord;
const E = [-73.4, 45.5] as Coord; // ~23 km east of W
const STRAIGHT: Coord[] = [W, E];

const NOW_MS = Date.parse('2026-06-22T12:00:00Z');
function isoAgo(seconds: number): string {
	return new Date(NOW_MS - seconds * 1000).toISOString();
}

/** A one-bus FC at lon/lat on route '161' with an explicit feed bearing. */
function fcAt(lon: number, lat: number, bearing = 0, id = '40061'): VehicleFC {
	return {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [lon, lat] },
				properties: {
					id,
					body: 'bus',
					bearing,
					hasHeading: 1,
					route: '161',
					selected: 0,
					hovered: 0,
					matched: 1,
					opacity: 1,
					silenceAgeS: 0,
					stale: 0,
				},
			},
		],
	};
}

function feature(lon: number, lat: number, bearing = 0): VehicleFeature {
	return fcAt(lon, lat, bearing).features[0];
}

const straightShape: ShapeResolver = () => STRAIGHT;
const noShape: ShapeResolver = () => null;

/** Fix resolver: every bus reported `ageS` ago, moving at `speedMps`. */
function fixFor(ageS: number, speedMps: number | null): FixResolver {
	const fix: VehicleFix = {
		reportedUtc: isoAgo(ageS),
		updatedUtc: isoAgo(ageS),
		speedMps,
	};
	return () => fix;
}

/** Stub MapLibre map: only getSource('vehicles').setData is exercised. */
function stubMap() {
	const setData = vi.fn();
	const map = {
		getSource: (id: string) => (id === VEHICLE_SOURCE ? { setData } : undefined),
	} as unknown as MapLibreMap;
	return { map, setData };
}

function lastLon(setData: ReturnType<typeof vi.fn>): number {
	const fc = setData.mock.calls.at(-1)?.[0] as VehicleFC;
	return fc.features[0].geometry.coordinates[0];
}
function lastFeature(setData: ReturnType<typeof vi.fn>): VehicleFeature {
	const fc = setData.mock.calls.at(-1)?.[0] as VehicleFC;
	return fc.features[0];
}

/**
 * Controlled runtime: the test owns the frame scheduler + the monotonic + server
 * clocks, so projection is fully deterministic. `tick(ms, serverDeltaMs?)` advances
 * both clocks and fires exactly one queued frame.
 */
function controlledRuntime() {
	let nowMs = 1000;
	let serverNow = NOW_MS;
	let pending: (() => void) | null = null;
	let handle = 0;
	const runtime: MotionRuntime = {
		now: () => nowMs,
		requestFrame: (cb) => {
			pending = cb;
			return ++handle;
		},
		cancelFrame: () => {
			pending = null;
		},
	};
	const serverNowFn = () => serverNow;
	function frame(advanceMonotonicMs: number, advanceServerMs = advanceMonotonicMs): void {
		nowMs += advanceMonotonicMs;
		serverNow += advanceServerMs;
		const cb = pending;
		pending = null;
		cb?.();
	}
	return { runtime, serverNowFn, frame, hasPending: () => pending != null };
}

describe('power1Out', () => {
	it('is the out-quad curve 1−(1−t)², clamped to [0,1]', () => {
		expect(power1Out(0)).toBe(0);
		expect(power1Out(1)).toBe(1);
		expect(power1Out(0.5)).toBeCloseTo(0.75, 6); // decelerating: past the midpoint
		expect(power1Out(-1)).toBe(0);
		expect(power1Out(2)).toBe(1);
	});
});

describe('projectEntry (pure)', () => {
	it('projects FORWARD along the shape and reports the tangent heading', () => {
		const entry = {
			feature: feature(W[0], W[1], 17),
			fix: { reportedUtc: isoAgo(5), updatedUtc: isoAgo(5), speedMps: 10 },
		};
		const { feature: out, result } = projectEntry(entry, NOW_MS, 0, straightShape, undefined);
		expect(result.frozen).toBe(false);
		expect(out.geometry.coordinates[0]).toBeGreaterThan(W[0]); // advanced east
		expect(out.geometry.coordinates[1]).toBeCloseTo(45.5, 5);
		expect(out.properties.bearing).toBeCloseTo(90, 0); // shape tangent, not 17
		expect(out.properties.stale).toBe(0);
	});

	it('FREEZES (no shape) at the reported coord + bearing and flags nothing', () => {
		const entry = {
			feature: feature(W[0], W[1], 123),
			fix: { reportedUtc: isoAgo(5), updatedUtc: isoAgo(5), speedMps: 10 },
		};
		const { feature: out, result } = projectEntry(entry, NOW_MS, 0, noShape, undefined);
		expect(result.frozen).toBe(true);
		expect(out.geometry.coordinates).toEqual([W[0], W[1]]);
		expect(out.properties.bearing).toBe(123);
		expect(out.properties.stale).toBe(0);
	});

	it('FREEZES + flags stale past the cutoff', () => {
		const entry = {
			feature: feature(W[0], W[1], 200),
			fix: {
				reportedUtc: isoAgo(STALE_CUTOFF_S),
				updatedUtc: isoAgo(STALE_CUTOFF_S),
				speedMps: 10,
			},
		};
		const { feature: out, result } = projectEntry(entry, NOW_MS, 0, straightShape, undefined);
		expect(result.frozen).toBe(true);
		expect(result.stale).toBe(true);
		expect(out.properties.stale).toBe(1); // the per-bus "!" flag
		expect(out.geometry.coordinates).toEqual([W[0], W[1]]);
	});

	it('FREEZES when the fix is unknown (null) — never dead-reckons on guessed data', () => {
		const entry = { feature: feature(W[0], W[1], 5), fix: null };
		const { result } = projectEntry(entry, NOW_MS, 0, straightShape, undefined);
		expect(result.frozen).toBe(true);
		expect(result.stale).toBe(true); // null fix ⇒ Infinity age ⇒ stale
	});

	it('blends from the ease-correct origin toward the projection (continuous, no snap)', () => {
		const entry = {
			feature: feature(W[0], W[1], 90),
			fix: { reportedUtc: isoAgo(5), updatedUtc: isoAgo(5), speedMps: 10 },
		};
		// Projection target (no blend) — the destination of the ease.
		const target = projectEntry(entry, NOW_MS, 0, straightShape, undefined).feature.geometry
			.coordinates[0];
		const origin = -73.71; // clearly WEST of the projection (target ≈ -73.6994)
		// At blend start (e=0) the dot sits at the origin; partway it is between; at
		// the end it reaches the projection — monotone, never overshooting.
		const at0 = projectEntry(entry, NOW_MS, 1000, straightShape, {
			fromCoord: [origin, 45.5],
			fromBearing: 90,
			startMs: 1000,
		}).feature.geometry.coordinates[0];
		const atMid = projectEntry(entry, NOW_MS, 1450, straightShape, {
			fromCoord: [origin, 45.5],
			fromBearing: 90,
			startMs: 1000,
		}).feature.geometry.coordinates[0];
		const atEnd = projectEntry(entry, NOW_MS, 1900, straightShape, {
			fromCoord: [origin, 45.5],
			fromBearing: 90,
			startMs: 1000,
		}).feature.geometry.coordinates[0];
		expect(at0).toBeCloseTo(origin, 5);
		expect(atMid).toBeGreaterThan(at0);
		expect(atMid).toBeLessThan(atEnd);
		expect(atEnd).toBeCloseTo(target, 5);
	});
});

describe('createVehicleMotionController — forward projection', () => {
	it('animate=false → snaps to the reported position, no rAF loop', () => {
		const { map, setData } = stubMap();
		const { runtime, serverNowFn, hasPending } = controlledRuntime();
		const c = createVehicleMotionController(map, runtime);

		c.set(fcAt(-73.58, 45.52), {
			tickKey: 't1',
			animate: false,
			fixFor: fixFor(5, 10),
			shapeFor: straightShape,
			serverNowFn,
		});

		expect(setData).toHaveBeenCalledTimes(1);
		expect(lastLon(setData)).toBe(-73.58); // exact reported position, no projection
		expect(hasPending()).toBe(false); // no loop scheduled
		c.destroy();
	});

	it('global stale → snaps to reported positions (whole feed behind)', () => {
		const { map, setData } = stubMap();
		const { runtime, serverNowFn } = controlledRuntime();
		const c = createVehicleMotionController(map, runtime);
		c.set(fcAt(-73.58, 45.52), {
			tickKey: 't1',
			animate: true,
			stale: true,
			fixFor: fixFor(5, 10),
			shapeFor: straightShape,
			serverNowFn,
		});
		expect(lastLon(setData)).toBe(-73.58);
		c.destroy();
	});

	it('projects a fresh fix FORWARD along the shape over wall-clock', () => {
		const { map, setData } = stubMap();
		const { runtime, serverNowFn, frame } = controlledRuntime();
		const c = createVehicleMotionController(map, runtime);

		// Bus at W, moving east at 10 m/s, fixed 5s ago. First feed renders at once.
		c.set(fcAt(W[0], W[1]), {
			tickKey: 't1',
			animate: true,
			fixFor: fixFor(5, 10),
			shapeFor: straightShape,
			serverNowFn,
		});
		const afterFeed = lastLon(setData);
		expect(afterFeed).toBeGreaterThan(W[0]); // already projected forward from the fix

		// Advance the server clock 10s and fire a frame: the bus advances FURTHER east
		// (the fix ages → more distance under the decaying-speed model).
		frame(40, 10_000); // >33ms monotonic clears the throttle
		expect(lastLon(setData)).toBeGreaterThan(afterFeed);
		c.destroy();
	});

	it('a stale fix FREEZES the bus and flags it (no forward drift)', () => {
		const { map, setData } = stubMap();
		const { runtime, serverNowFn, frame } = controlledRuntime();
		const c = createVehicleMotionController(map, runtime);

		c.set(fcAt(W[0], W[1], 200), {
			tickKey: 't1',
			animate: true,
			fixFor: fixFor(STALE_CUTOFF_S, 10), // already past the cutoff
			shapeFor: straightShape,
			serverNowFn,
		});
		expect(lastLon(setData)).toBe(W[0]); // frozen at the reported coord
		expect(lastFeature(setData).properties.stale).toBe(1); // the "!" flag

		frame(40, 20_000); // even more time passes → still frozen
		expect(lastLon(setData)).toBe(W[0]);
		expect(lastFeature(setData).properties.stale).toBe(1);
		c.destroy();
	});

	it('a bus that crosses the cutoff between polls gets the "!" without a re-feed', () => {
		const { map, setData } = stubMap();
		const { runtime, serverNowFn, frame } = controlledRuntime();
		const c = createVehicleMotionController(map, runtime);

		// Fresh at first feed (5s old, well under the 150s cutoff).
		c.set(fcAt(W[0], W[1]), {
			tickKey: 't1',
			animate: true,
			fixFor: fixFor(5, 10),
			shapeFor: straightShape,
			serverNowFn,
		});
		expect(lastFeature(setData).properties.stale).toBe(0);

		// Jump the server clock past the cutoff WITHOUT a new poll → the rAF loop
		// re-stamps the per-bus stale flag off the live projection.
		frame(40, STALE_CUTOFF_S * 1000);
		expect(lastFeature(setData).properties.stale).toBe(1);
		c.destroy();
	});

	it('ease-corrects on a NEW fix: continuous from the displayed dot to the new projection', () => {
		const { map, setData } = stubMap();
		const { runtime, serverNowFn, frame } = controlledRuntime();
		const c = createVehicleMotionController(map, runtime);

		// Poll 1: bus at W. Let it project forward a little.
		c.set(fcAt(W[0], W[1]), {
			tickKey: 't1',
			animate: true,
			fixFor: fixFor(5, 10),
			shapeFor: straightShape,
			serverNowFn,
		});
		frame(40, 5_000);
		const displayedBeforeJump = lastLon(setData);

		// Poll 2: a NEW fix that has the bus much further EAST (a correction). The
		// re-feed must NOT snap there — the first rendered lon stays near where the
		// dot was, then eases toward the new projection over the blend window.
		c.set(fcAt(-73.55, 45.5), {
			tickKey: 't2',
			animate: true,
			fixFor: fixFor(2, 10),
			shapeFor: straightShape,
			serverNowFn,
		});
		const justAfterRefeed = lastLon(setData);
		// The blend ORIGIN is the prior displayed dot, so the first frame after the
		// new fix is close to it — not jumped onto the far new projection.
		expect(justAfterRefeed).toBeCloseTo(displayedBeforeJump, 3);

		// Step through the blend window: the dot eases EAST toward the new projection,
		// monotonically (no rubber-band back-and-forth).
		frame(450, 450);
		const mid = lastLon(setData);
		frame(450, 450);
		const end = lastLon(setData);
		expect(mid).toBeGreaterThan(justAfterRefeed);
		expect(end).toBeGreaterThan(mid);
		c.destroy();
	});

	it('same tickKey re-feed (filter/hover) does not restart an in-flight blend', () => {
		const { map, setData } = stubMap();
		const { runtime, serverNowFn, frame } = controlledRuntime();
		const c = createVehicleMotionController(map, runtime);

		c.set(fcAt(W[0], W[1]), {
			tickKey: 't1',
			animate: true,
			fixFor: fixFor(5, 10),
			shapeFor: straightShape,
			serverNowFn,
		});
		frame(40, 5_000);
		const before = lastLon(setData);
		// New fix → blend begins.
		c.set(fcAt(-73.55, 45.5), {
			tickKey: 't2',
			animate: true,
			fixFor: fixFor(2, 10),
			shapeFor: straightShape,
			serverNowFn,
		});
		const afterNew = lastLon(setData);
		expect(afterNew).toBeCloseTo(before, 3); // eased from the displayed dot

		// Same tickKey re-feed midway (e.g. a hover): blend continues, no reset to the
		// origin. The re-feed renders at the blend's current point, further east.
		frame(450, 0);
		const midBlend = lastLon(setData);
		c.set(fcAt(-73.55, 45.5, 0, '40061'), {
			tickKey: 't2',
			animate: true,
			fixFor: fixFor(2, 10),
			shapeFor: straightShape,
			serverNowFn,
		});
		const afterSameTick = lastLon(setData);
		// Continues forward from the blend (>= the mid-blend point), not reset west.
		expect(afterSameTick).toBeGreaterThanOrEqual(midBlend - 1e-6);
		c.destroy();
	});

	it('throttles the rAF loop to ~30fps but never drops the re-feed frame', () => {
		const { map, setData } = stubMap();
		const { runtime, serverNowFn, frame } = controlledRuntime();
		const c = createVehicleMotionController(map, runtime);

		c.set(fcAt(W[0], W[1]), {
			tickKey: 't1',
			animate: true,
			fixFor: fixFor(5, 10),
			shapeFor: straightShape,
			serverNowFn,
		});
		expect(setData).toHaveBeenCalledTimes(1); // the re-feed renders unthrottled
		setData.mockClear();

		// Two sub-33ms frames coalesce; the loop keeps rescheduling but only the one
		// past the gate pushes setData.
		frame(16, 1000);
		frame(16, 1000);
		expect(setData).toHaveBeenCalledTimes(0); // both inside the ~33ms gate
		frame(40, 1000);
		expect(setData).toHaveBeenCalledTimes(1); // cleared the gate
		c.destroy();
	});

	it('destroy() stops the rAF loop (no further frames scheduled)', () => {
		const { map } = stubMap();
		const { runtime, serverNowFn, hasPending } = controlledRuntime();
		const c = createVehicleMotionController(map, runtime);
		c.set(fcAt(W[0], W[1]), {
			tickKey: 't1',
			animate: true,
			fixFor: fixFor(5, 10),
			shapeFor: straightShape,
			serverNowFn,
		});
		expect(hasPending()).toBe(true);
		c.destroy();
		expect(hasPending()).toBe(false);
	});

	it('projected position lands on the shape (arc-length matches the model)', () => {
		const { map, setData } = stubMap();
		const { runtime, serverNowFn } = controlledRuntime();
		const c = createVehicleMotionController(map, runtime);
		c.set(fcAt(W[0], W[1]), {
			tickKey: 't1',
			animate: true,
			fixFor: fixFor(5, 10),
			shapeFor: straightShape,
			serverNowFn,
		});
		const out = lastFeature(setData).geometry.coordinates as Coord;
		// Projecting the displayed point back onto the shape gives a positive arc.
		const lengths = cumulativeLengths(STRAIGHT);
		const back = projectToPolyline(STRAIGHT, out, lengths)!;
		expect(back.s).toBeGreaterThan(0);
		expect(back.distance).toBeLessThan(1); // sits ON the shape
		c.destroy();
	});
});
