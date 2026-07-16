import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable mock of the SvelteKit page URL + a spy replaceState — the helper's only two dependencies.
let mockUrl = new URL('http://localhost/lines/51');
const replaceState = vi.fn();
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return mockUrl;
		},
		state: {},
	},
}));
vi.mock('$app/navigation', () => ({
	replaceState: (...args: unknown[]) => replaceState(...args),
}));

import { mirrorSearchParam, mirrorSearchParams } from './urlMirror';

const writtenParam = (key: string): string | null => {
	const u = replaceState.mock.calls[0][0] as string | URL;
	return new URL(u, 'http://localhost').searchParams.get(key);
};

describe('mirrorSearchParam', () => {
	beforeEach(() => {
		replaceState.mockReset();
		mockUrl = new URL('http://localhost/lines/51');
	});

	it('sets a non-default param via replaceState', () => {
		mirrorSearchParam('grain', 'week');
		expect(replaceState).toHaveBeenCalledOnce();
		expect(writtenParam('grain')).toBe('week');
	});

	it('deletes the param when the value is null (default-omit → clean URL)', () => {
		mockUrl = new URL('http://localhost/lines/51?grain=week');
		mirrorSearchParam('grain', null);
		expect(replaceState).toHaveBeenCalledOnce();
		expect(writtenParam('grain')).toBeNull();
	});

	it('is idempotent: no write when the param already matches', () => {
		mockUrl = new URL('http://localhost/lines/51?grain=week');
		mirrorSearchParam('grain', 'week');
		expect(replaceState).not.toHaveBeenCalled();
	});

	it('is idempotent: no write when already absent and asked to delete', () => {
		mirrorSearchParam('grain', null);
		expect(replaceState).not.toHaveBeenCalled();
	});

	it('preserves other params + the hash when mirroring', () => {
		mockUrl = new URL('http://localhost/lines/51?tab=reliability#rel-the-wait');
		mirrorSearchParam('grain', 'month');
		const u = new URL(replaceState.mock.calls[0][0] as string, 'http://localhost');
		expect(u.searchParams.get('tab')).toBe('reliability');
		expect(u.searchParams.get('grain')).toBe('month');
		expect(u.hash).toBe('#rel-the-wait');
	});

	it('uses the current browser URL when page.url still reflects the previous shallow state', () => {
		window.history.replaceState({}, '', '/lines/51?tab=schedule&line=51#service-profile');
		mockUrl = new URL(`${window.location.origin}/lines/51?line=51#service-profile`);

		mirrorSearchParam('tab', null);

		expect(replaceState).toHaveBeenCalledOnce();
		const u = new URL(replaceState.mock.calls[0][0] as string | URL, window.location.origin);
		expect(u.searchParams.has('tab')).toBe(false);
		expect(u.searchParams.get('line')).toBe('51');
		expect(u.hash).toBe('#service-profile');
	});

	it('swallows a replaceState throw (router not initialized — SSR / test / pre-hydration)', () => {
		replaceState.mockImplementation(() => {
			throw new Error('Cannot call replaceState(...) before router is initialized');
		});
		expect(() => mirrorSearchParam('grain', 'week')).not.toThrow();
	});
});

describe('mirrorSearchParams (batched, race-free)', () => {
	beforeEach(() => {
		replaceState.mockReset();
		mockUrl = new URL('http://localhost/lines/51');
	});

	it('clears grain+from+to in ONE replaceState (the per-param clobber fix)', () => {
		// the real-app bug: three separate single writes each cloned the async-stale url and the LAST
		// won, leaving ?grain=range&from=… stuck. One batched write deletes all three cleanly.
		mockUrl = new URL(
			'http://localhost/lines/51?grain=range&from=2026-06-20&to=2026-06-25&tab=reliability',
		);
		mirrorSearchParams({ grain: null, from: null, to: null });
		expect(replaceState).toHaveBeenCalledOnce(); // ONE write, not three
		const u = new URL(replaceState.mock.calls[0][0] as string, 'http://localhost');
		expect(u.searchParams.get('grain')).toBeNull();
		expect(u.searchParams.get('from')).toBeNull();
		expect(u.searchParams.get('to')).toBeNull();
		expect(u.searchParams.get('tab')).toBe('reliability'); // an untouched param is preserved
	});

	it('sets and deletes in a single write (mixed)', () => {
		mockUrl = new URL('http://localhost/lines/51?grain=day');
		mirrorSearchParams({ grain: 'range', from: '2026-06-20', to: '2026-06-25' });
		expect(replaceState).toHaveBeenCalledOnce();
		const u = new URL(replaceState.mock.calls[0][0] as string, 'http://localhost');
		expect(u.searchParams.get('grain')).toBe('range');
		expect(u.searchParams.get('from')).toBe('2026-06-20');
		expect(u.searchParams.get('to')).toBe('2026-06-25');
	});

	it('is idempotent: no write when every param already matches', () => {
		mockUrl = new URL('http://localhost/lines/51?grain=week');
		mirrorSearchParams({ grain: 'week', from: null, to: null });
		expect(replaceState).not.toHaveBeenCalled();
	});

	it('swallows a replaceState throw (router not ready)', () => {
		replaceState.mockImplementation(() => {
			throw new Error('not initialized');
		});
		expect(() => mirrorSearchParams({ grain: 'week' })).not.toThrow();
	});
});
