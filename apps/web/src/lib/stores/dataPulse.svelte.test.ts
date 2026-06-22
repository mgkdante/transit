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

/** Build a manifest carrying a given newest generated_utc on the live tier. */
function manifestAt(generatedUtc: string | null, ttlS = 30): Manifest {
	return {
		files: { live: { generated_utc: generatedUtc, ttl_s: ttlS } },
	} as unknown as Manifest;
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

	it('bumps the epoch on a strictly NEWER publish', async () => {
		mocks.getManifestFresh
			.mockResolvedValueOnce(manifestAt('2026-06-20T00:00:00Z')) // seed
			.mockResolvedValueOnce(manifestAt('2026-06-20T00:05:00Z')); // newer
		const dispose = dataPulse.subscribe();
		await settle(); // seed poll

		await vi.advanceTimersByTimeAsync(30_000); // next poll
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
		await vi.advanceTimersByTimeAsync(30_000);
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
		await vi.advanceTimersByTimeAsync(30_000);
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
		await vi.advanceTimersByTimeAsync(30_000); // the rejecting poll
		await settle();
		expect(mocks.bumpEpoch).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(30_000); // the recovering poll
		await settle();
		expect(mocks.bumpEpoch).toHaveBeenCalledTimes(1);
		dispose();
	});
});

describe('dataPulse — lifecycle', () => {
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
		await vi.advanceTimersByTimeAsync(30_000);
		await settle();
		expect(mocks.getManifestFresh.mock.calls.length).toBeGreaterThan(callsAfterStart);

		b(); // last reader gone → timer stops, no further polls
		const callsAfterStop = mocks.getManifestFresh.mock.calls.length;
		await vi.advanceTimersByTimeAsync(120_000);
		await settle();
		expect(mocks.getManifestFresh.mock.calls.length).toBe(callsAfterStop);
	});

	it('PAUSES polling while the tab is hidden and resumes (re-checks) on visibility', async () => {
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

		// Tab visible again → immediate re-check.
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => 'visible',
		});
		document.dispatchEvent(new Event('visibilitychange'));
		await settle();
		expect(mocks.getManifestFresh.mock.calls.length).toBeGreaterThan(callsWhileVisible);
		dispose();
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
