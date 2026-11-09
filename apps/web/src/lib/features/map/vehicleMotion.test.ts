import { describe, it, expect, vi } from 'vitest';
import { createVehicleMotion, notReporting, type MotionIntent } from './vehicleMotion';
import { createVehicleMotionController } from '#lib/components/map/motion/controller.ts';
import type { MotionRuntime } from '#lib/components/map/motion/runtime.ts';
import type { VehicleFC } from '#lib/components/map/vehicleLayer.ts';
import type { Vehicle } from '#lib/v1/schemas/index.ts';
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
	let timer: (() => void) | undefined;
	let timerAt = Infinity;
	const runtime: MotionRuntime = {
		now: () => now,
		setTimer: (cb, ms) => {
			timer = cb;
			timerAt = now + ms;
			return 1;
		},
		clearTimer: () => {
			timer = undefined;
			timerAt = Infinity;
		},
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
	function feed(
		age = 10,
		options = intent,
		lon = -73.59,
		tick = '2026-06-21T12:00:00Z',
		overrides: Partial<Vehicle> = {},
	) {
		const snapshot = VehiclesFileSchema.parse({
			generated_utc: tick,
			vehicles: [{ ...vehicle(age, lon), ...overrides }],
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
			if (now >= timerAt) {
				const t = timer;
				timer = undefined;
				timerAt = Infinity;
				t?.();
			}
		},
	};
}

describe('vehicle motion snapshot interface', () => {
	it('moves at constant speed through the TTL horizon, then idles and restarts on a report', () => {
		const h = harness();
		h.motion.remember(route);
		h.feed(30, { ...intent, ttlS: 20 });
		const start = h.last().geometry.coordinates[0];
		h.frame(10000);
		expect(h.last().geometry.coordinates[0] - start).toBeCloseTo(
			100 / (111320 * Math.cos((45.5 * Math.PI) / 180)),
			5,
		);
		h.frame(30000);
		const held = h.last().geometry.coordinates;
		expect(h.pending()).toBe(false);
		h.frame(10000);
		expect(h.last().geometry.coordinates).toEqual(held);
		h.feed(0, intent, -73.58, 'new');
		expect(h.pending()).toBe(true);
		h.controller.destroy();
	});
	it('caps a large TTL at the Not reporting cutoff and freezes at 150 seconds', () => {
		const h = harness();
		h.motion.remember(route);
		h.feed(149, { ...intent, ttlS: 100 });
		const held = h.last().geometry.coordinates;
		h.frame(1000);
		expect(h.last().geometry.coordinates).toEqual(held);
		expect(h.last().properties.stale).toBe(1);
		expect(h.pending()).toBe(false);
		h.controller.destroy();
	});
	it('clamps at the known next stop, and holds with null speed', () => {
		const h = harness();
		h.motion.remember(route);
		h.feed(60, { ...intent, stops: [{ id: 'next', lon: -73.589, lat: 45.5 }] }, -73.59, 'a', {
			next_stop: 'next',
		});
		expect(h.last().geometry.coordinates[0]).toBeCloseTo(-73.589, 6);
		expect(h.pending()).toBe(false);
		h.feed(10, intent, -73.59, 'b', { speed_kmh: null });
		h.frame(2000);
		expect(h.last().geometry.coordinates[0]).toBe(-73.589);
		expect(h.pending()).toBe(false);
		h.controller.destroy();
	});
	it('selects the bearing-compatible shape on an overlapping two-way street', () => {
		const h = harness();
		h.motion.remember(
			RouteFileSchema.parse({
				...route,
				directions: [
					...(route.directions ?? []),
					{
						dir: 1,
						shape: {
							type: 'LineString',
							coordinates: [
								[-73.58, 45.5],
								[-73.6, 45.5],
							],
						},
					},
				],
			}),
		);
		h.feed(10, intent, -73.59, 'a', { bearing: 270 });
		expect(h.last().geometry.coordinates[0]).toBeLessThan(-73.59);
		h.controller.destroy();
	});
	it('holds a nearby backwards correction until its estimate catches up', () => {
		const h = harness();
		h.motion.remember(route);
		h.feed(10);
		const held = h.last().geometry.coordinates[0];
		h.feed(0, intent, -73.59, 'b');
		h.frame(1500);
		expect(h.last().geometry.coordinates[0]).toBe(held);
		h.feed(0, intent, -73.59, 'b');
		h.frame(9000);
		expect(h.last().geometry.coordinates[0]).toBeGreaterThan(held);
		h.controller.destroy();
	});
	it('jumps for a correction beyond 300 m', () => {
		const h = harness();
		h.motion.remember(route);
		h.feed(10);
		h.feed(0, intent, -73.581, 'b');
		expect(h.last().geometry.coordinates[0]).toBeCloseTo(-73.581, 6);
		h.controller.destroy();
	});
	it('jumps when a new report uses a different shape even within 300 m', () => {
		const h = harness();
		h.motion.remember(route);
		h.feed(10);
		h.motion.remember(
			RouteFileSchema.parse({
				...route,
				generated_utc: '2026-06-22T00:00:00Z',
				directions: [
					{
						dir: 1,
						shape: {
							type: 'LineString',
							coordinates: [
								[-73.58, 45.5],
								[-73.6, 45.5],
							],
						},
					},
				],
			}),
		);
		h.feed(0, intent, -73.59, 'b', { bearing: 270 });
		expect(h.last().geometry.coordinates[0]).toBe(-73.59);
		h.controller.destroy();
	});
	it('eases when Estimated is enabled on the same snapshot', () => {
		const h = harness();
		h.motion.remember(route);
		h.feed(60, { ...intent, preference: 'raw' });
		h.feed(60);
		expect(h.last().geometry.coordinates[0]).toBe(-73.59);
		h.frame(750);
		const mid = h.last().geometry.coordinates[0];
		expect(mid).toBeGreaterThan(-73.59);
		h.frame(750);
		expect(h.last().geometry.coordinates[0]).toBeGreaterThan(mid);
		h.controller.destroy();
	});
	it('holds without a shape and eases when the pending shape arrives', async () => {
		const h = harness();
		h.feed(10);
		expect(h.last().geometry.coordinates[0]).toBe(-73.59);
		expect(h.pending()).toBe(false);
		await Promise.resolve();
		expect(h.last().geometry.coordinates[0]).toBe(-73.59);
		expect(h.pending()).toBe(true);
		h.frame(750);
		expect(h.last().geometry.coordinates[0]).toBeGreaterThan(-73.59);
		h.controller.destroy();
	});
	for (const preference of ['raw', 'smooth'] as const) {
		for (const reducedMotion of [false, true])
			for (const ready of [false, true]) {
				it(`preference=${preference}, reduced motion=${reducedMotion}, ready=${ready}`, () => {
					const h = harness();
					h.motion.remember(route);
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
		h.frame(1500);
		const projected = h.last().geometry.coordinates[0];
		expect(projected).toBeGreaterThan(-73.59);
		// 10 m/s, age 11 s, constant speed within the publication horizon.
		const meters = 115;
		expect(projected).toBeCloseTo(-73.59 + meters / (111320 * Math.cos((45.5 * Math.PI) / 180)), 5);
		h.feed(10, { ...intent, stale: true });
		expect(h.last().geometry.coordinates).toEqual([-73.59, 45.5]);
		expect(h.pending()).toBe(false);
	});
	it('blends a new report from the displayed position over 1500 ms', async () => {
		const h = harness();
		h.motion.remember(route);
		h.feed();
		h.frame(1000);
		const origin = h.last().geometry.coordinates[0];
		h.feed(0, intent, -73.588, '2026-06-21T12:00:01Z');
		expect(h.last().geometry.coordinates[0]).toBe(origin);
		h.frame(750);
		expect(h.last().geometry.coordinates[0]).toBeGreaterThan(origin);
		expect(h.last().geometry.coordinates[0]).toBeLessThan(
			-73.588 + 17.5 / (111320 * Math.cos((45.5 * Math.PI) / 180)),
		);
		h.frame(750);
		expect(h.last().geometry.coordinates[0]).toBeGreaterThan(-73.588);
		h.controller.destroy();
	});
});
