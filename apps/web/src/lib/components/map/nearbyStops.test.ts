// Unit suite for map/nearbyStops.ts — the near-me geo helpers.
import { describe, it, expect } from 'vitest';
import { haversineMeters, nearestStops } from './nearbyStops';

// Montréal reference points (downtown core).
const PLACE_DES_ARTS = { lat: 45.5089, lon: -73.5667 };
const BERRI_UQAM = { lat: 45.5152, lon: -73.5616 };

describe('haversineMeters', () => {
	it('is zero for identical points', () => {
		expect(haversineMeters(PLACE_DES_ARTS, PLACE_DES_ARTS)).toBe(0);
	});
	it('matches the known ~830 m between Place-des-Arts and Berri-UQAM (±5%)', () => {
		const d = haversineMeters(PLACE_DES_ARTS, BERRI_UQAM);
		expect(d).toBeGreaterThan(790);
		expect(d).toBeLessThan(880);
	});
	it('is symmetric', () => {
		expect(haversineMeters(PLACE_DES_ARTS, BERRI_UQAM)).toBeCloseTo(
			haversineMeters(BERRI_UQAM, PLACE_DES_ARTS),
			6,
		);
	});
});

describe('nearestStops', () => {
	const stops = [
		{ id: 'far', lat: 45.62, lon: -73.62 },
		{ id: 'near', lat: 45.5092, lon: -73.567 },
		{ id: 'mid', lat: 45.52, lon: -73.57 },
	];

	it('returns the k closest, ascending by distance, with distanceM attached', () => {
		const out = nearestStops(PLACE_DES_ARTS, stops, 2);
		expect(out.map((s) => s.id)).toEqual(['near', 'mid']);
		expect(out[0].distanceM).toBeLessThan(out[1].distanceM);
		expect(out[0].distanceM).toBeGreaterThanOrEqual(0);
	});

	it('excludes stops beyond maxMeters', () => {
		const out = nearestStops(PLACE_DES_ARTS, stops, 10, 2000);
		expect(out.every((s) => s.distanceM <= 2000)).toBe(true);
		expect(out.map((s) => s.id)).not.toContain('far');
	});

	it('returns an empty list when nothing is in range', () => {
		// 5 m radius: even the closest stop (~40 m away) is excluded.
		expect(nearestStops(PLACE_DES_ARTS, stops, 10, 5)).toEqual([]);
	});

	it('caps at k even when more are in range', () => {
		expect(nearestStops(PLACE_DES_ARTS, stops, 1)).toHaveLength(1);
	});
});
