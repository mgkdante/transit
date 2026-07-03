// stopsSlim.test.ts — the slim stops-index projection (§C8 item 3).
//
// Guards the ADDITIVE FAST-PATH invariant: the slim projection carries exactly
// {id,name,lat,lon,code} (map/near-me's minimum), drops the bulky mode + routes[]
// reverse index, and the runtime guard accepts a slim payload while rejecting a
// malformed one — so `getStopsIndexSlim`'s fail-soft branch is well-defined.

import { describe, it, expect } from 'vitest';
import type { StopsIndex } from '$lib/v1/schemas';
import { isSlimStopsIndex, toSlimStop, toSlimStopsIndex } from './stopsSlim';

const FULL = {
	generated_utc: '2026-07-03T00:00:00Z',
	stops: [
		{
			id: 'S1',
			name: 'Berri',
			lat: 45.5,
			lon: -73.5,
			code: '10001',
			mode: 'metro',
			routes: ['1', '2'],
		},
		{ id: 'S2', name: 'Peel', lat: 45.49, lon: -73.57, code: null, mode: null },
		{ id: 'S3', name: 'Guy', lat: 45.49, lon: -73.58 },
	],
} as unknown as StopsIndex;

describe('toSlimStop — drops mode + routes, keeps the map minimum', () => {
	it('projects to {id,name,lat,lon,code} only', () => {
		expect(toSlimStop(FULL.stops[0])).toEqual({
			id: 'S1',
			name: 'Berri',
			lat: 45.5,
			lon: -73.5,
			code: '10001',
		});
	});

	it('coerces an absent code to null', () => {
		expect(toSlimStop(FULL.stops[2]).code).toBeNull();
	});
});

describe('toSlimStopsIndex', () => {
	it('preserves generated_utc + projects every stop', () => {
		const slim = toSlimStopsIndex(FULL);
		expect(slim.generated_utc).toBe('2026-07-03T00:00:00Z');
		expect(slim.stops).toHaveLength(3);
		// No slim entry leaks mode/routes.
		for (const s of slim.stops) {
			expect(s).not.toHaveProperty('mode');
			expect(s).not.toHaveProperty('routes');
		}
	});
});

describe('isSlimStopsIndex — runtime guard for the endpoint payload', () => {
	it('accepts a well-formed slim payload', () => {
		expect(isSlimStopsIndex(toSlimStopsIndex(FULL))).toBe(true);
	});

	it('accepts a null code', () => {
		expect(
			isSlimStopsIndex({
				generated_utc: 'x',
				stops: [{ id: 'a', name: 'A', lat: 1, lon: 2, code: null }],
			}),
		).toBe(true);
	});

	it('rejects a non-object, missing stops, and a bad lat', () => {
		expect(isSlimStopsIndex(null)).toBe(false);
		expect(isSlimStopsIndex({ generated_utc: 'x' })).toBe(false);
		expect(
			isSlimStopsIndex({ generated_utc: 'x', stops: [{ id: 'a', name: 'A', lat: '1', lon: 2 }] }),
		).toBe(false);
	});
});
