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
		expect(dataRefresh.epoch).toBe(1);
		mocks.invalidateAll.mockResolvedValueOnce();
		await dataRefresh.run();
		expect(mocks.invalidateAll).toHaveBeenCalledTimes(2);
		expect(dataRefresh.refreshing).toBe(false);
		expect(dataRefresh.epoch).toBe(2);
	});
	it('advances the publish epoch without invalidating routes', async () => {
		const { dataRefresh } = await loadRefreshStore();
		dataRefresh.bumpEpoch();
		expect(dataRefresh.epoch).toBe(1);
		expect(dataRefresh.refreshing).toBe(false);
		expect(mocks.invalidateAll).not.toHaveBeenCalled();
	});
});
