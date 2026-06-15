// createResource — a client-side reactive data resource for surface loads.
//
// THE scalable spine for static/historic /v1 reads. On Cloudflare a Worker's SSR
// fetch to its OWN /data route 523s (it can't reach the sibling data-proxy), so
// surface data is loaded in the BROWSER, where the flat repositories' global
// fetch resolves the same-origin `/data/v1` base fine. `$effect` runs client-only
// (never during SSR), so this is SSR-safe by construction: the first render shows
// no data (the boundary renders a skeleton), then the effect fetches on mount.
//
// Reactive by design: the fetcher reads its inputs (e.g. an entity id) when it is
// INVOKED inside the effect, so changing those inputs (client nav /route/A →
// /route/B) re-runs the fetch. A monotonic token drops out-of-order responses.
//
// Pair it with <ResourceBoundary> ($lib/components/surface) for skeleton / error /
// empty / loaded rendering — no surface re-implements that. Live-tier data uses
// the live store (createLiveStore) instead; this is for static + historic.
//
// It also honors the global `dataRefresh` epoch: a chrome "refresh data" press
// bumps it, which re-runs the fetch here (createResource surfaces don't use load
// functions, so invalidateAll alone would never reach them).

import { dataRefresh } from '$lib/stores';

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
export function createResource<T>(fetcher: () => Promise<T>): Resource<T> {
	let data = $state<T | null>(null);
	let error = $state<Error | null>(null);
	let loading = $state(false);
	let settled = $state(false);

	// Bumped by reload() to force the effect to re-run without changing inputs.
	let manual = $state(0);
	// Monotonic request token — only the newest in-flight fetch may write state.
	let seq = 0;

	const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

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
		const token = ++seq;

		let pending: Promise<T>;
		try {
			pending = fetcher();
		} catch (e) {
			error = toError(e);
			settled = true;
			return;
		}

		loading = true;
		error = null;

		pending
			.then((value) => {
				if (token !== seq) return;
				data = value;
			})
			.catch((e) => {
				if (token !== seq) return;
				error = toError(e);
			})
			.finally(() => {
				if (token !== seq) return;
				loading = false;
				settled = true;
			});
	});

	return {
		get data() {
			return data;
		},
		get error() {
			return error;
		},
		get loading() {
			return loading;
		},
		get settled() {
			return settled;
		},
		reload() {
			manual += 1;
		},
	};
}
