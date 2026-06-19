// Live store — runes poller for the five live snapshot files.
//
// Polls vehicles / trips / stop_departures / alerts / network on the live tier's
// ttl cadence (from the manifest, default 30s) and exposes them as reactive
// runes. The actual HTTP is the adapter's job — it owns conditional GET
// (If-None-Match / ETag): a 304 returns the previously-parsed file unchanged, so
// re-polling is cheap and the runes only churn when bytes actually change.
//
// Freshness (generatedUtc / ageSeconds / isStale) is derived from the live
// network.json's generated_utc against the manifest's live ttl (stale once age
// >= 2x ttl) — NEVER a literal 30s, so it tracks the publisher's cadence.
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
// component). SSR-safe: start() no-ops without a browser, the initial render
// shows whatever one-shot fetch the loader seeded (or empty state).

import { browser } from '$app/environment';
import { ageSeconds } from '$lib/utils/time';
import { dataRefresh, sharedClock } from '$lib/stores';
import { adapter } from '$lib/v1/adapter';
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

/** A tier is stale once it has missed TWO publish windows. */
const STALE_TTL_MULTIPLIER = 2;

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
	/** DATA time of the current live build (from network.json), or null. */
	readonly generatedUtc: string | null;
	/** Seconds since `generatedUtc`, or null when no build is loaded. */
	readonly ageSeconds: number | null;
	/** True once the live feed is >= 2x its ttl behind. */
	readonly isStale: boolean;
	/** True while a poll is in flight. */
	readonly loading: boolean;
	/** Last poll error (cleared on the next success), or null. */
	readonly error: Error | null;
	/** Begin polling on the live ttl cadence. Idempotent; browser-only. */
	start(): void;
	/** Stop polling and clear the timer. Idempotent. */
	stop(): void;
	/** Force one immediate refresh of all five files (returns when settled). */
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
export function createLiveStore(manifest: Manifest): LiveStore {
	const ttlMs = liveTtlMs(manifest);
	const staleThresholdS = (ttlMs / 1000) * STALE_TTL_MULTIPLIER;

	let vehicles = $state<VehiclesFile | null>(null);
	let trips = $state<TripsFile | null>(null);
	let departures = $state<StopDeparturesFile | null>(null);
	let alerts = $state<AlertsFile | null>(null);
	let network = $state<NetworkFile | null>(null);
	let loading = $state(false);
	let error = $state<Error | null>(null);

	// One handle: the poll timer (live ttl cadence). The age/staleness derivation
	// advances off the SHARED clock (started via `clockDispose` below) so a 304
	// still ages visibly AND every chrome relative-time label ticks in lockstep.
	let pollTimer: ReturnType<typeof setInterval> | null = null;
	let clockDispose: (() => void) | null = null;
	let started = false;

	const index = $derived(
		buildLiveIndex({ vehicles, trips, stopDepartures: departures, alerts, network }),
	);

	// Live freshness anchors off network.json's generated_utc (the rollup the
	// publisher stamps last). Falls back to the vehicles file when network is
	// absent, so a partial tick still reports an age.
	const generatedUtc = $derived(network?.generated_utc ?? vehicles?.generated_utc ?? null);
	const ageSecondsValue = $derived.by<number | null>(() => {
		if (!generatedUtc) return null;
		// Read the SHARED clock: this re-derives every shared tick, so the age (and
		// the staleness verdict below) advances between polls in lockstep with the
		// rest of the chrome instead of off a private interval.
		const age = ageSeconds(generatedUtc, sharedClock.now);
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

	/** Fetch all five files in parallel. Conditional GET is the adapter's job. */
	async function refresh(): Promise<void> {
		loading = true;
		try {
			const [v, t, d, a, n] = await Promise.all([
				adapter.live.vehicles(),
				adapter.live.trips(),
				adapter.live.stopDepartures(),
				adapter.live.alerts(),
				adapter.live.network(),
			]);
			vehicles = v;
			trips = t;
			departures = d;
			alerts = a;
			network = n;
			// SINGLE authoritative writer: push the snapshot's own DATA timestamp into
			// the shared chrome coordinator so the freshness readout tracks this poll.
			dataRefresh.noteDataGeneratedUtc(n.generated_utc ?? v.generated_utc);
			error = null;
		} catch (e) {
			error = e instanceof Error ? e : new Error(String(e));
		} finally {
			loading = false;
		}
	}

	function start(): void {
		if (started || !browser) return;
		started = true;
		// Subscribe to the SHARED clock so age/staleness keep moving between fetches
		// (a 304 still ages visibly) on the SAME tick as every other chrome label.
		clockDispose = sharedClock.subscribe();
		void refresh();
		pollTimer = setInterval(() => {
			void refresh();
		}, ttlMs);
	}

	function stop(): void {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
		if (clockDispose) {
			clockDispose();
			clockDispose = null;
		}
		started = false;
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
