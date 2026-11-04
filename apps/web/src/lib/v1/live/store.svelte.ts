import { browser } from '$app/env';
import { DEFAULT_LIVE_TTL_S, freshnessAgeSeconds } from '#lib/v1/freshness.ts';
import { adapter, type AdapterCtx } from '#lib/v1/adapter/index.ts';
import { getV1Runtime } from '#lib/v1/runtime.ts';
import { untrack } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type {
	AlertsFile,
	Manifest,
	NetworkFile,
	StopDeparturesFile,
	TripsFile,
	VehiclesFile,
} from '#lib/v1/schemas/index.ts';
import { buildLiveIndex, type LiveIndex } from './index';

const STALE_TTL_MULTIPLIER = 3;
const CAPTURE_STALE_SECONDS = { alerts: 900, trips: 300, departures: 300 } as const;

export const LIVE_FAMILIES = ['vehicles', 'trips', 'departures', 'alerts', 'network'] as const;

export type LiveFamily = (typeof LIVE_FAMILIES)[number];

export type LiveFamilyPhase = 'idle' | 'loading' | 'ready' | 'failed';

export type FeedHealthState =
	| 'never-loaded'
	| 'live'
	| 'retained-stale'
	| 'retrying'
	| 'failed-no-data';

export interface FeedHealth {
	readonly state: FeedHealthState;
	readonly ageSeconds: number | null;
	/** Retained snapshot age or a failed first load; an initial pending load is not stale. */
	readonly isStale: boolean;
	readonly retained: boolean;
	readonly notice: 'stale' | 'refresh-unavailable' | null;
}

interface FamilyState {
	readonly phase: LiveFamilyPhase;
	readonly active: boolean;
	readonly lastGoodAt: number | null;
	readonly retainedGeneration: string | null;
	readonly consecutiveFailures: number;
	readonly error: Error | null;
	readonly successRevision: number;
}

export interface LiveFamilyState extends Omit<FamilyState, 'consecutiveFailures'> {
	readonly health: FeedHealth;
}

export interface LiveStoreOptions {
	readonly families?: readonly LiveFamily[];
	readonly seed?: {
		readonly network?: NetworkFile;
	};
}

export interface LiveStore {
	readonly vehicles: VehiclesFile | null;
	readonly trips: TripsFile | null;
	readonly departures: StopDeparturesFile | null;
	readonly alerts: AlertsFile | null;
	readonly network: NetworkFile | null;
	readonly index: LiveIndex;
	readonly familyStates: Readonly<Record<LiveFamily, LiveFamilyState>>;
	readonly generatedUtc: string | null;
	readonly ageSeconds: number | null;
	readonly isStale: boolean;
	readonly isPartialStale: boolean;
	readonly vehiclesGeneratedUtc: string | null;
	readonly vehiclesAgeSeconds: number | null;
	readonly vehiclesIsStale: boolean;
	readonly loading: boolean;
	readonly error: Error | null;
	start(): void;
	stop(): void;
	refresh(): Promise<void>;
	subscribeFamilies(families: readonly LiveFamily[]): () => void;
}

function liveTtlMs(manifest: Manifest): number {
	const ttlS = manifest.files?.live?.ttl_s ?? DEFAULT_LIVE_TTL_S;
	return Math.max(1, ttlS) * 1000;
}

export function createLiveStore(manifest: Manifest, options: LiveStoreOptions = {}): LiveStore {
	const runtime = getV1Runtime();
	const ttlMs = liveTtlMs(manifest);
	const staleThresholdS = (ttlMs / 1000) * STALE_TTL_MULTIPLIER;
	const adapterCtx: AdapterCtx = { manifest };
	const baselineFamilies = new SvelteSet<LiveFamily>(options.families ?? LIVE_FAMILIES);
	const initialNetwork = baselineFamilies.has('network') ? (options.seed?.network ?? null) : null;

	let vehicles = $state<VehiclesFile | null>(null);
	let trips = $state<TripsFile | null>(null);
	let departures = $state<StopDeparturesFile | null>(null);
	let alerts = $state<AlertsFile | null>(null);
	let network = $state<NetworkFile | null>(initialNetwork);

	const familyRefCounts: Record<LiveFamily, number> = {
		vehicles: baselineFamilies.has('vehicles') ? 1 : 0,
		trips: baselineFamilies.has('trips') ? 1 : 0,
		departures: baselineFamilies.has('departures') ? 1 : 0,
		alerts: baselineFamilies.has('alerts') ? 1 : 0,
		network: baselineFamilies.has('network') ? 1 : 0,
	};
	const familyRequestTokens: Record<LiveFamily, number> = {
		vehicles: 0,
		trips: 0,
		departures: 0,
		alerts: 0,
		network: 0,
	};
	const familyStatesValue = $state<Record<LiveFamily, FamilyState>>({
		vehicles: initialFamilyState(familyRefCounts.vehicles > 0),
		trips: initialFamilyState(familyRefCounts.trips > 0),
		departures: initialFamilyState(familyRefCounts.departures > 0),
		alerts: initialFamilyState(familyRefCounts.alerts > 0),
		network: initialFamilyState(familyRefCounts.network > 0, initialNetwork?.generated_utc ?? null),
	});

	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let clockDispose: (() => void) | null = null;
	let refreshInFlight: Promise<void> | null = null;
	const activeControllers = new SvelteSet<AbortController>();
	let refreshGeneration = 0;
	let lifecycleWired = false;
	let started = false;

	const index = $derived(buildLiveIndex({ vehicles, trips, stopDepartures: departures }));
	const familyStates = $derived.by(() => {
		const result = {} as Record<LiveFamily, LiveFamilyState>;
		for (const family of LIVE_FAMILIES) {
			const { consecutiveFailures, ...state } = familyStatesValue[family];
			const payload = currentFamilyPayload(family);
			const publicationAge = freshnessAgeSeconds(
				payload?.generated_utc,
				runtime.clock.serverNow,
				ttlMs / 1000,
			);
			// Missing means the old publisher is still running. Explicit null is unknown.
			const captureEnabled =
				payload != null && 'feed_captured_utc' in payload && family in CAPTURE_STALE_SECONDS;
			const captureAge = captureEnabled
				? freshnessAgeSeconds(payload.feed_captured_utc, runtime.clock.serverNow, ttlMs / 1000)
				: null;
			const age = captureEnabled
				? publicationAge == null || captureAge == null
					? null
					: Math.max(publicationAge, captureAge)
				: publicationAge;
			const captureLimit = CAPTURE_STALE_SECONDS[family as keyof typeof CAPTURE_STALE_SECONDS];
			const ageIsStale =
				publicationAge == null ||
				publicationAge >= staleThresholdS ||
				(captureEnabled && (captureAge == null || captureAge >= captureLimit));
			const retained = payload != null;
			const retrying = state.phase === 'loading' && consecutiveFailures > 0;
			const failed = state.phase === 'failed' || consecutiveFailures > 0;
			const unknownAge = retained && age == null;
			let verdict: FeedHealthState;
			if (!retained) verdict = retrying ? 'retrying' : failed ? 'failed-no-data' : 'never-loaded';
			else if (unknownAge) verdict = 'retained-stale';
			else if (retrying) verdict = 'retrying';
			else verdict = failed || ageIsStale ? 'retained-stale' : 'live';
			const isStale = retained ? ageIsStale : verdict === 'failed-no-data';
			let notice: FeedHealth['notice'] = null;
			if (failed) notice = 'refresh-unavailable';
			else if (unknownAge) notice = 'stale';
			else if (retained && isStale) notice = 'stale';
			const health: FeedHealth = {
				state: verdict,
				ageSeconds: age,
				isStale,
				retained,
				notice,
			};
			result[family] = { ...state, health };
		}
		return result;
	});

	const generatedUtc = $derived.by<string | null>(() => {
		let oldest: string | null = null;
		let oldestMs = Number.POSITIVE_INFINITY;
		for (const family of LIVE_FAMILIES) {
			const state = familyStatesValue[family];
			if (!state.active || state.retainedGeneration == null) continue;
			const generationMs = Date.parse(state.retainedGeneration);
			if (!Number.isNaN(generationMs) && generationMs < oldestMs) {
				oldest = state.retainedGeneration;
				oldestMs = generationMs;
			}
		}
		return oldest;
	});
	const ageSecondsValue = $derived.by<number | null>(() => {
		const active = activeFamilies().filter((family) => {
			const health = familyStates[family].health;
			return health.retained || health.state === 'failed-no-data';
		});
		if (active.length === 0) return null;
		let oldestAge = 0;
		for (const family of active) {
			const age = familyStates[family].health.ageSeconds;
			if (age == null) return null;
			oldestAge = Math.max(oldestAge, age);
		}
		return oldestAge;
	});
	const isStale = $derived(activeFamilies().some((family) => familyStates[family].health.isStale));
	const isPartialStale = $derived(
		isStale && activeFamilies().some((family) => familyStates[family].health.state === 'live'),
	);
	const vehiclesGeneratedUtc = $derived(vehicles?.generated_utc ?? null);
	const vehiclesAgeSecondsValue = $derived(familyStates.vehicles.health.ageSeconds);
	const vehiclesIsStale = $derived(familyStates.vehicles.health.isStale);
	const loading = $derived(
		LIVE_FAMILIES.some(
			(family) => familyStatesValue[family].active && familyStatesValue[family].phase === 'loading',
		),
	);
	const error = $derived.by<Error | null>(() => {
		for (const family of LIVE_FAMILIES) {
			const state = familyStatesValue[family];
			if (state.active && state.error != null) return state.error;
		}
		return null;
	});

	let lastRefreshEpoch = runtime.refresh.epoch;
	$effect(() => {
		const e = runtime.refresh.epoch;
		if (e !== lastRefreshEpoch) {
			lastRefreshEpoch = e;
			if (browser) void refresh();
		}
	});

	type LiveFamilyPayload = VehiclesFile | TripsFile | StopDeparturesFile | AlertsFile | NetworkFile;
	function captureTimestamp(payload: LiveFamilyPayload | null): string | null | undefined {
		return payload && 'feed_captured_utc' in payload ? payload.feed_captured_utc : undefined;
	}

	function initialFamilyState(
		active: boolean,
		retainedGeneration: string | null = null,
	): FamilyState {
		const hasSeed = active && retainedGeneration != null;
		return {
			phase: hasSeed ? 'ready' : 'idle',
			active,
			lastGoodAt: null,
			retainedGeneration: hasSeed ? retainedGeneration : null,
			consecutiveFailures: 0,
			error: null,
			successRevision: hasSeed ? 1 : 0,
		};
	}

	function inactiveOrSettledPhase(state: FamilyState): LiveFamilyPhase {
		if (!state.active) return 'idle';
		if (state.error != null) return 'failed';
		return state.successRevision === 0 ? 'idle' : 'ready';
	}

	function activeFamilies(): LiveFamily[] {
		return LIVE_FAMILIES.filter((family) => familyStatesValue[family].active);
	}

	function readFamily(family: LiveFamily, context: AdapterCtx): Promise<LiveFamilyPayload> {
		switch (family) {
			case 'vehicles':
				return adapter.live.vehicles(context);
			case 'trips':
				return adapter.live.trips(context);
			case 'departures':
				return adapter.live.stopDepartures(context);
			case 'alerts':
				return adapter.live.alerts(context);
			case 'network':
				return adapter.live.network(context);
		}
	}

	function currentFamilyPayload(family: LiveFamily): LiveFamilyPayload | null {
		switch (family) {
			case 'vehicles':
				return vehicles;
			case 'trips':
				return trips;
			case 'departures':
				return departures;
			case 'alerts':
				return alerts;
			case 'network':
				return network;
		}
	}

	function replaceFamilyPayload(family: LiveFamily, payload: LiveFamilyPayload): void {
		switch (family) {
			case 'vehicles':
				vehicles = payload as VehiclesFile;
				break;
			case 'trips':
				trips = payload as TripsFile;
				break;
			case 'departures':
				departures = payload as StopDeparturesFile;
				break;
			case 'alerts':
				alerts = payload as AlertsFile;
				break;
			case 'network':
				network = payload as NetworkFile;
				break;
		}
	}

	function asError(value: unknown): Error {
		return value instanceof Error ? value : new Error(String(value));
	}

	function isAbortError(value: unknown): boolean {
		return value instanceof Error && value.name === 'AbortError';
	}

	function requestIsCurrent(
		family: LiveFamily,
		token: number,
		generation: number,
		controller: AbortController,
	): boolean {
		return (
			generation === refreshGeneration &&
			familyRequestTokens[family] === token &&
			familyStatesValue[family].active &&
			!controller.signal.aborted
		);
	}

	function failFamily(family: LiveFamily, failure: Error): void {
		const state = familyStatesValue[family];
		familyStatesValue[family] = {
			...state,
			phase: 'failed',
			consecutiveFailures: state.consecutiveFailures + 1,
			error: failure,
		};
	}

	async function settleFamily(
		family: LiveFamily,
		context: AdapterCtx,
		controller: AbortController,
		generation: number,
		token: number,
		pendingFamilies: SvelteSet<LiveFamily>,
	): Promise<void> {
		if (!requestIsCurrent(family, token, generation, controller)) {
			pendingFamilies.delete(family);
			return;
		}

		try {
			const payload = await readFamily(family, context);
			if (!requestIsCurrent(family, token, generation, controller)) return;

			const retained = currentFamilyPayload(family);
			const payloadGeneration =
				typeof payload.generated_utc === 'string' ? payload.generated_utc : null;
			const changed =
				retained == null ||
				payloadGeneration == null ||
				retained.generated_utc !== payloadGeneration ||
				captureTimestamp(retained) !== captureTimestamp(payload);
			if (changed) replaceFamilyPayload(family, payload);

			const state = familyStatesValue[family];
			familyStatesValue[family] = {
				...state,
				phase: 'ready',
				lastGoodAt: runtime.clock.serverNow,
				retainedGeneration: payloadGeneration,
				consecutiveFailures: 0,
				error: null,
				successRevision: changed ? state.successRevision + 1 : state.successRevision,
			};
		} catch (value) {
			if (!requestIsCurrent(family, token, generation, controller)) return;
			if (isAbortError(value)) {
				const state = familyStatesValue[family];
				familyStatesValue[family] = {
					...state,
					phase: inactiveOrSettledPhase(state),
				};
				return;
			}
			failFamily(family, asError(value));
		} finally {
			pendingFamilies.delete(family);
		}
	}

	async function runBatch(requestedFamilies: readonly LiveFamily[]): Promise<void> {
		const selectedFamilies = [
			...new SvelteSet(requestedFamilies.filter((family) => familyStatesValue[family].active)),
		];
		if (selectedFamilies.length === 0) return;

		const generation = refreshGeneration;
		const controller = new AbortController();
		const batchContext: AdapterCtx = { ...adapterCtx, signal: controller.signal };
		const pendingFamilies = new SvelteSet(selectedFamilies);
		const batchTokens = new SvelteMap<LiveFamily, number>();
		let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
		for (const family of selectedFamilies) {
			const token = familyRequestTokens[family] + 1;
			familyRequestTokens[family] = token;
			batchTokens.set(family, token);
			familyStatesValue[family] = {
				...familyStatesValue[family],
				phase: 'loading',
			};
		}
		activeControllers.add(controller);

		await Promise.resolve();
		try {
			const reads = selectedFamilies.map((family) => {
				const token = batchTokens.get(family);
				return token == null
					? Promise.resolve()
					: settleFamily(family, batchContext, controller, generation, token, pendingFamilies);
			});
			const deadline = new Promise<void>((resolve) => {
				deadlineTimer = setTimeout(() => {
					const timeout = new DOMException(
						`Live refresh exceeded its ${ttlMs}ms deadline`,
						'TimeoutError',
					);
					for (const family of [...pendingFamilies]) {
						const batchToken = batchTokens.get(family);
						if (
							batchToken == null ||
							generation !== refreshGeneration ||
							batchToken !== familyRequestTokens[family] ||
							!familyStatesValue[family].active
						) {
							continue;
						}
						familyRequestTokens[family] += 1;
						failFamily(family, timeout);
					}
					controller.abort();
					resolve();
				}, ttlMs);
			});

			await Promise.race([Promise.allSettled(reads), deadline]);
		} finally {
			if (deadlineTimer != null) clearTimeout(deadlineTimer);
			activeControllers.delete(controller);
		}
	}

	function refresh(): Promise<void> {
		if (refreshInFlight) return refreshInFlight;
		const pending = runBatch(activeFamilies());
		refreshInFlight = pending;
		void pending.then(
			() => {
				if (refreshInFlight === pending) refreshInFlight = null;
			},
			() => {
				if (refreshInFlight === pending) refreshInFlight = null;
			},
		);
		return pending;
	}

	function subscribeFamilies(families: readonly LiveFamily[]): () => void {
		return untrack(() => {
			const leasedFamilies = [...new SvelteSet(families)];
			const activatedFamilies: LiveFamily[] = [];
			for (const family of leasedFamilies) {
				const previous = familyRefCounts[family];
				familyRefCounts[family] = previous + 1;
				if (previous !== 0) continue;

				const state = familyStatesValue[family];
				const activeState = { ...state, active: true };
				familyStatesValue[family] = {
					...activeState,
					phase: inactiveOrSettledPhase(activeState),
				};
				activatedFamilies.push(family);
			}
			if (activatedFamilies.length > 0) void runBatch(activatedFamilies);

			let disposed = false;
			return () => {
				if (disposed) return;
				disposed = true;
				for (const family of leasedFamilies) {
					const next = Math.max(0, familyRefCounts[family] - 1);
					familyRefCounts[family] = next;
					if (next !== 0) continue;

					familyRequestTokens[family] += 1;
					familyStatesValue[family] = {
						...familyStatesValue[family],
						phase: 'idle',
						active: false,
					};
				}
			};
		});
	}

	function canPoll(): boolean {
		const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
		const online = typeof navigator === 'undefined' || navigator.onLine !== false;
		return visible && online;
	}

	function pausePolling(): void {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	function resumePolling(): void {
		if (!started || pollTimer || !canPoll()) return;
		pollTimer = setInterval(() => {
			void refresh();
		}, ttlMs);
		void refresh();
	}

	function handleLifecycleChange(): void {
		if (!started) return;
		if (canPoll()) resumePolling();
		else pausePolling();
	}

	function wireLifecycle(): void {
		if (lifecycleWired) return;
		lifecycleWired = true;
		if (typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', handleLifecycleChange);
		}
		if (typeof window !== 'undefined') {
			window.addEventListener('online', handleLifecycleChange);
			window.addEventListener('offline', handleLifecycleChange);
		}
	}

	function unwireLifecycle(): void {
		if (!lifecycleWired) return;
		lifecycleWired = false;
		if (typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', handleLifecycleChange);
		}
		if (typeof window !== 'undefined') {
			window.removeEventListener('online', handleLifecycleChange);
			window.removeEventListener('offline', handleLifecycleChange);
		}
	}

	function start(): void {
		if (started || !browser) return;
		started = true;
		clockDispose = runtime.clock.subscribe();
		wireLifecycle();
		resumePolling();
	}

	function stop(): void {
		started = false;
		refreshGeneration += 1;
		refreshInFlight = null;
		for (const family of LIVE_FAMILIES) {
			familyRequestTokens[family] += 1;
			const state = familyStatesValue[family];
			if (state.phase === 'loading') {
				familyStatesValue[family] = {
					...state,
					phase: inactiveOrSettledPhase(state),
				};
			}
		}
		for (const controller of activeControllers) controller.abort();
		pausePolling();
		unwireLifecycle();
		if (clockDispose) {
			clockDispose();
			clockDispose = null;
		}
	}

	return {
		get vehicles() {
			return vehicles;
		},
		get trips() {
			return trips;
		},
		get departures() {
			return departures;
		},
		get alerts() {
			return alerts;
		},
		get network() {
			return network;
		},
		get index() {
			return index;
		},
		get familyStates() {
			return familyStates;
		},
		get generatedUtc() {
			return generatedUtc;
		},
		get ageSeconds() {
			return ageSecondsValue;
		},
		get isStale() {
			return isStale;
		},
		get isPartialStale() {
			return isPartialStale;
		},
		get vehiclesGeneratedUtc() {
			return vehiclesGeneratedUtc;
		},
		get vehiclesAgeSeconds() {
			return vehiclesAgeSecondsValue;
		},
		get vehiclesIsStale() {
			return vehiclesIsStale;
		},
		get loading() {
			return loading;
		},
		get error() {
			return error;
		},
		start,
		stop,
		refresh,
		subscribeFamilies,
	};
}
