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
// Freshness (generatedUtc / ageSeconds / isStale) is derived from the live
// network.json's generated_utc against the manifest's live ttl (stale once age
// >= 3x ttl = 90s at the 30s live ttl) — NEVER a literal 90s, so it tracks the
// publisher's cadence. 3x (not 2x) clears the band where a healthy snapshot's
// age legitimately oscillates on normal poll/publish jitter, so only a genuine
// feed stall trips it.
//
// The age advances off the SHARED clock (`$lib/stores` sharedClock), not a
// private interval, so the freshness here ticks in lockstep with every other
// relative-time label in the chrome (the TopBar refresh chip, etc.). This store
// is also the SINGLE authoritative writer of the chrome's `dataGeneratedUtc`:
// each successful poll pushes the snapshot's own DATA timestamp into the shared
// `dataRefresh` coordinator, so the freshness readout never drifts from the
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
import { dataRefresh, sharedClock } from '$lib/stores';
import { adapter, type AdapterCtx } from '$lib/v1/adapter';
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

export interface LiveStoreOptions {
	/** Families this surface reads. Omit to preserve the five-file default. */
	readonly families?: readonly LiveFamily[];
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
	/** DATA time of the current live build, preferring network.json when loaded. */
	readonly generatedUtc: string | null;
	/** Seconds since `generatedUtc`, or null when no build is loaded. */
	readonly ageSeconds: number | null;
	/** True once the live feed is >= 3x its ttl behind (90s at the 30s live ttl) —
	 * 3x, not 2x, so normal poll/publish jitter never falsely flips it stale. */
	readonly isStale: boolean;
	/** True while a poll is in flight. */
	readonly loading: boolean;
	/** Last poll error (cleared on the next success), or null. */
	readonly error: Error | null;
	/** Begin polling on the live ttl cadence. Idempotent; browser-only. */
	start(): void;
	/** Stop polling and clear the timer. Idempotent. */
	stop(): void;
	/** Force one immediate refresh of the selected files (returns when settled). */
	refresh(): Promise<void>;
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
	const ttlMs = liveTtlMs(manifest);
	const staleThresholdS = (ttlMs / 1000) * STALE_TTL_MULTIPLIER;
	const adapterCtx: AdapterCtx = { manifest };
	const families = options.families ?? LIVE_FAMILIES;

	let vehicles = $state<VehiclesFile | null>(null);
	let trips = $state<TripsFile | null>(null);
	let departures = $state<StopDeparturesFile | null>(null);
	let alerts = $state<AlertsFile | null>(null);
	let network = $state<NetworkFile | null>(null);
	let loading = $state(false);
	let error = $state<Error | null>(null);

	// One handle: the poll timer (live ttl cadence). The age/staleness derivation
	// advances off the SHARED clock (started via `clockDispose` below) so the data
	// still ages visibly between polls (and when a poll is served unchanged from the
	// browser/edge cache) AND every chrome relative-time label ticks in lockstep.
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let clockDispose: (() => void) | null = null;
	let refreshInFlight: Promise<void> | null = null;
	let refreshController: AbortController | null = null;
	let refreshGeneration = 0;
	let lifecycleWired = false;
	let started = false;

	const index = $derived(
		buildLiveIndex({ vehicles, trips, stopDepartures: departures, alerts, network }),
	);

	// Live freshness anchors off network.json's generated_utc (the rollup the
	// publisher stamps last). A family-scoped store falls back through every other
	// snapshot timestamp, so even a departures-only consumer reports honest age.
	const generatedUtc = $derived(
		network?.generated_utc ??
			vehicles?.generated_utc ??
			trips?.generated_utc ??
			departures?.generated_utc ??
			alerts?.generated_utc ??
			null,
	);
	const ageSecondsValue = $derived.by<number | null>(() => {
		if (!generatedUtc) return null;
		// Read the SHARED SERVER clock: this re-derives every shared tick, so the
		// age (and the staleness verdict below) advances between polls in lockstep
		// with the rest of the chrome instead of off a private interval. `serverNow`
		// (not `now`) anchors the age to server time so a skewed client clock can't
		// mis-report it or falsely trip the 3x-ttl (90s) stale threshold.
		const age = ageSeconds(generatedUtc, sharedClock.serverNow);
		return Number.isNaN(age) ? null : Math.max(0, age);
	});
	const isStale = $derived(ageSecondsValue == null ? false : ageSecondsValue >= staleThresholdS);

	// Honor the global "refresh data" press: re-poll immediately on an epoch bump
	// instead of waiting for the next ttl tick. `epoch` starts at 0; we only react
	// to CHANGES, so mount does not double-fetch (start() owns the initial poll).
	let lastRefreshEpoch = dataRefresh.epoch;
	$effect(() => {
		const e = dataRefresh.epoch;
		if (e !== lastRefreshEpoch) {
			lastRefreshEpoch = e;
			if (browser) void refresh();
		}
	});

	/**
	 * Fetch the selected files in parallel. Revalidation is the browser/edge HTTP
	 * cache's job (cache: 'default' + the snapshot's cache-control); each fetch
	 * resolves to a 200 — from cache or origin — whose Date/Age refreshes the
	 * shared server-time anchor.
	 */
	function refresh(): Promise<void> {
		// All refresh entry points (timer, visibility/online resume, shared epoch,
		// and explicit/manual calls) share one selected-family batch. This prevents a
		// slow request from being multiplied when two triggers overlap.
		if (refreshInFlight) return refreshInFlight;
		const generation = refreshGeneration;
		const controller = new AbortController();
		const batchCtx: AdapterCtx = { ...adapterCtx, signal: controller.signal };
		refreshController = controller;
		loading = true;
		const pending = (async () => {
			let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
			let timedOut = false;
			// Yield once so `refreshInFlight` is assigned before adapters run, even if
			// an adapter were to throw synchronously.
			await Promise.resolve();
			try {
				const deadline = new Promise<never>((_, reject) => {
					deadlineTimer = setTimeout(() => {
						timedOut = true;
						const timeout = new DOMException(
							`Live refresh exceeded its ${ttlMs}ms deadline`,
							'TimeoutError',
						);
						reject(timeout);
						controller.abort();
					}, ttlMs);
				});
				const reads = Promise.all([
					families.includes('vehicles') ? adapter.live.vehicles(batchCtx) : null,
					families.includes('trips') ? adapter.live.trips(batchCtx) : null,
					families.includes('departures') ? adapter.live.stopDepartures(batchCtx) : null,
					families.includes('alerts') ? adapter.live.alerts(batchCtx) : null,
					families.includes('network') ? adapter.live.network(batchCtx) : null,
				]);
				const [v, t, d, a, n] = await Promise.race([reads, deadline]);
				// stop() invalidates the generation before aborting. Some test doubles or
				// transports may ignore AbortSignal, so the generation guard is what makes
				// late completion unable to repopulate an unmounted surface.
				if (controller.signal.aborted || generation !== refreshGeneration) return;
				// Commit only after every selected request has resolved. One failed family
				// therefore leaves the previous complete snapshot intact.
				if (v !== null && (vehicles === null || v.generated_utc !== vehicles.generated_utc)) {
					vehicles = v;
				}
				if (t !== null && (trips === null || t.generated_utc !== trips.generated_utc)) trips = t;
				if (d !== null && (departures === null || d.generated_utc !== departures.generated_utc)) {
					departures = d;
				}
				if (a !== null && (alerts === null || a.generated_utc !== alerts.generated_utc)) alerts = a;
				if (n !== null && (network === null || n.generated_utc !== network.generated_utc))
					network = n;
				// SINGLE authoritative writer: push the snapshot's own DATA timestamp into
				// the shared chrome coordinator so the freshness readout tracks this poll.
				const polledGeneratedUtc =
					n?.generated_utc ??
					v?.generated_utc ??
					t?.generated_utc ??
					d?.generated_utc ??
					a?.generated_utc ??
					null;
				if (polledGeneratedUtc != null) {
					dataRefresh.noteDataGeneratedUtc(polledGeneratedUtc);
				}
				error = null;
			} catch (e) {
				const lifecycleAbort =
					(controller.signal.aborted && !timedOut) ||
					(e instanceof DOMException
						? e.name === 'AbortError'
						: e instanceof Error && e.name === 'AbortError');
				if (!lifecycleAbort && generation === refreshGeneration) {
					error = e instanceof Error ? e : new Error(String(e));
				}
			} finally {
				if (deadlineTimer !== null) clearTimeout(deadlineTimer);
				if (refreshController === controller) {
					loading = false;
					refreshInFlight = null;
					refreshController = null;
				}
			}
		})();
		refreshInFlight = pending;
		return pending;
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
		clockDispose = sharedClock.subscribe();
		wireLifecycle();
		resumePolling();
	}

	function stop(): void {
		started = false;
		refreshGeneration += 1;
		refreshController?.abort();
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
		get generatedUtc() {
			return generatedUtc;
		},
		get ageSeconds() {
			return ageSecondsValue;
		},
		get isStale() {
			return isStale;
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
	};
}
