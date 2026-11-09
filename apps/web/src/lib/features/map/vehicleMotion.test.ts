import { describe, it, expect, vi } from 'vitest';
import { createVehicleMotion, notReporting, type MotionIntent } from './vehicleMotion';
import { createVehicleMotionController } from '#lib/components/map/motion/controller.ts';
import type { MotionRuntime } from '#lib/components/map/motion/runtime.ts';
import type { VehicleFC } from '#lib/components/map/vehicleLayer.ts';
import { VehicleSchema, VehiclesFileSchema, RouteFileSchema } from '#lib/v1/schemas/index.ts';
import { emptyFilterState } from '#lib/filters/index.ts';

const EPOCH = Date.parse('2026-06-21T12:00:00Z');
const vehicle = (age = 10, lon = -73.59) =>
	VehicleSchema.parse({
		id: 'bus',
		route: '24',
		lat: 45.5,
		lon,
		bearing: 90,
		speed_kmh: 36,
		status: 'on_time',
		reported_utc: new Date(EPOCH - age * 1000).toISOString(),
		updated_utc: new Date(EPOCH).toISOString(),
	});
const route = RouteFileSchema.parse({
	generated_utc: '2026-06-21T00:00:00Z',
	id: '24',
	long: 'Test',
	directions: [
		{
			dir: 0,
			shape: {
				type: 'LineString',
				coordinates: [
					[-73.6, 45.5],
					[-73.58, 45.5],
				],
			},
		},
	],
});
const intent: MotionIntent = {
	preference: 'smooth',
	reducedMotion: false,
	ready: true,
	stale: false,
};
function harness() {
	let now = 0;
	let server = EPOCH;
	let pending: (() => void) | undefined;
	const runtime: MotionRuntime = {
		now: () => now,
		requestFrame: (cb) => {
			pending = cb;
			return 1;
		},
		cancelFrame: () => {
			pending = undefined;
		},
	};
	const frames: VehicleFC[] = [];
	const controller = createVehicleMotionController(runtime, (frame) => frames.push(frame));
	const getRoute = vi.fn(async () => route);
	const motion = createVehicleMotion(getRoute, { now: () => server, continuous: () => server });
	const filter = emptyFilterState();
	function feed(age = 10, options = intent, lon = -73.59, tick = '2026-06-21T12:00:00Z') {
		const snapshot = VehiclesFileSchema.parse({
			generated_utc: tick,
			vehicles: [vehicle(age, lon)],
		});
		motion.read(snapshot, options).draw(controller, filter, new Set(), null);
	}
	return {
		motion,
		getRoute,
		feed,
		controller,
		last: () => frames.at(-1)!.features[0],
		pending: () => pending != null,
		frame(ms: number) {
			now += ms;
			server += ms;
			const cb = pending;
			pending = undefined;
			cb?.();
		},
	};
}

describe('vehicle motion snapshot interface', () => {
	for (const preference of ['raw', 'smooth'] as const) {
		for (const reducedMotion of [false, true])
			for (const ready of [false, true]) {
				it(`preference=${preference}, reduced motion=${reducedMotion}, ready=${ready}`, () => {
					const h = harness();
					h.feed(10, { ...intent, preference, reducedMotion, ready });
					expect(h.pending()).toBe(preference === 'smooth' && !reducedMotion && ready);
					h.controller.destroy();
				});
			}
	}
	it.each([149, 150, 151])(
		'shares Not reporting at %i seconds across frames and details',
		(age) => {
			const h = harness();
			h.feed(age);
			expect(h.last().properties.stale).toBe(age >= 150 ? 1 : 0);
			expect(notReporting(vehicle(age), EPOCH)).toEqual(age >= 150 ? { ageS: age } : null);
			h.controller.destroy();
		},
	);
	it('prefetches shapes for Estimated position even before readiness and with reduced motion', async () => {
		const h = harness();
		h.feed(10, { ...intent, preference: 'raw' });
		expect(h.getRoute).not.toHaveBeenCalled();
		h.feed(10, { ...intent, ready: false, reducedMotion: true });
		await Promise.resolve();
		h.feed();
		expect(h.getRoute).toHaveBeenCalledExactlyOnceWith('24');
		h.controller.destroy();
	});
	it('uses a prefetched shape and converts speed, then snaps when the snapshot becomes stale', async () => {
		const h = harness();
		h.feed();
		await Promise.resolve();
		h.frame(1000);
		const projected = h.last().geometry.coordinates[0];
		expect(projected).toBeGreaterThan(-73.59);
		// 10 m/s, age 11 s, unchanged 50 s deceleration horizon.
		const meters = 10 * (11 - 121 / 100);
		expect(projected).toBeCloseTo(-73.59 + meters / (111320 * Math.cos((45.5 * Math.PI) / 180)), 5);
		h.feed(10, { ...intent, stale: true });
		expect(h.last().geometry.coordinates).toEqual([-73.59, 45.5]);
		expect(h.pending()).toBe(false);
	});
	it('blends a new report from the displayed position over 900 ms', async () => {
		const h = harness();
		h.motion.remember(route);
		h.feed();
		h.frame(1000);
		const origin = h.last().geometry.coordinates[0];
		h.feed(0, intent, -73.588, '2026-06-21T12:00:01Z');
		expect(h.last().geometry.coordinates[0]).toBe(origin);
		h.frame(450);
		expect(h.last().geometry.coordinates[0]).toBeGreaterThan(origin);
		expect(h.last().geometry.coordinates[0]).toBeLessThan(-73.588);
		h.frame(450);
		expect(h.last().geometry.coordinates[0]).toBeGreaterThan(-73.588);
		h.controller.destroy();
	});
});
