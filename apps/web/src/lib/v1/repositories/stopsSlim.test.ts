// stopsSlim.test.ts — the slim stops-index projection (§C8 item 3).
//
// Guards the ADDITIVE FAST-PATH invariant: the slim projection carries exactly
// {id,name,lat,lon,code} (map/near-me's minimum), drops the bulky mode + routes[]
// reverse index, and the runtime guard accepts a slim payload while rejecting a
// malformed one — so `getStopsIndexSlim`'s fail-soft branch is well-defined.

import { beforeEach, describe, expect, it, vi } from 'vitest';
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

// WHY(M1-#50 rider): cancellation must stay cancellation. Before M1, an aborted
// slim fetch fell into the catch-all and triggered the full 1.15 MB projection
// the consumer had just cancelled — an abort must reject as AbortError and never
// reach the fallback. The mocked adapter proves the fallback is NOT invoked (a
// rejection alone is satisfiable by the unfixed code, whose fallback re-throws
// the same AbortError through the shared fetch).
const stopsIndex = vi.hoisted(() => vi.fn(async () => ({ generated_utc: 'x', stops: [] })));
vi.mock('$lib/v1/adapter', () => ({ adapter: { static: { stopsIndex } } }));

describe('getStopsIndexSlim — abort is not a fallback trigger', () => {
	beforeEach(() => stopsIndex.mockClear());

	it('re-throws AbortError without invoking the full-index projection', async () => {
		const { getStopsIndexSlim } = await import('./static');
		const controller = new AbortController();
		const fetchFn = () =>
			Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
		controller.abort();
		await expect(
			getStopsIndexSlim({ fetch: fetchFn as typeof fetch, signal: controller.signal }),
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(stopsIndex).not.toHaveBeenCalled();
	});

	it('treats a non-ok response on an aborted signal as an abort, not a fallback', async () => {
		const { getStopsIndexSlim } = await import('./static');
		const controller = new AbortController();
		const fetchFn = async () => {
			controller.abort();
			return new Response('nope', { status: 500 });
		};
		await expect(
			getStopsIndexSlim({ fetch: fetchFn as unknown as typeof fetch, signal: controller.signal }),
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(stopsIndex).not.toHaveBeenCalled();
	});
});
