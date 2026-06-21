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
import { ageSeconds as ageSecondsOf } from '$lib/utils/time';
import { sharedClock } from './clock.svelte';

export const REFRESH_INVALIDATE_TIMEOUT_MS = 8_000;

let epoch = $state(0);
let refreshing = $state(false);
let lastRefreshedMs = $state<number | null>(null);
let dataGeneratedUtc = $state<string | null>(null);

// The freshness age (seconds), DERIVED — not a private interval. It reads the
// SHARED clock so it ticks in lockstep with every other relative-time label,
// and the single `dataGeneratedUtc` so the chrome readout never drifts from the
// data it describes. Falls back to `lastRefreshedMs` (manual press / page-load
// anchor) when no snapshot timestamp is known yet. `null` when nothing anchors
// it. Readers must consult `now` inside a reactive context for it to tick; a
// reader that wants the timer ALIVE subscribes via `sharedClock.subscribe()`.
const ageSecondsValue = $derived.by<number | null>(() => {
	if (dataGeneratedUtc) {
		// SERVER-anchored now: `dataGeneratedUtc` is server time, so subtracting a
		// skewed CLIENT clock would mis-report the age. `serverNow` ticks every
		// shared interval AND corrects for clock skew (see sharedClock).
		const age = ageSecondsOf(dataGeneratedUtc, sharedClock.serverNow);
		return Number.isNaN(age) ? null : Math.max(0, age);
	}
	// `lastRefreshedMs` is a CLIENT `Date.now()` anchor (manual press / page load),
	// so it must subtract the raw client `now` — mixing in the server offset would
	// re-introduce skew into a purely client-clock delta.
	return lastRefreshedMs != null
		? Math.max(0, Math.round((sharedClock.now - lastRefreshedMs) / 1000))
		: null;
});

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
		void invalidateAll()
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
	/** Epoch ms of the last completed refresh / load anchor, or null before any. */
	get lastRefreshedMs(): number | null {
		return lastRefreshedMs;
	},
	/** UTC data-build timestamp currently loaded in the app chrome, if known. */
	get dataGeneratedUtc(): string | null {
		return dataGeneratedUtc;
	},
	/**
	 * Freshness age in seconds, DERIVED off the shared clock + the single
	 * `dataGeneratedUtc` (falling back to `lastRefreshedMs`). `null` when nothing
	 * anchors it. Read inside a reactive context to tick; pair with
	 * `sharedClock.subscribe()` to keep the underlying interval alive while a
	 * freshness readout is on screen.
	 */
	get ageSeconds(): number | null {
		return ageSecondsValue;
	},
	/**
	 * AUTHORITATIVE write of the snapshot's own DATA timestamp. The live store
	 * calls this on every successful poll; it is the single owner of this value.
	 * Always overwrites (the freshest poll wins). No-op on the server / for falsy
	 * input. Chrome and live surfaces then share this one timestamp.
	 */
	noteDataGeneratedUtc(generatedUtc: string | null | undefined): void {
		if (!browser || !generatedUtc) return;
		dataGeneratedUtc = generatedUtc;
	},
	/**
	 * Seed the snapshot timestamp from the booted manifest as an INITIAL fallback,
	 * only when no authoritative value has landed yet (seed-if-unset). Lets the
	 * freshness readout show the page-load data's age on pages WITHOUT a live
	 * store; the live store's `noteDataGeneratedUtc` supersedes it once polling
	 * starts. No-op on the server / for falsy input / once a value exists.
	 */
	seedDataGeneratedUtc(generatedUtc: string | null | undefined): void {
		if (!browser || !generatedUtc || dataGeneratedUtc != null) return;
		dataGeneratedUtc = generatedUtc;
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
			await invalidateAllBounded();
		} finally {
			lastRefreshedMs = Date.now();
			refreshing = false;
		}
	},
};
