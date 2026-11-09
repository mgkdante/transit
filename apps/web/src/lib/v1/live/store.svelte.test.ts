import { createMemoryLiveReader } from './__fixtures__/reader';
import { clock } from '@yesid/ui/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { createSubscriber } from 'svelte/reactivity';

const mocks = vi.hoisted(() => {
	const clockDispose = vi.fn();
	return {
		browser: true,
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
		bumpRefreshEpoch: () => {},
		resetRefreshEpoch: () => {},
	};
});

vi.mock('$app/env', () => ({
	get browser() {
		return mocks.browser;
	},
}));
vi.mock('@yesid/ui/state', async (importOriginal) => ({
	...(await importOriginal<typeof import('@yesid/ui/state')>()),
	clock: {
		get now() {
			return mocks.nowMs;
		},
		get serverNow() {
			return mocks.nowMs + mocks.offsetMs;
		},
		subscribe: mocks.clockSubscribe,
	},
}));
vi.mock('#lib/stores/index.ts', async () => {
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
		dataRefresh: {
			get epoch() {
				subscribe();
				return refreshEpoch;
			},
		},
	};
});
const reader = createMemoryLiveReader();
Object.assign(mocks, reader);

import { createLiveStore, type LiveFamily } from './store.svelte';
import { livePresentation } from './livePresentation';
import { LIVE_FAMILIES, type LiveStore } from './store.svelte';
const present = (store: Pick<LiveStore, 'familyStates'>) =>
	livePresentation({
		familyStates: store.familyStates,
		families: LIVE_FAMILIES,
		locale: 'en',
		page: 'map',
	});
import { dataRefresh } from '#lib/stores/index.ts';
import { configureV1Runtime } from '#lib/v1/runtime.ts';
import type { NetworkFile } from '#lib/v1/schemas/index.ts';
import { createSelectionGrace } from '#lib/features/map/selectionSession/selectionGrace.svelte.ts';

configureV1Runtime({ clock, refresh: dataRefresh });

describe('Live age excludes service alerts', () => {
	it.each([
		[40, 300, true],
		[40, 901, true],
		[120, 300, true],
		[120, 901, true],
		[40, 0, false],
		[120, 0, false],
	] as const)(
		'vehicle age %s, alert age %s, alerts active %s',
		async (vehicleAge, alertAge, hasAlerts) => {
			mocks.browser = true;
			mocks.nowMs = Date.parse('2026-06-21T12:00:00Z');
			mocks.offsetMs = 0;
			resetLiveFetches();
			const vehicleGeneration = new Date(mocks.nowMs - vehicleAge * 1000).toISOString();
			mocks.vehicles.mockResolvedValue({ generated_utc: vehicleGeneration, vehicles: [] });
			mocks.alerts.mockResolvedValue({
				generated_utc: new Date(mocks.nowMs - 60_000).toISOString(),
				feed_captured_utc: new Date(mocks.nowMs - alertAge * 1000).toISOString(),
				alerts: [],
			});
			const mounted = mountLiveStore(30, hasAlerts ? ['vehicles', 'alerts'] : ['vehicles']);
			try {
				await mounted.store.refresh();
				flushSync();
				const store = mounted.store;
				expect(present(store).publicationUtc).toBe(vehicleGeneration);
				expect(present(store).stamp.ageSeconds).toBe(vehicleAge);
				expect(present(store).stamp.isStale).toBe(vehicleAge >= 90);
				expect(present(store).isPartialStale).toBe(false);
				if (hasAlerts) expect(store.familyStates.alerts.health.isStale).toBe(alertAge >= 900);
				expect(present(store).bannerState).toBe(vehicleAge >= 90 ? 'global-stall' : 'idle');
			} finally {
				mounted.dispose();
			}
		},
	);
});

describe('partial feed capture health', () => {
	it.each([
		['alerts', 900, mocks.alerts, { alerts: [] }],
		['trips', 300, mocks.trips, { trips: {} }],
		['departures', 300, mocks.stopDepartures, { stops: {} }],
	] as const)(
		'ages %s capture independently from publication and other families',
		async (family, limit, fetcher, body) => {
			mocks.browser = true;
			mocks.generatedUtc = '2026-06-21T12:00:00Z';
			mocks.nowMs = Date.parse(mocks.generatedUtc);
			mocks.offsetMs = 0;
			resetLiveFetches();
			const mounted = mountLiveStore(30, [family, 'vehicles']);
			try {
				// Legacy publisher: absence keeps publication-age health.
				await mounted.store.refresh();
				expect(mounted.store.familyStates[family].health).toMatchObject({
					state: 'live',
					ageSource: 'publication',
					ageTimestamp: mocks.generatedUtc,
				});
				for (const [capture, stale] of [
					[new Date(mocks.nowMs - (limit - 1) * 1000).toISOString(), false],
					[new Date(mocks.nowMs - limit * 1000).toISOString(), true],
					[null, true],
					['invalid', true],
					[new Date(mocks.nowMs + 31_000).toISOString(), true],
				] as const) {
					fetcher.mockResolvedValueOnce({
						generated_utc: mocks.generatedUtc,
						...body,
						feed_captured_utc: capture,
					});
					await mounted.store.refresh();
					expect(mounted.store.familyStates[family].health.isStale).toBe(stale);
					const knownCapture =
						capture != null &&
						Number.isFinite(Date.parse(capture)) &&
						Date.parse(capture) <= mocks.nowMs;
					expect(mounted.store.familyStates[family].health).toMatchObject({
						ageSource: knownCapture ? 'serving-capture' : null,
						ageTimestamp: knownCapture ? capture : null,
					});
					expect(mounted.store.familyStates[family].health.notice).toBe(stale ? 'stale' : null);
					expect(mounted.store.familyStates.vehicles.health.state).toBe('live');
				}
				// A new capture also cannot hide an old publication.
				fetcher.mockResolvedValueOnce({
					generated_utc: new Date(mocks.nowMs - 90_000).toISOString(),
					...body,
					feed_captured_utc: mocks.generatedUtc,
				});
				await mounted.store.refresh();
				expect(mounted.store.familyStates[family].health).toMatchObject({
					isStale: true,
					ageSource: 'publication',
					ageTimestamp: new Date(mocks.nowMs - 90_000).toISOString(),
				});
			} finally {
				mounted.dispose();
			}
		},
	);
});

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
		store = createLiveStore(manifest, reader, families ? { families } : undefined);
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

		const trueServerNow = generated + 30_000;
		mocks.nowMs = generated + 9 * 60_000;
		mocks.offsetMs = trueServerNow - mocks.nowMs;

		let store!: ReturnType<typeof createLiveStore>;
		const cleanup = $effect.root(() => {
			store = createLiveStore(
				{
					files: { live: { generated_utc: generated, ttl_s: 30 } },
				} as never,
				reader,
			);
			void store.refresh();
			flushSync();
		});
		try {
			await vi.waitFor(() => {
				flushSync();
				expect(present(store).stamp.ageSeconds).toBe(30);
			});
			expect(present(store).stamp.isStale).toBe(false);
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

	it('exposes feed health without making an unknown age fresh', async () => {
		mocks.nowMs = Date.parse('2026-06-21T12:00:10Z');
		mocks.offsetMs = 0;
		const { store } = setup(30, ['vehicles']);
		expect(store.familyStates.vehicles.health).toMatchObject({
			state: 'never-loaded',
			ageSeconds: null,
			isStale: false,
			retained: false,
			notice: null,
		});
		expect(present(store).stamp.isStale).toBe(false);
		expect(present(store).stamp.ageSeconds).toBeNull();
		await store.refresh();
		flushSync();
		expect(store.familyStates.vehicles.health).toMatchObject({
			state: 'live',
			ageSeconds: 10,
			isStale: false,
			retained: true,
			notice: null,
		});
		expect(store.familyStates.vehicles).not.toHaveProperty('consecutiveFailures');
	});

	it('keeps the aggregate quiet while first loads are pending and uses only loaded family ages', async () => {
		mocks.nowMs = Date.parse('2026-06-21T12:00:10Z');
		mocks.offsetMs = 0;
		let finishVehicles!: () => void;
		let finishAlerts!: () => void;
		mocks.vehicles.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishVehicles = () => resolve({ generated_utc: mocks.generatedUtc, vehicles: [] });
				}),
		);
		mocks.alerts.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishAlerts = () => resolve({ generated_utc: mocks.generatedUtc, alerts: [] });
				}),
		);
		const { store } = setup(30, ['vehicles', 'alerts']);
		const pending = store.refresh();
		await settleLivePoll();
		expect(store.familyStates.vehicles.health.state).toBe('never-loaded');
		expect(store.familyStates.alerts.health.state).toBe('never-loaded');
		expect(present(store).stamp.isStale).toBe(false);
		finishVehicles();
		await settleLivePoll();
		expect(store.vehicles).not.toBeNull();
		expect(store.familyStates.alerts.phase).toBe('loading');
		expect(present(store).stamp.isStale).toBe(false);
		expect(present(store).stamp.ageSeconds).toBe(10);
		finishAlerts();
		await pending;
	});

	it('does not raise a stale warning when no feed family is active', () => {
		const { store } = setup(30, []);
		expect(present(store).stamp.isStale).toBe(false);
		expect(present(store).stamp.ageSeconds).toBeNull();
	});

	it.each([
		{ ttl: 30, age: 59, stale: false },
		{ ttl: 30, age: 60, stale: false },
		{ ttl: 30, age: 89, stale: false },
		{ ttl: 30, age: 90, stale: true },
		{ ttl: 10, age: 29, stale: false },
		{ ttl: 10, age: 30, stale: true },
	])('uses one inclusive three-TTL rule at ttl=$ttl, age=$age', async ({ ttl, age, stale }) => {
		mocks.nowMs = Date.parse('2026-06-21T12:00:00Z') + age * 1000;
		mocks.offsetMs = 0;
		const { store } = setup(ttl, ['vehicles']);
		await store.refresh();
		flushSync();
		expect(store.familyStates.vehicles.health).toEqual({
			ageSource: 'publication',
			ageTimestamp: '2026-06-21T12:00:00Z',
			state: stale ? 'retained-stale' : 'live',
			ageSeconds: age,
			isStale: stale,
			retained: true,
			notice: stale ? 'stale' : null,
		});
		expect(present(store).stamp.isStale).toBe(stale);
		expect(store.familyStates.vehicles.health.isStale).toBe(stale);
	});

	it.each([null, undefined, 'not-a-date'])(
		'keeps a retained snapshot with unknown age (%s) stale',
		async (generatedUtc) => {
			mocks.nowMs = Date.parse('2026-06-21T12:00:10Z');
			mocks.offsetMs = 0;
			const { store } = setup(30, ['vehicles']);
			await store.refresh();
			mocks.vehicles.mockResolvedValueOnce({ generated_utc: generatedUtc, vehicles: [] });
			await store.refresh();
			flushSync();
			expect(store.familyStates.vehicles.health).toEqual({
				ageSource: null,
				ageTimestamp: null,
				state: 'retained-stale',
				ageSeconds: null,
				isStale: true,
				retained: true,
				notice: 'stale',
			});
			expect(present(store).stamp.ageSeconds).toBeNull();
			expect(present(store).stamp.isStale).toBe(true);
			expect(store.familyStates.vehicles.health.isStale).toBe(true);
		},
	);

	it('keeps a recent retained report through failed refresh and retry, then clears the notice on recovery', async () => {
		mocks.nowMs = Date.parse('2026-06-21T12:00:10Z');
		mocks.offsetMs = 0;
		const { store } = setup(30, ['trips']);
		await store.refresh();
		const retained = store.trips;
		mocks.trips.mockRejectedValueOnce(new Error('offline'));
		await store.refresh();
		flushSync();
		expect(store.trips).toBe(retained);
		expect(store.familyStates.trips.health).toEqual({
			ageSource: 'publication',
			ageTimestamp: '2026-06-21T12:00:00Z',
			state: 'retained-stale',
			ageSeconds: 10,
			isStale: false,
			retained: true,
			notice: 'refresh-unavailable',
		});
		let finish!: () => void;
		mocks.trips.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = () => resolve({ generated_utc: mocks.generatedUtc, trips: {} });
				}),
		);
		const pending = store.refresh();
		await settleLivePoll();
		expect(store.familyStates.trips.health).toMatchObject({
			state: 'retrying',
			retained: true,
			notice: 'refresh-unavailable',
		});
		finish();
		await pending;
		flushSync();
		expect(store.familyStates.trips.health).toMatchObject({ state: 'live', notice: null });
	});

	it('reports an unknown-age retained snapshot as retrying only while its retry is in flight', async () => {
		mocks.vehicles.mockResolvedValueOnce({ generated_utc: null, vehicles: [] });
		const { store } = setup(30, ['vehicles']);
		const grace = createSelectionGrace<{ id: string }>();
		const selection = { kind: 'vehicle', id: 'bus-1' } as const;
		const detail = { id: selection.id };
		const updateSelection = () =>
			grace.update({ selection, resolvedDetail: detail, vehicles: store.familyStates.vehicles });
		await store.refresh();
		flushSync();
		expect(store.familyStates.vehicles.health.notice).toBe('stale');
		expect(updateSelection().sourceHealth).toBe('ok');
		const failure = new Error('refresh unavailable');
		mocks.vehicles.mockRejectedValueOnce(failure);
		await store.refresh();
		flushSync();
		expect(store.familyStates.vehicles.health).toEqual({
			ageSource: null,
			ageTimestamp: null,
			state: 'retained-stale',
			ageSeconds: null,
			isStale: true,
			retained: true,
			notice: 'refresh-unavailable',
		});
		expect(store.familyStates.vehicles.error).toBe(failure);
		expect(updateSelection().sourceHealth).toBe('failed');
		let failRetry!: (error: Error) => void;
		mocks.vehicles.mockImplementationOnce(
			() =>
				new Promise((_resolve, reject) => {
					failRetry = reject;
				}),
		);
		const pending = store.refresh();
		await settleLivePoll();
		expect(store.familyStates.vehicles.phase).toBe('loading');
		expect.soft(store.familyStates.vehicles.health).toEqual({
			ageSource: null,
			ageTimestamp: null,
			state: 'retrying',
			ageSeconds: null,
			isStale: true,
			retained: true,
			notice: 'refresh-unavailable',
		});
		expect.soft(updateSelection().sourceHealth).toBe('retrying');
		const retryFailure = new Error('retry unavailable');
		failRetry(retryFailure);
		await pending;
		flushSync();
		expect(store.familyStates.vehicles.phase).toBe('failed');
		expect(store.familyStates.vehicles.health).toEqual({
			ageSource: null,
			ageTimestamp: null,
			state: 'retained-stale',
			ageSeconds: null,
			isStale: true,
			retained: true,
			notice: 'refresh-unavailable',
		});
		expect(store.familyStates.vehicles.error).toBe(retryFailure);
		expect(updateSelection().sourceHealth).toBe('failed');
	});

	it('distinguishes failure without data from a retry without data', async () => {
		mocks.alerts.mockRejectedValueOnce(new Error('offline'));
		const { store } = setup(30, ['alerts']);
		await store.refresh();
		flushSync();
		expect(store.familyStates.alerts.health).toEqual({
			ageSource: null,
			ageTimestamp: null,
			state: 'failed-no-data',
			ageSeconds: null,
			isStale: true,
			retained: false,
			notice: 'refresh-unavailable',
		});
		let finish!: () => void;
		mocks.alerts.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = () => resolve({ generated_utc: mocks.generatedUtc, alerts: [] });
				}),
		);
		const pending = store.refresh();
		await settleLivePoll();
		expect(store.familyStates.alerts.health).toMatchObject({ state: 'retrying', retained: false });
		expect(store.familyStates.alerts.health.isStale).toBe(false);
		expect(present(store).stamp.isStale).toBe(false);
		finish();
		await pending;
	});

	it('updates age and the stale notice on clock ticks without polling again', async () => {
		let now = $state(Date.parse('2026-06-21T12:01:29Z'));
		const restoreRuntime = configureV1Runtime({
			clock: {
				get serverNow() {
					return now;
				},
				noteServerEpochMs: () => {},
				subscribe: () => () => {},
			},
		});
		try {
			const { store } = setup(30, ['vehicles']);
			await store.refresh();
			flushSync();
			expect(store.familyStates.vehicles.health.state).toBe('live');
			now += 1000;
			flushSync();
			expect(store.familyStates.vehicles.health).toMatchObject({
				state: 'retained-stale',
				ageSeconds: 90,
				notice: 'stale',
			});
			expect(store.familyStates.vehicles.health.isStale).toBe(true);
			expect(present(store).stamp.isStale).toBe(true);
			expect(mocks.vehicles).toHaveBeenCalledOnce();
		} finally {
			restoreRuntime();
		}
	});

	it.each([
		{ ttl: 30, ahead: 29, unknown: false },
		{ ttl: 30, ahead: 30, unknown: false },
		{ ttl: 30, ahead: 31, unknown: true },
		{ ttl: 10, ahead: 10, unknown: false },
		{ ttl: 10, ahead: 11, unknown: true },
	])(
		'bounds future generations at one TTL: ttl=$ttl, ahead=$ahead',
		async ({ ttl, ahead, unknown }) => {
			mocks.nowMs = Date.parse('2026-06-21T12:00:00Z') - ahead * 1000;
			mocks.offsetMs = 0;
			const { store } = setup(ttl, ['vehicles']);
			await store.refresh();
			flushSync();
			expect(store.familyStates.vehicles.health).toMatchObject({
				state: unknown ? 'retained-stale' : 'live',
				ageSeconds: unknown ? null : 0,
				isStale: unknown,
				notice: unknown ? 'stale' : null,
			});
		},
	);

	it('never describes a year-2099 snapshot as live', async () => {
		mocks.nowMs = Date.parse('2026-06-21T12:00:00Z');
		mocks.offsetMs = 0;
		mocks.vehicles.mockResolvedValueOnce({ generated_utc: '2099-01-01T00:00:00Z', vehicles: [] });
		const { store } = setup(30, ['vehicles']);
		await store.refresh();
		flushSync();
		expect(store.familyStates.vehicles.health).toMatchObject({
			state: 'retained-stale',
			ageSeconds: null,
			isStale: true,
			notice: 'stale',
		});
		expect(present(store).stamp.ageSeconds).toBeNull();
		expect(present(store).stamp.isStale).toBe(true);
	});

	it('keeps Live age current when alerts have unknown age', async () => {
		mocks.nowMs = Date.parse('2026-06-21T12:00:10Z');
		mocks.offsetMs = 0;
		mocks.alerts.mockResolvedValueOnce({ generated_utc: null, alerts: [] });
		const { store } = setup(30, ['vehicles', 'alerts']);
		await store.refresh();
		flushSync();
		expect(store.familyStates.alerts.health).toMatchObject({
			state: 'retained-stale',
			ageSeconds: null,
			notice: 'stale',
		});
		expect(store.familyStates.vehicles.health).toMatchObject({ state: 'live', ageSeconds: 10 });
		expect(store.familyStates.vehicles.health.isStale).toBe(false);
		expect(present(store).stamp.ageSeconds).toBe(10);
		expect(present(store).stamp.isStale).toBe(false);
	});

	it('treats an unknown server clock as retained-stale even with a valid generation', async () => {
		mocks.nowMs = Number.NaN;
		mocks.offsetMs = 0;
		const { store } = setup(30, ['vehicles']);
		await store.refresh();
		flushSync();
		expect(store.familyStates.vehicles.health).toMatchObject({
			state: 'retained-stale',
			ageSeconds: null,
			isStale: true,
			notice: 'stale',
		});
	});

	it('keeps an unknown-age retained snapshot settled when an in-flight refresh is stopped', async () => {
		mocks.vehicles.mockResolvedValueOnce({ generated_utc: null, vehicles: [] });
		const { store } = setup(30, ['vehicles']);
		await store.refresh();
		let finish!: () => void;
		mocks.vehicles.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = () => resolve({ generated_utc: mocks.generatedUtc, vehicles: [] });
				}),
		);
		const pending = store.refresh();
		await settleLivePoll();
		store.stop();
		finish();
		await pending;
		flushSync();
		expect(store.familyStates.vehicles.phase).toBe('ready');
		expect(store.familyStates.vehicles.health).toMatchObject({
			state: 'retained-stale',
			ageSeconds: null,
			notice: 'stale',
		});
	});

	it('does not duplicate a family when manual refresh overlaps an automatic poll', async () => {
		const { store } = setup(30, ['vehicles']);
		store.start();
		await settleLivePoll();
		mocks.vehicles.mockImplementation(() => new Promise(() => {}));
		await vi.advanceTimersByTimeAsync(30000);
		expect(mocks.vehicles).toHaveBeenCalledTimes(2);
		await store.refresh();
		expect(mocks.vehicles).toHaveBeenCalledTimes(2);
	});

	it('refreshes an expired family while another family is still pending', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0);
		const { store } = setup(30, ['vehicles', 'alerts']);
		mocks.alerts.mockImplementation(() => new Promise(() => {}));
		mocks.vehicles.mockImplementation(async (ctx) => {
			ctx.onPollDelayMs(5500);
			return { generated_utc: mocks.generatedUtc, vehicles: [] };
		});
		store.start();
		await settleLivePoll();
		await vi.advanceTimersByTimeAsync(5500);
		expect(mocks.vehicles).toHaveBeenCalledTimes(2);
		expect(mocks.alerts).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(54500);
		expect(mocks.alerts).toHaveBeenCalledTimes(2);
	});

	it('schedules each family from its own cache expiry and retains failure cadence', async () => {
		vi.spyOn(Math, 'random').mockReturnValue(0);
		const { store } = setup(30, ['vehicles', 'trips']);
		mocks.vehicles.mockImplementation(async (ctx) => {
			ctx.onPollDelayMs(10500);
			return { generated_utc: mocks.generatedUtc, vehicles: [] };
		});
		store.start();
		await settleLivePoll();
		await vi.advanceTimersByTimeAsync(10499);
		expect(mocks.vehicles).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(mocks.vehicles).toHaveBeenCalledTimes(2);
		expect(mocks.trips).toHaveBeenCalledTimes(1);
		mocks.vehicles.mockRejectedValue(new Error('offline'));
		await vi.advanceTimersByTimeAsync(10500);
		expect(mocks.vehicles).toHaveBeenCalledTimes(3);
		await vi.advanceTimersByTimeAsync(9000);
		expect(mocks.trips).toHaveBeenCalledTimes(2);
		expect(mocks.vehicles).toHaveBeenCalledTimes(3);
		await vi.advanceTimersByTimeAsync(21000);
		expect(mocks.vehicles).toHaveBeenCalledTimes(4);
	});

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
		expect(contexts[0]).toMatchObject({ manifest, signal: expect.any(AbortSignal) });
		expect(contexts[0]?.signal.aborted).toBe(false);
		for (const context of contexts) {
			expect(context?.manifest).toBe(manifest);
			expect(context?.signal).toBe(contexts[0]?.signal);
			expect(context?.onPollDelayMs).toEqual(expect.any(Function));
		}
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
		expect(mocks.vehicles.mock.calls[0]?.[0].signal).toBe(mocks.network.mock.calls[0]?.[0].signal);
		expect(mocks.vehicles.mock.calls[0]?.[0]).toMatchObject({
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
			store = createLiveStore(manifest, reader, {
				families: ['network'],
				seed: { network: seed },
			});
			flushSync();
		});

		try {
			expect(mocks.network).not.toHaveBeenCalled();
			expect(store.network).toEqual(seed);
			const retainedSeed = store.network;
			expect(present(store).publicationUtc).toBe(seed.generated_utc);
			expect(store.loading).toBe(false);
			expect(store.error).toBeNull();
			expect(store.familyStates.network).toMatchObject({
				phase: 'ready',
				active: true,
				lastGoodAt: null,
				retainedGeneration: seed.generated_utc,

				error: null,
				successRevision: 1,
			});

			await store.refresh();
			flushSync();

			expect(mocks.network).toHaveBeenCalledOnce();
			expect(store.network).toBe(retainedSeed);
			expect(present(store).publicationUtc).toBe(seed.generated_utc);
			expect(store.error).toBe(failure);
			expect(store.familyStates.network).toMatchObject({
				phase: 'failed',
				active: true,
				lastGoodAt: null,
				retainedGeneration: seed.generated_utc,

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

	it('derives source freshness from a departures-only store', async () => {
		const generated = Date.parse('2026-06-21T12:00:00Z');
		mocks.nowMs = generated + 30_000;
		mocks.offsetMs = 0;
		const { store } = setup(30, ['departures']);

		await store.refresh();
		flushSync();

		expect(present(store).publicationUtc).toBe('2026-06-21T12:00:00Z');
		expect(present(store).stamp.ageSeconds).toBe(30);
	});

	it('deduplicates repeated family names within one poll', async () => {
		const { store } = setup(30, ['network', 'network']);

		await store.refresh();

		expect(mocks.network).toHaveBeenCalledOnce();
		expect(mocks.vehicles).not.toHaveBeenCalled();
	});

	it('commits successful families and keeps the oldest retained active generation', async () => {
		mocks.nowMs = Date.parse('2026-06-21T12:02:00Z');
		mocks.offsetMs = 0;
		mocks.vehicles
			.mockResolvedValueOnce({ generated_utc: '2026-06-21T12:00:00Z', vehicles: [] })
			.mockResolvedValueOnce({ generated_utc: '2026-06-21T12:00:30Z', vehicles: [] });
		mocks.network
			.mockResolvedValueOnce({ generated_utc: '2026-06-21T12:00:00Z', on_time_pct: 91 })
			.mockRejectedValueOnce(new Error('network unavailable'));
		const { store } = setup(30, ['vehicles', 'network']);

		await store.refresh();
		flushSync();
		expect(present(store).publicationUtc).toBe('2026-06-21T12:00:00Z');
		expect(store.network?.on_time_pct).toBe(91);

		await store.refresh();
		flushSync();

		expect(store.error?.message).toBe('network unavailable');
		expect(store.vehicles?.generated_utc).toBe('2026-06-21T12:00:30Z');
		expect(store.network?.on_time_pct).toBe(91);
		expect(present(store).publicationUtc).toBe('2026-06-21T12:00:00Z');
		expect(present(store).stamp.ageSeconds).toBe(120);
		expect(present(store).stamp.isStale).toBe(true);
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

			expect(store.familyStates[family]).toMatchObject({
				phase: 'failed',
				active: true,
				lastGoodAt: null,
				retainedGeneration: null,

				error: failure,
				successRevision: 0,
			});
			for (const otherFamily of ['vehicles', 'trips', 'departures', 'alerts', 'network'] as const) {
				if (otherFamily === family) continue;
				expect(store.familyStates[otherFamily]).toMatchObject({
					phase: 'idle',
					active: false,
					lastGoodAt: null,
					retainedGeneration: null,

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
		expect(present(store).publicationUtc).toBe('2026-06-21T12:00:00Z');

		const failure = new Error('network settled last');
		rejectNetwork(failure);
		await pendingCycle;
		flushSync();

		expect(store.familyStates.network.phase).toBe('failed');
		expect(store.familyStates.network.error).toBe(failure);
		expect(store.vehicles?.generated_utc).toBe('2026-06-21T12:00:30Z');
		expect(present(store).publicationUtc).toBe('2026-06-21T12:00:00Z');
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
		expect(store.familyStates.vehicles.health.notice).toBe('refresh-unavailable');
		expect(store.familyStates.vehicles.error).toBe(failure);

		mocks.nowMs = Date.parse(generatedUtc) + 40_000;
		await store.refresh();
		flushSync();

		expect(store.vehicles).toBe(retainedVehicles);
		expect(store.familyStates.vehicles).toMatchObject({
			phase: 'ready',
			active: true,
			lastGoodAt: Date.parse(generatedUtc) + 40_000,
			retainedGeneration: generatedUtc,

			error: null,
			successRevision: 1,
		});
		expect(store.error).toBeNull();
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
		expect(store.familyStates.vehicles.health.notice).not.toBe('refresh-unavailable');
		expect(store.familyStates.network.phase).toBe('failed');
		expect(store.familyStates.network.error?.name).toBe('TimeoutError');
		expect(store.familyStates.network.health.notice).toBe('refresh-unavailable');

		releaseNetwork();
		await settleLivePoll();

		expect(store.network).toBeNull();
		expect(store.familyStates.network.phase).toBe('failed');
		expect(store.familyStates.network.error?.name).toBe('TimeoutError');
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
		expect(present(store).publicationUtc).toBe('2026-06-21T12:00:00Z');

		releaseVehicles();
		await pendingCycle;
		flushSync();
		expect(present(store).publicationUtc).toBe('2026-06-21T12:00:00Z');

		disposeTrips();
		expect(store.familyStates.trips.active).toBe(false);
		expect(present(store).publicationUtc).toBe('2026-06-21T12:00:30Z');
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
		expect(store.familyStates.trips).toMatchObject({
			phase: 'idle',
			active: false,
			lastGoodAt: null,
			retainedGeneration: null,

			error: null,
			successRevision: 0,
		});

		releaseTrips();
		await settleLivePoll();

		expect(store.trips).toBeNull();
		expect(store.familyStates.trips.active).toBe(false);
		expect(store.familyStates.trips.successRevision).toBe(0);
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
		expect(present(store).publicationUtc).toBe(store.familyStates.vehicles.retainedGeneration);
		expect(present(store).stamp.isStale).toBe(false);
		expect(store.familyStates.vehicles.retainedGeneration).toBe('2026-06-21T12:00:00Z');
		expect(store.familyStates.vehicles.health.ageSeconds).toBe(60);
		expect(store.familyStates.vehicles.health.isStale).toBe(false);

		await store.refresh();
		flushSync();
		expect(store.familyStates.alerts.phase).toBe('failed');
		expect(present(store).publicationUtc).toBe(store.familyStates.vehicles.retainedGeneration);
		expect(present(store).stamp.isStale).toBe(false);
		expect(store.familyStates.vehicles.retainedGeneration).toBe('2026-06-21T12:00:30Z');
		expect(store.familyStates.vehicles.health.ageSeconds).toBe(30);
		expect(store.familyStates.vehicles.health.isStale).toBe(false);
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

	it.each(['alerts', 'network'] as const)(
		'updates %s data and freshness without rebuilding unrelated lookup indexes',
		async (family) => {
			mocks[family]
				.mockResolvedValueOnce({ generated_utc: '2026-06-21T12:00:00Z' })
				.mockResolvedValueOnce({ generated_utc: '2026-06-21T12:00:30Z' });
			const { store } = setup(30, [family]);
			await store.refresh();
			flushSync();
			const firstPayload = store[family];
			const firstIndex = store.index;

			await store.refresh();
			flushSync();
			expect(store[family]).not.toBe(firstPayload);
			expect(present(store).publicationUtc).toBe(
				family === 'alerts' ? null : '2026-06-21T12:00:30Z',
			);
			expect(store.familyStates[family].retainedGeneration).toBe('2026-06-21T12:00:30Z');
			expect(store.familyStates[family].successRevision).toBe(2);
			expect(store.index).toBe(firstIndex);
		},
	);

	it.each(['vehicles', 'trips', 'departures'] as const)(
		'rebuilds lookup indexes when the %s generation advances',
		async (family) => {
			const port = family === 'departures' ? mocks.stopDepartures : mocks[family];
			port
				.mockResolvedValueOnce({ generated_utc: '2026-06-21T12:00:00Z' })
				.mockResolvedValueOnce({ generated_utc: '2026-06-21T12:00:30Z' });
			const { store } = setup(30, [family]);
			await store.refresh();
			flushSync();
			const firstIndex = store.index;
			await store.refresh();
			flushSync();
			expect(store.index).not.toBe(firstIndex);
		},
	);

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
		expect.soft(present(store).publicationUtc).toBe('2026-06-21T12:00:00Z');
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
		expect(present(store).publicationUtc).toBeNull();
		expect(store.error).toBeNull();
		expect(store.loading).toBe(false);
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

		releaseLate();
		await settleLivePoll();

		expect.soft(store.vehicles?.generated_utc).toBe('2026-06-21T12:00:30Z');
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
