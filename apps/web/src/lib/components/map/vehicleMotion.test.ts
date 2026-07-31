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
const N = [-73.7, 45.7] as Coord;
const NORTHBOUND: Coord[] = [W, N];

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
					matched: 1,
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
	const setFeatureState = vi.fn();
	const removeFeatureState = vi.fn();
	const map = {
		getSource: (id: string) => (id === VEHICLE_SOURCE ? { setData } : undefined),
		setFeatureState,
		removeFeatureState,
	} as unknown as MapLibreMap;
	return { map, setData, setFeatureState, removeFeatureState };
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

	it('uses supplied per-fix invariants for projection and blending without resolving again', () => {
		const entry = {
			feature: feature(W[0], W[1], 17),
			fix: { reportedUtc: 'invalid', updatedUtc: 'invalid', speedMps: 10 },
		};
		const lengths = cumulativeLengths(STRAIGHT);
		const start = projectToPolyline(STRAIGHT, W, lengths);
		if (!start) throw new Error('straight fixture must project');
		const shapeFor = vi.fn<ShapeResolver>(() => NORTHBOUND);
		const invariants = {
			fixEpochMs: NOW_MS - 5_000,
			shape: STRAIGHT,
			lengths,
			s0: start.s,
		};

		const target = projectEntry(entry, NOW_MS, 0, shapeFor, undefined, invariants);
		expect(shapeFor).not.toHaveBeenCalled();
		expect(target.result).toMatchObject({ frozen: false, stale: false });
		expect(target.feature.geometry.coordinates[0]).toBeGreaterThan(W[0]);
		expect(target.feature.geometry.coordinates[1]).toBeCloseTo(W[1], 5);
		expect(target.feature.properties).toMatchObject({ bearing: 90, stale: 0 });

		const origin = -73.71;
		const blended = projectEntry(
			entry,
			NOW_MS,
			1450,
			shapeFor,
			{ fromCoord: [origin, W[1]], fromBearing: 0, startMs: 1000 },
			invariants,
		).feature;
		expect(blended.geometry.coordinates[0]).toBeGreaterThan(origin);
		expect(blended.geometry.coordinates[0]).toBeLessThan(target.feature.geometry.coordinates[0]);
		expect(blended.properties.bearing).toBeGreaterThan(0);
		expect(blended.properties.bearing).toBeLessThan(90);
		expect(shapeFor).not.toHaveBeenCalled();
	});

	it('uses the supplied invariant epoch to freeze and flag a stale fix', () => {
		const entry = {
			feature: feature(W[0], W[1], 200),
			fix: { reportedUtc: isoAgo(1), updatedUtc: isoAgo(1), speedMps: 10 },
		};
		const lengths = cumulativeLengths(STRAIGHT);
		const start = projectToPolyline(STRAIGHT, W, lengths);
		if (!start) throw new Error('straight fixture must project');

		const { feature: out, result } = projectEntry(entry, NOW_MS, 0, undefined, undefined, {
			fixEpochMs: NOW_MS - STALE_CUTOFF_S * 1000,
			shape: STRAIGHT,
			lengths,
			s0: start.s,
		});
		expect(result).toMatchObject({ frozen: true, stale: true });
		expect(out.geometry.coordinates).toEqual([W[0], W[1]]);
		expect(out.properties).toMatchObject({ bearing: 200, stale: 1 });
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

	it('skips an identical throttled frame after still evaluating the stationary bus', () => {
		const { map, setData } = stubMap();
		const { runtime, serverNowFn, frame } = controlledRuntime();
		const shapeFor = vi.fn(() => null);
		const c = createVehicleMotionController(map, runtime);
		c.set(fcAt(W[0], W[1], 33), {
			tickKey: 't1',
			animate: true,
			fixFor: fixFor(5, 0),
			shapeFor,
			serverNowFn,
		});
		setData.mockClear();
		shapeFor.mockClear();

		frame(40, 0);

		expect(shapeFor).toHaveBeenCalledTimes(1);
		expect(setData).not.toHaveBeenCalled();
		c.destroy();
	});

	it('uploads a stale-only change even when coordinate and bearing stay fixed', () => {
		const { map, setData } = stubMap();
		const { runtime, serverNowFn, frame } = controlledRuntime();
		const c = createVehicleMotionController(map, runtime);
		c.set(fcAt(W[0], W[1], 33), {
			tickKey: 't1',
			animate: true,
			fixFor: fixFor(STALE_CUTOFF_S - 0.01, 0),
			shapeFor: noShape,
			serverNowFn,
		});
		const before = lastFeature(setData);
		expect(before.properties.stale).toBe(0);
		setData.mockClear();

		frame(40, 20);

		expect(setData).toHaveBeenCalledTimes(1);
		const after = lastFeature(setData);
		expect(after.geometry.coordinates).toEqual(before.geometry.coordinates);
		expect(after.properties.bearing).toBe(before.properties.bearing);
		expect(after.properties.stale).toBe(1);
		c.destroy();
	});

	it('uploads a bearing-only late-shape upgrade at the same coordinate', () => {
		const { map, setData } = stubMap();
		const { runtime, serverNowFn, frame } = controlledRuntime();
		const shapeFor = vi.fn<ShapeResolver>().mockReturnValueOnce(null).mockReturnValue(STRAIGHT);
		const c = createVehicleMotionController(map, runtime);
		c.set(fcAt(W[0], W[1], 0), {
			tickKey: 't1',
			animate: true,
			fixFor: fixFor(0, 10),
			shapeFor,
			serverNowFn,
		});
		const before = lastFeature(setData);
		expect(before.properties.bearing).toBe(0);
		setData.mockClear();

		frame(40, 0);

		expect(setData).toHaveBeenCalledTimes(1);
		const after = lastFeature(setData);
		expect(after.geometry.coordinates).toEqual(before.geometry.coordinates);
		expect(after.properties.bearing).toBe(90);
		expect(after.properties.stale).toBe(before.properties.stale);
		c.destroy();
	});

	it('keeps evaluation cadence near 30fps when every stationary upload is skipped', () => {
		const { map } = stubMap();
		const controlled = controlledRuntime();
		const serverNowFn = vi.fn(controlled.serverNowFn);
		const c = createVehicleMotionController(map, controlled.runtime);
		c.set(fcAt(W[0], W[1]), {
			tickKey: 't1',
			animate: true,
			fixFor: fixFor(5, 0),
			shapeFor: noShape,
			serverNowFn,
		});
		serverNowFn.mockClear();

		for (let frame = 0; frame < 60; frame += 1) controlled.frame(1_000 / 60, 0);

		expect(serverNowFn.mock.calls.length).toBeGreaterThanOrEqual(29);
		expect(serverNowFn.mock.calls.length).toBeLessThanOrEqual(30);
		c.destroy();
	});

	it('resolves projection invariants once per vehicle per non-null tick', () => {
		const { map } = stubMap();
		const { runtime, serverNowFn, frame } = controlledRuntime();
		const shapeFor = vi.fn<ShapeResolver>(() => STRAIGHT);
		const c = createVehicleMotionController(map, runtime);
		const feed = fcAt(W[0], W[1]);
		const options = {
			tickKey: 't1',
			animate: true,
			fixFor: fixFor(5, 10),
			shapeFor,
			serverNowFn,
		};
		c.set(feed, options);
		frame(40, 0);
		frame(40, 0);
		frame(40, 0);
		c.set(feed, options);

		expect(shapeFor).toHaveBeenCalledTimes(1);

		c.set(feed, { ...options, tickKey: 't2' });
		expect(shapeFor).toHaveBeenCalledTimes(2);
		c.destroy();
	});

	it('parses a resolved fix epoch once per tick', () => {
		const { map } = stubMap();
		const { runtime, serverNowFn, frame } = controlledRuntime();
		const resolvedFix = fixFor(5, 10);
		const parse = vi.spyOn(Date, 'parse');
		const c = createVehicleMotionController(map, runtime);
		try {
			c.set(fcAt(W[0], W[1]), {
				tickKey: 't1',
				animate: true,
				fixFor: resolvedFix,
				shapeFor: straightShape,
				serverNowFn,
			});
			frame(40, 0);
			frame(40, 0);
			frame(40, 0);

			expect(parse).toHaveBeenCalledTimes(1);
		} finally {
			c.destroy();
			parse.mockRestore();
		}
	});

	it('pins the resolved shape identity for one tick and refreshes it on the next tick', () => {
		const { map, setData } = stubMap();
		const { runtime, serverNowFn, frame } = controlledRuntime();
		const shapeFor = vi
			.fn<ShapeResolver>()
			.mockReturnValueOnce(STRAIGHT)
			.mockReturnValue(NORTHBOUND);
		const c = createVehicleMotionController(map, runtime);
		const feed = fcAt(W[0], W[1], 17);
		const options = {
			tickKey: 't1',
			animate: true,
			fixFor: fixFor(0, 10),
			shapeFor,
			serverNowFn,
		};
		c.set(feed, options);
		expect(lastFeature(setData).properties.bearing).toBe(90);

		frame(40, 0);
		expect(shapeFor).toHaveBeenCalledTimes(1);
		expect(lastFeature(setData).properties.bearing).toBe(90);

		c.set(feed, { ...options, tickKey: 't2' });
		expect(shapeFor).toHaveBeenCalledTimes(2);
		frame(900, 0);
		expect(lastFeature(setData).properties.bearing).toBe(0);
		c.destroy();
	});

	it('retries an unresolved shape and upgrades the bus on the next frame', () => {
		const { map, setData } = stubMap();
		const { runtime, serverNowFn, frame } = controlledRuntime();
		const shapeFor = vi.fn<ShapeResolver>().mockReturnValueOnce(null).mockReturnValue(STRAIGHT);
		const c = createVehicleMotionController(map, runtime);
		c.set(fcAt(W[0], W[1]), {
			tickKey: 't1',
			animate: true,
			fixFor: fixFor(5, 10),
			shapeFor,
			serverNowFn,
		});
		expect(lastLon(setData)).toBe(W[0]);

		frame(40, 0);

		expect(shapeFor).toHaveBeenCalledTimes(2);
		expect(lastLon(setData)).toBeGreaterThan(W[0]);
		c.destroy();
	});

	it('does not cache projection invariants without a tick key', () => {
		const { map } = stubMap();
		const { runtime, serverNowFn, frame } = controlledRuntime();
		const shapeFor = vi.fn<ShapeResolver>(() => STRAIGHT);
		const c = createVehicleMotionController(map, runtime);
		c.set(fcAt(W[0], W[1]), {
			tickKey: null,
			animate: true,
			fixFor: fixFor(5, 10),
			shapeFor,
			serverNowFn,
		});
		frame(40, 0);
		frame(40, 0);

		expect(shapeFor).toHaveBeenCalledTimes(3);
		c.destroy();
	});

	it('drops a departed mid-blend origin before the vehicle returns on a later tick', () => {
		const { map, setData } = stubMap();
		const { runtime, serverNowFn, frame } = controlledRuntime();
		const c = createVehicleMotionController(map, runtime);
		const options = {
			animate: true,
			fixFor: fixFor(0, 0),
			shapeFor: noShape,
			serverNowFn,
		};
		c.set(fcAt(W[0], W[1]), { ...options, tickKey: 't1' });
		c.set(fcAt(-73.55, W[1]), { ...options, tickKey: 't2' });
		frame(450, 0);
		const staleOrigin = lastLon(setData);
		expect(staleOrigin).toBeGreaterThan(W[0]);
		expect(staleOrigin).toBeLessThan(-73.55);

		c.set({ type: 'FeatureCollection', features: [] }, { ...options, tickKey: 't3' });
		c.set(fcAt(-73.5, W[1]), { ...options, tickKey: 't4' });

		expect(lastLon(setData)).toBe(-73.5);
		expect(lastLon(setData)).not.toBe(staleOrigin);
		c.destroy();
	});

	it('retains the invariant and in-flight blend through a same-tick filter round trip', () => {
		const { map, setData } = stubMap();
		const { runtime, serverNowFn, frame } = controlledRuntime();
		const shapeFor = vi.fn<ShapeResolver>(() => STRAIGHT);
		const c = createVehicleMotionController(map, runtime);
		const options = {
			animate: true,
			fixFor: fixFor(0, 10),
			shapeFor,
			serverNowFn,
		};
		c.set(fcAt(W[0], W[1]), { ...options, tickKey: 't1' });
		const corrected = fcAt(-73.55, W[1]);
		c.set(corrected, { ...options, tickKey: 't2' });
		frame(450, 0);
		const midBlend = lastLon(setData);
		expect(shapeFor).toHaveBeenCalledTimes(2);

		c.set({ type: 'FeatureCollection', features: [] }, { ...options, tickKey: 't2' });
		c.set(corrected, { ...options, tickKey: 't2' });

		expect(shapeFor).toHaveBeenCalledTimes(2);
		expect(lastLon(setData)).toBeCloseTo(midBlend, 6);
		c.destroy();
	});

	it('never mutates emphasis feature state when a selected vehicle departs', () => {
		const { map, setFeatureState, removeFeatureState } = stubMap();
		const { runtime, serverNowFn } = controlledRuntime();
		const c = createVehicleMotionController(map, runtime);
		const selected = fcAt(W[0], W[1]);
		selected.features[0].properties.selected = 1;
		const options = {
			animate: true,
			fixFor: fixFor(0, 0),
			shapeFor: noShape,
			serverNowFn,
		};
		c.set(selected, { ...options, tickKey: 't1' });
		setFeatureState.mockClear();
		removeFeatureState.mockClear();

		c.set({ type: 'FeatureCollection', features: [] }, { ...options, tickKey: 't2' });

		expect(setFeatureState).not.toHaveBeenCalled();
		expect(removeFeatureState).not.toHaveBeenCalled();
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
