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

import { mirrorSearchParam } from './urlMirror';

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

	it('swallows a replaceState throw (router not initialized — SSR / test / pre-hydration)', () => {
		replaceState.mockImplementation(() => {
			throw new Error('Cannot call replaceState(...) before router is initialized');
		});
		expect(() => mirrorSearchParam('grain', 'week')).not.toThrow();
	});
});
