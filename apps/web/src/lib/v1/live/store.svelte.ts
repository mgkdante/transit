// Live store — runes poller for the selected live snapshot files.
//
// By default it polls vehicles / trips / stop_departures / alerts / network on
// the live tier's ttl cadence (from the manifest, default 30s). A surface can
// select only the families it actually reads, without changing the public store
// shape. The actual HTTP is the adapter's job. There is NO app-level ETag/304
// handling: conditional revalidation is the browser/edge HTTP cache's job (the
// fetch uses cache: 'default' against the snapshot's cache-control), so JS always
// sees a 200 — served from cache or origin — carrying Date/Age headers that keep
// the shared server-time offset fresh. The runes only churn when the bytes a poll
// returns actually change.
//
// Aggregate freshness (generatedUtc / ageSeconds / isStale) uses the oldest
// retained generation across active families, including a failed family whose
// last good payload remains visible. Vehicle motion has a separate vehicles-only
// derivation. Both compare against the manifest's live ttl (stale once age >= 3x
// ttl = 90s at the 30s live ttl) — NEVER a literal 90s, so they track the
// publisher's cadence.
//
// The age advances off the app-supplied shared clock port, not a
// private interval, so the freshness here ticks in lockstep with every other
// relative-time label in the chrome (the TopBar refresh chip, etc.). This store
// is also the SINGLE authoritative writer of the chrome's `dataGeneratedUtc`:
// each successful poll pushes the snapshot's own DATA timestamp through the
// refresh port, so the freshness readout never drifts from the
// data it describes.
//
// Lifecycle: createLiveStore(manifest) builds an instance; call .start() from
// onMount and .stop() from onDestroy (or use the $effect convenience in a
// component). Polling pauses while the page is hidden or the browser is offline,
// then performs one immediate single-flight refresh when it becomes active again.
// SSR-safe: start() no-ops without a browser, the initial render shows whatever
// one-shot fetch the loader seeded (or empty state).

import { browser } from '$app/environment';
import { ageSeconds } from '$lib/utils/time';
import { adapter, type AdapterCtx } from '$lib/v1/adapter';
import { getV1Runtime } from '$lib/v1/runtime';
import { untrack } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type {
	AlertsFile,
	Manifest,
	NetworkFile,
	StopDeparturesFile,
	TripsFile,
	VehiclesFile,
} from '$lib/v1/schemas';
import { buildLiveIndex, type LiveIndex } from './index';

/** Default live ttl (seconds) when the manifest omits it — mirrors the schema. */
const DEFAULT_LIVE_TTL_S = 30;

/** A tier is stale once it has missed THREE publish windows (90s at the 30s live
 * ttl). Three, not two: the client polls at the live ttl and the publisher emits
 * at the live ttl, so a healthy snapshot's age legitimately oscillates up to
 * ~2 windows between fetches — staling at 2× flips "· stale" on normal jitter.
 * 3× clears that band so only a genuine feed stall trips it. */
const STALE_TTL_MULTIPLIER = 3;

/** Every live family, in the stable order used by the default five-file poll. */
export const LIVE_FAMILIES = ['vehicles', 'trips', 'departures', 'alerts', 'network'] as const;

export type LiveFamily = (typeof LIVE_FAMILIES)[number];

export type LiveFamilyPhase = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * Settlement state for one live family.
 *
 * `lastGoodAt` is the server-clock epoch ms when the last accepted success
 * settled. `retainedGeneration` is that family's retained payload
 * `generated_utc`. An unchanged successful payload advances `lastGoodAt` and
 * clears failures, but preserves payload identity and `successRevision`.
 */
export interface LiveFamilyState {
	readonly phase: LiveFamilyPhase;
	readonly active: boolean;
	readonly lastGoodAt: number | null;
	readonly retainedGeneration: string | null;
	readonly consecutiveFailures: number;
	readonly error: Error | null;
	readonly successRevision: number;
}

export interface LiveStoreOptions {
	/** Families this surface reads. Omit to preserve the five-file default. */
	readonly families?: readonly LiveFamily[];
	/** Validated request-scoped payloads available for the first render. */
	readonly seed?: {
		readonly network?: NetworkFile;
	};
}

/** The public reactive surface of a live store instance. */
export interface LiveStore {
	/** Live vehicle positions, or null before the first successful fetch. */
	readonly vehicles: VehiclesFile | null;
	/** Trip-keyed live trips, or null before the first successful fetch. */
	readonly trips: TripsFile | null;
	/** Stop-keyed departures, or null before the first successful fetch. */
	readonly departures: StopDeparturesFile | null;
	/** Active service alerts, or null before the first successful fetch. */
	readonly alerts: AlertsFile | null;
	/** Network-health rollup, or null before the first successful fetch. */
	readonly network: NetworkFile | null;
	/** O(1) lookup index rebuilt every tick from the current files. */
	readonly index: LiveIndex;
	/** Settlement state keyed by live family. */
	readonly familyStates: Readonly<Record<LiveFamily, LiveFamilyState>>;
	/** Oldest retained DATA time among active families. */
	readonly generatedUtc: string | null;
	/** Seconds since `generatedUtc`, or null when no build is loaded. */
	readonly ageSeconds: number | null;
	/** True once the live feed is >= 3x its ttl behind (90s at the 30s live ttl) —
	 * 3x, not 2x, so normal poll/publish jitter never falsely flips it stale. */
	readonly isStale: boolean;
	/** Retained vehicles DATA time, independent of other live families. */
	readonly vehiclesGeneratedUtc: string | null;
	/** Seconds since `vehiclesGeneratedUtc`, or null before vehicles load. */
	readonly vehiclesAgeSeconds: number | null;
	/** Vehicles-only 3x-ttl staleness used by map motion. */
	readonly vehiclesIsStale: boolean;
	/** True while a poll is in flight. */
	readonly loading: boolean;
	/** First active-family error; cleared when that family recovers or deactivates. */
	readonly error: Error | null;
	/** Begin polling on the live ttl cadence. Idempotent; browser-only. */
	start(): void;
	/** Stop polling and clear the timer. Idempotent. */
	stop(): void;
	/** Force one immediate refresh of the selected files (returns when settled). */
	refresh(): Promise<void>;
	/** Lease additional families; the idempotent disposer releases the lease. */
	subscribeFamilies(families: readonly LiveFamily[]): () => void;
}

/** Resolve the live ttl (ms) from the manifest, falling back to the default. */
function liveTtlMs(manifest: Manifest): number {
	const ttlS = manifest.files?.live?.ttl_s ?? DEFAULT_LIVE_TTL_S;
	return Math.max(1, ttlS) * 1000;
}

/**
 * Create a request-scoped live store bound to a manifest (for ttl cadence +
 * staleness threshold). One instance per surface tree; share it via context if
 * several panels need the same tick.
 */
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
	const familyStatesValue = $state<Record<LiveFamily, LiveFamilyState>>({
		vehicles: initialFamilyState(familyRefCounts.vehicles > 0),
		trips: initialFamilyState(familyRefCounts.trips > 0),
		departures: initialFamilyState(familyRefCounts.departures > 0),
		alerts: initialFamilyState(familyRefCounts.alerts > 0),
		network: initialFamilyState(familyRefCounts.network > 0, initialNetwork?.generated_utc ?? null),
	});

	// One handle: the poll timer (live ttl cadence). The age/staleness derivation
	// advances off the SHARED clock (started via `clockDispose` below) so the data
	// still ages visibly between polls (and when a poll is served unchanged from the
	// browser/edge cache) AND every chrome relative-time label ticks in lockstep.
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let clockDispose: (() => void) | null = null;
	let refreshInFlight: Promise<void> | null = null;
	const activeControllers = new SvelteSet<AbortController>();
	let refreshGeneration = 0;
	let lifecycleWired = false;
	let started = false;

	const index = $derived(
		buildLiveIndex({ vehicles, trips, stopDepartures: departures, alerts, network }),
	);

	// Aggregate freshness is the oldest retained generation among ACTIVE families.
	// Failed families keep participating while they retain data, so one fresher
	// survivor cannot make the whole surface appear fresh.
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
		if (!generatedUtc) return null;
		// Read the SHARED SERVER clock: this re-derives every shared tick, so the
		// age (and the staleness verdict below) advances between polls in lockstep
		// with the rest of the chrome instead of off a private interval. `serverNow`
		// (not `now`) anchors the age to server time so a skewed client clock can't
		// mis-report it or falsely trip the 3x-ttl (90s) stale threshold.
		const age = ageSeconds(generatedUtc, runtime.clock.serverNow);
		return Number.isNaN(age) ? null : Math.max(0, age);
	});
	const isStale = $derived(ageSecondsValue == null ? false : ageSecondsValue >= staleThresholdS);
	const vehiclesGeneratedUtc = $derived(vehicles?.generated_utc ?? null);
	const vehiclesAgeSecondsValue = $derived.by<number | null>(() => {
		if (!vehiclesGeneratedUtc) return null;
		const age = ageSeconds(vehiclesGeneratedUtc, runtime.clock.serverNow);
		return Number.isNaN(age) ? null : Math.max(0, age);
	});
	const vehiclesIsStale = $derived(
		vehiclesAgeSecondsValue == null ? false : vehiclesAgeSecondsValue >= staleThresholdS,
	);
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

	// Honor the global "refresh data" press: re-poll immediately on an epoch bump
	// instead of waiting for the next ttl tick. `epoch` starts at 0; we only react
	// to CHANGES, so mount does not double-fetch (start() owns the initial poll).
	let lastRefreshEpoch = runtime.refresh.epoch;
	$effect(() => {
		const e = runtime.refresh.epoch;
		if (e !== lastRefreshEpoch) {
			lastRefreshEpoch = e;
			if (browser) void refresh();
		}
	});

	type LiveFamilyPayload = VehiclesFile | TripsFile | StopDeparturesFile | AlertsFile | NetworkFile;

	function initialFamilyState(
		active: boolean,
		retainedGeneration: string | null = null,
	): LiveFamilyState {
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

	function inactiveOrSettledPhase(state: LiveFamilyState): LiveFamilyPhase {
		if (!state.active) return 'idle';
		if (state.error != null) return 'failed';
		return state.retainedGeneration == null ? 'idle' : 'ready';
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
			// The adapter owns schema validation. Only its validated file reaches this
			// settlement commit, then the guards are checked again.
			const payload = await readFamily(family, context);
			if (!requestIsCurrent(family, token, generation, controller)) return;

			const retained = currentFamilyPayload(family);
			const payloadGeneration =
				typeof payload.generated_utc === 'string' ? payload.generated_utc : null;
			const changed =
				retained == null ||
				payloadGeneration == null ||
				retained.generated_utc !== payloadGeneration;
			if (changed) replaceFamilyPayload(family, payload);

			const state = familyStatesValue[family];
			familyStatesValue[family] = {
				...state,
				phase: 'ready',
				lastGoodAt: runtime.clock.serverNow,
				retainedGeneration: payloadGeneration ?? state.retainedGeneration,
				consecutiveFailures: 0,
				error: null,
				successRevision: changed ? state.successRevision + 1 : state.successRevision,
			};
			if (payloadGeneration != null) {
				runtime.refresh.noteDataGeneratedUtc(payloadGeneration);
			}
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

	/**
	 * Fetch one active-family snapshot with a shared deadline controller. Each
	 * family owns its settlement and request token; allSettled only ends the cycle.
	 */
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

		// Publish refreshInFlight before adapters run. Besides synchronous-throw
		// safety, this keeps overlapping lifecycle/epoch triggers in the same cycle.
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
						// Invalidate before aborting: a transport that ignores the signal
						// cannot commit after the deadline.
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
		// All refresh entry points (timer, visibility/online resume, shared epoch,
		// and explicit/manual calls) share one active-family cycle.
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
		// WHY(M1 cure 4): callers acquire leases inside selection effects. Keep this
		// acquisition's family-state reads out of the caller's dependency graph, or
		// each settlement tears down/recreates its own lease until Svelte kills the root.
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

	/** True when background polling is useful and can reach the network. */
	function canPoll(): boolean {
		const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
		const online = typeof navigator === 'undefined' || navigator.onLine !== false;
		return visible && online;
	}

	/** Pause only the background cadence; an in-flight batch is allowed to settle. */
	function pausePolling(): void {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	/** Resume with one immediate refresh and one interval, if currently active. */
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
		// Subscribe to the SHARED clock so age/staleness keep moving between fetches
		// (the data still ages visibly even when a poll is served unchanged from the
		// browser/edge cache) on the SAME tick as every other chrome label.
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
			return familyStatesValue;
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
