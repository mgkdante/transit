import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// sharedClock's server-time anchor (PR-6 clock-skew fix). `serverNow` is the
// freshness clock: the per-second client tick PLUS a recorded client→server
// offset, so age computed against it is immune to a skewed client clock.

const mocks = vi.hoisted(() => ({ browser: true }));
vi.mock('$app/environment', () => ({
	get browser() {
		return mocks.browser;
	},
}));
vi.mock('$lib/motion/reduced-motion.svelte', () => ({
	isPrefersReducedMotion: () => false,
}));

async function loadClock() {
	vi.resetModules();
	return import('./clock.svelte');
}

describe('sharedClock — server-time anchor', () => {
	beforeEach(() => {
		mocks.browser = true;
		vi.useFakeTimers();
		// Pin the client clock so `Date.now()` is deterministic.
		vi.setSystemTime(new Date('2026-06-21T12:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('defaults to zero offset: serverNow === now before any sample', async () => {
		const { sharedClock } = await loadClock();
		expect(sharedClock.serverNow).toBe(sharedClock.now);
	});

	it('noteServerEpochMs sets the offset to serverEpoch - Date.now()', async () => {
		const { sharedClock } = await loadClock();
		const clientNow = Date.now();
		// Server reports a time 9 minutes AHEAD of the (skewed) client clock.
		const serverEpoch = clientNow + 9 * 60_000;

		sharedClock.noteServerEpochMs(serverEpoch);

		// serverNow == now + offset == clientNow + 9min.
		expect(sharedClock.serverNow).toBe(sharedClock.now + 9 * 60_000);
		expect(sharedClock.serverNow).toBe(serverEpoch);
	});

	it('serverNow stays equal to now + offset as the client tick advances', async () => {
		const { sharedClock } = await loadClock();
		const serverEpoch = Date.now() - 5_000; // client is 5s fast
		sharedClock.noteServerEpochMs(serverEpoch);

		const before = sharedClock.serverNow;
		sharedClock.subscribe();
		await vi.advanceTimersByTimeAsync(3_000);

		// Both now and serverNow advanced by the same 3s; the offset is preserved.
		expect(sharedClock.serverNow - before).toBe(3_000);
		expect(sharedClock.serverNow).toBe(sharedClock.now - 5_000);
	});

	it('latest valid sample wins', async () => {
		const { sharedClock } = await loadClock();
		sharedClock.noteServerEpochMs(Date.now() + 60_000);
		sharedClock.noteServerEpochMs(Date.now() + 1_000);
		expect(sharedClock.serverNow).toBe(sharedClock.now + 1_000);
	});

	it('ignores a non-finite sample (NaN / Infinity must not poison the offset)', async () => {
		const { sharedClock } = await loadClock();
		sharedClock.noteServerEpochMs(Date.now() + 10_000);
		const good = sharedClock.serverNow;

		sharedClock.noteServerEpochMs(Number.NaN);
		sharedClock.noteServerEpochMs(Number.POSITIVE_INFINITY);

		expect(sharedClock.serverNow).toBe(good);
	});

	it('no-ops without a browser: offset stays 0, serverNow === now', async () => {
		mocks.browser = false;
		const { sharedClock } = await loadClock();
		sharedClock.noteServerEpochMs(Date.now() + 99_000);
		expect(sharedClock.serverNow).toBe(sharedClock.now);
	});
});
