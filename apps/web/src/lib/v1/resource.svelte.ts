// createResource — a client-side reactive data resource for surface loads.
//
// THE scalable spine for client-reactive static/historic /v1 reads. Detail
// routes can seed it from their direct-R2 server load; unseeded surfaces fetch
// from the public R2 custom domain on mount. `$effect` runs client-only, so the
// first unseeded render shows the shared skeleton and then resolves in place.
//
// Reactive by design: the fetcher reads its inputs (e.g. an entity id) when it is
// INVOKED inside the effect, so changing those inputs (client nav /lines/A →
// /lines/B) re-runs the fetch. A monotonic token drops out-of-order responses.
//
// Pair it with <ResourceBoundary> ($lib/components/surface) for skeleton / error /
// empty / loaded rendering — no surface re-implements that. Live-tier data uses
// the live store (createLiveStore) instead; this is for static + historic.
//
// It also honors the global `dataRefresh` epoch: a chrome "refresh data" press
// bumps it, which re-runs the fetch here (createResource surfaces don't use load
// functions, so invalidateAll alone would never reach them).
//
// FRESHNESS-BEARING (slice-9.8 A): a resource whose payload carries a server
// `generated_utc` can OPT IN (`{ freshness: true }`) to feed that timestamp into
// the shared `dataRefresh.noteDataGeneratedUtc` authority. This is how the
// static/historic surfaces (/status, /alerts, /hotspots, /receipt,
// /repeat-offenders, /trip) contribute the ONE site-wide newest-data timestamp
// with ZERO per-page age math — the live store remains the live-tier writer, and
// `noteDataGeneratedUtc` is latest-wins/monotonic so whichever tier published most
// recently owns the readout.

import { untrack } from 'svelte';
import { dataRefresh } from '$lib/stores/refresh.svelte';

/** A payload that may carry the server's build timestamp (latest-data anchor). */
type MaybeFreshPayload = { readonly generated_utc?: string | null } | null | undefined;

/** Options for {@link createResource}. */
export interface ResourceSeed<T> {
	/** Entity key this server-provided value belongs to. */
	readonly key: unknown;
	/** Accepted server value; null is a settled, honest absence. */
	readonly data: T | null;
}

export interface ResourceOptions<T> {
	/**
	 * Optional reactive gate. When false, no request is started; opening the gate
	 * runs the fetcher and closing it aborts any in-flight request. Useful for
	 * expensive resources that only power an interaction such as chrome search.
	 */
	readonly enabled?: () => boolean;
	/**
	 * Reactive identity for entity-scoped resources. A resolved value is exposed
	 * only while it belongs to the current key, so client navigation can never
	 * render entity A beneath entity B's heading.
	 */
	readonly key?: () => unknown;
	/**
	 * Optional server-provided value for the current key. A new matching seed is
	 * accepted without a duplicate browser request. Manual/global refreshes still
	 * fetch because the same seed is applied only once.
	 */
	readonly seed?: () => ResourceSeed<T> | undefined;
	/**
	 * Opt in to contributing the payload's `generated_utc` to the shared
	 * newest-data timestamp (`dataRefresh.noteDataGeneratedUtc`). Only set this for
	 * surfaces whose fetched file carries a server build stamp; the write is
	 * latest-wins/monotonic, so it is safe alongside the live-tier writer.
	 */
	readonly freshness?: boolean;
}

/** The reactive surface a resource exposes. `data` is null until the first success. */
export interface Resource<T> {
	/** Latest successfully-fetched value, or null before the first success. */
	readonly data: T | null;
	/** The error from the most recent failed attempt, cleared on a new attempt. */
	readonly error: Error | null;
	/** True while a fetch is in flight. */
	readonly loading: boolean;
	/** True once at least one attempt has completed (success or failure). */
	readonly settled: boolean;
	/** Re-run the fetcher (e.g. the error-state retry button). */
	reload(): void;
}

/**
 * Build a client-side resource from an async `fetcher`. Call it once at the top of
 * a component `<script>` — the internal `$effect` registers in that component's
 * context and re-runs whenever the reactive inputs read inside `fetcher` change.
 *
 * @example
 * const reliability = createResource(() => getRouteReliability(data.id));
 * // <ResourceBoundary resource={reliability} {lang}>{#snippet children(r)}…{/snippet}</ResourceBoundary>
 */
export function createResource<T>(
	fetcher: (signal: AbortSignal) => Promise<T>,
	options: ResourceOptions<T> = {},
): Resource<T> {
	const wantsFreshness = options.freshness === true;
	let data = $state<T | null>(null);
	let error = $state<Error | null>(null);
	let loading = $state(false);
	let settled = $state(false);
	const keyed = options.key !== undefined;
	const unresolvedKey = Symbol('unresolved-resource-key');
	let stateKey = $state.raw<unknown>(unresolvedKey);
	let dataKey = $state.raw<unknown>(unresolvedKey);
	let lastSeedKey: unknown = unresolvedKey;
	let lastSeedData: T | null | typeof unresolvedKey = unresolvedKey;
	let sawSeed = false;

	// Bumped by reload() to force the effect to re-run without changing inputs.
	let manual = $state(0);
	// Monotonic request token — only the newest in-flight fetch may write state.
	let seq = 0;

	const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));
	const isAbortError = (e: unknown): boolean =>
		typeof e === 'object' && e !== null && 'name' in e && e.name === 'AbortError';

	$effect(() => {
		// Reading `manual` registers it as an $effect dependency so reload() re-runs
		// this fetch; the fetcher's own reactive reads are tracked when it is invoked
		// synchronously below (before any await). The values themselves are unused.
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		manual;
		// Reading the global refresh epoch makes a chrome "refresh data" press re-run
		// this fetch too (these surfaces have no load fn for invalidateAll to re-run).
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		dataRefresh.epoch;
		const activeKey = options.key?.() ?? unresolvedKey;
		const seed = options.seed?.();
		const matchingSeed = seed !== undefined && (!keyed || Object.is(seed.key, activeKey));
		const newSeed =
			matchingSeed &&
			(!sawSeed || !Object.is(seed.key, lastSeedKey) || !Object.is(seed.data, lastSeedData));

		if (newSeed) {
			seq += 1;
			stateKey = activeKey;
			dataKey = activeKey;
			data = seed.data;
			error = null;
			loading = false;
			settled = true;
			sawSeed = true;
			lastSeedKey = seed.key;
			lastSeedData = seed.data;
			return;
		}

		// Read the gate inside the effect so a reactive value controls the resource.
		// Returning before controller creation keeps an unopened resource genuinely
		// idle; if the gate closes, the previous effect cleanup aborts its request.
		if (options.enabled?.() === false) {
			stateKey = activeKey;
			if (keyed && !Object.is(dataKey, activeKey)) data = null;
			loading = false;
			error = null;
			return;
		}

		const token = ++seq;
		const controller = new AbortController();
		const cleanup = () => {
			if (token === seq) seq += 1;
			controller.abort();
		};

		stateKey = activeKey;
		// `dataKey` is an output of this effect: a successful request records which
		// entity owns `data`. Reading that output as an effect dependency makes the
		// first response retrigger its own fetch once. Keep the identity check while
		// excluding the owned output from dependency tracking.
		if (keyed && !untrack(() => Object.is(dataKey, activeKey))) {
			data = null;
			dataKey = unresolvedKey;
			settled = false;
		}
		loading = true;
		error = null;

		let pending: Promise<T>;
		try {
			pending = fetcher(controller.signal);
		} catch (e) {
			if (!isAbortError(e)) error = toError(e);
			loading = false;
			settled = true;
			return cleanup;
		}

		pending
			.then((value) => {
				if (token !== seq) return;
				data = value;
				dataKey = activeKey;
				// Freshness-bearing surfaces feed the shared newest-data timestamp from
				// the payload's own server stamp (latest-wins/monotonic). One line, no
				// per-page age math — the spine derives the relative age centrally.
				if (wantsFreshness) {
					dataRefresh.noteDataGeneratedUtc((value as MaybeFreshPayload)?.generated_utc);
				}
			})
			.catch((e) => {
				if (token !== seq) return;
				if (!isAbortError(e)) error = toError(e);
			})
			.finally(() => {
				if (token !== seq) return;
				loading = false;
				settled = true;
			});

		return cleanup;
	});

	return {
		get data() {
			if (keyed && !Object.is(options.key?.(), dataKey)) return null;
			return data;
		},
		get error() {
			if (keyed && !Object.is(options.key?.(), stateKey)) return null;
			return error;
		},
		get loading() {
			if (keyed && !Object.is(options.key?.(), stateKey)) return true;
			return loading;
		},
		get settled() {
			if (keyed && !Object.is(options.key?.(), stateKey)) return false;
			return settled;
		},
		reload() {
			manual += 1;
		},
	};
}
