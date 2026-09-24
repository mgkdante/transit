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

export const REFRESH_INVALIDATE_TIMEOUT_MS = 8_000;

let epoch = $state(0);
let refreshing = $state(false);
async function invalidateAllBounded(): Promise<void> {
	let done = false;
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	await new Promise<void>((resolve) => {
		const finish = () => {
			if (done) return;
			done = true;
			if (timeoutId) clearTimeout(timeoutId);
			resolve();
		};

		timeoutId = setTimeout(finish, REFRESH_INVALIDATE_TIMEOUT_MS);
		void import('$app/navigation')
			.then(({ invalidateAll }) => invalidateAll())
			.catch(() => undefined)
			.finally(finish);
	});
}

export const dataRefresh = {
	/** Monotonic refresh counter. Read it inside a reactive context to re-run on a press. */
	get epoch(): number {
		return epoch;
	},
	/** True while a refresh is in flight (drives the chrome spinner / disabled state). */
	get refreshing(): boolean {
		return refreshing;
	},
	/**
	 * Bump `epoch` WITHOUT running load functions — the lightweight auto-refresh
	 * path used by dataPulse when it detects a new publish. A bump alone re-runs
	 * every createResource surface AND re-polls the live store (both watch `epoch`),
	 * which is exactly what a new snapshot needs; it deliberately skips the heavier
	 * `invalidateAll` (full /v1 re-boot) that the manual `run()` press performs.
	 * Browser-only.
	 */
	bumpEpoch(): void {
		if (!browser) return;
		epoch += 1;
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
			await invalidateAllBounded();
		} finally {
			refreshing = false;
		}
	},
};
