import { describe, expect, it } from 'vitest';
import { routeBoundsFromFile, zoomForNearMePrecision } from './mapGeo';
import type { RouteFile } from '$lib/v1';

// Pure geometry/camera helpers extracted from MapHero. The GL canvas can't be
// screenshotted from CI, so the load-bearing bounds/zoom math is proven here.

function route(directions: RouteFile['directions']): RouteFile {
	return { generated_utc: '2026-06-21T00:00:00Z', id: 'r1', directions } as RouteFile;
}

describe('routeBoundsFromFile', () => {
	it('computes the bbox across every direction shape', () => {
		const r = route([
			{
				dir: 0,
				shape: {
					coordinates: [
						[-73.6, 45.5],
						[-73.55, 45.52],
					],
				},
			},
			{
				dir: 1,
				shape: {
					coordinates: [
						[-73.62, 45.48],
						[-73.5, 45.55],
					],
				},
			},
		]);
		expect(routeBoundsFromFile(r)).toEqual([
			[-73.62, 45.48],
			[-73.5, 45.55],
		]);
	});

	it('handles a single coordinate (degenerate point bbox)', () => {
		const r = route([{ dir: 0, shape: { coordinates: [[-73.6, 45.5]] } }]);
		expect(routeBoundsFromFile(r)).toEqual([
			[-73.6, 45.5],
			[-73.6, 45.5],
		]);
	});

	it('returns null when there are no directions', () => {
		expect(routeBoundsFromFile(route([]))).toBeNull();
		expect(routeBoundsFromFile(route(undefined))).toBeNull();
	});

	it('returns null when shapes carry no coordinates', () => {
		expect(routeBoundsFromFile(route([{ dir: 0, shape: null }]))).toBeNull();
		expect(routeBoundsFromFile(route([{ dir: 0, shape: {} }]))).toBeNull();
		expect(
			routeBoundsFromFile(route([{ dir: 0, shape: { coordinates: 'nope' } as never }])),
		).toBeNull();
	});

	it('skips malformed / non-finite coordinate pairs', () => {
		const r = route([
			{
				dir: 0,
				shape: {
					coordinates: [
						[-73.6, 45.5],
						[-73.55], // too short
						['x', 'y'], // non-numeric → NaN
						[Infinity, 45.5], // non-finite
						[-73.5, 45.55],
					],
				},
			},
		]);
		expect(routeBoundsFromFile(r)).toEqual([
			[-73.6, 45.5],
			[-73.5, 45.55],
		]);
	});

	it('returns null when EVERY pair is malformed', () => {
		const r = route([{ dir: 0, shape: { coordinates: [[1], ['a', 'b'], [NaN, NaN]] } }]);
		expect(routeBoundsFromFile(r)).toBeNull();
	});
});

describe('zoomForNearMePrecision', () => {
	it('maps each precision to its target zoom', () => {
		expect(zoomForNearMePrecision('address')).toBe(17);
		expect(zoomForNearMePrecision('street')).toBe(15);
		expect(zoomForNearMePrecision('postal')).toBe(14);
		expect(zoomForNearMePrecision('neighbourhood')).toBe(13);
	});

	it('falls back to a mid zoom for place / undefined precision', () => {
		expect(zoomForNearMePrecision('place')).toBe(14);
		expect(zoomForNearMePrecision(undefined)).toBe(14);
	});
});
