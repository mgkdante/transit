// dataRefresh — the global "refresh data" coordinator.
//
// The app fetches data through THREE independent mechanisms and a single chrome
// "refresh" press must reach all of them:
//   1. LOAD FUNCTIONS (+layout.server.ts boots the /v1 context via the DATA
//      binding; +layout.ts / page loads) — re-run by `invalidateAll()`.
//   2. createResource SURFACES (lines / stops / detail) — fetch in a client
//      `$effect`, NOT a load fn, so invalidateAll never reaches them. They read
//      `epoch` inside that effect, so a bump re-runs every resource.
//   3. The LIVE STORE — polls on a ttl timer; it watches `epoch` and re-polls
//      immediately on a bump instead of waiting for the next tick.
//
// So `run()` does BOTH: bump `epoch` (signals 2 + 3) and await `invalidateAll()`
// (re-runs 1, which also RECOVERS an unreachable /v1 — the server load re-boots
// through the binding and the layout swaps the error edge state back to the page
// tree). One decoupled signal; each data source opts in with one line, with zero
// knowledge of what is currently mounted.

import { browser } from '$app/environment';
import { invalidateAll } from '$app/navigation';

let epoch = $state(0);
let refreshing = $state(false);
let lastRefreshedMs = $state<number | null>(null);

export const dataRefresh = {
	/** Monotonic refresh counter. Read it inside a reactive context to re-run on a press. */
	get epoch(): number {
		return epoch;
	},
	/** True while a refresh is in flight (drives the chrome spinner / disabled state). */
	get refreshing(): boolean {
		return refreshing;
	},
	/** Epoch ms of the last completed refresh / load anchor, or null before any. */
	get lastRefreshedMs(): number | null {
		return lastRefreshedMs;
	},
	/**
	 * Anchor the "as of" timestamp to now IF still unset — call once when the
	 * chrome mounts so the freshness readout reflects the initial page-load data
	 * (SSR-booted /v1 + first resource fetches), not just manual presses. No-op on
	 * the server and after the first refresh. */
	seedNow(): void {
		if (browser && lastRefreshedMs == null) lastRefreshedMs = Date.now();
	},
	/**
	 * Refresh ALL data on the current page: bump `epoch` (createResource + live
	 * store) and re-run load functions (invalidateAll → re-boots the /v1 context).
	 * Idempotent while in flight. Browser-only — `invalidateAll` is client-side.
	 */
	async run(): Promise<void> {
		if (!browser || refreshing) return;
		refreshing = true;
		try {
			epoch += 1;
			await invalidateAll();
		} finally {
			lastRefreshedMs = Date.now();
			refreshing = false;
		}
	},
};
