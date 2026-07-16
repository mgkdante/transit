import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Manifest } from '$lib/v1/schemas';

// Mock browser=true so the engine actually wires its timer.
vi.mock('$app/environment', () => ({ browser: true }));

// The fresh-manifest poll + the epoch bump are the two collaborators. We control
// the manifest each poll returns and spy on the bump.
const mocks = vi.hoisted(() => ({
	getManifestFresh: vi.fn<() => Promise<Manifest>>(),
	bumpEpoch: vi.fn<() => void>(),
}));
vi.mock('$lib/v1/repositories/manifest', () => ({
	getManifestFresh: mocks.getManifestFresh,
}));
vi.mock('./refresh.svelte', () => ({
	dataRefresh: { bumpEpoch: mocks.bumpEpoch },
}));

import { dataPulse } from './dataPulse.svelte';

type ManifestTier = 'live' | 'static' | 'historic';

/** Build a manifest carrying a generated_utc on one tier. */
function manifestAt(
	generatedUtc: string | null,
	ttlS = 30,
	tier: ManifestTier = 'static',
): Manifest {
	return {
		files: { [tier]: { generated_utc: generatedUtc, ttl_s: ttlS } },
	} as unknown as Manifest;
}

/** Build a manifest with several tier timestamps for one-bump aggregation tests. */
function manifestTiers(tiers: Partial<Record<ManifestTier, string | null>>): Manifest {
	return {
		files: Object.fromEntries(
			Object.entries(tiers).map(([tier, generatedUtc]) => [
				tier,
				{ generated_utc: generatedUtc, ttl_s: 30 },
			]),
		),
	} as unknown as Manifest;
}

function manifestWithTtls(ttls: Partial<Record<ManifestTier, number>>): Manifest {
	return {
		files: Object.fromEntries(
			Object.entries(ttls).map(([tier, ttlS]) => [
				tier,
				{ generated_utc: '2026-06-20T00:00:00Z', ttl_s: ttlS },
			]),
		),
	} as unknown as Manifest;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolver) => {
		resolve = resolver;
	});
	return { promise, resolve };
}

/**
 * Drain pending microtasks so an async pollOnce settles. pollOnce awaits a
 * DYNAMIC import (the manifest repo is lazy-loaded) THEN the fetch THEN the
 * cadence re-pick, so a few extra turns are needed; advancing fake timers by 0
 * also flushes any timer-scheduled continuations.
 */
async function settle() {
	for (let i = 0; i < 8; i++) {
		await Promise.resolve();
		await vi.advanceTimersByTimeAsync(0);
	}
}

describe('dataPulse — auto-refresh on a monotonic manifest advance', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mocks.getManifestFresh.mockReset();
		mocks.bumpEpoch.mockReset();
		dataPulse._resetForTests();
		// Document is visible by default in jsdom.
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'visible',
		});
	});

	afterEach(() => {
		dataPulse._resetForTests();
		vi.useRealTimers();
	});

	it('seeds the baseline on the first poll WITHOUT bumping', async () => {
		mocks.getManifestFresh.mockResolvedValue(manifestAt('2026-06-20T00:00:00Z'));
		const dispose = dataPulse.subscribe(); // triggers an immediate poll
		await settle();

		expect(mocks.getManifestFresh).toHaveBeenCalledTimes(1);
		expect(mocks.bumpEpoch).not.toHaveBeenCalled();
		expect(dataPulse.lastSeenMs).toBe(Date.parse('2026-06-20T00:00:00Z'));
		dispose();
	});

	it('stays idle while the root manifest is explicitly pending', async () => {
		mocks.getManifestFresh.mockResolvedValue(manifestAt('2026-06-20T00:00:00Z'));

		const dispose = dataPulse.subscribe(null);
		await settle();
		await vi.advanceTimersByTimeAsync(300_000);
		await settle();

		expect(mocks.getManifestFresh).not.toHaveBeenCalled();
		expect(dataPulse.lastSeenMs).toBeNull();
		dispose();
	});

	it('seeds from the boot manifest and waits until that check is due after a hidden boot', async () => {
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'hidden',
		});
		const bootManifest = manifestAt('2026-06-20T00:00:00Z');
		mocks.getManifestFresh.mockResolvedValue(manifestAt('2026-06-20T00:05:00Z'));

		const dispose = dataPulse.subscribe(bootManifest);
		await settle();

		expect(mocks.getManifestFresh).not.toHaveBeenCalled();
		expect(dataPulse.lastSeenMs).toBe(Date.parse('2026-06-20T00:00:00Z'));

		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'visible',
		});
		document.dispatchEvent(new Event('visibilitychange'));
		await settle();
		expect(mocks.getManifestFresh).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(300_000);
		await settle();

		expect(mocks.getManifestFresh).toHaveBeenCalledTimes(1);
		expect(mocks.bumpEpoch).toHaveBeenCalledTimes(1);
		expect(dataPulse.lastSeenMs).toBe(Date.parse('2026-06-20T00:05:00Z'));
		dispose();
	});

	it('ignores the live ttl when static and historic tiers set discovery cadence', async () => {
		const bootManifest = manifestWithTtls({ live: 30, static: 3_600, historic: 86_400 });
		mocks.getManifestFresh.mockResolvedValue(bootManifest);

		const dispose = dataPulse.subscribe(bootManifest);
		await settle();

		await vi.advanceTimersByTimeAsync(3_599_999);
		await settle();
		expect(mocks.getManifestFresh).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		await settle();
		expect(mocks.getManifestFresh).toHaveBeenCalledTimes(1);
		dispose();
	});

	it('uses the visible boot manifest until the first five-minute discovery tick', async () => {
		const bootManifest = manifestAt('2026-06-20T00:00:00Z', 30, 'live');
		mocks.getManifestFresh.mockResolvedValue(bootManifest);

		const dispose = dataPulse.subscribe(bootManifest);
		await settle();
		expect(mocks.getManifestFresh).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(299_999);
		await settle();
		expect(mocks.getManifestFresh).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		await settle();
		expect(mocks.getManifestFresh).toHaveBeenCalledTimes(1);
		dispose();
	});

	it('bumps the epoch on a strictly NEWER publish', async () => {
		mocks.getManifestFresh
			.mockResolvedValueOnce(manifestAt('2026-06-20T00:00:00Z')) // seed
			.mockResolvedValueOnce(manifestAt('2026-06-20T00:05:00Z')); // newer
		const dispose = dataPulse.subscribe();
		await settle(); // seed poll

		await vi.advanceTimersByTimeAsync(300_000); // next discovery poll
		await settle();

		expect(mocks.bumpEpoch).toHaveBeenCalledTimes(1);
		expect(dataPulse.lastSeenMs).toBe(Date.parse('2026-06-20T00:05:00Z'));
		dispose();
	});

	it('does NOT bump on an EQUAL manifest (no thrash on a republish of the same build)', async () => {
		mocks.getManifestFresh
			.mockResolvedValueOnce(manifestAt('2026-06-20T00:00:00Z'))
			.mockResolvedValueOnce(manifestAt('2026-06-20T00:00:00Z'));
		const dispose = dataPulse.subscribe();
		await settle();
		await vi.advanceTimersByTimeAsync(300_000);
		await settle();

		expect(mocks.bumpEpoch).not.toHaveBeenCalled();
		dispose();
	});

	it('does NOT bump on an OLDER manifest (edge briefly serving a stale copy)', async () => {
		mocks.getManifestFresh
			.mockResolvedValueOnce(manifestAt('2026-06-20T00:05:00Z'))
			.mockResolvedValueOnce(manifestAt('2026-06-19T00:00:00Z'));
		const dispose = dataPulse.subscribe();
		await settle();
		await vi.advanceTimersByTimeAsync(300_000);
		await settle();

		expect(mocks.bumpEpoch).not.toHaveBeenCalled();
		expect(dataPulse.lastSeenMs).toBe(Date.parse('2026-06-20T00:05:00Z'));
		dispose();
	});

	it('swallows a poll failure without tearing the timer down (next tick retries)', async () => {
		mocks.getManifestFresh
			.mockResolvedValueOnce(manifestAt('2026-06-20T00:00:00Z')) // seed
			.mockRejectedValueOnce(new Error('edge blip')) // transient
			.mockResolvedValueOnce(manifestAt('2026-06-20T00:05:00Z')); // recovers + newer
		const dispose = dataPulse.subscribe();
		await settle();
		await vi.advanceTimersByTimeAsync(300_000); // the rejecting poll
		await settle();
		expect(mocks.bumpEpoch).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(300_000); // the recovering poll
		await settle();
		expect(mocks.bumpEpoch).toHaveBeenCalledTimes(1);
		dispose();
	});

	it('uses the five-minute fallback when only a live ttl is present', async () => {
		mocks.getManifestFresh.mockResolvedValue(manifestAt('2026-06-20T00:00:00Z', 30, 'live'));
		const dispose = dataPulse.subscribe();
		await settle();
		expect(mocks.getManifestFresh).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(299_999);
		await settle();
		expect(mocks.getManifestFresh).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1);
		await settle();
		expect(mocks.getManifestFresh).toHaveBeenCalledTimes(2);
		dispose();
	});

	it('does not bump the global epoch when only the live tier advances', async () => {
		mocks.getManifestFresh
			.mockResolvedValueOnce(manifestAt('2026-06-20T00:00:00Z', 30, 'live'))
			.mockResolvedValueOnce(manifestAt('2026-06-20T00:05:00Z', 30, 'live'));
		const dispose = dataPulse.subscribe();
		await settle();
		await vi.advanceTimersByTimeAsync(300_000);
		await settle();

		expect(mocks.bumpEpoch).not.toHaveBeenCalled();
		expect(dataPulse.lastSeenMs).toBeNull();
		dispose();
	});

	it('bumps once when both static and historic tiers advance in the same manifest', async () => {
		mocks.getManifestFresh
			.mockResolvedValueOnce(
				manifestTiers({
					static: '2026-06-20T00:00:00Z',
					historic: '2026-06-20T00:00:00Z',
				}),
			)
			.mockResolvedValueOnce(
				manifestTiers({
					static: '2026-06-21T00:00:00Z',
					historic: '2026-06-21T00:00:00Z',
				}),
			);
		const dispose = dataPulse.subscribe();
		await settle();
		await vi.advanceTimersByTimeAsync(300_000);
		await settle();

		expect(mocks.bumpEpoch).toHaveBeenCalledTimes(1);
		dispose();
	});
});

describe('dataPulse — lifecycle', () => {
	let online = true;

	beforeEach(() => {
		vi.useFakeTimers();
		mocks.getManifestFresh.mockReset();
		mocks.getManifestFresh.mockResolvedValue(manifestAt('2026-06-20T00:00:00Z'));
		mocks.bumpEpoch.mockReset();
		dataPulse._resetForTests();
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'visible',
		});
		online = true;
		Object.defineProperty(navigator, 'onLine', {
			configurable: true,
			get: () => online,
		});
	});

	afterEach(() => {
		dataPulse._resetForTests();
		vi.useRealTimers();
	});

	it('is reference-counted: the timer stops only when the LAST reader disposes', async () => {
		const a = dataPulse.subscribe();
		const b = dataPulse.subscribe();
		await settle();
		const callsAfterStart = mocks.getManifestFresh.mock.calls.length;

		a(); // one reader left → timer keeps running
		await vi.advanceTimersByTimeAsync(300_000);
		await settle();
		expect(mocks.getManifestFresh.mock.calls.length).toBeGreaterThan(callsAfterStart);

		b(); // last reader gone → timer stops, no further polls
		const callsAfterStop = mocks.getManifestFresh.mock.calls.length;
		await vi.advanceTimersByTimeAsync(120_000);
		await settle();
		expect(mocks.getManifestFresh.mock.calls.length).toBe(callsAfterStop);
	});

	it('preserves the remaining cadence instead of re-checking after a rapid visibility resume', async () => {
		const dispose = dataPulse.subscribe();
		await settle();
		const callsWhileVisible = mocks.getManifestFresh.mock.calls.length;

		// Tab hidden → the visibilitychange handler stops the timer.
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'hidden',
		});
		document.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(120_000);
		await settle();
		expect(mocks.getManifestFresh.mock.calls.length).toBe(callsWhileVisible);

		// Tab visible again before the cadence is due → no immediate re-check.
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'visible',
		});
		document.dispatchEvent(new Event('visibilitychange'));
		await settle();
		expect(mocks.getManifestFresh.mock.calls.length).toBe(callsWhileVisible);

		await vi.advanceTimersByTimeAsync(179_999);
		await settle();
		expect(mocks.getManifestFresh.mock.calls.length).toBe(callsWhileVisible);

		await vi.advanceTimersByTimeAsync(1);
		await settle();
		expect(mocks.getManifestFresh.mock.calls.length).toBe(callsWhileVisible + 1);
		dispose();
	});

	it('preserves the remaining cadence instead of re-checking after a rapid online resume', async () => {
		const dispose = dataPulse.subscribe();
		await settle();
		const callsBeforeOffline = mocks.getManifestFresh.mock.calls.length;

		online = false;
		window.dispatchEvent(new Event('offline'));
		await vi.advanceTimersByTimeAsync(120_000);

		online = true;
		window.dispatchEvent(new Event('online'));
		await settle();
		expect(mocks.getManifestFresh.mock.calls.length).toBe(callsBeforeOffline);

		await vi.advanceTimersByTimeAsync(180_000);
		await settle();
		expect(mocks.getManifestFresh.mock.calls.length).toBe(callsBeforeOffline + 1);
		dispose();
	});

	it('keeps interval and lifecycle triggers single-flight while a poll is deferred', async () => {
		const pending = deferred<Manifest>();
		mocks.getManifestFresh.mockReturnValue(pending.promise);
		const dispose = dataPulse.subscribe(manifestAt('2026-06-20T00:00:00Z'));
		await settle();
		expect(mocks.getManifestFresh).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(300_000);
		await settle();
		expect(mocks.getManifestFresh).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(300_000);
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'hidden',
		});
		document.dispatchEvent(new Event('visibilitychange'));
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'visible',
		});
		document.dispatchEvent(new Event('visibilitychange'));
		await settle();

		expect(mocks.getManifestFresh).toHaveBeenCalledTimes(1);

		pending.resolve(manifestAt('2026-06-20T00:05:00Z'));
		await settle();
		expect(mocks.bumpEpoch).toHaveBeenCalledTimes(1);
		dispose();
	});

	it('pauses while offline, checks immediately online, and removes lifecycle listeners on dispose', async () => {
		online = false;
		const dispose = dataPulse.subscribe(manifestAt('2026-06-20T00:00:00Z'));
		await vi.advanceTimersByTimeAsync(600_000);
		await settle();
		expect(mocks.getManifestFresh).not.toHaveBeenCalled();

		online = true;
		window.dispatchEvent(new Event('online'));
		await settle();
		expect(mocks.getManifestFresh).toHaveBeenCalledTimes(1);

		online = false;
		window.dispatchEvent(new Event('offline'));
		await vi.advanceTimersByTimeAsync(600_000);
		await settle();
		expect(mocks.getManifestFresh).toHaveBeenCalledTimes(1);

		online = true;
		window.dispatchEvent(new Event('online'));
		await settle();
		expect(mocks.getManifestFresh).toHaveBeenCalledTimes(2);

		dispose();
		window.dispatchEvent(new Event('offline'));
		window.dispatchEvent(new Event('online'));
		document.dispatchEvent(new Event('visibilitychange'));
		await settle();
		expect(mocks.getManifestFresh).toHaveBeenCalledTimes(2);
	});

	it('ignores a deferred manifest that resolves after the tab becomes hidden', async () => {
		const pending = deferred<Manifest>();
		const bootManifest = manifestAt('2026-06-20T00:00:00Z');
		mocks.getManifestFresh.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(bootManifest);
		const dispose = dataPulse.subscribe(bootManifest);
		await settle();
		await vi.advanceTimersByTimeAsync(300_000);
		await settle();
		expect(mocks.getManifestFresh).toHaveBeenCalledTimes(1);

		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'hidden',
		});
		document.dispatchEvent(new Event('visibilitychange'));
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'visible',
		});
		document.dispatchEvent(new Event('visibilitychange'));
		pending.resolve(manifestAt('2026-06-20T00:05:00Z', 3_600));
		await settle();

		expect(mocks.getManifestFresh).toHaveBeenCalledTimes(1);
		expect(mocks.bumpEpoch).not.toHaveBeenCalled();
		expect(dataPulse.lastSeenMs).toBe(Date.parse('2026-06-20T00:00:00Z'));

		await vi.advanceTimersByTimeAsync(300_000);
		await settle();
		expect(mocks.getManifestFresh).toHaveBeenCalledTimes(2);
		dispose();
	});

	it('ignores a deferred manifest that resolves after the browser goes offline', async () => {
		const pending = deferred<Manifest>();
		const bootManifest = manifestAt('2026-06-20T00:00:00Z');
		mocks.getManifestFresh.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(bootManifest);
		const dispose = dataPulse.subscribe(bootManifest);
		await settle();
		await vi.advanceTimersByTimeAsync(300_000);
		await settle();
		expect(mocks.getManifestFresh).toHaveBeenCalledTimes(1);

		online = false;
		window.dispatchEvent(new Event('offline'));
		online = true;
		window.dispatchEvent(new Event('online'));
		pending.resolve(manifestAt('2026-06-20T00:05:00Z', 3_600));
		await settle();

		expect(mocks.getManifestFresh).toHaveBeenCalledTimes(1);
		expect(mocks.bumpEpoch).not.toHaveBeenCalled();
		expect(dataPulse.lastSeenMs).toBe(Date.parse('2026-06-20T00:00:00Z'));

		await vi.advanceTimersByTimeAsync(300_000);
		await settle();
		expect(mocks.getManifestFresh).toHaveBeenCalledTimes(2);
		dispose();
	});

	it('ignores a deferred manifest that resolves after the final reader disposes', async () => {
		const pending = deferred<Manifest>();
		mocks.getManifestFresh.mockReturnValue(pending.promise);
		const bootManifest = manifestAt('2026-06-20T00:00:00Z');
		const dispose = dataPulse.subscribe(bootManifest);
		await settle();
		await vi.advanceTimersByTimeAsync(300_000);
		await settle();
		expect(mocks.getManifestFresh).toHaveBeenCalledTimes(1);

		dispose();
		pending.resolve(manifestAt('2026-06-20T00:05:00Z', 3_600));
		await settle();

		expect(mocks.bumpEpoch).not.toHaveBeenCalled();
		expect(dataPulse.lastSeenMs).toBe(Date.parse('2026-06-20T00:00:00Z'));
	});
});

describe('dataPulse — SSR safety', () => {
	it('subscribe() is a no-op without a browser (no timer, no poll)', async () => {
		vi.resetModules();
		vi.doMock('$app/environment', () => ({ browser: false }));
		const freshSpy = vi.fn();
		vi.doMock('$lib/v1/repositories/manifest', () => ({ getManifestFresh: freshSpy }));
		vi.doMock('./refresh.svelte', () => ({ dataRefresh: { bumpEpoch: vi.fn() } }));
		const { dataPulse: ssrPulse } = await import('./dataPulse.svelte');

		const dispose = ssrPulse.subscribe();
		await Promise.resolve();
		expect(freshSpy).not.toHaveBeenCalled();
		expect(typeof dispose).toBe('function');
		dispose();
		vi.doUnmock('$app/environment');
		vi.doUnmock('$lib/v1/repositories/manifest');
		vi.doUnmock('./refresh.svelte');
		vi.resetModules();
	});
});
