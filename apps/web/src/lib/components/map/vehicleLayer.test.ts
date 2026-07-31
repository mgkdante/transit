import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, it, vi } from 'vitest';
import type { FilterState } from '$lib/filters';
import { VehicleSchema } from '$lib/v1/schemas';
import type { VehicleSilenceContext } from './vehicleLayer';
import {
	addVehicleLayers,
	ICON_SIZE_Z11_DEFAULT,
	SILENT_BADGE_SCALE,
	SILENT_ICON_SIZE_Z11,
	SILENT_ICON_SIZE_Z15,
	VEHICLE_BODY_LAYER,
	VEHICLE_HEADING_LAYER,
	VEHICLE_HIGHLIGHT_LAYER,
	VEHICLE_SILENT_LAYER,
	VEHICLE_SOURCE,
	setStale,
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
	it('keeps icon-size on one static zoom ramp with no feature or feature-state branches', () => {
		const layers: LayerSpecification[] = [];
		const map = {
			getLayer: () => undefined,
			addLayer: (nextLayer: LayerSpecification) => {
				layers.push(nextLayer);
			},
		} as unknown as MapLibreMap;

		addVehicleLayers(map);

		const layer = layers.find((candidate) => candidate.id === VEHICLE_BODY_LAYER);
		expect(layer).toBeDefined();
		if (!layer) throw new Error('expected vehicle body layer');
		expect(layer).toMatchObject({
			id: VEHICLE_BODY_LAYER,
			type: 'symbol',
			source: VEHICLE_SOURCE,
		});
		const layout = (layer.layout ?? {}) as Record<string, unknown>;
		expect(usesTopLevelZoomExpression(layout['icon-size'])).toBe(true);
		expect(JSON.stringify(layout['icon-size'])).not.toContain('selected');
		expect(JSON.stringify(layout['icon-size'])).not.toContain('hovered');
		expect(JSON.stringify(layout['icon-size'])).not.toContain('feature-state');
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

	it('re-sources hover and committed selection opacity to feature-state while retaining filter-only selection', () => {
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
			expect(opacity).toContain('feature-state');
			expect(opacity).toContain('hovered');
			expect(opacity).toContain('selected');
			expect(opacity).toContain(JSON.stringify(['get', 'selected']));
			expect(opacity).not.toContain(JSON.stringify(['get', 'hovered']));
			expect(opacity).not.toContain(JSON.stringify(['get', 'opacity']));
		}
	});

	it.each([
		['fresh', false, 1],
		['globally stale', true, 0.45],
	] as const)(
		'keeps hover, committed selection, and serialized selection ahead of the %s fallback',
		(_name, stale, fallback) => {
			const setPaintProperty = vi.fn();
			const map = {
				getLayer: (id: string) =>
					id === VEHICLE_BODY_LAYER || id === VEHICLE_HEADING_LAYER ? { id } : undefined,
				setPaintProperty,
			} as unknown as MapLibreMap;
			const expectedOpacity = [
				'case',
				['boolean', ['feature-state', 'hovered'], false],
				1,
				['boolean', ['feature-state', 'selected'], false],
				0.95,
				['==', ['get', 'selected'], 1],
				0.95,
				fallback,
			];

			setStale(map, stale);

			expect(setPaintProperty.mock.calls).toEqual([
				[VEHICLE_BODY_LAYER, 'icon-opacity', expectedOpacity],
				[VEHICLE_HEADING_LAYER, 'icon-opacity', expectedOpacity],
			]);
		},
	);

	it('does not restore the retired per-vehicle silence opacity expression', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/map/vehicleLayer.ts'),
			'utf8',
		);

		expect(source).not.toContain('SILENCE_OPACITY');
	});

	it('rests buses at a solid base size while the highlight layer carries interaction emphasis', () => {
		expect(ICON_SIZE_Z11_DEFAULT).toBeGreaterThanOrEqual(0.7);
	});

	it('retints an existing highlight layer on a live theme change', () => {
		const setPaintProperty = vi.fn();
		const map = {
			getLayer: (id: string) => ({ id }),
			setPaintProperty,
		} as unknown as MapLibreMap;

		addVehicleLayers(map);

		expect(setPaintProperty).toHaveBeenCalledWith(
			VEHICLE_HIGHLIGHT_LAYER,
			'circle-color',
			'rgb(20, 20, 20)',
		);
		expect(setPaintProperty).toHaveBeenCalledWith(
			VEHICLE_HIGHLIGHT_LAYER,
			'circle-stroke-color',
			'rgb(255, 95, 87)',
		);
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

	it('does not serialize hover or the retired silence-opacity debug fields', () => {
		const features = toVehicleFeatures(vehicles, EMPTY_FILTER).features;

		for (const feature of features) {
			expect(feature.properties).not.toHaveProperty('hovered');
			expect(feature.properties).not.toHaveProperty('opacity');
			expect(feature.properties).not.toHaveProperty('silenceAgeS');
		}
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

describe('toVehicleFeatures retired per-vehicle silence fade', () => {
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

	it('keeps VehicleSilenceContext only for the per-bus stale calculation', () => {
		const now = Date.parse('2026-06-21T12:00:00Z');
		const fresh = '2026-06-21T12:00:00Z';
		const silent = '2026-06-21T11:55:00Z';
		const silence: VehicleSilenceContext = {
			serverNow: now,
			ttlS: TTL,
		};
		const features = toVehicleFeatures(
			fleet(fresh, silent),
			EMPTY_FILTER,
			new Set(),
			null,
			silence,
		).features;
		const byId = Object.fromEntries(features.map((f) => [f.properties.id, f.properties]));
		expect(byId.fresh.stale).toBe(0);
		expect(byId.silent.stale).toBe(1);
		expect(byId.fresh).not.toHaveProperty('opacity');
		expect(byId.silent).not.toHaveProperty('silenceAgeS');
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
		const features = toVehicleFeatures(fleet(fresh, stale), EMPTY_FILTER, new Set(), null, {
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
		const features = toVehicleFeatures([v], EMPTY_FILTER, new Set(), null, {
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

	it('installs a feature-state ring below the bus using the contrasting background casing', () => {
		const layers: LayerSpecification[] = [];
		const map = {
			getLayer: () => undefined,
			addLayer: (nextLayer: LayerSpecification) => {
				layers.push(nextLayer);
			},
		} as unknown as MapLibreMap;

		addVehicleLayers(map);

		const highlight = layers.find((layer) => layer.id === VEHICLE_HIGHLIGHT_LAYER);
		expect(highlight).toBeDefined();
		if (!highlight) throw new Error('expected vehicle highlight layer');
		expect(highlight).toMatchObject({ type: 'circle', source: VEHICLE_SOURCE });
		const paint = (highlight.paint ?? {}) as Record<string, unknown>;
		const renderedPaint = JSON.stringify(paint);
		expect(renderedPaint).toContain('feature-state');
		expect(renderedPaint).toContain('hovered');
		expect(renderedPaint).toContain('selected');
		expect(paint['circle-color']).toMatch(/^rgb/);
		expect(paint['circle-stroke-color']).toMatch(/^rgb/);
		expect(layers.findIndex((layer) => layer.id === VEHICLE_HIGHLIGHT_LAYER)).toBeLessThan(
			layers.findIndex((layer) => layer.id === VEHICLE_BODY_LAYER),
		);
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
