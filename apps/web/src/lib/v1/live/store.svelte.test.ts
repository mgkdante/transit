import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { createSubscriber } from 'svelte/reactivity';

// PR-6 skew-immunity proof at the live-store level: the store's `ageSeconds`
// must reflect SERVER age (generated_utc vs the server-anchored clock), NOT a
// skewed client clock. We drive sharedClock with a fixed offset and assert the
// store reports the true server age — i.e. it reads `serverNow`, not `now`.

const mocks = vi.hoisted(() => {
	const clockDispose = vi.fn();
	return {
		browser: true,
		// A controllable shared clock: `now` is the (skewed) client tick; `serverNow`
		// is the corrected server clock. The store under test must use serverNow.
		nowMs: 0,
		offsetMs: 0,
		generatedUtc: '2026-06-21T12:00:00Z' as string | null,
		visibilityState: 'visible' as DocumentVisibilityState,
		online: true,
		vehicles: vi.fn(),
		trips: vi.fn(),
		stopDepartures: vi.fn(),
		alerts: vi.fn(),
		network: vi.fn(),
		clockDispose,
		clockSubscribe: vi.fn(() => clockDispose),
		noteDataGeneratedUtc: vi.fn(),
		bumpRefreshEpoch: () => {},
		resetRefreshEpoch: () => {},
	};
});

vi.mock('$app/environment', () => ({
	get browser() {
		return mocks.browser;
	},
}));
vi.mock('$lib/stores', async () => {
	const { createSubscriber } = await import('svelte/reactivity');
	let refreshEpoch = 0;
	const subscribe = createSubscriber((update) => {
		mocks.bumpRefreshEpoch = () => {
			refreshEpoch += 1;
			update();
		};
		mocks.resetRefreshEpoch = () => {
			refreshEpoch = 0;
			update();
		};
	});
	return {
		sharedClock: {
			get now() {
				return mocks.nowMs;
			},
			get serverNow() {
				return mocks.nowMs + mocks.offsetMs;
			},
			subscribe: mocks.clockSubscribe,
		},
		dataRefresh: {
			get epoch() {
				subscribe();
				return refreshEpoch;
			},
			noteDataGeneratedUtc: mocks.noteDataGeneratedUtc,
		},
	};
});
vi.mock('$lib/v1/adapter', () => ({
	adapter: {
		live: {
			vehicles: mocks.vehicles,
			trips: mocks.trips,
			stopDepartures: mocks.stopDepartures,
			alerts: mocks.alerts,
			network: mocks.network,
		},
	},
}));

// Static import so the store shares THIS file's compiled Svelte runtime (a
// dynamic import after vi.resetModules would load a second runtime → effect
// orphan). The hoisted mocks above are applied at this import.
import { createLiveStore, type LiveFamily } from './store.svelte';
import { dataRefresh, sharedClock } from '$lib/stores';
import { configureV1Runtime } from '$lib/v1/runtime';
import type { NetworkFile } from '$lib/v1/schemas';

configureV1Runtime({ clock: sharedClock, refresh: dataRefresh });

function resetLiveFetches(): void {
	mocks.resetRefreshEpoch();
	mocks.vehicles
		.mockReset()
		.mockImplementation(async () => ({ generated_utc: mocks.generatedUtc }));
	mocks.trips
		.mockReset()
		.mockImplementation(async () => ({ generated_utc: mocks.generatedUtc, trips: {} }));
	mocks.stopDepartures
		.mockReset()
		.mockImplementation(async () => ({ generated_utc: mocks.generatedUtc, stops: {} }));
	mocks.alerts
		.mockReset()
		.mockImplementation(async () => ({ generated_utc: mocks.generatedUtc, alerts: [] }));
	mocks.network.mockReset().mockImplementation(async () => ({ generated_utc: mocks.generatedUtc }));
	mocks.clockDispose.mockReset();
	mocks.clockSubscribe.mockClear();
	mocks.noteDataGeneratedUtc.mockReset();
}

async function settleLivePoll(): Promise<void> {
	for (let i = 0; i < 4; i += 1) await Promise.resolve();
	flushSync();
}

function mountLiveStore(
	ttlS = 30,
	families?: readonly LiveFamily[],
): {
	store: ReturnType<typeof createLiveStore>;
	manifest: Parameters<typeof createLiveStore>[0];
	dispose: () => void;
} {
	const manifest = {
		files: {
			live: {
				generated_utc: Date.parse(mocks.generatedUtc ?? '2026-06-21T12:00:00Z'),
				ttl_s: ttlS,
			},
		},
	} as never;
	let store!: ReturnType<typeof createLiveStore>;
	const disposeRoot = $effect.root(() => {
		store = createLiveStore(manifest, families ? { families } : undefined);
		flushSync();
	});
	return {
		store,
		manifest,
		dispose: () => {
			store.stop();
			disposeRoot();
		},
	};
}

describe('createLiveStore — server-anchored ageSeconds (skew-immune)', () => {
	beforeEach(() => {
		mocks.browser = true;
		mocks.generatedUtc = '2026-06-21T12:00:00Z';
		resetLiveFetches();
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

describe('createLiveStore — request-conscious browser lifecycle', () => {
	let mounted: Array<ReturnType<typeof mountLiveStore>>;

	beforeEach(() => {
		vi.useFakeTimers();
		mounted = [];
		mocks.browser = true;
		mocks.generatedUtc = '2026-06-21T12:00:00Z';
		mocks.visibilityState = 'visible';
		mocks.online = true;
		resetLiveFetches();
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => mocks.visibilityState,
		});
		Object.defineProperty(navigator, 'onLine', {
			configurable: true,
			get: () => mocks.online,
		});
	});

	afterEach(() => {
		for (const instance of mounted) instance.dispose();
		vi.useRealTimers();
	});

	function setup(ttlS = 30, families?: readonly LiveFamily[]): ReturnType<typeof mountLiveStore> {
		const instance = mountLiveStore(ttlS, families);
		mounted.push(instance);
		return instance;
	}

	it('keeps the 30-second cadence while the page is visible and online', async () => {
		const { store } = setup();
		store.start();
		await settleLivePoll();
		expect(mocks.vehicles).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(29_999);
		await settleLivePoll();
		expect(mocks.vehicles).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1);
		await settleLivePoll();
		expect(mocks.vehicles).toHaveBeenCalledTimes(2);
	});

	it('passes one shared context carrying the authoritative boot manifest to all five reads', async () => {
		const { store, manifest } = setup();

		await store.refresh();
		await settleLivePoll();
		expect(vi.getTimerCount()).toBe(0);

		const reads = [mocks.vehicles, mocks.trips, mocks.stopDepartures, mocks.alerts, mocks.network];
		const contexts = reads.map((read) => read.mock.calls[0]?.[0]);
		expect(contexts[0]).toEqual({ manifest, signal: expect.any(AbortSignal) });
		expect(contexts[0]?.signal.aborted).toBe(false);
		for (const context of contexts) expect(context).toBe(contexts[0]);
	});

	it('keeps the five-family poll as the backward-compatible default', async () => {
		const { store } = setup();

		await store.refresh();

		for (const read of [
			mocks.vehicles,
			mocks.trips,
			mocks.stopDepartures,
			mocks.alerts,
			mocks.network,
		]) {
			expect(read).toHaveBeenCalledOnce();
		}
	});

	it('marks active families loading synchronously when a refresh starts', async () => {
		const { store } = setup(30, ['vehicles']);

		const pending = store.refresh();

		expect(store.loading).toBe(true);
		expect(store.familyStates.vehicles.phase).toBe('loading');

		store.stop();
		await pending;
	});

	it('requests only the selected families and preserves the shared manifest context', async () => {
		const { store, manifest } = setup(30, ['vehicles', 'network']);

		await store.refresh();
		flushSync();

		expect(mocks.vehicles).toHaveBeenCalledOnce();
		expect(mocks.network).toHaveBeenCalledOnce();
		expect(mocks.trips).not.toHaveBeenCalled();
		expect(mocks.stopDepartures).not.toHaveBeenCalled();
		expect(mocks.alerts).not.toHaveBeenCalled();
		expect(mocks.vehicles.mock.calls[0]?.[0]).toBe(mocks.network.mock.calls[0]?.[0]);
		expect(mocks.vehicles.mock.calls[0]?.[0]).toEqual({
			manifest,
			signal: expect.any(AbortSignal),
		});
	});

	it('exposes a network seed synchronously and retains it when the first refresh fails', async () => {
		const seed = {
			generated_utc: '2026-06-21T12:00:00Z',
			vehicles_in_service: 10,
			on_time_pct: 91,
			status_dist: { early: 0, on_time: 9, late: 1, severe: 0, unknown: 0 },
			delay_p50_min: 1,
			delay_p90_min: 6,
			non_responding: 0,
			feed_freshness_s: 20,
			coverage_pct: 100,
		} as unknown as NetworkFile;
		const failure = new Error('network refresh unavailable');
		mocks.network.mockRejectedValueOnce(failure);
		const manifest = {
			files: { live: { generated_utc: Date.parse(seed.generated_utc), ttl_s: 30 } },
		} as never;
		let store!: ReturnType<typeof createLiveStore>;
		const disposeRoot = $effect.root(() => {
			store = createLiveStore(manifest, {
				families: ['network'],
				seed: { network: seed },
			});
			flushSync();
		});

		try {
			expect(mocks.network).not.toHaveBeenCalled();
			expect(store.network).toEqual(seed);
			const retainedSeed = store.network;
			expect(store.generatedUtc).toBe(seed.generated_utc);
			expect(store.loading).toBe(false);
			expect(store.error).toBeNull();
			expect(store.familyStates.network).toEqual({
				phase: 'ready',
				active: true,
				lastGoodAt: null,
				retainedGeneration: seed.generated_utc,
				consecutiveFailures: 0,
				error: null,
				successRevision: 1,
			});

			await store.refresh();
			flushSync();

			expect(mocks.network).toHaveBeenCalledOnce();
			expect(store.network).toBe(retainedSeed);
			expect(store.generatedUtc).toBe(seed.generated_utc);
			expect(store.error).toBe(failure);
			expect(store.familyStates.network).toEqual({
				phase: 'failed',
				active: true,
				lastGoodAt: null,
				retainedGeneration: seed.generated_utc,
				consecutiveFailures: 1,
				error: failure,
				successRevision: 1,
			});
		} finally {
			store.stop();
			disposeRoot();
		}
	});

	it('maps the public departures family to stopDepartures and builds only its index', async () => {
		mocks.stopDepartures.mockResolvedValue({
			generated_utc: mocks.generatedUtc,
			stops: { 'stop-1': [] },
		});
		const { store } = setup(30, ['departures']);

		await store.refresh();
		flushSync();

		expect(mocks.stopDepartures).toHaveBeenCalledOnce();
		expect(mocks.vehicles).not.toHaveBeenCalled();
		expect(mocks.trips).not.toHaveBeenCalled();
		expect(mocks.alerts).not.toHaveBeenCalled();
		expect(mocks.network).not.toHaveBeenCalled();
		expect(store.departures?.stops).toEqual({ 'stop-1': [] });
		expect(store.index.byStopId.has('stop-1')).toBe(true);
		expect(store.index.byVehicleId.size).toBe(0);
		expect(store.index.byTripId.size).toBe(0);
		expect(store.vehicles).toBeNull();
		expect(store.trips).toBeNull();
		expect(store.alerts).toBeNull();
		expect(store.network).toBeNull();
	});

	it('derives freshness and the shared data timestamp from a departures-only store', async () => {
		const generated = Date.parse('2026-06-21T12:00:00Z');
		mocks.nowMs = generated + 30_000;
		mocks.offsetMs = 0;
		const { store } = setup(30, ['departures']);

		await store.refresh();
		flushSync();

		expect(store.generatedUtc).toBe('2026-06-21T12:00:00Z');
		expect(store.ageSeconds).toBe(30);
		expect(mocks.noteDataGeneratedUtc).toHaveBeenCalledWith('2026-06-21T12:00:00Z');
	});

	it('deduplicates repeated family names within one poll', async () => {
		const { store } = setup(30, ['network', 'network']);

		await store.refresh();

		expect(mocks.network).toHaveBeenCalledOnce();
		expect(mocks.vehicles).not.toHaveBeenCalled();
	});

	it('commits successful families and keeps the oldest retained active generation', async () => {
		mocks.vehicles
			.mockResolvedValueOnce({ generated_utc: '2026-06-21T12:00:00Z', vehicles: [] })
			.mockResolvedValueOnce({ generated_utc: '2026-06-21T12:00:30Z', vehicles: [] });
		mocks.network
			.mockResolvedValueOnce({ generated_utc: '2026-06-21T12:00:00Z', on_time_pct: 91 })
			.mockRejectedValueOnce(new Error('network unavailable'));
		const { store } = setup(30, ['vehicles', 'network']);

		await store.refresh();
		flushSync();
		expect(store.generatedUtc).toBe('2026-06-21T12:00:00Z');
		expect(store.network?.on_time_pct).toBe(91);

		await store.refresh();
		flushSync();

		expect(store.error?.message).toBe('network unavailable');
		// WHY(M1): commit-on-settlement lets the healthy vehicles family advance,
		// while aggregate freshness remains the oldest active retained generation.
		expect(store.vehicles?.generated_utc).toBe('2026-06-21T12:00:30Z');
		expect(store.network?.on_time_pct).toBe(91);
		expect(store.generatedUtc).toBe('2026-06-21T12:00:00Z');
	});

	it.each([
		['vehicles', 'vehicles'],
		['trips', 'trips'],
		['departures', 'stopDepartures'],
		['alerts', 'alerts'],
		['network', 'network'],
	] as const)(
		'exposes an isolated %s failure without fabricating failures for inactive families',
		async (family, adapterRead) => {
			const failure = new Error(`${family} unavailable`);
			mocks[adapterRead].mockRejectedValueOnce(failure);
			const { store } = setup(30, [family]);

			await store.refresh();
			flushSync();

			expect(store.familyStates[family]).toEqual({
				phase: 'failed',
				active: true,
				lastGoodAt: null,
				retainedGeneration: null,
				consecutiveFailures: 1,
				error: failure,
				successRevision: 0,
			});
			for (const otherFamily of ['vehicles', 'trips', 'departures', 'alerts', 'network'] as const) {
				if (otherFamily === family) continue;
				expect(store.familyStates[otherFamily]).toEqual({
					phase: 'idle',
					active: false,
					lastGoodAt: null,
					retainedGeneration: null,
					consecutiveFailures: 0,
					error: null,
					successRevision: 0,
				});
			}
			expect(store.error).toBe(failure);
			expect(store.loading).toBe(false);
		},
	);

	it('commits a family before a still-pending sibling later fails', async () => {
		mocks.vehicles.mockResolvedValueOnce({
			generated_utc: '2026-06-21T12:00:00Z',
			vehicles: [],
		});
		mocks.network.mockResolvedValueOnce({
			generated_utc: '2026-06-21T12:00:00Z',
			on_time_pct: 91,
		});
		const { store } = setup(30, ['vehicles', 'network']);
		await store.refresh();
		flushSync();

		let rejectNetwork!: (reason: Error) => void;
		const pendingNetwork = new Promise<never>((_, reject) => {
			rejectNetwork = reject;
		});
		mocks.vehicles.mockResolvedValueOnce({
			generated_utc: '2026-06-21T12:00:30Z',
			vehicles: [],
		});
		mocks.network.mockImplementationOnce(() => pendingNetwork);

		const pendingCycle = store.refresh();
		await settleLivePoll();

		expect(store.vehicles?.generated_utc).toBe('2026-06-21T12:00:30Z');
		expect(store.familyStates.vehicles.phase).toBe('ready');
		expect(store.familyStates.vehicles.successRevision).toBe(2);
		expect(store.familyStates.network.phase).toBe('loading');
		expect(store.loading).toBe(true);
		expect(store.generatedUtc).toBe('2026-06-21T12:00:00Z');

		const failure = new Error('network settled last');
		rejectNetwork(failure);
		await pendingCycle;
		flushSync();

		expect(store.familyStates.network.phase).toBe('failed');
		expect(store.familyStates.network.error).toBe(failure);
		expect(store.vehicles?.generated_utc).toBe('2026-06-21T12:00:30Z');
		expect(store.generatedUtc).toBe('2026-06-21T12:00:00Z');
	});

	it('recovers on an unchanged success without replacing data or advancing successRevision', async () => {
		const generatedUtc = '2026-06-21T12:00:00Z';
		const initialVehicles = { generated_utc: generatedUtc, vehicles: [] };
		const failure = new Error('vehicles unavailable');
		mocks.nowMs = Date.parse(generatedUtc) + 10_000;
		mocks.offsetMs = 0;
		mocks.vehicles
			.mockResolvedValueOnce(initialVehicles)
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce({ generated_utc: generatedUtc, vehicles: [] });
		const { store } = setup(30, ['vehicles']);

		await store.refresh();
		flushSync();
		expect(store.familyStates.vehicles.successRevision).toBe(1);
		expect(store.familyStates.vehicles.lastGoodAt).toBe(Date.parse(generatedUtc) + 10_000);
		const retainedVehicles = store.vehicles;

		await store.refresh();
		flushSync();
		expect(store.familyStates.vehicles.phase).toBe('failed');
		expect(store.familyStates.vehicles.consecutiveFailures).toBe(1);
		expect(store.familyStates.vehicles.error).toBe(failure);

		mocks.nowMs = Date.parse(generatedUtc) + 40_000;
		await store.refresh();
		flushSync();

		expect(store.vehicles).toBe(retainedVehicles);
		expect(store.familyStates.vehicles).toEqual({
			phase: 'ready',
			active: true,
			lastGoodAt: Date.parse(generatedUtc) + 40_000,
			retainedGeneration: generatedUtc,
			consecutiveFailures: 0,
			error: null,
			successRevision: 1,
		});
		expect(store.error).toBeNull();
		expect(mocks.noteDataGeneratedUtc).toHaveBeenCalledTimes(2);
	});

	it('times out only pending families, preserves prior commits, and rejects late settlement', async () => {
		let releaseNetwork!: () => void;
		const lateNetwork = new Promise<{ generated_utc: string; on_time_pct: number }>((resolve) => {
			releaseNetwork = () => {
				resolve({ generated_utc: '2026-06-21T12:00:00Z', on_time_pct: 92 });
			};
		});
		mocks.vehicles.mockResolvedValueOnce({
			generated_utc: '2026-06-21T12:00:00Z',
			vehicles: [],
		});
		mocks.network.mockImplementationOnce(() => lateNetwork);
		const { store } = setup(1, ['vehicles', 'network']);

		const pendingCycle = store.refresh();
		await settleLivePoll();
		expect(store.vehicles?.generated_utc).toBe('2026-06-21T12:00:00Z');
		expect(store.familyStates.vehicles.phase).toBe('ready');
		expect(store.familyStates.network.phase).toBe('loading');

		await vi.advanceTimersByTimeAsync(1_000);
		await pendingCycle;
		flushSync();

		expect(store.vehicles?.generated_utc).toBe('2026-06-21T12:00:00Z');
		expect(store.familyStates.vehicles.phase).toBe('ready');
		expect(store.familyStates.vehicles.consecutiveFailures).toBe(0);
		expect(store.familyStates.network.phase).toBe('failed');
		expect(store.familyStates.network.error?.name).toBe('TimeoutError');
		expect(store.familyStates.network.consecutiveFailures).toBe(1);

		releaseNetwork();
		await settleLivePoll();

		expect(store.network).toBeNull();
		expect(store.familyStates.network.phase).toBe('failed');
		expect(store.familyStates.network.error?.name).toBe('TimeoutError');
		expect(mocks.noteDataGeneratedUtc).toHaveBeenCalledTimes(1);
	});

	it('ref-counts deduplicated leases and makes disposal idempotent', async () => {
		const { store } = setup(30, ['vehicles']);
		const firstLease = store.subscribeFamilies(['trips', 'trips', 'vehicles']);
		await settleLivePoll();

		expect(mocks.trips).toHaveBeenCalledOnce();
		expect(mocks.vehicles).not.toHaveBeenCalled();
		expect(store.familyStates.trips.active).toBe(true);
		expect(store.familyStates.vehicles.active).toBe(true);

		const secondLease = store.subscribeFamilies(['trips']);
		await settleLivePoll();
		expect(mocks.trips).toHaveBeenCalledOnce();

		firstLease();
		firstLease();
		expect(store.familyStates.trips.active).toBe(true);
		expect(store.familyStates.vehicles.active).toBe(true);

		secondLease();
		secondLease();
		expect(store.familyStates.trips.active).toBe(false);
		expect(store.familyStates.vehicles.active).toBe(true);
	});

	it('refreshes a committed vehicle selection once per epoch bump', async () => {
		const { store } = setup(30, ['vehicles', 'alerts']);
		let selectedVehicle = false;
		let publishSelection = () => {};
		const trackSelection = createSubscriber((update) => {
			publishSelection = update;
		});
		const disposeSelection = $effect.root(() => {
			$effect(() => {
				trackSelection();
				if (selectedVehicle) return store.subscribeFamilies(['trips']);
			});
			flushSync();
		});

		try {
			selectedVehicle = true;
			publishSelection();
			flushSync();
			await settleLivePoll();

			expect(mocks.trips).toHaveBeenCalledTimes(1);

			mocks.bumpRefreshEpoch();
			flushSync();
			await settleLivePoll();

			expect(mocks.vehicles).toHaveBeenCalledTimes(1);
			expect(mocks.alerts).toHaveBeenCalledTimes(1);
			expect(mocks.trips).toHaveBeenCalledTimes(2);
		} finally {
			disposeSelection();
		}
	});

	it('fetches a newly active lease beside an unrelated in-flight cycle and excludes it at zero', async () => {
		let releaseVehicles!: () => void;
		const pendingVehicles = new Promise<{ generated_utc: string; vehicles: never[] }>((resolve) => {
			releaseVehicles = () => {
				resolve({ generated_utc: '2026-06-21T12:00:30Z', vehicles: [] });
			};
		});
		mocks.vehicles.mockImplementationOnce(() => pendingVehicles);
		mocks.trips.mockResolvedValueOnce({
			generated_utc: '2026-06-21T12:00:00Z',
			trips: {},
		});
		const { store } = setup(30, ['vehicles']);

		const pendingCycle = store.refresh();
		await settleLivePoll();
		const disposeTrips = store.subscribeFamilies(['trips']);
		await settleLivePoll();

		expect(mocks.vehicles).toHaveBeenCalledOnce();
		expect(mocks.trips).toHaveBeenCalledOnce();
		expect(store.familyStates.vehicles.phase).toBe('loading');
		expect(store.familyStates.trips.phase).toBe('ready');
		expect(store.generatedUtc).toBe('2026-06-21T12:00:00Z');

		releaseVehicles();
		await pendingCycle;
		flushSync();
		expect(store.generatedUtc).toBe('2026-06-21T12:00:00Z');

		disposeTrips();
		expect(store.familyStates.trips.active).toBe(false);
		expect(store.generatedUtc).toBe('2026-06-21T12:00:30Z');
	});

	it('invalidates a leased family request when its refcount falls to zero', async () => {
		let releaseTrips!: () => void;
		const pendingTrips = new Promise<{ generated_utc: string; trips: Record<string, never> }>(
			(resolve) => {
				releaseTrips = () => {
					resolve({ generated_utc: '2026-06-21T12:00:00Z', trips: {} });
				};
			},
		);
		mocks.trips.mockImplementationOnce(() => pendingTrips);
		const { store } = setup(30, []);

		const disposeTrips = store.subscribeFamilies(['trips']);
		await settleLivePoll();
		expect(store.familyStates.trips.phase).toBe('loading');

		disposeTrips();
		expect(store.familyStates.trips).toEqual({
			phase: 'idle',
			active: false,
			lastGoodAt: null,
			retainedGeneration: null,
			consecutiveFailures: 0,
			error: null,
			successRevision: 0,
		});

		releaseTrips();
		await settleLivePoll();

		expect(store.trips).toBeNull();
		expect(store.familyStates.trips.active).toBe(false);
		expect(store.familyStates.trips.successRevision).toBe(0);
		expect(mocks.noteDataGeneratedUtc).not.toHaveBeenCalled();
	});

	it('derives vehicle motion freshness independently from an old retained alerts family', async () => {
		mocks.nowMs = Date.parse('2026-06-21T12:01:00Z');
		mocks.offsetMs = 0;
		const alertsFailure = new Error('alerts unavailable');
		mocks.vehicles
			.mockResolvedValueOnce({
				generated_utc: '2026-06-21T12:00:00Z',
				vehicles: [],
			})
			.mockResolvedValueOnce({
				generated_utc: '2026-06-21T12:00:30Z',
				vehicles: [],
			});
		mocks.alerts
			.mockResolvedValueOnce({
				generated_utc: '2026-06-21T11:58:00Z',
				alerts: [],
			})
			.mockRejectedValueOnce(alertsFailure);
		const { store } = setup(30, ['vehicles', 'alerts']);

		await store.refresh();
		flushSync();
		expect(store.generatedUtc).toBe('2026-06-21T11:58:00Z');
		expect(store.isStale).toBe(true);
		expect(store.vehiclesGeneratedUtc).toBe('2026-06-21T12:00:00Z');
		expect(store.vehiclesAgeSeconds).toBe(60);
		expect(store.vehiclesIsStale).toBe(false);

		await store.refresh();
		flushSync();
		expect(store.familyStates.alerts.phase).toBe('failed');
		expect(store.generatedUtc).toBe('2026-06-21T11:58:00Z');
		expect(store.isStale).toBe(true);
		expect(store.vehiclesGeneratedUtc).toBe('2026-06-21T12:00:30Z');
		expect(store.vehiclesAgeSeconds).toBe(30);
		expect(store.vehiclesIsStale).toBe(false);
	});

	it('preserves family and index identity when its generation is unchanged', async () => {
		const generatedUtc = '2026-06-21T12:00:00Z';
		mocks.vehicles
			.mockResolvedValueOnce({ generated_utc: generatedUtc, vehicles: [] })
			.mockResolvedValueOnce({ generated_utc: generatedUtc, vehicles: [] });
		const { store } = setup(30, ['vehicles']);

		await store.refresh();
		flushSync();
		const firstVehicles = store.vehicles;
		const firstIndex = store.index;

		await store.refresh();
		flushSync();

		expect.soft(store.vehicles).toBe(firstVehicles);
		expect.soft(store.index).toBe(firstIndex);
	});

	it('updates only the family whose generation advances', async () => {
		mocks.vehicles
			.mockResolvedValueOnce({ generated_utc: '2026-06-21T12:00:00Z', vehicles: [] })
			.mockResolvedValueOnce({ generated_utc: '2026-06-21T12:00:30Z', vehicles: [] });
		mocks.network
			.mockResolvedValueOnce({ generated_utc: '2026-06-21T12:00:00Z' })
			.mockResolvedValueOnce({ generated_utc: '2026-06-21T12:00:00Z' });
		const { store } = setup(30, ['vehicles', 'network']);

		await store.refresh();
		flushSync();
		const firstVehicles = store.vehicles;
		const firstNetwork = store.network;
		const firstIndex = store.index;

		await store.refresh();
		flushSync();

		expect.soft(store.vehicles).not.toBe(firstVehicles);
		expect.soft(store.vehicles?.generated_utc).toBe('2026-06-21T12:00:30Z');
		expect.soft(store.network).toBe(firstNetwork);
		expect.soft(store.index).not.toBe(firstIndex);
		expect.soft(store.generatedUtc).toBe('2026-06-21T12:00:00Z');
	});

	it('does not start requests while hidden and starts exactly once when shown', async () => {
		mocks.visibilityState = 'hidden';
		const { store } = setup();
		store.start();
		await settleLivePoll();
		expect(mocks.vehicles).not.toHaveBeenCalled();

		mocks.visibilityState = 'visible';
		document.dispatchEvent(new Event('visibilitychange'));
		await settleLivePoll();
		expect(mocks.vehicles).toHaveBeenCalledTimes(1);
	});

	it('pauses while hidden, then performs one immediate refresh without duplicating the timer', async () => {
		const { store } = setup();
		store.start();
		await settleLivePoll();
		expect(mocks.vehicles).toHaveBeenCalledTimes(1);

		mocks.visibilityState = 'hidden';
		document.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(90_000);
		await settleLivePoll();
		expect(mocks.vehicles).toHaveBeenCalledTimes(1);

		mocks.visibilityState = 'visible';
		document.dispatchEvent(new Event('visibilitychange'));
		await settleLivePoll();
		expect(mocks.vehicles).toHaveBeenCalledTimes(2);

		// A duplicate visible event must neither refresh again nor add a second timer.
		document.dispatchEvent(new Event('visibilitychange'));
		await settleLivePoll();
		expect(mocks.vehicles).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(30_000);
		await settleLivePoll();
		expect(mocks.vehicles).toHaveBeenCalledTimes(3);
	});

	it('pauses while offline, then performs one immediate refresh without duplicating the timer', async () => {
		const { store } = setup();
		store.start();
		await settleLivePoll();
		expect(mocks.vehicles).toHaveBeenCalledTimes(1);

		mocks.online = false;
		window.dispatchEvent(new Event('offline'));
		await vi.advanceTimersByTimeAsync(90_000);
		await settleLivePoll();
		expect(mocks.vehicles).toHaveBeenCalledTimes(1);

		mocks.online = true;
		window.dispatchEvent(new Event('online'));
		await settleLivePoll();
		expect(mocks.vehicles).toHaveBeenCalledTimes(2);

		// A duplicate online event must neither refresh again nor add a second timer.
		window.dispatchEvent(new Event('online'));
		await settleLivePoll();
		expect(mocks.vehicles).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(30_000);
		await settleLivePoll();
		expect(mocks.vehicles).toHaveBeenCalledTimes(3);
	});

	it('removes lifecycle work on stop so later browser events cannot restart it', async () => {
		const { store } = setup();
		store.start();
		await settleLivePoll();
		expect(mocks.vehicles).toHaveBeenCalledTimes(1);

		store.stop();
		mocks.visibilityState = 'hidden';
		document.dispatchEvent(new Event('visibilitychange'));
		mocks.visibilityState = 'visible';
		document.dispatchEvent(new Event('visibilitychange'));
		mocks.online = false;
		window.dispatchEvent(new Event('offline'));
		mocks.online = true;
		window.dispatchEvent(new Event('online'));
		await vi.advanceTimersByTimeAsync(90_000);
		await settleLivePoll();

		expect(mocks.vehicles).toHaveBeenCalledTimes(1);
		expect(mocks.clockDispose).toHaveBeenCalledTimes(1);
	});

	it('aborts an in-flight batch on stop and never commits its late result', async () => {
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		mocks.vehicles.mockImplementation(async () => {
			await blocked;
			return { generated_utc: '2026-06-21T12:00:30Z', vehicles: [] };
		});
		const { store } = setup(30, ['vehicles']);

		const pending = store.refresh();
		await settleLivePoll();
		const context = mocks.vehicles.mock.calls[0]?.[0];
		expect(context?.signal.aborted).toBe(false);

		store.stop();
		expect(context?.signal.aborted).toBe(true);
		release();
		await pending;
		flushSync();

		expect(store.vehicles).toBeNull();
		expect(store.generatedUtc).toBeNull();
		expect(store.error).toBeNull();
		expect(store.loading).toBe(false);
		expect(mocks.noteDataGeneratedUtc).not.toHaveBeenCalled();
	});

	it('times out a hung family batch and releases single-flight for recovery', async () => {
		let releaseLate!: () => void;
		const lateResult = new Promise<{ generated_utc: string; vehicles: never[] }>((resolve) => {
			releaseLate = () => {
				resolve({ generated_utc: '2026-06-21T12:00:15Z', vehicles: [] });
			};
		});
		mocks.vehicles.mockImplementationOnce(() => lateResult);
		const { store } = setup(1, ['vehicles']);

		let firstSettled = false;
		void store.refresh().then(
			() => {
				firstSettled = true;
			},
			() => {
				firstSettled = true;
			},
		);
		await settleLivePoll();
		const signal = mocks.vehicles.mock.calls[0]?.[0]?.signal;
		expect(signal).toBeDefined();

		await vi.advanceTimersByTimeAsync(1_000);
		await settleLivePoll();

		expect.soft(signal?.aborted).toBe(true);
		expect.soft(firstSettled).toBe(true);
		expect.soft(store.loading).toBe(false);
		expect.soft(store.error?.name).toBe('TimeoutError');
		expect.soft(store.vehicles).toBeNull();

		mocks.vehicles.mockResolvedValueOnce({
			generated_utc: '2026-06-21T12:00:30Z',
			vehicles: [],
		});
		let retrySettled = false;
		void store.refresh().then(
			() => {
				retrySettled = true;
			},
			() => {
				retrySettled = true;
			},
		);
		await settleLivePoll();

		expect.soft(mocks.vehicles).toHaveBeenCalledTimes(2);
		expect.soft(retrySettled).toBe(true);
		expect.soft(store.vehicles?.generated_utc).toBe('2026-06-21T12:00:30Z');
		expect.soft(store.error).toBeNull();
		expect.soft(mocks.noteDataGeneratedUtc).toHaveBeenCalledTimes(1);

		releaseLate();
		await settleLivePoll();

		expect.soft(store.vehicles?.generated_utc).toBe('2026-06-21T12:00:30Z');
		expect.soft(mocks.noteDataGeneratedUtc).toHaveBeenCalledTimes(1);
	});

	it('keeps timeout silent after stop when a transport ignores abort', async () => {
		mocks.vehicles.mockImplementationOnce(() => new Promise<never>(() => {}));
		const { store } = setup(1, ['vehicles']);
		const pending = store.refresh();
		await settleLivePoll();

		store.stop();
		await vi.advanceTimersByTimeAsync(1_000);
		await pending;
		flushSync();

		expect.soft(store.error).toBeNull();
		expect.soft(store.loading).toBe(false);
	});

	it('treats the AbortError caused by stop as lifecycle control, not a data error', async () => {
		mocks.vehicles.mockImplementation(
			(context: { signal: AbortSignal }) =>
				new Promise((_, reject) => {
					context.signal.addEventListener(
						'abort',
						() => reject(new DOMException('Aborted', 'AbortError')),
						{ once: true },
					);
				}),
		);
		const { store } = setup(30, ['vehicles']);

		const pending = store.refresh();
		await settleLivePoll();
		store.stop();
		await pending;
		flushSync();

		expect(store.error).toBeNull();
		expect(store.loading).toBe(false);
	});

	it('shares one in-flight batch across manual, timer, visibility, and epoch refreshes', async () => {
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		mocks.vehicles.mockImplementation(async () => {
			await blocked;
			return { generated_utc: mocks.generatedUtc };
		});
		mocks.trips.mockImplementation(async () => {
			await blocked;
			return {};
		});
		mocks.stopDepartures.mockImplementation(async () => {
			await blocked;
			return {};
		});
		mocks.alerts.mockImplementation(async () => {
			await blocked;
			return {};
		});
		mocks.network.mockImplementation(async () => {
			await blocked;
			return { generated_utc: mocks.generatedUtc };
		});

		const { store } = setup();
		store.start();
		const manualA = store.refresh();
		const manualB = store.refresh();

		mocks.visibilityState = 'hidden';
		document.dispatchEvent(new Event('visibilitychange'));
		mocks.visibilityState = 'visible';
		document.dispatchEvent(new Event('visibilitychange'));
		mocks.bumpRefreshEpoch();
		await settleLivePoll();
		await vi.advanceTimersByTimeAsync(30_000);

		for (const fetch of [
			mocks.vehicles,
			mocks.trips,
			mocks.stopDepartures,
			mocks.alerts,
			mocks.network,
		]) {
			expect(fetch).toHaveBeenCalledTimes(1);
		}

		release();
		await Promise.all([manualA, manualB]);
		await settleLivePoll();
		await store.refresh();
		expect(mocks.vehicles).toHaveBeenCalledTimes(2);
	});
});
