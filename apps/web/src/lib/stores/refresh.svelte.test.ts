import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	invalidateAll: vi.fn<() => Promise<void>>(),
}));

vi.mock('$app/env', () => ({ browser: true }));
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
		expect(dataRefresh.error?.message).toMatch(/timed out/);
		expect(dataRefresh.refreshing).toBe(false);
		expect(dataRefresh.epoch).toBe(1);
		mocks.invalidateAll.mockResolvedValueOnce();
		await dataRefresh.run();
		expect(dataRefresh.error).toBeNull();
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

	it('keeps refresh busy after routes settle until active data work settles', async () => {
		const { dataRefresh } = await loadRefreshStore();
		mocks.invalidateAll.mockResolvedValue();
		let finish!: () => void;
		dataRefresh.track(
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
		);
		const run = dataRefresh.run();
		await vi.advanceTimersByTimeAsync(1);
		expect(dataRefresh.refreshing).toBe(true);
		finish();
		await run;
		expect(dataRefresh.refreshing).toBe(false);
		expect(dataRefresh.error).toBeNull();
	});

	it('does not wait for work discarded by an aborted owner', async () => {
		const { dataRefresh } = await loadRefreshStore();
		mocks.invalidateAll.mockResolvedValue();
		const owner = new AbortController();
		dataRefresh.track(new Promise<void>(() => {}), owner.signal);
		const run = dataRefresh.run();
		await vi.advanceTimersByTimeAsync(1);
		owner.abort();
		await run;
		expect(dataRefresh.error).toBeNull();
		expect(dataRefresh.refreshing).toBe(false);
	});

	it('reports an active data failure even when route invalidation succeeds', async () => {
		const { dataRefresh } = await loadRefreshStore();
		mocks.invalidateAll.mockResolvedValue();
		const failure = new Error('live data unavailable');
		dataRefresh.track(Promise.reject(failure));
		await dataRefresh.run();
		expect(dataRefresh.error).toBe(failure);
		expect(dataRefresh.refreshing).toBe(false);
	});
});
