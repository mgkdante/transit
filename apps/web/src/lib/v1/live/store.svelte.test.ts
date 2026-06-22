import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';

// PR-6 skew-immunity proof at the live-store level: the store's `ageSeconds`
// must reflect SERVER age (generated_utc vs the server-anchored clock), NOT a
// skewed client clock. We drive sharedClock with a fixed offset and assert the
// store reports the true server age — i.e. it reads `serverNow`, not `now`.

const mocks = vi.hoisted(() => ({
	browser: true,
	// A controllable shared clock: `now` is the (skewed) client tick; `serverNow`
	// is the corrected server clock. The store under test must use serverNow.
	nowMs: 0,
	offsetMs: 0,
	generatedUtc: '2026-06-21T12:00:00Z' as string | null,
}));

vi.mock('$app/environment', () => ({
	get browser() {
		return mocks.browser;
	},
}));
vi.mock('$lib/stores', () => ({
	sharedClock: {
		get now() {
			return mocks.nowMs;
		},
		get serverNow() {
			return mocks.nowMs + mocks.offsetMs;
		},
		subscribe: () => () => {},
	},
	dataRefresh: {
		get epoch() {
			return 0;
		},
		noteDataGeneratedUtc: () => {},
	},
}));
vi.mock('$lib/v1/adapter', () => ({
	adapter: {
		live: {
			vehicles: async () => ({ generated_utc: mocks.generatedUtc }),
			trips: async () => ({}),
			stopDepartures: async () => ({}),
			alerts: async () => ({}),
			network: async () => ({ generated_utc: mocks.generatedUtc }),
		},
	},
}));

// Static import so the store shares THIS file's compiled Svelte runtime (a
// dynamic import after vi.resetModules would load a second runtime → effect
// orphan). The hoisted mocks above are applied at this import.
import { createLiveStore } from './store.svelte';

describe('createLiveStore — server-anchored ageSeconds (skew-immune)', () => {
	beforeEach(() => {
		mocks.browser = true;
		mocks.generatedUtc = '2026-06-21T12:00:00Z';
	});

	it('reports SERVER age, ignoring a fast client clock', async () => {
		const generated = Date.parse('2026-06-21T12:00:00Z');

		// Client clock is 9 MINUTES FAST: raw `now` is generated + 540s, but the
		// captured server time is only generated + 30s. The corrected serverNow =
		// now + offset must equal generated + 30s, so the age reads 30s, not 570s.
		const trueServerNow = generated + 30_000;
		mocks.nowMs = generated + 9 * 60_000; // skewed client
		mocks.offsetMs = trueServerNow - mocks.nowMs; // = -510s

		// createLiveStore registers an internal `$effect`, so it must be built (and
		// its first refresh kicked off) inside an effect root with a synchronous
		// flushSync; we then wait for the async poll to settle and dispose.
		let store!: ReturnType<typeof createLiveStore>;
		const cleanup = $effect.root(() => {
			store = createLiveStore({
				files: { live: { generated_utc: generated, ttl_s: 30 } },
			} as never);
			void store.refresh();
			flushSync();
		});
		try {
			await vi.waitFor(() => {
				flushSync();
				// 30s server age (NOT 570s) and NOT stale (30 < 3*30).
				expect(store.ageSeconds).toBe(30);
			});
			expect(store.isStale).toBe(false);
		} finally {
			cleanup();
		}
	});
});
