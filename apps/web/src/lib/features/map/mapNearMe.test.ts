import { describe, expect, it } from 'vitest';
import { parseCoordinateQuery, nearTargetKey } from './mapNearMe';

// Pure near-me query parsing + identity helpers extracted from MapHero.

describe('parseCoordinateQuery', () => {
	it('parses a comma-separated "lat, lon" inside Montréal', () => {
		expect(parseCoordinateQuery('45.5, -73.6')).toEqual({ lat: 45.5, lon: -73.6 });
	});

	it('parses a space-separated "lat lon"', () => {
		expect(parseCoordinateQuery('45.5 -73.6')).toEqual({ lat: 45.5, lon: -73.6 });
	});

	it('tolerates surrounding and inner whitespace', () => {
		expect(parseCoordinateQuery('  45.5 ,  -73.6  ')).toEqual({ lat: 45.5, lon: -73.6 });
	});

	it('parses integer coordinates', () => {
		// 45,-74 is inside the bias rectangle? minLon -74.05 .. maxLon -73.35, lat 45.35..45.75
		expect(parseCoordinateQuery('45.4, -73.5')).toEqual({ lat: 45.4, lon: -73.5 });
	});

	it('returns null for a non-coordinate query (a place name)', () => {
		expect(parseCoordinateQuery('Berri-UQAM')).toBeNull();
		expect(parseCoordinateQuery('')).toBeNull();
		expect(parseCoordinateQuery('45.5')).toBeNull();
		expect(parseCoordinateQuery('45.5, -73.6, 12')).toBeNull();
	});

	it('returns null for a well-formed coordinate OUTSIDE Montréal', () => {
		// Toronto-ish — well-formed but outside the bias rectangle.
		expect(parseCoordinateQuery('43.65, -79.38')).toBeNull();
		// Just past the southern edge (minLat 45.35).
		expect(parseCoordinateQuery('45.2, -73.6')).toBeNull();
	});
});

describe('nearTargetKey', () => {
	it('builds a stable key from coordinates (6dp) + label', () => {
		expect(nearTargetKey({ lat: 45.5, lon: -73.6, label: 'Home' })).toBe(
			'45.500000,-73.600000:Home',
		);
	});

	it('quantises float jitter to 6 decimals so the key is stable', () => {
		const a = nearTargetKey({ lat: 45.5000001, lon: -73.6000002, label: 'X' });
		const b = nearTargetKey({ lat: 45.5000003, lon: -73.6000001, label: 'X' });
		expect(a).toBe(b);
	});

	it('distinguishes different labels at the same point', () => {
		expect(nearTargetKey({ lat: 45.5, lon: -73.6, label: 'A' })).not.toBe(
			nearTargetKey({ lat: 45.5, lon: -73.6, label: 'B' }),
		);
	});
});
