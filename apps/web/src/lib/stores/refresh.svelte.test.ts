import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	invalidateAll: vi.fn<() => Promise<void>>(),
}));

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/navigation', () => ({
	invalidateAll: mocks.invalidateAll,
}));

async function loadRefreshStore() {
	vi.resetModules();
	return import('./refresh.svelte');
}

describe('dataRefresh', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mocks.invalidateAll.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('releases the chrome refreshing state when load invalidation hangs', async () => {
		const { dataRefresh, REFRESH_INVALIDATE_TIMEOUT_MS } = await loadRefreshStore();
		mocks.invalidateAll.mockReturnValue(new Promise(() => {}));

		let settled = false;
		void dataRefresh.run().then(() => {
			settled = true;
		});
		await Promise.resolve();

		expect(dataRefresh.refreshing).toBe(true);

		await vi.advanceTimersByTimeAsync(REFRESH_INVALIDATE_TIMEOUT_MS + 1);

		expect(settled).toBe(true);
		expect(dataRefresh.refreshing).toBe(false);
		expect(dataRefresh.lastRefreshedMs).not.toBeNull();
	});

	it('records the live snapshot data timestamp for shared freshness readouts', async () => {
		const { dataRefresh } = await loadRefreshStore();
		const generatedUtc = '2026-06-15T23:09:05Z';

		dataRefresh.noteDataGeneratedUtc(generatedUtc);

		expect(dataRefresh.dataGeneratedUtc).toBe(generatedUtc);
	});

	it('is monotonic: a NEWER timestamp advances the shared value', async () => {
		const { dataRefresh } = await loadRefreshStore();
		dataRefresh.noteDataGeneratedUtc('2026-06-15T23:00:00Z');
		dataRefresh.noteDataGeneratedUtc('2026-06-15T23:05:00Z');
		expect(dataRefresh.dataGeneratedUtc).toBe('2026-06-15T23:05:00Z');
	});

	it('is monotonic: an OLDER timestamp never clobbers a fresher one', async () => {
		const { dataRefresh } = await loadRefreshStore();
		// e.g. the live store posted a fresh stamp, then a static surface re-fetched
		// its much-older daily build — the older value must NOT win.
		dataRefresh.noteDataGeneratedUtc('2026-06-15T23:05:00Z');
		dataRefresh.noteDataGeneratedUtc('2026-06-14T00:00:00Z');
		expect(dataRefresh.dataGeneratedUtc).toBe('2026-06-15T23:05:00Z');
	});

	it('ignores an equal timestamp (no thrash on a re-fetch of the same build)', async () => {
		const { dataRefresh } = await loadRefreshStore();
		dataRefresh.noteDataGeneratedUtc('2026-06-15T23:05:00Z');
		dataRefresh.noteDataGeneratedUtc('2026-06-15T23:05:00Z');
		expect(dataRefresh.dataGeneratedUtc).toBe('2026-06-15T23:05:00Z');
	});

	it('ignores falsy and unparseable timestamps', async () => {
		const { dataRefresh } = await loadRefreshStore();
		dataRefresh.noteDataGeneratedUtc('2026-06-15T23:05:00Z');
		dataRefresh.noteDataGeneratedUtc(null);
		dataRefresh.noteDataGeneratedUtc(undefined);
		dataRefresh.noteDataGeneratedUtc('not-a-date');
		expect(dataRefresh.dataGeneratedUtc).toBe('2026-06-15T23:05:00Z');
	});
});
