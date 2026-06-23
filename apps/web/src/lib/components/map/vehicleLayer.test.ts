import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it } from 'vitest';
import type { FilterState } from '$lib/filters';
import { VehicleSchema } from '$lib/v1/schemas';
import {
	addVehicleLayers,
	ICON_SIZE_Z11_DEFAULT,
	ICON_SIZE_Z11_HOVER,
	SILENT_BADGE_SCALE,
	SILENT_ICON_SIZE_Z11,
	SILENT_ICON_SIZE_Z15,
	VEHICLE_BODY_LAYER,
	VEHICLE_HEADING_LAYER,
	VEHICLE_SILENT_LAYER,
	VEHICLE_SOURCE,
	toVehicleFeatures,
} from './vehicleLayer';
import { HEADING_ICON, SILENT_ICON } from './vehicleSprites';
import { STALE_CUTOFF_S } from './vehicleProjection';

function usesTopLevelZoomExpression(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		(value[0] === 'interpolate' || value[0] === 'step') &&
		Array.isArray(value[2]) &&
		value[2][0] === 'zoom'
	);
}

const EMPTY_FILTER: FilterState = {
	routes: new Set(),
	stops: new Set(),
	trips: new Set(),
	vehicles: new Set(),
};

const vehicles = [
	{
		id: 'directional',
		lat: 45.5,
		lon: -73.6,
		status: 'on_time',
		updated_utc: '2026-06-15T00:00:00Z',
		bearing: 90,
	},
	{
		id: 'no-direction',
		lat: 45.51,
		lon: -73.61,
		status: 'late',
		updated_utc: '2026-06-15T00:00:00Z',
		bearing: null,
	},
].map((vehicle) => VehicleSchema.parse(vehicle));

describe('toVehicleFeatures entity filtering', () => {
	it('uses a MapLibre-valid top-level zoom expression for selected and hovered bus size', () => {
		const layers: LayerSpecification[] = [];
		const map = {
			getLayer: () => undefined,
			addLayer: (nextLayer: LayerSpecification) => {
				layers.push(nextLayer);
			},
		} as unknown as MapLibreMap;

		addVehicleLayers(map);

		const layer = layers[0];
		expect(layer).toMatchObject({
			id: VEHICLE_BODY_LAYER,
			type: 'symbol',
			source: VEHICLE_SOURCE,
		});
		const layout = (layer.layout ?? {}) as Record<string, unknown>;
		expect(usesTopLevelZoomExpression(layout['icon-size'])).toBe(true);
		expect(JSON.stringify(layout['icon-size'])).toContain('selected');
		expect(JSON.stringify(layout['icon-size'])).toContain('hovered');
		// The bus glyph is UPRIGHT (legible at every bearing) — heading is the
		// separate chevron layer, so the body itself never rotates.
		expect(layout['icon-rotate']).toBeUndefined();
		expect(layout['icon-rotation-alignment']).toBe('viewport');
	});

	it('renders heading as a SEPARATE rotated chevron layer that only shows for vehicles with a bearing', () => {
		const layers: LayerSpecification[] = [];
		const map = {
			getLayer: () => undefined,
			addLayer: (nextLayer: LayerSpecification) => {
				layers.push(nextLayer);
			},
		} as unknown as MapLibreMap;

		addVehicleLayers(map);

		const heading = layers.find((l) => l.id === VEHICLE_HEADING_LAYER);
		expect(heading).toBeDefined();
		if (!heading) throw new Error('expected heading layer');
		expect(heading).toMatchObject({ type: 'symbol', source: VEHICLE_SOURCE });
		const rendered = heading as LayerSpecification & {
			layout: Record<string, unknown>;
			filter: unknown;
		};
		const layout = (rendered.layout ?? {}) as Record<string, unknown>;
		// ONE neutral chevron sprite; rotated by bearing, aligned to the map.
		expect(layout['icon-image']).toBe(HEADING_ICON);
		expect(JSON.stringify(layout['icon-rotate'])).toContain('bearing');
		expect(layout['icon-rotation-alignment']).toBe('map');
		// Shows only matched buses that actually report a heading (no fake arrows).
		expect(JSON.stringify(rendered.filter)).toContain('matched');
		expect(JSON.stringify(rendered.filter)).toContain('hasHeading');
		// Drawn ABOVE the upright body so the tick is never occluded.
		const bodyIndex = layers.findIndex((l) => l.id === VEHICLE_BODY_LAYER);
		const headingIndex = layers.findIndex((l) => l.id === VEHICLE_HEADING_LAYER);
		expect(headingIndex).toBeGreaterThan(bodyIndex);
	});

	it('branches icon-opacity on hover/selected on both vehicle layers (S5: fix hover-only)', () => {
		const layers: LayerSpecification[] = [];
		const map = {
			getLayer: () => undefined,
			addLayer: (nextLayer: LayerSpecification) => {
				layers.push(nextLayer);
			},
		} as unknown as MapLibreMap;

		addVehicleLayers(map);

		for (const id of [VEHICLE_BODY_LAYER, VEHICLE_HEADING_LAYER]) {
			const paint = (layers.find((l) => l.id === id)?.paint ?? {}) as Record<string, unknown>;
			const opacity = JSON.stringify(paint['icon-opacity']);
			expect(opacity).toContain('hovered');
			expect(opacity).toContain('selected');
			// The default leg reads the `opacity` prop (constant 1 now the fade is gone)
			// times the global stale-dim — not a static literal.
			expect(opacity).toContain('opacity');
		}
	});

	it('rests buses at a solid base size; hover is a modest accent (S5: solid by default)', () => {
		// The "only solid on hover" cause was a small base size jumping ~1.9× on hover.
		expect(ICON_SIZE_Z11_DEFAULT).toBeGreaterThanOrEqual(0.7);
		expect(ICON_SIZE_Z11_HOVER / ICON_SIZE_Z11_DEFAULT).toBeLessThan(1.5);
	});

	it('flags whether each bus reports a heading so the chevron layer can hide for headingless buses', () => {
		const features = toVehicleFeatures(vehicles, EMPTY_FILTER).features;

		expect(features.map((f) => [f.properties.id, f.properties.hasHeading])).toEqual([
			['directional', 1],
			['no-direction', 0],
		]);
	});

	it('marks the selected bus so the map can highlight it without filtering context', () => {
		const features = toVehicleFeatures(vehicles, EMPTY_FILTER, new Set(), 'no-direction').features;

		expect(features.map((f) => [f.properties.id, f.properties.selected])).toEqual([
			['directional', 0],
			['no-direction', 1],
		]);
	});

	it('marks the hovered bus so the map can grow it without selecting it', () => {
		const features = (
			toVehicleFeatures as (
				...args:
					| Parameters<typeof toVehicleFeatures>
					| [...Parameters<typeof toVehicleFeatures>, string]
			) => ReturnType<typeof toVehicleFeatures>
		)(vehicles, EMPTY_FILTER, new Set(), null, 'directional').features;

		expect(
			features.map((f) => [f.properties.id, f.properties.selected, f.properties.hovered]),
		).toEqual([
			['directional', 0, 1],
			['no-direction', 0, 0],
		]);
	});

	it('keeps only the selected bus when a vehicle filter is active', () => {
		const filter = { ...EMPTY_FILTER, vehicles: new Set(['no-direction']) };
		const features = toVehicleFeatures(vehicles, filter).features;

		expect(features.map((f) => [f.properties.id, f.properties.matched])).toEqual([
			['directional', 0],
			['no-direction', 1],
		]);
	});

	it('marks an exact vehicle filter as selected-sized even without an open detail panel', () => {
		const filter = { ...EMPTY_FILTER, vehicles: new Set(['no-direction']) };
		const features = toVehicleFeatures(vehicles, filter).features;

		expect(features.map((f) => [f.properties.id, f.properties.selected])).toEqual([
			['directional', 0],
			['no-direction', 1],
		]);
	});

	it('filters buses by selected stop and trip ids', () => {
		const filter = {
			...EMPTY_FILTER,
			stops: new Set(['stop-2']),
			trips: new Set(['trip-24-b']),
		};
		const withStopTrip = vehicles.map((vehicle) =>
			VehicleSchema.parse({
				...vehicle,
				next_stop: vehicle.id === 'no-direction' ? 'stop-2' : 'stop-1',
				trip: vehicle.id === 'no-direction' ? 'trip-24-b' : 'trip-24-a',
			}),
		);

		const features = toVehicleFeatures(withStopTrip, filter).features;

		expect(features.map((f) => [f.properties.id, f.properties.matched])).toEqual([
			['directional', 0],
			['no-direction', 1],
		]);
	});

	it('keeps all buses (heading or not) when the bus marker is selected', () => {
		const filter = { ...EMPTY_FILTER, entities: ['bus'] } as unknown as FilterState;
		const features = toVehicleFeatures(vehicles, filter).features;

		expect(features.map((f) => [f.properties.id, f.properties.matched])).toEqual([
			['directional', 1],
			['no-direction', 1],
		]);
	});

	it('hides all buses when only stops are selected', () => {
		const filter = { ...EMPTY_FILTER, entities: ['stop'] } as unknown as FilterState;
		const features = toVehicleFeatures(vehicles, filter).features;

		expect(features.map((f) => f.properties.matched)).toEqual([0, 0]);
	});

	it('keeps only buses with alerts when the bus alert filter is selected', () => {
		const filter = { ...EMPTY_FILTER, alerts: ['has_alert'] } as unknown as FilterState;
		const features = toVehicleFeatures(vehicles, filter, new Set(['directional'])).features;

		expect(features.map((f) => [f.properties.id, f.properties.matched])).toEqual([
			['directional', 1],
			['no-direction', 0],
		]);
	});

	it('combines alert filtering with marker filtering', () => {
		const filter = {
			...EMPTY_FILTER,
			alerts: ['has_alert'],
			entities: ['bus'],
		} as unknown as FilterState;
		const features = toVehicleFeatures(vehicles, filter, new Set(['directional'])).features;

		expect(features.map((f) => [f.properties.id, f.properties.matched])).toEqual([
			['directional', 1],
			['no-direction', 0],
		]);
	});
});

describe('toVehicleFeatures per-vehicle silence fade', () => {
	const TTL = 30;
	// A fresh bus + a long-silent bus (same shape, different report time).
	function fleet(freshUtc: string, silentUtc: string) {
		return [
			{ id: 'fresh', lat: 45.5, lon: -73.6, status: 'on_time', updated_utc: freshUtc, bearing: 90 },
			{
				id: 'silent',
				lat: 45.51,
				lon: -73.61,
				status: 'on_time',
				updated_utc: silentUtc,
				bearing: 90,
			},
		].map((v) => VehicleSchema.parse(v));
	}

	it('defaults every bus to full opacity when no silence context is supplied', () => {
		const features = toVehicleFeatures(vehicles, EMPTY_FILTER).features;
		expect(features.map((f) => f.properties.opacity)).toEqual([1, 1]);
	});

	it('carries updated_utc into the feature opacity: fresh = full, long-silent = full (solid, no fade)', () => {
		const now = Date.parse('2026-06-21T12:00:00Z');
		const fresh = '2026-06-21T12:00:00Z'; // age 0 → full
		const silent = '2026-06-21T11:55:00Z'; // age 300s — still full (the fade is gone)
		const features = toVehicleFeatures(fleet(fresh, silent), EMPTY_FILTER, new Set(), null, null, {
			serverNow: now,
			ttlS: TTL,
		}).features;
		const byId = Object.fromEntries(features.map((f) => [f.properties.id, f.properties]));
		expect(byId.fresh.opacity).toBe(1);
		// Buses are solid in normal operation — staleness is a global signal now.
		expect(byId.silent.opacity).toBe(1);
		// silenceAgeS is still carried (rounded seconds) for hover / debug.
		expect(byId.silent.silenceAgeS).toBe(300);
	});

	it('keeps a mid-window bus at full opacity (no per-vehicle fade)', () => {
		const now = Date.parse('2026-06-21T12:00:00Z');
		const midAge = 67.5; // formerly inside the fade window
		const reportedAt = new Date(now - midAge * 1000).toISOString();
		const features = toVehicleFeatures(
			fleet(reportedAt, reportedAt),
			EMPTY_FILTER,
			new Set(),
			null,
			null,
			{ serverNow: now, ttlS: TTL },
		).features;
		expect(features[0].properties.opacity).toBe(1);
	});

	it('keeps a mid-window bus at full opacity under reduced motion too', () => {
		const now = Date.parse('2026-06-21T12:00:00Z');
		const midAge = 60; // formerly inside the fade window
		const reportedAt = new Date(now - midAge * 1000).toISOString();
		const features = toVehicleFeatures(
			fleet(reportedAt, reportedAt),
			EMPTY_FILTER,
			new Set(),
			null,
			null,
			{ serverNow: now, ttlS: TTL, reduceMotion: true },
		).features;
		expect(features[0].properties.opacity).toBe(1);
	});

	it('drives a data-driven icon-opacity from the opacity property on both layers', () => {
		const layers: LayerSpecification[] = [];
		const map = {
			getLayer: () => undefined,
			addLayer: (nextLayer: LayerSpecification) => {
				layers.push(nextLayer);
			},
		} as unknown as MapLibreMap;
		addVehicleLayers(map);
		for (const id of [VEHICLE_BODY_LAYER, VEHICLE_HEADING_LAYER]) {
			const layer = layers.find((l) => l.id === id);
			expect(layer).toBeDefined();
			const paint = (layer?.paint ?? {}) as Record<string, unknown>;
			expect(JSON.stringify(paint['icon-opacity'])).toContain('opacity');
		}
	});
});

describe('toVehicleFeatures per-bus staleness flag (S5.1: off reported_utc)', () => {
	const now = Date.parse('2026-06-21T12:00:00Z');
	// Same snapshot capture time for both buses (uniform updated_utc); they differ
	// ONLY in their OWN fix time (reported_utc) — exactly the case the old global
	// silence could not distinguish but per-bus staleness must.
	const SNAPSHOT_UTC = '2026-06-21T12:00:00Z';

	function fleet(freshReported: string, staleReported: string) {
		return [
			{
				id: 'fresh',
				lat: 45.5,
				lon: -73.6,
				status: 'on_time',
				updated_utc: SNAPSHOT_UTC,
				reported_utc: freshReported,
				bearing: 90,
			},
			{
				id: 'stale',
				lat: 45.51,
				lon: -73.61,
				status: 'on_time',
				updated_utc: SNAPSHOT_UTC,
				reported_utc: staleReported,
				bearing: 90,
			},
		].map((v) => VehicleSchema.parse(v));
	}

	it('flags a bus whose OWN reported_utc is past the cutoff as stale:1, a fresh one stale:0', () => {
		const fresh = new Date(now - 5 * 1000).toISOString(); // 5s old → fresh
		const stale = new Date(now - (STALE_CUTOFF_S + 30) * 1000).toISOString(); // well past cutoff
		const features = toVehicleFeatures(fleet(fresh, stale), EMPTY_FILTER, new Set(), null, null, {
			serverNow: now,
		}).features;
		const byId = Object.fromEntries(features.map((f) => [f.properties.id, f.properties]));
		expect(byId.fresh.stale).toBe(0);
		expect(byId.stale.stale).toBe(1);
	});

	it('falls back to updated_utc for staleness when reported_utc is absent', () => {
		const oldSnapshot = new Date(now - (STALE_CUTOFF_S + 30) * 1000).toISOString();
		const [v] = [
			{ id: 'fallback', lat: 45.5, lon: -73.6, status: 'on_time', updated_utc: oldSnapshot },
		].map((x) => VehicleSchema.parse(x));
		const features = toVehicleFeatures([v], EMPTY_FILTER, new Set(), null, null, {
			serverNow: now,
		}).features;
		expect(features[0].properties.stale).toBe(1);
	});

	it('reports stale:0 for every bus when no silence context (no clock to measure against)', () => {
		const fresh = new Date(now - 5 * 1000).toISOString();
		const stale = new Date(now - (STALE_CUTOFF_S + 30) * 1000).toISOString();
		const features = toVehicleFeatures(fleet(fresh, stale), EMPTY_FILTER).features;
		expect(features.map((f) => f.properties.stale)).toEqual([0, 0]);
	});

	it('adds a VEHICLE_SILENT_LAYER filtered on matched + stale, using the "!" badge sprite', () => {
		const layers: LayerSpecification[] = [];
		const map = {
			getLayer: () => undefined,
			addLayer: (nextLayer: LayerSpecification) => {
				layers.push(nextLayer);
			},
		} as unknown as MapLibreMap;
		addVehicleLayers(map);

		const silent = layers.find((l) => l.id === VEHICLE_SILENT_LAYER);
		expect(silent).toBeDefined();
		if (!silent) throw new Error('expected silent layer');
		expect(silent).toMatchObject({ type: 'symbol', source: VEHICLE_SOURCE });
		const rendered = silent as LayerSpecification & {
			layout: Record<string, unknown>;
			filter: unknown;
		};
		const layout = (rendered.layout ?? {}) as Record<string, unknown>;
		expect(layout['icon-image']).toBe(SILENT_ICON);
		// Shows only matched buses that are per-bus stale.
		expect(JSON.stringify(rendered.filter)).toContain('matched');
		expect(JSON.stringify(rendered.filter)).toContain('stale');
		// The big "!" flag stays put over the bus and on top of every neighbour.
		expect(layout['icon-allow-overlap']).toBe(true);
		expect(layout['icon-ignore-placement']).toBe(true);
		// Drawn ABOVE the body + heading so the flag is never occluded.
		const bodyIndex = layers.findIndex((l) => l.id === VEHICLE_BODY_LAYER);
		const headingIndex = layers.findIndex((l) => l.id === VEHICLE_HEADING_LAYER);
		const silentIndex = layers.findIndex((l) => l.id === VEHICLE_SILENT_LAYER);
		expect(silentIndex).toBeGreaterThan(bodyIndex);
		expect(silentIndex).toBeGreaterThan(headingIndex);
	});

	it('sizes the big "!" badge at ~75% of the bus icon, scaling with zoom (S5.1: prominent flag)', () => {
		const layers: LayerSpecification[] = [];
		const map = {
			getLayer: () => undefined,
			addLayer: (nextLayer: LayerSpecification) => {
				layers.push(nextLayer);
			},
		} as unknown as MapLibreMap;
		addVehicleLayers(map);

		// The exported consts ARE the bus DEFAULT legs × 0.75.
		expect(SILENT_BADGE_SCALE).toBe(0.75);
		expect(SILENT_ICON_SIZE_Z11).toBeCloseTo(ICON_SIZE_Z11_DEFAULT * 0.75, 6);
		expect(SILENT_ICON_SIZE_Z11 / ICON_SIZE_Z11_DEFAULT).toBeCloseTo(0.75, 6);
		// z11 ≈ 0.585, z15 ≈ 0.975 (0.75 × the bus 0.78 / 1.3 default legs).
		expect(SILENT_ICON_SIZE_Z11).toBeCloseTo(0.585, 3);
		expect(SILENT_ICON_SIZE_Z15).toBeCloseTo(0.975, 3);
		// It grows with zoom (z15 leg larger than z11) — tracks the bus, not fixed.
		expect(SILENT_ICON_SIZE_Z15).toBeGreaterThan(SILENT_ICON_SIZE_Z11);

		// The layer wires those legs into a top-level zoom-interpolate icon-size.
		const silent = layers.find((l) => l.id === VEHICLE_SILENT_LAYER);
		if (!silent) throw new Error('expected silent layer');
		const layout = (silent.layout ?? {}) as Record<string, unknown>;
		const size = layout['icon-size'];
		expect(usesTopLevelZoomExpression(size)).toBe(true);
		const sizeJson = JSON.stringify(size);
		expect(sizeJson).toContain(String(SILENT_ICON_SIZE_Z11));
		expect(sizeJson).toContain(String(SILENT_ICON_SIZE_Z15));
	});
});
