import { describe, expect, it } from 'vitest';
import { parseCoordinateQuery, nearTargetKey } from './mapNearMe';

describe('parseCoordinateQuery', () => {
	it('uses selected bounds, including the eastern OC service area', () => {
		const ottawa = [-76.05, 45.1, -75.33, 45.55];
		expect(parseCoordinateQuery('45.44076, -75.34342', ottawa)).toEqual({
			lat: 45.44076,
			lon: -75.34342,
		});
		expect(parseCoordinateQuery('45.5, -73.6', ottawa)).toBeNull();
	});
	it('parses a comma-separated "lat, lon" inside Montréal', () => {
		expect(parseCoordinateQuery('45.5, -73.6', [-74.05, 45.35, -73.35, 45.75])).toEqual({
			lat: 45.5,
			lon: -73.6,
		});
	});

	it('parses a space-separated "lat lon"', () => {
		expect(parseCoordinateQuery('45.5 -73.6', [-74.05, 45.35, -73.35, 45.75])).toEqual({
			lat: 45.5,
			lon: -73.6,
		});
	});

	it('tolerates surrounding and inner whitespace', () => {
		expect(parseCoordinateQuery('  45.5 ,  -73.6  ', [-74.05, 45.35, -73.35, 45.75])).toEqual({
			lat: 45.5,
			lon: -73.6,
		});
	});

	it('parses integer coordinates', () => {
		expect(parseCoordinateQuery('45.4, -73.5', [-74.05, 45.35, -73.35, 45.75])).toEqual({
			lat: 45.4,
			lon: -73.5,
		});
	});

	it('returns null for a non-coordinate query (a place name)', () => {
		expect(parseCoordinateQuery('Berri-UQAM', [-74.05, 45.35, -73.35, 45.75])).toBeNull();
		expect(parseCoordinateQuery('', [-74.05, 45.35, -73.35, 45.75])).toBeNull();
		expect(parseCoordinateQuery('45.5', [-74.05, 45.35, -73.35, 45.75])).toBeNull();
		expect(parseCoordinateQuery('45.5, -73.6, 12', [-74.05, 45.35, -73.35, 45.75])).toBeNull();
	});

	it('returns null for a well-formed coordinate OUTSIDE Montréal', () => {
		expect(parseCoordinateQuery('43.65, -79.38', [-74.05, 45.35, -73.35, 45.75])).toBeNull();
		expect(parseCoordinateQuery('45.2, -73.6', [-74.05, 45.35, -73.35, 45.75])).toBeNull();
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
